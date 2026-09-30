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
// 390x844, 393x852 and 375x812 classes upright standalone and the 390x844 sideways in a tab with
// the bar up, the page as it loads, the four radii and #app's clearance off the insets read
// straight off the computed styles; then, upright standalone, the table sat at: the controls row
// ends over the home indicator's band where the twin says (`uprightFoot`), the board is the twin's
// height, the tight tier holds where the twin says (`uprightTight`: 4px gaps, a 44px controls row,
// 44px rows on the two larger classes and the best the room allows on the 375x812), and nothing
// scrolls (the room under the notch, backgammon-board.md §3.1). Each device's board is attached to the report
// (`playwright show-report` shows them); no video. The iPads (the desktop template sideways) and
// the unsupported SE 1st gen are left to the twin's sweep in layout.test.ts. Page-only (site.ts
// PAGE_ONLY_SPECS): about the page, not the origin.
import { expect, test } from '@playwright/test';

import {
  DICE_STILL,
  MEASURE,
  SEED_SCRIPT,
  TOL,
  judge,
  seamScript,
  twinOf,
  type Measured,
} from '../tools/shell-emulate.ts';
import {
  PHONE_GEOMETRY,
  pointWidth,
  uprightBoardHeight,
  uprightFoot,
  uprightPadding,
  uprightScrolls,
  uprightTight,
} from '../web/games/backgammon/src/ui/board/layout.ts';
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
const iphone15 = deviceById('iphone-393x852');
const iphoneX = deviceById('iphone-375x812-x');
if (iphone12 === null || iphone15 === null || iphoneX === null)
  throw new Error('a probe`s row is missing from the catalogue');
/**
 * Upright standalone, three classes: the 390x844 and 393x852 the tight tier brings to 44px rows
 * (44.25 and 43.92, the judge's half-pixel), and the 375x812 X it cannot (41.83: the best its
 * 734px of room allows; layout.ts `uprightTight`); sideways, the 390x844 in a tab with the bar up.
 */
const PROBES: ReadonlyArray<Readonly<{ e: Emulation; standalone: boolean }>> = [
  { e: emulationFor(iphone12, 'portrait', 'standalone'), standalone: true },
  { e: emulationFor(iphone15, 'portrait', 'standalone'), standalone: true },
  { e: emulationFor(iphoneX, 'portrait', 'standalone'), standalone: true },
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
/** The table upright: the controls row's foot and height, #tableScreen's gap, a point row's height (`--point-w`, the row the finger lands on), the board's height, and whether anything scrolls. */
const TABLE_MEASURE = `(() => {
  const r = (id) => document.getElementById(id).getBoundingClientRect();
  const fits = (id) => { const el = document.getElementById(id); return el.scrollHeight <= el.clientHeight + 1; };
  return {
    foot: r('controls').bottom,
    controlsHeight: r('controls').height,
    gap: parseFloat(getComputedStyle(document.getElementById('tableScreen')).rowGap) || 0,
    pointW: r('point-1').height,
    boardHeight: r('board').height,
    scrolls: document.documentElement.scrollHeight > innerHeight + 1,
    appFits: fits('app'),
    tableFits: fits('tableScreen'),
  };
})()`;
type TableMeasure = Readonly<{
  foot: number;
  controlsHeight: number;
  gap: number;
  pointW: number;
  boardHeight: number;
  scrolls: boolean;
  appFits: boolean;
  tableFits: boolean;
}>;

PROBES.forEach(({ e, standalone }) => {
  test(`frame probe, ${emulationName(e)}: the corners are ${CORNER_KEYS.map((k) => String(e.corners[k])).join('/')}px and #app clears the band by 5px or stands past the inset${standalone ? '; at the table the controls end over the indicator and nothing scrolls' : ''}`, async ({
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
      if (!standalone) return;
      // Upright installed: the table fits the room the paddings leave (the notch above, the home
      // indicator below). The twin's viewport carries the top inset; `coarse` for the touch context.
      const vp = {
        width: e.viewport.width,
        height: e.viewport.height,
        coarse: true,
        insets: {
          top: e.insets.top,
          left: e.insets.left,
          right: e.insets.right,
          bottom: e.insets.bottom,
        },
      };
      expect(uprightScrolls(vp), 'the probe is a fitting viewport').toBe(false);
      await page.locator('#playModeSwitch .mode-btn[data-mode="local"]').click();
      await page.locator('#p1NameInput').fill('Ari');
      await page.locator('#p2NameInput').fill('Ethan');
      await page.locator('#localBtn').click();
      await expect(page.locator('#tableScreen')).toBeVisible();
      const gate = page.locator('#turnGate');
      if (await gate.isVisible()) await page.locator('#turnGateKeepBtn').click();
      await expect(page.locator('#curtainOverlay')).toBeVisible();
      const t = await page.evaluate<TableMeasure>(TABLE_MEASURE);
      // The controls row ends at or over the bottom padding (the indicator's 34px band), exactly
      // where the twin puts it (the 2px of slack over the band), and the board is the twin's.
      const pad = uprightPadding(vp);
      expect(t.foot, 'the controls end under the bottom padding').toBeLessThanOrEqual(
        e.viewport.height - pad.bottom + TOL,
      );
      expect(Math.abs(t.foot - uprightFoot(vp))).toBeLessThanOrEqual(TOL);
      expect(Math.abs(t.boardHeight - uprightBoardHeight(vp))).toBeLessThanOrEqual(TOL);
      // The tight tier (theme.css `@container room (max-height: 783px)`): under 784px of room the
      // three gaps are 4 and the controls 44, else 8 and 56; the row is the twin's, and 44 (to
      // the judge's half-pixel) wherever the twin says the room holds it.
      const tight = uprightTight(vp);
      expect({ controls: t.controlsHeight, gap: t.gap }, `tight tier ${String(tight)}`).toEqual(
        tight ? { controls: 44, gap: 4 } : { controls: 56, gap: 8 },
      );
      const pw = pointWidth(vp);
      expect(
        Math.abs(t.pointW - pw),
        `rows ${String(t.pointW)}px, the twin ${String(pw)}`,
      ).toBeLessThanOrEqual(TOL);
      if (pw >= PHONE_GEOMETRY.minPointW - TOL)
        expect(t.pointW, '44px rows where the tier reaches them').toBeGreaterThanOrEqual(
          PHONE_GEOMETRY.minPointW - TOL,
        );
      expect({ scrolls: t.scrolls, appFits: t.appFits, tableFits: t.tableFits }).toEqual({
        scrolls: false,
        appFits: true,
        tableFits: true,
      });
    } finally {
      await context.close();
    }
  });
});
