// One browser context per player: its own seeded Math.random, the Peer recorder, the offline
// routes, and collectors for uncaught exceptions and failed requests. `openGame` navigates to a
// page on the current project with the harness's `?peer=` (local PeerServer) and `?ice=` (STUN-only
// fixture) hooks, so no spec needs the public broker or a real network; `{ relay: true }` adds the
// `?ice-policy=relay` hook for the relay-forced game and `{ ice: 'turn' }` names the ICE list with
// the harness's own TURN relay instead (e2e/fixtures/site.ts ICE_TURN_FIXTURE). The
// RTCPeerConnection recorder (e2e/browser/record-pc.js) lets a spec read the selected candidate
// pair off the real connection. Under `E2E_TARGET=live` the URL hooks stay off: the deployed pages
// meet on 0.peerjs.com and fetch their ICE servers from turn.sweedler.com, so `expectPeerOptions`
// checks the shape of what arrived rather than the fixture's exact bytes.
import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test';

import { ALLOWED_FAILURES, routeOffline } from './offline.ts';
import { readPeerCalls, type PeerCall } from './peer-calls.ts';
import { RECORD_PC_SCRIPT } from './peer-connections.ts';
import { RECORD_PEER_SCRIPT, seedFor, seedScript } from './seed.ts';
import {
  ICE_FIXTURE,
  ICE_TURN_FIXTURE,
  ICE_TURN_URL,
  ICE_URL,
  PEER_HOST,
  PEER_PORT,
  PEER_SERVER,
  isLive,
  pagePath,
  type PageName,
  type Project,
} from './site.ts';
import { watchPage, type Watched } from './watch.ts';

export type Role = 'host' | 'guest' | 'solo';

export type Player = Readonly<{
  role: Role;
  seed: number;
  context: BrowserContext;
  page: Page;
  watched: Watched;
  peerCalls: () => Promise<ReadonlyArray<PeerCall>>;
}>;

/**
 * `E2E_BROKER=cloud` drops `?peer=` so the pages use 0.peerjs.com (the advisory CI job `broker`);
 * a live run has no local PeerServer either.
 */
export const usesLocalBroker = (): boolean => process.env['E2E_BROKER'] !== 'cloud' && !isLive();

/**
 * Against the local PeerServer the seeds repeat from run to run. On the shared public broker two
 * overlapping runs with the same seeds would host the same room code, so cloud mode mixes in a
 * per-run salt: the Actions run id, or locally the worker's start time. Within a run every context
 * still derives from the same salt, so host and guest stay deterministic relative to each other.
 */
const RUN_SALT: ReadonlyArray<string> = usesLocalBroker()
  ? []
  : [process.env['GITHUB_RUN_ID'] ?? String(Date.now())];

/** Which ICE list `?ice=` names: the STUN-only fixture, or the one with the harness's TURN relay. */
export type IceList = 'stun' | 'turn';

export type GameHooks = Readonly<{
  /** Force every ICE candidate through TURN (`?ice-policy=relay`). */
  relay?: true;
  /** The ICE list (default `'stun'`); a relay-forced game needs `'turn'` to connect at all. */
  ice?: IceList;
}>;

const iceUrl = (hooks: GameHooks): string => (hooks.ice === 'turn' ? ICE_TURN_URL : ICE_URL);
const iceServers = (hooks: GameHooks): ReadonlyArray<unknown> =>
  hooks.ice === 'turn' ? ICE_TURN_FIXTURE.iceServers : ICE_FIXTURE.iceServers;

export const gameQuery = (hooks: GameHooks = {}): string => {
  // Live pages fetch turn.sweedler.com (the credentials the relay-forced game needs).
  const params = new URLSearchParams(isLive() ? {} : { ice: iceUrl(hooks) });
  if (usesLocalBroker()) params.set('peer', PEER_SERVER);
  if (hooks.relay === true) params.set('ice-policy', 'relay');
  const query = params.toString();
  return query === '' ? '' : `?${query}`;
};

export const newPlayer = async (
  browser: Browser,
  role: Role,
  testInfo: TestInfo,
): Promise<Player> => {
  const seed = seedFor([...RUN_SALT, testInfo.project.name, ...testInfo.titlePath, role]);
  const context = await browser.newContext();
  await context.addInitScript({ content: seedScript(seed) });
  await context.addInitScript({ path: RECORD_PEER_SCRIPT });
  await context.addInitScript({ path: RECORD_PC_SCRIPT });
  await routeOffline(context);
  const page = await context.newPage();
  const watched = watchPage(page, ALLOWED_FAILURES);
  return { role, seed, context, page, watched, peerCalls: () => readPeerCalls(page) };
};

/** Open a game page on `project` with the `?peer=` and `?ice=` hooks (relative to the project's baseURL). */
export const openGame = async (
  player: Player,
  project: Project,
  game: PageName,
  hooks: GameHooks = {},
): Promise<void> => {
  await player.page.goto(`${pagePath(project, game)}${gameQuery(hooks)}`);
};

/**
 * The PeerJS options a page must have built from the harness's URL: the ?ice= list (the STUN-only
 * fixture, or the TURN one when `{ ice: 'turn' }` opened the page) through HyperIce.peerConfig,
 * with `iceTransportPolicy` when `{ relay: true }` did, plus the ?peer= broker override unless the
 * run targets the cloud broker.
 */
const expectedPeerOptions = (
  debug: number,
  hooks: GameHooks,
): Readonly<Record<string, unknown>> => ({
  debug,
  config: {
    iceServers: iceServers(hooks),
    sdpSemantics: 'unified-plan',
    ...(hooks.relay === true ? { iceTransportPolicy: 'relay' } : {}),
  },
  ...(usesLocalBroker() ? { host: PEER_HOST, port: PEER_PORT, path: '/', secure: false } : {}),
});

const urlsOf = (server: unknown): ReadonlyArray<unknown> => {
  if (typeof server !== 'object' || server === null) return [];
  const urls: unknown = (server as Readonly<Record<string, unknown>>)['urls'];
  return Array.isArray(urls) ? urls : [urls];
};

/**
 * Assert the options a recorded `new Peer(...)` carried. Locally that is the fixture, byte for
 * byte. Live, the credentials come from turn.sweedler.com and change per fetch, so the check is
 * the shape: Cloudflare's STUN server, a TURN entry with username and credential, unified-plan,
 * the policy when forced, and no broker override.
 */
export const expectPeerOptions = (
  call: PeerCall | undefined,
  debug: number,
  hooks: GameHooks = {},
): void => {
  if (!isLive()) {
    expect(call?.options).toEqual(expectedPeerOptions(debug, hooks));
    return;
  }
  const options = call?.options ?? {};
  expect(Object.keys(options).sort()).toEqual(['config', 'debug']);
  expect(options['debug']).toBe(debug);
  const config = options['config'] as Readonly<Record<string, unknown>>;
  expect(config['sdpSemantics']).toBe('unified-plan');
  expect(config['iceTransportPolicy']).toBe(hooks.relay === true ? 'relay' : undefined);
  const servers: ReadonlyArray<unknown> = Array.isArray(config['iceServers'])
    ? config['iceServers']
    : [];
  expect(servers.flatMap(urlsOf)).toContain('stun:stun.cloudflare.com:3478');
  const turn = servers.filter((server) =>
    urlsOf(server).some((url) => typeof url === 'string' && /^turns?:/.test(url)),
  );
  expect(turn.length, 'a TURN entry from turn.sweedler.com').toBeGreaterThan(0);
  turn.forEach((server) => {
    expect(server).toMatchObject({ username: expect.any(String), credential: expect.any(String) });
  });
};
