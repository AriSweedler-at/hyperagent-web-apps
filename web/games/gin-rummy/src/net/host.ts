// The host's side of a room (docs/MIGRATION.md step 12): `startHost` and the `peer`/`conn`
// handlers of the legacy multiplayer UI (legacy/gin-rummy/index.html), frame for frame and timer
// for timer, over the shared Transport. The session owns the Peer, the one guest channel and the
// timers; everything it did to the page goes through `HostEvents` (status text, toasts, the wake
// lock, persisting) and everything it read off the `app` object comes back through `read()`, so
// net/host.test.ts drives it over transport.fake.ts and clock.fake.ts. Frames cross the trust
// boundary in protocol.ts: an inbound frame the decoder refuses is dropped (the legacy ignored
// non-objects and unknown tags; a malformed `action` it would have handed to the engine, whose
// refusal it toasted back).
//
// The netAttempt ticket: `whenTransportReady` waits on a network fetch, so its callback can land
// after the player has cancelled and started over, possibly with the same role and code. Each
// attempt takes a ticket (`HostOptions.attempt`, the app's `netAttempt` at the time); cancel and
// leave bump the app's, and a stale callback returns before creating a Peer.
import type { Connection, PeerHandle } from '../../../../shared/edge/transport.ts';
import { peerIdFor } from '../../../../shared/lib/roomCode.ts';
import { decodeGuestFrame, full, welcome, type GuestFrame, type HostFrame } from '../protocol.ts';
import {
  ICE_FAILED_MSG,
  WATCHDOG_MS,
  announcePath,
  describePeerError,
  keepPeerAlive,
  peerWatchdog,
  relayHint,
  whenTransportReady,
  type IceResult,
  type NetDeps,
  type NetRole,
} from './peerjs.ts';

/** `unavailable-id` on a resumed code: retry after this long. */
export const BUSY_RETRY_MS = 1500;
/** A third peer is told the room is full and closed this long after its channel opens. */
export const FULL_CLOSE_MS = 300;
/** Errors and refusals are toasted for this long. */
export const ERROR_TOAST_MS = 5000;

export const OPENING_MSG = 'Opening room…';
export const WAITING_MSG = 'Waiting for your opponent to join…';
export const HOST_WATCHDOG_MSG =
  'Still trying to open the room… Your network may be blocking the connection service (VPN / strict Wi-Fi). Try mobile data or another network.';
export const CODE_BUSY_MSG = 'Room code busy, retrying…';
export const reconnectingMsg = (tries: number): string =>
  `Reconnecting to the connection service (attempt ${String(tries)})…`;
export const reopenedMsg = (code: string, oppName: string | null): string =>
  `Room ${code} reopened — waiting for ${oppName ?? 'your opponent'} to rejoin…`;
/** A pass-and-play game handed to a room (ui/state.ts `handoff`): nobody has joined it yet. */
export const handoffMsg = (code: string, oppName: string | null): string =>
  `Room ${code} is open — send ${oppName ?? 'your opponent'} the invite to carry on this game…`;

/** The status when the Peer opens and no guest is connected. */
const openedMsg = (ctx: HostContext, code: string): string => {
  if (!ctx.hasGame) return WAITING_MSG;
  return ctx.handoff ? handoffMsg(code, ctx.oppName) : reopenedMsg(code, ctx.oppName);
};

/** What the session reads off the app when an event lands (the legacy read `app` directly). */
export type HostContext = Readonly<{
  /** The app's current netAttempt ticket. */
  attempt: number;
  role: NetRole | null;
  code: string | null;
  myName: string;
  target: number;
  /** `app.game !== null`: a hand has been dealt (a rejoining guest keeps its seat). */
  hasGame: boolean;
  /** The hand came from pass-and-play and its remote seat has never joined: the invite is to send. */
  handoff: boolean;
  oppName: string | null;
  oppConnected: boolean;
}>;

export type HostEvents = Readonly<{
  /** `#hostWaitStatus`; `stopPulse` drops its pulsing class (the legacy never put it back). */
  status: (text: string, stopPulse?: boolean) => void;
  /** `toast(msg, ms)`; `ms` undefined is the default duration. */
  toast: (message: string, ms?: number) => void;
  holdWakeLock: () => void;
  persist: () => void;
  /**
   * The code is registered by another peer: the Peer is destroyed and the app opens a room again,
   * with a fresh code (`null`, a new room) or the same one (a resumed room, BUSY_RETRY_MS later).
   */
  restart: (code: string | null) => void;
  /** A guest frame arrived on the current channel and passed the decoder. */
  frame: (frame: GuestFrame) => void;
  /**
   * The guest's channel closed or failed. `iceFailed` is the status text to show when negotiation
   * failed before the channel ever opened and no hand was dealt (nobody joined, so "Opponent left"
   * would be wrong); null otherwise.
   */
  guestGone: (iceFailed: string | null) => void;
}>;

export type HostDeps = NetDeps &
  Readonly<{
    read: () => HostContext;
    events: HostEvents;
  }>;

export type HostOptions = Readonly<{
  code: string;
  attempt: number;
  /** Resuming a saved room: the code is kept when the broker says it is busy. */
  resume: boolean;
}>;

export class HostSession {
  readonly kind = 'host';
  private readonly deps: HostDeps;
  private readonly opts: HostOptions;
  private peer: PeerHandle | null = null;
  private conn: Connection | null = null;

  constructor(deps: HostDeps, opts: HostOptions) {
    this.deps = deps;
    this.opts = opts;
    whenTransportReady(deps, (ice) => {
      const ctx = deps.read();
      // The player navigated away or restarted while we waited.
      if (ctx.attempt !== opts.attempt || ctx.role !== 'host' || ctx.code !== opts.code) return;
      this.open(ice);
    });
  }

  /** Send to the guest if its channel is open (`if (app.conn && app.conn.open) app.conn.send(...)`). */
  send(frame: HostFrame): void {
    if (this.conn?.open() === true) this.conn.send(frame);
  }

  /** Leave: close the channel and destroy the Peer (cancel destroyed the Peer, which closes both). */
  close(): void {
    this.conn?.close();
    this.peer?.destroy();
  }

  private open(ice: IceResult | null): void {
    const { deps, opts } = this;
    const { events } = deps;
    const peer = deps.transportFor(ice).open(peerIdFor('gin-rummy', opts.code));
    this.peer = peer;
    events.holdWakeLock();
    peerWatchdog(peer, deps.clock, WATCHDOG_MS, () => {
      events.status(HOST_WATCHDOG_MSG);
    });
    keepPeerAlive(peer, deps, (tries) => {
      if (!deps.read().oppConnected) events.status(reconnectingMsg(tries));
    });
    peer.on('open', () => {
      const ctx = deps.read();
      if (!ctx.oppConnected) events.status(openedMsg(ctx, opts.code) + relayHint(ice));
      events.persist();
    });
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id') {
        peer.destroy();
        if (!opts.resume) {
          events.restart(null);
          return;
        }
        events.toast(CODE_BUSY_MSG);
        deps.clock.setTimeout(() => {
          events.restart(opts.code);
        }, BUSY_RETRY_MS);
        return;
      }
      const msg = describePeerError(e);
      events.status(msg, true);
      events.toast(msg, ERROR_TOAST_MS);
    });
    peer.on('connection', (conn) => {
      this.accept(conn, ice);
    });
  }

  private accept(conn: Connection, ice: IceResult | null): void {
    const { deps } = this;
    const { events } = deps;
    if (this.conn?.open() === true) {
      // A third peer: the room is full.
      conn.onOpen(() => {
        conn.send(full());
        deps.clock.setTimeout(() => {
          conn.close();
        }, FULL_CLOSE_MS);
      });
      return;
    }
    this.conn = conn;
    conn.onOpen(() => {
      const ctx = deps.read();
      conn.send(welcome(ctx.myName, ctx.target));
      announcePath(
        conn,
        () => this.conn === conn,
        deps,
        (m) => {
          events.toast(m);
        },
      );
    });
    // As the legacy `conn.on('data', ...)`: every channel that was once current keeps reporting.
    conn.onMessage((raw) => {
      const decoded = decodeGuestFrame(raw);
      if (decoded.ok) events.frame(decoded.value);
    });
    conn.onClose(() => {
      if (this.conn === conn) events.guestGone(null);
    });
    conn.onError((e) => {
      if (this.conn !== conn) return;
      // ICE failed before the channel ever opened: nobody joined, so 'Opponent left' would be wrong.
      if (!conn.open() && e.type === 'negotiation-failed' && !deps.read().hasGame) {
        events.guestGone(ICE_FAILED_MSG + relayHint(ice));
        return;
      }
      events.guestGone(null);
    });
  }
}
