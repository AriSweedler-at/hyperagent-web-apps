// The table's fixed geometry as a real-click test (docs/design/gin-draw-ghost-slot.md §5, PR B):
// the sizes are bounded by the viewport in CSS alone, so the page never scrolls and nothing above
// the hand changes size or place between phases. Pass-and-play on one page at a phone, a laptop
// and a short phone (the last with the 20-character names the inputs allow, which must ellipsize
// in the hand header rather than wrap it); at the upcard decision, the draw, the shown draw, the
// accepted draw, the selection, the next player's turn under the curtain and the round over: the
// document, `#app`, `#tableScreen` and `#hand` hold their content without overflow, the actions row
// ends inside the viewport, the eleven slot cells are one size in the rows the width implies (six
// columns in two rows on a phone, one row of eleven on the laptop), and the frame (topbar, opponent
// strip, both piles, status banner, last-action line, hand area, hand header, hand grid and actions
// row) keeps the bounding boxes it had at the start. Two viewports the floor sizes cannot fit (a
// phone in landscape, a phone with the browser's toolbar shown) exercise theme.css's fallback: the
// document scrolls (`#app` and `#tableScreen` clip nothing) and the actions row is reachable at the
// bottom of that scroll. The turns after the first are played through the documented `window.__gin`
// hook (docs/ARCHITECTURE.md; e2e/fixtures/gin-play.ts): the least-deadwood discard, a knock as
// soon as one is legal, so the round ends in a few turns; a void hand ends it too.
import type { Page } from '@playwright/test';

import { ginAcceptDraw, ginPassUpcard, ginReveal, ginStartLocal } from './fixtures/gin.ts';
import { chooseDiscard, finishTurn, playToRoundOver, selectCard } from './fixtures/gin-play.ts';
import { pagePath } from './fixtures/site.ts';
import { expect, test } from './fixtures/two-players.ts';

type Box = Readonly<{ x: number; y: number; w: number; h: number }>;
type Frame = Readonly<Record<string, Box | null>>;

/** Everything on the table that is not a card: one box each, in every phase. */
const FRAME_SELECTORS: ReadonlyArray<string> = [
  '#tableScreen .topbar',
  '#tableScreen .opp-strip',
  '#stockPile',
  '#discardPile',
  '#statusBanner',
  '#lastAction',
  '#tableScreen .hand-area',
  '#tableScreen .hand-header',
  '#hand',
  '#actions',
];
/** The frame's boxes in document coordinates, so a scrolled page compares with an unscrolled one. */
const FRAME = `Object.fromEntries(${JSON.stringify(FRAME_SELECTORS)}.map((sel) => {
  const el = document.querySelector(sel);
  if (el === null) return [sel, null];
  const r = el.getBoundingClientRect();
  return [sel, { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height }];
}))`;
/**
 * Nothing is clipped: content fits its box at every level (`document` false only where the page is
 * allowed to scroll), and the actions row is on screen once the window is scrolled to its end.
 */
const FITS = `(() => {
  const fits = (id) => { const el = document.getElementById(id); return el.scrollHeight <= el.clientHeight + 1; };
  const before = window.scrollY;
  window.scrollTo(0, document.documentElement.scrollHeight);
  const actions = document.getElementById('actions').getBoundingClientRect();
  window.scrollTo(0, before);
  return {
    document: document.documentElement.scrollHeight <= window.innerHeight + 1,
    app: fits('app'), tableScreen: fits('tableScreen'), hand: fits('hand'),
    actionsReachable: actions.bottom <= window.innerHeight + 0.5,
  };
})()`;
/** The slot cells' sizes (rounded to a tenth) and their tops, in DOM order. */
const SLOTS = `(() => {
  const slots = Array.from(document.querySelectorAll('#hand .slot')).map((s) => s.getBoundingClientRect());
  const tenth = (n) => Math.round(n * 10) / 10;
  return { sizes: Array.from(new Set(slots.map((r) => tenth(r.width) + 'x' + tenth(r.height)))), tops: slots.map((r) => Math.round(r.top)) };
})()`;

type Fits = Readonly<
  Record<'document' | 'app' | 'tableScreen' | 'hand' | 'actionsReachable', boolean>
>;
type Slots = Readonly<{ sizes: ReadonlyArray<string>; tops: ReadonlyArray<number> }>;
const frameOf = (page: Page): Promise<Frame> => page.evaluate<Frame>(FRAME);

/** Every frame box is where it was, to half a pixel. */
const expectSameFrame = (now: Frame, start: Frame, phase: string): void => {
  FRAME_SELECTORS.forEach((sel) => {
    const a = now[sel];
    const b = start[sel];
    expect(a, `${sel} missing at ${phase}`).not.toBeNull();
    expect(b, `${sel} missing at the start`).not.toBeNull();
    if (a === null || b === null || a === undefined || b === undefined) return;
    (['x', 'y', 'w', 'h'] as const).forEach((side) => {
      expect(
        Math.abs(a[side] - b[side]),
        `${sel} changed (${side}) at ${phase}`,
      ).toBeLessThanOrEqual(0.5);
    });
  });
};

/**
 * No scroll anywhere (or, where the viewport is under the floor, only the document's), eleven
 * same-size cells in `rows` rows: a phone's first six share a top.
 */
const expectGeometry = async (page: Page, vp: Viewport, phase: string): Promise<void> => {
  const { rows } = vp;
  const fits = await page.evaluate<Fits>(FITS);
  expect(fits, `overflow at ${phase}`).toEqual({
    document: !vp.scrolls,
    app: true,
    tableScreen: true,
    hand: true,
    actionsReachable: true,
  });
  const slots = await page.evaluate<Slots>(SLOTS);
  expect(slots.tops, `slot count at ${phase}`).toHaveLength(11);
  expect(slots.sizes, `slot sizes at ${phase}`).toHaveLength(1);
  const distinct = new Set(slots.tops);
  expect(distinct.size, `rows at ${phase}`).toBe(rows);
  if (rows === 2) {
    expect(new Set(slots.tops.slice(0, 6)).size, `first row at ${phase}`).toBe(1);
    expect(new Set(slots.tops.slice(6)).size, `second row at ${phase}`).toBe(1);
  }
};

type Viewport = Readonly<{
  width: number;
  height: number;
  rows: 1 | 2;
  /** The names the two seats play as; the inputs take 20 characters. */
  names: Readonly<[string, string]>;
  /** Under the floor sizes' height: the document scrolls to the actions row instead of clipping it. */
  scrolls: boolean;
}>;
const SHORT_NAMES: Readonly<[string, string]> = ['Ann', 'Bob'];
const LONG_NAMES: Readonly<[string, string]> = ['Bartholomew Jefferso', 'Grandma Rosalind Que'];
const VIEWPORTS: Readonly<Record<string, Viewport>> = {
  phone: { width: 390, height: 844, rows: 2, names: SHORT_NAMES, scrolls: false },
  desktop: { width: 1280, height: 800, rows: 1, names: SHORT_NAMES, scrolls: false },
  'phone-short': { width: 375, height: 667, rows: 2, names: LONG_NAMES, scrolls: false },
  // An iPhone SE with Safari's toolbar shown, and a phone in landscape: the floor's 658px do not fit.
  'phone-toolbar': { width: 375, height: 553, rows: 2, names: SHORT_NAMES, scrolls: true },
  'phone-landscape': { width: 844, height: 390, rows: 2, names: SHORT_NAMES, scrolls: true },
};

Object.entries(VIEWPORTS).forEach(([name, vp]) => {
  test.describe(name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('nothing scrolls and the frame keeps its boxes from the upcard to the round over', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await ginStartLocal(page, pagePath(project, 'gin-rummy'), vp, vp.names);
      await expectGeometry(page, vp, 'upcard');
      const start = await frameOf(page);
      const check = async (phase: string): Promise<void> => {
        await expectGeometry(page, vp, phase);
        expectSameFrame(await frameOf(page), start, phase);
      };

      // Both pass: the first player draws from the stock.
      await ginPassUpcard(page);
      await ginReveal(page);
      await check('upcard, second seat');
      await ginPassUpcard(page);
      await ginReveal(page);
      await expect(page.locator('#hand .slot.ghost.open')).toHaveCount(1);
      await check('draw');

      await page.locator('#stockPile').click();
      await expect(page.locator('#hand .slot.ghost.shown .card.fresh')).toHaveCount(1);
      await check('shown');

      await ginAcceptDraw(page);
      await expect(page.locator('#statusSub')).toHaveText('Tap a card to select it');
      await check('accepted');

      const pick = await chooseDiscard(page);
      await selectCard(page, pick.id);
      await check('selected');
      if ((await finishTurn(page, pick.knock)) === 'next') {
        await check('next turn, under the curtain');
        await playToRoundOver(page);
      }

      // The round over: the sheet hidden, "Show results" in the actions row, the banner not mine.
      await expect(page.locator('#roundResultOverlay')).toBeVisible();
      await page.locator('#rrHideBtn').click();
      await expect(page.locator('#actions [data-act="showResult"]')).toBeVisible();
      await expect(page.locator('#statusBanner')).not.toHaveClass(/mine/);
      await check('round over');
    });
  });
});
