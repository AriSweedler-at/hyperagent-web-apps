// The host session over three and four seats (docs/design/n-seat-sessions.md §4.4): the paths
// host.ts gains beyond the one slot the two-seat games use, over the same fake broker and clock as
// sessions.test.ts beside it, which stays the two-seat suite and is not edited. One fake codec with
// `joinName` and a `you` in its welcome, so a party's first frame says which seat it took; the
// recorder logs the seat (`world({ seats: true })`). Scenarios: seating in order and a spare peer
// at capacity; `send` to one seat and to all (each seat its own view); per-seat liveness; the hold
// over every seat (the first silence wins, every beat refuses); a held join taking a leaver's seat;
// rejoin by name into a gone seat, into a silent one, and not into a quiet one; `close`; the
// two-seat shape at capacity 2 with the one-argument log, the failed negotiation's retry; the
// `waiting` status.
import { describe, expect, test } from 'vitest';

import { ICE_FAILED_MSG, NO_RELAY_HINT } from '../edge/peer.ts';
import { err, ok, type Result } from '../lib/result.ts';
import { peerIdFor } from '../lib/roomCode.ts';
import {
  FULL_CLOSE_MS,
  HB_GRACE_MS,
  HB_MISSED_MS,
  HB_MS,
  HostSession,
  WAITING_MSG,
  type HostCodec,
  type HostContext,
  type HostOptions,
  type Seat,
} from './host.ts';
import { HEARTBEAT, isHeartbeat } from './liveness.ts';
import {
  CODE,
  STUN_ONLY,
  cell,
  connectFrom,
  guests,
  hostCtxFor,
  party,
  pass,
  settle,
  world,
  type Guest,
  type Party,
  type World,
} from './sessions.harness.ts';

// ---------------------------------------------------------------------------------------------
// A fake N-seat protocol: the two-seat shapes with `you` on the welcome and a per-seat `state`.
// ---------------------------------------------------------------------------------------------

type Room = Readonly<{ size: number }>;
type Join = Readonly<{ t: 'join'; name: string }>;
type GuestFrame = Join | Readonly<{ t: 'action'; action: Readonly<{ type: string }> }>;
type HostFrame =
  | Readonly<{ t: 'welcome'; hostName: string; size: number; you: Seat }>
  | Readonly<{ t: 'lobby'; hostName: string; size: number }>
  | Readonly<{ t: 'full' }>
  | Readonly<{ t: 'state'; view: Readonly<{ you: Seat; hand: number }> }>;

const isRecord = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === 'object' && raw !== null;

const decodeGuestFrame = (raw: unknown): Result<GuestFrame, string> => {
  if (!isRecord(raw)) return err('not an object');
  if (raw['t'] === 'join')
    return typeof raw['name'] === 'string' && raw['name'].length <= 20
      ? ok(raw as GuestFrame)
      : err('bad join');
  if (raw['t'] === 'action')
    return isRecord(raw['action']) && typeof raw['action']['type'] === 'string'
      ? ok(raw as GuestFrame)
      : err('bad action');
  return err('not a guest frame');
};

const codec: HostCodec<GuestFrame, HostFrame, Room> = {
  decode: decodeGuestFrame,
  welcome: (ctx, seat) => ({ t: 'welcome', hostName: ctx.myName, size: ctx.size, you: seat }),
  full: () => ({ t: 'full' }),
  joinName: (frame) => (frame.t === 'join' ? frame.name : null),
};

const GAME = 'gin-rummy';
const ROOM = peerIdFor(GAME, CODE);
const hostCtx = hostCtxFor<Room>({ size: 100 });
const welcome = (you: Seat): HostFrame => ({ t: 'welcome', hostName: 'Ann', size: 100, you });
const join = (name: string): Join => ({ t: 'join', name });
const state = (you: Seat): HostFrame => ({ t: 'state', view: { you, hand: you * 3 } });
const FULL: HostFrame = { t: 'full' };

const startHost = (
  w: World,
  ctx: { read: () => HostContext<Room> },
  opts: Partial<HostOptions> = {},
): HostSession<GuestFrame, HostFrame, Room> =>
  new HostSession({ ...w.deps, read: ctx.read, events: w.hostEvents }, codec, {
    game: GAME,
    code: CODE,
    attempt: 1,
    resume: false,
    capacity: 4,
    ...opts,
  });

/** A table of `n` guests, each seated and joined by name in order; the log cleared of the seating. */
const seated = (
  w: World,
  names: ReadonlyArray<string>,
): Readonly<{
  session: HostSession<GuestFrame, HostFrame, Room>;
  guests: ReadonlyArray<Guest>;
}> => {
  const session = startHost(w, cell(hostCtx()));
  w.broker.flush();
  const table = guests(w, ROOM, names.length);
  table.forEach((g, i) => {
    g.conn.send(join(names[i] ?? ''));
  });
  w.broker.flush();
  return { session, guests: table };
};

/** Let `ms` pass a second at a time while the `beating` guests send a heartbeat each second. */
const passBeating = (w: World, ms: number, beating: ReadonlyArray<Guest>): void => {
  Array.from({ length: Math.floor(ms / 1000) }).forEach(() => {
    beating.forEach((g) => {
      g.conn.send(HEARTBEAT);
    });
    pass(w, 1000);
  });
};

const gone = (w: World): ReadonlyArray<unknown> => w.log.filter((e) => e[0] === 'guestGone');
const frames = (w: World): ReadonlyArray<unknown> => w.log.filter((e) => e[0] === 'frame');
/** What a party received, heartbeats aside. */
const heard = (p: Party): ReadonlyArray<unknown> => p.received.filter((f) => !isHeartbeat(f));

describe('HostSession over four seats', () => {
  test('three guests take seats 1, 2, 3 in the order they connect, each welcomed with its seat and reported as it; a fourth is held and told full once every seat is heard', () => {
    const w = world({ seats: true });
    startHost(w, cell(hostCtx()));
    w.broker.flush();
    expect(w.log).toEqual([['holdWakeLock'], ['status', WAITING_MSG], ['persist']]);
    const table = guests(w, ROOM, 3);
    expect(table.map((g) => heard(g.party))).toEqual([[welcome(1)], [welcome(2)], [welcome(3)]]);
    const mark = w.log.length;
    // Seat 2 speaks first: the seat is the channel's, not the order of the joins.
    table[1]?.conn.send(join('Cal'));
    table[0]?.conn.send(join('Bo'));
    table[2]?.conn.send({ t: 'action', action: { type: 'play' } });
    table[2]?.conn.send({ t: 'action', action: {} }); // refused by the decoder: dropped
    w.broker.flush();
    expect(w.since(mark)).toEqual([
      ['frame', join('Cal'), 2],
      ['frame', join('Bo'), 1],
      ['frame', { t: 'action', action: { type: 'play' } }, 3],
    ]);
    // A fourth peer with every seat taken and quiet: held until each seat has answered.
    const spare = party(w, undefined);
    w.broker.flush();
    const c4 = connectFrom(spare, ROOM);
    w.broker.flush();
    expect(spare.received).toEqual([]);
    table[0]?.conn.send(HEARTBEAT);
    table[2]?.conn.send(HEARTBEAT);
    w.broker.flush();
    expect(spare.received).toEqual([]);
    table[1]?.conn.send(HEARTBEAT);
    w.broker.flush();
    expect(spare.received).toEqual([FULL]);
    pass(w, FULL_CLOSE_MS - 1);
    expect(c4.open()).toBe(true);
    pass(w, 1);
    expect(c4.open()).toBe(false);
    expect(table.every((g) => g.conn.open())).toBe(true);
    expect(gone(w)).toEqual([]);
  });

  test('send(frame, seat) reaches that seat alone, each seat its own view; send(frame) reaches every open channel; a closed seat and an unknown seat get nothing', () => {
    const w = world({ seats: true });
    const { session, guests: table } = seated(w, ['Bo', 'Cal', 'Dee']);
    [1, 2, 3].forEach((s) => {
      session.send(state(s), s);
    });
    w.broker.flush();
    // Redaction is the reducer's: the session's part is that seat 2's frame reaches seat 2 only.
    expect(table.map((g) => heard(g.party))).toEqual([
      [welcome(1), state(1)],
      [welcome(2), state(2)],
      [welcome(3), state(3)],
    ]);
    const lobby: HostFrame = { t: 'lobby', hostName: 'Ann', size: 100 };
    session.send(lobby);
    w.broker.flush();
    expect(table.map((g) => heard(g.party).at(-1))).toEqual([lobby, lobby, lobby]);
    // Seat 3 leaves: a broadcast and a send to 3 both skip it; seat 9 is nobody.
    table[2]?.conn.close();
    w.broker.flush();
    expect(w.log.at(-1)).toEqual(['guestGone', null, 3]);
    session.send(state(3), 3);
    session.send(state(9), 9);
    session.send(lobby);
    w.broker.flush();
    expect(table.map((g) => heard(g.party).length)).toEqual([4, 4, 3]);
  });

  test('liveness is per seat: seat 2 silent for the grace is gone alone, its seat freed and taken by the next join as seat 2; seats 1 and 3 keep beating', () => {
    const w = world({ seats: true });
    const { guests: table } = seated(w, ['Bo', 'Cal', 'Dee']);
    const lively = [table[0], table[2]].filter((g): g is Guest => g !== undefined);
    const mark = w.log.length;
    passBeating(w, HB_GRACE_MS - 1000, lively);
    expect(w.since(mark)).toEqual([]);
    passBeating(w, 1000, lively);
    expect(w.since(mark)).toEqual([['guestGone', null, 2]]);
    expect(table.map((g) => g.conn.open())).toEqual([true, false, true]);
    // Every seat is beaten by the host on its own channel; the dead one's third beat was due the
    // moment its grace ran out, and the verdict came first (as in the two-seat scenario).
    expect(table.map((g) => g.party.received.filter(isHeartbeat).length)).toEqual([3, 2, 3]);
    passBeating(w, HB_GRACE_MS, lively);
    expect(w.since(mark)).toEqual([['guestGone', null, 2]]);
    const back = party(w, undefined);
    w.broker.flush();
    const c = connectFrom(back, ROOM);
    w.broker.flush();
    expect(back.received).toEqual([welcome(2)]);
    c.send(join('Eve'));
    w.broker.flush();
    expect(w.log.at(-1)).toEqual(['frame', join('Eve'), 2]);
  });

  test('a join while every seat is lively is held with a probe per seat; the first seat to reach HB_MISSED_MS of silence is its (that channel closed, no guestGone), and the other probes are cancelled', () => {
    const w = world({ seats: true });
    const { guests: table } = seated(w, ['Bo', 'Cal', 'Dee']);
    // Last heard: Dee at 0 s, Cal at 2 s, Bo at 3 s.
    pass(w, 2000);
    table[1]?.conn.send(HEARTBEAT);
    pass(w, 1000);
    table[0]?.conn.send(HEARTBEAT);
    pass(w, 2000);
    const knock = party(w, undefined);
    w.broker.flush();
    const cK = connectFrom(knock, ROOM);
    w.broker.flush();
    cK.send(join('Kim'));
    w.broker.flush();
    const mark = w.log.length;
    pass(w, HB_MISSED_MS - 5000 - 1);
    expect(knock.received).toEqual([]);
    expect(w.since(mark)).toEqual([]);
    // 10 s since Dee's last frame: seat 3 is Kim's, the join it sent while it waited replayed.
    pass(w, 1);
    expect(knock.received).toEqual([welcome(3)]);
    expect(w.since(mark)).toEqual([['frame', join('Kim'), 3]]);
    expect(table.map((g) => g.conn.open())).toEqual([true, true, false]);
    expect(cK.open()).toBe(true);
    // Cal and Bo were probed too: their next frames answer nobody (no full, no second seating).
    table[1]?.conn.send(HEARTBEAT);
    table[0]?.conn.send(HEARTBEAT);
    pass(w, HB_MISSED_MS);
    expect(heard(knock).length).toBe(1);
    expect(cK.open()).toBe(true);
    expect(gone(w)).toEqual([]);
  });

  test('a join while every seat is quiet is held; every seat beating within the time makes it a spare peer: full, closed 300 ms on', () => {
    const w = world({ seats: true });
    const { guests: table } = seated(w, ['Bo', 'Cal', 'Dee']);
    pass(w, 4000);
    const knock = party(w, undefined);
    w.broker.flush();
    const cK = connectFrom(knock, ROOM);
    w.broker.flush();
    pass(w, 3000);
    expect(knock.received).toEqual([]);
    table.forEach((g) => {
      g.conn.send(HEARTBEAT);
    });
    w.broker.flush();
    expect(knock.received).toEqual([FULL]);
    pass(w, FULL_CLOSE_MS);
    expect(cK.open()).toBe(false);
    expect(table.every((g) => g.conn.open())).toBe(true);
    expect(gone(w)).toEqual([]);
    expect(frames(w)).toHaveLength(3);
  });

  test('a held join takes the seat of whichever guest leaves on purpose meanwhile; a second knocker during the hold is a spare peer at once', () => {
    const w = world({ seats: true });
    const { guests: table } = seated(w, ['Bo', 'Cal', 'Dee']);
    pass(w, 3000);
    const knock = party(w, undefined);
    w.broker.flush();
    const cK = connectFrom(knock, ROOM);
    w.broker.flush();
    cK.send(join('Kim'));
    w.broker.flush();
    const extra = party(w, undefined);
    w.broker.flush();
    const cX = connectFrom(extra, ROOM);
    w.broker.flush();
    expect(extra.received).toEqual([FULL]);
    expect(knock.received).toEqual([]);
    pass(w, FULL_CLOSE_MS);
    expect(cX.open()).toBe(false);
    const mark = w.log.length;
    table[1]?.conn.close();
    w.broker.flush();
    expect(w.since(mark)).toEqual([
      ['guestGone', null, 2],
      ['frame', join('Kim'), 2],
    ]);
    expect(knock.received).toEqual([welcome(2)]);
    expect(cK.open()).toBe(true);
    // Nobody is held any more: the probes on seats 1 and 3 answer nothing at their 10 s.
    passBeating(
      w,
      HB_MISSED_MS,
      [table[0], table[2]].filter((g): g is Guest => g !== undefined),
    );
    expect(w.since(mark)).toHaveLength(2);
    expect(heard(knock)).toEqual([welcome(2)]);
  });

  test('rejoin by name: a join named like a gone seat is moved there before it is reported, though a lower seat was free; the free seat waits for a new name; the key is trimmed and case-folded', () => {
    const w = world({ seats: true });
    const { session, guests: table } = seated(w, ['Bo', 'Cal', 'Dee']);
    // Bo leaves on purpose; Cal's tab dies.
    table[0]?.conn.close();
    w.broker.flush();
    expect(w.log.at(-1)).toEqual(['guestGone', null, 1]);
    const dee = [table[2]].filter((g): g is Guest => g !== undefined);
    passBeating(w, HB_GRACE_MS, dee);
    expect(gone(w)).toEqual([
      ['guestGone', null, 1],
      ['guestGone', null, 2],
    ]);
    // Cal is back: the lowest free seat is 1 at connection, seat 2 the moment the join says Cal.
    const cal = party(w, undefined);
    w.broker.flush();
    const cC = connectFrom(cal, ROOM);
    w.broker.flush();
    expect(cal.received).toEqual([welcome(1)]);
    const mark = w.log.length;
    cC.send(join(' CAL '));
    w.broker.flush();
    expect(w.since(mark)).toEqual([['frame', join(' CAL '), 2]]);
    session.send(state(2), 2);
    session.send(state(1), 1);
    w.broker.flush();
    expect(heard(cal)).toEqual([welcome(1), state(2)]);
    cC.send({ t: 'action', action: { type: 'play' } });
    w.broker.flush();
    expect(w.log.at(-1)).toEqual(['frame', { t: 'action', action: { type: 'play' } }, 2]);
    // Seat 1 is still free: a new name takes it and stays.
    const eve = party(w, undefined);
    w.broker.flush();
    const cE = connectFrom(eve, ROOM);
    w.broker.flush();
    expect(eve.received).toEqual([welcome(1)]);
    cE.send(join('Eve'));
    w.broker.flush();
    expect(w.log.at(-1)).toEqual(['frame', join('Eve'), 1]);
    // The moved channel's watch is its own: Cal quiet for the grace is seat 2 gone, once.
    passBeating(w, HB_GRACE_MS, [...dee, { party: eve, conn: cE }]);
    expect(gone(w).at(-1)).toEqual(['guestGone', null, 2]);
    expect(gone(w)).toHaveLength(3);
  });

  test('rejoin by name against a silent seat: the same name on a free seat is moved to the silent one, whose channel closes without a guestGone', () => {
    const w = world({ seats: true });
    const { guests: table } = seated(w, ['Bo', 'Cal', 'Dee']);
    table[0]?.conn.close();
    w.broker.flush();
    const dee = [table[2]].filter((g): g is Guest => g !== undefined);
    // Cal's tab dies: silent for HB_MISSED_MS, not yet the grace.
    passBeating(w, HB_MISSED_MS, dee);
    const mark = w.log.length;
    const cal = party(w, undefined);
    w.broker.flush();
    const cC = connectFrom(cal, ROOM);
    w.broker.flush();
    expect(cal.received).toEqual([welcome(1)]);
    cC.send(join('Cal'));
    w.broker.flush();
    expect(w.since(mark)).toEqual([['frame', join('Cal'), 2]]);
    expect(table[1]?.conn.open()).toBe(false);
    expect(cC.open()).toBe(true);
    // The dead channel's watch stopped with it: no verdict on it at the grace, and seat 1 is free.
    passBeating(w, HB_GRACE_MS, [...dee, { party: cal, conn: cC }]);
    expect(w.since(mark)).toEqual([['frame', join('Cal'), 2]]);
    const eve = party(w, undefined);
    w.broker.flush();
    connectFrom(eve, ROOM);
    w.broker.flush();
    expect(eve.received).toEqual([welcome(1)]);
  });

  test('a quiet seat is presumed alive: a same-named join keeps the seat it connected to, and the quiet channel stays', () => {
    const w = world({ seats: true });
    const { guests: table } = seated(w, ['Bo', 'Cal', 'Dee']);
    table[0]?.conn.close();
    w.broker.flush();
    pass(w, 3000);
    const other = party(w, undefined);
    w.broker.flush();
    const cO = connectFrom(other, ROOM);
    w.broker.flush();
    const mark = w.log.length;
    cO.send(join('Cal'));
    w.broker.flush();
    expect(w.since(mark)).toEqual([['frame', join('Cal'), 1]]);
    expect(table[1]?.conn.open()).toBe(true);
    // Cal (seat 2) speaks: still seat 2.
    table[1]?.conn.send({ t: 'action', action: { type: 'play' } });
    w.broker.flush();
    expect(w.log.at(-1)).toEqual(['frame', { t: 'action', action: { type: 'play' } }, 2]);
    // An action names nobody: no reseat is looked for.
    cO.send({ t: 'action', action: { type: 'play' } });
    w.broker.flush();
    expect(w.log.at(-1)).toEqual(['frame', { t: 'action', action: { type: 'play' } }, 1]);
  });

  test('close() closes every seated channel and destroys the Peer; an empty seat raises nothing', () => {
    const w = world({ seats: true });
    const { session, guests: table } = seated(w, ['Bo', 'Cal']);
    const mark = w.log.length;
    session.close();
    w.broker.flush();
    expect(table.map((g) => g.conn.open())).toEqual([false, false]);
    expect(w.broker.peers()).toEqual(table.map((g) => g.party.peer.id()));
    // Each closed channel is reported as a closed channel is (the two-seat session did the same).
    expect(w.since(mark)).toEqual([
      ['guestGone', null, 1],
      ['guestGone', null, 2],
    ]);
    session.send(state(1), 1); // closed: dropped, no throw
  });
});

describe('HostSession at capacity 2 with an N-seat codec', () => {
  test('one slot: welcome with seat 1, frames and the loss logged with one argument by the default recorder, a third peer held then full; a smaller capacity is read as 2', () => {
    const w = world();
    const session = startHost(w, cell(hostCtx()), { capacity: 1 });
    w.broker.flush();
    const [g] = guests(w, ROOM, 1);
    expect(g?.party.received).toEqual([welcome(1)]);
    g?.conn.send(join('Jeff'));
    w.broker.flush();
    expect(w.log.at(-1)).toEqual(['frame', join('Jeff')]);
    const third = party(w, undefined);
    w.broker.flush();
    connectFrom(third, ROOM);
    w.broker.flush();
    expect(third.received).toEqual([]);
    g?.conn.send(HEARTBEAT);
    w.broker.flush();
    expect(third.received).toEqual([FULL]);
    g?.conn.close();
    w.broker.flush();
    expect(w.log.at(-1)).toEqual(['guestGone', null]);
    session.send(state(1));
    expect(g?.party.received).toEqual([welcome(1)]);
  });

  test('a negotiation that fails before the channel opens reports the ICE text for its seat; the retry that follows is seated at once, the failed channel never welcomed', async () => {
    const w = world({ ice: STUN_ONLY });
    const session = startHost(w, cell(hostCtx()), {});
    await settle();
    w.broker.flush();
    const first = party(w, undefined);
    w.broker.flush();
    connectFrom(first, ROOM);
    w.broker.deliverNext(); // the host learns of the connection; neither end is open yet
    const hostConn = w.spy.peers[0]?.conns[0];
    expect(hostConn?.conn.open()).toBe(false);
    const mark = w.log.length;
    hostConn?.errors.forEach((fn) => {
      fn({ type: 'negotiation-failed', message: '' });
    });
    expect(w.since(mark)).toEqual([['guestGone', `${ICE_FAILED_MSG} ${NO_RELAY_HINT}`]]);
    session.send(state(1), 1); // the seat's channel is kept but not open: dropped
    // PeerJS closes the failed channel itself, on the side that reported the error, so it never
    // opens; the guest session retries on a fresh one.
    hostConn?.conn.close();
    w.broker.flush();
    expect(first.received).toEqual([]);
    const cB = connectFrom(first, ROOM);
    w.broker.flush();
    expect(first.received).toEqual([welcome(1)]);
    expect(cB.open()).toBe(true);
    cB.send(join('Jeff'));
    w.broker.flush();
    expect(w.log.at(-1)).toEqual(['frame', join('Jeff')]);
    pass(w, HB_MS);
    expect(first.received).toEqual([welcome(1), HEARTBEAT]);
    // Beside the path toast the ICE loader brings, nothing more: one loss, one join.
    expect(w.since(mark).filter((e) => e[0] !== 'toast')).toHaveLength(2);
  });

  test('waiting overrides the open status; without it the status is WAITING_MSG', () => {
    const w = world();
    startHost(w, cell(hostCtx()), { waiting: 'Waiting for 3 players to join…' });
    w.broker.flush();
    expect(w.log).toEqual([
      ['holdWakeLock'],
      ['status', 'Waiting for 3 players to join…'],
      ['persist'],
    ]);
    const plain = world();
    startHost(plain, cell(hostCtx()), {});
    plain.broker.flush();
    expect(plain.log).toEqual([['holdWakeLock'], ['status', WAITING_MSG], ['persist']]);
  });
});
