// Parity of web/shared/edge/ice.ts with legacy/shared/ice.js (docs/MIGRATION.md step 5). The
// legacy IIFE is evaluated in a node:vm sandbox whose `window`, `location`, `fetch`, `Date.now`,
// `setTimeout`/`clearTimeout` are stand-ins driven by the same fake clock and fetch stubs the port
// receives, so both see identical inputs and their outputs must deep-equal: success in both payload
// shapes, HTTP 500, network error, timeout, malformed body, empty URL, cache hit within 10 min vs
// miss after, force: true, ?ice= override, plus describe(pc) and watch(pc, cb).
import { runInNewContext } from 'node:vm';

import { describe, expect, test } from 'vitest';

import { readRepoFile } from '../../tools/legacy/extract.ts';
import { fakeClock, type FakeClock } from '../../web/shared/edge/clock.fake.ts';
import {
  createIce,
  type FetchLike,
  type Ice,
  type IceLoadOptions,
  type IceResult,
  type PathDescription,
  type PeerConnectionLike,
  type StatLike,
} from '../../web/shared/edge/ice.ts';

const LEGACY_SOURCE = readRepoFile('legacy/shared/ice.js');

// ---------------------------------------------------------------------------------------------
// A legacy HyperIce instance bound to a fake clock, a fetch stub and a query string.
// ---------------------------------------------------------------------------------------------
type LegacyIce = Readonly<{
  load: (opts?: IceLoadOptions) => Promise<IceResult>;
  peerConfig: (result: IceResult | null | undefined) => unknown;
  describe: (pc: unknown) => Promise<PathDescription>;
  watch: (pc: unknown, cb: (states: unknown) => void) => () => void;
  FALLBACK_ICE: unknown;
}>;

type World = Readonly<{
  clock: FakeClock;
  fetch: FetchLike;
  search: string;
  /** Replaces the ICE_CONFIG_URL literal (and the port's `endpoint` dep) when set. */
  endpoint?: string;
}>;

const loadLegacy = (world: World): LegacyIce => {
  const source =
    world.endpoint === undefined
      ? LEGACY_SOURCE
      : LEGACY_SOURCE.replace(
          "var ICE_CONFIG_URL = 'https://turn.sweedler.com';",
          `var ICE_CONFIG_URL = ${JSON.stringify(world.endpoint)};`,
        );
  expect(source).toContain('var ICE_CONFIG_URL = ');
  const window: Record<string, unknown> = {};
  const sandbox = {
    window,
    location: { search: world.search },
    fetch: world.fetch,
    setTimeout: world.clock.setTimeout,
    clearTimeout: world.clock.clearTimeout,
    Date: { now: world.clock.now },
    AbortController,
    URLSearchParams,
  };
  runInNewContext(source, sandbox, { filename: 'legacy/shared/ice.js' });
  const api = window['HyperIce'];
  if (api === undefined) throw new Error('legacy IIFE did not install window.HyperIce');
  return api as LegacyIce;
};

const loadPort = (world: World): Ice =>
  createIce({
    fetch: world.fetch,
    clock: world.clock,
    search: () => world.search,
    ...(world.endpoint === undefined ? {} : { endpoint: world.endpoint }),
  });

/** Realm-neutral view of a result: vm objects have foreign prototypes, so compare their JSON. */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

// ---------------------------------------------------------------------------------------------
// Fetch stubs (script the responses in order; each call consumes one)
// ---------------------------------------------------------------------------------------------
type Scripted = (signal: AbortSignal) => Promise<Awaited<ReturnType<FetchLike>>>;

const scriptedFetch = (
  steps: ReadonlyArray<Scripted>,
): Readonly<{ fetch: FetchLike; calls: ReadonlyArray<string> }> => {
  const calls: string[] = [];
  return {
    calls,
    fetch: (url, init) => {
      const step = steps[calls.length];
      calls.push(url);
      if (step === undefined) throw new Error(`unexpected fetch #${String(calls.length)} ${url}`);
      return step(init.signal);
    },
  };
};

const json =
  (body: unknown, status = 200): Scripted =>
  () =>
    Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
const malformed: Scripted = () =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON at position 0')),
  });
const network: Scripted = () => Promise.reject(new TypeError('Failed to fetch'));
const hanging: Scripted = (signal) =>
  new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      reject(signal.reason as Error);
    });
  });

const TURN = { urls: 'turn:relay.example:3478', username: 'u', credential: 'c' };
const STUN = { urls: ['stun:stun.example:3478'] };

/** Run `scenario` against both implementations with separate but identically scripted worlds. */
const both = async <T>(
  steps: ReadonlyArray<Scripted>,
  scenario: (ice: LegacyIce | Ice, clock: FakeClock) => Promise<T>,
  search = '',
  endpoint?: string,
): Promise<readonly [T, T, ReadonlyArray<string>, ReadonlyArray<string>]> => {
  const legacyWorld = {
    clock: fakeClock(1_000_000),
    ...scriptedFetch(steps),
    search,
    ...(endpoint === undefined ? {} : { endpoint }),
  };
  const portWorld = {
    clock: fakeClock(1_000_000),
    ...scriptedFetch(steps),
    search,
    ...(endpoint === undefined ? {} : { endpoint }),
  };
  const legacy = await scenario(loadLegacy(legacyWorld), legacyWorld.clock);
  const port = await scenario(loadPort(portWorld), portWorld.clock);
  return [legacy, port, legacyWorld.calls, portWorld.calls] as const;
};

describe('load', () => {
  test.each([
    ['success, bare array with TURN', [json([TURN, STUN])]],
    ['success, {iceServers} STUN only', [json({ iceServers: [STUN] })]],
    ['success, entries without urls are dropped', [json([null, { urls: 1 }, STUN, {}])]],
    ['HTTP 500', [json(null, 500)]],
    ['network error', [network]],
    ['malformed body', [malformed]],
    ['wrong shape', [json({ nope: true })]],
    ['empty list', [json([])]],
  ] as const)('%s', async (_name, steps) => {
    const [legacy, port, legacyCalls, portCalls] = await both(steps, (ice) => ice.load());
    expect(plain(port)).toEqual(plain(legacy));
    expect(portCalls).toEqual(legacyCalls);
  });

  test('timeout: 4 s without a response falls back with the timeout message', async () => {
    const [legacy, port] = await both([hanging], async (ice, clock) => {
      const pending = ice.load();
      clock.advance(3999);
      const before = await Promise.race([pending, Promise.resolve('still pending')]);
      clock.advance(1);
      return [before, await pending] as const;
    });
    expect(legacy[0]).toBe('still pending');
    expect(plain(port)).toEqual(plain(legacy));
    expect(legacy[1].error).toBe('ICE endpoint timed out');
  });

  test('timeoutMs option shortens the wait', async () => {
    const [legacy, port] = await both([hanging], async (ice, clock) => {
      const pending = ice.load({ timeoutMs: 250 });
      clock.advance(250);
      return pending;
    });
    expect(plain(port)).toEqual(plain(legacy));
  });

  test('empty configured URL: fallback without a fetch', async () => {
    const [legacy, port, legacyCalls, portCalls] = await both([], (ice) => ice.load(), '', '');
    expect(plain(port)).toEqual(plain(legacy));
    expect(legacy.error).toBe('No ICE_CONFIG_URL configured (shared/ice.js)');
    expect(legacyCalls).toEqual([]);
    expect(portCalls).toEqual([]);
  });

  test('cache: hit within 10 min (same object), miss after, force bypasses', async () => {
    const steps = [json([TURN]), json([STUN]), json([TURN, STUN])];
    const [legacy, port, legacyCalls, portCalls] = await both(steps, async (ice, clock) => {
      const first = await ice.load();
      clock.advance(10 * 60 * 1000 - 1);
      const hit = await ice.load();
      const forced = await ice.load({ force: true });
      clock.advance(10 * 60 * 1000);
      const miss = await ice.load();
      return { first, hitIsFirst: hit === first, forced, forcedIsFirst: forced === first, miss };
    });
    expect(plain(port)).toEqual(plain(legacy));
    expect(legacy.hitIsFirst).toBe(true);
    expect(legacy.forcedIsFirst).toBe(false);
    expect(portCalls).toEqual(legacyCalls);
    expect(legacyCalls).toHaveLength(3);
  });

  test('cache: a fallback is not cached; the cache is keyed by URL', async () => {
    const steps = [json(null, 500), json([TURN]), json([STUN]), json([TURN])];
    const [legacy, port, legacyCalls, portCalls] = await both(steps, async (ice) => [
      await ice.load(),
      await ice.load(),
      await ice.load({ url: 'https://b.example' }),
      await ice.load({ url: 'https://b.example' }),
      await ice.load(),
    ]);
    expect(plain(port)).toEqual(plain(legacy));
    expect(portCalls).toEqual(legacyCalls);
    expect(legacyCalls).toEqual([
      'https://turn.sweedler.com',
      'https://turn.sweedler.com',
      'https://b.example',
      'https://turn.sweedler.com',
    ]);
  });

  test('?ice= override: http(s) is used, anything else ignored', async () => {
    const accepted = await both(
      [json([STUN])],
      (ice) => ice.load(),
      '?peer=x:1&ice=https://alt.example/ice',
    );
    expect(accepted[2]).toEqual(['https://alt.example/ice']);
    expect(accepted[3]).toEqual(accepted[2]);
    const ignored = await both([json([STUN])], (ice) => ice.load(), '?ice=javascript:alert(1)');
    expect(ignored[2]).toEqual(['https://turn.sweedler.com']);
    expect(ignored[3]).toEqual(ignored[2]);
    const explicit = await both(
      [json([STUN])],
      (ice) => ice.load({ url: 'https://x.example' }),
      '?ice=https://alt.example',
    );
    expect(explicit[2]).toEqual(['https://x.example']);
    expect(explicit[3]).toEqual(explicit[2]);
  });
});

describe('peerConfig', () => {
  test('with a result and without', async () => {
    const [legacy, port] = await both([json([TURN])], async (ice) => {
      const loaded = await ice.load();
      return [ice.peerConfig(loaded), ice.peerConfig(null), ice.peerConfig(undefined)];
    });
    expect(plain(port)).toEqual(plain(legacy));
  });
});

// ---------------------------------------------------------------------------------------------
// describe / watch
// ---------------------------------------------------------------------------------------------
const cand = (id: string, candidateType: string): StatLike => ({
  id,
  type: 'local-candidate',
  candidateType,
});

const pcWith = (stats: ReadonlyArray<StatLike>, reject = false): PeerConnectionLike => ({
  getStats: () => (reject ? Promise.reject(new Error('gone')) : Promise.resolve(stats)),
  iceConnectionState: 'connected',
  connectionState: 'connected',
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
});

const STATS_CASES: ReadonlyArray<readonly [string, PeerConnectionLike | null]> = [
  ['null pc', null],
  [
    'transport -> direct',
    pcWith([
      { id: 'T1', type: 'transport', selectedCandidatePairId: 'P1' },
      { id: 'P1', type: 'candidate-pair', localCandidateId: 'L', remoteCandidateId: 'R' },
      cand('L', 'srflx'),
      cand('R', 'host'),
    ]),
  ],
  [
    'transport -> relay (remote)',
    pcWith([
      { id: 'T1', type: 'transport', selectedCandidatePairId: 'P1' },
      { id: 'P1', type: 'candidate-pair', localCandidateId: 'L', remoteCandidateId: 'R' },
      cand('L', 'host'),
      cand('R', 'relay'),
    ]),
  ],
  [
    'last transport wins',
    pcWith([
      { id: 'T1', type: 'transport', selectedCandidatePairId: 'P1' },
      { id: 'T2', type: 'transport', selectedCandidatePairId: 'missing' },
      { id: 'T3', type: 'transport', selectedCandidatePairId: 'P3' },
      { id: 'P1', type: 'candidate-pair', localCandidateId: 'L', remoteCandidateId: 'R' },
      { id: 'P3', type: 'candidate-pair', localCandidateId: 'X', remoteCandidateId: 'Y' },
      cand('L', 'host'),
      cand('R', 'host'),
      cand('X', 'relay'),
      cand('Y', 'host'),
    ]),
  ],
  [
    'first nominated succeeded pair wins without a transport',
    pcWith([
      { id: 'P0', type: 'candidate-pair', state: 'failed', nominated: true, localCandidateId: 'L' },
      {
        id: 'P1',
        type: 'candidate-pair',
        state: 'succeeded',
        nominated: true,
        localCandidateId: 'L',
        remoteCandidateId: 'R',
      },
      {
        id: 'P2',
        type: 'candidate-pair',
        state: 'succeeded',
        selected: true,
        localCandidateId: 'X',
        remoteCandidateId: 'Y',
      },
      cand('L', 'host'),
      cand('R', 'prflx'),
      cand('X', 'relay'),
      cand('Y', 'relay'),
    ]),
  ],
  [
    'selected succeeded pair',
    pcWith([
      {
        id: 'P2',
        type: 'candidate-pair',
        state: 'succeeded',
        selected: true,
        localCandidateId: 'X',
        remoteCandidateId: 'Y',
      },
      cand('X', 'relay'),
      cand('Y', 'relay'),
    ]),
  ],
  [
    'unresolved remote candidate',
    pcWith([
      { id: 'T1', type: 'transport', selectedCandidatePairId: 'P1' },
      { id: 'P1', type: 'candidate-pair', localCandidateId: 'L', remoteCandidateId: 'nope' },
      cand('L', 'host'),
    ]),
  ],
  [
    'empty candidate types',
    pcWith([
      { id: 'T1', type: 'transport', selectedCandidatePairId: 'P1' },
      { id: 'P1', type: 'candidate-pair', localCandidateId: 'L', remoteCandidateId: 'R' },
      cand('L', ''),
      { id: 'R', type: 'remote-candidate' },
    ]),
  ],
  [
    'nothing usable',
    pcWith([
      { id: 'T1', type: 'transport' },
      { id: 'P1', type: 'candidate-pair', state: 'succeeded' },
      { id: 'P2', type: 'candidate-pair', state: 'in-progress', nominated: true },
    ]),
  ],
  ['empty report', pcWith([])],
  ['getStats rejects', pcWith([], true)],
];

describe('describe(pc)', () => {
  test.each(STATS_CASES)('%s', async (_name, pc) => {
    const [legacy, port] = await both([], (ice) => ice.describe(pc));
    expect(plain(port)).toEqual(plain(legacy));
  });

  test('a pc without getStats is unknown in legacy (the port makes that unrepresentable)', async () => {
    const legacy = loadLegacy({ clock: fakeClock(), fetch: scriptedFetch([]).fetch, search: '' });
    await expect(legacy.describe({})).resolves.toEqual({
      path: 'unknown',
      local: null,
      remote: null,
    });
  });
});

describe('watch(pc, cb)', () => {
  type Recorder = PeerConnectionLike &
    Readonly<{ fire: (type: string) => void; count: () => number }>;
  const recorder = (): Recorder => {
    const listeners = new Map<string, Set<() => void>>();
    const state = { ice: 'new', conn: 'new' };
    return {
      getStats: () => Promise.resolve([]),
      get iceConnectionState() {
        return state.ice;
      },
      get connectionState() {
        return state.conn;
      },
      addEventListener: (type, fn) => {
        listeners.set(type, (listeners.get(type) ?? new Set()).add(fn));
      },
      removeEventListener: (type, fn) => {
        listeners.get(type)?.delete(fn);
      },
      fire: (type) => {
        if (type === 'iceconnectionstatechange') state.ice = 'checking';
        if (type === 'connectionstatechange') state.conn = 'connecting';
        listeners.get(type)?.forEach((fn) => {
          fn();
        });
      },
      count: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
    };
  };

  test('same callbacks, same subscription count, same unsubscribe', async () => {
    const [legacy, port] = await both([], (ice) => {
      const pc = recorder();
      const seen: unknown[] = [];
      const stop = ice.watch(pc, (s) => seen.push(s));
      const subscribed = pc.count();
      pc.fire('iceconnectionstatechange');
      pc.fire('connectionstatechange');
      stop();
      const afterStop = pc.count();
      pc.fire('connectionstatechange');
      return Promise.resolve({ seen, subscribed, afterStop });
    });
    expect(plain(port)).toEqual(plain(legacy));
    expect(legacy).toEqual({
      seen: [
        { ice: 'checking', conn: 'new' },
        { ice: 'checking', conn: 'connecting' },
      ],
      subscribed: 2,
      afterStop: 0,
    });
  });

  test('null pc: a no-op unsubscribe in both', async () => {
    const [legacy, port] = await both([], (ice) => {
      const stop = ice.watch(null, () => undefined);
      stop();
      return Promise.resolve(typeof stop);
    });
    expect(plain(port)).toEqual(plain(legacy));
  });
});
