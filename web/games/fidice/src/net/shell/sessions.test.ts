// Fidice's sessions on the shell path are the shared ones (web/shared/net, docs/design/shared-shell.md
// §4.5, docs/design/n-seat-sessions.md) with this game's codec and game fixed by the wrappers beside
// this file. The scenarios run once in web/shared/net/sessions.test.ts and sessions.seats.test.ts;
// this suite pins what the wrappers fix (docs/design/fidice-shell-adoption.md §4 M3): the
// `fidice-<code>` peer id lower-cased, the two-seat welcome bytes carrying the five terms in place of
// gin's `target`, a guest frame this game's decoder refuses and one it accepts; and, over `world({
// seats: true })` at capacity 6, the N-seat form: the `waiting` copy, guests seated in order and each
// welcomed with the table as the host's context holds it and its own `you`, frames reported as their
// seat, a spare peer told full, one frame per seat on a broadcast, and the real `joinName` moving a
// same-named rejoin back to its seat (D5: no tokens). The legacy sessions oracle
// (test/parity/fidice.sessions.test.ts) keeps the old net until M6.
import { describe, expect, test } from 'vitest';

import { mulberry32 } from '../../../../../shared/lib/rng.ts';
import { peerIdFor } from '../../../../../shared/lib/roomCode.ts';
import { isHeartbeat } from '../../../../../shared/net/liveness.ts';
import {
  cell,
  connectFrom,
  guestCtx,
  guests,
  hostCtxFor,
  hostParty,
  party,
  world,
  type Guest,
  type Party,
  type World,
} from '../../../../../shared/net/sessions.harness.ts';
import { HOST, apply } from '../../domain/game.ts';
import { redactFor } from '../../domain/publicState.ts';
import {
  decodeHostFrame,
  join,
  lobby,
  state,
  toast,
  welcome,
  type GuestFrame,
  type HostFrame,
  type Room,
  type TableSeat,
} from '../../protocol.ts';
import { seatTable, viewerFor } from '../../shellConfig.ts';
import { CONNECTED_MSG, GuestSession } from './guest.ts';
import {
  FULL_CLOSE_MS,
  HostSession,
  WAITING_MSG,
  type HostContext,
  type HostRoom,
} from './host.ts';

/** Fidice codes are five characters; the harness's CODE is gin's four, so this suite spells its own. */
const CODE = 'ABCDE';
/** The peer id: prefix `fidice-`, the code lower-cased (web/shared/lib/roomCode.ts). */
const ROOM = peerIdFor('fidice', CODE);
const TABLE: Room = { lives: 0, seatCount: 2, bots: 0, botChoice: 'profiler', watch: false };
const SIX: Room = { ...TABLE, seatCount: 6, bots: 2, lives: 3 };
const EMPTY: TableSeat = { name: null, connected: false };
const seatRow = (name: string, connected = true): TableSeat => ({ name, connected });
const emptyTable = (room: Room): ReadonlyArray<TableSeat> =>
  Array.from({ length: room.seatCount - 1 }, () => EMPTY);
/** Ann hosts CODE with nobody dealt in; the two-seat table unless a room is given. */
const hostCtx = (room: HostRoom = { ...TABLE, seats: emptyTable(TABLE) }): HostContext =>
  hostCtxFor<HostRoom>(room)({ code: CODE });

const startHost = (
  w: World,
  read: () => HostContext,
  opts: Readonly<{ capacity?: number; waiting?: string }> = {},
): HostSession =>
  new HostSession(
    { ...w.deps, read, events: w.hostEvents },
    { code: CODE, attempt: 1, resume: false, ...opts },
  );
const heard = (p: Party): ReadonlyArray<unknown> => p.received.filter((f) => !isHeartbeat(f));
const frames = (w: World): ReadonlyArray<unknown> => w.log.filter((e) => e[0] === 'frame');
/** Whose view a state frame carries, read off the holder's dice: the holder sees its cup, nobody else does. */
const seesCup = (raw: unknown): boolean | null => {
  const r = decodeHostFrame(raw);
  return r.ok && r.value.t === 'state'
    ? (r.value.view.round?.dice.every((d) => d.value !== null) ?? null)
    : null;
};

describe('fidice HostSession', () => {
  test('registers under fidice-<code> lower-cased; welcomes with the five terms; takes only this game`s guest frames', () => {
    expect(ROOM).toBe('fidice-abcde');
    const w = world();
    const opts: Room = { ...TABLE, lives: 3, botChoice: 'random' };
    const session = startHost(w, cell(hostCtx({ ...opts, seats: emptyTable(opts) })).read);
    w.broker.flush();
    expect(w.broker.peers()).toEqual([ROOM]);
    expect(w.log).toEqual([['holdWakeLock'], ['status', WAITING_MSG], ['persist']]);
    const guest = party(w, undefined);
    w.broker.flush();
    const conn = connectFrom(guest, ROOM);
    w.broker.flush();
    // The room after `hostName`, in Opts order (protocol.ts `options`); no table at two seats.
    expect(guest.received).toEqual([{ t: 'welcome', hostName: 'Ann', ...opts }]);
    expect(JSON.stringify(guest.received[0])).toBe(
      '{"t":"welcome","hostName":"Ann","lives":3,"seatCount":2,"bots":0,"botChoice":"random","watch":false}',
    );
    const mark = w.log.length;
    conn.send({ t: 'action', action: { type: 'bid', rank: 40 } });
    conn.send({ t: 'action', action: { type: 'bid', rank: 252 } }); // beyond the ladder: refused
    conn.send({ t: 'action', action: { type: 'play', cardId: 'AC' } }); // another game's action: refused
    conn.send({ t: 'hello', role: 'player', name: 'x', token: null }); // the legacy wire: refused
    conn.send({ t: 'welcome', hostName: 'x', ...TABLE }); // a host frame: refused
    w.broker.flush();
    expect(w.since(mark)).toEqual([['frame', { t: 'action', action: { type: 'bid', rank: 40 } }]]);
    const frame: HostFrame = { t: 'lobby', hostName: 'Ann', ...opts };
    session.send(frame);
    w.broker.flush();
    expect(guest.received.at(-1)).toEqual(frame);
    // A third peer is told the table is full with this game's frame, once the first guest is heard again.
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

describe('fidice HostSession over six seats', () => {
  test('capacity 6: the waiting copy; guests seated 1..5 in order, each welcomed with the table and its own `you`; frames as their seat; a lobby per seat; a sixth peer held then told full', () => {
    const w = world({ seats: true });
    const ctx = cell(hostCtx({ ...SIX, seats: emptyTable(SIX) }));
    const waiting = 'Waiting for players — 6 chairs at the table';
    const session = startHost(w, ctx.read, { capacity: 6, waiting });
    w.broker.flush();
    expect(w.broker.peers()).toEqual([ROOM]);
    expect(w.log).toEqual([['holdWakeLock'], ['status', waiting], ['persist']]);
    const table = guests(w, ROOM, 5);
    expect(table.map((g) => heard(g.party))).toEqual(
      [1, 2, 3, 4, 5].map((you) => [welcome('Ann', SIX, emptyTable(SIX), you)]),
    );
    const names = ['Bo', 'Cal', 'Dee', 'Eve', 'Fay'];
    table.forEach((g, i) => {
      g.conn.send(join(names[i] ?? ''));
    });
    w.broker.flush();
    expect(frames(w)).toEqual(names.map((n, i) => ['frame', join(n), i + 1]));
    // The app has seated everyone: the reducer's lobby (n-seat-sessions.md D3) to each seat with its own `you`.
    const seated = names.map((n) => seatRow(n));
    ctx.value = hostCtx({ ...SIX, seats: seated });
    [1, 2, 3, 4, 5].forEach((you) => {
      session.send(lobby('Ann', SIX, seated, you), you);
    });
    w.broker.flush();
    table.forEach((g, i) => {
      expect(heard(g.party).at(-1)).toEqual(lobby('Ann', SIX, seated, i + 1));
    });
    // A sixth peer waits on every seat's next sign of life, then is told the table is full.
    const spare = party(w, undefined);
    w.broker.flush();
    const c6 = connectFrom(spare, ROOM);
    w.broker.flush();
    table.forEach((g) => {
      g.conn.send({ t: 'action', action: { type: 'peek' } });
    });
    w.broker.flush();
    expect(spare.received).toEqual([{ t: 'full' }]);
    w.clock.advance(FULL_CLOSE_MS);
    w.broker.flush();
    expect(c6.open()).toBe(false);
    expect(table.every((g) => g.conn.open())).toBe(true);
  });

  test('a broadcast is one state per seat, each seat`s own redaction reaching that seat alone; a frame with no seat reaches every open channel', () => {
    const w = world({ seats: true });
    const session = startHost(w, cell(hostCtx({ ...SIX, seats: emptyTable(SIX) })).read, {
      capacity: 6,
    });
    w.broker.flush();
    const table: ReadonlyArray<Guest> = guests(w, ROOM, 2);
    table.forEach((g, i) => {
      g.conn.send(join(['Bo', 'Cal'][i] ?? ''));
    });
    w.broker.flush();
    // The reducer's deal: the host, the two guests and no computer; the host shakes the cup first.
    const dealt = apply(
      seatTable(
        CODE,
        [
          { id: 'host', name: 'Ann' },
          { id: 'guest', name: 'Bo' },
          { id: 'guest2', name: 'Cal' },
        ],
        { ...SIX, bots: 0 },
        mulberry32(3),
      ),
      HOST,
      { type: 'start' },
      mulberry32(3),
    );
    if (!dealt.ok) throw new Error(dealt.error);
    // The holder (the host) peeks, so its cup is its own to see; the guests' redactions hide it.
    [1, 2].forEach((s) => {
      session.send(state(redactFor(dealt.value, viewerFor(dealt.value, s))), s);
    });
    w.broker.flush();
    expect(table.map((g) => heard(g.party).map(seesCup))).toEqual([
      [null, false],
      [null, false],
    ]);
    session.send(toast('Dealt'));
    w.broker.flush();
    expect(table.map((g) => heard(g.party).at(-1))).toEqual([toast('Dealt'), toast('Dealt')]);
  });

  test('rejoin by name (D5): a guest that leaves and comes back under its name is moved to its seat before it is reported, with no token', () => {
    const w = world({ seats: true });
    const ctx = cell(hostCtx({ ...SIX, seats: emptyTable(SIX) }));
    startHost(w, ctx.read, { capacity: 6 });
    w.broker.flush();
    const table = guests(w, ROOM, 2);
    table.forEach((g, i) => {
      g.conn.send(join(['Bo', 'Cal'][i] ?? ''));
    });
    w.broker.flush();
    table[1]?.conn.close();
    w.broker.flush();
    expect(w.log.at(-1)).toEqual(['guestGone', null, 2]);
    // The app keeps Cal's name with its dot off: the welcome to whoever comes says so.
    const off = [seatRow('Bo'), seatRow('Cal', false), EMPTY, EMPTY, EMPTY];
    ctx.value = hostCtx({ ...SIX, seats: off });
    const back = party(w, undefined);
    w.broker.flush();
    const c = connectFrom(back, ROOM);
    w.broker.flush();
    // Seat 2 at connection (the lowest free); the join says Cal, so it stays seat 2 and speaks as it.
    expect(heard(back)).toEqual([welcome('Ann', SIX, off, 2)]);
    const mark = w.log.length;
    c.send(join(' CAL '));
    c.send({ t: 'action', action: { type: 'call' } });
    w.broker.flush();
    expect(w.since(mark)).toEqual([
      ['frame', join(' CAL '), 2],
      ['frame', { t: 'action', action: { type: 'call' } }, 2],
    ]);
  });
});

describe('fidice GuestSession', () => {
  test('connects to fidice-<code>, joins with its name; takes only this game`s host frames', () => {
    const w = world();
    const welcomeFrame = { t: 'welcome', hostName: 'Ann', ...TABLE };
    const lobbyFrame = { t: 'lobby', hostName: 'Ann', ...TABLE };
    const host = hostParty(w, ROOM, { welcome: welcomeFrame, lobby: lobbyFrame });
    w.broker.flush();
    const session = new GuestSession(
      {
        ...w.deps,
        read: cell(guestCtx({ myName: 'Zoë 🎲', code: CODE })).read,
        events: w.guestEvents,
      },
      { code: CODE, attempt: 1 },
    );
    w.broker.flush();
    expect(host.received).toEqual([{ t: 'join', name: 'Zoë 🎲' }]);
    expect(w.log).toEqual([
      ['holdWakeLock'],
      ['status', `Found the service — connecting to room ${CODE}…`],
      ['connected'],
      ['status', CONNECTED_MSG],
      ['persist'],
      ['frame', welcomeFrame],
      ['frame', lobbyFrame],
    ]);
    const call: GuestFrame = { t: 'action', action: { type: 'call' } };
    session.send(call);
    host.conns[0]?.send({ t: 'toast', msg: 'x'.repeat(501) }); // over TOAST_MAX: refused
    host.conns[0]?.send({ t: 'join', name: 'not from a host' }); // a guest frame: refused
    host.conns[0]?.send({ t: 'welcome', hostName: 'Ann', ...TABLE, seatCount: 7 }); // a bad room: refused
    host.conns[0]?.send({ t: 'state', state: {}, you: { seat: 1, token: 't', role: 'player' } }); // the legacy wire: refused
    host.conns[0]?.send({ t: 'toast', msg: "It's not your turn." });
    w.broker.flush();
    expect(host.received.at(-1)).toEqual(call);
    expect(w.log.at(-1)).toEqual(['frame', { t: 'toast', msg: "It's not your turn." }]);
  });

  test('takes a six-seat welcome and lobby with the table and its own seat; one whose table does not fit its seat count is dropped', () => {
    const w = world();
    const rows = [seatRow('Bo'), EMPTY, EMPTY, EMPTY, EMPTY];
    const welcome6 = welcome('Ann', SIX, rows, 2);
    const lobby6 = lobby('Ann', SIX, [seatRow('Bo'), seatRow('Zoë'), EMPTY, EMPTY, EMPTY], 2);
    const host = hostParty(w, ROOM, { welcome: welcome6, lobby: lobby6 });
    w.broker.flush();
    const session = new GuestSession(
      {
        ...w.deps,
        read: cell(guestCtx({ myName: 'Zoë', code: CODE })).read,
        events: w.guestEvents,
      },
      { code: CODE, attempt: 1 },
    );
    w.broker.flush();
    expect(frames(w)).toEqual([
      ['frame', welcome6],
      ['frame', lobby6],
    ]);
    host.conns[0]?.send({ ...lobby6, seats: [seatRow('Bo')] }); // one row at six seats: refused
    host.conns[0]?.send({ ...lobby6, you: 6 }); // a seat beyond the table: refused
    host.conns[0]?.send(toast('Dealt'));
    w.broker.flush();
    expect(frames(w)).toHaveLength(3);
    expect(w.log.at(-1)).toEqual(['frame', toast('Dealt')]);
    session.close();
  });
});
