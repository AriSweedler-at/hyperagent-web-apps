// The host and guest sessions over the fake broker and the fake clock: every status and toast the
// legacy page wrote, the frames it sent, the netAttempt ticket, and the retry schedules (10 s
// watchdog, 40 x 3 s joins, 1.5 s rejoin, 12 s stall note, 1.5 s path toast, 400 ms then
// min(15000, 1500 * tries) broker reconnects, 1.5 s busy-code retry, 300 ms full close). The
// wire corpus replay is test/parity/gin.sessions.test.ts.
import { describe, expect, test } from 'vitest';

import { fakeClock, type FakeClock } from '../../../../shared/edge/clock.fake.ts';
import { fakeBroker, type FakeBroker } from '../../../../shared/edge/transport.fake.ts';
import type {
  Connection,
  PeerEvents,
  PeerHandle,
  Transport,
  TransportError,
} from '../../../../shared/edge/transport.ts';
import { GIN_PEER_PREFIX } from '../../../../shared/lib/roomCode.ts';
import type { GuestFrame, HostFrame } from '../protocol.ts';
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
  type GuestContext,
  type GuestEvents,
} from './guest.ts';
import {
  BUSY_RETRY_MS,
  CODE_BUSY_MSG,
  ERROR_TOAST_MS,
  FULL_CLOSE_MS,
  HOST_WATCHDOG_MSG,
  HostSession,
  OPENING_MSG,
  WAITING_MSG,
  handoffMsg,
  reconnectingMsg,
  reopenedMsg,
  type HostContext,
  type HostEvents,
  type HostOptions,
} from './host.ts';
import {
  ICE_FAILED_MSG,
  NO_RELAY_HINT,
  PATH_DIRECT_MSG,
  PATH_RELAY_MSG,
  PATH_TOAST_MS,
  RECONNECT_FIRST_MS,
  WATCHDOG_MS,
  describePeerError,
  type IceLoader,
  type IceResult,
  type NetDeps,
} from '../../../../shared/edge/peer.ts';

const CODE = 'ABCD';
const ROOM = `${GIN_PEER_PREFIX}${CODE}`;
const STUN_ONLY: IceResult = { iceServers: [], source: 'fallback', hasTurn: false, error: null };
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// ---------------------------------------------------------------------------------------------
// A spy Transport: the fake broker, plus a way to fire the errors it has no reason to emit
// (`negotiation-failed`, an unknown type) on a Peer or a channel, and a log of what was sent.
// ---------------------------------------------------------------------------------------------

type ConnSpy = Readonly<{ conn: Connection; errors: ((e: TransportError) => void)[] }>;
type PeerSpy = Readonly<{
  peer: PeerHandle;
  errors: ((e: TransportError) => void)[];
  /** Channels this Peer connected or accepted, in order. */
  conns: ConnSpy[];
}>;

const spyTransport = (base: Transport): Readonly<{ transport: Transport; peers: PeerSpy[] }> => {
  const peers: PeerSpy[] = [];
  const wrapConn = (c: Connection, spy: { conns: ConnSpy[] }): Connection => {
    const errors: ((e: TransportError) => void)[] = [];
    const wrapped: Connection = {
      ...c,
      onError: (fn) => {
        errors.push(fn);
        c.onError(fn);
      },
    };
    spy.conns.push({ conn: wrapped, errors });
    return wrapped;
  };
  const transport: Transport = {
    open: (id) => {
      const p = base.open(id);
      const spy: PeerSpy = { peer: p, errors: [], conns: [] };
      const wrapped: PeerHandle = {
        ...p,
        on: <K extends keyof PeerEvents>(event: K, fn: PeerEvents[K]): void => {
          if (event === 'error') spy.errors.push(fn as PeerEvents['error']);
          if (event === 'connection') {
            p.on('connection', (c) => {
              (fn as PeerEvents['connection'])(wrapConn(c, spy));
            });
            return;
          }
          p.on(event, fn);
        },
        connect: (peerId) => wrapConn(p.connect(peerId), spy),
      };
      peers.push({ ...spy, peer: wrapped });
      return wrapped;
    },
  };
  return { transport, peers };
};

// ---------------------------------------------------------------------------------------------
// A world: one manual broker, one clock, a scripted ICE loader, recorded events
// ---------------------------------------------------------------------------------------------

type Event = ReadonlyArray<unknown>;

type World = Readonly<{
  broker: FakeBroker;
  clock: FakeClock;
  deps: NetDeps;
  spy: ReturnType<typeof spyTransport>;
  wake: (() => void)[];
  log: Event[];
  hostEvents: HostEvents;
  guestEvents: GuestEvents;
  /** Everything after `from` entries. */
  since: (from: number) => Event[];
}>;

type WorldOptions = Readonly<{ ice?: IceResult | null; path?: string }>;

const world = (options: WorldOptions = {}): World => {
  const broker = fakeBroker({ delivery: 'manual' });
  const clock = fakeClock();
  const spy = spyTransport(broker.transport());
  const wake: (() => void)[] = [];
  const iceResult = options.ice === undefined ? null : options.ice;
  const ice: IceLoader | null =
    iceResult === null
      ? null
      : {
          load: () => Promise.resolve(iceResult),
          describe: () => Promise.resolve({ path: options.path ?? 'direct' }),
        };
  const log: Event[] = [];
  const record =
    (name: string) =>
    (...args: ReadonlyArray<unknown>): void => {
      log.push([name, ...args]);
    };
  const hostEvents: HostEvents = {
    status: record('status'),
    toast: record('toast'),
    holdWakeLock: record('holdWakeLock'),
    persist: record('persist'),
    restart: record('restart'),
    frame: record('frame'),
    guestGone: record('guestGone'),
  };
  const guestEvents: GuestEvents = {
    status: record('status'),
    toast: record('toast'),
    holdWakeLock: record('holdWakeLock'),
    persist: record('persist'),
    connected: record('connected'),
    frame: record('frame'),
    lost: record('lost'),
  };
  return {
    broker,
    clock,
    deps: { transportFor: () => spy.transport, ice, clock, onWake: (fn) => wake.push(fn) },
    spy,
    wake,
    log,
    hostEvents,
    guestEvents,
    since: (from) => log.slice(from),
  };
};

const hostCtx = (over: Partial<HostContext> = {}): HostContext => ({
  attempt: 1,
  role: 'host',
  code: CODE,
  myName: 'Ann',
  target: 100,
  hasGame: false,
  handoff: false,
  oppName: null,
  oppConnected: false,
  ...over,
});

const guestCtx = (over: Partial<GuestContext> = {}): GuestContext => ({
  attempt: 1,
  role: 'guest',
  code: CODE,
  myName: 'Jeff',
  oppConnected: false,
  ...over,
});

/** A mutable context the test tweaks as the app would between events. */
const cell = <T>(initial: T): { value: T; read: () => T } => {
  const c = { value: initial, read: (): T => c.value };
  return c;
};

const startHost = (
  w: World,
  ctx: { read: () => HostContext },
  opts: Partial<HostOptions> = {},
): HostSession =>
  new HostSession(
    { ...w.deps, read: ctx.read, events: w.hostEvents },
    { code: CODE, attempt: 1, resume: false, ...opts },
  );

const startGuest = (w: World, ctx: { read: () => GuestContext }, attempt = 1): GuestSession =>
  new GuestSession({ ...w.deps, read: ctx.read, events: w.guestEvents }, { code: CODE, attempt });

/** A second party on the broker, driven by hand: a bare Peer and what it received. */
type Party = Readonly<{ peer: PeerHandle; received: unknown[]; conns: Connection[] }>;
const party = (w: World, id: string | undefined): Party => {
  const peer = w.broker.transport().open(id);
  const received: unknown[] = [];
  const conns: Connection[] = [];
  const listen = (c: Connection): void => {
    conns.push(c);
    c.onMessage((data) => received.push(data));
  };
  peer.on('connection', listen);
  return { peer, received, conns };
};
const connectFrom = (p: Party, peerId: string): Connection => {
  const c = p.peer.connect(peerId);
  p.conns.push(c);
  c.onMessage((data) => p.received.push(data));
  return c;
};

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
    const ctx = cell(hostCtx({ target: 75 }));
    const session = startHost(w, ctx);
    w.broker.flush();
    session.send({ t: 'toast', msg: 'nobody there' }); // no channel yet: dropped
    const guest = party(w, undefined);
    w.broker.flush();
    const conn = connectFrom(guest, ROOM);
    w.broker.flush();
    expect(conn.open()).toBe(true);
    expect(guest.received).toEqual([{ t: 'welcome', hostName: 'Ann', target: 75 }]);
    const mark = w.log.length;
    conn.send({ t: 'join', name: 'Jeff' });
    conn.send({ t: 'action', action: { type: 'drawStock' } });
    conn.send({ t: 'welcome', hostName: 'x', target: 1 }); // a host frame: refused
    conn.send({ t: 'join', name: 'A'.repeat(21) }); // too long: refused
    conn.send('hello'); // not an object: ignored, as the legacy did
    conn.send({ t: 'action', action: { type: 'setMelds' } }); // no melds key: refused (step 10)
    w.broker.flush();
    expect(w.since(mark)).toEqual([
      ['frame', { t: 'join', name: 'Jeff' }],
      ['frame', { t: 'action', action: { type: 'drawStock' } }],
    ]);
    const state: HostFrame = { t: 'lobby', hostName: 'Ann', target: 75 };
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

  test('a third peer is told the room is full and closed 300 ms later; the first channel stays', () => {
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
    expect(guest.received.at(-1)).toEqual({ t: 'welcome', hostName: 'Ann', target: 100 });
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

/** A host on the broker that answers a join with a lobby frame, as the legacy host did. */
const hostParty = (w: World, target = 100): Party => {
  const host = party(w, ROOM);
  host.peer.on('connection', (c) => {
    c.onOpen(() => {
      c.send({ t: 'welcome', hostName: 'Ann', target });
    });
    c.onMessage((data) => {
      if (typeof data === 'object' && data !== null && (data as { t?: unknown }).t === 'join')
        c.send({ t: 'lobby', hostName: 'Ann', target });
    });
  });
  return host;
};

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
    const host = hostParty(w, 50);
    w.broker.flush();
    const ctx = cell(guestCtx({ myName: 'Zoë 🃏' }));
    const session = startGuest(w, ctx);
    await settle();
    w.broker.flush();
    expect(w.log).toEqual([
      ['holdWakeLock'],
      ['status', `Found the service — connecting to room ${CODE}… ${NO_RELAY_HINT}`],
      ['connected'],
      ['status', CONNECTED_MSG],
      ['persist'],
      ['frame', { t: 'welcome', hostName: 'Ann', target: 50 }],
      ['frame', { t: 'lobby', hostName: 'Ann', target: 50 }],
    ]);
    expect(host.received).toEqual([{ t: 'join', name: 'Zoë 🃏' }]);
    const mark = w.log.length;
    w.clock.advance(PATH_TOAST_MS);
    await settle();
    expect(w.since(mark)).toEqual([['toast', PATH_DIRECT_MSG]]);
    // Actions go out while the channel is open; refused host frames are dropped.
    const move: GuestFrame = { t: 'action', action: { type: 'knock', cardId: '6S' } };
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
    hostParty(w);
    w.broker.flush();
    w.clock.advance(JOIN_RETRY_MS);
    w.broker.flush();
    expect(w.log.filter((e) => e[0] === 'connected')).toHaveLength(1);
    expect(w.log.at(-1)).toEqual(['frame', { t: 'lobby', hostName: 'Ann', target: 100 }]);
  });

  test('a connect that neither opens nor fails for 12 s gets the stall note; one that opened does not', async () => {
    const w = world({ ice: STUN_ONLY });
    hostParty(w);
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
    hostParty(quick);
    quick.broker.flush();
    startGuest(quick, cell(guestCtx()));
    quick.broker.flush();
    const mark = quick.log.length;
    quick.clock.advance(STALL_MS);
    expect(quick.since(mark)).toEqual([]);
  });

  test('the channel closing: lost, then a rejoin 1.5 s later; the stale channel is ignored', () => {
    const w = world();
    const host = hostParty(w);
    w.broker.flush();
    const ctx = cell(guestCtx());
    startGuest(w, ctx);
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
  });

  test('negotiation failing before the channel opens: the ICE-failed status without pulse, plus the toast', async () => {
    const w = world({ ice: STUN_ONLY });
    hostParty(w);
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
    hostParty(w);
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
  });
});
