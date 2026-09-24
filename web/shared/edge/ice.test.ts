import { afterEach, describe, expect, test, vi } from 'vitest';

import { fakeClock, type FakeClock } from './clock.fake.ts';
import { realClock } from './clock.ts';
import {
  CACHE_TTL_MS,
  FALLBACK_ICE,
  FETCH_TIMEOUT_MS,
  ICE_CONFIG_URL,
  browserIceDeps,
  configUrl,
  createIce,
  icePolicy,
  isTurn,
  normalize,
  type FetchLike,
  type IceDeps,
  type PeerConnectionLike,
  type StatLike,
} from './ice.ts';

// ---------------------------------------------------------------------------------------------
// Fetch stubs. Each records the URLs it was asked for.
// ---------------------------------------------------------------------------------------------
type Stub = Readonly<{ fetch: FetchLike; calls: ReadonlyArray<string> }>;

const stub = (
  respond: (
    url: string,
    signal: AbortSignal,
  ) => Promise<Parameters<FetchLike>[1] extends never ? never : Awaited<ReturnType<FetchLike>>>,
): Stub => {
  const calls: string[] = [];
  return {
    calls,
    fetch: (url, init) => {
      calls.push(url);
      return respond(url, init.signal);
    },
  };
};

const jsonResponse = (body: unknown, status = 200): Stub =>
  stub(() => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) }));

const malformedResponse = (): Stub =>
  stub(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON at position 0')),
    }),
  );

const networkError = (): Stub => stub(() => Promise.reject(new TypeError('Failed to fetch')));

/** Never answers; rejects with the abort reason when the signal fires, like a real fetch. */
const hanging = (): Stub =>
  stub(
    (_url, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(signal.reason as Error);
        });
      }),
  );

const deps = (s: Stub, clock: FakeClock, search = '', endpoint?: string): IceDeps => ({
  fetch: s.fetch,
  clock,
  search: () => search,
  ...(endpoint === undefined ? {} : { endpoint }),
});

const TURN = { urls: 'turn:relay.example:3478', username: 'u', credential: 'c' };
const STUN = { urls: ['stun:stun.example:3478'] };

describe('constants', () => {
  test('match legacy/shared/ice.js', () => {
    expect(ICE_CONFIG_URL).toBe('https://turn.sweedler.com');
    expect(FETCH_TIMEOUT_MS).toBe(4000);
    expect(CACHE_TTL_MS).toBe(600_000);
    expect(FALLBACK_ICE).toEqual([
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
      { urls: 'stun:stun.cloudflare.com:3478' },
    ]);
  });
});

describe('configUrl', () => {
  test('defaults to the configured endpoint', () => {
    expect(configUrl('')).toBe(ICE_CONFIG_URL);
    expect(configUrl('?peer=127.0.0.1:9000')).toBe(ICE_CONFIG_URL);
    expect(configUrl('', 'https://custom.example')).toBe('https://custom.example');
  });

  test('?ice= wins when it is an http(s) URL', () => {
    expect(configUrl('?ice=https://alt.example/ice')).toBe('https://alt.example/ice');
    expect(configUrl('?a=1&ice=http://127.0.0.1:4173/e2e-ice.json&b=2')).toBe(
      'http://127.0.0.1:4173/e2e-ice.json',
    );
  });

  test('a non-http ?ice= is ignored', () => {
    expect(configUrl('?ice=javascript:alert(1)')).toBe(ICE_CONFIG_URL);
    expect(configUrl('?ice=')).toBe(ICE_CONFIG_URL);
    expect(configUrl('?ice=ftp://x')).toBe(ICE_CONFIG_URL);
  });
});

describe('icePolicy (the ?ice-policy=relay hook)', () => {
  test('relay is the one value the hook accepts', () => {
    expect(icePolicy('?ice-policy=relay')).toBe('relay');
    expect(icePolicy('?peer=127.0.0.1:9000&ice-policy=relay&ice=https://x')).toBe('relay');
  });

  test('anything else is the browser default', () => {
    expect(icePolicy('')).toBeNull();
    expect(icePolicy('?ice=https://alt.example')).toBeNull();
    expect(icePolicy('?ice-policy=')).toBeNull();
    expect(icePolicy('?ice-policy=all')).toBeNull();
    expect(icePolicy('?ice-policy=RELAY')).toBeNull();
  });
});

describe('isTurn', () => {
  test('turn: and turns: in any case, string or array', () => {
    expect(isTurn(TURN)).toBe(true);
    expect(isTurn({ urls: 'TURNS:relay.example:5349' })).toBe(true);
    expect(isTurn({ urls: ['stun:a', 'turn:b'] })).toBe(true);
    expect(isTurn(STUN)).toBe(false);
    expect(isTurn({ urls: 'stun:turn.example' })).toBe(false);
  });
});

describe('normalize', () => {
  test('accepts a bare array and {iceServers}', () => {
    expect(normalize([TURN, STUN])).toEqual([TURN, STUN]);
    expect(normalize({ iceServers: [STUN] })).toEqual([STUN]);
  });

  test('keeps only entries with a string or array urls', () => {
    expect(normalize([TURN, null, 1, {}, { urls: 42 }, { urls: '' }, { urls: [] }])).toEqual([
      TURN,
      { urls: [] },
    ]);
  });

  test('throws the legacy messages for the two bad shapes', () => {
    expect(() => normalize({})).toThrow('ICE endpoint returned neither an array nor {iceServers}');
    expect(() => normalize(null)).toThrow(
      'ICE endpoint returned neither an array nor {iceServers}',
    );
    expect(() => normalize('[]')).toThrow(
      'ICE endpoint returned neither an array nor {iceServers}',
    );
    expect(() => normalize({ iceServers: {} })).toThrow(
      'ICE endpoint returned neither an array nor {iceServers}',
    );
    expect(() => normalize([])).toThrow('ICE endpoint returned no usable servers');
    expect(() => normalize([{ urls: 5 }])).toThrow('ICE endpoint returned no usable servers');
  });
});

describe('load', () => {
  test('remote success, bare array, with TURN', async () => {
    const s = jsonResponse([TURN, STUN]);
    const ice = createIce(deps(s, fakeClock()));
    await expect(ice.load()).resolves.toEqual({
      iceServers: [TURN, STUN],
      source: 'remote',
      hasTurn: true,
      error: null,
    });
    expect(s.calls).toEqual([ICE_CONFIG_URL]);
  });

  test('remote success, {iceServers}, STUN only', async () => {
    const ice = createIce(deps(jsonResponse({ iceServers: [STUN] }), fakeClock()));
    await expect(ice.load()).resolves.toEqual({
      iceServers: [STUN],
      source: 'remote',
      hasTurn: false,
      error: null,
    });
  });

  test('passes signal and cache: no-store to fetch', async () => {
    const seen: unknown[] = [];
    const ice = createIce({
      fetch: (url, init) => {
        seen.push([url, init.cache, init.signal instanceof AbortSignal]);
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([STUN]) });
      },
      clock: fakeClock(),
      search: () => '',
    });
    await ice.load();
    expect(seen).toEqual([[ICE_CONFIG_URL, 'no-store', true]]);
  });

  test.each([
    ['HTTP 500', jsonResponse(null, 500), 'ICE endpoint HTTP 500'],
    ['HTTP 404', jsonResponse(null, 404), 'ICE endpoint HTTP 404'],
    ['network error', networkError(), 'Failed to fetch'],
    ['malformed body', malformedResponse(), 'Unexpected token < in JSON at position 0'],
    [
      'wrong shape',
      jsonResponse({ servers: [] }),
      'ICE endpoint returned neither an array nor {iceServers}',
    ],
    ['empty list', jsonResponse([]), 'ICE endpoint returned no usable servers'],
  ])('%s falls back to STUN with the error text', async (_name, s, error) => {
    const ice = createIce(deps(s, fakeClock()));
    const result = await ice.load();
    expect(result).toEqual({ iceServers: FALLBACK_ICE, source: 'fallback', hasTurn: false, error });
    // A copy, not the shared constant.
    expect(result.iceServers).not.toBe(FALLBACK_ICE);
  });

  test('a non-Error rejection is stringified', async () => {
    const ice = createIce(
      deps(
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the point is a non-Error
        stub(() => Promise.reject('plain string')),
        fakeClock(),
      ),
    );
    await expect(ice.load()).resolves.toMatchObject({ source: 'fallback', error: 'plain string' });
    const ice2 = createIce(
      deps(
        stub(() => Promise.reject(new Error(''))),
        fakeClock(),
      ),
    );
    await expect(ice2.load()).resolves.toMatchObject({ error: 'Error' });
  });

  test('times out after 4 s via AbortController and reports it', async () => {
    const clock = fakeClock();
    const s = hanging();
    const ice = createIce(deps(s, clock));
    const pending = ice.load();
    expect(clock.pending()).toBe(1);
    clock.advance(FETCH_TIMEOUT_MS - 1);
    expect(clock.pending()).toBe(1);
    clock.advance(1);
    await expect(pending).resolves.toEqual({
      iceServers: FALLBACK_ICE,
      source: 'fallback',
      hasTurn: false,
      error: 'ICE endpoint timed out',
    });
  });

  test('timeoutMs overrides the 4 s', async () => {
    const clock = fakeClock();
    const ice = createIce(deps(hanging(), clock));
    const pending = ice.load({ timeoutMs: 100 });
    clock.advance(100);
    await expect(pending).resolves.toMatchObject({ error: 'ICE endpoint timed out' });
  });

  test('the timer is cleared once the response lands', async () => {
    const clock = fakeClock();
    const ice = createIce(deps(jsonResponse([STUN]), clock));
    await ice.load();
    expect(clock.pending()).toBe(0);
  });

  test('an empty configured endpoint resolves to the fallback without fetching', async () => {
    const s = jsonResponse([STUN]);
    const ice = createIce(deps(s, fakeClock(), '', ''));
    await expect(ice.load()).resolves.toEqual({
      iceServers: FALLBACK_ICE,
      source: 'fallback',
      hasTurn: false,
      error: 'No ICE_CONFIG_URL configured (shared/ice.js)',
    });
    expect(s.calls).toEqual([]);
  });

  test('opts.url wins over everything', async () => {
    const s = jsonResponse([STUN]);
    const ice = createIce(deps(s, fakeClock(), '?ice=https://alt.example'));
    await ice.load({ url: 'https://explicit.example' });
    expect(s.calls).toEqual(['https://explicit.example']);
  });

  test('?ice= overrides the endpoint', async () => {
    const s = jsonResponse([STUN]);
    const ice = createIce(deps(s, fakeClock(), '?ice=https://alt.example/ice'));
    await ice.load();
    expect(s.calls).toEqual(['https://alt.example/ice']);
  });

  describe('cache', () => {
    test('a success is reused for 10 minutes, then refetched', async () => {
      const clock = fakeClock(1_000_000);
      const s = jsonResponse([TURN]);
      const ice = createIce(deps(s, clock));
      const first = await ice.load();
      clock.advance(CACHE_TTL_MS - 1);
      expect(await ice.load()).toBe(first);
      expect(s.calls).toHaveLength(1);
      clock.advance(1);
      const third = await ice.load();
      expect(third).not.toBe(first);
      expect(third).toEqual(first);
      expect(s.calls).toHaveLength(2);
    });

    test('force: true bypasses a fresh cache', async () => {
      const s = jsonResponse([TURN]);
      const ice = createIce(deps(s, fakeClock()));
      const first = await ice.load();
      const second = await ice.load({ force: true });
      expect(second).not.toBe(first);
      expect(s.calls).toHaveLength(2);
      // and the forced result is what the cache now holds
      expect(await ice.load()).toBe(second);
    });

    test('the cache is keyed by URL', async () => {
      const s = jsonResponse([TURN]);
      const ice = createIce(deps(s, fakeClock()));
      await ice.load({ url: 'https://a.example' });
      await ice.load({ url: 'https://b.example' });
      await ice.load({ url: 'https://a.example' });
      expect(s.calls).toEqual(['https://a.example', 'https://b.example', 'https://a.example']);
    });

    test('a fallback is never cached', async () => {
      const s = jsonResponse(null, 500);
      const ice = createIce(deps(s, fakeClock()));
      await ice.load();
      await ice.load();
      expect(s.calls).toHaveLength(2);
    });
  });
});

describe('peerConfig', () => {
  const ice = createIce(deps(jsonResponse([TURN]), fakeClock()));

  test('wraps the result servers with unified-plan', () => {
    expect(
      ice.peerConfig({ iceServers: [TURN], source: 'remote', hasTurn: true, error: null }),
    ).toEqual({ iceServers: [TURN], sdpSemantics: 'unified-plan' });
  });

  test('falls back to a copy of FALLBACK_ICE without a result', () => {
    const a = ice.peerConfig(null);
    const b = ice.peerConfig(undefined);
    expect(a).toEqual({ iceServers: FALLBACK_ICE, sdpSemantics: 'unified-plan' });
    expect(b.iceServers).toEqual(FALLBACK_ICE);
    expect(a.iceServers).not.toBe(FALLBACK_ICE);
  });

  test('a forced policy adds iceTransportPolicy; none or null leaves the legacy shape', () => {
    const loaded = { iceServers: [TURN], source: 'remote', hasTurn: true, error: null } as const;
    expect(ice.peerConfig(loaded, 'relay')).toEqual({
      iceServers: [TURN],
      sdpSemantics: 'unified-plan',
      iceTransportPolicy: 'relay',
    });
    expect(ice.peerConfig(null, 'relay')).toEqual({
      iceServers: FALLBACK_ICE,
      sdpSemantics: 'unified-plan',
      iceTransportPolicy: 'relay',
    });
    expect(ice.peerConfig(loaded, null)).toEqual(ice.peerConfig(loaded));
    expect(Object.keys(ice.peerConfig(loaded))).toEqual(['iceServers', 'sdpSemantics']);
  });
});

// ---------------------------------------------------------------------------------------------
// describe / watch over a fake RTCPeerConnection
// ---------------------------------------------------------------------------------------------
const pcWith = (stats: ReadonlyArray<StatLike>): PeerConnectionLike => ({
  getStats: () => Promise.resolve(stats),
  iceConnectionState: 'connected',
  connectionState: 'connected',
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
});

const cand = (id: string, candidateType: string): StatLike => ({
  id,
  type: 'local-candidate',
  candidateType,
});

describe('describe', () => {
  const ice = createIce(deps(jsonResponse([TURN]), fakeClock()));

  test('unknown without a peer connection', async () => {
    await expect(ice.describe(null)).resolves.toEqual({
      path: 'unknown',
      local: null,
      remote: null,
    });
    await expect(ice.describe(undefined)).resolves.toEqual({
      path: 'unknown',
      local: null,
      remote: null,
    });
  });

  test('selected pair via the transport stat: direct', async () => {
    const pc = pcWith([
      { id: 'T1', type: 'transport', selectedCandidatePairId: 'P1' },
      { id: 'P1', type: 'candidate-pair', localCandidateId: 'L', remoteCandidateId: 'R' },
      cand('L', 'srflx'),
      cand('R', 'host'),
    ]);
    await expect(ice.describe(pc)).resolves.toEqual({
      path: 'direct',
      local: 'srflx',
      remote: 'host',
    });
  });

  test('relay on either side is relay', async () => {
    const local = pcWith([
      { id: 'T1', type: 'transport', selectedCandidatePairId: 'P1' },
      { id: 'P1', type: 'candidate-pair', localCandidateId: 'L', remoteCandidateId: 'R' },
      cand('L', 'relay'),
      cand('R', 'host'),
    ]);
    await expect(ice.describe(local)).resolves.toEqual({
      path: 'relay',
      local: 'relay',
      remote: 'host',
    });
    const remote = pcWith([
      { id: 'T1', type: 'transport', selectedCandidatePairId: 'P1' },
      { id: 'P1', type: 'candidate-pair', localCandidateId: 'L', remoteCandidateId: 'R' },
      cand('L', 'host'),
      cand('R', 'relay'),
    ]);
    await expect(ice.describe(remote)).resolves.toEqual({
      path: 'relay',
      local: 'host',
      remote: 'relay',
    });
  });

  test('without a transport stat, the first nominated succeeded pair is used', async () => {
    const pc = pcWith([
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
    ]);
    await expect(ice.describe(pc)).resolves.toEqual({
      path: 'direct',
      local: 'host',
      remote: 'prflx',
    });
  });

  test('the last transport stat with a known pair wins', async () => {
    const pc = pcWith([
      { id: 'T1', type: 'transport', selectedCandidatePairId: 'P1' },
      { id: 'T2', type: 'transport', selectedCandidatePairId: 'missing' },
      { id: 'T3', type: 'transport', selectedCandidatePairId: 'P3' },
      { id: 'P1', type: 'candidate-pair', localCandidateId: 'L', remoteCandidateId: 'R' },
      { id: 'P3', type: 'candidate-pair', localCandidateId: 'X', remoteCandidateId: 'Y' },
      cand('L', 'host'),
      cand('R', 'host'),
      cand('X', 'relay'),
      cand('Y', 'host'),
    ]);
    await expect(ice.describe(pc)).resolves.toEqual({
      path: 'relay',
      local: 'relay',
      remote: 'host',
    });
  });

  test('a pair with unresolved or untyped candidates is unknown, with what is known', async () => {
    const pc = pcWith([
      { id: 'T1', type: 'transport', selectedCandidatePairId: 'P1' },
      { id: 'P1', type: 'candidate-pair', localCandidateId: 'L', remoteCandidateId: 'nope' },
      cand('L', 'host'),
    ]);
    await expect(ice.describe(pc)).resolves.toEqual({
      path: 'unknown',
      local: 'host',
      remote: null,
    });
    const untyped = pcWith([
      { id: 'T1', type: 'transport', selectedCandidatePairId: 'P1' },
      { id: 'P1', type: 'candidate-pair', localCandidateId: 'L', remoteCandidateId: 'R' },
      cand('L', ''),
      { id: 'R', type: 'remote-candidate' },
    ]);
    await expect(ice.describe(untyped)).resolves.toEqual({
      path: 'unknown',
      local: null,
      remote: null,
    });
  });

  test('no usable pair at all is unknown', async () => {
    const pc = pcWith([
      { id: 'T1', type: 'transport' },
      { id: 'P1', type: 'candidate-pair', state: 'succeeded' },
      { id: 'P2', type: 'candidate-pair', state: 'in-progress', nominated: true },
    ]);
    await expect(ice.describe(pc)).resolves.toEqual({ path: 'unknown', local: null, remote: null });
    await expect(ice.describe(pcWith([]))).resolves.toEqual({
      path: 'unknown',
      local: null,
      remote: null,
    });
  });

  test('a failing getStats is unknown', async () => {
    const pc: PeerConnectionLike = {
      ...pcWith([]),
      getStats: () => Promise.reject(new Error('gone')),
    };
    await expect(ice.describe(pc)).resolves.toEqual({ path: 'unknown', local: null, remote: null });
  });

  test('reads a Map-shaped report (RTCStatsReport.forEach passes the value)', async () => {
    const report = new Map<string, StatLike>([
      ['T1', { id: 'T1', type: 'transport', selectedCandidatePairId: 'P1' }],
      ['P1', { id: 'P1', type: 'candidate-pair', localCandidateId: 'L', remoteCandidateId: 'R' }],
      ['L', cand('L', 'host')],
      ['R', cand('R', 'host')],
    ]);
    const pc: PeerConnectionLike = {
      ...pcWith([]),
      getStats: () =>
        Promise.resolve({
          forEach: (fn) => {
            report.forEach((v) => {
              fn(v);
            });
          },
        }),
    };
    await expect(ice.describe(pc)).resolves.toEqual({
      path: 'direct',
      local: 'host',
      remote: 'host',
    });
  });
});

describe('watch', () => {
  const ice = createIce(deps(jsonResponse([TURN]), fakeClock()));

  const fakePc = (): PeerConnectionLike &
    Readonly<{ fire: (type: string) => void; listeners: () => number }> => {
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
      listeners: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
    };
  };

  test('reports both states on either event and unsubscribes cleanly', () => {
    const pc = fakePc();
    const seen: unknown[] = [];
    const stop = ice.watch(pc, (s) => seen.push(s));
    expect(pc.listeners()).toBe(2);
    pc.fire('iceconnectionstatechange');
    pc.fire('connectionstatechange');
    expect(seen).toEqual([
      { ice: 'checking', conn: 'new' },
      { ice: 'checking', conn: 'connecting' },
    ]);
    stop();
    expect(pc.listeners()).toBe(0);
    pc.fire('connectionstatechange');
    expect(seen).toHaveLength(2);
  });

  test('without a peer connection it is a no-op', () => {
    const stop = ice.watch(null, () => undefined);
    expect(typeof stop).toBe('function');
    expect(() => {
      stop();
      ice.watch(undefined, () => undefined)();
    }).not.toThrow();
  });
});

describe('browserIceDeps', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('delegates to the global fetch, the real clock and location.search', async () => {
    const calls: unknown[] = [];
    vi.stubGlobal('fetch', (url: string, init: unknown) => {
      calls.push([url, init]);
      return Promise.resolve(new Response('[]'));
    });
    const d = browserIceDeps();
    expect(d.clock).toBe(realClock);
    expect(d.search()).toBe('');
    const r = await d.fetch('https://x.example', {
      signal: new AbortController().signal,
      cache: 'no-store',
    });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    vi.stubGlobal('location', { search: '?ice=https://alt.example' });
    expect(d.search()).toBe('?ice=https://alt.example');
  });
});

// Two branches the games' suites used to reach for the shared row (docs/design/test-partition.md
// "Coverage"): the shared suite is measured alone now, so they are pinned here.
describe('an empty error and a pair with one candidate id', () => {
  test('a rejection that stringifies to nothing is a fallback with no error text', async () => {
    const ice = createIce(
      deps(
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the point is an empty reason
        stub(() => Promise.reject('')),
        fakeClock(),
      ),
    );
    await expect(ice.load()).resolves.toMatchObject({ source: 'fallback', error: null });
  });

  test('a pair naming no local candidate reads as unknown on that side and relay on the other', async () => {
    const ice = createIce(deps(jsonResponse([TURN]), fakeClock()));
    const pc = pcWith([
      { id: 'T1', type: 'transport', selectedCandidatePairId: 'P1' },
      { id: 'P1', type: 'candidate-pair', remoteCandidateId: 'R' },
      cand('R', 'relay'),
    ]);
    await expect(ice.describe(pc)).resolves.toEqual({
      path: 'relay',
      local: null,
      remote: 'relay',
    });
  });
});
