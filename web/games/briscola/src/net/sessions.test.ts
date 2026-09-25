// Briscola's sessions are the shared ones (web/shared/net, docs/design/shared-shell.md §4.5) with
// this game's codec and game fixed by the wrappers beside this file. The scenarios (statuses,
// toasts, timers, the ticket) run once in web/shared/net/sessions.test.ts; this suite pins what the
// wrappers fix (docs/design/briscola.md D19, §4.3): the `briscola-` peer id, the welcome and lobby
// bytes carrying the six options in place of gin's `target`, a guest frame this game's decoder
// refuses and one it accepts.
import { describe, expect, test } from 'vitest';

import { peerIdFor } from '../../../../shared/lib/roomCode.ts';
import {
  CODE,
  cell,
  connectFrom,
  guestCtx,
  hostCtxFor,
  hostParty,
  party,
  world,
} from '../../../../shared/net/sessions.harness.ts';
import type { GuestFrame, HostFrame, Room } from '../protocol.ts';
import { CONNECTED_MSG, GuestSession } from './guest.ts';
import { HostSession, WAITING_MSG } from './host.ts';

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
const hostCtx = hostCtxFor<Room>(TABLE);

describe('briscola HostSession', () => {
  test("registers under briscola-<CODE>; welcomes with the six options; takes only this game's guest frames", () => {
    expect(ROOM).toBe('briscola-ABCD');
    const w = world();
    const opts: Room = { ...TABLE, gamesToWin: 3, exchange: true };
    const session = new HostSession(
      { ...w.deps, read: cell(hostCtx(opts)).read, events: w.hostEvents },
      { code: CODE, attempt: 1, resume: false },
    );
    w.broker.flush();
    expect(w.broker.peers()).toEqual([ROOM]);
    expect(w.log).toEqual([['holdWakeLock'], ['status', WAITING_MSG], ['persist']]);
    const guest = party(w, undefined);
    w.broker.flush();
    const conn = connectFrom(guest, ROOM);
    w.broker.flush();
    // The room after `hostName`, in GameOptions order (protocol.ts `room`).
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
});
