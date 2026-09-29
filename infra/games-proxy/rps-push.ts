// The island scoreboard's push path (docs/ARCHITECTURE.md "The island scoreboard",
// docs/design/rps-island.md §8). A web page cannot draw in the Dynamic Island: a Live
// Activity is updated by its app or by an APNs push to the activity's push token. So the RPS game
// pairs with the Dice clip's activity through this Worker and posts each round's mood here; the
// Worker signs an APNs provider token and pushes the new content state to Apple.
//   POST /api/rps/pair            {session, token, bundle} -> 204; the clip posts its activity's
//                                 push token under the game's session id (24 h).
//   GET  /api/rps/pair/<session>  -> {paired: boolean}; the game polls it after opening the clip.
//   POST /api/rps/mood            {session, counter, prestige, band, at} -> 202 once Apple has
//                                 taken the push; 404 unpaired; 429 under 2 s since the last push;
//                                 502 with Apple's `reason` when it refuses (a 410, or
//                                 BadDeviceToken, also forgets the pair).
//   Any of them                   -> 503 "island pushes not configured" when the KV binding or an
//                                 APNS_* secret is missing (the proxy is untouched).
// Same-origin only: no CORS header is ever set, so only pages served by this Worker can call it.
// APNs facts, verified against Apple's documentation (2026-09-29):
//   - "Sending notification requests to APNs": POST /3/device/<device_token> on
//     https://api.push.apple.com:443 (production) or https://api.sandbox.push.apple.com:443
//     (development); `authorization: bearer <provider_token>`; `apns-push-type: liveactivity`, whose
//     `apns-topic` "must use your app's bundle ID with push-type.liveactivity appended";
//     `apns-priority` 5 "based on power considerations" (10 immediately); `apns-expiration: 0`
//     "attempts to deliver the notification only once and doesn't store it".
//   - "Establishing a token-based connection to APNs": a JWT signed ES256 (the only algorithm),
//     header {alg, kid: the 10-character Key ID}, claims {iss: the 10-character Team ID, iat:
//     seconds since Epoch}; APNs rejects an iat over an hour old, and a fresh token more than once
//     per 20 minutes on one connection: so one token is reused for JWT_LIFETIME_MS.
//   - "Starting and updating Live Activities with ActivityKit push notifications": payload
//     {"aps": {"timestamp": <seconds since 1970>, "event": "update", "content-state": {...}}}, the
//     content-state matching the activity's ContentState; the app gets the token from
//     Activity.request(pushType: .token) and Activity.pushTokenUpdates.
//   - "Handling notification responses from APNs": 410 "the device token is no longer active for
//     the topic"; an error body is {"reason": "<code>"} (plus "timestamp" on a 410);
//     BadDeviceToken "the specified device token is invalid".
// Effects (KV, WebCrypto, fetch, the clock) come in through PairStore and Deps; everything that
// shapes a request or a response is a pure function the tests call directly.

/** The Dice App Clip's bundle id (ios/DiceClip, PR #176): what the clip posts as `bundle`. */
export const CLIP_BUNDLE = 'com.sweedler.games.dice.Clip';

/** Where pushes go without an APNS_HOST var: the production APNs host (App Store and TestFlight builds). */
export const DEFAULT_APNS_HOST = 'api.push.apple.com';

/** The routes' prefix on this origin. */
export const RPS_PREFIX = '/api/rps/';

/** How long a pair lives: a day covers any session of the game. */
export const PAIR_TTL_SECONDS = 24 * 60 * 60;

/** Two pushes to one session are at least this far apart (the island lags; Apple budgets pushes per hour). */
export const PUSH_INTERVAL_MS = 2_000;

/** One provider token is reused this long: under Apple's hour, over its 20-minute minimum. */
export const JWT_LIFETIME_MS = 50 * 60 * 1_000;

/** The `last:` row's KV TTL (KV's minimum is 60 s; the 2 s rule is checked against the value). */
const LAST_TTL_SECONDS = 60;

// ASCII letters and digits, as docs/design/rps-island.md §8 mints them (the id is used verbatim by both halves).
const SESSION = /^[A-Za-z0-9]{8}$/;
const TOKEN = /^[0-9a-fA-F]{32,200}$/;
const BUNDLE = /^[A-Za-z0-9.-]{1,200}$/;

/** The five faces the clip draws, one per counter band (docs/design/rps-island.md). */
export type Band = 'verySad' | 'sad' | 'neutral' | 'happy' | 'veryHappy';
export const BANDS: ReadonlyArray<Band> = ['verySad', 'sad', 'neutral', 'happy', 'veryHappy'];

/** The activity's content state, key for key what the clip decodes. */
export type MoodState = Readonly<{ counter: number; prestige: number; band: Band; at: number }>;

/** What `pair:<session>` holds. `at` is unix seconds. */
export type Pair = Readonly<{ token: string; bundle: string; at: number }>;

/**
 * The slice of Cloudflare's KVNamespace the routes use; tools/proxy-dev.ts and the tests pass a
 * Map-backed one. `get` is the string form; `expirationTtl` is seconds.
 */
export type PairStore = Readonly<{
  get: (key: string) => Promise<string | null>;
  put: (
    key: string,
    value: string,
    options?: Readonly<{ expirationTtl?: number }>,
  ) => Promise<void>;
  delete: (key: string) => Promise<void>;
}>;

/** The bindings this module reads (wrangler.toml: the KV namespace, the var, the three secrets). */
export type RpsEnv = Readonly<{
  RPS_PAIRS?: PairStore;
  APNS_HOST?: string;
  APNS_TEAM_ID?: string;
  APNS_KEY_ID?: string;
  APNS_AUTH_KEY?: string;
}>;

/** The APNs side once configured: the three secrets and the host (a hostname, or an origin for a stub). */
export type Apns = Readonly<{ teamId: string; keyId: string; authKey: string; host: string }>;

export type Configured = Readonly<{ store: PairStore; apns: Apns }>;

/** The effects the routes need beyond the store: the fetch that reaches Apple, and the clock (ms). */
export type Deps = Readonly<{
  fetchFn: (url: string, init: Readonly<RequestInit>) => Promise<Response>;
  now: () => number;
}>;

const present = (value: string | undefined): value is string => value !== undefined && value !== '';

/** The store and the APNs config when every binding is there, else undefined (the routes answer 503). */
export const configured = (env: RpsEnv): Configured | undefined => {
  const {
    RPS_PAIRS: store,
    APNS_TEAM_ID: teamId,
    APNS_KEY_ID: keyId,
    APNS_AUTH_KEY: authKey,
  } = env;
  if (store === undefined || !present(teamId) || !present(keyId) || !present(authKey))
    return undefined;
  const host = present(env.APNS_HOST) ? env.APNS_HOST : DEFAULT_APNS_HOST;
  return { store, apns: { teamId, keyId, authKey, host } };
};

export const isRpsPath = (pathname: string): boolean => pathname.startsWith(RPS_PREFIX);

// ---- Parsing (pure) --------------------------------------------------------------------------

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isIntIn = (value: unknown, low: number, high: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= low && value <= high;

const isBand = (value: unknown): value is Band =>
  typeof value === 'string' && (BANDS as ReadonlyArray<string>).includes(value);

const matches = (value: unknown, shape: Readonly<RegExp>): value is string =>
  typeof value === 'string' && shape.test(value);

export type PairRequest = Readonly<{ session: string; token: string; bundle: string }>;

/** The pair body when it has the shape `{session, token, bundle}`, else undefined. */
export const parsePair = (body: unknown): PairRequest | undefined => {
  if (!isRecord(body)) return undefined;
  const { session, token, bundle } = body;
  if (!matches(session, SESSION) || !matches(token, TOKEN) || !matches(bundle, BUNDLE))
    return undefined;
  return { session, token, bundle };
};

export type MoodRequest = Readonly<{ session: string; state: MoodState }>;

/** The mood body when it has the shape `{session, counter, prestige, band, at}`, else undefined. */
export const parseMood = (body: unknown): MoodRequest | undefined => {
  if (!isRecord(body)) return undefined;
  const { session, counter, prestige, band, at } = body;
  if (!matches(session, SESSION)) return undefined;
  if (!isIntIn(counter, -5, 5) || !isIntIn(prestige, 0, 99) || !isBand(band)) return undefined;
  if (!isIntIn(at, 0, Number.MAX_SAFE_INTEGER)) return undefined;
  return { session, state: { counter, prestige, band, at } };
};

/** A stored pair row read back, or undefined when the row is not one (treated as unpaired). */
export const parseStoredPair = (raw: string): Pair | undefined => {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value)) return undefined;
    const { token, bundle, at } = value;
    if (!matches(token, TOKEN) || !matches(bundle, BUNDLE) || typeof at !== 'number')
      return undefined;
    return { token, bundle, at };
  } catch {
    return undefined;
  }
};

export const pairKey = (session: string): string => `pair:${session}`;
export const lastKey = (session: string): string => `last:${session}`;

// ---- The provider token ----------------------------------------------------------------------

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/** RFC 7515 base64url: no padding, `-` and `_`. */
export const base64url = (bytes: Readonly<Uint8Array>): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** The DER bytes of a PEM block (Apple's .p8 is a PKCS#8 PRIVATE KEY block). */
export const pemToDer = (pem: string): Uint8Array =>
  Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) =>
    c.charCodeAt(0),
  );

/**
 * A fresh ES256 JWT for Apple: header {alg, kid}, claims {iss, iat}, signed with the .p8 key.
 * WebCrypto's ECDSA signature is the raw r||s pair, which is exactly the JWS ES256 form.
 */
export const signApnsJwt = async (apns: Apns, nowMs: number): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(apns.authKey),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const header = base64url(utf8(JSON.stringify({ alg: 'ES256', kid: apns.keyId })));
  const claims = base64url(
    utf8(JSON.stringify({ iss: apns.teamId, iat: Math.floor(nowMs / 1_000) })),
  );
  const signingInput = `${header}.${claims}`;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    utf8(signingInput),
  );
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
};

type CachedJwt = Readonly<{ token: string; issuedMs: number }>;

/** One token per key id, reused for JWT_LIFETIME_MS: the module lives as long as the isolate does. */
const jwtCache = new Map<string, CachedJwt>();

/** The cached provider token for `apns.keyId` when it is under JWT_LIFETIME_MS old, else a new one. */
export const apnsJwt = async (apns: Apns, nowMs: number): Promise<string> => {
  const hit = jwtCache.get(apns.keyId);
  if (hit !== undefined && nowMs - hit.issuedMs < JWT_LIFETIME_MS) return hit.token;
  const token = await signApnsJwt(apns, nowMs);
  // eslint-disable-next-line functional/immutable-data -- the cache above
  jwtCache.set(apns.keyId, { token, issuedMs: nowMs });
  return token;
};

// ---- The push --------------------------------------------------------------------------------

/** `https://` in front of a bare hostname; an origin with its scheme (tools/proxy-dev.ts's stub) as it is. */
export const apnsOrigin = (host: string): string =>
  host.includes('://') ? host.replace(/\/+$/, '') : `https://${host}`;

export type Push = Readonly<{
  url: string;
  headers: Readonly<Record<string, string>>;
  body: string;
}>;

/** The APNs request for a mood, header for header what Apple's docs ask (the file header). */
export const moodPush = (
  host: string,
  pair: Pair,
  state: MoodState,
  jwt: string,
  nowMs: number,
): Push => ({
  url: `${apnsOrigin(host)}/3/device/${pair.token}`,
  headers: {
    authorization: `bearer ${jwt}`,
    'apns-topic': `${pair.bundle}.push-type.liveactivity`,
    'apns-push-type': 'liveactivity',
    'apns-priority': '5',
    'apns-expiration': '0',
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    aps: { timestamp: Math.floor(nowMs / 1_000), event: 'update', 'content-state': state },
  }),
});

export type PushResult =
  Readonly<{ ok: true }> | Readonly<{ ok: false; status: number; reason: string; gone: boolean }>;

/** Apple's `reason`, or the status when the body is not an error record. */
const apnsReason = async (response: Response): Promise<string> => {
  try {
    const body: unknown = await response.json();
    return isRecord(body) && typeof body['reason'] === 'string'
      ? body['reason']
      : `HTTP ${String(response.status)}`;
  } catch {
    return `HTTP ${String(response.status)}`;
  }
};

/** Send one mood to the pair's activity. `gone` says the token is dead (a 410, or BadDeviceToken). */
export const pushMood = async (
  apns: Apns,
  pair: Pair,
  state: MoodState,
  fetchFn: Deps['fetchFn'],
  nowMs: number,
): Promise<PushResult> => {
  const jwt = await apnsJwt(apns, nowMs);
  const push = moodPush(apns.host, pair, state, jwt, nowMs);
  const response = await fetchFn(push.url, {
    method: 'POST',
    headers: push.headers,
    body: push.body,
  });
  if (response.ok) return { ok: true };
  const reason = await apnsReason(response);
  return {
    ok: false,
    status: response.status,
    reason,
    gone: response.status === 410 || reason === 'BadDeviceToken',
  };
};

// ---- The routes ------------------------------------------------------------------------------

const NO_STORE: Readonly<Record<string, string>> = { 'cache-control': 'no-store' };

const json = (
  status: number,
  body: unknown,
  extra: Readonly<Record<string, string>> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...NO_STORE, 'content-type': 'application/json; charset=utf-8', ...extra },
  });

/** The request's JSON body, or undefined when there is none or it does not parse. */
const readJson = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
};

/** POST /api/rps/pair: the clip stores its activity's push token under the game's session. */
export const pairRoute = async (
  request: Request,
  store: PairStore,
  nowMs: number,
): Promise<Response> => {
  const parsed = parsePair(await readJson(request));
  if (parsed === undefined) return json(400, { error: 'expected {session, token, bundle}' });
  const pair: Pair = { token: parsed.token, bundle: parsed.bundle, at: Math.floor(nowMs / 1_000) };
  await store.put(pairKey(parsed.session), JSON.stringify(pair), {
    expirationTtl: PAIR_TTL_SECONDS,
  });
  return new Response(null, { status: 204, headers: NO_STORE });
};

/** GET /api/rps/pair/<session>: whether the clip has posted a token for the session. */
export const pairedRoute = async (session: string, store: PairStore): Promise<Response> => {
  if (!SESSION.test(session)) return json(400, { error: 'session is 8 of [A-Za-z0-9]' });
  const raw = await store.get(pairKey(session));
  return json(200, { paired: raw !== null && parseStoredPair(raw) !== undefined });
};

/** POST /api/rps/mood: push the round's mood to the paired activity (the file header's statuses). */
export const moodRoute = async (
  request: Request,
  { store, apns }: Configured,
  deps: Deps,
): Promise<Response> => {
  const parsed = parseMood(await readJson(request));
  if (parsed === undefined)
    return json(400, { error: 'expected {session, counter -5..5, prestige 0..99, band, at}' });
  const { session, state } = parsed;
  const raw = await store.get(pairKey(session));
  const pair = raw === null ? undefined : parseStoredPair(raw);
  if (pair === undefined) return json(404, { error: 'unpaired' });
  const nowMs = deps.now();
  const last = await store.get(lastKey(session));
  if (last !== null && nowMs - Number(last) < PUSH_INTERVAL_MS)
    return json(429, { error: 'a push went out under 2 s ago' }, { 'retry-after': '2' });
  await store.put(lastKey(session), String(nowMs), { expirationTtl: LAST_TTL_SECONDS });
  const result = await pushMood(apns, pair, state, deps.fetchFn, nowMs).catch(
    (error: unknown): PushResult => ({
      ok: false,
      status: 0,
      reason: error instanceof Error ? error.message : String(error),
      gone: false,
    }),
  );
  if (result.ok) return json(202, { pushed: true });
  if (result.gone) await store.delete(pairKey(session));
  return json(502, { error: 'apns', status: result.status, reason: result.reason });
};

const methodNotAllowed = (allow: string): Response =>
  json(405, { error: `use ${allow}` }, { allow });

/** Every /api/rps/* request: the file header's table. `env` may be empty (then every route is a 503). */
export const handleRps = async (request: Request, env: RpsEnv, deps: Deps): Promise<Response> => {
  const config = configured(env);
  if (config === undefined) return json(503, { error: 'island pushes not configured' });
  const rest = new URL(request.url).pathname.slice(RPS_PREFIX.length);
  if (rest === 'pair')
    return request.method === 'POST'
      ? pairRoute(request, config.store, deps.now())
      : methodNotAllowed('POST');
  if (rest.startsWith('pair/'))
    return request.method === 'GET'
      ? pairedRoute(rest.slice('pair/'.length), config.store)
      : methodNotAllowed('GET');
  if (rest === 'mood')
    return request.method === 'POST' ? moodRoute(request, config, deps) : methodNotAllowed('POST');
  return json(404, { error: 'no such route' });
};
