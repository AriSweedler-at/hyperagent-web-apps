// Browser harness (docs/ARCHITECTURE.md "Testing pyramid", "Two origins"). Every spec runs on two
// projects: `pages` (GitHub Pages emulated by tools/serve-dist.ts, dist/ under /hyperagent-web-apps/
// on :4173) and `proxy` (games.sweedler.com emulated by tools/proxy-dev.ts on :8787, running the
// real Worker against :4173). Every port here is e2e/fixtures/site.ts PORTS, the bases named above
// plus `E2E_PORT_OFFSET`, so a second run can sit beside one that holds the defaults. dist/ is the
// only tree since docs/MIGRATION.md step 13 cut the last page over (the dark `next` project that
// played a port before its flip is retired); the pages origin also publishes the frozen legacy gin
// page under legacy/ through serve-dist aliases for e2e/gin-dom-parity.spec.ts. The specs exercise
// the built site: `npm run test:e2e` is `npm run build && playwright test`, so dist/ is fresh; a
// bare `playwright test` reuses it. Online specs meet on a local PeerServer (`peer` package) on
// :9000, which the pages reach through their `?peer=` hook; `E2E_BROKER=cloud` leaves it out so
// the advisory CI job `broker` plays through 0.peerjs.com instead. `E2E_TARGET=live`
// (.github/workflows/nightly.yml) aims both projects at the deployed origins (e2e/fixtures/site.ts
// LIVE_ORIGINS), starts nothing local and implies the cloud broker; specs that need the local
// servers skip themselves with a reason. The @relay specs (gin and fidice with `?ice-policy=relay`)
// relay through a coturn of the harness's own on :3478 (`turnserver` on PATH, else they skip with
// the install line; `E2E_TURN=off` leaves it out), reached through an ICE list this file writes
// under e2e/fixtures/.generated/ because the relay's port follows the offset.
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
  PROXY_ORIGIN,
  TURN_SKIP_REASON,
  baseUrl,
  isLive,
  turnServerCommand,
  turnStatus,
} from './e2e/fixtures/site.ts';

const CI = process.env['CI'] !== undefined && process.env['CI'] !== '';
const live = isLive();
// A live run meets on 0.peerjs.com: no PeerServer to start, and the fixtures drop `?peer=` too.
if (live) process.env['E2E_BROKER'] = 'cloud';
const cloudBroker = process.env['E2E_BROKER'] === 'cloud';
// The local TURN relay: coturn when installed, unless asked off; a live run relays through
// turn.sweedler.com. CI installs coturn, so a missing binary there is a broken job, not a skip.
const turn = live ? 'off' : turnStatus();
if (CI && turn === 'missing') throw new Error(TURN_SKIP_REASON.missing);
// The ICE list naming the relay is written per run: its port is PORTS.turn, offset included.
if (!live) {
  mkdirSync(GENERATED_DIR, { recursive: true });
  writeFileSync(ICE_TURN_FILE, `${JSON.stringify(ICE_TURN_FIXTURE, null, 2)}\n`);
}
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
  projects: [
    { name: 'pages', use: { baseURL: baseUrl('pages') } },
    { name: 'proxy', use: { baseURL: baseUrl('proxy') } },
  ],
  webServer: live
    ? []
    : [
        {
          command: `${node} tools/serve-dist.ts --root dist --base ${PAGES_BASE_PATH} ${pagesAliases} --port ${String(PORTS.pages)}`,
          url: `${PAGES_ORIGIN}${PAGES_BASE_PATH}`,
          reuseExistingServer: !CI,
          timeout: 30_000,
        },
        {
          command: `${node} tools/proxy-dev.ts --upstream ${PAGES_ORIGIN} --port ${String(PORTS.proxy)}`,
          url: `${PROXY_ORIGIN}/`,
          reuseExistingServer: !CI,
          timeout: 30_000,
        },
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
