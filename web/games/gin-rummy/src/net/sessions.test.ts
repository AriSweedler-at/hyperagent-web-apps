// Gin's sessions are the shared ones (web/shared/net, docs/design/shared-shell.md A1) with gin's
// codec and game fixed by the wrappers beside this file. The scenarios (statuses, toasts, timers,
// the ticket) run once in web/shared/net/sessions.test.ts; this suite pins what the wrappers fix:
// the `ginrummy-ari-` peer id, the welcome and lobby bytes with `target`, a guest frame gin's
// decoder refuses and one it accepts. The wire corpus replay is test/parity/gin.sessions.test.ts.
import { describe, expect, test } from 'vitest';

import { GIN_PEER_PREFIX } from '../../../../shared/lib/roomCode.ts';
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

const ROOM = `${GIN_PEER_PREFIX}${CODE}`;
const hostCtx = hostCtxFor<Room>({ target: 100 });

describe('gin HostSession', () => {
  test('registers under ginrummy-ari-<CODE>; welcomes with the target; takes only gin guest frames', () => {
    expect(ROOM).toBe('ginrummy-ari-ABCD');
    const w = world();
    const session = new HostSession(
      { ...w.deps, read: cell(hostCtx({ target: 75 })).read, events: w.hostEvents },
      { code: CODE, attempt: 1, resume: false },
    );
    w.broker.flush();
    expect(w.broker.peers()).toEqual([ROOM]);
    expect(w.log).toEqual([['holdWakeLock'], ['status', WAITING_MSG], ['persist']]);
    const guest = party(w, undefined);
    w.broker.flush();
    const conn = connectFrom(guest, ROOM);
    w.broker.flush();
    expect(guest.received).toEqual([{ t: 'welcome', hostName: 'Ann', target: 75 }]);
    const mark = w.log.length;
    conn.send({ t: 'action', action: { type: 'drawStock' } });
    conn.send({ t: 'action', action: { type: 'setMelds' } }); // no melds key: refused (step 10)
    conn.send({ t: 'welcome', hostName: 'x', target: 1 }); // a host frame: refused
    w.broker.flush();
    expect(w.since(mark)).toEqual([['frame', { t: 'action', action: { type: 'drawStock' } }]]);
    const state: HostFrame = { t: 'lobby', hostName: 'Ann', target: 75 };
    session.send(state);
    w.broker.flush();
    expect(guest.received.at(-1)).toEqual(state);
    // A third peer is told the room is full with gin's frame.
    const third = party(w, undefined);
    w.broker.flush();
    connectFrom(third, ROOM);
    w.broker.flush();
    expect(third.received).toEqual([{ t: 'full' }]);
  });
});

describe('gin GuestSession', () => {
  test('connects to ginrummy-ari-<CODE>, joins with its name; takes only gin host frames', () => {
    const w = world();
    const welcome = { t: 'welcome', hostName: 'Ann', target: 50 };
    const lobby = { t: 'lobby', hostName: 'Ann', target: 50 };
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
    const move: GuestFrame = { t: 'action', action: { type: 'knock', cardId: '6S' } };
    session.send(move);
    host.conns[0]?.send({ t: 'toast', msg: 'x'.repeat(501) }); // over TOAST_MAX: refused
    host.conns[0]?.send({ t: 'join', name: 'not from a host' }); // a guest frame: refused
    host.conns[0]?.send({ t: 'toast', msg: "It's not your turn." });
    w.broker.flush();
    expect(host.received.at(-1)).toEqual(move);
    expect(w.log.at(-1)).toEqual(['frame', { t: 'toast', msg: "It's not your turn." }]);
  });
});
