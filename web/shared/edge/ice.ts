// ICE (STUN/TURN) configuration: the TypeScript port of legacy/shared/ice.js, behaviour for
// behaviour (test/parity/ice.legacy.test.ts runs the same fixture responses through both). Why it
// exists: two devices behind symmetric NAT need a TURN relay, and relay credentials come from an
// endpoint the owner runs (README "Online play (TURN relay)"), fetched at connect time.
//
// The endpoint answers with either a bare array `[ { urls, username, credential }, ... ]` or an
// object `{ iceServers: [...] }`. `load` never rejects: any failure resolves to the STUN-only
// fallback with `error` set so the page can warn the player. Results are cached for ten minutes
// per URL so a reconnect reuses the same credentials. `?ice=<url>` on the page overrides the
// endpoint for testing. `fetch`, the clock and `location.search` are injected so every branch
// (timeout, cache expiry, override) is driven by hand in tests.
import type { Clock } from '../lib/clock.ts';
import { realClock } from './clock.ts';

export const ICE_CONFIG_URL = 'https://turn.sweedler.com';
export const FETCH_TIMEOUT_MS = 4000;
/** Reconnects within 10 min reuse the same credentials. */
export const CACHE_TTL_MS = 10 * 60 * 1000;

export type IceServer = Readonly<{
  urls: string | ReadonlyArray<string>;
  username?: string;
  credential?: string;
}>;

/**
 * STUN-only fallback. Lets same-network / friendly-NAT peers connect when no relay is configured
 * or the credential endpoint is unreachable. Not enough for cellular <-> corporate; `hasTurn`
 * tells the app so it can warn the player.
 */
export const FALLBACK_ICE: ReadonlyArray<IceServer> = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

export type IceResult = Readonly<{
  iceServers: ReadonlyArray<IceServer>;
  source: 'remote' | 'fallback';
  hasTurn: boolean;
  error: string | null;
}>;

export type IceLoadOptions = Readonly<{
  /** Endpoint to use instead of the configured (or `?ice=`) one. */
  url?: string;
  /** Skip the cache. */
  force?: boolean;
  timeoutMs?: number;
}>;

export type PeerIceConfig = Readonly<{
  iceServers: ReadonlyArray<IceServer>;
  sdpSemantics: 'unified-plan';
}>;

export type PathDescription = Readonly<{
  path: 'direct' | 'relay' | 'unknown';
  local: string | null;
  remote: string | null;
}>;

export type ConnectionStates = Readonly<{ ice: string; conn: string }>;

/** The subset of `Response` the loader reads. */
export type ResponseLike = Readonly<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** `fetch` narrowed to how the loader calls it, so a test stub is a one-liner. */
export type FetchLike = (
  url: string,
  init: Readonly<{ signal: AbortSignal; cache: 'no-store' }>,
) => Promise<ResponseLike>;

/** One entry of an RTCStatsReport, as far as `describe` reads it. */
export type StatLike = Readonly<{
  id: string;
  type: string;
  selectedCandidatePairId?: string;
  selected?: boolean;
  nominated?: boolean;
  state?: string;
  localCandidateId?: string;
  remoteCandidateId?: string;
  candidateType?: string;
}>;

export type StatsReportLike = Readonly<{ forEach: (fn: (stat: StatLike) => void) => void }>;

/** The subset of RTCPeerConnection `describe` and `watch` use. */
export type PeerConnectionLike = Readonly<{
  getStats: () => Promise<StatsReportLike>;
  iceConnectionState: string;
  connectionState: string;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}>;

export type IceDeps = Readonly<{
  fetch: FetchLike;
  clock: Clock;
  /** The page's `location.search`, read on every `load` (the `?ice=` override). */
  search: () => string;
  /** The configured endpoint; defaults to ICE_CONFIG_URL. Tests set it empty to reach that branch. */
  endpoint?: string;
}>;

export type Ice = Readonly<{
  /** Resolve the ICE server list. Never rejects: on any failure resolves to the STUN fallback. */
  load: (opts?: IceLoadOptions) => Promise<IceResult>;
  /** RTCConfiguration for PeerJS's `config` option. */
  peerConfig: (result: IceResult | null | undefined) => PeerIceConfig;
  /** Inspect the selected candidate pair: was the connection direct or relayed through TURN? */
  describe: (pc: PeerConnectionLike | null | undefined) => Promise<PathDescription>;
  /** Report ICE / connection state transitions so the UI can explain stalls; returns the unsubscribe. */
  watch: (
    pc: PeerConnectionLike | null | undefined,
    cb: (states: ConnectionStates) => void,
  ) => () => void;
}>;

const UNKNOWN_PATH: PathDescription = { path: 'unknown', local: null, remote: null };

/** `?ice=<http(s) url>` wins over the configured endpoint. */
export const configUrl = (search: string, endpoint: string = ICE_CONFIG_URL): string => {
  const q = new URLSearchParams(search).get('ice');
  return q !== null && /^https?:\/\//.test(q) ? q : endpoint;
};

export const isTurn = (server: IceServer): boolean => {
  const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
  return urls.some((u) => typeof u === 'string' && /^turns?:/i.test(u));
};

const hasUsableUrls = (s: unknown): s is IceServer => {
  if (typeof s !== 'object' || s === null) return false;
  const urls: unknown = (s as Readonly<Record<string, unknown>>)['urls'];
  return (typeof urls === 'string' && urls !== '') || Array.isArray(urls);
};

/** Both payload shapes to a non-empty server list, or the legacy error message. */
export const normalize = (body: unknown): ReadonlyArray<IceServer> => {
  const list: ReadonlyArray<unknown> | null = Array.isArray(body)
    ? body
    : typeof body === 'object' &&
        body !== null &&
        Array.isArray((body as Readonly<Record<string, unknown>>)['iceServers'])
      ? ((body as Readonly<Record<string, unknown>>)['iceServers'] as ReadonlyArray<unknown>)
      : null;
  if (list === null) throw new Error('ICE endpoint returned neither an array nor {iceServers}');
  const servers = list.filter(hasUsableUrls);
  if (servers.length === 0) throw new Error('ICE endpoint returned no usable servers');
  return servers;
};

const fallback = (error: string | null): IceResult => ({
  iceServers: [...FALLBACK_ICE],
  source: 'fallback',
  hasTurn: false,
  error: error !== null && error !== '' ? error : null,
});

const errorText = (e: unknown): string => {
  if (typeof e === 'object' && e !== null) {
    const { name, message } = e as Readonly<{ name?: unknown; message?: unknown }>;
    if (name === 'AbortError') return 'ICE endpoint timed out';
    if (typeof message === 'string' && message !== '') return message;
  }
  return String(e);
};

/** RTCConfiguration for PeerJS's `config` option (legacy `HyperIce.peerConfig`). */
export const peerConfig = (result: IceResult | null | undefined): PeerIceConfig => ({
  iceServers: result?.iceServers ?? [...FALLBACK_ICE],
  sdpSemantics: 'unified-plan',
});

type Cache = Readonly<{ url: string; at: number; result: IceResult }>;

export const createIce = (deps: IceDeps): Ice => {
  let cache: Cache | null = null;

  const fetchWithTimeout = (url: string, ms: number): Promise<unknown> => {
    const ctrl = new AbortController();
    const timer = deps.clock.setTimeout(() => {
      ctrl.abort();
    }, ms);
    return deps
      .fetch(url, { signal: ctrl.signal, cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`ICE endpoint HTTP ${String(r.status)}`);
        return r.json();
      })
      .finally(() => {
        deps.clock.clearTimeout(timer);
      });
  };

  const load = (opts: IceLoadOptions = {}): Promise<IceResult> => {
    const url =
      opts.url !== undefined && opts.url !== ''
        ? opts.url
        : configUrl(deps.search(), deps.endpoint ?? ICE_CONFIG_URL);
    if (url === '')
      return Promise.resolve(fallback('No ICE_CONFIG_URL configured (shared/ice.js)'));
    const now = deps.clock.now();
    const hit = cache;
    if (opts.force !== true && hit !== null && hit.url === url && now - hit.at < CACHE_TTL_MS)
      return Promise.resolve(hit.result);
    const timeoutMs =
      opts.timeoutMs !== undefined && opts.timeoutMs !== 0 ? opts.timeoutMs : FETCH_TIMEOUT_MS;
    return fetchWithTimeout(url, timeoutMs)
      .then((body) => {
        const servers = normalize(body);
        const result: IceResult = {
          iceServers: servers,
          source: 'remote',
          hasTurn: servers.some(isTurn),
          error: null,
        };
        cache = { url, at: deps.clock.now(), result };
        return result;
      })
      .catch((e: unknown) => fallback(errorText(e)));
  };

  const describe = (pc: PeerConnectionLike | null | undefined): Promise<PathDescription> => {
    if (pc === null || pc === undefined) return Promise.resolve(UNKNOWN_PATH);
    return pc
      .getStats()
      .then((stats) => {
        const all: StatLike[] = [];
        stats.forEach((s) => all.push(s));
        const byId = new Map(all.map((s) => [s.id, s] as const));
        // The legacy loop let the last matching transport win and the first matching pair.
        const viaTransport = all
          .filter(
            (s) =>
              s.type === 'transport' &&
              s.selectedCandidatePairId !== undefined &&
              s.selectedCandidatePairId !== '' &&
              byId.has(s.selectedCandidatePairId),
          )
          .at(-1);
        const pair =
          viaTransport?.selectedCandidatePairId !== undefined
            ? byId.get(viaTransport.selectedCandidatePairId)
            : all.find(
                (s) =>
                  s.type === 'candidate-pair' &&
                  (s.selected === true || s.nominated === true) &&
                  s.state === 'succeeded',
              );
        if (pair === undefined) return UNKNOWN_PATH;
        const lt = candidateType(byId, pair.localCandidateId);
        const rt = candidateType(byId, pair.remoteCandidateId);
        const path: PathDescription['path'] =
          lt === 'relay' || rt === 'relay'
            ? 'relay'
            : lt !== null && rt !== null
              ? 'direct'
              : 'unknown';
        return { path, local: lt, remote: rt };
      })
      .catch(() => UNKNOWN_PATH);
  };

  const watch = (
    pc: PeerConnectionLike | null | undefined,
    cb: (states: ConnectionStates) => void,
  ): (() => void) => {
    if (pc === null || pc === undefined) return () => undefined;
    const emit = (): void => {
      cb({ ice: pc.iceConnectionState, conn: pc.connectionState });
    };
    pc.addEventListener('iceconnectionstatechange', emit);
    pc.addEventListener('connectionstatechange', emit);
    return () => {
      pc.removeEventListener('iceconnectionstatechange', emit);
      pc.removeEventListener('connectionstatechange', emit);
    };
  };

  return { load, peerConfig, describe, watch };
};

/** The candidate's type, or null when the id or the type is missing or empty (legacy `lt || null`). */
const candidateType = (
  byId: ReadonlyMap<string, StatLike>,
  id: string | undefined,
): string | null => {
  const type = id === undefined ? undefined : byId.get(id)?.candidateType;
  return type !== undefined && type !== '' ? type : null;
};

/** The real dependencies: global `fetch`, the real clock and the page's query string. */
export const browserIceDeps = (): IceDeps => ({
  fetch: (url, init) => globalThis.fetch(url, init),
  clock: realClock,
  search: () =>
    (globalThis as Readonly<{ location?: Readonly<{ search: string }> }>).location?.search ?? '',
});
