// The table's fixed geometry as a real-click test (docs/design/gin-draw-ghost-slot.md §5, PR B):
// the sizes are bounded by the viewport in CSS alone, so the page never scrolls and nothing above
// the hand changes size or place between phases. Pass-and-play on one page at a phone, a laptop
// and a short phone; at the upcard decision, the draw, the shown draw, the accepted draw, the
// selection, the next player's turn under the curtain and the round over: the document, `#app`,
// `#tableScreen` and `#hand` hold their content without overflow, the actions row ends inside the
// viewport, the eleven slot cells are one size in the rows the width implies (six columns in two
// rows on a phone, one row of eleven on the laptop), and the frame (topbar, opponent strip, both
// piles, status banner, last-action line, hand grid and actions row) keeps the bounding boxes it had
// at the start. The turns after the first are played through the documented `window.__gin` hook
// (docs/ARCHITECTURE.md): the least-deadwood discard, a knock as soon as one is legal, so the round
// ends in a few turns; a void hand ends it too.
import type { Page } from '@playwright/test';

import { ginAcceptDraw, ginPassUpcard, ginReveal, ginStartLocal } from './fixtures/gin.ts';
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
  '#hand',
  '#actions',
];
const FRAME = `Object.fromEntries(${JSON.stringify(FRAME_SELECTORS)}.map((sel) => {
  const el = document.querySelector(sel);
  if (el === null) return [sel, null];
  const r = el.getBoundingClientRect();
  return [sel, { x: r.x, y: r.y, w: r.width, h: r.height }];
}))`;
/** Nothing scrolls or is clipped: content fits its box at every level, the actions row is on screen. */
const FITS = `(() => {
  const fits = (id) => { const el = document.getElementById(id); return el.scrollHeight <= el.clientHeight + 1; };
  const actions = document.getElementById('actions').getBoundingClientRect();
  return {
    document: document.documentElement.scrollHeight <= window.innerHeight + 1,
    app: fits('app'), tableScreen: fits('tableScreen'), hand: fits('hand'),
    actionsOnScreen: actions.bottom <= window.innerHeight + 0.5,
  };
})()`;
/** The slot cells' sizes (rounded to a tenth) and their tops, in DOM order. */
const SLOTS = `(() => {
  const slots = Array.from(document.querySelectorAll('#hand .slot')).map((s) => s.getBoundingClientRect());
  const tenth = (n) => Math.round(n * 10) / 10;
  return { sizes: Array.from(new Set(slots.map((r) => tenth(r.width) + 'x' + tenth(r.height)))), tops: slots.map((r) => Math.round(r.top)) };
})()`;

type Fits = Readonly<
  Record<'document' | 'app' | 'tableScreen' | 'hand' | 'actionsOnScreen', boolean>
>;
type Slots = Readonly<{ sizes: ReadonlyArray<string>; tops: ReadonlyArray<number> }>;
type HookView = Readonly<{
  phase: string;
  discardOptions: Readonly<
    Record<string, Readonly<{ locked?: boolean; deadwood?: number; canKnock?: boolean }>>
  > | null;
}>;

const frameOf = (page: Page): Promise<Frame> => page.evaluate<Frame>(FRAME);
const readView = (page: Page): Promise<HookView | null> =>
  page.evaluate<HookView | null>('window.__gin.app.view');

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

/** No scroll anywhere, eleven same-size cells in `rows` rows: a phone's first six share a top. */
const expectGeometry = async (page: Page, rows: 1 | 2, phase: string): Promise<void> => {
  const fits = await page.evaluate<Fits>(FITS);
  expect(fits, `overflow at ${phase}`).toEqual({
    document: true,
    app: true,
    tableScreen: true,
    hand: true,
    actionsOnScreen: true,
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

/** The discard that leaves the least deadwood, or the one that lets the player knock. */
const chooseDiscard = async (page: Page): Promise<Readonly<{ id: string; knock: boolean }>> => {
  const view = await readView(page);
  const options = Object.entries(view?.discardOptions ?? {})
    .filter(([, o]) => o.locked !== true)
    .map(([id, o]) => ({ id, deadwood: o.deadwood ?? Infinity, knock: o.canKnock === true }));
  const knock = options.find((o) => o.knock);
  const best = [...options].sort((a, b) => a.deadwood - b.deadwood)[0];
  const pick = knock ?? best;
  if (pick === undefined) throw new Error(`no discard in phase ${view?.phase ?? 'none'}`);
  return { id: pick.id, knock: pick.knock };
};

/**
 * Discard the selected card, or knock with it. The reducer runs in the click, so the view read
 * after it is the outcome: the round is over (a knock, or a void hand when the stock ran out; the
 * result sheet is up) or the curtain is up for the next player.
 */
const finishTurn = async (page: Page, knock: boolean): Promise<'over' | 'next'> => {
  await page.locator(`#actions [data-act="${knock ? 'knock' : 'discard'}"]`).click();
  const after = await readView(page);
  if (after?.phase === 'roundOver') {
    await expect(page.locator('#roundResultOverlay')).toBeVisible();
    return 'over';
  }
  await expect(page.locator('#curtainOverlay')).toBeVisible();
  return 'next';
};

const select = async (page: Page, id: string): Promise<void> => {
  const card = page.locator(`#hand .card[data-card="${id}"]`);
  await card.click();
  await expect(card).toHaveClass(/selected/);
};

/** Turns from under the curtain until the round is over: a knock or, when the stock runs out, a void hand. */
const playToRoundOver = async (page: Page, turn = 1): Promise<void> => {
  if (turn > 40) throw new Error('no round end within 40 turns');
  await ginReveal(page);
  const before = await readView(page);
  if (before?.phase === 'draw') {
    await page.locator('#stockPile').click();
    await ginAcceptDraw(page);
  }
  const pick = await chooseDiscard(page);
  await select(page, pick.id);
  if ((await finishTurn(page, pick.knock)) === 'over') return;
  return playToRoundOver(page, turn + 1);
};

const VIEWPORTS = {
  phone: { width: 390, height: 844, rows: 2 },
  desktop: { width: 1280, height: 800, rows: 1 },
  'phone-short': { width: 375, height: 667, rows: 2 },
} as const;

Object.entries(VIEWPORTS).forEach(([name, vp]) => {
  test.describe(name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('nothing scrolls and the frame keeps its boxes from the upcard to the round over', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await ginStartLocal(page, pagePath(project, 'gin-rummy'), vp);
      await expectGeometry(page, vp.rows, 'upcard');
      const start = await frameOf(page);
      const check = async (phase: string): Promise<void> => {
        await expectGeometry(page, vp.rows, phase);
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
      await select(page, pick.id);
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
