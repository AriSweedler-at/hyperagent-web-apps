// Sheshbesh's sessions are the shared ones (web/shared/net, docs/design/shared-shell.md A1) with
// this game's codec and game fixed by the wrappers beside this file. The scenarios (statuses,
// toasts, timers, the ticket) run once in web/shared/net/sessions.test.ts; this suite pins what
// the wrappers fix (design.md §5.3): the `sheshbesh-` peer id, the welcome and lobby bytes
// carrying `matchLength` and `variant` in place of gin's `target`, a guest frame this game's
// decoder refuses and one it accepts.
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
import type { GuestFrame, HostFrame } from '../protocol.ts';
import { CONNECTED_MSG, GuestSession } from './guest.ts';
import { HostSession, WAITING_MSG, type Room } from './host.ts';

/** understand.md §4 step 1: prefix `sheshbesh-`, the code upper case. */
const ROOM = peerIdFor('backgammon', CODE);
const hostCtx = hostCtxFor<Room>({ matchLength: 5, variant: 'portes' });

describe('backgammon HostSession', () => {
  test("registers under sheshbesh-<CODE>; welcomes with the match; takes only this game's guest frames", () => {
    expect(ROOM).toBe('sheshbesh-ABCD');
    const w = world();
    const session = new HostSession(
      {
        ...w.deps,
        read: cell(hostCtx({ matchLength: 7, variant: 'backgammon' })).read,
        events: w.hostEvents,
      },
      { code: CODE, attempt: 1, resume: false },
    );
    w.broker.flush();
    expect(w.broker.peers()).toEqual([ROOM]);
    expect(w.log).toEqual([['holdWakeLock'], ['status', WAITING_MSG], ['persist']]);
    const guest = party(w, undefined);
    w.broker.flush();
    const conn = connectFrom(guest, ROOM);
    w.broker.flush();
    expect(guest.received).toEqual([
      { t: 'welcome', hostName: 'Ann', matchLength: 7, variant: 'backgammon' },
    ]);
    const mark = w.log.length;
    conn.send({ t: 'action', action: { type: 'roll' } });
    conn.send({ t: 'action', action: { type: 'move' } }); // no from/to/die: refused
    conn.send({ t: 'welcome', hostName: 'x', matchLength: 1, variant: 'portes' }); // a host frame: refused
    w.broker.flush();
    expect(w.since(mark)).toEqual([['frame', { t: 'action', action: { type: 'roll' } }]]);
    const state: HostFrame = { t: 'lobby', hostName: 'Ann', matchLength: 7, variant: 'backgammon' };
    session.send(state);
    w.broker.flush();
    expect(guest.received.at(-1)).toEqual(state);
    // A third peer is told the room is full with this game's frame.
    const third = party(w, undefined);
    w.broker.flush();
    connectFrom(third, ROOM);
    w.broker.flush();
    expect(third.received).toEqual([{ t: 'full' }]);
  });
});

describe('backgammon GuestSession', () => {
  test("connects to sheshbesh-<CODE>, joins with its name; takes only this game's host frames", () => {
    const w = world();
    const welcome = { t: 'welcome', hostName: 'Ann', matchLength: 3, variant: 'portes' };
    const lobby = { t: 'lobby', hostName: 'Ann', matchLength: 3, variant: 'portes' };
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
    const move: GuestFrame = { t: 'action', action: { type: 'move', from: 7, to: 4, die: 3 } };
    session.send(move);
    host.conns[0]?.send({ t: 'toast', msg: 'x'.repeat(501) }); // over TOAST_MAX: refused
    host.conns[0]?.send({ t: 'join', name: 'not from a host' }); // a guest frame: refused
    host.conns[0]?.send({ t: 'toast', msg: "It's not your turn." });
    w.broker.flush();
    expect(host.received.at(-1)).toEqual(move);
    expect(w.log.at(-1)).toEqual(['frame', { t: 'toast', msg: "It's not your turn." }]);
  });
});
