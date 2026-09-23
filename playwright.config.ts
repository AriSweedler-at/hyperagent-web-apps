// Browser harness (docs/ARCHITECTURE.md "Testing pyramid", "Two origins"). Two projects: `pages`
// (GitHub Pages emulated by tools/serve-dist.ts, dist/ under /hyperagent-web-apps/ on :4173) and
// `proxy` (games.sweedler.com emulated by tools/proxy-dev.ts on :8787, running the real Worker
// against :4173). A spec about an origin (the smoke test, the two-peer games, the resume, the
// handoff's invite link, the relay-forced games) runs on both; a spec about the page alone (the
// hand's geometry and flows, the stories, the scorer, the two parity oracles) runs on `pages`
// only (PAGE_ONLY_SPECS), since both origins serve the same bytes and the second run only cost CI
// minutes. Every port here is e2e/fixtures/site.ts PORTS, the bases named above
// plus `E2E_PORT_OFFSET`, so a second run can sit beside one that holds the defaults. dist/ is the
// only tree since docs/MIGRATION.md step 13 cut the last page over (the dark `next` project that
// played a port before its flip is retired); the pages origin also publishes the frozen legacy gin
// page under legacy/ through serve-dist aliases for e2e/gin-dom-parity.spec.ts. The specs exercise
// the built site: `npm run test:e2e` is `npm run build && playwright test`, so dist/ is fresh; a
// bare `playwright test` reuses it. Online specs meet on a local PeerServer (`peer` package) on
// :9000, which the pages reach through their `?peer=` hook; `E2E_BROKER=cloud` leaves it out so
// the advisory CI job `broker` plays through 0.peerjs.com instead. `E2E_TARGET=deployed`
// (.github/workflows/nightly.yml) makes the deployed GitHub Pages page the subject: `pages` is the
// deployed origin (e2e/fixtures/site.ts DEPLOYED_PAGES_ORIGIN), there is no `proxy` project (that
// origin is a Cloudflare Worker, and no test depends on Cloudflare: issue #19), proxy-dev is not
// started, and the deployed page reaches this same serve-dist, PeerServer and TURN relay through
// its hooks; specs about the local build skip themselves with a reason. The @relay specs (gin and
// fidice with `?ice-policy=relay`) relay through a coturn of the harness's own on :3478
// (`turnserver` on PATH, else they skip with the install line; `E2E_TURN=off` leaves it out),
// reached through an ICE list this file writes under e2e/fixtures/.generated/ because the relay's
// port follows the offset.
import { mkdirSync, writeFileSync } from 'node:fs';

import { defineConfig } from '@playwright/test';

import {
  GENERATED_DIR,
  ICE_TURN_FILE,
  ICE_TURN_FIXTURE,
  LEGACY_ALIASES,
  PAGES_BASE_PATH,
  PAGES_ORIGIN,
  PEER_HOST,
  PEER_PORT,
  PEER_SERVER,
  PORTS,
  PROJECTS,
  PROXY_ORIGIN,
  TURN_SKIP_REASON,
  baseUrl,
  isDeployed,
  turnServerCommand,
  turnStatus,
} from './e2e/fixtures/site.ts';

const CI = process.env['CI'] !== undefined && process.env['CI'] !== '';
/** Specs about the page alone, not its origin: they run on `pages` only. */
const PAGE_ONLY_SPECS: ReadonlyArray<string> = [
  '**/computed-styles.spec.ts',
  '**/gin-drag-discard.spec.ts',
  '**/gin-arrange.spec.ts',
  '**/gin-card-back.spec.ts',
  '**/gin-discard.spec.ts',
  '**/gin-dom-parity.spec.ts',
  '**/gin-draw.spec.ts',
  '**/gin-geometry.spec.ts',
  '**/gin-home.spec.ts',
  '**/gin-layoff.spec.ts',
  '**/gin-local.spec.ts',
  '**/gin-sandbox.spec.ts',
  '**/gin-scorer.spec.ts',
  '**/gin-sound-font.spec.ts',
  '**/gin-stories.spec.ts',
];
const deployed = isDeployed();
const cloudBroker = process.env['E2E_BROKER'] === 'cloud';
// The local TURN relay: coturn when installed, unless asked off. CI installs coturn, so a missing
// binary there is a broken job, not a skip.
const turn = turnStatus();
if (CI && turn === 'missing') throw new Error(TURN_SKIP_REASON.missing);
// The ICE list naming the relay is written per run: its port is PORTS.turn, offset included.
mkdirSync(GENERATED_DIR, { recursive: true });
writeFileSync(ICE_TURN_FILE, `${JSON.stringify(ICE_TURN_FIXTURE, null, 2)}\n`);
const node = 'node --experimental-strip-types';
/** The two e2e ICE lists and, on the pages origin, the frozen legacy gin page for the DOM-parity spec. */
const aliasArgs = (aliases: Readonly<Record<string, string>>): string =>
  Object.entries(aliases)
    .map(([path, file]) => `--alias ${path}=${file}`)
    .join(' ');
const pagesAliases = aliasArgs({
  'e2e-ice.json': 'e2e/fixtures/e2e-ice.json',
  'e2e-ice-turn.json': ICE_TURN_FILE,
  ...LEGACY_ALIASES,
});

export default defineConfig({
  testDir: 'e2e',
  // WebRTC between two contexts has real network latency even on one machine; the fixtures bound
  // each step (e2e/fixtures/timeouts.ts) and this is the whole-test ceiling.
  timeout: 90_000,
  expect: { timeout: 10_000 },
  retries: 1,
  // Playwright's CI default is one worker; the runner has four cores and every spec starts its own
  // browser contexts against the shared servers, so four run side by side.
  ...(CI ? { workers: 4 } : {}),
  forbidOnly: CI,
  reporter: [['list'], ['html', { open: 'never' }]],
  // Screenshot baselines (e2e/gin-stories.spec.ts) are committed per platform, since Chromium's
  // text rendering differs between macOS and the linux runner: `<story>--<viewport>-darwin.png`
  // is recorded locally, `-linux.png` by .github/workflows/stories-baselines.yml on the branch.
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFileName}/{arg}-{platform}{ext}',
  use: {
    browserName: 'chromium',
    trace: 'on-first-retry',
    launchOptions: {
      // Host candidates carry real local addresses (not mDNS names) so two contexts in one browser
      // can pair; --no-first-run keeps Chromium quiet.
      args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--no-first-run'],
    },
  },
  projects: PROJECTS.map((name) => ({
    name,
    use: { baseURL: baseUrl(name) },
    ...(name === 'proxy' ? { testIgnore: [...PAGE_ONLY_SPECS] } : {}),
  })),
  webServer: [
    // Deployed, serve-dist still runs: it is where the deployed page fetches its `?ice=` lists.
    {
      command: `${node} tools/serve-dist.ts --root dist --base ${PAGES_BASE_PATH} ${pagesAliases} --port ${String(PORTS.pages)}`,
      url: `${PAGES_ORIGIN}${PAGES_BASE_PATH}`,
      reuseExistingServer: !CI,
      timeout: 30_000,
    },
    ...(deployed
      ? []
      : [
          {
            command: `${node} tools/proxy-dev.ts --upstream ${PAGES_ORIGIN} --port ${String(PORTS.proxy)}`,
            url: `${PROXY_ORIGIN}/`,
            reuseExistingServer: !CI,
            timeout: 30_000,
          },
        ]),
    ...(cloudBroker
      ? []
      : [
          {
            command: `peerjs --host ${PEER_HOST} --port ${String(PEER_PORT)} --path /`,
            url: `http://${PEER_SERVER}/`,
            reuseExistingServer: !CI,
            timeout: 30_000,
          },
        ]),
    // Readiness by port: coturn answers on TCP too, and an HTTP probe has nothing to fetch.
    ...(turn === 'on'
      ? [
          {
            command: turnServerCommand(),
            port: PORTS.turn,
            reuseExistingServer: !CI,
            timeout: 30_000,
          },
        ]
      : []),
  ],
});
