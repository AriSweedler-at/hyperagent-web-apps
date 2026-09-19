// DOM-snapshot parity of the dark gin page against the legacy page (docs/MIGRATION.md step 12):
// the driver in tools/parity/gin-dom-parity.ts plays the same pass-and-play game and Score Counter
// session on both, with the same seeded Math.random and pinned clock, and compares the screens at
// every checkpoint. The legacy page is dist/ on the `pages` origin and the new page dist-next/ on
// the `next` origin, both served by the harness, so the spec runs once, on the `next` project.
import { expect, test } from '@playwright/test';

import { NEXT_ORIGIN, PAGES_BASE_PATH, PAGES_ORIGIN } from './fixtures/site.ts';
import { PROMPTS, openPair, runParity } from '../tools/parity/gin-dom-parity.ts';

test('the dark gin page paints what the legacy page paints, checkpoint for checkpoint', async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'next', 'runs once, on the project that serves dist-next/');
  test.setTimeout(240_000);
  const pair = await openPair(
    browser,
    `${PAGES_ORIGIN}${PAGES_BASE_PATH}games/gin-rummy/`,
    `${NEXT_ORIGIN}${PAGES_BASE_PATH}games/gin-rummy/`,
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
