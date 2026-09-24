// The host's side of a two-seat room, shared by every game that plays gin's pipe
// (docs/design/shared-shell.md §4.5, the plan's A1): gin's net/host.ts moved here as it was
// (`startHost` and the `peer`/`conn` handlers of the legacy multiplayer UI, frame for frame and
// timer for timer, over the shared Transport), with the two things a game owns injected. The frames
// come through a `HostCodec` (the game's guest-frame decoder, its `welcome` built from what the
// session reads off the app, its `full`), and the peer id through `HostOptions.game`
// (`peerIdFor`: 'sheshbesh-' is not derivable from 'backgammon', so the game is passed, never
// inferred). `HostContext<X>` carries the game's room payload (gin's `target`, backgammon's
// `matchLength` and `variant`) as `X`, read only by the codec's `welcome`. A game's net/host.ts is
// a wrapper that fixes `<G, H, X>` and re-exports every constant and message below, so its
// ui/state.ts, main.ts and tests import nothing from here.
//
// The session owns the Peer, the one guest channel and the timers; everything it did to the page
// goes through `HostEvents` (status text, toasts, the wake lock, persisting) and everything it read
// off the `app` object comes back through `read()`, so sessions.test.ts drives it over
// transport.fake.ts and clock.fake.ts. Frames cross the trust boundary in the game's protocol.ts:
// an inbound frame the decoder refuses is dropped (the legacy ignored non-objects and unknown
// tags; a malformed `action` it would have handed to the engine, whose refusal it toasted back).
//
// Liveness (liveness.ts, the decision and its reasons in that header): the legacy learnt of a
// guest only from the channel's `close`, which PeerJS fires for a deliberate departure alone, so a
// guest whose tab died kept its seat for good. Both sessions now heartbeat below the codec: the
// host sends `{t: 'hb'}` every HB_MS on the open channel, counts every inbound frame as life, and
// after HB_GRACE_MS of silence closes the channel and raises `guestGone(null)` once, exactly as a
// closed channel is reported, so the reducers' existing "they can rejoin with code X" copy and the
// freed seat follow with no game change. A join that arrives while the current guest has been
// silent for HB_MISSED_MS replaces the silent channel (the old one closed, no `guestGone`, the
// join re-seats) instead of being told the room is full. A join that arrives sooner is held
// (`accept`): the legacy's answer, `full` at once, was also the answer a guest got when it came
// back within seconds of its tab dying, and it got it every REJOIN_MS until the silence reached
// HB_MISSED_MS (five times in the liveness review). Held, the join is neither welcomed nor
// refused: its frames wait, the current guest's next frame (at most HB_MS away when it is
// lively) makes it a third peer, and HB_MISSED_MS of silence makes it the guest's own return,
// welcomed with its waiting frames replayed. A second join while one is held is a third peer at
// once, and a held join takes the seat the moment the current guest leaves on purpose. The
// transport's ICE states were not adopted (liveness.ts says why).
//
// The netAttempt ticket: `whenTransportReady` waits on a network fetch, so its callback can land
// after the player has cancelled and started over, possibly with the same role and code. Each
// attempt takes a ticket (`HostOptions.attempt`, the app's `netAttempt` at the time); cancel and
// leave bump the app's, and a stale callback returns before creating a Peer.
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
import { HB_MISSED_MS, isHeartbeat, liveness, type Liveness } from './liveness.ts';

export { HB_GRACE_MS, HB_MISSED_MS, HB_MS } from './liveness.ts';

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
const openedMsg = (ctx: HostContext<unknown>, code: string): string => {
  if (!ctx.hasGame) return WAITING_MSG;
  return ctx.handoff ? handoffMsg(code, ctx.oppName) : reopenedMsg(code, ctx.oppName);
};

/**
 * What the session reads off the app when an event lands (the legacy read `app` directly). `X` is
 * the game's room payload, what its `welcome` tells the guest (docs/design/shared-shell.md §4.3).
 */
export type HostContext<X> = Readonly<{
  /** The app's current netAttempt ticket. */
  attempt: number;
  role: NetRole | null;
  code: string | null;
  myName: string;
  /** `app.game !== null`: a hand has been dealt (a rejoining guest keeps its seat). */
  hasGame: boolean;
  /** The hand came from pass-and-play and its remote seat has never joined: the invite is to send. */
  handoff: boolean;
  oppName: string | null;
  oppConnected: boolean;
}> &
  X;

/** `G` is the game's guest frame: what arrives on the channel and passes the codec's decoder. */
export type HostEvents<G> = Readonly<{
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
  frame: (frame: G) => void;
  /**
   * The guest's channel closed, failed, or fell silent for HB_GRACE_MS (liveness.ts). `iceFailed`
   * is the status text to show when negotiation failed before the channel ever opened and no hand
   * was dealt (nobody joined, so "Opponent left" would be wrong); null otherwise.
   */
  guestGone: (iceFailed: string | null) => void;
}>;

export type HostDeps<G, X> = NetDeps &
  Readonly<{
    read: () => HostContext<X>;
    events: HostEvents<G>;
  }>;

/**
 * The game's side of the wire (its protocol.ts), handed in by its net/host.ts wrapper: `G` its
 * guest frame, `H` its host frame, `X` the room payload its `welcome` carries.
 */
export type HostCodec<G, H, X> = Readonly<{
  /** What the host accepts from its guest; a refused frame is dropped. */
  decode: (raw: unknown) => Result<G, string>;
  /** The frame sent when a guest's channel opens, built from what the session read off the app. */
  welcome: (ctx: HostContext<X>) => H;
  /** The frame a third peer is told before its channel is closed. */
  full: () => H;
}>;

export type HostOptions = Readonly<{
  /** Which game's room: the peer id is `peerIdFor(game, code)`. */
  game: Game;
  code: string;
  attempt: number;
  /** Resuming a saved room: the code is kept when the broker says it is busy. */
  resume: boolean;
}>;

/**
 * A join held while the current guest is quiet (`accept`): its channel, the frames it has sent
 * meanwhile (its `join`, never a heartbeat), and the cancel of the probe waiting on the guest.
 */
type Held = Readonly<{ conn: Connection; frames: unknown[]; cancel: () => void }>;

export class HostSession<G, H, X> {
  readonly kind = 'host';
  private readonly deps: HostDeps<G, X>;
  private readonly codec: HostCodec<G, H, X>;
  private readonly opts: HostOptions;
  private peer: PeerHandle | null = null;
  private conn: Connection | null = null;
  /** The current channel's heartbeat and silence watch; stopped with the channel. */
  private live: Liveness | null = null;
  /** A join waiting on the current guest's next sign of life; null when nobody is waiting. */
  private held: Held | null = null;

  constructor(deps: HostDeps<G, X>, codec: HostCodec<G, H, X>, opts: HostOptions) {
    this.deps = deps;
    this.codec = codec;
    this.opts = opts;
    whenTransportReady(deps, (ice) => {
      const ctx = deps.read();
      // The player navigated away or restarted while we waited.
      if (ctx.attempt !== opts.attempt || ctx.role !== 'host' || ctx.code !== opts.code) return;
      this.open(ice);
    });
  }

  /** Send to the guest if its channel is open (`if (app.conn && app.conn.open) app.conn.send(...)`). */
  send(frame: H): void {
    if (this.conn?.open() === true) this.conn.send(frame);
  }

  /**
   * Leave: close the channel and destroy the Peer (cancel destroyed the Peer, which closes both,
   * a held join's channel among them).
   */
  close(): void {
    this.live?.stop();
    this.conn?.close();
    this.peer?.destroy();
  }

  private open(ice: IceResult | null): void {
    const { deps, opts } = this;
    const { events } = deps;
    const peer = deps.transportFor(ice).open(peerIdFor(opts.game, opts.code));
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

  /** A peer connected: the seat is free, or the current guest is silent, quiet, or lively. */
  private accept(conn: Connection, ice: IceResult | null): void {
    const current = this.conn;
    const live = this.live;
    if (current === null || live === null || !current.open()) {
      this.seat(conn, ice);
      return;
    }
    // A current guest that has missed a heartbeat and a period more: its page is dead or frozen,
    // and this join is its return in a new tab, or another player's. Either way the seat is free.
    if (live.silence() >= HB_MISSED_MS) {
      this.replace(conn, ice, []);
      return;
    }
    // Quiet, not yet silent: only the guest's next beat, or its absence, tells which. Someone is
    // already waiting on that answer: this one is a third peer by any reading.
    if (this.held !== null) {
      this.refuse(conn);
      return;
    }
    this.hold(conn, ice, live);
  }

  /**
   * `conn` becomes the current channel: the welcome when it opens (now, if it already has), the
   * heartbeat and the watch, its frames to the app. `pending` are the frames a held channel
   * received before it was seated, taken as if they arrived now.
   */
  private seat(
    conn: Connection,
    ice: IceResult | null,
    pending: ReadonlyArray<unknown> = [],
  ): void {
    const { deps, codec } = this;
    const { events } = deps;
    this.live?.stop();
    this.conn = conn;
    const live = liveness(conn, deps.clock, () => {
      this.gone(conn);
    });
    this.live = live;
    const opened = (): void => {
      conn.send(codec.welcome(deps.read()));
      live.start();
      announcePath(
        conn,
        () => this.conn === conn,
        deps,
        (m) => {
          events.toast(m);
        },
      );
    };
    // As the legacy `conn.on('data', ...)`: every channel that was once current keeps reporting.
    // A heartbeat is life and nothing more: it stops here, before the codec.
    const heard = (raw: unknown): void => {
      live.heard();
      if (isHeartbeat(raw)) return;
      const decoded = codec.decode(raw);
      if (decoded.ok) events.frame(decoded.value);
    };
    conn.onMessage(heard);
    conn.onClose(() => {
      if (this.conn !== conn) return;
      live.stop();
      events.guestGone(null);
      // The guest left on purpose while someone was knocking: the seat is theirs now.
      this.seatHeld(ice);
    });
    conn.onError((e) => {
      if (this.conn !== conn) return;
      // The channel is kept, as the legacy kept it (PeerJS closes it itself when the error is
      // fatal, and that close is reported as ever), but its watch stops: a loss is reported here,
      // and the verdict on the silence that follows would report the same guest gone again.
      live.stop();
      // ICE failed before the channel ever opened: nobody joined (no hand yet, or a handoff whose
      // invited seat has not made it in), so 'Opponent left' would be wrong.
      const ctx = deps.read();
      if (!conn.open() && e.type === 'negotiation-failed' && (!ctx.hasGame || ctx.handoff)) {
        events.guestGone(ICE_FAILED_MSG + relayHint(ice));
        return;
      }
      events.guestGone(null);
    });
    if (conn.open()) {
      opened();
      pending.forEach(heard);
    } else {
      conn.onOpen(opened);
    }
  }

  /**
   * `conn` takes the seat from the current channel, which closes now that it is no longer
   * current, so its `close` is not a loss: no `guestGone`, the join that follows re-seats the
   * opponent.
   */
  private replace(conn: Connection, ice: IceResult | null, pending: ReadonlyArray<unknown>): void {
    const silent = this.conn;
    this.seat(conn, ice, pending);
    silent?.close();
  }

  /**
   * A join while the current guest is quiet but not yet silent for HB_MISSED_MS. Its frames wait
   * (a heartbeat is not a frame to keep); the current guest's next frame makes it a third peer,
   * HB_MISSED_MS of silence makes it the guest's return, and a knocker that closes its channel
   * meanwhile (its tab, or its own watch giving up on a host that says nothing) wants no answer.
   */
  private hold(conn: Connection, ice: IceResult | null, live: Liveness): void {
    const frames: unknown[] = [];
    const cancel = live.probe(
      HB_MISSED_MS,
      () => {
        this.held = null;
        this.refuse(conn);
      },
      () => {
        this.held = null;
        this.replace(conn, ice, frames);
      },
    );
    this.held = { conn, frames, cancel };
    const waiting = (): boolean => this.held?.conn === conn;
    conn.onMessage((raw) => {
      if (waiting() && !isHeartbeat(raw)) frames.push(raw);
    });
    conn.onClose(() => {
      if (!waiting()) return;
      this.held = null;
      cancel();
    });
  }

  /** The seat is free and a join was held for it: seated, with the frames it sent meanwhile. */
  private seatHeld(ice: IceResult | null): void {
    const held = this.held;
    if (held === null) return;
    this.held = null;
    held.cancel();
    this.seat(held.conn, ice, held.frames);
  }

  /** A third peer: told the room is full once its channel is open, and closed FULL_CLOSE_MS later. */
  private refuse(conn: Connection): void {
    const tell = (): void => {
      conn.send(this.codec.full());
      this.deps.clock.setTimeout(() => {
        conn.close();
      }, FULL_CLOSE_MS);
    };
    if (conn.open()) tell();
    else conn.onOpen(tell);
  }

  /**
   * HB_GRACE_MS without a frame from the current guest (a watch is stopped whenever its channel
   * stops being current, so the verdict is always about `this.conn`): the channel is dropped
   * first, so that its `close` (PeerJS emits it at once) is not a second report, then the loss is
   * reported the way a closed channel is, and the seat is free for the next join. No join can be
   * held at this point: a hold resolves at HB_MISSED_MS of silence, before the grace.
   */
  private gone(conn: Connection): void {
    this.conn = null;
    this.live = null;
    conn.close();
    this.deps.events.guestGone(null);
  }
}
