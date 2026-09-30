// UI Sandbox's device sweep (docs/design/ui-sandbox.md §6; the owner, 2026-09-28: "you will get
// emulators and regression tests set up until EVERYthing works EVERYwhere and it all looks right"):
// every phone the catalogue knows (web/shared/lib/devices.ts), sideways in a tab with the bar up
// (both landscapes: the cut on the left, then on the right, through the page's `?type=` hook, since
// no emulator sets `screen.orientation.type`), sideways filling the screen, and upright in a tab;
// one context per case at its viewport, screen, pixel ratio and insets (tools/shell-emulate.ts
// `seamScript`). Asserted: the frame's four corners are the catalogue's radius where the reach rule
// says the corner is the screen's and 0 where a bar owns it; the readout names the emulated device;
// the safe-area map the page wrote equals the pure module's for the case; example (a) fits without
// scroll, keeps 4px inside the hairline and fills the room the frame leaves (its edges within a
// pixel of the clearance or the inset, no 480px column sideways) with its 2px border showing;
// examples (g) and (h) place every button inside a usable segment, never over an arc or the cut,
// and (h) shows exactly as many ears as the map holds. Then Safari upright, which the catalogue's
// tab case does not spell (the owner's phone, 2026-09-29: "when it's vertical ... it doesn't use
// all the screen real-estate"): the address bar at the bottom (the top inset the notch's, the
// bottom 0), the bar hidden (top 0, the home indicator), installed (both), and the SE with none:
// all nine examples fill the room, the Next button advances and wraps into the dropdown and the
// store, `?example=b` picks by letter. Page-only (site.ts PAGE_ONLY_SPECS): about the page, not
// the origin.
import { expect, test } from '@playwright/test';

import { bottomBarOf, seamScript } from '../tools/shell-emulate.ts';
import {
  CORNER_KEYS,
  DEVICES,
  deviceById,
  deviceOf,
  emulationFor,
  emulationName,
  screenFor,
  type Emulation,
} from '../web/shared/lib/devices.ts';
import {
  EDGES,
  safeAreaMap,
  type Edge,
  type OrientationType,
  type SafeAreaMap,
} from '../web/shared/lib/safeArea.ts';
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
  fills: boolean;
  room: Readonly<Record<Edge, number>>;
  gaps: Readonly<Record<Edge, number>>;
  placements: ReadonlyArray<string>;
}>;
const CORNERS = `(() => { const cs = getComputedStyle(document.body, '::before'); const r = (v) => parseFloat(v) || 0; return { tl: r(cs.borderTopLeftRadius), tr: r(cs.borderTopRightRadius), br: r(cs.borderBottomRightRadius), bl: r(cs.borderBottomLeftRadius) }; })()`;
/** Every visible flowing box's computed outline, `2px solid` where the border shows. */
const OUTLINES = `Array.from(document.querySelectorAll('#stage [data-box]:not([data-fixed])')).filter((el) => el.getClientRects().length > 0).map((el) => { const cs = getComputedStyle(el); return cs.outlineWidth + ' ' + cs.outlineStyle; })`;
const SCROLLS = 'document.documentElement.scrollHeight > innerHeight + 1';
/** The band, its hairline and the gap: what example (a)'s box keeps off every edge at least. */
const CLEARANCE = 11;
/** One pixel: what a box's edge may leave beyond the room's. */
const FILL_SLACK = 1;

/** The fill rule over one report: every edge within a pixel of the clearance or that side's inset, whichever is more; the page agrees; the border on every flowing box. */
const expectFilled = async (
  page: Readonly<{ evaluate: <T>(script: string) => Promise<T> }>,
  insets: Readonly<Record<Edge, number>>,
  label: string,
): Promise<void> => {
  const report = await page.evaluate<Report | null>('window.__uiSandbox.report()');
  EDGES.forEach((edge) => {
    const want = Math.max(CLEARANCE, insets[edge]);
    expect(report?.room[edge], `${label}: room ${edge}`).toBe(want);
    expect(
      Math.abs((report?.gaps[edge] ?? Infinity) - want),
      `${label}: gap ${edge} ${String(report?.gaps[edge])} vs room ${String(want)}`,
    ).toBeLessThanOrEqual(FILL_SLACK);
  });
  expect(report?.fills, `${label}: the page says it fills`).toBe(true);
  expect(await page.evaluate<boolean>(SCROLLS), `${label}: no scroll`).toBe(false);
  const outlines = await page.evaluate<ReadonlyArray<string>>(OUTLINES);
  expect(outlines.length, `${label}: a bordered box`).toBeGreaterThan(0);
  outlines.forEach((o) => {
    expect(o, `${label}: the 2px border`).toBe('2px solid');
  });
};

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
      await expectFilled(page, e.insets, '(a)');
      await page.evaluate("window.__uiSandbox.set('example', 'board')");
      await expectFilled(page, e.insets, '(f)');

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

// ---- Safari upright: the cases the catalogue's one tab case does not spell ----------------------

/** The nine examples in the dropdown's order (web/games/ui-sandbox/src/settings.ts EXAMPLE_IDS; the node project cannot import the page's modules), checked against the dropdown. */
const EXAMPLE_IDS: ReadonlyArray<string> = [
  'cover',
  'side',
  'sides',
  'top',
  'strips',
  'board',
  'rail',
  'ears',
  'gutters',
];

type UprightCase = Readonly<{ name: string; e: Emulation }>;
const notchedUpright = (id: string): ReadonlyArray<UprightCase> => {
  const d = deviceById(id);
  if (d === null) throw new Error(`${id} is not in the catalogue`);
  return [
    // Safari's address bar at the bottom (iOS 15+): the top inset is the notch's, the bottom 0.
    {
      name: `${id} upright tab, bar at the bottom`,
      e: bottomBarOf(emulationFor(d, 'portrait', 'browser', 'shown')),
    },
    // The bar hidden: the top 0, the home indicator at the bottom.
    { name: `${id} upright tab, bar hidden`, e: emulationFor(d, 'portrait', 'browser', 'hidden') },
    // Installed: both.
    { name: `${id} upright installed`, e: emulationFor(d, 'portrait', 'standalone') },
  ];
};
const seDevice = deviceById('iphone-375x667-se');
if (seDevice === null) throw new Error('the SE row is missing');
const SAFARI_UPRIGHT: ReadonlyArray<UprightCase> = [
  ...notchedUpright('iphone-390x844'),
  ...notchedUpright('iphone-393x852'),
  {
    name: 'iphone-375x667-se upright tab',
    e: emulationFor(seDevice, 'portrait', 'browser', 'shown'),
  },
];

SAFARI_UPRIGHT.forEach(({ name, e }) => {
  test(`${name} (insets t ${String(e.insets.top)} b ${String(e.insets.bottom)}): all nine examples fill the room, the readout names the inset, Next wraps, a letter picks`, async ({
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
        `${pagePath('pages', 'ui-sandbox')}?screen=preview&example=b&type=portrait-primary`,
      );
      await expect.poll(() => page.evaluate('typeof window.__uiSandbox')).toBe('object');
      await page.waitForTimeout(50);
      // `?example=b` is (b), the side bar.
      expect(await page.evaluate<string>('window.__uiSandbox.settings().example')).toBe('side');
      await expect(page.locator('#previewExampleSel')).toHaveValue('side');
      expect(
        await page.evaluate<ReadonlyArray<string>>(
          "Array.from(document.querySelectorAll('#previewExampleSel option')).map((o) => o.value)",
        ),
      ).toEqual(EXAMPLE_IDS);

      const reported: string[] = [];
      await EXAMPLE_IDS.reduce(async (prev, id) => {
        await prev;
        await page.evaluate(`window.__uiSandbox.set('example', '${id}')`);
        await page.waitForTimeout(30);
        await expectFilled(page, e.insets, id);
        reported.push(await page.locator('#report').innerText());
      }, Promise.resolve());
      // The readout says where the notch, not the frame, holds the box off.
      reported.forEach((text) => {
        expect(text).toContain('fills the room the frame leaves');
        if (e.insets.top > CLEARANCE)
          expect(text).toContain(`top held off by the ${String(e.insets.top)}px inset`);
        else expect(text).not.toContain('top held off');
        if (e.insets.bottom > CLEARANCE)
          expect(text).toContain(`bottom held off by the ${String(e.insets.bottom)}px inset`);
      });

      // Next: from the last, (i), back to the first, (a), in both dropdowns and the store.
      expect(await page.evaluate<string>('window.__uiSandbox.settings().example')).toBe('gutters');
      await page.locator('#previewNextBtn').click();
      expect(await page.evaluate<string>('window.__uiSandbox.settings().example')).toBe('cover');
      await expect(page.locator('#previewExampleSel')).toHaveValue('cover');
      await expect(page.locator('#exampleSel')).toHaveValue('cover');
      expect(await page.evaluate<string | null>("localStorage.getItem('uiSandbox_example')")).toBe(
        'cover',
      );
      await page.locator('#previewNextBtn').click();
      expect(await page.evaluate<string>('window.__uiSandbox.settings().example')).toBe('side');
      await expectFilled(page, e.insets, 'after Next');
      await testInfo.attach(`${name} (b)`, {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    } finally {
      await context.close();
    }
  });
});
