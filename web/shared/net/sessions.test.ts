// The host and guest sessions over the fake broker and the fake clock: every status and toast the
// legacy page wrote, the frames it sent, the netAttempt ticket, and the retry schedules (10 s
// watchdog, 40 x 3 s joins, 1.5 s rejoin, 12 s stall note, 1.5 s path toast, 400 ms then
// min(15000, 1500 * tries) broker reconnects, 1.5 s busy-code retry, 300 ms full close). Gin's
// scenarios, run once here over a fake codec since the sessions are generic
// (docs/design/shared-shell.md A1); each game's net/sessions.test.ts pins only what its wrapper
// fixes (peer id, welcome and lobby bytes, its decoder's refusals). The wire corpus replay is
// test/parity/gin.sessions.test.ts. The last group is the liveness the sessions added over the
// legacy (liveness.ts): 5 s heartbeats below the codec, a 15 s silence as the peer gone, the seat
// freed, a join held while the guest is quiet and then refused or seated, and a broker blip that
// leaves a live channel alone. Two legacy scenarios changed their shape with it: a third peer is
// told the room is full once the first guest is heard (not at once), and a guest's broker
// reconnect opens no second channel beside a live one.
import { describe, expect, test } from 'vitest';

import {
  ICE_FAILED_MSG,
  NO_RELAY_HINT,
  PATH_DIRECT_MSG,
  PATH_RELAY_MSG,
  PATH_TOAST_MS,
  RECONNECT_FIRST_MS,
  WATCHDOG_MS,
  describePeerError,
} from '../edge/peer.ts';
import type { TransportError } from '../edge/transport.ts';
import { err, ok, type Result } from '../lib/result.ts';
import { peerIdFor, type Game } from '../lib/roomCode.ts';
import {
  CONNECTED_MSG,
  GUEST_WATCHDOG_MSG,
  GuestSession,
  JOIN_RETRY_MS,
  MAX_JOIN_TRIES,
  REJOIN_MS,
  STALL_MS,
  connectingMsg,
  foundServiceMsg,
  notFoundMsg,
  retryingMsg,
  stalledMsg,
  type GuestCodec,
  type GuestContext,
} from './guest.ts';
import {
  BUSY_RETRY_MS,
  CODE_BUSY_MSG,
  ERROR_TOAST_MS,
  FULL_CLOSE_MS,
  HB_GRACE_MS,
  HB_MISSED_MS,
  HB_MS,
  HOST_WATCHDOG_MSG,
  HostSession,
  OPENING_MSG,
  WAITING_MSG,
  handoffMsg,
  reconnectingMsg,
  reopenedMsg,
  type HostCodec,
  type HostContext,
  type HostOptions,
} from './host.ts';
import { HEARTBEAT, isHeartbeat } from './liveness.ts';
import {
  CODE,
  STUN_ONLY,
  cell,
  connectFrom,
  guestCtx,
  hostCtxFor,
  hostParty,
  party,
  pass,
  settle,
  world,
  type World,
} from './sessions.harness.ts';

// ---------------------------------------------------------------------------------------------
// A fake two-seat protocol: the shapes gin's legacy wire had, with a `size` room payload in place
// of a game's. Names are capped at NAME_MAX and toasts at TOAST_MAX like the games' protocol.ts,
// so the refusal scenarios keep their shape; valid frames pass through as they arrived.
// ---------------------------------------------------------------------------------------------

type Room = Readonly<{ size: number }>;
type GuestFrame =
  | Readonly<{ t: 'join'; name: string }>
  | Readonly<{ t: 'action'; action: Readonly<{ type: string }> }>;
type HostFrame =
  | Readonly<{ t: 'welcome'; hostName: string; size: number }>
  | Readonly<{ t: 'lobby'; hostName: string; size: number }>
  | Readonly<{ t: 'full' }>
  | Readonly<{ t: 'toast'; msg: string }>;

const NAME_MAX = 20;
const TOAST_MAX = 500;
const isRecord = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === 'object' && raw !== null;

const decodeGuestFrame = (raw: unknown): Result<GuestFrame, string> => {
  if (!isRecord(raw)) return err('not an object');
  if (raw['t'] === 'join')
    return typeof raw['name'] === 'string' && raw['name'].length <= NAME_MAX
      ? ok(raw as GuestFrame)
      : err('bad join');
  if (raw['t'] === 'action')
    return isRecord(raw['action']) && typeof raw['action']['type'] === 'string'
      ? ok(raw as GuestFrame)
      : err('bad action');
  return err('not a guest frame');
};

const decodeHostFrame = (raw: unknown): Result<HostFrame, string> => {
  if (!isRecord(raw)) return err('not an object');
  if (raw['t'] === 'welcome' || raw['t'] === 'lobby')
    return typeof raw['hostName'] === 'string' && typeof raw['size'] === 'number'
      ? ok(raw as HostFrame)
      : err('bad room frame');
  if (raw['t'] === 'full') return ok({ t: 'full' });
  if (raw['t'] === 'toast')
    return typeof raw['msg'] === 'string' && raw['msg'].length <= TOAST_MAX
      ? ok(raw as HostFrame)
      : err('bad toast');
  return err('not a host frame');
};

const welcome = (hostName: string, size: number): HostFrame => ({ t: 'welcome', hostName, size });
const lobby = (hostName: string, size: number): HostFrame => ({ t: 'lobby', hostName, size });

const hostCodec: HostCodec<GuestFrame, HostFrame, Room> = {
  decode: decodeGuestFrame,
  welcome: (ctx) => welcome(ctx.myName, ctx.size),
  full: () => ({ t: 'full' }),
};
const guestCodec: GuestCodec<GuestFrame, HostFrame> = {
  decode: decodeHostFrame,
  join: (name) => ({ t: 'join', name }),
};

/** The game only names the room: the id is `peerIdFor(game, code)`, whatever the game. */
const GAME: Game = 'gin-rummy';
const ROOM = peerIdFor(GAME, CODE);
const hostCtx = hostCtxFor<Room>({ size: 100 });

const startHost = (
  w: World,
  ctx: { read: () => HostContext<Room> },
  opts: Partial<HostOptions> = {},
): HostSession<GuestFrame, HostFrame, Room> =>
  new HostSession({ ...w.deps, read: ctx.read, events: w.hostEvents }, hostCodec, {
    game: GAME,
    code: CODE,
    attempt: 1,
    resume: false,
    ...opts,
  });

const startGuest = (
  w: World,
  ctx: { read: () => GuestContext },
  attempt = 1,
): GuestSession<GuestFrame, HostFrame> =>
  new GuestSession({ ...w.deps, read: ctx.read, events: w.guestEvents }, guestCodec, {
    game: GAME,
    code: CODE,
    attempt,
  });

/** A host on the broker that answers a join with a lobby frame, as the legacy host did. */
const hostAnswering = (w: World, size = 100): ReturnType<typeof hostParty> =>
  hostParty(w, ROOM, { welcome: welcome('Ann', size), lobby: lobby('Ann', size) });

// ---------------------------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------------------------

describe('HostSession', () => {
  test('registers under the room id at once without ICE, holds the wake lock, then reports open and persists', () => {
    const w = world();
    startHost(w, cell(hostCtx()));
    expect(w.broker.peers()).toEqual([ROOM]);
    expect(w.log).toEqual([['holdWakeLock']]);
    w.broker.flush();
    expect(w.log).toEqual([['holdWakeLock'], ['status', WAITING_MSG], ['persist']]);
    expect(OPENING_MSG).toBe('Opening room…');
  });

  test('waits for ICE, then checks its ticket: a stale attempt, role or code opens no Peer', async () => {
    const stale = cell(hostCtx({ attempt: 2 }));
    const w = world({ ice: STUN_ONLY });
    startHost(w, stale, { attempt: 1 });
    expect(w.broker.peers()).toEqual([]);
    await settle();
    expect(w.broker.peers()).toEqual([]);
    expect(w.log).toEqual([]);
    const away = cell(hostCtx({ role: null }));
    startHost(world({ ice: STUN_ONLY }), away);
    await settle();
    const other = cell(hostCtx({ code: 'WXYZ' }));
    startHost(world({ ice: STUN_ONLY }), other);
    await settle();
    expect(w.broker.peers()).toEqual([]);
  });

  test('with STUN-only ICE the open status carries the relay hint; a reopened room names the opponent', async () => {
    const w = world({ ice: STUN_ONLY });
    startHost(w, cell(hostCtx()));
    await settle();
    w.broker.flush();
    expect(w.log).toEqual([
      ['holdWakeLock'],
      ['status', `${WAITING_MSG} ${NO_RELAY_HINT}`],
      ['persist'],
    ]);
    const resumed = world({ ice: STUN_ONLY });
    startHost(resumed, cell(hostCtx({ hasGame: true, oppName: 'Jeff' })), { resume: true });
    await settle();
    resumed.broker.flush();
    expect(resumed.log[1]).toEqual([
      'status',
      `Room ${CODE} reopened — waiting for Jeff to rejoin… ${NO_RELAY_HINT}`,
    ]);
    expect(reopenedMsg(CODE, null)).toBe(
      `Room ${CODE} reopened — waiting for your opponent to rejoin…`,
    );
    // A pass-and-play game handed to the room: nobody has joined yet, so the invite is to send.
    const handed = world({ ice: STUN_ONLY });
    startHost(handed, cell(hostCtx({ hasGame: true, oppName: 'Bob', handoff: true })));
    await settle();
    handed.broker.flush();
    expect(handed.log[1]).toEqual(['status', `${handoffMsg(CODE, 'Bob')} ${NO_RELAY_HINT}`]);
    expect(handoffMsg(CODE, null)).toBe(
      `Room ${CODE} is open — send your opponent the invite to carry on this game…`,
    );
    // Once the opponent is connected the open handler only persists.
    const quiet = world();
    startHost(quiet, cell(hostCtx({ oppConnected: true })));
    quiet.broker.flush();
    expect(quiet.log).toEqual([['holdWakeLock'], ['persist']]);
  });

  test('the 10 s watchdog warns when the broker never answers, and not when it did', () => {
    const w = world();
    startHost(w, cell(hostCtx()));
    w.clock.advance(WATCHDOG_MS - 1);
    expect(w.log).toEqual([['holdWakeLock']]);
    w.clock.advance(1);
    expect(w.log).toEqual([['holdWakeLock'], ['status', HOST_WATCHDOG_MSG]]);
    const fine = world();
    startHost(fine, cell(hostCtx()));
    fine.broker.flush();
    fine.clock.advance(WATCHDOG_MS);
    expect(fine.log.map((e) => e[0])).toEqual(['holdWakeLock', 'status', 'persist']);
  });

  test('a dropped broker socket: the network error is shown, then reconnects at 400 ms and the backoff ladder', () => {
    const w = world();
    startHost(w, cell(hostCtx()));
    w.broker.flush();
    const mark = w.log.length;
    w.broker.dropSocket(ROOM);
    w.broker.flush();
    const networkMsg = describePeerError({ type: 'network', message: '' });
    expect(w.since(mark)).toEqual([
      ['status', networkMsg, true],
      ['toast', networkMsg, ERROR_TOAST_MS],
    ]);
    w.clock.advance(RECONNECT_FIRST_MS);
    expect(w.log.at(-1)).toEqual(['status', reconnectingMsg(1)]);
    w.broker.dropSocket(ROOM); // still down
    w.clock.advance(1500);
    expect(w.log.at(-1)).toEqual(['status', reconnectingMsg(2)]);
    w.broker.dropSocket(ROOM);
    w.clock.advance(3000);
    expect(w.log.at(-1)).toEqual(['status', reconnectingMsg(3)]);
    // The reconnect status is not shown once an opponent is connected.
    const connected = world();
    const ctx = cell(hostCtx());
    startHost(connected, ctx);
    connected.broker.flush();
    ctx.value = hostCtx({ oppConnected: true });
    connected.broker.dropSocket(ROOM);
    connected.broker.flush();
    const before = connected.log.length;
    connected.clock.advance(RECONNECT_FIRST_MS);
    expect(connected.since(before)).toEqual([]);
    // A wake-up (visibilitychange / online) retries at once.
    connected.wake.forEach((fn) => {
      fn();
    });
    expect(connected.since(before)).toEqual([]);
    ctx.value = hostCtx();
    connected.broker.dropSocket(ROOM);
    connected.wake.forEach((fn) => {
      fn();
    });
    expect(connected.log.at(-1)).toEqual(['status', reconnectingMsg(2)]);
  });

  test('a waiting room resumed after the host`s page went away: the open status is the waiting one and the save is written again; the guest that was in the lobby comes back through its own retry and is seated again', () => {
    const w = world();
    const first = startHost(w, cell(hostCtx()));
    w.broker.flush();
    const guest = startGuest(w, cell(guestCtx()));
    w.broker.flush();
    expect(w.log).toContainEqual(['frame', { t: 'join', name: 'Jeff' }]);
    // The host's page unloads: its Peer is destroyed and the guest's channel closes with it; the
    // guest reports the loss and arms its rejoin (REJOIN_MS).
    first.close();
    w.broker.flush();
    expect(w.log.map((e) => e[0])).toContain('lost');
    const mark = w.log.length;
    // The page is back: the same code, `resume: true`, no hand dealt. The broker freed the id when
    // the socket closed, so the room registers at once with the waiting status and persists.
    const second = startHost(w, cell(hostCtx()), { resume: true });
    w.broker.flush();
    expect(w.since(mark)).toEqual([['holdWakeLock'], ['status', WAITING_MSG], ['persist']]);
    // The guest's rejoin lands on the resumed room: welcomed, its join reported on the new session.
    pass(w, REJOIN_MS);
    const after = w.since(mark);
    expect(after).toContainEqual(['connected']);
    expect(after).toContainEqual(['frame', { t: 'join', name: 'Jeff' }]);
    second.close();
    guest.close();
  });

  test('unavailable-id: a fresh room restarts with a new code at once; a resumed one toasts and retries after 1.5 s', () => {
    const w = world();
    w.broker.transport().open(ROOM); // the code is taken
    w.broker.flush();
    startHost(w, cell(hostCtx()));
    w.broker.flush();
    expect(w.log).toEqual([['holdWakeLock'], ['restart', null]]);
    expect(w.spy.peers[0]?.peer.destroyed()).toBe(true);
    const resumed = world();
    resumed.broker.transport().open(ROOM);
    resumed.broker.flush();
    startHost(resumed, cell(hostCtx()), { resume: true });
    resumed.broker.flush();
    expect(resumed.log).toEqual([['holdWakeLock'], ['toast', CODE_BUSY_MSG]]);
    resumed.clock.advance(BUSY_RETRY_MS - 1);
    expect(resumed.log).toHaveLength(2);
    resumed.clock.advance(1);
    expect(resumed.log.at(-1)).toEqual(['restart', CODE]);
  });

  test('other Peer errors set the status without its pulse and toast for 5 s', () => {
    const w = world();
    startHost(w, cell(hostCtx()));
    w.broker.flush();
    const mark = w.log.length;
    const error: TransportError = { type: 'server-error', message: 'x' };
    w.spy.peers[0]?.errors.forEach((fn) => {
      fn(error);
    });
    // One handler is the session's; the watchdog and keep-alive register none.
    expect(w.since(mark)).toEqual([
      ['status', describePeerError(error), true],
      ['toast', describePeerError(error), ERROR_TOAST_MS],
    ]);
  });

  test('a guest connects: welcome on open, decoded frames reported, refused frames dropped, send() only while open', () => {
    const w = world();
    const ctx = cell(hostCtx({ size: 75 }));
    const session = startHost(w, ctx);
    w.broker.flush();
    session.send({ t: 'toast', msg: 'nobody there' }); // no channel yet: dropped
    const guest = party(w, undefined);
    w.broker.flush();
    const conn = connectFrom(guest, ROOM);
    w.broker.flush();
    expect(conn.open()).toBe(true);
    expect(guest.received).toEqual([{ t: 'welcome', hostName: 'Ann', size: 75 }]);
    const mark = w.log.length;
    conn.send({ t: 'join', name: 'Jeff' });
    conn.send({ t: 'action', action: { type: 'draw' } });
    conn.send({ t: 'welcome', hostName: 'x', size: 1 }); // a host frame: refused
    conn.send({ t: 'join', name: 'A'.repeat(21) }); // too long: refused
    conn.send('hello'); // not an object: ignored, as the legacy did
    conn.send({ t: 'action', action: {} }); // no type: refused
    w.broker.flush();
    expect(w.since(mark)).toEqual([
      ['frame', { t: 'join', name: 'Jeff' }],
      ['frame', { t: 'action', action: { type: 'draw' } }],
    ]);
    const state: HostFrame = { t: 'lobby', hostName: 'Ann', size: 75 };
    session.send(state);
    w.broker.flush();
    expect(guest.received.at(-1)).toEqual(state);
    session.close();
    w.broker.flush();
    expect(conn.open()).toBe(false);
    expect(w.broker.peers()).toEqual([guest.peer.id()]);
    session.send({ t: 'full' }); // closed: dropped, no throw
  });

  test('the path toast: 1.5 s after the channel opens, direct or relay, only for the current open channel', async () => {
    const w = world({ ice: STUN_ONLY, path: 'relay' });
    startHost(w, cell(hostCtx()));
    await settle();
    w.broker.flush();
    const guest = party(w, undefined);
    w.broker.flush();
    connectFrom(guest, ROOM);
    w.broker.flush();
    const mark = w.log.length;
    w.clock.advance(PATH_TOAST_MS - 1);
    await settle();
    expect(w.since(mark)).toEqual([]);
    w.clock.advance(1);
    await settle();
    expect(w.since(mark)).toEqual([['toast', PATH_RELAY_MSG]]);
    const direct = world({ ice: STUN_ONLY, path: 'direct' });
    startHost(direct, cell(hostCtx()));
    await settle();
    direct.broker.flush();
    const g2 = party(direct, undefined);
    direct.broker.flush();
    const c2 = connectFrom(g2, ROOM);
    direct.broker.flush();
    c2.close();
    direct.broker.flush();
    const m2 = direct.log.length;
    direct.clock.advance(PATH_TOAST_MS);
    await settle();
    // Closed before the probe: nothing (the close itself was reported).
    expect(direct.since(m2)).toEqual([]);
    expect(direct.log.at(-1)).toEqual(['guestGone', null]);
    expect(PATH_DIRECT_MSG).toBe('Connected directly');
  });

  test('a third peer is told the room is full once the first guest is heard, and closed 300 ms later; the first channel stays', () => {
    const w = world();
    startHost(w, cell(hostCtx()));
    w.broker.flush();
    const first = party(w, undefined);
    const third = party(w, undefined);
    w.broker.flush();
    const c1 = connectFrom(first, ROOM);
    w.broker.flush();
    const c3 = connectFrom(third, ROOM);
    w.broker.flush();
    // Held (liveness.ts): the first guest has said nothing since its channel opened, so only its
    // next frame proves it is there. The legacy answered `full` at once.
    expect(third.received).toEqual([]);
    expect(c3.open()).toBe(true);
    c1.send({ t: 'join', name: 'Jeff' });
    w.broker.flush();
    expect(third.received).toEqual([{ t: 'full' }]);
    expect(c3.open()).toBe(true);
    w.clock.advance(FULL_CLOSE_MS - 1);
    w.broker.flush();
    expect(c3.open()).toBe(true);
    w.clock.advance(1);
    w.broker.flush();
    expect(c3.open()).toBe(false);
    expect(c1.open()).toBe(true);
    // Nothing about the third peer reached the app.
    expect(w.log.filter((e) => e[0] === 'guestGone')).toEqual([]);
  });

  test('the guest leaving: guestGone(null) for the current channel only; after a rejoin the stale one is ignored', () => {
    const w = world();
    startHost(w, cell(hostCtx()));
    w.broker.flush();
    const guest = party(w, undefined);
    w.broker.flush();
    const c1 = connectFrom(guest, ROOM);
    w.broker.flush();
    c1.close();
    w.broker.flush();
    expect(w.log.at(-1)).toEqual(['guestGone', null]);
    const mark = w.log.length;
    // The guest comes back on a new channel...
    const c2 = connectFrom(guest, ROOM);
    w.broker.flush();
    expect(guest.received.at(-1)).toEqual({ t: 'welcome', hostName: 'Ann', size: 100 });
    // ...and an error on the old one is ignored, while one on the new one is not.
    const hostConns = w.spy.peers[0]?.conns ?? [];
    expect(hostConns).toHaveLength(2);
    hostConns[0]?.errors.forEach((fn) => {
      fn({ type: 'negotiation-failed', message: '' });
    });
    expect(w.since(mark)).toEqual([]);
    hostConns[1]?.errors.forEach((fn) => {
      fn({ type: 'webrtc', message: '' });
    });
    expect(w.since(mark)).toEqual([['guestGone', null]]);
    expect(c2.open()).toBe(true);
    // The channel is kept (PeerJS closes a failed one itself), but its silence watch stopped with
    // the report: the same guest is not reported gone again at the grace.
    pass(w, HB_GRACE_MS * 2);
    expect(w.since(mark)).toEqual([['guestGone', null]]);
    expect(c2.open()).toBe(true);
  });

  test('negotiation failing before the channel opens, with no hand dealt, reports the ICE-failed text', () => {
    const w = world({ ice: STUN_ONLY });
    const ctx = cell(hostCtx());
    startHost(w, ctx);
    return settle().then(() => {
      w.broker.flush();
      const guest = party(w, undefined);
      w.broker.flush();
      connectFrom(guest, ROOM);
      w.broker.deliverNext(); // the host learns of the connection; neither end is open yet
      const hostConn = w.spy.peers[0]?.conns[0];
      expect(hostConn?.conn.open()).toBe(false);
      const mark = w.log.length;
      hostConn?.errors.forEach((fn) => {
        fn({ type: 'negotiation-failed', message: '' });
      });
      expect(w.since(mark)).toEqual([['guestGone', `${ICE_FAILED_MSG} ${NO_RELAY_HINT}`]]);
      // With a hand dealt (a rejoin that failed) it is an ordinary loss.
      ctx.value = hostCtx({ hasGame: true });
      hostConn?.errors.forEach((fn) => {
        fn({ type: 'negotiation-failed', message: '' });
      });
      expect(w.log.at(-1)).toEqual(['guestGone', null]);
      // A handoff has a hand but nobody has joined it yet: the invited seat's failed attempt is
      // still the ICE-failed text, not an opponent lost.
      ctx.value = hostCtx({ hasGame: true, oppName: 'Bob', handoff: true });
      hostConn?.errors.forEach((fn) => {
        fn({ type: 'negotiation-failed', message: '' });
      });
      expect(w.log.at(-1)).toEqual(['guestGone', `${ICE_FAILED_MSG} ${NO_RELAY_HINT}`]);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Guest
// ---------------------------------------------------------------------------------------------

describe('GuestSession', () => {
  test('opens a Peer without an id once ICE is in hand, checks its ticket, holds the wake lock', async () => {
    const w = world({ ice: STUN_ONLY });
    startGuest(w, cell(guestCtx()));
    expect(w.broker.peers()).toEqual([]);
    await settle();
    expect(w.broker.peers()).toEqual(['fake-peer-1']);
    expect(w.log).toEqual([['holdWakeLock']]);
    const stale = world({ ice: STUN_ONLY });
    startGuest(stale, cell(guestCtx({ attempt: 9 })));
    await settle();
    expect(stale.broker.peers()).toEqual([]);
    const away = world();
    startGuest(away, cell(guestCtx({ role: 'local' })));
    expect(away.broker.peers()).toEqual([]);
    expect(connectingMsg(CODE)).toBe(`Connecting to room ${CODE}…`);
  });

  test('the 10 s watchdog warns when the broker never answers', () => {
    const w = world();
    startGuest(w, cell(guestCtx()));
    w.clock.advance(WATCHDOG_MS);
    expect(w.log).toEqual([['holdWakeLock'], ['status', GUEST_WATCHDOG_MSG]]);
  });

  test('joins: found-the-service status, join frame with the name, connected status, persist, path toast', async () => {
    const w = world({ ice: STUN_ONLY, path: 'direct' });
    const host = hostAnswering(w, 50);
    w.broker.flush();
    const ctx = cell(guestCtx({ myName: 'Zoë 🃏' }));
    const session = startGuest(w, ctx);
    session.send({ t: 'join', name: 'too early' }); // no channel yet: dropped
    await settle();
    w.broker.flush();
    expect(w.log).toEqual([
      ['holdWakeLock'],
      ['status', `Found the service — connecting to room ${CODE}… ${NO_RELAY_HINT}`],
      ['connected'],
      ['status', CONNECTED_MSG],
      ['persist'],
      ['frame', { t: 'welcome', hostName: 'Ann', size: 50 }],
      ['frame', { t: 'lobby', hostName: 'Ann', size: 50 }],
    ]);
    expect(host.received).toEqual([{ t: 'join', name: 'Zoë 🃏' }]);
    const mark = w.log.length;
    w.clock.advance(PATH_TOAST_MS);
    await settle();
    expect(w.since(mark)).toEqual([['toast', PATH_DIRECT_MSG]]);
    // Actions go out while the channel is open; refused host frames are dropped.
    const move: GuestFrame = { t: 'action', action: { type: 'knock' } };
    session.send(move);
    host.conns[0]?.send({ t: 'toast', msg: 'x'.repeat(501) });
    host.conns[0]?.send({ t: 'join', name: 'not from a host' });
    host.conns[0]?.send({ t: 'toast', msg: "It's not your turn." });
    w.broker.flush();
    expect(host.received.at(-1)).toEqual(move);
    expect(w.log.at(-1)).toEqual(['frame', { t: 'toast', msg: "It's not your turn." }]);
    session.close();
    w.broker.flush();
    expect(w.broker.peers()).toEqual([ROOM]);
  });

  test('no host registered: peer-unavailable retries every 3 s, 40 times, then gives up with the not-found text', () => {
    const w = world();
    startGuest(w, cell(guestCtx()));
    w.broker.flush(); // open -> tryJoin(1) -> peer-unavailable
    const statuses = (): ReadonlyArray<unknown> =>
      w.log.filter((e) => e[0] === 'status').map((e) => e[1]);
    expect(statuses()).toEqual([foundServiceMsg(CODE, null)]);
    const tick = (): void => {
      w.clock.advance(JOIN_RETRY_MS - 1);
      w.broker.flush();
      w.clock.advance(1);
      w.broker.flush();
    };
    tick();
    expect(statuses().at(-1)).toBe(retryingMsg(CODE, 2));
    Array.from({ length: MAX_JOIN_TRIES - 3 }).forEach(tick);
    expect(statuses().at(-1)).toBe(retryingMsg(CODE, MAX_JOIN_TRIES - 1));
    expect(statuses()).toHaveLength(MAX_JOIN_TRIES - 1);
    // The 40th connect fails like the others, and that failure is the one that gives up.
    tick();
    expect(statuses().at(-2)).toBe(retryingMsg(CODE, MAX_JOIN_TRIES));
    expect(w.log.at(-1)).toEqual(['status', notFoundMsg(CODE), true]);
    expect(statuses()).toHaveLength(MAX_JOIN_TRIES + 1);
    tick();
    // No further connect is scheduled. One legacy quirk stays: the 40th connect's 12 s stall timer
    // still finds it current, so the stall note replaces the not-found text (3 s tick + 9 s).
    w.clock.advance(STALL_MS - JOIN_RETRY_MS - 1);
    w.broker.flush();
    expect(statuses()).toHaveLength(MAX_JOIN_TRIES + 1);
    w.clock.advance(1);
    expect(w.log.at(-1)).toEqual(['status', stalledMsg(CODE, null)]);
    w.clock.advance(JOIN_RETRY_MS * 5);
    w.broker.flush();
    expect(statuses()).toHaveLength(MAX_JOIN_TRIES + 2);
    expect(w.log.filter((e) => e[0] === 'connected')).toEqual([]);
  });

  test('a host that appears during the retries is joined, and the try counter resets on open', () => {
    const w = world();
    startGuest(w, cell(guestCtx()));
    w.broker.flush();
    w.clock.advance(JOIN_RETRY_MS);
    w.broker.flush();
    hostAnswering(w);
    w.broker.flush();
    w.clock.advance(JOIN_RETRY_MS);
    w.broker.flush();
    expect(w.log.filter((e) => e[0] === 'connected')).toHaveLength(1);
    expect(w.log.at(-1)).toEqual(['frame', { t: 'lobby', hostName: 'Ann', size: 100 }]);
  });

  test('a connect that neither opens nor fails for 12 s gets the stall note; one that opened does not', async () => {
    const w = world({ ice: STUN_ONLY });
    hostAnswering(w);
    w.broker.flush();
    startGuest(w, cell(guestCtx()));
    await settle();
    w.broker.deliverNext(); // the guest Peer opens and connects; the channel is not open yet
    expect(w.log.at(-1)).toEqual(['status', foundServiceMsg(CODE, STUN_ONLY)]);
    w.clock.advance(STALL_MS - 1);
    expect(w.log).toHaveLength(2);
    w.clock.advance(1);
    expect(w.log.at(-1)).toEqual(['status', stalledMsg(CODE, STUN_ONLY)]);
    expect(stalledMsg(CODE, null)).toBe(
      `Room ${CODE} answered but the phones can't reach each other yet… still trying. If this persists, put both phones on the same Wi-Fi or both on mobile data.`,
    );
    w.broker.flush();
    expect(w.log.map((e) => e[0])).toContain('connected');
    const quick = world();
    hostAnswering(quick);
    quick.broker.flush();
    startGuest(quick, cell(guestCtx()));
    quick.broker.flush();
    const mark = quick.log.length;
    quick.clock.advance(STALL_MS);
    expect(quick.since(mark)).toEqual([]);
  });

  test('the channel closing: lost, then a rejoin 1.5 s later; the stale channel is ignored', () => {
    const w = world();
    const host = hostAnswering(w);
    w.broker.flush();
    const ctx = cell(guestCtx());
    const session = startGuest(w, ctx);
    w.broker.flush();
    ctx.value = guestCtx({ oppConnected: true });
    host.conns[0]?.close();
    w.broker.flush();
    expect(w.log.at(-1)).toEqual(['lost']);
    const mark = w.log.length;
    ctx.value = guestCtx();
    w.clock.advance(REJOIN_MS - 1);
    w.broker.flush();
    expect(w.since(mark)).toEqual([]);
    w.clock.advance(1);
    w.broker.flush();
    expect(w.since(mark).map((e) => e[0])).toEqual([
      'status',
      'connected',
      'status',
      'persist',
      'frame',
      'frame',
    ]);
    expect(w.since(mark)[0]).toEqual(['status', foundServiceMsg(CODE, null)]);
    expect(host.conns).toHaveLength(2);
    expect(host.received).toEqual([
      { t: 'join', name: 'Jeff' },
      { t: 'join', name: 'Jeff' },
    ]);
    // An error on the first (closed) channel is still toasted, as the legacy did, but does not
    // touch the status.
    const m2 = w.log.length;
    const guestConns = w.spy.peers[0]?.conns ?? [];
    guestConns[0]?.errors.forEach((fn) => {
      fn({ type: 'negotiation-failed', message: '' });
    });
    expect(w.since(m2)).toEqual([
      ['toast', describePeerError({ type: 'negotiation-failed', message: '' }), ERROR_TOAST_MS],
    ]);
    // Leaving while a rejoin is pending: the timer finds the Peer destroyed and connects nowhere.
    host.conns[1]?.close();
    w.broker.flush();
    expect(w.log.at(-1)).toEqual(['lost']);
    session.close();
    const m3 = w.log.length;
    w.clock.advance(REJOIN_MS);
    w.broker.flush();
    expect(w.since(m3)).toEqual([]);
    expect(host.conns).toHaveLength(2);
  });

  test('negotiation failing before the channel opens: the ICE-failed status without pulse, plus the toast', async () => {
    const w = world({ ice: STUN_ONLY });
    hostAnswering(w);
    w.broker.flush();
    startGuest(w, cell(guestCtx()));
    await settle();
    w.broker.deliverNext(); // the guest Peer opens and connects; the channel is not open yet
    const conn = w.spy.peers[0]?.conns[0];
    expect(conn?.conn.open()).toBe(false);
    const mark = w.log.length;
    conn?.errors.forEach((fn) => {
      fn({ type: 'negotiation-failed', message: '' });
    });
    const text = describePeerError({ type: 'negotiation-failed', message: '' });
    expect(w.since(mark)).toEqual([
      ['status', `${ICE_FAILED_MSG} ${NO_RELAY_HINT}`, true],
      ['toast', text, ERROR_TOAST_MS],
    ]);
    // The stall note does not follow a failed negotiation.
    w.clock.advance(STALL_MS);
    expect(w.log.at(-1)).toEqual(['toast', text, ERROR_TOAST_MS]);
  });

  test('other Peer errors set the status without its pulse and toast for 5 s; a dropped socket reconnects on the ladder', () => {
    const w = world();
    const host = hostAnswering(w);
    w.broker.flush();
    const ctx = cell(guestCtx());
    startGuest(w, ctx);
    w.broker.flush();
    const mark = w.log.length;
    const error: TransportError = { type: 'ssl-unavailable', message: '' };
    w.spy.peers[0]?.errors.forEach((fn) => {
      fn(error);
    });
    expect(w.since(mark)).toEqual([
      ['status', describePeerError(error), true],
      ['toast', describePeerError(error), ERROR_TOAST_MS],
    ]);
    const id = w.spy.peers[0]?.peer.id() ?? '';
    w.broker.dropSocket(id);
    w.broker.flush();
    const m2 = w.log.length;
    // Connected to the host: the reconnect status is not shown...
    ctx.value = guestCtx({ oppConnected: true });
    w.clock.advance(RECONNECT_FIRST_MS);
    expect(w.since(m2)).toEqual([]);
    // ...but it is while waiting.
    ctx.value = guestCtx();
    w.broker.dropSocket(id);
    w.clock.advance(1500);
    expect(w.log.at(-1)).toEqual(['status', reconnectingMsg(2)]);
    // Each reconnect's `open` runs tryJoin, which joins nothing beside the live channel (the
    // legacy opened a second one each time): the live channel stays current, so its closing
    // later is the loss it is.
    w.broker.flush();
    expect(host.conns).toHaveLength(1);
    expect(w.log.filter((e) => e[0] === 'connected')).toHaveLength(1);
    const m3 = w.log.length;
    host.conns[0]?.close();
    w.broker.flush();
    expect(w.since(m3)).toEqual([['lost']]);
    // The broker blinks again while the rejoin is pending: that `open` joins at once (no channel
    // is open), and the rejoin timer then finds the new channel open and joins nothing more.
    w.broker.dropSocket(id);
    w.broker.flush();
    w.clock.advance(RECONNECT_FIRST_MS);
    w.broker.flush();
    expect(host.conns).toHaveLength(2);
    w.clock.advance(REJOIN_MS);
    w.broker.flush();
    expect(host.conns).toHaveLength(2);
    expect(w.log.filter((e) => e[0] === 'connected')).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------------
// Liveness (liveness.ts): what the legacy never had. A party here stands for a peer whose page
// died or froze: its channel stays open and it sends nothing.
// ---------------------------------------------------------------------------------------------

describe('liveness across the sessions', () => {
  test('host: beats the guest every 5 s once the channel is open; 15 s of silence closes it and reports guestGone once; the seat is free again', () => {
    const w = world();
    startHost(w, cell(hostCtx()));
    w.broker.flush();
    const guest = party(w, undefined);
    w.broker.flush();
    const c1 = connectFrom(guest, ROOM);
    w.broker.flush();
    expect(guest.received).toEqual([welcome('Ann', 100)]);
    pass(w, HB_MS - 1);
    expect(guest.received).toHaveLength(1);
    pass(w, 1);
    expect(guest.received).toEqual([welcome('Ann', 100), HEARTBEAT]);
    pass(w, HB_MS);
    expect(guest.received.filter(isHeartbeat)).toHaveLength(2);
    const mark = w.log.length;
    pass(w, HB_GRACE_MS - 2 * HB_MS - 1);
    expect(w.since(mark)).toEqual([]);
    expect(c1.open()).toBe(true);
    pass(w, 1);
    expect(w.since(mark)).toEqual([['guestGone', null]]);
    expect(c1.open()).toBe(false);
    // Nothing more from the dead channel: no third beat, no second verdict.
    pass(w, HB_GRACE_MS * 2);
    expect(w.since(mark)).toEqual([['guestGone', null]]);
    expect(guest.received.filter(isHeartbeat)).toHaveLength(2);
    // The seat is free: the same guest in a new tab is welcomed, not told the room is full.
    const c2 = connectFrom(guest, ROOM);
    w.broker.flush();
    expect(guest.received.at(-1)).toEqual(welcome('Ann', 100));
    expect(c2.open()).toBe(true);
    c2.send({ t: 'join', name: 'Jeff' });
    w.broker.flush();
    expect(w.log.at(-1)).toEqual(['frame', { t: 'join', name: 'Jeff' }]);
  });

  test('host: any inbound frame is life, and a heartbeat never reaches the codec or the app', () => {
    const w = world();
    const seen: unknown[] = [];
    const spying: HostCodec<GuestFrame, HostFrame, Room> = {
      ...hostCodec,
      decode: (raw) => {
        seen.push(raw);
        return hostCodec.decode(raw);
      },
    };
    new HostSession({ ...w.deps, read: cell(hostCtx()).read, events: w.hostEvents }, spying, {
      game: GAME,
      code: CODE,
      attempt: 1,
      resume: false,
    });
    w.broker.flush();
    const guest = party(w, undefined);
    w.broker.flush();
    const conn = connectFrom(guest, ROOM);
    w.broker.flush();
    const mark = w.log.length;
    pass(w, 12_000);
    conn.send(HEARTBEAT);
    w.broker.flush();
    expect(seen).toEqual([]);
    expect(w.since(mark)).toEqual([]);
    // The grace runs from that heartbeat: 15 s more, not 3.
    pass(w, HB_GRACE_MS - 1);
    expect(w.since(mark)).toEqual([]);
    // A game frame is life too (and reaches the codec and the app as ever).
    conn.send({ t: 'join', name: 'Jeff' });
    w.broker.flush();
    expect(seen).toEqual([{ t: 'join', name: 'Jeff' }]);
    expect(w.since(mark)).toEqual([['frame', { t: 'join', name: 'Jeff' }]]);
    pass(w, HB_GRACE_MS - 1);
    expect(w.log.at(-1)).toEqual(['frame', { t: 'join', name: 'Jeff' }]);
    pass(w, 1);
    expect(w.log.at(-1)).toEqual(['guestGone', null]);
    expect(seen).toHaveLength(1);
  });

  test("host: a join while the guest is quiet is held; the guest's next frame makes it a third peer (full, closed 300 ms on); one after HB_MISSED_MS of silence takes the seat at once, the silent channel closed without a guestGone", () => {
    const w = world();
    startHost(w, cell(hostCtx()));
    w.broker.flush();
    const first = party(w, undefined);
    w.broker.flush();
    const cA = connectFrom(first, ROOM);
    w.broker.flush();
    pass(w, HB_MISSED_MS - 1);
    // Silent for 9 999 ms: within a heartbeat's slack, so the newcomer waits for the answer.
    const second = party(w, undefined);
    w.broker.flush();
    const cB = connectFrom(second, ROOM);
    w.broker.flush();
    expect(second.received).toEqual([]);
    expect(cB.open()).toBe(true);
    // The first guest beats: the newcomer was a third peer.
    cA.send(HEARTBEAT);
    w.broker.flush();
    expect(second.received).toEqual([{ t: 'full' }]);
    pass(w, FULL_CLOSE_MS - 1);
    expect(cB.open()).toBe(true);
    pass(w, 1);
    expect(cB.open()).toBe(false);
    expect(cA.open()).toBe(true);
    expect(w.log.filter((e) => e[0] === 'guestGone')).toEqual([]);
    // Silent for 10 s since that beat: the seat is taken by the next join, with no wait.
    pass(w, HB_MISSED_MS - FULL_CLOSE_MS);
    const third = party(w, undefined);
    w.broker.flush();
    const cC = connectFrom(third, ROOM);
    w.broker.flush();
    expect(third.received).toEqual([welcome('Ann', 100)]);
    expect(cC.open()).toBe(true);
    expect(cA.open()).toBe(false);
    expect(w.log.filter((e) => e[0] === 'guestGone')).toEqual([]);
    cC.send({ t: 'join', name: 'Cal' });
    w.broker.flush();
    expect(w.log.at(-1)).toEqual(['frame', { t: 'join', name: 'Cal' }]);
    // The watch is the new channel's alone: its grace, counted from its open, is the one verdict.
    pass(w, HB_GRACE_MS - 1);
    expect(w.log.filter((e) => e[0] === 'guestGone')).toEqual([]);
    pass(w, 1);
    expect(w.log.filter((e) => e[0] === 'guestGone')).toEqual([['guestGone', null]]);
    expect(cC.open()).toBe(false);
  });

  test('host: the returning guest: back 2.3 s after its tab died, held with its join waiting, never told full; seated at HB_MISSED_MS of silence with the join replayed after the welcome', () => {
    const w = world();
    const hctx = cell(hostCtx());
    startHost(w, hctx);
    w.broker.flush();
    const dead = party(w, undefined);
    w.broker.flush();
    const cA = connectFrom(dead, ROOM);
    w.broker.flush();
    cA.send({ t: 'join', name: 'Jeff' });
    w.broker.flush();
    hctx.value = hostCtx({ hasGame: true, oppName: 'Jeff', oppConnected: true });
    // Its last beat, then the tab dies; the same player is back in a new tab 2.3 s later.
    cA.send(HEARTBEAT);
    w.broker.flush();
    const mark = w.log.length;
    pass(w, 2300);
    const back = party(w, undefined);
    w.broker.flush();
    const cB = connectFrom(back, ROOM);
    w.broker.flush();
    cB.send({ t: 'join', name: 'Jeff' });
    cB.send(HEARTBEAT);
    w.broker.flush();
    // Held: nothing to the newcomer, nothing to the app, the old channel still open.
    pass(w, HB_MISSED_MS - 2300 - 1);
    expect(back.received).toEqual([]);
    expect(w.since(mark)).toEqual([]);
    expect(cA.open()).toBe(true);
    // 10 s of silence from the dead tab: the newcomer is seated, the welcome first and the join it
    // sent while it waited right after (the heartbeat it sent was not kept); the dead channel
    // closes with no guestGone, so the host's table never showed the seat empty.
    pass(w, 1);
    expect(back.received).toEqual([welcome('Ann', 100)]);
    expect(w.since(mark)).toEqual([['frame', { t: 'join', name: 'Jeff' }]]);
    expect(cA.open()).toBe(false);
    expect(cB.open()).toBe(true);
    // The new channel is beaten and watched; a frame on it is a frame, the old one says nothing more.
    pass(w, HB_MS);
    expect(back.received).toEqual([welcome('Ann', 100), HEARTBEAT]);
    cB.send({ t: 'action', action: { type: 'draw' } });
    w.broker.flush();
    expect(w.log.at(-1)).toEqual(['frame', { t: 'action', action: { type: 'draw' } }]);
    pass(w, HB_GRACE_MS * 2);
    expect(w.log.filter((e) => e[0] === 'guestGone')).toEqual([['guestGone', null]]);
  });

  test('host: a second join while one is held is a third peer at once; the held one takes the seat the moment the current guest leaves on purpose', () => {
    const w = world();
    startHost(w, cell(hostCtx()));
    w.broker.flush();
    const first = party(w, undefined);
    w.broker.flush();
    const cA = connectFrom(first, ROOM);
    w.broker.flush();
    pass(w, 3000);
    const knock = party(w, undefined);
    w.broker.flush();
    const cB = connectFrom(knock, ROOM);
    w.broker.flush();
    cB.send({ t: 'join', name: 'Kim' });
    w.broker.flush();
    expect(knock.received).toEqual([]);
    // Another peer, before the hold is answered: full, as ever, and closed 300 ms on.
    const extra = party(w, undefined);
    w.broker.flush();
    const cX = connectFrom(extra, ROOM);
    w.broker.flush();
    expect(extra.received).toEqual([{ t: 'full' }]);
    expect(knock.received).toEqual([]);
    pass(w, FULL_CLOSE_MS);
    expect(cX.open()).toBe(false);
    // The current guest leaves (Leave, a reload): the loss is reported, then the held join is
    // seated without further wait, its frames replayed.
    const mark = w.log.length;
    cA.close();
    w.broker.flush();
    expect(w.since(mark)).toEqual([
      ['guestGone', null],
      ['frame', { t: 'join', name: 'Kim' }],
    ]);
    expect(knock.received).toEqual([welcome('Ann', 100)]);
    expect(cB.open()).toBe(true);
    // Nobody is held any more: the probe that waited on the old channel answers nothing at 10 s.
    pass(w, HB_MISSED_MS);
    expect(knock.received).toEqual([welcome('Ann', 100), HEARTBEAT, HEARTBEAT]);
    expect(w.since(mark)).toHaveLength(2);
  });

  test('host: a held join that closes its channel wants no answer; the next join is held afresh', () => {
    const w = world();
    startHost(w, cell(hostCtx()));
    w.broker.flush();
    const first = party(w, undefined);
    w.broker.flush();
    const cA = connectFrom(first, ROOM);
    w.broker.flush();
    pass(w, 2000);
    const knock = party(w, undefined);
    w.broker.flush();
    const cB = connectFrom(knock, ROOM);
    w.broker.flush();
    cB.close();
    w.broker.flush();
    // The first guest beats: nothing is sent anywhere (the knocker is gone, its channel closed).
    cA.send(HEARTBEAT);
    w.broker.flush();
    expect(knock.received).toEqual([]);
    expect(w.log.filter((e) => e[0] === 'guestGone')).toEqual([]);
    // A new knock is held on its own, not refused as a second one.
    pass(w, 1000);
    const again = party(w, undefined);
    w.broker.flush();
    const cC = connectFrom(again, ROOM);
    w.broker.flush();
    expect(again.received).toEqual([]);
    pass(w, HB_MISSED_MS - 1000);
    expect(again.received).toEqual([welcome('Ann', 100)]);
    expect(cC.open()).toBe(true);
    expect(cA.open()).toBe(false);
  });

  test('guest: beats the host every 5 s; a host silent for 15 s is lost and the rejoin follows 1.5 s later on a fresh channel', () => {
    const w = world();
    const host = hostAnswering(w);
    w.broker.flush();
    startGuest(w, cell(guestCtx()));
    w.broker.flush();
    expect(host.received).toEqual([{ t: 'join', name: 'Jeff' }]);
    pass(w, HB_MS);
    expect(host.received).toEqual([{ t: 'join', name: 'Jeff' }, HEARTBEAT]);
    const mark = w.log.length;
    pass(w, HB_GRACE_MS - HB_MS - 1);
    expect(w.since(mark)).toEqual([]);
    expect(host.conns[0]?.open()).toBe(true);
    pass(w, 1);
    expect(w.since(mark)).toEqual([['lost']]);
    expect(host.conns[0]?.open()).toBe(false);
    pass(w, REJOIN_MS - 1);
    expect(w.since(mark)).toEqual([['lost']]);
    pass(w, 1);
    expect(w.since(mark).map((e) => e[0])).toEqual([
      'lost',
      'status',
      'connected',
      'status',
      'persist',
      'frame',
      'frame',
    ]);
    expect(host.conns).toHaveLength(2);
    // The dead channel's beats stopped with the verdict (two went out); the new channel's begin.
    expect(host.received.filter(isHeartbeat)).toHaveLength(2);
    pass(w, HB_MS);
    expect(host.received.filter(isHeartbeat)).toHaveLength(3);
    expect(host.received.at(-1)).toEqual(HEARTBEAT);
  });

  test('host and guest sessions keep each other alive: a minute passes with no loss on either side and no frame surfacing', () => {
    const w = world();
    const hostS = startHost(w, cell(hostCtx()));
    w.broker.flush();
    const guestS = startGuest(w, cell(guestCtx()));
    w.broker.flush();
    const mark = w.log.length;
    pass(w, 60_000);
    expect(w.since(mark)).toEqual([]);
    // The game frames still flow both ways, and only they reach the apps.
    hostS.send({ t: 'toast', msg: 'still here' });
    guestS.send({ t: 'action', action: { type: 'draw' } });
    w.broker.flush();
    expect(w.since(mark)).toEqual([
      ['frame', { t: 'toast', msg: 'still here' }],
      ['frame', { t: 'action', action: { type: 'draw' } }],
    ]);
    // Leaving stops both watches: no verdict ever follows a Leave.
    guestS.close();
    w.broker.flush();
    expect(w.log.at(-1)).toEqual(['guestGone', null]);
    const m2 = w.log.length;
    hostS.close();
    pass(w, HB_GRACE_MS * 2);
    expect(w.since(m2)).toEqual([]);
    expect(w.clock.pending()).toBe(0);
  });

  test('a guest broker blip beside a live channel: the reconnect joins nothing, no lost, no full, no second channel; both keep beating', () => {
    const w = world();
    const hctx = cell(hostCtx());
    startHost(w, hctx);
    w.broker.flush();
    const gctx = cell(guestCtx());
    startGuest(w, gctx);
    w.broker.flush();
    hctx.value = hostCtx({ oppConnected: true, oppName: 'Jeff' });
    gctx.value = guestCtx({ oppConnected: true });
    pass(w, HB_MS * 2);
    const guestId = w.spy.peers[1]?.peer.id() ?? '';
    w.broker.dropSocket(guestId);
    w.broker.flush();
    // The drop itself is shown, as ever (the network error's status and toast); from here on,
    // nothing. 400 ms later the broker is back and `open` runs tryJoin, which finds the channel
    // open and connects nothing (the legacy opened a second channel here, which the host told full).
    const mark = w.log.length;
    pass(w, RECONNECT_FIRST_MS);
    expect(w.since(mark)).toEqual([]);
    expect(w.spy.peers[1]?.conns).toHaveLength(1);
    expect(w.spy.peers[0]?.conns).toHaveLength(1);
    // Settled: both beat on the one channel and nobody is reported anything for a long while.
    pass(w, 60_000);
    expect(w.since(mark)).toEqual([]);
    expect(w.spy.peers[1]?.conns).toHaveLength(1);
  });
});
