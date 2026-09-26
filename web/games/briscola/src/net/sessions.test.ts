// Briscola's sessions are the shared ones (web/shared/net, docs/design/shared-shell.md §4.5,
// docs/design/n-seat-sessions.md) with this game's codec and game fixed by the wrappers beside this
// file. The scenarios (statuses, toasts, timers, the ticket, the hold over every seat) run once in
// web/shared/net/sessions.test.ts and sessions.seats.test.ts; this suite pins what the wrappers fix
// (docs/design/briscola.md D19, §4.3; n-seat-sessions.md §7.3): the `briscola-` peer id, the
// two-seat welcome and lobby bytes carrying the six options in place of gin's `target` (PR-4's, byte
// for byte), a guest frame this game's decoder refuses and one it accepts; and, over `world({ seats:
// true })` at capacity 3 and 4, the N-seat form: the `waiting` copy, guests seated in order and
// each welcomed with the table as the host's context holds it and its own `you`, frames reported
// as their seat, a spare peer told full once every seat is heard, one frame per seat on a
// broadcast (each seat its own view), a guest silent for the grace losing its seat, and the real
// `joinName` moving a same-named rejoin back to it. The last describe is the session's half of the
// live intent's relay (docs/design/briscola-battle.md §4.3, §4.5): a guest's `intent` frame reported
// as its channel's seat (what the reducer checks `frame.seat` against), malformed ones refused in
// silence, and the reducer's per-seat sends (`send(frame, seat)`) reaching those seats alone; the
// reducer's side, with the harness driving it, is ui/state.test.ts's.
import { describe, expect, test } from 'vitest';

import { mulberry32 } from '../../../../shared/lib/rng.ts';
import { peerIdFor } from '../../../../shared/lib/roomCode.ts';
import { HEARTBEAT, isHeartbeat } from '../../../../shared/net/liveness.ts';
import {
  CODE,
  cell,
  connectFrom,
  guestCtx,
  guests,
  hostCtxFor,
  hostParty,
  party,
  pass,
  world,
  type Guest,
  type Party,
  type World,
} from '../../../../shared/net/sessions.harness.ts';
import { createGame, viewFor, type Players, type Seat } from '../engine/index.ts';
import {
  decodeHostFrame,
  intent as intentWire,
  join,
  lobby,
  state,
  toast,
  welcome,
  type GuestFrame,
  type HostFrame,
  type Room,
  type TableSeat,
} from '../protocol.ts';
import { CONNECTED_MSG, GuestSession } from './guest.ts';
import {
  FULL_CLOSE_MS,
  HB_GRACE_MS,
  HostSession,
  WAITING_MSG,
  type HostContext,
  type HostRoom,
} from './host.ts';

/** D19: prefix `briscola-`, the code upper case. */
const ROOM = peerIdFor('briscola', CODE);
const TABLE: Room = {
  seatCount: 2,
  gamesToWin: 2,
  removedTwo: 'C',
  exchange: false,
  scoperta: false,
  partnerPeek: false,
};
const THREE: Room = { ...TABLE, seatCount: 3, removedTwo: 'D' };
const FOUR: Room = { ...TABLE, seatCount: 4 };
const EMPTY: TableSeat = { name: null, connected: false };
const seatRow = (name: string, connected = true): TableSeat => ({ name, connected });
/** Every guest seat of `room` untaken: the table as the host holds it when the room opens. */
const emptyTable = (room: Room): ReadonlyArray<TableSeat> =>
  Array.from({ length: room.seatCount - 1 }, () => EMPTY);
/** Ann hosts CODE with no hand; the two-seat table unless a room is given. */
const hostCtx = hostCtxFor<HostRoom>({ ...TABLE, seats: emptyTable(TABLE) });
const PLAYERS: Players = [
  { id: 'host', name: 'Ann' },
  { id: 'g1', name: 'Bo' },
  { id: 'g2', name: 'Cal' },
  { id: 'g3', name: 'Dee' },
];
const NOW = (): number => 1_700_000_000_000;

const startHost = (
  w: World,
  read: () => HostContext,
  opts: Readonly<{ capacity?: number; waiting?: string }> = {},
): HostSession =>
  new HostSession(
    { ...w.deps, read, events: w.hostEvents },
    { code: CODE, attempt: 1, resume: false, ...opts },
  );
/** One more guest at the table. */
const guest = (w: World): Guest => {
  const [g] = guests(w, ROOM, 1);
  if (g === undefined) throw new Error('no guest');
  return g;
};
/** What a party received, heartbeats aside. */
const heard = (p: Party): ReadonlyArray<unknown> => p.received.filter((f) => !isHeartbeat(f));
/** The seat a state frame is for, through this game's decoder; null for anything else. */
const viewSeat = (raw: unknown): number | null => {
  const r = decodeHostFrame(raw);
  return r.ok && r.value.t === 'state' ? r.value.view.me.idx : null;
};
const frames = (w: World): ReadonlyArray<unknown> => w.log.filter((e) => e[0] === 'frame');

describe('briscola HostSession', () => {
  test("registers under briscola-<CODE>; welcomes with the six options; takes only this game's guest frames", () => {
    expect(ROOM).toBe('briscola-ABCD');
    const w = world();
    const opts: Room = { ...TABLE, gamesToWin: 3, exchange: true };
    const session = startHost(w, cell(hostCtx(opts)).read);
    w.broker.flush();
    expect(w.broker.peers()).toEqual([ROOM]);
    expect(w.log).toEqual([['holdWakeLock'], ['status', WAITING_MSG], ['persist']]);
    const guest = party(w, undefined);
    w.broker.flush();
    const conn = connectFrom(guest, ROOM);
    w.broker.flush();
    // The room after `hostName`, in GameOptions order (protocol.ts `room`); no table at two seats.
    expect(guest.received).toEqual([{ t: 'welcome', hostName: 'Ann', ...opts }]);
    const mark = w.log.length;
    conn.send({ t: 'action', action: { type: 'play', cardId: 'AC' } });
    conn.send({ t: 'action', action: { type: 'play' } }); // no cardId: refused
    conn.send({ t: 'action', action: { type: 'roll' } }); // another game's action: refused
    conn.send({ t: 'welcome', hostName: 'x', ...TABLE }); // a host frame: refused
    w.broker.flush();
    expect(w.since(mark)).toEqual([
      ['frame', { t: 'action', action: { type: 'play', cardId: 'AC' } }],
    ]);
    const state: HostFrame = { t: 'lobby', hostName: 'Ann', ...opts };
    session.send(state);
    w.broker.flush();
    expect(guest.received.at(-1)).toEqual(state);
    // A third peer is told the table is full with this game's frame, once the first guest is heard
    // again (web/shared/net/host.ts `accept`: a join beside a quiet guest waits for its next frame).
    const third = party(w, undefined);
    w.broker.flush();
    connectFrom(third, ROOM);
    w.broker.flush();
    expect(third.received).toEqual([]);
    conn.send({ t: 'action', action: { type: 'next' } });
    w.broker.flush();
    expect(third.received).toEqual([{ t: 'full' }]);
  });
});

describe('briscola HostSession over three and four seats', () => {
  test('capacity 3: the waiting copy; two guests seated 1 then 2, each welcomed with the table as the host holds it and its own `you`, reported as their seat; a lobby per seat; a third peer is held and told full once both seats are heard', () => {
    const w = world({ seats: true });
    const ctx = cell(hostCtx({ ...THREE, seats: emptyTable(THREE) }));
    const waiting = 'Waiting for 2 players to join…';
    const session = startHost(w, ctx.read, { capacity: 3, waiting });
    w.broker.flush();
    expect(w.broker.peers()).toEqual([ROOM]);
    expect(w.log).toEqual([['holdWakeLock'], ['status', waiting], ['persist']]);
    const bo = guest(w);
    expect(heard(bo.party)).toEqual([welcome('Ann', THREE, [EMPTY, EMPTY], 1)]);
    bo.conn.send(join('Bo'));
    w.broker.flush();
    expect(w.log.at(-1)).toEqual(['frame', join('Bo'), 1]);
    // The app has seated Bo: the next welcome lists it, and names seat 2.
    ctx.value = hostCtx({ ...THREE, seats: [seatRow('Bo'), EMPTY] });
    const cal = guest(w);
    expect(heard(cal.party)).toEqual([welcome('Ann', THREE, [seatRow('Bo'), EMPTY], 2)]);
    const mark = w.log.length;
    cal.conn.send(join('Cal'));
    cal.conn.send({ t: 'action', action: { type: 'play', cardId: 'AC' } });
    bo.conn.send({ t: 'action', action: { type: 'play' } }); // refused by the decoder: dropped
    w.broker.flush();
    expect(w.since(mark)).toEqual([
      ['frame', join('Cal'), 2],
      ['frame', { t: 'action', action: { type: 'play', cardId: 'AC' } }, 2],
    ]);
    // The reducer's lobby (n-seat-sessions.md D3): to each seat with its own `you`.
    const table = [seatRow('Bo'), seatRow('Cal')];
    session.send(lobby('Ann', THREE, table, 1), 1);
    session.send(lobby('Ann', THREE, table, 2), 2);
    w.broker.flush();
    expect(heard(bo.party)).toEqual([
      welcome('Ann', THREE, [EMPTY, EMPTY], 1),
      lobby('Ann', THREE, table, 1),
    ]);
    expect(heard(cal.party).at(-1)).toEqual(lobby('Ann', THREE, table, 2));
    // The table is full: a third peer waits on both seats' next signs of life, then is told so.
    const third = party(w, undefined);
    w.broker.flush();
    const c3 = connectFrom(third, ROOM);
    w.broker.flush();
    bo.conn.send(HEARTBEAT);
    w.broker.flush();
    expect(third.received).toEqual([]);
    cal.conn.send(HEARTBEAT);
    w.broker.flush();
    expect(third.received).toEqual([{ t: 'full' }]);
    pass(w, FULL_CLOSE_MS);
    expect(c3.open()).toBe(false);
    expect([bo, cal].every((g) => g.conn.open())).toBe(true);
    expect(w.log.filter((e) => e[0] === 'guestGone')).toEqual([]);
  });

  test("capacity 4: three guests fill seats 1..3 in order; a broadcast is one state per seat, each carrying that seat's view and reaching that seat alone; a frame with no seat reaches every open channel", () => {
    const w = world({ seats: true });
    const session = startHost(w, cell(hostCtx({ ...FOUR, seats: emptyTable(FOUR) })).read, {
      capacity: 4,
    });
    w.broker.flush();
    const table = guests(w, ROOM, 3);
    expect(table.map((g) => heard(g.party))).toEqual(
      [1, 2, 3].map((you) => [welcome('Ann', FOUR, emptyTable(FOUR), you)]),
    );
    table.forEach((g, i) => {
      g.conn.send(join(PLAYERS[i + 1]?.name ?? ''));
    });
    w.broker.flush();
    expect(frames(w)).toEqual([
      ['frame', join('Bo'), 1],
      ['frame', join('Cal'), 2],
      ['frame', join('Dee'), 3],
    ]);
    // The reducer's broadcast (n-seat-sessions.md D4): `viewFor(game, s)` to seat s, nothing else to anyone.
    const game = createGame(PLAYERS, { gamesToWin: 1 }, mulberry32(7), NOW);
    const guestSeats: ReadonlyArray<Seat> = [1, 2, 3];
    guestSeats.forEach((s) => {
      session.send(state(viewFor(game, s)), s);
    });
    w.broker.flush();
    expect(table.map((g) => heard(g.party).map(viewSeat))).toEqual([
      [null, 1],
      [null, 2],
      [null, 3],
    ]);
    session.send(toast('Dealt'));
    w.broker.flush();
    expect(table.map((g) => heard(g.party).at(-1))).toEqual([
      toast('Dealt'),
      toast('Dealt'),
      toast('Dealt'),
    ]);
  });

  test('a guest silent for the grace loses its seat (guestGone names it); a same-named rejoin connecting to a lower free seat is moved back before it is reported and speaks as that seat; the free seat waits for a new name', () => {
    const w = world({ seats: true });
    const ctx = cell(hostCtx({ ...THREE, seats: emptyTable(THREE) }));
    const session = startHost(w, ctx.read, { capacity: 3 });
    w.broker.flush();
    const table = guests(w, ROOM, 2);
    table.forEach((g, i) => {
      g.conn.send(join(PLAYERS[i + 1]?.name ?? ''));
    });
    w.broker.flush();
    // Bo leaves on purpose; Cal's tab dies (nothing heard for the grace).
    table[0]?.conn.close();
    w.broker.flush();
    expect(w.log.at(-1)).toEqual(['guestGone', null, 1]);
    const mark = w.log.length;
    pass(w, HB_GRACE_MS - 1000);
    expect(w.since(mark)).toEqual([]);
    pass(w, 1000);
    expect(w.since(mark)).toEqual([['guestGone', null, 2]]);
    expect(table[1]?.conn.open()).toBe(false);
    // The app keeps both names with their dots off: the welcome to whoever comes says so.
    const off = [seatRow('Bo', false), seatRow('Cal', false)];
    ctx.value = hostCtx({ ...THREE, seats: off });
    const back = party(w, undefined);
    w.broker.flush();
    const c = connectFrom(back, ROOM);
    w.broker.flush();
    // Seat 1 at connection (the lowest free); seat 2 the moment the join says Cal (trimmed, case-folded).
    expect(heard(back)).toEqual([welcome('Ann', THREE, off, 1)]);
    c.send(join(' cal '));
    c.send({ t: 'action', action: { type: 'next' } });
    w.broker.flush();
    expect(w.since(mark + 1)).toEqual([
      ['frame', join(' cal '), 2],
      ['frame', { t: 'action', action: { type: 'next' } }, 2],
    ]);
    session.send(toast('for seat 2'), 2);
    session.send(toast('for seat 1'), 1);
    w.broker.flush();
    expect(heard(back)).toEqual([welcome('Ann', THREE, off, 1), toast('for seat 2')]);
    const eve = party(w, undefined);
    w.broker.flush();
    const cE = connectFrom(eve, ROOM);
    w.broker.flush();
    cE.send(join('Eve'));
    w.broker.flush();
    expect(w.log.at(-1)).toEqual(['frame', join('Eve'), 1]);
  });
});

describe('briscola GuestSession', () => {
  test("connects to briscola-<CODE>, joins with its name; takes only this game's host frames", () => {
    const w = world();
    const welcome = { t: 'welcome', hostName: 'Ann', ...TABLE };
    const lobby = { t: 'lobby', hostName: 'Ann', ...TABLE };
    const host = hostParty(w, ROOM, { welcome, lobby });
    w.broker.flush();
    const session = new GuestSession(
      { ...w.deps, read: cell(guestCtx({ myName: 'Zoë 🃏' })).read, events: w.guestEvents },
      { code: CODE, attempt: 1 },
    );
    w.broker.flush();
    expect(host.received).toEqual([{ t: 'join', name: 'Zoë 🃏' }]);
    expect(w.log).toEqual([
      ['holdWakeLock'],
      ['status', `Found the service — connecting to room ${CODE}…`],
      ['connected'],
      ['status', CONNECTED_MSG],
      ['persist'],
      ['frame', welcome],
      ['frame', lobby],
    ]);
    const play: GuestFrame = { t: 'action', action: { type: 'play', cardId: '7D' } };
    session.send(play);
    host.conns[0]?.send({ t: 'toast', msg: 'x'.repeat(501) }); // over TOAST_MAX: refused
    host.conns[0]?.send({ t: 'join', name: 'not from a host' }); // a guest frame: refused
    host.conns[0]?.send({ t: 'welcome', hostName: 'Ann', ...TABLE, seatCount: 5 }); // a bad room: refused
    host.conns[0]?.send({ t: 'toast', msg: "It's not your turn." });
    w.broker.flush();
    expect(host.received.at(-1)).toEqual(play);
    expect(w.log.at(-1)).toEqual(['frame', { t: 'toast', msg: "It's not your turn." }]);
  });

  test('takes a three-seat welcome and lobby with the table and its own seat; one whose table does not fit its seat count is dropped', () => {
    const w = world();
    const welcome3 = welcome('Ann', THREE, [seatRow('Bo'), EMPTY], 2);
    const lobby3 = lobby('Ann', THREE, [seatRow('Bo'), seatRow('Zoë 🃏')], 2);
    const host = hostParty(w, ROOM, { welcome: welcome3, lobby: lobby3 });
    w.broker.flush();
    const session = new GuestSession(
      { ...w.deps, read: cell(guestCtx({ myName: 'Zoë 🃏' })).read, events: w.guestEvents },
      { code: CODE, attempt: 1 },
    );
    w.broker.flush();
    expect(frames(w)).toEqual([
      ['frame', welcome3],
      ['frame', lobby3],
    ]);
    host.conns[0]?.send({ ...lobby3, seats: [seatRow('Bo')] }); // one row at three seats: refused
    host.conns[0]?.send({ ...lobby3, you: 3 }); // a seat beyond the table: refused
    host.conns[0]?.send(toast('Dealt'));
    w.broker.flush();
    expect(frames(w)).toHaveLength(3);
    expect(w.log.at(-1)).toEqual(['frame', toast('Dealt')]);
    session.close();
  });
});

describe("the live intent over three and four seats, the session's half (docs/design/briscola-battle.md §4.3, §4.5)", () => {
  ([3, 4] as const).forEach((n) => {
    test(`capacity ${String(n)}: Cara's (seat 2) intent frame is reported as seat 2, the seat the reducer checks it against; four malformed ones log nothing; the reducer's relay, one send per other seat, reaches that seat alone and never seat 2; the host's own, seatless, reaches every seat; Cara's channel closing names seat 2`, () => {
      const room = n === 3 ? THREE : FOUR;
      const w = world({ seats: true });
      const session = startHost(w, cell(hostCtx({ ...room, seats: emptyTable(room) })).read, {
        capacity: n,
      });
      w.broker.flush();
      const table = guests(w, ROOM, n - 1);
      const [bo, cal] = table;
      if (bo === undefined || cal === undefined) throw new Error('no guests');
      const others = table.filter((g) => g !== cal);
      table.forEach((g, i) => {
        g.conn.send(join(PLAYERS[i + 1]?.name ?? ''));
      });
      w.broker.flush();
      const mark = w.log.length;
      const hover = intentWire(2, 1, 'hover');
      cal.conn.send(hover);
      cal.conn.send({ t: 'intent', seat: 4, slot: 1, mode: 'hover' }); // no fifth seat
      cal.conn.send({ t: 'intent', seat: 2, slot: 3, mode: 'hover' }); // no fourth slot
      cal.conn.send({ t: 'intent', seat: 2, slot: 1, mode: 'lifted' }); // no such mode
      cal.conn.send({ t: 'intent', seat: 2, slot: 1 }); // no mode
      w.broker.flush();
      expect(w.since(mark)).toEqual([['frame', hover, 2]]);
      // The reducer's relay (ui/state.ts `relayFrom`): `send(hover, s)` for every other seat s.
      const calHeard = heard(cal.party).length;
      others.forEach((_, i) => {
        session.send(hover, i === 0 ? 1 : 3);
      });
      w.broker.flush();
      others.forEach((g) => {
        expect(heard(g.party).at(-1)).toEqual(hover);
      });
      expect(heard(cal.party)).toHaveLength(calHeard);
      // The host's own hover goes out seatless: every seat, Cara's among them.
      const mine = intentWire(0, 2, 'raised');
      session.send(mine);
      w.broker.flush();
      expect(table.map((g) => heard(g.party).at(-1))).toEqual(table.map(() => mine));
      cal.conn.close();
      w.broker.flush();
      expect(w.log.at(-1)).toEqual(['guestGone', null, 2]);
    });
  });
});
