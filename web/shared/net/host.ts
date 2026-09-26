// The host's side of a room, shared by every game that plays gin's pipe (docs/design/shared-shell.md
// §4.5, the plan's A1): gin's net/host.ts moved here as it was (`startHost` and the `peer`/`conn`
// handlers of the legacy multiplayer UI, frame for frame and timer for timer, over the shared
// Transport), with the two things a game owns injected. The frames come through a `HostCodec` (the
// game's guest-frame decoder, its `welcome` built from what the session reads off the app, its
// `full`), and the peer id through `HostOptions.game` (`peerIdFor`: 'sheshbesh-' is not derivable
// from 'backgammon', so the game is passed, never inferred). `HostContext<X>` carries the game's
// room payload (gin's `target`, backgammon's `matchLength` and `variant`) as `X`, read only by the
// codec's `welcome`. A game's net/host.ts is a wrapper that fixes `<G, H, X>` and re-exports every
// constant and message below, so its ui/state.ts, main.ts and tests import nothing from here.
//
// Seats (docs/design/n-seat-sessions.md §4; briscola's 3 and 4 players): the session hosts
// `capacity - 1` guest channels (`HostOptions.capacity`, default 2), each a seat numbered
// 1..capacity-1 (the host is seat 0 and has no channel) with its own heartbeat and silence watch.
// A peer that connects takes the lowest free seat; every event names the seat its channel holds
// (`frame(frame, seat)`, `guestGone(iceFailed, seat)`), `send(frame, seat?)` writes one open
// channel or every one, and `codec.welcome(ctx, seat)` tells a channel which seat it took. At
// capacity 2 there is one slot and every path below is the two-seat code it replaced, so
// sessions.test.ts, the two games' byte-pinning suites and the gin wire corpus run unchanged; the
// two-seat codecs take one parameter and set no `joinName`. What a seat means (names beyond the
// rejoin key, the lobby, redaction per seat, Start, teams, turn order) is the reducer's, not the
// session's: the session is a transport object over an injected codec and holds no game state.
//
// The session owns the Peer, the guest channels and the timers; everything it did to the page goes
// through `HostEvents` (status text, toasts, the wake lock, persisting) and everything it read off
// the `app` object comes back through `read()`, so sessions.test.ts and sessions.seats.test.ts
// drive it over transport.fake.ts and clock.fake.ts. Frames cross the trust boundary in the game's
// protocol.ts: an inbound frame the decoder refuses is dropped (the legacy ignored non-objects and
// unknown tags; a malformed `action` it would have handed to the engine, whose refusal it toasted
// back). A guest's frame is reported as the seat its channel holds and nothing on the wire says
// otherwise: a guest cannot act for another seat.
//
// Liveness (liveness.ts, the decision and its reasons in that header): the legacy learnt of a
// guest only from the channel's `close`, which PeerJS fires for a deliberate departure alone, so a
// guest whose tab died kept its seat for good. Both sessions now heartbeat below the codec: the
// host sends `{t: 'hb'}` every HB_MS on each open channel, counts every inbound frame as life, and
// after HB_GRACE_MS of silence closes the channel and raises `guestGone(null, seat)` once, exactly
// as a closed channel is reported, so the reducers' existing "they can rejoin with code X" copy
// and the freed seat follow with no game change. A join that arrives while every seat is taken
// and one guest has been silent for HB_MISSED_MS replaces the silent channel (the old one closed,
// no `guestGone`, the join re-seats) instead of being told the room is full. A join that arrives
// sooner is held (`accept`): the legacy's answer, `full` at once, was also the answer a guest got
// when it came back within seconds of its tab dying, and it got it every REJOIN_MS until the
// silence reached HB_MISSED_MS (five times in the liveness review). Held, the join is neither
// welcomed nor refused: its frames wait, one probe watches every seat, the first seat to reach
// HB_MISSED_MS of silence is the knocker's (welcomed with its waiting frames replayed, the other
// probes cancelled), and every seat beating within that time makes it a spare peer told `full`.
// A second join while one is held is a spare peer at once, and a held join takes the seat the
// moment any guest leaves on purpose. The transport's ICE states were not adopted (liveness.ts
// says why).
//
// Rejoin by name (n-seat-sessions.md §4.1, D6): with `codec.joinName` set, a decoded join whose
// name (trimmed, case-folded) matches the last name seated at another seat whose channel is gone
// or silent for HB_MISSED_MS is moved to that seat before it is reported (the silent channel
// closed with no `guestGone`; the seat it connected to is free again), so a guest whose tab died
// lands back in its own seat with the name its shell already saves, and a table of three or four
// keeps its turn order and partnerships. A seat merely quiet is presumed alive: a same-named
// newcomer sits where it connected and the reducer's `guestNameFor` dedupes the display name.
// Only the session can move a channel between seats, which is why this lives here and not in the
// reducer; tokens (a per-seat secret in the lobby) are the upgrade for two same-named players. A
// resumed room starts with every seat's key seeded from the host save (`HostOptions.names`): with
// the host back after a reload, its guests reconnect in whatever order their rejoin timers fire,
// and each is moved to the seat its name held before its join is reported, so nobody is renamed
// and no hand changes hands. The save holds the display names the reducer deduped, so a name it
// suffixed (" 2") is not matched by the raw name its guest sends again: that guest sits where it
// connected and is deduped once more, the two-same-names case the tokens are for.
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
import type { Timer } from '../lib/clock.ts';
import type { Result } from '../lib/result.ts';
import { peerIdFor, type Game } from '../lib/roomCode.ts';
import { HB_MISSED_MS, isHeartbeat, liveness, type Liveness } from './liveness.ts';

export { HB_GRACE_MS, HB_MISSED_MS, HB_MS } from './liveness.ts';

/** `unavailable-id` on a resumed code: retry after this long. */
export const BUSY_RETRY_MS = 1500;
/** A spare peer is told the room is full and closed this long after its channel opens. */
export const FULL_CLOSE_MS = 300;
/** Errors and refusals are toasted for this long. */
export const ERROR_TOAST_MS = 5000;
/** Seats at a table when `HostOptions.capacity` is not given: the host and one guest. */
export const DEFAULT_CAPACITY = 2;

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

/** The status when the Peer opens and no guest is connected; `waiting` is the game's open status. */
const openedMsg = (ctx: HostContext<unknown>, code: string, waiting: string): string => {
  if (!ctx.hasGame) return waiting;
  return ctx.handoff ? handoffMsg(code, ctx.oppName) : reopenedMsg(code, ctx.oppName);
};

/**
 * A guest's seat, 1..capacity-1 in the order the seats are given out (the lowest free one at
 * connection). The host is seat 0 and has no channel, so no event ever names it.
 */
export type Seat = number;

/**
 * What the session reads off the app when an event lands (the legacy read `app` directly). `X` is
 * the game's room payload, what its `welcome` tells the guest (docs/design/shared-shell.md §4.3).
 * `oppName` and `oppConnected` are read for the reopened, handoff and reconnect statuses only; an
 * N-seat reducer fills them as the names still missing and whether any seat is connected.
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
  /**
   * A guest frame arrived on a seated channel and passed the decoder; `seat` is the seat that
   * channel holds (1 at capacity 2). A two-seat adapter takes the frame alone.
   */
  frame: (frame: G, seat: Seat) => void;
  /**
   * Seat `seat`'s channel closed, failed, or fell silent for HB_GRACE_MS (liveness.ts). `iceFailed`
   * is the status text to show when negotiation failed before the channel ever opened and no hand
   * was dealt (nobody joined, so "Opponent left" would be wrong); null otherwise.
   */
  guestGone: (iceFailed: string | null, seat: Seat) => void;
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
  /** What the host accepts from its guests; a refused frame is dropped. */
  decode: (raw: unknown) => Result<G, string>;
  /**
   * The frame sent when a guest's channel opens, built from what the session read off the app and
   * the seat the channel took. A two-seat codec takes the context alone.
   */
  welcome: (ctx: HostContext<X>, seat: Seat) => H;
  /** The frame a spare peer is told before its channel is closed. */
  full: () => H;
  /**
   * The name a join frame carries, null for any other frame. When set, a join whose name matches
   * the last name seated at a vacated seat is reseated there before it is reported (the header's
   * "Rejoin by name"). Unset, as the two-seat games leave it: no reseating.
   */
  joinName?: (frame: G) => string | null;
}>;

export type HostOptions = Readonly<{
  /** Which game's room: the peer id is `peerIdFor(game, code)`. */
  game: Game;
  code: string;
  attempt: number;
  /** Resuming a saved room: the code is kept when the broker says it is busy. */
  resume: boolean;
  /** Seats at the table, the host's included: `capacity - 1` guest channels. DEFAULT_CAPACITY when absent. */
  capacity?: number;
  /** The status when the Peer opens with no hand dealt; WAITING_MSG when absent. */
  waiting?: string;
  /**
   * A resumed room: the last name seated at each guest seat 1..capacity-1 (the host save's, null
   * for a seat never named), seeding the seats' rejoin keys so each returning guest is moved back
   * to its own seat by name before its join is reported (the header's "Rejoin by name"), whatever
   * order they reconnect in. Absent for a fresh room, and for the two-seat games.
   */
  names?: ReadonlyArray<string | null>;
}>;

/** A value the session rewrites: readonly records of closures are the shape this zone's lint keeps. */
type Cell<T> = Readonly<{ get: () => T; set: (value: T) => void }>;

const cell = <T>(initial: T): Cell<T> => {
  let value = initial;
  return {
    get: () => value,
    set: (next) => {
      value = next;
    },
  };
};

/**
 * One guest channel and its heartbeat and silence watch, and the slot it sits in (a rejoin by
 * name moves a channel, so the slot is read through the channel and never captured). `failed`:
 * it raised an error before it ever opened, so it never will (PeerJS closes such a channel with
 * no `close` event); it stays in its slot, as the legacy kept it, so a later error on it is still
 * reported, but the seat is empty for the next join, which is its guest's retry.
 */
type Channel = Readonly<{
  conn: Connection;
  live: Liveness;
  slot: Cell<Slot>;
  failed: Cell<boolean>;
}>;

/**
 * A guest seat: its number, the channel sitting in it (null when free: never taken, closed and
 * reported, or silent past the grace), and the rejoin key of the last join seated here, kept
 * after the channel is gone so the same name can come back to it.
 */
type Slot = Readonly<{ seat: Seat; channel: Cell<Channel | null>; name: Cell<string | null> }>;

/**
 * A join held while every seat is taken and quiet (`accept`): its channel, the frames it has sent
 * meanwhile (its `join`, never a heartbeat), and the cancel of the probes waiting on the seats.
 */
type Held = Readonly<{ conn: Connection; frames: unknown[]; cancel: () => void }>;

const isChannel = (channel: Channel | null): channel is Channel => channel !== null;

/** The rejoin key of a join name: what the reseat compares (the codec's decoder bounds its length). */
const rejoinKey = (name: string): string => name.trim().toLowerCase();

/** A seat's key off `HostOptions.names`: the saved name's, none for a seat never named or named blank. */
const seededKey = (name: string | null | undefined): string | null =>
  name === undefined || name === null || name.trim() === '' ? null : rejoinKey(name);

/** A seat with no claim on it: no channel, or one that failed before it opened. */
const empty = (slot: Slot): boolean => {
  const channel = slot.channel.get();
  return channel === null || channel.failed.get();
};

/** A seat whose channel has not opened yet: the legacy's "not open is free", taken last. */
const negotiating = (slot: Slot): boolean => slot.channel.get()?.conn.open() === false;

/** A seat a same-named join may take back: empty, or its channel silent past HB_MISSED_MS. */
const vacated = (slot: Slot): boolean => {
  const channel = slot.channel.get();
  return channel === null || channel.failed.get() || channel.live.silence() >= HB_MISSED_MS;
};

export class HostSession<G, H, X> {
  readonly kind = 'host';
  private readonly deps: HostDeps<G, X>;
  private readonly codec: HostCodec<G, H, X>;
  private readonly opts: HostOptions;
  private peer: PeerHandle | null = null;
  /** The guest seats, 1..capacity-1 in order; at capacity 2 the one slot is the legacy's `conn`. */
  private readonly slots: ReadonlyArray<Slot>;
  /** A join waiting on the seats' next signs of life; null when nobody is waiting. */
  private held: Held | null = null;

  constructor(deps: HostDeps<G, X>, codec: HostCodec<G, H, X>, opts: HostOptions) {
    this.deps = deps;
    this.codec = codec;
    this.opts = opts;
    // A table has the host and at least one guest seat: a smaller capacity is a programming error
    // read as the default rather than a room that refuses everyone.
    const guests = Math.max(DEFAULT_CAPACITY, opts.capacity ?? DEFAULT_CAPACITY) - 1;
    // A resumed room's seats start with the keys of the names that sat in them (`names`), so the
    // first join back is moved to its own seat and not merely to the lowest free one.
    this.slots = Array.from({ length: guests }, (_, i) => ({
      seat: i + 1,
      channel: cell<Channel | null>(null),
      name: cell<string | null>(seededKey(opts.names?.[i])),
    }));
    whenTransportReady(deps, (ice) => {
      const ctx = deps.read();
      // The player navigated away or restarted while we waited.
      if (ctx.attempt !== opts.attempt || ctx.role !== 'host' || ctx.code !== opts.code) return;
      this.open(ice);
    });
  }

  /**
   * Send to one seat's channel if it is open (`if (app.conn && app.conn.open) app.conn.send(...)`),
   * or to every open channel when `seat` is omitted. A seat nobody holds, or one outside the
   * table, gets nothing.
   */
  send(frame: H, seat?: Seat): void {
    const targets = seat === undefined ? this.slots : this.slots.filter((s) => s.seat === seat);
    targets.forEach((slot) => {
      const channel = slot.channel.get();
      if (channel?.conn.open() === true) channel.conn.send(frame);
    });
  }

  /**
   * Leave: close every channel and destroy the Peer (cancel destroyed the Peer, which closes them
   * all, a held join's channel among them).
   */
  close(): void {
    this.slots.forEach((slot) => {
      const channel = slot.channel.get();
      if (channel === null) return;
      channel.live.stop();
      channel.conn.close();
    });
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
      if (!ctx.oppConnected)
        events.status(openedMsg(ctx, opts.code, opts.waiting ?? WAITING_MSG) + relayHint(ice));
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

  /**
   * A peer connected: the lowest free seat is its; else the lowest seat whose guest is silent; else
   * it waits on the seats, or is a spare peer when a join already waits. At one slot this is the
   * two-seat `accept` line for line: free, silent, held, quiet.
   */
  private accept(conn: Connection, ice: IceResult | null): void {
    // Free: the lowest empty seat (never taken, closed and reported, or a negotiation that failed
    // before it opened, whose retry this may be); only when none is empty, the lowest whose channel
    // is still negotiating. Empty first, so two joins that arrive together (an invite in a group
    // chat, two players back from one wifi blip) take two seats instead of the second evicting the
    // first while it negotiates; at one slot the two reads are the two-seat "not open is free"
    // rule, which seats a failed negotiation's retry at once.
    const free = this.slots.find(empty) ?? this.slots.find(negotiating);
    if (free !== undefined) {
      this.seat(conn, free, ice);
      return;
    }
    // A guest that has missed a heartbeat and a period more: its page is dead or frozen, and this
    // join is its return in a new tab, or another player's. Either way the seat is free.
    const silent = this.channels().find((channel) => channel.live.silence() >= HB_MISSED_MS);
    if (silent !== undefined) {
      this.replace(conn, silent, ice, []);
      return;
    }
    // Quiet, not yet silent: only each guest's next beat, or its absence, tells which. Someone is
    // already waiting on that answer: this one is a spare peer by any reading.
    if (this.held !== null) {
      this.refuse(conn);
      return;
    }
    this.hold(conn, ice);
  }

  /** Every seated channel, in seat order (every slot's, when no seat is free). */
  private channels(): ReadonlyArray<Channel> {
    return this.slots.map((slot) => slot.channel.get()).filter(isChannel);
  }

  /**
   * `conn` takes `slot`: the welcome when it opens (now, if it already has), the heartbeat and the
   * watch, its frames to the app as that seat. `pending` are the frames a held channel received
   * before it was seated, taken as if they arrived now.
   */
  private seat(
    conn: Connection,
    slot: Slot,
    ice: IceResult | null,
    pending: ReadonlyArray<unknown> = [],
  ): void {
    const { deps, codec } = this;
    const { events } = deps;
    slot.channel.get()?.live.stop();
    const live = liveness(conn, deps.clock, () => {
      this.gone(channel);
    });
    const channel: Channel = { conn, live, slot: cell(slot), failed: cell(false) };
    slot.channel.set(channel);
    const current = (): boolean => channel.slot.get().channel.get() === channel;
    const opened = (): void => {
      // Replaced while it negotiated (every seat taken, its slot given to the next join as a failed
      // negotiation's is to its retry): a channel that opens afterwards is nobody's seat, and a
      // watch started now would call the seat's real guest gone at its grace. Closing it sends its
      // guest back through its rejoin.
      if (!current()) {
        conn.close();
        return;
      }
      conn.send(codec.welcome(deps.read(), channel.slot.get().seat));
      live.start();
      announcePath(conn, current, deps, (m) => {
        events.toast(m);
      });
    };
    // As the legacy `conn.on('data', ...)`: every channel that was once seated keeps reporting.
    // A heartbeat is life and nothing more: it stops here, before the codec.
    const heard = (raw: unknown): void => {
      live.heard();
      if (isHeartbeat(raw)) return;
      const decoded = codec.decode(raw);
      if (!decoded.ok) return;
      this.reseat(channel, decoded.value, ice);
      events.frame(decoded.value, channel.slot.get().seat);
    };
    conn.onMessage(heard);
    conn.onClose(() => {
      if (!current()) return;
      live.stop();
      const at = channel.slot.get();
      at.channel.set(null);
      events.guestGone(null, at.seat);
      // The guest left on purpose while someone was knocking: the seat is theirs now.
      this.seatHeld(at, ice);
    });
    conn.onError((e) => {
      if (!current()) return;
      // The channel is kept, as the legacy kept it (PeerJS closes it itself when the error is
      // fatal, and that close is reported as ever), but its watch stops: a loss is reported here,
      // and the verdict on the silence that follows would report the same guest gone again.
      live.stop();
      const ctx = deps.read();
      if (!conn.open()) {
        // Failed before it ever opened: the seat is empty again (`empty`), so the retry its guest
        // makes takes it back rather than the next seat along, leaving this one dead until every
        // other is taken (and, in a resumed room, blocking the rejoin by name to it).
        channel.failed.set(true);
        // ICE failed before the channel ever opened: nobody joined (no hand yet, or a handoff
        // whose invited seat has not made it in), so 'Opponent left' would be wrong.
        if (e.type === 'negotiation-failed' && (!ctx.hasGame || ctx.handoff)) {
          events.guestGone(ICE_FAILED_MSG + relayHint(ice), channel.slot.get().seat);
          return;
        }
      }
      events.guestGone(null, channel.slot.get().seat);
    });
    if (conn.open()) {
      opened();
      pending.forEach(heard);
    } else {
      conn.onOpen(opened);
    }
  }

  /**
   * `conn` takes the seat of `silent`, whose channel closes now that it is no longer seated, so
   * its `close` is not a loss: no `guestGone`, the join that follows re-seats the player.
   */
  private replace(
    conn: Connection,
    silent: Channel,
    ice: IceResult | null,
    pending: ReadonlyArray<unknown>,
  ): void {
    this.seat(conn, silent.slot.get(), ice, pending);
    silent.conn.close();
  }

  /**
   * A join while every seat is taken and quiet but none silent for HB_MISSED_MS. Its frames wait
   * (a heartbeat is not a frame to keep); one probe watches each seat: the first to reach that
   * silence is the knocker's (the other probes cancelled), every seat beating first makes it a
   * spare peer, and a knocker that closes its channel meanwhile (its tab, or its own watch giving
   * up on a host that says nothing) wants no answer. At one slot: today's hold, seat written down.
   *
   * The deadline: HB_MISSED_MS after the knock every probe has answered, unless a watched channel's
   * watch was stopped meanwhile (an error on a seated channel stops it and leaves the channel in
   * its seat), which clears its probe with no verdict and would leave the knocker waiting for good
   * on a status that reads as connected (the online review's four-seat spare, 30 s and counting).
   * At the deadline the knocker is answered as `accept` would answer it now: a watched seat silent
   * for HB_MISSED_MS is its, else it is a spare peer.
   */
  private hold(conn: Connection, ice: IceResult | null): void {
    const frames: unknown[] = [];
    const watched = this.channels();
    const probes: (() => void)[] = [];
    const deadline = cell<Timer | null>(null);
    const cancel = (): void => {
      probes.forEach((c) => {
        c();
      });
      const timer = deadline.get();
      if (timer !== null) this.deps.clock.clearTimeout(timer);
      deadline.set(null);
    };
    let alive = 0;
    watched.forEach((channel) => {
      probes.push(
        channel.live.probe(
          HB_MISSED_MS,
          () => {
            alive += 1;
            if (alive < watched.length) return;
            this.held = null;
            this.refuse(conn);
          },
          () => {
            this.held = null;
            cancel();
            this.replace(conn, channel, ice, frames);
          },
        ),
      );
    });
    this.held = { conn, frames, cancel };
    const waiting = (): boolean => this.held?.conn === conn;
    deadline.set(
      this.deps.clock.setTimeout(() => {
        if (!waiting()) return;
        this.held = null;
        cancel();
        const silent = watched.find(
          (channel) =>
            channel.slot.get().channel.get() === channel && channel.live.silence() >= HB_MISSED_MS,
        );
        if (silent !== undefined) this.replace(conn, silent, ice, frames);
        else this.refuse(conn);
      }, HB_MISSED_MS),
    );
    conn.onMessage((raw) => {
      if (waiting() && !isHeartbeat(raw)) frames.push(raw);
    });
    conn.onClose(() => {
      if (!waiting()) return;
      this.held = null;
      cancel();
    });
  }

  /** `slot` is free and a join was held for it: seated, with the frames it sent meanwhile. */
  private seatHeld(slot: Slot, ice: IceResult | null): void {
    const held = this.held;
    if (held === null) return;
    this.held = null;
    held.cancel();
    this.seat(held.conn, slot, ice, held.frames);
  }

  /** A spare peer: told the room is full once its channel is open, and closed FULL_CLOSE_MS later. */
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
   * HB_GRACE_MS without a frame on a seated channel (a watch is stopped whenever its channel stops
   * being seated, so the verdict is always about a channel in its slot): the channel leaves the
   * slot first, so that its `close` (PeerJS emits it at once) is not a second report, then the
   * loss is reported the way a closed channel is, and the seat is free for the next join. No join
   * can be held at this point: a hold resolves at HB_MISSED_MS of silence, before the grace.
   */
  private gone(channel: Channel): void {
    const slot = channel.slot.get();
    slot.channel.set(null);
    channel.conn.close();
    this.deps.events.guestGone(null, slot.seat);
  }

  /**
   * The header's "Rejoin by name": a decoded join on `channel` whose key matches a vacated seat's
   * moves the channel there before the frame is reported. Without `codec.joinName` (the two-seat
   * games) nothing here runs.
   */
  private reseat(channel: Channel, frame: G, ice: IceResult | null): void {
    const name = this.codec.joinName?.(frame) ?? null;
    if (name === null) return;
    const key = rejoinKey(name);
    const from = channel.slot.get();
    const back = this.slots.find(
      (slot) => slot !== from && slot.name.get() === key && vacated(slot),
    );
    if (back !== undefined) this.move(channel, back, ice);
    channel.slot.get().name.set(key);
  }

  /**
   * `channel` leaves its slot for `to`, whose silent channel (if one is still there) closes as a
   * replaced one does: no `guestGone`. The watch follows the channel; nothing restarts. The slot
   * it leaves keeps its earlier name and is free, so a join held meanwhile takes it.
   */
  private move(channel: Channel, to: Slot, ice: IceResult | null): void {
    const from = channel.slot.get();
    const evicted = to.channel.get();
    to.channel.set(channel);
    channel.slot.set(to);
    from.channel.set(null);
    // Closed once it is out of its slot, so its `close` finds it is not current: no report.
    if (evicted !== null) {
      evicted.live.stop();
      evicted.conn.close();
    }
    this.seatHeld(from, ice);
  }
}
