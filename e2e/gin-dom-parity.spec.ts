// DOM-snapshot parity of the served gin page against the frozen legacy page (docs/MIGRATION.md
// steps 12 and 13): the driver in tools/parity/gin-dom-parity.ts plays the same pass-and-play game
// and Score Counter session on both, with the same seeded Math.random and pinned clock, and
// compares the screens at every checkpoint. Both come from the `pages` origin: the new page is
// dist/games/gin-rummy/ and the legacy page is legacy/gin-rummy/index.html, published under
// legacy/ by the harness's serve-dist aliases (e2e/fixtures/site.ts), so the spec runs once, on
// the `pages` project.
import { expect, test } from '@playwright/test';

import { LEGACY_GIN_PAGE, PAGES_BASE_PATH, PAGES_ORIGIN, isLive } from './fixtures/site.ts';
import { PROMPTS, openPair, runParity } from '../tools/parity/gin-dom-parity.ts';

test('the served gin page paints what the legacy page paints, checkpoint for checkpoint', async ({
  browser,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'pages', 'runs once, on the origin that serves both pages');
  test.skip(
    isLive(),
    'needs the local serve-dist aliases: the deployed site publishes no legacy page',
  );
  test.setTimeout(240_000);
  const legacyUrl = `${PAGES_ORIGIN}${PAGES_BASE_PATH}${LEGACY_GIN_PAGE}`;
  // Locally (reuseExistingServer) a stray `npm run serve` on the pages port is reused, and it
  // lacks the legacy aliases: say so, rather than failing on the checkpoint count below.
  const probe = await request.get(legacyUrl);
  expect(
    probe.status(),
    `legacy page not served at ${legacyUrl}: start the harness with LEGACY_ALIASES (e2e/fixtures/site.ts); a stray \`npm run serve\` on the pages port is reused locally`,
  ).toBe(200);
  const pair = await openPair(
    browser,
    legacyUrl,
    `${PAGES_ORIGIN}${PAGES_BASE_PATH}games/gin-rummy/`,
    PROMPTS,
  );
  try {
    const report = await runParity(pair);
    expect(report.checkpoints.length).toBeGreaterThanOrEqual(60);
    expect(report.mismatches).toEqual([]);
    expect(pair.errors(), 'uncaught exceptions').toEqual([]);
  } finally {
    await pair.close();
  }
});
