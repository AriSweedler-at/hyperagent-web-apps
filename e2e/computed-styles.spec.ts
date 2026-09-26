// Computed-style goldens as a CI gate (docs/MIGRATION.md step 14, docs/ARCHITECTURE.md "Testing
// pyramid"): tools/parity/computed-styles.ts drives each served game page through its screens at a
// phone and a laptop viewport and reads `getComputedStyle` for every selector in its list; this
// spec replays that capture against the harness's running servers and deep-equals it with the
// committed golden in test/fixtures/styles/. A CSS move that changes any computed value fails the
// test with one line per screen/selector/property; a custom property the golden never recorded is
// only an annotation (the tool's additive rule). Like gin-dom-parity it runs once, on `pages`:
// the values are a function of the CSS alone, and both origins serve the same bytes.
import { expect, test } from '@playwright/test';

import { PAGES_BASE_PATH, PAGES_ORIGIN, PEER_SERVER, isDeployed } from './fixtures/site.ts';
import {
  GAMES,
  VIEWPORTS,
  capture,
  diffGoldens,
  goldenPath,
  readGolden,
  viewportName,
  type Harness,
} from '../tools/parity/computed-styles.ts';

/** The servers playwright.config.ts already started, in the shape the capture drives. */
const HARNESS: Harness = {
  pagesUrl: `${PAGES_ORIGIN}${PAGES_BASE_PATH}`,
  peerHost: PEER_SERVER,
  close: () => Promise.resolve(),
};

GAMES.forEach((game) => {
  VIEWPORTS.forEach((viewport) => {
    test(`${game} @ ${viewportName(viewport)} computes the styles its golden records`, async ({
      browser,
    }, testInfo) => {
      test.skip(
        testInfo.project.name !== 'pages',
        'runs once: the styles are the same bytes on both origins',
      );
      test.skip(
        isDeployed(),
        'the capture drives the local build, not the deployed page the run is about',
      );
      test.setTimeout(150_000);
      const expected = readGolden(game, viewport);
      expect(
        expected,
        `no golden at ${goldenPath(game, viewport)}: record one first`,
      ).not.toBeNull();
      if (expected === null) return;
      const { golden, errors } = await capture(browser, HARNESS, game, viewport);
      expect(errors, 'uncaught exceptions').toEqual([]);
      const { differences, notes } = diffGoldens(expected, golden);
      // A token the golden never recorded is additive (see the tool's header): report, do not fail.
      notes.forEach((line) => testInfo.annotations.push({ type: 'note', description: line }));
      expect(
        differences,
        `computed styles differ from the golden:\n${differences.join('\n')}`,
      ).toEqual([]);
    });
  });
});
