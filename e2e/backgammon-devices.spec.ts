// The catalogue sweep (docs/design/devices.md; the owner, 2026-09-28: "add unit tests to make sure
// that the board fills up the right amount of space. Part of the tests should create screenshots
// of the app in an emulator"): every phone web/shared/lib/devices.ts knows, held sideways, in a
// browser tab (the recorded toolbar range's max off the height: the bar up, the shortest case) and
// fullscreen (the whole screen), one context per device at its viewport, screen, pixel ratio and
// insets (through the theme's seam, tools/shell-emulate.ts `seamScript`), driven to the rolled
// board. Asserted with the geometry oracle (e2e/fixtures/backgammon-geometry.ts): the board fills
// its room (`expectFillsRoom`), no document scroll where the twin says the viewport fits, every
// tap target 44px, the strip 4px inside the frame's hairline and the frame's four corners the
// catalogue's radius where the reach rule says the corner is the screen's, 0 where a bar owns it
// (`judge`, the emulator's own verdict). Last, the frame probe (docs/design/screen-frame.md §6): the
// iPhone 12 class upright standalone and sideways in a tab with the bar up, the page as it loads,
// the four radii and #app's clearance off the insets read straight off the computed styles. Each device's board is attached to the report
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
import {
  CORNER_KEYS,
  DEVICES,
  EVERY_CORNER,
  cornersOf,
  deviceById,
  emulationFor,
  emulationName,
  type Emulation,
} from '../web/shared/lib/devices.ts';
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
    corners: (() => { const cs = getComputedStyle(document.body, '::before'); const r = (v) => parseFloat(v) || 0; return { tl: r(cs.borderTopLeftRadius), tr: r(cs.borderTopRightRadius), br: r(cs.borderBottomRightRadius), bl: r(cs.borderBottomLeftRadius) }; })(),
    rootCorners: ['tl', 'tr', 'br', 'bl'].map((k) => getComputedStyle(document.documentElement).getPropertyValue('--frame-corner-' + k).trim()).filter((v) => v !== '').join('/'),
    fullscreen: document.fullscreenElement !== null,
    screen: [screen.width, screen.height],
    dpr: devicePixelRatio,
    coarse: matchMedia('(any-pointer: coarse)').matches,
  };
})()`;

CASES.forEach((e) => {
  test(`${emulationName(e)}: the board fills its room, the frame's corners are ${CORNER_KEYS.map((k) => String(e.corners[k])).join('/')}px, nothing clips`, async ({
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
      // At the table Chromium's emulated phone grants the Android lock's fullscreen (the viewport
      // stays the case's), and the rule rounds every corner there, as on a real Android.
      expect(measured.corners).toEqual(
        measured.fullscreen ? cornersOf(e.corner, EVERY_CORNER) : e.corners,
      );
    } finally {
      await context.close();
    }
  });
});

/**
 * The frame probe: the shell's screen frame at 390x844 (upright, standalone: every corner round,
 * #app padded past the notch and the home indicator) and at 844x390 (sideways in a Safari tab with
 * the bar up: the top pair square, the bottom pair round, the side gutters the insets' 47px). Read
 * off the composed page as it loads, no table sat at: the frame is the shell's, not the board's.
 */
const iphone12 = deviceById('iphone-390x844');
if (iphone12 === null) throw new Error('iphone-390x844 missing from the catalogue');
const PROBES: ReadonlyArray<Readonly<{ e: Emulation; standalone: boolean }>> = [
  { e: emulationFor(iphone12, 'portrait', 'standalone'), standalone: true },
  { e: emulationFor(iphone12, 'landscape', 'browser', 'shown'), standalone: false },
];
/** `body::before`'s band and radii, #app's four paddings, all in px. */
const FRAME_MEASURE = `(() => {
  const r = (v) => parseFloat(v) || 0;
  const cs = getComputedStyle(document.body, '::before');
  const app = getComputedStyle(document.getElementById('app'));
  return {
    band: r(cs.borderTopWidth),
    corners: { tl: r(cs.borderTopLeftRadius), tr: r(cs.borderTopRightRadius), br: r(cs.borderBottomRightRadius), bl: r(cs.borderBottomLeftRadius) },
    padding: { top: r(app.paddingTop), right: r(app.paddingRight), bottom: r(app.paddingBottom), left: r(app.paddingLeft) },
  };
})()`;
type FrameMeasure = Readonly<{
  band: number;
  corners: Readonly<Record<string, number>>;
  padding: Readonly<{ top: number; right: number; bottom: number; left: number }>;
}>;

PROBES.forEach(({ e, standalone }) => {
  test(`frame probe, ${emulationName(e)}: the corners are ${CORNER_KEYS.map((k) => String(e.corners[k])).join('/')}px and #app clears the band by 5px or stands past the inset`, async ({
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'pages', 'about the page, not the origin');
    const context = await browser.newContext({
      baseURL: baseUrl('pages'),
      viewport: { width: e.viewport.width, height: e.viewport.height },
      screen: { width: e.screen.width, height: e.screen.height },
      deviceScaleFactor: e.dpr,
      isMobile: true,
      hasTouch: true,
    });
    await context.addInitScript({ content: seamScript(e) });
    // Playwright cannot install the page: `matchMedia('(display-mode: standalone)')` is answered
    // by hand for the standalone case, before the boot asks.
    if (standalone) {
      await context.addInitScript({
        content: `(() => { const real = matchMedia.bind(window); window.matchMedia = (q) => q === '(display-mode: standalone)' ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false } : real(q); })();`,
      });
    }
    const page = await context.newPage();
    try {
      await page.goto(pagePath('pages', 'backgammon'));
      await expect(page.locator('#homeScreen')).toBeVisible();
      const m = await page.evaluate<FrameMeasure>(FRAME_MEASURE);
      expect(m.band).toBe(6);
      expect(m.corners).toEqual(e.corners);
      // The clearance: the band, the hairline and backgammon's 5px of air (12px), or the inset.
      // Sideways the theme's own #app rule stands (theme.css: one `--edge` for both sides, the
      // home indicator added below), as the brief keeps it.
      const clear = 12;
      expect(m.padding).toEqual(
        e.orientation === 'landscape'
          ? {
              top: clear,
              right: Math.max(16, e.insets.left, e.insets.right),
              bottom: clear + e.insets.bottom,
              left: Math.max(16, e.insets.left, e.insets.right),
            }
          : {
              top: Math.max(clear, e.insets.top),
              right: Math.max(clear, e.insets.right),
              bottom: Math.max(clear, e.insets.bottom),
              left: Math.max(clear, e.insets.left),
            },
      );
    } finally {
      await context.close();
    }
  });
});
