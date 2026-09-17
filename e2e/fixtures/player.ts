// One browser context per player: its own seeded Math.random, the Peer recorder, the offline
// routes, and collectors for uncaught exceptions and failed requests. `openGame` navigates to a
// page on the current project with the harness's `?peer=` (local PeerServer) and `?ice=` (STUN-only
// fixture) hooks, so no spec needs the public broker or a real network.
import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test';

import { ALLOWED_FAILURES, routeOffline } from './offline.ts';
import { readPeerCalls, type PeerCall } from './peer-calls.ts';
import { RECORD_PEER_SCRIPT, seedFor, seedScript } from './seed.ts';
import {
  ICE_FIXTURE,
  ICE_URL,
  PEER_HOST,
  PEER_PORT,
  PEER_SERVER,
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

/** `E2E_BROKER=cloud` drops `?peer=` so the pages use 0.peerjs.com (the advisory CI job `broker`). */
export const usesLocalBroker = (): boolean => process.env['E2E_BROKER'] !== 'cloud';

export const gameQuery = (): string => {
  const params = new URLSearchParams({ ice: ICE_URL });
  if (usesLocalBroker()) params.set('peer', PEER_SERVER);
  return `?${params.toString()}`;
};

export const newPlayer = async (
  browser: Browser,
  role: Role,
  testInfo: TestInfo,
): Promise<Player> => {
  const seed = seedFor([testInfo.project.name, ...testInfo.titlePath, role]);
  const context = await browser.newContext();
  await context.addInitScript({ content: seedScript(seed) });
  await context.addInitScript({ path: RECORD_PEER_SCRIPT });
  await routeOffline(context);
  const page = await context.newPage();
  const watched = watchPage(page, ALLOWED_FAILURES);
  return { role, seed, context, page, watched, peerCalls: () => readPeerCalls(page) };
};

/** Open a game page on `project` with the `?peer=` and `?ice=` hooks (relative to the project's baseURL). */
export const openGame = async (player: Player, project: Project, game: PageName): Promise<void> => {
  await player.page.goto(`${pagePath(project, game)}${gameQuery()}`);
};

/**
 * The PeerJS options a page must have built from the harness's URL: the ?ice= fixture through
 * HyperIce.peerConfig, plus the ?peer= broker override unless the run targets the cloud broker.
 */
export const expectedPeerOptions = (debug: number): Readonly<Record<string, unknown>> => ({
  debug,
  config: { iceServers: ICE_FIXTURE.iceServers, sdpSemantics: 'unified-plan' },
  ...(usesLocalBroker() ? { host: PEER_HOST, port: PEER_PORT, path: '/', secure: false } : {}),
});
