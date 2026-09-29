// The island scoreboard's routes (rps-push.ts) over a Map-backed store and a captured fetch: every
// route and status of the file header's table, the provider token verified against a key pair
// generated here (no secret is ever in the repo), the 2 s rule, the forgotten pair on a 410, the
// 503 when nothing is configured.
import { describe, expect, test } from 'vitest';

import {
  apnsJwt,
  apnsOrigin,
  BANDS,
  base64url,
  CLIP_BUNDLE,
  configured,
  DEFAULT_APNS_HOST,
  handleRps,
  isRpsPath,
  JWT_LIFETIME_MS,
  lastKey,
  type MoodState,
  moodPush,
  type Pair,
  pairKey,
  PAIR_TTL_SECONDS,
  type PairStore,
  parseMood,
  parsePair,
  parseStoredPair,
  pemToDer,
  PUSH_INTERVAL_MS,
  pushMood,
  type RpsEnv,
  signApnsJwt,
} from './rps-push.ts';

const ORIGIN = 'https://games.sweedler.com';
const SESSION = 'abcd1234';
const TOKEN = 'a'.repeat(64);
const TEAM = 'TEAM123456';
const KID = 'KEY1234567';
const NOW_MS = 1_760_000_000_123;

// ---- A key pair for the tests: the private half as the .p8 PEM Apple ships, the public half to verify.

const chunk = (text: string): string => text.match(/.{1,64}/g)?.join('\n') ?? '';

const toPem = (pkcs8: Uint8Array): string =>
  `-----BEGIN PRIVATE KEY-----\n${chunk(btoa(String.fromCharCode(...pkcs8)))}\n-----END PRIVATE KEY-----\n`;

const generated = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
  'sign',
  'verify',
]);
const PKCS8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', generated.privateKey));
const PEM = toPem(PKCS8);

const fromBase64url = (text: string): Uint8Array =>
  Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

const decodeJson = (segment: string): unknown =>
  JSON.parse(new TextDecoder().decode(fromBase64url(segment)));

const verifyJwt = async (
  jwt: string,
): Promise<Readonly<{ header: unknown; claims: unknown; valid: boolean }>> => {
  const [h = '', c = '', s = ''] = jwt.split('.');
  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    generated.publicKey,
    fromBase64url(s),
    new TextEncoder().encode(`${h}.${c}`),
  );
  return { header: decodeJson(h), claims: decodeJson(c), valid };
};

// ---- A KV stand-in: a Map whose rows expire against an injected clock.

type Row = Readonly<{ value: string; expiresAt: number | undefined }>;

const fakeStore = (clock: () => number): Readonly<{ store: PairStore; rows: Map<string, Row> }> => {
  const rows = new Map<string, Row>();
  const store: PairStore = {
    get: (key) => {
      const row = rows.get(key);
      if (row === undefined) return Promise.resolve(null);
      if (row.expiresAt !== undefined && row.expiresAt <= clock()) {
        rows.delete(key);
        return Promise.resolve(null);
      }
      return Promise.resolve(row.value);
    },
    put: (key, value, options) => {
      const ttl = options?.expirationTtl;
      rows.set(key, { value, expiresAt: ttl === undefined ? undefined : clock() + ttl * 1_000 });
      return Promise.resolve();
    },
    delete: (key) => {
      rows.delete(key);
      return Promise.resolve();
    },
  };
  return { store, rows };
};

// ---- A fetch that records what Apple would have received and answers what the test says.

type Call = Readonly<{ url: string; init: RequestInit }>;

const capture = (
  respond: () => Response,
): Readonly<{ calls: Call[]; fetchFn: (url: string, init: RequestInit) => Promise<Response> }> => {
  const calls: Call[] = [];
  return {
    calls,
    fetchFn: (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(respond());
    },
  };
};

const ok = (): Response => new Response(null, { status: 200 });
const refused = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const env = (store: PairStore, extra: RpsEnv = {}): RpsEnv => ({
  RPS_PAIRS: store,
  APNS_TEAM_ID: TEAM,
  APNS_KEY_ID: KID,
  APNS_AUTH_KEY: PEM,
  ...extra,
});

const MOOD: MoodState = { counter: 3, prestige: 1, band: 'happy', at: 1_760_000_000 };
const PAIR: Pair = { token: TOKEN, bundle: CLIP_BUNDLE, at: 1_759_999_000 };

/** A world for the route tests: a clock the test moves, the store, the captured fetch, the handler. */
const world = (respond: () => Response = ok) => {
  const clock = { now: NOW_MS };
  const { store, rows } = fakeStore(() => clock.now);
  const { calls, fetchFn } = capture(respond);
  const deps = { fetchFn, now: () => clock.now };
  const call = (path: string, init?: RequestInit, e: RpsEnv = env(store)): Promise<Response> =>
    handleRps(new Request(ORIGIN + path, init), e, deps);
  const post = (path: string, body: unknown, e?: RpsEnv): Promise<Response> =>
    call(path, { method: 'POST', body: JSON.stringify(body) }, e);
  return { clock, store, rows, calls, call, post };
};

const pairBody = { session: SESSION, token: TOKEN, bundle: CLIP_BUNDLE };
const moodBody = { session: SESSION, ...MOOD };

describe('configured', () => {
  const store = fakeStore(() => NOW_MS).store;
  test('needs the binding and the three secrets; the host defaults to production', () => {
    expect(configured(env(store))).toEqual({
      store,
      apns: { teamId: TEAM, keyId: KID, authKey: PEM, host: DEFAULT_APNS_HOST },
    });
    expect(DEFAULT_APNS_HOST).toBe('api.push.apple.com');
  });
  test("APNS_HOST overrides the host (the sandbox, or proxy-dev's stub origin)", () => {
    expect(configured(env(store, { APNS_HOST: 'api.sandbox.push.apple.com' }))?.apns.host).toBe(
      'api.sandbox.push.apple.com',
    );
    expect(configured(env(store, { APNS_HOST: '' }))?.apns.host).toBe(DEFAULT_APNS_HOST);
  });
  test.each<[string, RpsEnv]>([
    ['no binding', { APNS_TEAM_ID: TEAM, APNS_KEY_ID: KID, APNS_AUTH_KEY: PEM }],
    ['no team', { RPS_PAIRS: store, APNS_KEY_ID: KID, APNS_AUTH_KEY: PEM }],
    ['an empty team', env(store, { APNS_TEAM_ID: '' })],
    ['no key id', { RPS_PAIRS: store, APNS_TEAM_ID: TEAM, APNS_AUTH_KEY: PEM }],
    ['no key', { RPS_PAIRS: store, APNS_TEAM_ID: TEAM, APNS_KEY_ID: KID }],
    ['nothing', {}],
  ])('is undefined with %s', (_what, e) => {
    expect(configured(e)).toBeUndefined();
  });
});

describe('isRpsPath', () => {
  test.each([
    ['/api/rps/pair', true],
    ['/api/rps/pair/abcd1234', true],
    ['/api/rps/mood', true],
    ['/api/rps/', true],
    ['/api/rps', false],
    ['/api/rpsx/pair', false],
    ['/gin-rummy/', false],
    ['/', false],
  ])('%s -> %s', (pathname, expected) => {
    expect(isRpsPath(pathname)).toBe(expected);
  });
});

describe('parsePair', () => {
  test('accepts the shape and nothing else in it matters', () => {
    expect(parsePair({ ...pairBody, extra: 1 })).toEqual(pairBody);
    expect(parsePair({ ...pairBody, token: 'AbCdEf'.repeat(6) })?.token).toBe('AbCdEf'.repeat(6));
    // Letters of either case and digits (docs/design/rps-island.md §8).
    expect(parsePair({ ...pairBody, session: 'AbCd1234' })?.session).toBe('AbCd1234');
  });
  test.each<[string, unknown]>([
    ['not a record', 'abcd1234'],
    ['null', null],
    ['an array', [pairBody]],
    ['a short session', { ...pairBody, session: 'abc' }],
    ['a token under 32 chars', { ...pairBody, token: 'a'.repeat(31) }],
    ['a token over 200 chars', { ...pairBody, token: 'a'.repeat(201) }],
    ['a non-hex token', { ...pairBody, token: 'g'.repeat(64) }],
    ['a bundle with a space', { ...pairBody, bundle: 'com.sweedler games' }],
    ['no bundle', { session: SESSION, token: TOKEN }],
    ['a numeric session', { ...pairBody, session: 12345678 }],
  ])('rejects %s', (_what, body) => {
    expect(parsePair(body)).toBeUndefined();
  });
});

describe('parseMood', () => {
  test('accepts every band and the counter range', () => {
    BANDS.forEach((band) => {
      expect(parseMood({ ...moodBody, band })?.state.band).toBe(band);
    });
    [-5, 0, 5].forEach((counter) => {
      expect(parseMood({ ...moodBody, counter })?.state.counter).toBe(counter);
    });
    expect(parseMood(moodBody)).toEqual({ session: SESSION, state: MOOD });
  });
  test.each<[string, unknown]>([
    ['not a record', 42],
    ['a bad session', { ...moodBody, session: 'nope' }],
    ['counter 6', { ...moodBody, counter: 6 }],
    ['counter -6', { ...moodBody, counter: -6 }],
    ['a fractional counter', { ...moodBody, counter: 1.5 }],
    ['a string counter', { ...moodBody, counter: '3' }],
    ['prestige 100', { ...moodBody, prestige: 100 }],
    ['prestige -1', { ...moodBody, prestige: -1 }],
    ['an unknown band', { ...moodBody, band: 'ecstatic' }],
    ['a negative at', { ...moodBody, at: -1 }],
    ['a missing at', { session: SESSION, counter: 0, prestige: 0, band: 'neutral' }],
  ])('rejects %s', (_what, body) => {
    expect(parseMood(body)).toBeUndefined();
  });
});

describe('parseStoredPair', () => {
  test('reads back what pairRoute wrote', () => {
    expect(parseStoredPair(JSON.stringify(PAIR))).toEqual(PAIR);
  });
  test.each([
    ['not JSON', '{'],
    ['a string', '"x"'],
    ['a bad token', JSON.stringify({ ...PAIR, token: 'zz' })],
    ['a bad bundle', JSON.stringify({ ...PAIR, bundle: '' })],
    ['a string at', JSON.stringify({ ...PAIR, at: '1' })],
  ])('is undefined for %s', (_what, raw) => {
    expect(parseStoredPair(raw)).toBeUndefined();
  });
  test('the keys', () => {
    expect(pairKey(SESSION)).toBe('pair:abcd1234');
    expect(lastKey(SESSION)).toBe('last:abcd1234');
  });
});

describe('the provider token', () => {
  test('base64url has no padding and the URL-safe alphabet; pemToDer inverts the PEM', () => {
    expect(base64url(new Uint8Array([251, 255, 254]))).toBe('-__-');
    expect(base64url(new Uint8Array([1]))).toBe('AQ');
    expect(pemToDer(PEM)).toEqual(PKCS8);
  });

  test('signApnsJwt: ES256, kid in the header, iss and iat (seconds) in the claims, a signature the public key verifies', async () => {
    const apns = { teamId: TEAM, keyId: KID, authKey: PEM, host: DEFAULT_APNS_HOST };
    const jwt = await signApnsJwt(apns, NOW_MS);
    const { header, claims, valid } = await verifyJwt(jwt);
    expect(header).toEqual({ alg: 'ES256', kid: KID });
    expect(claims).toEqual({ iss: TEAM, iat: Math.floor(NOW_MS / 1_000) });
    expect(valid).toBe(true);
    // A tampered claim fails verification.
    const [h = '', , s = ''] = jwt.split('.');
    const forged = base64url(new TextEncoder().encode(JSON.stringify({ iss: 'EVIL', iat: 1 })));
    expect((await verifyJwt(`${h}.${forged}.${s}`)).valid).toBe(false);
  });

  test('apnsJwt reuses one token for 50 minutes per key id, then signs a new one', async () => {
    const apns = { teamId: TEAM, keyId: 'CACHE00001', authKey: PEM, host: DEFAULT_APNS_HOST };
    const first = await apnsJwt(apns, NOW_MS);
    expect(await apnsJwt(apns, NOW_MS + JWT_LIFETIME_MS - 1)).toBe(first);
    const second = await apnsJwt(apns, NOW_MS + JWT_LIFETIME_MS);
    expect(second).not.toBe(first);
    expect((await verifyJwt(second)).claims).toEqual({
      iss: TEAM,
      iat: Math.floor((NOW_MS + JWT_LIFETIME_MS) / 1_000),
    });
    // Another key id is another cache row.
    const other = await apnsJwt({ ...apns, keyId: 'CACHE00002' }, NOW_MS);
    expect(other).not.toBe(first);
    expect(JWT_LIFETIME_MS).toBe(50 * 60 * 1_000);
  });
});

describe('the push', () => {
  test('apnsOrigin: https in front of a hostname; an origin with a scheme as it is, its trailing slash gone', () => {
    expect(apnsOrigin('api.push.apple.com')).toBe('https://api.push.apple.com');
    expect(apnsOrigin('http://127.0.0.1:8790')).toBe('http://127.0.0.1:8790');
    expect(apnsOrigin('http://127.0.0.1:8790/')).toBe('http://127.0.0.1:8790');
  });

  test('moodPush: the URL, the headers and the payload Apple documents', () => {
    const push = moodPush(DEFAULT_APNS_HOST, PAIR, MOOD, 'JWT', NOW_MS);
    expect(push.url).toBe(`https://api.push.apple.com/3/device/${TOKEN}`);
    expect(push.headers).toEqual({
      authorization: 'bearer JWT',
      'apns-topic': 'com.sweedler.games.dice.Clip.push-type.liveactivity',
      'apns-push-type': 'liveactivity',
      'apns-priority': '5',
      'apns-expiration': '0',
      'content-type': 'application/json',
    });
    expect(JSON.parse(push.body)).toEqual({
      aps: {
        timestamp: Math.floor(NOW_MS / 1_000),
        event: 'update',
        'content-state': { counter: 3, prestige: 1, band: 'happy', at: 1_760_000_000 },
      },
    });
  });

  const apns = { teamId: TEAM, keyId: KID, authKey: PEM, host: DEFAULT_APNS_HOST };

  test("pushMood: ok on a 2xx, and the request is a POST with the push's headers and body", async () => {
    const { calls, fetchFn } = capture(ok);
    expect(await pushMood(apns, PAIR, MOOD, fetchFn, NOW_MS)).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe(`https://api.push.apple.com/3/device/${TOKEN}`);
    expect(call?.init.method).toBe('POST');
    const headers = new Headers(call?.init.headers);
    expect(headers.get('apns-push-type')).toBe('liveactivity');
    expect(
      (await verifyJwt(headers.get('authorization')?.slice('bearer '.length) ?? '')).valid,
    ).toBe(true);
  });

  test.each<[number, unknown, string, boolean]>([
    [410, { reason: 'Unregistered', timestamp: 1 }, 'Unregistered', true],
    [400, { reason: 'BadDeviceToken' }, 'BadDeviceToken', true],
    [429, { reason: 'TooManyRequests' }, 'TooManyRequests', false],
    [403, { reason: 'InvalidProviderToken' }, 'InvalidProviderToken', false],
    [500, { nope: 1 }, 'HTTP 500', false],
  ])(
    'pushMood: a %i with %j is refused with reason %s (gone: %s)',
    async (status, body, reason, gone) => {
      const { fetchFn } = capture(() => refused(status, body));
      expect(await pushMood(apns, PAIR, MOOD, fetchFn, NOW_MS)).toEqual({
        ok: false,
        status,
        reason,
        gone,
      });
    },
  );

  test('pushMood: a refusal without a JSON body reads as its status', async () => {
    const { fetchFn } = capture(() => new Response('gateway', { status: 503 }));
    expect(await pushMood(apns, PAIR, MOOD, fetchFn, NOW_MS)).toEqual({
      ok: false,
      status: 503,
      reason: 'HTTP 503',
      gone: false,
    });
  });
});

describe('handleRps', () => {
  const noStore: PairStore = {
    get: () => Promise.reject(new Error('no store')),
    put: () => Promise.reject(new Error('no store')),
    delete: () => Promise.reject(new Error('no store')),
  };

  test.each([
    ['POST', '/api/rps/pair'],
    ['GET', '/api/rps/pair/abcd1234'],
    ['POST', '/api/rps/mood'],
  ])('%s %s answers 503 when nothing is configured, touching nothing', async (method, path) => {
    const { call, calls } = world();
    const res = await call(path, { method, body: method === 'POST' ? '{}' : null }, {});
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'island pushes not configured' });
    expect(calls).toHaveLength(0);
    const partial = await handleRps(
      new Request(ORIGIN + path, { method }),
      { RPS_PAIRS: noStore },
      {
        fetchFn: () => Promise.reject(new Error('no fetch')),
        now: () => NOW_MS,
      },
    );
    expect(partial.status).toBe(503);
  });

  test('responses are JSON, uncacheable and carry no CORS header (same-origin only)', async () => {
    const { call } = world();
    const res = await call('/api/rps/pair/abcd1234');
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('an unknown route is a 404; the wrong method a 405 naming the right one', async () => {
    const { call, post } = world();
    expect((await call('/api/rps/')).status).toBe(404);
    expect((await call('/api/rps/nope')).status).toBe(404);
    const pairGet = await call('/api/rps/pair');
    expect(pairGet.status).toBe(405);
    expect(pairGet.headers.get('allow')).toBe('POST');
    expect((await post('/api/rps/pair/abcd1234', {})).status).toBe(405);
    expect((await call('/api/rps/mood')).status).toBe(405);
  });

  test('pair: 204, the row under pair:<session> with a 24 h TTL; paired flips to true', async () => {
    const { clock, rows, call, post } = world();
    expect(await (await call('/api/rps/pair/abcd1234')).json()).toEqual({ paired: false });
    const res = await post('/api/rps/pair', pairBody);
    expect(res.status).toBe(204);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const row = rows.get('pair:abcd1234');
    expect(row?.expiresAt).toBe(NOW_MS + PAIR_TTL_SECONDS * 1_000);
    expect(PAIR_TTL_SECONDS).toBe(86_400);
    expect(JSON.parse(row?.value ?? '')).toEqual({
      token: TOKEN,
      bundle: CLIP_BUNDLE,
      at: Math.floor(NOW_MS / 1_000),
    });
    expect(await (await call('/api/rps/pair/abcd1234')).json()).toEqual({ paired: true });
    // A day later the row is gone.
    clock.now = NOW_MS + PAIR_TTL_SECONDS * 1_000;
    expect(await (await call('/api/rps/pair/abcd1234')).json()).toEqual({ paired: false });
  });

  test('pair: 400 for a bad body or no JSON; paired: 400 for a malformed session, false for a corrupt row', async () => {
    const { store, call, post } = world();
    expect((await post('/api/rps/pair', { ...pairBody, token: 'short' })).status).toBe(400);
    expect((await call('/api/rps/pair', { method: 'POST', body: 'not json' })).status).toBe(400);
    expect((await call('/api/rps/pair', { method: 'POST' })).status).toBe(400);
    expect((await call('/api/rps/pair/ABCD')).status).toBe(400);
    expect((await call('/api/rps/pair/')).status).toBe(400);
    await store.put('pair:abcd1234', '{"token":1}');
    expect(await (await call('/api/rps/pair/abcd1234')).json()).toEqual({ paired: false });
  });

  test('mood: 404 when unpaired (no row, or a corrupt one), 400 for a bad body, nothing pushed', async () => {
    const { store, calls, call, post } = world();
    expect((await post('/api/rps/mood', moodBody)).status).toBe(404);
    expect(await (await post('/api/rps/mood', moodBody)).json()).toEqual({ error: 'unpaired' });
    await store.put('pair:abcd1234', 'garbage');
    expect((await post('/api/rps/mood', moodBody)).status).toBe(404);
    expect((await post('/api/rps/mood', { ...moodBody, counter: 9 })).status).toBe(400);
    expect((await call('/api/rps/mood', { method: 'POST', body: '[' })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test("mood: 202 after the push, which carries the pair's token and bundle and the mood as content-state", async () => {
    const { rows, calls, post } = world();
    await post('/api/rps/pair', pairBody);
    const res = await post('/api/rps/mood', moodBody);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ pushed: true });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe(`https://api.push.apple.com/3/device/${TOKEN}`);
    const headers = new Headers(call?.init.headers);
    expect(headers.get('apns-topic')).toBe(`${CLIP_BUNDLE}.push-type.liveactivity`);
    expect(headers.get('apns-push-type')).toBe('liveactivity');
    expect(headers.get('apns-priority')).toBe('5');
    expect(headers.get('apns-expiration')).toBe('0');
    expect(headers.get('authorization')).toMatch(
      /^bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    );
    const sent = call?.init.body;
    expect(typeof sent).toBe('string');
    expect(JSON.parse(typeof sent === 'string' ? sent : '')).toEqual({
      aps: { timestamp: Math.floor(NOW_MS / 1_000), event: 'update', 'content-state': MOOD },
    });
    // The push is recorded for the 2 s rule, on a row KV can expire (its minimum TTL is 60 s).
    expect(rows.get('last:abcd1234')).toEqual({
      value: String(NOW_MS),
      expiresAt: NOW_MS + 60_000,
    });
  });

  test('mood: a second push under 2 s is a 429 with retry-after and no request; at 2 s it goes out', async () => {
    const { clock, calls, post } = world();
    await post('/api/rps/pair', pairBody);
    expect((await post('/api/rps/mood', moodBody)).status).toBe(202);
    clock.now = NOW_MS + PUSH_INTERVAL_MS - 1;
    const tooSoon = await post('/api/rps/mood', { ...moodBody, counter: 4 });
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.headers.get('retry-after')).toBe('2');
    expect(calls).toHaveLength(1);
    clock.now = NOW_MS + PUSH_INTERVAL_MS;
    expect((await post('/api/rps/mood', { ...moodBody, counter: 4 })).status).toBe(202);
    expect(calls).toHaveLength(2);
    expect(PUSH_INTERVAL_MS).toBe(2_000);
  });

  test("mood: Apple's refusal is a 502 carrying its reason; the pair stays for a passing error", async () => {
    const { rows, post } = world(() => refused(429, { reason: 'TooManyRequests' }));
    await post('/api/rps/pair', pairBody);
    const res = await post('/api/rps/mood', moodBody);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'apns', status: 429, reason: 'TooManyRequests' });
    expect(rows.has('pair:abcd1234')).toBe(true);
  });

  test.each<[number, string]>([
    [410, 'Unregistered'],
    [400, 'BadDeviceToken'],
  ])(
    'mood: a %i %s forgets the pair, so the next mood is a 404 and paired is false',
    async (status, reason) => {
      const { clock, rows, post, call } = world(() => refused(status, { reason }));
      await post('/api/rps/pair', pairBody);
      const res = await post('/api/rps/mood', moodBody);
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: 'apns', status, reason });
      expect(rows.has('pair:abcd1234')).toBe(false);
      expect(await (await call('/api/rps/pair/abcd1234')).json()).toEqual({ paired: false });
      clock.now = NOW_MS + PUSH_INTERVAL_MS;
      expect((await post('/api/rps/mood', moodBody)).status).toBe(404);
    },
  );

  test('mood: a push that throws (an unreadable key, a failed fetch) is a 502 with the message', async () => {
    const { store, post } = world();
    await post('/api/rps/pair', pairBody);
    const badKey = await post(
      '/api/rps/mood',
      moodBody,
      env(store, { APNS_AUTH_KEY: 'not a pem', APNS_KEY_ID: 'BADKEY0000' }),
    );
    expect(badKey.status).toBe(502);
    const body: unknown = await badKey.json();
    expect(body).toMatchObject({ error: 'apns', status: 0 });
    expect(typeof (body as { reason: unknown }).reason).toBe('string');

    const failing = await handleRps(
      new Request(`${ORIGIN}/api/rps/mood`, { method: 'POST', body: JSON.stringify(moodBody) }),
      env(store),
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the String(error) arm
      { fetchFn: () => Promise.reject('network down'), now: () => NOW_MS + 10 * PUSH_INTERVAL_MS },
    );
    expect(failing.status).toBe(502);
    expect(await failing.json()).toEqual({ error: 'apns', status: 0, reason: 'network down' });
  });

  test('mood: the sandbox host and a stub origin reach the same path', async () => {
    const { store, calls, post } = world();
    await post('/api/rps/pair', pairBody);
    await post('/api/rps/mood', moodBody, env(store, { APNS_HOST: 'http://127.0.0.1:8790/' }));
    expect(calls[0]?.url).toBe(`http://127.0.0.1:8790/3/device/${TOKEN}`);
  });
});
