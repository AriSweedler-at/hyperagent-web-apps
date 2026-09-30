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
// and (h) shows exactly as many ears as the map holds; (a)'s size label is at least three fifths
// of its box wide (the owner, 2026-09-30: the pixel sizes "take up as much space as [they] can");
// (j) seats its two dice, inside the ears where the map holds two, and holds its "Roll in the
// Island" link with the reason `clipGate` gives the matched row (docs/design/ui-sandbox.md §7),
// with no Smart App Banner in the head while the clip is unconfigured. Then Safari upright, which the catalogue's
// tab case does not spell (the owner's phone, 2026-09-29: "when it's vertical ... it doesn't use
// all the screen real-estate"): the address bar at the bottom (the top inset the notch's, the
// bottom 0), the bar hidden (top 0, the home indicator), installed (both), and the SE with none:
// all nine examples fill the room, the Next button advances and wraps into the dropdown and the
// store, `?example=b` picks by letter. Page-only (site.ts PAGE_ONLY_SPECS): about the page, not
// the origin. Last, (j) on three phones: the island class held with "not published yet", the dice
// in the two ears; a notch phone held with the hardware reason; and `?clip=on` on the island class,
// the link live with the roll it carries, a tap opening it in a new tab and tumbling the dice to it.
import { expect, test, type Browser, type Page } from '@playwright/test';

import { bottomBarOf, seamScript } from '../tools/shell-emulate.ts';
import {
  GATE_REASONS,
  SMART_APP_BANNER_META,
  clipGate,
  diceClipUrl,
  type Roll,
} from '../web/shared/lib/appClip.ts';
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
/** Example (a)'s box and its size label, by width, with the label's text. */
const LABEL = `(() => { const box = document.querySelector('#stage .box.fill'); const label = box.querySelector('.box-size'); return { box: box.getBoundingClientRect().width, label: label.getBoundingClientRect().width, text: label.textContent }; })()`;
type Label = Readonly<{ box: number; label: number; text: string }>;
/** The least of the box the size label must span (the owner: as much as it can; the rule is 18cqi, about four fifths). */
const LABEL_SHARE = 0.6;
const BANNER = `document.querySelectorAll('meta[name="${SMART_APP_BANNER_META}"]').length`;
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
      // The size label fills the box: at least three fifths of its width, never more than it.
      const label = await page.evaluate<Label>(LABEL);
      expect(label.text).toMatch(/^\d+x\d+$/);
      expect(
        label.label,
        `label ${String(label.label)} in ${String(label.box)}`,
      ).toBeGreaterThanOrEqual(LABEL_SHARE * label.box);
      expect(label.label).toBeLessThanOrEqual(label.box);
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

      // (j): two seats, in the ears where the map holds two; the link held with the gate's reason
      // for the matched row; no banner in the head while the clip is unconfigured.
      await page.evaluate("window.__uiSandbox.set('example', 'dice')");
      const dice = await page.evaluate<Report | null>('window.__uiSandbox.report()');
      expect(await page.locator('.die-ear:visible').count(), 'two seats').toBe(2);
      if (wanted === 2)
        (dice?.placements ?? []).forEach((p) => {
          expect(p, 'a die in its ear').not.toContain('OVER');
        });
      const gate = clipGate(matched);
      expect(gate.enabled).toBe(false);
      const link = page.locator('#islandRollBtn');
      await expect(link).toHaveAttribute('aria-disabled', 'true');
      expect(await link.getAttribute('href')).toBeNull();
      await expect(page.locator('[data-note="dice"]')).toHaveText(gate.reason ?? '');
      expect(await page.evaluate<number>(BANNER)).toBe(0);
    } finally {
      await context.close();
    }
  });
});

// ---- Safari upright: the cases the catalogue's one tab case does not spell ----------------------

/** The ten examples in the dropdown's order (web/games/ui-sandbox/src/settings.ts EXAMPLE_IDS; the node project cannot import the page's modules), checked against the dropdown. */
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
  'dice',
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
  test(`${name} (insets t ${String(e.insets.top)} b ${String(e.insets.bottom)}): all ten examples fill the room, the readout names the inset, Next wraps, a letter picks`, async ({
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

      // Next: from the last, (j), back to the first, (a), in both dropdowns and the store.
      expect(await page.evaluate<string>('window.__uiSandbox.settings().example')).toBe('dice');
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

// ---- (j) Dice in the Dynamic Island (docs/design/ui-sandbox.md §7) -----------------------------

type Dice = Readonly<{ shown: Roll; pending: Roll }>;
/** The preview on example (j) sideways, the cut on the left, for a device; `query` adds to the URL. */
const openDice = async (
  browser: Browser,
  id: string,
  query = '',
): Promise<Readonly<{ page: Page; close: () => Promise<void> }>> => {
  const d = deviceById(id);
  if (d === null) throw new Error(`${id} is not in the catalogue`);
  const e = emulationFor(d, 'landscape', 'browser', 'shown');
  const context = await browser.newContext({
    baseURL: baseUrl('pages'),
    viewport: { width: e.viewport.width, height: e.viewport.height },
    screen: { width: e.screen.width, height: e.screen.height },
    deviceScaleFactor: e.dpr,
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript({ content: seamScript(e) });
  // The clip's host is never reached from a test: a tap's new tab is answered here.
  await context.route('https://games.sweedler.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/plain', body: 'the clip' }),
  );
  const page = await context.newPage();
  await page.goto(
    `${pagePath('pages', 'ui-sandbox')}?screen=preview&example=j&type=landscape-primary${query}`,
  );
  await expect.poll(() => page.evaluate('typeof window.__uiSandbox')).toBe('object');
  await page.waitForTimeout(50);
  return { page, close: () => context.close() };
};

test.describe('(j) Dice in the Dynamic Island', () => {
  test('the island class sideways: a die in each ear, the island hatched, the link held: the clip is not published; no banner', async ({
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'pages', 'about the page, not the origin');
    const { page, close } = await openDice(browser, 'iphone-393x852');
    try {
      expect(await page.evaluate<string>('window.__uiSandbox.settings().example')).toBe('dice');
      const report = await page.evaluate<Report | null>('window.__uiSandbox.report()');
      expect(report?.placements).toEqual(['die1: left segment 1', 'die2: left segment 2']);
      expect(await page.locator('.die-ear:visible').count()).toBe(2);
      expect(await page.locator('.island-cut:visible').count()).toBe(1);
      await expect(page.locator('.die[data-die="one"]')).toHaveAttribute('data-face', '3');
      await expect(page.locator('.die[data-die="two"]')).toHaveAttribute('data-face', '5');
      expect(await page.locator('.die[data-die="one"] .pip').count()).toBe(3);
      const link = page.locator('#islandRollBtn');
      await expect(link).toHaveText('Roll in the Island');
      await expect(link).toHaveClass(/btn-go/);
      await expect(link).toHaveAttribute('aria-disabled', 'true');
      expect(await link.getAttribute('href')).toBeNull();
      await expect(page.locator('[data-note="dice"]')).toHaveText(GATE_REASONS.unpublished);
      await page.locator('#previewInfoBtn').click();
      const text = await page.locator('#report').innerText();
      expect(text).toContain('dice: one seat in each ear of the island on the left');
      expect(text).toContain(GATE_REASONS.unpublished);
      expect(await page.evaluate<number>(BANNER)).toBe(0);
      await testInfo.attach('island dice', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    } finally {
      await close();
    }
  });

  test('a notch phone: the seats flank the notch, the link held for the hardware, published or not', async ({
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'pages', 'about the page, not the origin');
    const { page, close } = await openDice(browser, 'iphone-390x844', '&clip=on');
    try {
      expect(await page.locator('.die-ear:visible').count()).toBe(2);
      expect(await page.locator('.island-cut:visible').count()).toBe(0);
      await expect(page.locator('#islandRollBtn')).toHaveAttribute('aria-disabled', 'true');
      await expect(page.locator('[data-note="dice"]')).toHaveText(GATE_REASONS.hardware);
      await page.locator('#previewInfoBtn').click();
      expect(await page.locator('#report').innerText()).toContain(
        'the ears beside this notch are under 44px',
      );
    } finally {
      await close();
    }
  });

  test('?clip=on on the island class: the banner is in the head, the link is live with the roll it carries, a tap opens it in a new tab and tumbles the dice to that roll', async ({
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'pages', 'about the page, not the origin');
    const { page, close } = await openDice(browser, 'iphone-393x852', '&clip=on');
    try {
      expect(await page.evaluate<number>(BANNER)).toBe(1);
      const content = await page.getAttribute(`meta[name="${SMART_APP_BANNER_META}"]`, 'content');
      expect(content).toContain('app-id=1234567890');
      expect(content).toContain('app-clip-bundle-id=com.sweedler.games.dice.Clip');
      expect(content).toContain('app-clip-display=card');
      expect(content).toContain('app-argument=https://games.sweedler.com/clip/dice');
      const link = page.locator('#islandRollBtn');
      expect(await link.getAttribute('aria-disabled')).toBeNull();
      await expect(link).toHaveAttribute('target', '_blank');
      const before = await page.evaluate<Dice>('window.__uiSandbox.dice()');
      await expect(link).toHaveAttribute('href', diceClipUrl(before.pending));
      await expect(link).toHaveAttribute(
        'data-roll',
        `${String(before.pending[0])},${String(before.pending[1])}`,
      );
      const [popup] = await Promise.all([page.context().waitForEvent('page'), link.click()]);
      await popup.waitForLoadState();
      expect(popup.url()).toBe(diceClipUrl(before.pending));
      await popup.close();
      // The tumble, then the faces are the roll the link carried and the link holds the next.
      await expect(page.locator('.die.tumble')).toHaveCount(0, { timeout: 3000 });
      const after = await page.evaluate<Dice>('window.__uiSandbox.dice()');
      expect(after.shown).toEqual(before.pending);
      await expect(page.locator('.die[data-die="one"]')).toHaveAttribute(
        'data-face',
        String(after.shown[0]),
      );
      await expect(page.locator('.die[data-die="two"]')).toHaveAttribute(
        'data-face',
        String(after.shown[1]),
      );
      expect(await page.locator('.die[data-die="one"] .pip').count()).toBe(after.shown[0]);
      await expect(link).toHaveAttribute('href', diceClipUrl(after.pending));
      await testInfo.attach('island dice live', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    } finally {
      await close();
    }
  });
});
