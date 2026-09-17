// Browser harness (docs/ARCHITECTURE.md "Testing pyramid", "Two origins"). Every spec runs on two
// projects: `pages` (GitHub Pages emulated by tools/serve-dist.ts, dist/ under /hyperagent-web-apps/
// on :4173) and `proxy` (games.sweedler.com emulated by tools/proxy-dev.ts on :8787, running the
// real Worker against :4173). The specs exercise the built site: `npm run test:e2e` is
// `npm run build && playwright test`, so dist/ is fresh; a bare `playwright test` reuses it. Online specs meet on a local PeerServer (`peer` package) on :9000,
// which the pages reach through their `?peer=` hook; `E2E_BROKER=cloud` leaves it out so the
// advisory CI job `broker` plays through 0.peerjs.com instead.
import { defineConfig } from '@playwright/test';

import {
  PAGES_BASE_PATH,
  PAGES_ORIGIN,
  PEER_HOST,
  PEER_PORT,
  PEER_SERVER,
  PROXY_ORIGIN,
} from './e2e/fixtures/site.ts';

const CI = process.env['CI'] !== undefined && process.env['CI'] !== '';
const cloudBroker = process.env['E2E_BROKER'] === 'cloud';
const node = 'node --experimental-strip-types';

export default defineConfig({
  testDir: 'e2e',
  // WebRTC between two contexts has real network latency even on one machine; the fixtures bound
  // each step (e2e/fixtures/timeouts.ts) and this is the whole-test ceiling.
  timeout: 90_000,
  expect: { timeout: 10_000 },
  retries: 1,
  forbidOnly: CI,
  reporter: [['list'], ['html', { open: 'never' }]],
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
    { name: 'pages', use: { baseURL: `${PAGES_ORIGIN}${PAGES_BASE_PATH}` } },
    { name: 'proxy', use: { baseURL: `${PROXY_ORIGIN}/` } },
  ],
  webServer: [
    {
      command: `${node} tools/serve-dist.ts --root dist --base ${PAGES_BASE_PATH} --alias e2e-ice.json=e2e/fixtures/e2e-ice.json --port ${new URL(PAGES_ORIGIN).port}`,
      url: `${PAGES_ORIGIN}${PAGES_BASE_PATH}`,
      reuseExistingServer: !CI,
      timeout: 30_000,
    },
    {
      command: `${node} tools/proxy-dev.ts --upstream ${PAGES_ORIGIN} --port ${new URL(PROXY_ORIGIN).port}`,
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
  ],
});
