// The owner's sentence as a real-click test (docs/design/gin-draw-ghost-slot.md §8): "no cards
// would move position until you took an action". Pass-and-play on one page at a phone and a
// laptop viewport: the bounding box of every held card and of the ghost cell is recorded before a
// draw, the stock (or the upcard) is tapped, and every held box must be where it was while the
// drawn card sits in the ghost cell; accepting it re-melds the eleven; undoing the upcard puts the
// ten back in their boxes with the ghost cell open again, while a stock draw offers no undo at all
// (docs/design/gin-arrangement-and-discards.md §4). The layouts differ by design (six columns in
// two rows on the phone, one row of eleven on the laptop) and neither scrolls.
import type { Page } from '@playwright/test';

import { ginAcceptDraw, ginPassUpcard, ginReveal, ginStartLocal } from './fixtures/gin.ts';
import { pagePath } from './fixtures/site.ts';
import { expect, test } from './fixtures/two-players.ts';

type Box = Readonly<{ x: number; y: number; w: number; h: number }>;
type Boxes = Readonly<Record<string, Box>>;

/** `data-card -> box` of the held cards (the ghost cell's card excluded). */
const HELD_BOXES = `Object.fromEntries(Array.from(document.querySelectorAll('#hand .slot:not(.ghost) .card')).map((c) => {
  const r = c.getBoundingClientRect();
  return [c.getAttribute('data-card'), { x: r.x, y: r.y, w: r.width, h: r.height }];
}))`;
const boxOf = (selector: string): string =>
  `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el === null) return null;
  const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`;
/** The distinct tops of the eleven slot cells: the rows the grid laid out. */
const SLOT_ROWS = `new Set(Array.from(document.querySelectorAll('#hand .slot')).map((s) => Math.round(s.getBoundingClientRect().top))).size`;
const NO_SCROLL = `['app', 'hand'].every((id) => { const el = document.getElementById(id); return el.scrollHeight <= el.clientHeight + 1; })`;

const heldBoxes = (page: Page): Promise<Boxes> => page.evaluate<Boxes>(HELD_BOXES);
const ghostBox = (page: Page): Promise<Box | null> =>
  page.evaluate<Box | null>(boxOf('#hand .slot.ghost'));

/** Every recorded card is still exactly where it was (half a pixel of tolerance for rounding). */
const expectSameBoxes = (after: Boxes, before: Boxes): void => {
  expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
  Object.entries(before).forEach(([id, box]) => {
    const now = after[id];
    expect(now, `card ${id} left the hand`).toBeDefined();
    if (now === undefined) return;
    (['x', 'y', 'w', 'h'] as const).forEach((side) => {
      expect(Math.abs(now[side] - box[side]), `card ${id} moved (${side})`).toBeLessThanOrEqual(
        0.5,
      );
    });
  });
};

/** `inner` lies inside `outer` (the drawn card inside the ghost cell). */
const expectInside = (inner: Box | null, outer: Box | null): void => {
  expect(inner).not.toBeNull();
  expect(outer).not.toBeNull();
  if (inner === null || outer === null) return;
  expect(inner.x).toBeGreaterThanOrEqual(outer.x - 0.5);
  expect(inner.y).toBeGreaterThanOrEqual(outer.y - 0.5);
  expect(inner.x + inner.w).toBeLessThanOrEqual(outer.x + outer.w + 0.5);
  expect(inner.y + inner.h).toBeLessThanOrEqual(outer.y + outer.h + 0.5);
};

/** The geometry both layouts share: eleven cells, none scrolling, the rows the viewport implies. */
const expectLayout = async (page: Page, rows: number): Promise<void> => {
  await expect(page.locator('#hand .slot')).toHaveCount(11);
  expect(await page.evaluate<number>(SLOT_ROWS), 'rows of slots').toBe(rows);
  expect(await page.evaluate<boolean>(NO_SCROLL), '#app or #hand scrolls').toBe(true);
};

const VIEWPORTS = {
  phone: { width: 390, height: 844, rows: 2 },
  desktop: { width: 1280, height: 800, rows: 1 },
} as const;

Object.entries(VIEWPORTS).forEach(([name, vp]) => {
  test.describe(name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('a stock draw moves nothing until the card is accepted, and offers no undo', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await ginStartLocal(page, pagePath(project, 'gin-rummy'), vp);
      // Both pass the upcard, so the first player draws (from the stock only).
      await ginPassUpcard(page);
      await ginReveal(page);
      await ginPassUpcard(page);
      await ginReveal(page);
      await expect(page.locator('#statusSub')).toHaveText('Both passed — tap the stock to draw');
      await expect(page.locator('#stockPile')).toHaveClass(/tappable/);
      await expect(page.locator('#hand .slot.ghost.open')).toHaveCount(1);
      await expectLayout(page, vp.rows);
      const before = await heldBoxes(page);
      const ghost = await ghostBox(page);
      expect(Object.keys(before)).toHaveLength(10);

      // The draw: the ten stay put, the eleventh lands in the ghost cell with the dot, no lock.
      await page.locator('#stockPile').click();
      const fresh = page.locator('#hand .slot.ghost.shown .card.fresh');
      await expect(fresh).toHaveCount(1);
      await expect(fresh).not.toHaveClass(/locked/);
      expectSameBoxes(await heldBoxes(page), before);
      expectInside(await page.evaluate<Box | null>(boxOf('#hand .slot.ghost.shown .card')), ghost);
      await expect(page.locator('#hand .card')).toHaveCount(11);
      // A stock draw is final: no undo button while the card waits in the ghost cell.
      await expect(page.locator('#actions [data-act="undoDraw"]')).toHaveCount(0);
      await expect(page.locator('#actions [data-act="discard"]')).toBeDisabled();
      await expect(page.locator('#statusSub')).toHaveText(
        'Tap the new card to keep it, or pick a discard',
      );
      await expectLayout(page, vp.rows);
      const freshId = await fresh.getAttribute('data-card');

      // Accept: eleven cards in eleven slots, the dot still on the drawn card, no ghost cell, and
      // still no undo button.
      await ginAcceptDraw(page);
      await expect(page.locator('#hand .card.fresh')).toHaveAttribute('data-card', freshId ?? '');
      await expect(page.locator('#hand .slot')).toHaveCount(11);
      await expect(page.locator('#actions [data-act="undoDraw"]')).toHaveCount(0);
      await expect(page.locator('#actions [data-act="discard"]')).toBeDisabled();
      await expect(page.locator('#statusSub')).toHaveText('Tap a card to select it');
      await expectLayout(page, vp.rows);
    });

    test('taking the upcard shows it locked in the ghost cell; nothing moves; accept and undo', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await ginStartLocal(page, pagePath(project, 'gin-rummy'), vp);
      await expect(page.locator('#hand .slot.ghost.open')).toHaveCount(1);
      await expect(page.locator('#discardPile')).toHaveClass(/tappable/);
      const upcard = await page.locator('#discardPile .card').getAttribute('data-card');
      const before = await heldBoxes(page);
      const ghost = await ghostBox(page);

      await page.locator('#actions [data-act="takeUpcard"]').click();
      const taken = page.locator('#hand .slot.ghost.shown .card.fresh.locked');
      await expect(taken).toHaveAttribute('data-card', upcard ?? '');
      expectSameBoxes(await heldBoxes(page), before);
      expectInside(await page.evaluate<Box | null>(boxOf('#hand .slot.ghost.shown .card')), ghost);
      await expect(page.locator('#actions [data-act="undoDraw"]')).toBeEnabled();
      await expectLayout(page, vp.rows);

      await ginAcceptDraw(page);
      await expect(page.locator('#hand .card.locked')).toHaveAttribute('data-card', upcard ?? '');
      await expect(page.locator('#actions [data-act="undoDraw"]')).toBeEnabled();

      // Undo: ten cards back in their boxes, the ghost cell open, the upcard back on the pile and
      // Take offered again.
      await page.locator('#actions [data-act="undoDraw"]').click();
      await expect(page.locator('#hand .card')).toHaveCount(10);
      await expect(page.locator('#hand .slot.ghost.open')).toHaveCount(1);
      await expect(page.locator('#discardPile .card')).toHaveAttribute('data-card', upcard ?? '');
      await expect(page.locator('#statusSub')).toHaveText('Take the upcard or pass');
      await expect(page.locator('#actions [data-act="takeUpcard"]')).toBeVisible();
      expectSameBoxes(await heldBoxes(page), before);
      expect(await ghostBox(page)).toEqual(ghost);
    });
  });
});
