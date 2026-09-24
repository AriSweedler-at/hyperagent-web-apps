// The guest's side of a two-seat room, shared by every game that plays gin's pipe
// (docs/design/shared-shell.md §4.5, the plan's A1): gin's net/guest.ts moved here as it was
// (`startGuest` and its `tryJoin` from the legacy multiplayer UI, frame for frame and timer for
// timer, over the shared Transport), with the two things a game owns injected: the frames come
// through a `GuestCodec` (the game's host-frame decoder and its `join`), and the peer id it connects
// to through `GuestOptions.game` (`peerIdFor`, as host.ts). A game's net/guest.ts is a wrapper that
// fixes `<G, H>` and re-exports every constant and message below.
//
// The session owns the Peer, the current channel and every retry: up to MAX_JOIN_TRIES connects
// JOIN_RETRY_MS apart while the host is not registered, a rejoin REJOIN_MS after the channel
// closes, the STALL_MS "answered but can't reach each other" note, and the WATCHDOG_MS warning when
// the broker itself does not answer. Everything it did to the page goes through `GuestEvents` and
// everything it read off `app` comes back through `read()`, so sessions.test.ts drives it over
// transport.fake.ts and clock.fake.ts. Inbound frames pass the game's decoder; a refused frame is
// dropped (the legacy ignored non-objects and unknown tags). Two legacy traits are kept on purpose:
// `tryJoin` runs on every Peer `open`, so a broker reconnect opens a second channel beside a live
// one, and a channel that stopped being current still reports its frames.
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
} from '../edge/peer.ts';
import type { Connection, PeerHandle } from '../edge/transport.ts';
import type { Result } from '../lib/result.ts';
import { peerIdFor, type Game } from '../lib/roomCode.ts';

/** `peer-unavailable` (the host's phone is asleep): connect again after this long... */
export const JOIN_RETRY_MS = 3000;
/** ...at most this many times before giving up with NOT_FOUND. */
export const MAX_JOIN_TRIES = 40;
/** The channel closed mid-game or in the lobby: connect again after this long. */
export const REJOIN_MS = 1500;
/** A connect that has neither opened nor failed after this long gets the "can't reach" note. */
export const STALL_MS = 12_000;
/** Errors are toasted for this long. */
export const ERROR_TOAST_MS = 5000;

export const connectingMsg = (code: string): string => `Connecting to room ${code}…`;
export const GUEST_WATCHDOG_MSG =
  'Still trying to reach the connection service… Your network may be blocking it (VPN / strict Wi-Fi). Try mobile data or another network.';
export const reconnectingMsg = (tries: number): string =>
  `Reconnecting to the connection service (attempt ${String(tries)})…`;
export const foundServiceMsg = (code: string, ice: IceResult | null): string =>
  `Found the service — connecting to room ${code}…${relayHint(ice)}`;
export const retryingMsg = (code: string, tries: number): string =>
  `Room ${code} isn't answering yet (the host's phone may be asleep or on another app). Retrying… (${String(tries)})`;
export const stalledMsg = (code: string, ice: IceResult | null): string =>
  `Room ${code} answered but the phones can't reach each other yet… still trying. If this persists, put both phones on the same Wi-Fi or both on mobile data.${relayHint(ice)}`;
export const CONNECTED_MSG = 'Connected. Waiting for the host to start…';
export const notFoundMsg = (code: string): string =>
  `Room ${code} not found. Check the code, and make sure the host's phone still has the room screen open.`;

/** What the session reads off the app when an event lands (the legacy read `app` directly). */
export type GuestContext = Readonly<{
  /** The app's current netAttempt ticket. */
  attempt: number;
  role: NetRole | null;
  code: string | null;
  myName: string;
  oppConnected: boolean;
}>;

/** `H` is the game's host frame: what arrives on the channel and passes the codec's decoder. */
export type GuestEvents<H> = Readonly<{
  /** `#guestWaitStatus`; `stopPulse` drops its pulsing class (the legacy never put it back). */
  status: (text: string, stopPulse?: boolean) => void;
  /** `toast(msg, ms)`; `ms` undefined is the default duration. */
  toast: (message: string, ms?: number) => void;
  holdWakeLock: () => void;
  persist: () => void;
  /** The channel to the host opened (the join is sent right after). */
  connected: () => void;
  /** A host frame arrived and passed the decoder. */
  frame: (frame: H) => void;
  /** The current channel closed; the session connects again REJOIN_MS later. */
  lost: () => void;
}>;

export type GuestDeps<H> = NetDeps &
  Readonly<{
    read: () => GuestContext;
    events: GuestEvents<H>;
  }>;

/**
 * The game's side of the wire (its protocol.ts), handed in by its net/guest.ts wrapper: `G` its
 * guest frame, `H` its host frame.
 */
export type GuestCodec<G, H> = Readonly<{
  /** What the guest accepts from its host; a refused frame is dropped. */
  decode: (raw: unknown) => Result<H, string>;
  /** The frame sent right after the channel opens, carrying the guest's name. */
  join: (name: string) => G;
}>;

export type GuestOptions = Readonly<{
  /** Which game's room: the session connects to `peerIdFor(game, code)`. */
  game: Game;
  code: string;
  attempt: number;
}>;

export class GuestSession<G, H> {
  readonly kind = 'guest';
  private readonly deps: GuestDeps<H>;
  private readonly codec: GuestCodec<G, H>;
  private readonly opts: GuestOptions;
  private peer: PeerHandle | null = null;
  private conn: Connection | null = null;
  private joinTries = 0;

  constructor(deps: GuestDeps<H>, codec: GuestCodec<G, H>, opts: GuestOptions) {
    this.deps = deps;
    this.codec = codec;
    this.opts = opts;
    whenTransportReady(deps, (ice) => {
      const ctx = deps.read();
      // The player navigated away or restarted while we waited.
      if (ctx.attempt !== opts.attempt || ctx.role !== 'guest' || ctx.code !== opts.code) return;
      this.open(ice);
    });
  }

  /** Send to the host if the channel is open (`if (app.conn && app.conn.open) app.conn.send(...)`). */
  send(frame: G): void {
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
    const peer = deps.transportFor(ice).open(undefined);
    this.peer = peer;
    events.holdWakeLock();
    peerWatchdog(peer, deps.clock, WATCHDOG_MS, () => {
      events.status(GUEST_WATCHDOG_MSG);
    });
    keepPeerAlive(peer, deps, (tries) => {
      if (!deps.read().oppConnected) events.status(reconnectingMsg(tries));
    });
    peer.on('open', () => {
      this.tryJoin(peer, ice);
    });
    peer.on('error', (e) => {
      if (e.type === 'peer-unavailable') {
        // Host not registered right now — usually a backgrounded phone. Keep retrying for a while.
        if (this.joinTries < MAX_JOIN_TRIES) {
          deps.clock.setTimeout(() => {
            this.tryJoin(peer, ice);
          }, JOIN_RETRY_MS);
          return;
        }
        events.status(notFoundMsg(opts.code), true);
        return;
      }
      const msg = describePeerError(e);
      events.status(msg, true);
      events.toast(msg, ERROR_TOAST_MS);
    });
  }

  private tryJoin(peer: PeerHandle, ice: IceResult | null): void {
    const { deps, codec, opts } = this;
    const { events } = deps;
    if (peer.destroyed() || peer.disconnected()) return;
    this.joinTries += 1;
    events.status(
      this.joinTries === 1
        ? foundServiceMsg(opts.code, ice)
        : retryingMsg(opts.code, this.joinTries),
    );
    const conn = peer.connect(peerIdFor(opts.game, opts.code));
    this.conn = conn;
    let opened = false;
    let failed = false;
    deps.clock.setTimeout(() => {
      if (!opened && !failed && this.conn === conn && !deps.read().oppConnected)
        events.status(stalledMsg(opts.code, ice));
    }, STALL_MS);
    conn.onOpen(() => {
      opened = true;
      this.joinTries = 0;
      events.connected();
      conn.send(codec.join(deps.read().myName));
      events.status(CONNECTED_MSG);
      events.persist();
      announcePath(
        conn,
        () => this.conn === conn,
        deps,
        (m) => {
          events.toast(m);
        },
      );
    });
    // As the legacy `conn.on('data', onHostMsg)`: every channel that was once current keeps reporting.
    conn.onMessage((raw) => {
      const decoded = codec.decode(raw);
      if (decoded.ok) events.frame(decoded.value);
    });
    conn.onClose(() => {
      if (this.conn !== conn) return;
      events.lost();
      deps.clock.setTimeout(() => {
        this.tryJoin(peer, ice);
      }, REJOIN_MS);
    });
    // PeerJS closes the RTCPeerConnection before it relays the ICE state, so this error is the
    // only reliable signal that negotiation failed before the channel opened (no 'close' follows).
    conn.onError((e) => {
      if (e.type === 'negotiation-failed' && !opened && this.conn === conn) {
        failed = true;
        events.status(ICE_FAILED_MSG + relayHint(ice), true);
      }
      events.toast(describePeerError(e), ERROR_TOAST_MS);
    });
  }
}
