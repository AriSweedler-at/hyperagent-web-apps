// UI Sandbox's device sweep (docs/design/ui-sandbox.md §6; the owner, 2026-09-28: "you will get
// emulators and regression tests set up until EVERYthing works EVERYwhere and it all looks right"):
// every phone the catalogue knows (web/shared/lib/devices.ts), sideways in a tab with the bar up
// (both landscapes: the cut on the left, then on the right, through the page's `?type=` hook, since
// no emulator sets `screen.orientation.type`), sideways filling the screen, and upright in a tab;
// one context per case at its viewport, screen, pixel ratio and insets (tools/shell-emulate.ts
// `seamScript`). Asserted: the frame's four corners are the catalogue's radius where the reach rule
// says the corner is the screen's and 0 where a bar owns it; the readout names the emulated device;
// the safe-area map the page wrote equals the pure module's for the case; example (a) fits without
// scroll and keeps 4px inside the hairline; examples (g) and (h) place every button inside a usable
// segment, never over an arc or the cut, and (h) shows exactly as many ears as the map holds.
// Page-only (site.ts PAGE_ONLY_SPECS): about the page, not the origin.
import { expect, test } from '@playwright/test';

import { seamScript } from '../tools/shell-emulate.ts';
import {
  CORNER_KEYS,
  DEVICES,
  deviceOf,
  emulationFor,
  emulationName,
  screenFor,
  type Emulation,
} from '../web/shared/lib/devices.ts';
import { safeAreaMap, type OrientationType, type SafeAreaMap } from '../web/shared/lib/safeArea.ts';
import { baseUrl, pagePath } from './fixtures/site.ts';

type Case = Readonly<{ e: Emulation; type: OrientationType }>;
const PHONES = DEVICES.filter((d) => d.kind !== 'ipad' && d.supported);
const CASES: ReadonlyArray<Case> = PHONES.flatMap((d) => [
  { e: emulationFor(d, 'landscape', 'browser', 'shown'), type: 'landscape-primary' as const },
  { e: emulationFor(d, 'landscape', 'browser', 'shown'), type: 'landscape-secondary' as const },
  { e: emulationFor(d, 'landscape', 'fullscreen'), type: 'landscape-primary' as const },
  { e: emulationFor(d, 'portrait', 'browser', 'shown'), type: 'portrait-primary' as const },
]);

type Corners = Readonly<Record<'tl' | 'tr' | 'br' | 'bl', number>>;
type Report = Readonly<{
  fits: boolean;
  gaps: Readonly<Record<string, number>>;
  placements: ReadonlyArray<string>;
}>;
const CORNERS = `(() => { const cs = getComputedStyle(document.body, '::before'); const r = (v) => parseFloat(v) || 0; return { tl: r(cs.borderTopLeftRadius), tr: r(cs.borderTopRightRadius), br: r(cs.borderBottomRightRadius), bl: r(cs.borderBottomLeftRadius) }; })()`;
/** The band, its hairline and the gap: what example (a)'s box keeps off every edge at least. */
const CLEARANCE = 11;

CASES.forEach(({ e, type }) => {
  const name = `${emulationName(e)} ${type}`;
  test(`${name}: corners ${CORNER_KEYS.map((k) => String(e.corners[k])).join('/')}, the device matched, the map the module's, the examples inside the map`, async ({
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
    const page = await context.newPage();
    try {
      await page.goto(
        `${pagePath('pages', 'ui-sandbox')}?screen=preview&example=cover&type=${type}`,
      );
      await expect.poll(() => page.evaluate('typeof window.__uiSandbox')).toBe('object');
      await page.waitForTimeout(50);

      const corners = await page.evaluate<Corners>(CORNERS);
      CORNER_KEYS.forEach((k) => {
        expect(
          Math.abs(corners[k] - e.corners[k]),
          `${k} ${String(corners[k])} vs ${String(e.corners[k])}`,
        ).toBeLessThanOrEqual(0.01);
      });
      // The class the page can tell: upright in a tab the notch reads 0, so two classes on one
      // screen (the X and the 12 mini) part by their pixel ratio alone, and the first stands.
      const matched = deviceOf({ screen: e.screen, dpr: e.dpr, notch: e.notch });
      expect(await page.evaluate<string | null>('window.__uiSandbox.device()')).toBe(
        matched?.id ?? null,
      );

      const expected = safeAreaMap({
        corners: e.corners,
        cut: matched?.cut ?? null,
        type,
        insets: e.insets,
        viewport: e.viewport,
        full: screenFor(e.device, e.orientation),
      });
      const map = await page.evaluate<SafeAreaMap>('window.__uiSandbox.map()');
      expect(map).toEqual(expected);

      const cover = await page.evaluate<Report | null>('window.__uiSandbox.report()');
      expect(cover?.fits, 'example (a) fits without scroll').toBe(true);
      Object.entries(cover?.gaps ?? {}).forEach(([edge, gap]) => {
        expect(gap, `gap ${edge}`).toBeGreaterThanOrEqual(CLEARANCE - 0.5);
      });

      await page.evaluate("window.__uiSandbox.set('example', 'rail')");
      const rail = await page.evaluate<Report | null>('window.__uiSandbox.report()');
      const free = map.cutEdge === 'left' ? 'right' : map.cutEdge === 'right' ? 'left' : null;
      if (free !== null && map.edges[free].length > 0) {
        expect(rail?.placements, "the rail sits in the free side's segment").toEqual([
          `rail: ${free} segment 1`,
        ]);
        const buttons = await page.locator('.edge-rail .sq-btn:visible').count();
        expect(buttons).toBe(3);
      } else {
        expect(await page.locator('.edge-rail:visible').count()).toBe(0);
      }

      await page.evaluate("window.__uiSandbox.set('example', 'ears')");
      const ears = await page.evaluate<Report | null>('window.__uiSandbox.report()');
      const shown = await page.locator('.ear:visible').count();
      const wanted =
        map.cutEdge === 'left' || map.cutEdge === 'right' ? map.edges[map.cutEdge].length : 0;
      expect(shown, 'as many ears as the map holds').toBe(wanted);
      (ears?.placements ?? []).slice(0, wanted).forEach((p) => {
        expect(p).not.toContain('OVER');
      });
      await testInfo.attach(`${name} ears`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    } finally {
      await context.close();
    }
  });
});
