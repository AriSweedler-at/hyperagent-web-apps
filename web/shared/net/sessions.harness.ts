// The world the session scenarios run in, shared by three suites (docs/design/shared-shell.md A1):
// sessions.test.ts beside this file drives the shared sessions over a fake codec, and each game's
// net/sessions.test.ts drives its wrappers through the same world to pin its own bytes (peer id,
// welcome, lobby, one refused and one accepted frame). One manual fake broker, one fake clock, a
// scripted ICE loader, and a log of every event the sessions raise, so a scenario reads as the
// legacy page's status and toast sequence. It lives in web/shared/net rather than beside a game
// because the zone rules let a game's net/ reach only shared/net and the transport, clock and peer
// edges; the fake codec stays in the test beside it (a game's suite never sees it).
import type { IceLoader, IceResult, NetDeps } from '../edge/peer.ts';
import { fakeClock, type FakeClock } from '../edge/clock.fake.ts';
import { fakeBroker, type FakeBroker } from '../edge/transport.fake.ts';
import type {
  Connection,
  PeerEvents,
  PeerHandle,
  Transport,
  TransportError,
} from '../edge/transport.ts';
import type { GuestContext, GuestEvents } from './guest.ts';
import type { HostContext, HostEvents } from './host.ts';

/** The room code every scenario opens (its peer id is the game's `peerIdFor(game, CODE)`). */
export const CODE = 'ABCD';
/** An ICE result without a relay: every status then carries the no-relay hint. */
export const STUN_ONLY: IceResult = {
  iceServers: [],
  source: 'fallback',
  hasTurn: false,
  error: null,
};
/** Let the scripted ICE promise resolve (one macrotask). */
export const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Let `ms` pass in `step`s, delivering the broker's queue after each, so a frame a timer sends
 * (a heartbeat, liveness.ts) crosses the wire when it is sent rather than at the end: a silence
 * watch that fired before an undelivered heartbeat would call a lively peer gone.
 */
export const pass = (w: World, ms: number, step = 1000): void => {
  const whole = Math.floor(ms / step);
  Array.from({ length: whole }).forEach(() => {
    w.clock.advance(step);
    w.broker.flush();
  });
  const rest = ms - whole * step;
  if (rest > 0) {
    w.clock.advance(rest);
    w.broker.flush();
  }
};

// ---------------------------------------------------------------------------------------------
// A spy Transport: the fake broker, plus a way to fire the errors it has no reason to emit
// (`negotiation-failed`, an unknown type) on a Peer or a channel, and a log of what was sent.
// ---------------------------------------------------------------------------------------------

export type ConnSpy = Readonly<{ conn: Connection; errors: ((e: TransportError) => void)[] }>;
export type PeerSpy = Readonly<{
  peer: PeerHandle;
  errors: ((e: TransportError) => void)[];
  /** Channels this Peer connected or accepted, in order. */
  conns: ConnSpy[];
}>;

export type SpyTransport = Readonly<{ transport: Transport; peers: PeerSpy[] }>;

export const spyTransport = (base: Transport): SpyTransport => {
  const peers: PeerSpy[] = [];
  const wrapConn = (c: Connection, spy: Readonly<{ conns: ConnSpy[] }>): Connection => {
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

/** One recorded event: its name, then the arguments the session passed. */
export type Event = ReadonlyArray<unknown>;

export type World = Readonly<{
  broker: FakeBroker;
  clock: FakeClock;
  deps: NetDeps;
  spy: SpyTransport;
  /** The `onWake` subscribers (visibilitychange / online), fired by hand. */
  wake: (() => void)[];
  log: Event[];
  /** Recorders for every event; `frame` takes any frame, so a suite plugs in whichever session it drives. */
  hostEvents: HostEvents<unknown>;
  guestEvents: GuestEvents<unknown>;
  /** Everything after `from` entries. */
  since: (from: number) => Event[];
}>;

export type WorldOptions = Readonly<{
  /** The ICE result the loader resolves to; null (the default) is no loader at all. */
  ice?: IceResult | null;
  /** What `describe` reports for a channel's path ('direct' by default). */
  path?: string;
}>;

export const world = (options: WorldOptions = {}): World => {
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
  const hostEvents: HostEvents<unknown> = {
    status: record('status'),
    toast: record('toast'),
    holdWakeLock: record('holdWakeLock'),
    persist: record('persist'),
    restart: record('restart'),
    frame: record('frame'),
    guestGone: record('guestGone'),
  };
  const guestEvents: GuestEvents<unknown> = {
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

// ---------------------------------------------------------------------------------------------
// Contexts: what the sessions read off the app
// ---------------------------------------------------------------------------------------------

/**
 * A host context maker for one room payload (`room` is the game's `X`: gin `{target}`, backgammon
 * `{matchLength, variant}`, the shared suite's fake): Ann hosts CODE on attempt 1 with no hand.
 */
export const hostCtxFor =
  <X>(room: X) =>
  (over: Partial<HostContext<X>> = {}): HostContext<X> => ({
    attempt: 1,
    role: 'host',
    code: CODE,
    myName: 'Ann',
    hasGame: false,
    handoff: false,
    oppName: null,
    oppConnected: false,
    ...room,
    ...over,
  });

/** Jeff joins CODE on attempt 1. */
export const guestCtx = (over: Partial<GuestContext> = {}): GuestContext => ({
  attempt: 1,
  role: 'guest',
  code: CODE,
  myName: 'Jeff',
  oppConnected: false,
  ...over,
});

/** A mutable context the test tweaks as the app would between events. */
export const cell = <T>(initial: T): { value: T; read: () => T } => {
  const c = { value: initial, read: (): T => c.value };
  return c;
};

// ---------------------------------------------------------------------------------------------
// Other parties on the broker, driven by hand
// ---------------------------------------------------------------------------------------------

/** A second party on the broker: a bare Peer and what it received. */
export type Party = Readonly<{ peer: PeerHandle; received: unknown[]; conns: Connection[] }>;

export const party = (w: World, id: string | undefined): Party => {
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

export const connectFrom = (p: Party, peerId: string): Connection => {
  const c = p.peer.connect(peerId);
  p.conns.push(c);
  c.onMessage((data) => p.received.push(data));
  return c;
};

/** What a hand-driven host answers with: its welcome on open, its lobby on a join. */
export type HostAnswer = Readonly<{ welcome: unknown; lobby: unknown }>;

/** A host registered as `room` that answers a join with a lobby frame, as the legacy host did. */
export const hostParty = (w: World, room: string, answer: HostAnswer): Party => {
  const host = party(w, room);
  host.peer.on('connection', (c) => {
    c.onOpen(() => {
      c.send(answer.welcome);
    });
    c.onMessage((data) => {
      if (typeof data === 'object' && data !== null && (data as { t?: unknown }).t === 'join')
        c.send(answer.lobby);
    });
  });
  return host;
};
