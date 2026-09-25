// The owner's sentence as a real-click test (docs/design/gin-draw-ghost-slot.md §8): "no cards
// would move position until you took an action". Pass-and-play on one page at a phone and a
// laptop viewport: the bounding box of every held card and of the ghost cell is recorded before a
// draw, the stock (or the upcard) is tapped, and every held box must be where it was while the
// drawn card sits in the ghost cell; accepting it moves nothing either: the ten keep their boxes
// and the drawn card takes the ghost cell's place as the last loose card (docs/design/gin-
// arrangement-and-discards.md §5); undoing the upcard puts the ten back in their boxes with the
// ghost cell open again, while a stock draw offers no undo at all (§4). The layouts differ by
// design (six columns on the phone, one row of eleven on the laptop) and neither scrolls.
import type { Page } from '@playwright/test';

import {
  type Box,
  boxOf,
  expectInside,
  expectSameBoxes,
  ghostBox,
  heldBoxes,
  omit,
} from './fixtures/boxes.ts';
import { expectHandRows, ginAcceptDraw, ginPassUpcard, ginStartLocal } from './fixtures/gin.ts';
import { reveal } from './fixtures/shell.ts';
import { pagePath } from './fixtures/site.ts';
import { expect, test } from './fixtures/two-players.ts';

const NO_SCROLL = `['app', 'hand'].every((id) => { const el = document.getElementById(id); return el.scrollHeight <= el.clientHeight + 1; })`;

/** The geometry both layouts share: eleven cells in the rows the width implies, none scrolling. */
const expectLayout = async (page: Page, columns: 6 | 11): Promise<void> => {
  await expect(page.locator('#hand .slot')).toHaveCount(11);
  await expectHandRows(page, columns);
  expect(await page.evaluate<boolean>(NO_SCROLL), '#app or #hand scrolls').toBe(true);
};

const VIEWPORTS = {
  phone: { width: 390, height: 844, columns: 6 },
  desktop: { width: 1280, height: 800, columns: 11 },
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
      await reveal(page);
      await ginPassUpcard(page);
      await reveal(page);
      await expect(page.locator('#statusSub')).toHaveText('Both passed — tap the stock to draw');
      await expect(page.locator('#stockPile')).toHaveClass(/tappable/);
      await expect(page.locator('#hand .slot.ghost.open')).toHaveCount(1);
      await expectLayout(page, vp.columns);
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
      await expectLayout(page, vp.columns);
      const freshId = await fresh.getAttribute('data-card');

      // Accept: the ten still in their boxes, the drawn card in the ghost cell's box as the last
      // loose card with its dot, no ghost cell, and still no undo button.
      await ginAcceptDraw(page);
      await expect(page.locator('#hand .card.fresh')).toHaveAttribute('data-card', freshId ?? '');
      await expect(page.locator('#hand .slot')).toHaveCount(11);
      expectSameBoxes(omit(await heldBoxes(page), freshId), before);
      expectInside(await page.evaluate<Box | null>(boxOf('#hand .card.fresh')), ghost);
      await expect(page.locator('#hand .slot').last()).toHaveClass(/dead/);
      await expect(page.locator('#actions [data-act="undoDraw"]')).toHaveCount(0);
      await expect(page.locator('#actions [data-act="discard"]')).toBeDisabled();
      await expect(page.locator('#statusSub')).toHaveText('Tap a card to select it');
      await expectLayout(page, vp.columns);
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
      await expectLayout(page, vp.columns);

      await ginAcceptDraw(page);
      await expect(page.locator('#hand .card.locked')).toHaveAttribute('data-card', upcard ?? '');
      expectSameBoxes(omit(await heldBoxes(page), upcard), before);
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
