// The table's fixed geometry as a real-click test (docs/design/gin-draw-ghost-slot.md §5, PR B):
// the sizes are bounded by the viewport in CSS alone, so the page never scrolls and nothing above
// the hand changes size or place between phases. Pass-and-play on one page at a phone, a laptop
// and a short phone (the last with the 20-character names the inputs allow, which must ellipsize
// in the hand header rather than wrap it); at the upcard decision, the draw, the shown draw, the
// accepted draw, the selection, the next player's turn under the curtain and the round over: the
// document, `#app`, `#tableScreen` and `#hand` hold their content without overflow, the actions row
// ends inside the viewport, the eleven slot cells are one size in the rows the width implies (six
// columns in two rows on a phone, one row of eleven on the laptop), and the frame (topbar, opponent
// strip, both piles, status banner, last-action line) keeps the bounding boxes it had at the start,
// and the hand's frame (hand area, hand header, hand grid, actions row) keeps its boxes within a
// turn, from the draw through the shown card, the accept and the selection: the row count may
// change only where the picture is re-arranged (a turn start, a discard; docs/design/gin-
// arrangement-and-discards.md §6). Two viewports the floor sizes cannot fit (a
// phone in landscape, a phone with the browser's toolbar shown) exercise theme.css's fallback: the
// document scrolls (`#app` and `#tableScreen` clip nothing) and the actions row is reachable at the
// bottom of that scroll. The turns after the first are played through the documented `window.__gin`
// hook (docs/ARCHITECTURE.md; e2e/fixtures/gin-play.ts): the least-deadwood discard, a knock as
// soon as one is legal, so the round ends in a few turns; a void hand ends it too.
import type { Page } from '@playwright/test';

import {
  expectHandRows,
  ginAcceptDraw,
  ginPassUpcard,
  ginReveal,
  ginStartLocal,
} from './fixtures/gin.ts';
import { chooseDiscard, finishTurn, playToRoundOver, selectCard } from './fixtures/gin-play.ts';
import { pagePath } from './fixtures/site.ts';
import { expect, test } from './fixtures/two-players.ts';

type Box = Readonly<{ x: number; y: number; w: number; h: number }>;
type Frame = Readonly<Record<string, Box | null>>;

/** Everything above the hand: one box each, in every phase. */
const FIXED_SELECTORS: ReadonlyArray<string> = [
  '#tableScreen .topbar',
  '#tableScreen .opp-strip',
  '#stockPile',
  '#discardPile',
  '#statusBanner',
  '#lastAction',
];
/** The hand's frame: one box each within a turn. */
const HAND_SELECTORS: ReadonlyArray<string> = [
  '#tableScreen .hand-area',
  '#tableScreen .hand-header',
  '#hand',
  '#actions',
];
const FRAME_SELECTORS: ReadonlyArray<string> = [...FIXED_SELECTORS, ...HAND_SELECTORS];
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
    // A third row on a phone too short for it may scroll the document (theme.css's :has fallback).
    tallHand: document.getElementById('hand').getAttribute('data-rows') === '3' && window.innerHeight <= 736 && window.innerWidth < 900,
  };
})()`;

type Fits = Readonly<
  Record<'document' | 'app' | 'tableScreen' | 'hand' | 'actionsReachable' | 'tallHand', boolean>
>;
const frameOf = (page: Page): Promise<Frame> => page.evaluate<Frame>(FRAME);

/** Every box of `selectors` is where it was, to half a pixel. */
const expectSameFrame = (
  now: Frame,
  start: Frame,
  phase: string,
  selectors: ReadonlyArray<string> = FRAME_SELECTORS,
): void => {
  selectors.forEach((sel) => {
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
 * No scroll anywhere (or, where the viewport is under the floor or a third row needs it, only the
 * document's), eleven same-size cells in the rows the width implies (`expectHandRows`).
 */
const expectGeometry = async (page: Page, vp: Viewport, phase: string): Promise<void> => {
  const fits = await page.evaluate<Fits>(FITS);
  expect(fits, `overflow at ${phase}`).toEqual({
    document: !vp.scrolls && !fits.tallHand,
    app: true,
    tableScreen: true,
    hand: true,
    actionsReachable: true,
    tallHand: fits.tallHand,
  });
  await expectHandRows(page, vp.columns);
};

type Viewport = Readonly<{
  width: number;
  height: number;
  columns: 6 | 11;
  /** The names the two seats play as; the inputs take 20 characters. */
  names: Readonly<[string, string]>;
  /** Under the floor sizes' height: the document scrolls to the actions row instead of clipping it. */
  scrolls: boolean;
}>;
const SHORT_NAMES: Readonly<[string, string]> = ['Ann', 'Bob'];
const LONG_NAMES: Readonly<[string, string]> = ['Bartholomew Jefferso', 'Grandma Rosalind Que'];
const VIEWPORTS: Readonly<Record<string, Viewport>> = {
  phone: { width: 390, height: 844, columns: 6, names: SHORT_NAMES, scrolls: false },
  desktop: { width: 1280, height: 800, columns: 11, names: SHORT_NAMES, scrolls: false },
  'phone-short': { width: 375, height: 667, columns: 6, names: LONG_NAMES, scrolls: false },
  // An iPhone SE with Safari's toolbar shown, and a phone in landscape: the floor's 658px do not fit.
  'phone-toolbar': { width: 375, height: 553, columns: 6, names: SHORT_NAMES, scrolls: true },
  'phone-landscape': { width: 844, height: 390, columns: 6, names: SHORT_NAMES, scrolls: true },
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
      // The frame above the hand holds in every phase; the hand's frame holds within a turn.
      const check = async (phase: string, turn: Frame | null = null): Promise<void> => {
        await expectGeometry(page, vp, phase);
        const now = await frameOf(page);
        expectSameFrame(now, start, phase, FIXED_SELECTORS);
        if (turn !== null) expectSameFrame(now, turn, phase, HAND_SELECTORS);
      };

      // Both pass: the first player draws from the stock.
      await ginPassUpcard(page);
      await ginReveal(page);
      await check('upcard, second seat');
      await ginPassUpcard(page);
      await ginReveal(page);
      await expect(page.locator('#hand .slot.ghost.open')).toHaveCount(1);
      await check('draw');
      const turn = await frameOf(page);

      await page.locator('#stockPile').click();
      await expect(page.locator('#hand .slot.ghost.shown .card.fresh')).toHaveCount(1);
      await check('shown', turn);

      await ginAcceptDraw(page);
      await expect(page.locator('#statusSub')).toHaveText('Tap a card to select it');
      await check('accepted', turn);

      const pick = await chooseDiscard(page);
      await selectCard(page, pick.id);
      await check('selected', turn);
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
