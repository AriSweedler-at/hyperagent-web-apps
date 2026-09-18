// Differential session oracle (docs/MIGRATION.md step 9). The wire goldens step 2 reserved for the
// sessions were never recorded, so the legacy `HostSession` / `ClientSession` from the sha256-pinned
// fixture ARE the oracle: every scenario below runs once on the legacy classes and once on the
// typed ones (web/games/fidice/src/net), each over its own fake broker (web/shared/edge/
// transport.fake.ts), fake clock and seeded rng, and the two traces must be deep-equal: the
// sequence of frames every party handed its transport (after PeerJS's BinaryPack round trip,
// `wireClone`), the sequence of events every party reported to its controller, and the host's
// final State. Because both legs share the broker fake, the only code that differs between the
// traces is the session and adapter code itself.
//
// The legacy adapter (`hostTransport` / `clientTransport` in the fixture) reaches PeerJS through
// `globalThis.Peer` and the ICE loader through `globalThis.HyperIce`; both are installed here as
// thin shims over the shared Transport and a scripted ICE result, so the legacy leg runs the
// legacy peerjs section verbatim too. Its relay probe uses the global `setTimeout`, which is the
// one reason this file fakes timers (setTimeout/clearTimeout only); the typed adapter takes the
// Clock by injection.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ClientSession } from '../../web/games/fidice/src/net/client.ts';
import { HostSession, type HostOptions } from '../../web/games/fidice/src/net/host.ts';
import {
  clientTransport,
  hostTransport,
  type IceLoader,
  type IceResult,
  type PeerDeps,
} from '../../web/games/fidice/src/net/peerjs.ts';
import type { Role } from '../../web/games/fidice/src/net/protocol.ts';
import type {
  ClientTransport,
  HostEvents,
  HostTransport,
  SessionEvents,
} from '../../web/games/fidice/src/net/session.ts';
import type { Action, Seat, State } from '../../web/games/fidice/src/domain/types.ts';
import { fakeClock, type FakeClock } from '../../web/shared/edge/clock.fake.ts';
import { fakeBroker, type FakeBroker } from '../../web/shared/edge/transport.fake.ts';
import {
  wireClone,
  type Connection,
  type PeerHandle,
  type Transport,
  type TransportError,
} from '../../web/shared/edge/transport.ts';
import { mulberry32 } from '../../web/shared/lib/rng.ts';
import { loadLegacyFidice } from './fidice.api.ts';

// ---------------------------------------------------------------------------------------------
// Traces
// ---------------------------------------------------------------------------------------------

/** What one party handed its transport, in order; `conn` numbers a host's channels by arrival. */
type SentFrame = Readonly<{ conn?: number; frame: unknown }>;
type Log = { frames: SentFrame[]; events: unknown[][] };
type Trace = Readonly<{
  host: Log;
  clients: Readonly<Record<string, Log>>;
  final: unknown;
  peers: ReadonlyArray<string>;
}>;

const newLog = (): Log => ({ frames: [], events: [] });
const clone = (value: unknown): unknown => wireClone(value);

/** Events wrapped to record; the host's `onInfo` is left out when `withInfo` is false (legacy path). */
const recordedEvents = (log: Log, withInfo: boolean): HostEvents & Partial<SessionEvents> => ({
  onReady: () => {
    log.events.push(['onReady']);
  },
  onState: (state, me) => {
    log.events.push(['onState', clone(state), clone(me)]);
  },
  onError: (message) => {
    log.events.push(['onError', message]);
  },
  onClosed: (reason) => {
    log.events.push(['onClosed', reason]);
  },
  ...(withInfo
    ? {
        onInfo: (message: string) => {
          log.events.push(['onInfo', message]);
        },
      }
    : {}),
});

const clientEvents = (log: Log): SessionEvents => {
  const events = recordedEvents(log, true);
  if (events.onInfo === undefined) throw new Error('unreachable');
  return { ...events, onInfo: events.onInfo };
};

// ---------------------------------------------------------------------------------------------
// A world: one broker, one clock, one rng, per leg
// ---------------------------------------------------------------------------------------------

type Ice = Readonly<{ result: IceResult; path: 'direct' | 'relay' }>;

type HostHandle = Readonly<{
  act: (action: Action) => void;
  addBot: () => void;
  removeBot: (at: Seat) => void;
  renameBot: (at: Seat, name: string) => void;
  setBot: (at: Seat, choice: string) => void;
  hostWatches: (watching: boolean, hostName: string) => void;
  close: () => void;
  snapshot: () => unknown;
}>;

type ClientHandle = Readonly<{
  act: (action: Action) => void;
  close: () => void;
  token: () => string | null;
  /** Put anything on the wire, past the session (a malformed frame). */
  raw: (frame: unknown) => void;
}>;

type World = Readonly<{
  host: (opts: HostOptions, withInfo?: boolean) => HostHandle;
  client: (
    label: string,
    code: string,
    role: Role,
    name: string | null,
    savedToken: string | null,
  ) => ClientHandle;
  /** Deliver everything queued on the broker and let promise chains run. */
  settle: () => Promise<void>;
  /** Move both clocks (the injected one and the global one) forward, then settle. */
  advance: (ms: number) => Promise<void>;
  /** Move the clocks without delivering anything (a broker that stays silent). */
  tick: (ms: number) => void;
  trace: (hostHandle: HostHandle | null) => Trace;
  teardown: () => void;
}>;

const START = 1_700_000_000_000;

type Base = Readonly<{
  broker: FakeBroker;
  clock: FakeClock;
  rng: () => number;
  newId: () => string;
  hostLog: Log;
  clientLogs: Map<string, Log>;
  clientLog: (label: string) => Log;
}>;

const base = (seed: number): Base => {
  const broker = fakeBroker({ delivery: 'manual' });
  const clientLogs = new Map<string, Log>();
  let serial = 0;
  return {
    broker,
    clock: fakeClock(START),
    rng: mulberry32(seed),
    newId: () => {
      serial += 1;
      return `id-${String(serial)}`;
    },
    hostLog: newLog(),
    clientLogs,
    clientLog: (label) => {
      const log = newLog();
      if (clientLogs.has(label)) throw new Error(`duplicate client ${label}`);
      clientLogs.set(label, log);
      return log;
    },
  };
};

const settleOn = async (broker: FakeBroker): Promise<void> => {
  const round = async (n: number): Promise<void> => {
    if (n === 0) return;
    broker.flush();
    await Promise.resolve();
    await Promise.resolve();
    await round(n - 1);
  };
  await round(12);
  if (broker.pending() !== 0) throw new Error('broker did not settle');
};

const common = (
  b: Base,
  hostState: () => unknown,
): Pick<World, 'settle' | 'advance' | 'tick' | 'trace'> => ({
  settle: () => settleOn(b.broker),
  advance: async (ms) => {
    // Timers due within the window fire in due order on both clocks; the legacy relay probe is
    // the only user of the global one. Deliver as they go so a timer's frames leave in order.
    const step = async (left: number): Promise<void> => {
      const slice = Math.min(left, 250);
      if (slice <= 0) return;
      b.clock.advance(slice);
      vi.advanceTimersByTime(slice);
      await settleOn(b.broker);
      await step(left - slice);
    };
    await step(ms);
  },
  tick: (ms) => {
    b.clock.advance(ms);
    vi.advanceTimersByTime(ms);
  },
  trace: () => ({
    host: b.hostLog,
    clients: Object.fromEntries(b.clientLogs),
    final: clone(hostState()),
    peers: b.broker.peers(),
  }),
});

// ---------------------------------------------------------------------------------------------
// Current leg: the typed sessions over the typed adapter over the fake broker
// ---------------------------------------------------------------------------------------------

const recordConnection = (c: Connection, log: Log, conn?: number): Connection => ({
  ...c,
  send: (data) => {
    log.frames.push(conn === undefined ? { frame: clone(data) } : { conn, frame: clone(data) });
    c.send(data);
  },
});

const currentWorld = (seed: number, ice: Ice | null): World => {
  const b = base(seed);
  const iceLoader: IceLoader | null =
    ice === null
      ? null
      : {
          load: () => Promise.resolve(ice.result),
          describe: () => Promise.resolve({ path: ice.path, local: null, remote: null }),
        };
  const deps: PeerDeps = {
    transportFor: () => b.broker.transport(),
    ice: iceLoader,
    clock: b.clock,
  };
  let hostSession: HostSession | null = null;
  const world: World = {
    host: (opts, withInfo = true) => {
      let arrivals = 0;
      const inner = hostTransport(opts.code, deps);
      const transport: HostTransport = {
        ...inner,
        onConnection: (fn) => {
          inner.onConnection((c) => {
            arrivals += 1;
            fn(recordConnection(c, b.hostLog, arrivals));
          });
        },
      };
      const session = new HostSession(
        {
          transport,
          events: recordedEvents(b.hostLog, withInfo),
          clock: b.clock,
          rng: b.rng,
          newId: b.newId,
        },
        opts,
      );
      hostSession = session;
      return {
        act: (a) => {
          session.act(a);
        },
        addBot: () => {
          session.addBot();
        },
        removeBot: (at) => {
          session.removeBot(at);
        },
        renameBot: (at, name) => {
          session.renameBot(at, name);
        },
        setBot: (at, choice) => {
          session.setBot(at, choice);
        },
        hostWatches: (w, n) => {
          session.hostWatches(w, n);
        },
        close: () => {
          session.close();
        },
        snapshot: () => session.snapshot,
      };
    },
    client: (label, code, role, name, savedToken) => {
      const log = b.clientLog(label);
      let conn: Connection | null = null;
      let token: string | null = savedToken;
      const inner = clientTransport(code, deps);
      const transport: ClientTransport = {
        ...inner,
        onOpen: (fn) => {
          inner.onOpen((c) => {
            conn = c;
            fn(recordConnection(c, log));
          });
        },
      };
      const session = new ClientSession(
        {
          transport,
          events: clientEvents(log),
          clock: b.clock,
          rememberToken: (t) => {
            token = t;
            log.events.push(['rememberToken', t]);
          },
        },
        { role, name, savedToken },
      );
      return {
        act: (a) => {
          session.act(a);
        },
        close: () => {
          session.close();
        },
        token: () => token,
        raw: (frame) => {
          if (conn === null) throw new Error(`${label} has no connection`);
          log.frames.push({ frame: clone(frame) });
          conn.send(frame);
        },
      };
    },
    ...common(b, () => hostSession?.snapshot ?? null),
    teardown: () => undefined,
  };
  return world;
};

// ---------------------------------------------------------------------------------------------
// Legacy leg: the fixture's sessions and adapter, with globalThis.Peer / HyperIce shimmed onto
// the same fake broker
// ---------------------------------------------------------------------------------------------

/** The legacy data-channel surface `wrap(c)` in the fixture reads. */
type LegacyDc = Readonly<{
  readonly open: boolean;
  send: (data: unknown) => void;
  on: (event: string, fn: (...args: unknown[]) => void) => void;
  close: () => void;
  peerConnection: unknown;
}>;

/** The legacy session-level connection (`wrap(c)`), as the host and client sessions use it. */
type LegacyConn = Readonly<{
  readonly open: boolean;
  send: (data: unknown) => void;
  onMessage: (fn: (data: unknown) => void) => void;
  onClose: (fn: () => void) => void;
  close: () => void;
}>;

type LegacyHostTransport = Readonly<{
  onOpen: (fn: () => void) => void;
  onError: (fn: (kind: string) => void) => void;
  onConnection: (fn: (c: LegacyConn) => void) => void;
  onInfo: (fn: (message: string) => void) => void;
  close: () => void;
}>;

type LegacyClientTransport = Readonly<{
  onOpen: (fn: (c: LegacyConn) => void) => void;
  onError: (fn: (kind: string) => void) => void;
  onInfo: (fn: (message: string) => void) => void;
  close: () => void;
}>;

type LegacyHost = Readonly<{
  snapshot: State;
  act: (action: Action) => void;
  addBot: () => void;
  removeBot: (at: number) => void;
  renameBot: (at: number, name: string) => void;
  setBot: (at: number, choice: string) => void;
  hostWatches: (watching: boolean, hostName: string) => void;
  close: () => void;
}>;

type LegacyClient = Readonly<{ act: (action: Action) => void; close: () => void }>;

type LegacyNet = Readonly<{
  HostSession: new (
    deps: Readonly<{
      transport: LegacyHostTransport;
      events: HostEvents;
      clock: FakeClock;
      rng: () => number;
      newId: () => string;
    }>,
    opts: HostOptions,
  ) => LegacyHost;
  ClientSession: new (
    deps: Readonly<{
      transport: LegacyClientTransport;
      events: SessionEvents;
      clock: FakeClock;
      rememberToken: (token: string) => void;
    }>,
    opts: Readonly<{ role: Role; name: string | null; savedToken: string | null }>,
  ) => LegacyClient;
  hostTransport: (code: string) => LegacyHostTransport;
  clientTransport: (code: string) => LegacyClientTransport;
  NO_RELAY_INFO: string;
  PATH_PROBE_MS: number;
  AUTO_NEXT_MS: number;
  CONNECT_TIMEOUT_MS: number;
}>;

const legacy = loadLegacyFidice() as unknown as LegacyNet;

const legacyDc = (c: Connection): LegacyDc => ({
  get open() {
    return c.open();
  },
  send: (data) => {
    c.send(data);
  },
  on: (event, fn) => {
    if (event === 'open') {
      c.onOpen(() => {
        fn();
      });
    } else if (event === 'data') {
      c.onMessage((data) => {
        fn(data);
      });
    } else if (event === 'close') {
      c.onClose(() => {
        fn();
      });
    } else if (event === 'error') {
      c.onError((e) => {
        fn(e);
      });
    } else throw new Error(`legacy dc listened for ${event}`);
  },
  close: () => {
    c.close();
  },
  peerConnection: c.peerConnection(),
});

/** `globalThis.Peer` for the fixture: PeerJS's constructor surface over a shared PeerHandle. */
const legacyPeerClass = (transport: Transport): unknown =>
  class LegacyPeer {
    readonly handle: PeerHandle;
    // The fixture passes (id, options) and (peerId, { reliable: true }); the options are the
    // real adapter's concern (web/shared/edge/transport.ts) and are ignored here.
    constructor(id: string | undefined) {
      this.handle = transport.open(id);
    }
    on(event: string, fn: (...args: unknown[]) => void): void {
      if (event === 'open') {
        this.handle.on('open', (id) => {
          fn(id);
        });
      } else if (event === 'connection') {
        this.handle.on('connection', (c) => {
          fn(legacyDc(c));
        });
      } else if (event === 'error') {
        this.handle.on('error', (e: TransportError) => {
          fn(e);
        });
      } else throw new Error(`legacy peer listened for ${event}`);
    }
    connect(peerId: string): LegacyDc {
      return legacyDc(this.handle.connect(peerId));
    }
    destroy(): void {
      this.handle.destroy();
    }
  };

const recordLegacyConn = (c: LegacyConn, log: Log, conn?: number): LegacyConn => ({
  get open() {
    return c.open;
  },
  send: (data) => {
    log.frames.push(conn === undefined ? { frame: clone(data) } : { conn, frame: clone(data) });
    c.send(data);
  },
  onMessage: c.onMessage,
  onClose: c.onClose,
  close: c.close,
});

type Globals = { Peer?: unknown; HyperIce?: unknown };

const legacyWorld = (seed: number, ice: Ice | null): World => {
  const b = base(seed);
  const g = globalThis as Globals;
  const before = { Peer: g.Peer, HyperIce: g.HyperIce };
  g.Peer = legacyPeerClass(b.broker.transport());
  if (ice === null) delete g.HyperIce;
  else
    g.HyperIce = {
      load: () => Promise.resolve(ice.result),
      peerConfig: () => ({ iceServers: ice.result.iceServers, sdpSemantics: 'unified-plan' }),
      describe: () => Promise.resolve({ path: ice.path, local: null, remote: null }),
    };
  let hostSession: LegacyHost | null = null;
  return {
    host: (opts, withInfo = true) => {
      let arrivals = 0;
      const inner = legacy.hostTransport(opts.code);
      const transport: LegacyHostTransport = {
        ...inner,
        onConnection: (fn) => {
          inner.onConnection((c) => {
            arrivals += 1;
            fn(recordLegacyConn(c, b.hostLog, arrivals));
          });
        },
      };
      const session = new legacy.HostSession(
        {
          transport,
          events: recordedEvents(b.hostLog, withInfo),
          clock: b.clock,
          rng: b.rng,
          newId: b.newId,
        },
        opts,
      );
      hostSession = session;
      return {
        act: (a) => {
          session.act(a);
        },
        addBot: () => {
          session.addBot();
        },
        removeBot: (at) => {
          session.removeBot(at);
        },
        renameBot: (at, name) => {
          session.renameBot(at, name);
        },
        setBot: (at, choice) => {
          session.setBot(at, choice);
        },
        hostWatches: (w, n) => {
          session.hostWatches(w, n);
        },
        close: () => {
          session.close();
        },
        snapshot: () => session.snapshot,
      };
    },
    client: (label, code, role, name, savedToken) => {
      const log = b.clientLog(label);
      let conn: LegacyConn | null = null;
      let token: string | null = savedToken;
      const inner = legacy.clientTransport(code);
      const transport: LegacyClientTransport = {
        ...inner,
        onOpen: (fn) => {
          inner.onOpen((c) => {
            conn = c;
            fn(recordLegacyConn(c, log));
          });
        },
      };
      const session = new legacy.ClientSession(
        {
          transport,
          events: clientEvents(log),
          clock: b.clock,
          rememberToken: (t) => {
            token = t;
            log.events.push(['rememberToken', t]);
          },
        },
        { role, name, savedToken },
      );
      return {
        act: (a) => {
          session.act(a);
        },
        close: () => {
          session.close();
        },
        token: () => token,
        raw: (frame) => {
          if (conn === null) throw new Error(`${label} has no connection`);
          log.frames.push({ frame: clone(frame) });
          conn.send(frame);
        },
      };
    },
    ...common(b, () => hostSession?.snapshot ?? null),
    teardown: () => {
      if (before.Peer === undefined) delete g.Peer;
      else g.Peer = before.Peer;
      if (before.HyperIce === undefined) delete g.HyperIce;
      else g.HyperIce = before.HyperIce;
    },
  };
};

// ---------------------------------------------------------------------------------------------
// Scenarios: one script, two legs
// ---------------------------------------------------------------------------------------------

type Scenario = (world: World) => Promise<HostHandle | null>;

const LEGS: ReadonlyArray<readonly [string, (seed: number, ice: Ice | null) => World]> = [
  ['legacy', legacyWorld],
  ['current', currentWorld],
];

/** Run `scenario` on both legs and return both traces (legacy first). */
const runBoth = async (
  seed: number,
  ice: Ice | null,
  scenario: Scenario,
): Promise<Readonly<{ legacy: Trace; current: Trace }>> => {
  const traces = await LEGS.reduce<Promise<Trace[]>>(async (acc, [, make]) => {
    const done = await acc;
    const world = make(seed, ice);
    try {
      const host = await scenario(world);
      return [...done, world.trace(host)];
    } finally {
      world.teardown();
    }
  }, Promise.resolve([]));
  const [legacyTrace, currentTrace] = traces;
  if (legacyTrace === undefined || currentTrace === undefined) throw new Error('two legs');
  return { legacy: legacyTrace, current: currentTrace };
};

const ROLL_CUP: Action = { type: 'roll', cup: true, table: [], intoCup: [] };

const TABLE: HostOptions = {
  code: 'ABCDE',
  lives: 3,
  hostName: 'Host',
  watch: false,
  bots: 0,
  autostart: false,
};

/** Frames of one client's log, `t` tags only. */
const tags = (log: Log): ReadonlyArray<string> =>
  log.frames.map(({ frame }) => (frame as { t?: string }).t ?? '?');
const eventNames = (log: Log): ReadonlyArray<string> => log.events.map((e) => String(e[0]));
const messagesOf = (log: Log, tag: string): ReadonlyArray<string> =>
  log.frames.flatMap(({ frame }) => {
    const f = frame as { t?: string; message?: string };
    return f.t === tag && f.message !== undefined ? [f.message] : [];
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('legacy and typed sessions produce the same frames, events and final state', () => {
  test('a table: open, player and spectator hello, refusals, start, a round, auto-next, token reconnect, close', async () => {
    const script: Scenario = async (world) => {
      const host = world.host(TABLE);
      await world.settle();
      const alice = world.client('alice', 'ABCDE', 'player', 'Alice', null);
      await world.settle();
      const watcher = world.client('watcher', 'ABCDE', 'spectator', null, null);
      await world.settle();
      // Refused: acting before the start, a spectator acting, frames the decoder rejects.
      alice.act({ type: 'bid', rank: 5 });
      watcher.act({ type: 'call' });
      alice.raw({ t: 'act', action: { type: 'bogus' } });
      alice.raw(42);
      await world.settle();
      host.act({ type: 'start' });
      await world.settle();
      host.act(ROLL_CUP);
      alice.act({ type: 'bid', rank: 10 }); // not her turn
      await world.settle();
      host.act({ type: 'bid', rank: 10 });
      await world.settle();
      alice.act({ type: 'peek' });
      alice.act({ type: 'pull', die: 0 });
      alice.act({ type: 'roll', cup: false, table: [0], intoCup: [] });
      alice.act({ type: 'bid', rank: 5 }); // not higher
      alice.act({ type: 'bid', rank: 40 });
      await world.settle();
      host.act({ type: 'call' });
      await world.settle();
      await world.advance(legacy.AUTO_NEXT_MS);
      // Alice's tab reloads: her session closes, a new one sits back down with the token.
      const token = alice.token();
      alice.close();
      await world.settle();
      world.client('alice-again', 'ABCDE', 'player', 'Alice II', token);
      await world.settle();
      host.addBot(); // the game is on: the legacy text says the table is full
      await world.settle();
      host.close();
      await world.settle();
      return host;
    };
    const { legacy: expected, current } = await runBoth(7, null, script);
    expect(current).toEqual(expected);

    // What the oracle trace covers, so a silent regression of the scenario itself is caught too.
    // The host's peer and Alice's first one were destroyed; the guests that stayed are registered.
    expect(expected.peers).toEqual(['fake-peer-2', 'fake-peer-3']);
    expect(tags(expected.clients['alice'] ?? newLog())).toEqual([
      'hello',
      'act',
      'act',
      '?',
      'act',
      'act',
      'act',
      'act',
      'act',
      'act',
    ]);
    expect(tags(expected.clients['watcher'] ?? newLog())).toEqual(['hello', 'act']);
    expect(tags(expected.clients['alice-again'] ?? newLog())).toEqual(['hello']);
    expect(messagesOf(expected.host, 'error')).toEqual([
      'The game has not started.',
      'Spectators cannot act.',
      'Unknown action type: bogus',
      'Message must be an object.',
      "It's not your turn.",
      'Your bid must be higher than the current bid.',
    ]);
    expect(messagesOf(expected.host, 'info')).toEqual([]);
    expect(
      expected.host.frames.filter(({ frame }) => (frame as { t: string }).t === 'state').length,
    ).toBeGreaterThan(20);
    // Alice: seated (+ the watcher's arrival), three refusals before the start, the start and the
    // host's roll, not her turn, the host's bid and her peek/pull/roll, not higher, her bid, the
    // reveal (two broadcasts: the call and the auto-next schedule) and round 2. Legacy quirk,
    // preserved: closing one's own session fires the channel's close locally, so a guest that
    // leaves hears "The host closed the table." too.
    expect(eventNames(expected.clients['alice'] ?? newLog())).toEqual([
      'onReady',
      'rememberToken',
      'onState',
      'onState',
      'onError',
      'onError',
      'onError',
      'onState',
      'onState',
      'onError',
      'onState',
      'onState',
      'onState',
      'onState',
      'onError',
      'onState',
      'onState',
      'onState',
      'onState',
      'onClosed',
    ]);
    // The reconnect is one broadcast; the saved token is the one the host reissues, so nothing
    // is remembered again; the refused addBot commits nothing; then the host closes the table.
    expect(eventNames(expected.clients['alice-again'] ?? newLog())).toEqual([
      'onReady',
      'onState',
      'onClosed',
    ]);
    expect(eventNames(expected.clients['watcher'] ?? newLog()).at(-1)).toBe('onClosed');
    expect((expected.clients['watcher'] ?? newLog()).events.at(-1)).toEqual([
      'onClosed',
      'The host closed the table.',
    ]);
    const final = expected.final as State;
    expect(final.phase).toBe('playing');
    expect(final.roundNo).toBe(2);
    expect(final.players.map((p) => [p.name, p.connected])).toEqual([
      ['Host', true],
      ['Alice II', true],
    ]);
    expect(final.spectators).toBe(1);
    expect(expected.host.events.filter((e) => e[0] === 'onError')).toEqual([
      ['onError', 'Table is full.'],
    ]);
  });

  test('a lobby: bots seated, renamed, reconfigured and removed; the host stands up and sits down; a guest leaves', async () => {
    const script: Scenario = async (world) => {
      const host = world.host({ ...TABLE, code: 'LOBBY', bots: 1 });
      await world.settle();
      host.addBot();
      host.renameBot(1, 'Robo');
      host.renameBot(1, '   '); // an empty name is refused silently
      host.setBot(2, 'profiler');
      host.setBot(0, 'profiler'); // not a bot
      host.hostWatches(true, 'Host');
      host.hostWatches(false, 'Hosty'); // the host sits back down at seat 0
      await world.settle();
      const bob = world.client('bob', 'LOBBY', 'player', 'Bob', null);
      await world.settle();
      host.removeBot(2);
      await world.settle();
      bob.close();
      await world.settle();
      bob.act({ type: 'start' }); // closed: nothing leaves
      host.act({ type: 'start' });
      await world.settle();
      return host;
    };
    const { legacy: expected, current } = await runBoth(11, null, script);
    expect(current).toEqual(expected);
    const final = expected.final as State;
    expect(final.phase).toBe('playing');
    // The host sits back down at seat 0; one of the two bots was removed (the legacy seat
    // arithmetic after stand-up/sit-down is whatever it is: both legs agree on it above).
    expect(final.players.map((p) => p.bot !== null)).toEqual([false, true]);
    expect(final.players[0]?.name).toBe('Hosty');
    expect(final.hostSeat).toBe(0);
    // Seated, then the bot removal; the trailing onClosed is the legacy self-close quirk above.
    expect(eventNames(expected.clients['bob'] ?? newLog())).toEqual([
      'onReady',
      'rememberToken',
      'onState',
      'onState',
      'onClosed',
    ]);
  });

  test('bots only: autostart with four bots, timers drive the game to its end', async () => {
    const script: Scenario = async (world) => {
      const host = world.host({
        code: 'BOTSY',
        lives: 2,
        hostName: 'Host',
        watch: true,
        bots: 4,
        autostart: true,
      });
      await world.settle();
      const watcher = world.client('watcher', 'BOTSY', 'spectator', null, null);
      await world.settle();
      // Bot delays and auto-next are timers on the injected clock; run until the game is over.
      const play = async (left: number): Promise<void> => {
        if (left === 0 || (host.snapshot() as State).phase === 'over') return;
        await world.advance(1000);
        await play(left - 1);
      };
      await play(400);
      watcher.close();
      await world.settle();
      host.close();
      return host;
    };
    const { legacy: expected, current } = await runBoth(23, null, script);
    expect(current).toEqual(expected);
    const final = expected.final as State;
    expect(final.phase).toBe('over');
    expect(final.winner).not.toBeNull();
    expect(final.roundNo).toBeGreaterThan(3);
    expect(final.hostSeat).toBeNull();
    expect(expected.host.events.filter((e) => e[0] === 'onState').length).toBeGreaterThan(30);
    expect(
      expected.host.events
        .filter((e) => e[0] === 'onState')
        .every((e) => (e[2] as { role: string }).role === 'spectator'),
    ).toBe(true);
  });

  test('ICE: no relay configured is announced to the host; a relayed path is announced to the guest', async () => {
    const ice: Ice = {
      result: {
        iceServers: [{ urls: 'stun:stun.example:3478' }],
        source: 'remote',
        hasTurn: false,
        error: null,
      },
      path: 'relay',
    };
    const script: Scenario = async (world) => {
      const host = world.host({ ...TABLE, code: 'ICEIC' });
      await world.settle();
      world.client('guest', 'ICEIC', 'player', 'Guest', null);
      await world.settle();
      await world.advance(legacy.PATH_PROBE_MS);
      host.close();
      await world.settle();
      return host;
    };
    const { legacy: expected, current } = await runBoth(3, ice, script);
    expect(current).toEqual(expected);
    expect(expected.host.events.slice(0, 3)).toEqual([
      ['onReady'],
      expect.arrayContaining(['onState']) as unknown,
      ['onInfo', legacy.NO_RELAY_INFO],
    ]);
    expect(eventNames(expected.clients['guest'] ?? newLog())).toEqual([
      'onReady',
      'rememberToken',
      'onState',
      'onInfo',
      'onClosed',
    ]);
    expect((expected.clients['guest'] ?? newLog()).events[3]).toEqual([
      'onInfo',
      'Connected via relay',
    ]);
  });

  test('ICE without onInfo on the host: the advisory lands on onError, as the legacy fallback did', async () => {
    const ice: Ice = {
      result: {
        iceServers: [],
        source: 'fallback',
        hasTurn: false,
        error: 'ICE endpoint timed out',
      },
      path: 'direct',
    };
    const script: Scenario = async (world) => {
      const host = world.host({ ...TABLE, code: 'NOINF' }, false);
      await world.settle();
      world.client('guest', 'NOINF', 'player', 'Guest', null);
      await world.settle();
      await world.advance(legacy.PATH_PROBE_MS);
      return host;
    };
    const { legacy: expected, current } = await runBoth(5, ice, script);
    expect(current).toEqual(expected);
    expect(expected.host.events).toContainEqual(['onError', legacy.NO_RELAY_INFO]);
    expect(eventNames(expected.clients['guest'] ?? newLog())).not.toContain('onInfo');
  });

  test('failures: a code nobody hosts, and a broker that never answers within the connect timeout', async () => {
    const script: Scenario = async (world) => {
      world.client('lost', 'NOONE', 'player', 'Lost', null);
      await world.settle();
      const slow = world.client('slow', 'NOONE', 'player', 'Slow', null);
      world.tick(legacy.CONNECT_TIMEOUT_MS);
      await world.settle();
      slow.act({ type: 'start' });
      slow.close();
      await world.settle();
      return null;
    };
    const { legacy: expected, current } = await runBoth(9, null, script);
    expect(current).toEqual(expected);
    const unreachable =
      "Could not reach the host. Make sure their tab is still open, then try again — and if you're on a different network than the host, a relay (TURN) must be configured.";
    // Legacy quirk, preserved: the broker's refusal does not cancel the connect timeout, so a
    // guest with a wrong code reports onClosed twice (the controller's teardown is idempotent).
    expect((expected.clients['lost'] ?? newLog()).events).toEqual([
      ['onClosed', 'No lobby found with that code. Check the code with your host.'],
      ['onClosed', unreachable],
    ]);
    expect((expected.clients['slow'] ?? newLog()).events[0]).toEqual(['onClosed', unreachable]);
    expect(expected.final).toBeNull();
  });
});
