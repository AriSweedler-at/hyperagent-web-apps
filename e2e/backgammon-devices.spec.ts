// The catalogue sweep (docs/design/devices.md; the owner, 2026-09-28: "add unit tests to make sure
// that the board fills up the right amount of space. Part of the tests should create screenshots
// of the app in an emulator"): every phone web/shared/lib/devices.ts knows, held sideways, in a
// browser tab (the recorded toolbar range's max off the height: the bar up, the shortest case) and
// fullscreen (the whole screen), one context per device at its viewport, screen, pixel ratio and
// insets (through the theme's seam, tools/shell-emulate.ts `seamScript`), driven to the rolled
// board. Asserted with the geometry oracle (e2e/fixtures/backgammon-geometry.ts): the board fills
// its room (`expectFillsRoom`), no document scroll where the twin says the viewport fits, every
// tap target 44px, the strip 4px inside the trim's hairline and the trim's corner radius the
// catalogue's (`judge`, the emulator's own verdict). Each device's board is attached to the report
// (`playwright show-report` shows them); no video. The iPads (the desktop template sideways) and
// the unsupported SE 1st gen are left to the twin's sweep in layout.test.ts. Page-only (site.ts
// PAGE_ONLY_SPECS): about the page, not the origin.
import { expect, test } from '@playwright/test';

import {
  DICE_STILL,
  SEED_SCRIPT,
  judge,
  seamScript,
  twinOf,
  type Measured,
} from '../tools/shell-emulate.ts';
import { DEVICES, emulationFor, emulationName, type Emulation } from '../web/shared/lib/devices.ts';
import { bgRoll } from './fixtures/backgammon.ts';
import { boardGeometry, expectBoardGeometry } from './fixtures/backgammon-geometry.ts';
import { reveal } from './fixtures/shell.ts';
import { baseUrl, pagePath } from './fixtures/site.ts';

const PHONES = DEVICES.filter((d) => d.kind !== 'ipad' && d.supported);
const CASES: ReadonlyArray<Emulation> = PHONES.flatMap((d) => [
  emulationFor(d, 'landscape', 'browser', 'shown'),
  emulationFor(d, 'landscape', 'fullscreen'),
]);

/** The emulator's measurement, read off the page as tools/shell-emulate.ts reads it. */
const MEASURE = `(() => {
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const board = document.getElementById('board');
  const sels = ['#statusLine', '#tableScreen .opp-strip', '#gameBadge', '#tableScreen .me-strip', '#tableScreen .roll-slot', '#menuBtn', '#soundBtn'];
  const frame = Object.fromEntries(sels.map((sel) => { const el = document.querySelector(sel); return [sel, el !== null && shown(el) ? rect(el) : null]; }));
  const targets = Array.from(document.querySelectorAll('#tableScreen .point, #tableScreen .bar, #tableScreen .off, #dice .die, #tableScreen .btn, #tableScreen .icon-btn, #tableScreen .chip')).filter(shown).map((el) => { const r = rect(el); return { sel: el.id !== '' ? '#' + el.id : '.' + String(el.className).split(' ')[0], w: r.w, h: r.h }; });
  return {
    inner: { w: innerWidth, h: innerHeight },
    scrollHeight: document.documentElement.scrollHeight,
    board: board === null ? null : rect(board),
    frame,
    targets,
    corner: parseFloat(getComputedStyle(document.body, '::before').borderTopLeftRadius) || 0,
    rootCorner: getComputedStyle(document.documentElement).getPropertyValue('--screen-corner').trim(),
    screen: [screen.width, screen.height],
    dpr: devicePixelRatio,
    coarse: matchMedia('(any-pointer: coarse)').matches,
  };
})()`;

CASES.forEach((e) => {
  test(`${emulationName(e)}: the board fills its room, the trim's corner is ${String(e.corner)}px, nothing clips`, async ({
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'pages', 'about the page, not the origin');
    // A context of the spec's own (the device's viewport, screen and pixel ratio), so the project's
    // baseURL is passed by hand.
    const context = await browser.newContext({
      baseURL: baseUrl('pages'),
      viewport: { width: e.viewport.width, height: e.viewport.height },
      screen: { width: e.screen.width, height: e.screen.height },
      deviceScaleFactor: e.dpr,
      isMobile: true,
      hasTouch: true,
    });
    // The emulator's seed: the same opening roll on every phone. A double draws its four dice at
    // 30px by design (theme.css: "a die pick is moot on a double, so the 44px target rule does not
    // bind"), which the oracle's target rule does not know; one seed keeps the sweep off doubles,
    // as the geometry spec's seeding does.
    await context.addInitScript({ content: SEED_SCRIPT });
    await context.addInitScript({ content: seamScript(e) });
    const page = await context.newPage();
    try {
      await page.goto(pagePath('pages', 'backgammon'));
      await page.locator('#playModeSwitch .mode-btn[data-mode="local"]').click();
      await page.locator('#p1NameInput').fill('Ari');
      await page.locator('#p2NameInput').fill('Ethan');
      await page.locator('#localBtn').click();
      await expect(page.locator('#tableScreen')).toBeVisible();
      await reveal(page);
      await expect(page.locator('#rollOverlay')).toBeVisible();
      await bgRoll(page);
      // The dice tumble is a keyframe animation that scales the faces (the oracle settles
      // transitions alone): read once it has run out, as a finger would.
      await page.waitForFunction(DICE_STILL);

      const twin = twinOf(e);
      const g = await boardGeometry(page);
      const seat = Number(g.seat) as 0 | 1;
      // The oracle, `expectFillsRoom` among it, where the viewport fits; under the floor (the bar
      // up on the shortest phones) the document scrolls by design and the oracle knows it.
      expectBoardGeometry(g, seat, twin.scrolls, emulationName(e), {
        left: e.insets.left,
        right: e.insets.right,
        bottom: e.insets.bottom,
      });

      const measured = await page.evaluate<Measured>(MEASURE);
      const verdict = judge(e, measured);
      await testInfo.attach(`${emulationName(e)} board`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
      expect(
        verdict.checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`),
        emulationName(e),
      ).toEqual([]);
      expect(measured.corner).toBe(e.corner);
    } finally {
      await context.close();
    }
  });
});
