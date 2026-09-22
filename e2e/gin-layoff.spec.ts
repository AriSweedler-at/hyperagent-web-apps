// Laying off by hand (docs/design/gin-arrangement-and-discards.md §7b), over the `layoff-mine`
// story with `&live`: Bob answers Ann's knock. Her three melds sit on the table with their cards
// pinned and his 4S already laid on the spades; dragging his 5S over the spade run lights it (and
// only it), releasing lays the card off (gold, lifted) and the hand shrinks by one; dragging the
// laid 5S off the melds takes it back; laid again and Done, the result sheet shows exactly those
// two cards laid off. Both viewports; `pages` only, the same bytes on both origins.
import { expect, test, type Page } from '@playwright/test';

import { ALLOWED_FAILURES } from './fixtures/offline.ts';
import { pagePath } from './fixtures/site.ts';
import { watchPage } from './fixtures/watch.ts';

const LAID = `Array.from(document.querySelectorAll('#tableMelds .card.laid')).map((c) => c.getAttribute('data-card'))`;
type Ids = ReadonlyArray<string>;

const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
} as const;

/** Drag the card `id` (in the hand or on the table) to the centre of `target`, holding at the end. */
const dragTo = async (page: Page, id: string, target: string): Promise<void> => {
  const from = await page.locator(`.card[data-card="${id}"]`).first().boundingBox();
  const to = await page.locator(target).boundingBox();
  if (from === null || to === null) throw new Error(`no box for ${id} or ${target}`);
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, { steps: 2 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 6 });
};

Object.entries(VIEWPORTS).forEach(([name, vp]) => {
  test.describe(name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('lay a card off by dragging it onto the meld it fits, take it back by dragging it off, lay it again, Done', async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== 'pages', 'runs once: the same bytes on both origins');
      const watched = watchPage(page, ALLOWED_FAILURES);
      await page.goto(`${pagePath('pages', 'gin-rummy')}?story=layoff-mine&live`);
      await expect(page.locator('#tableScreen')).toBeVisible();
      const melds = page.locator('#tableMelds');
      await expect(melds).toBeVisible();
      await expect(page.locator('#stockPile')).toBeHidden();
      await expect(melds.locator('.meld-group')).toHaveCount(3);
      await expect(melds.locator('.card.pinned')).toHaveCount(9);
      expect(await page.evaluate<Ids>(LAID)).toEqual(['4S']);
      await expect(page.locator('#hand .card')).toHaveCount(9);
      await expect(page.locator('#statusSub')).toHaveText("Lay off onto Ann's melds, then Done");
      await expect(page.locator('#actions [data-act="finishLayoff"]')).toBeVisible();
      const spades = melds.locator('.meld-group', { has: page.locator('.card[data-card="AS"]') });

      // Over the spade run the 5S fits: that group lights up, and only that one; released, laid.
      await dragTo(page, '5S', `#tableMelds .meld-group:has(.card[data-card="AS"])`);
      await expect(spades).toHaveClass(/drop/);
      await expect(melds.locator('.meld-group.drop')).toHaveCount(1);
      await page.mouse.up();
      await expect.poll(() => page.evaluate<Ids>(LAID)).toEqual(['4S', '5S']);
      await expect(page.locator('#hand .card')).toHaveCount(8);
      await expect(melds.locator('.meld-group.drop')).toHaveCount(0);
      await expect(page.locator('#deadwoodInfo')).toContainText('Deadwood: 20');
      await expect(page.locator('#lastAction')).toHaveText('Bob laid off the 5♠.');

      // A card that fits no meld lights nothing and stays in the hand.
      await dragTo(page, 'QD', `#tableMelds .meld-group:has(.card[data-card="AS"])`);
      await expect(melds.locator('.meld-group.drop')).toHaveCount(0);
      await page.mouse.up();
      await expect(page.locator('#hand .card')).toHaveCount(8);

      // Dragged off the melds, the 5S comes back to the hand; the 4S holds it, so it cannot yet.
      await dragTo(page, '5S', '#hand');
      await page.mouse.up();
      await expect.poll(() => page.evaluate<Ids>(LAID)).toEqual(['4S']);
      await expect(page.locator('#hand .card')).toHaveCount(9);
      await expect(page.locator('#lastAction')).toHaveText('Bob took the 5♠ back.');

      // Laid again and finished: the sheet shows the two cards laid off onto Ann's spades.
      await dragTo(page, '5S', `#tableMelds .meld-group:has(.card[data-card="AS"])`);
      await page.mouse.up();
      await expect.poll(() => page.evaluate<Ids>(LAID)).toEqual(['4S', '5S']);
      await page.locator('#actions [data-act="finishLayoff"]').click();
      await expect(page.locator('#roundResultOverlay')).toBeVisible();
      await expect(page.locator('#rrTitle')).toHaveText('Ann knocked');
      await expect(page.locator('#rrBody .meld-group.laid .card')).toHaveCount(2);
      await expect(page.locator('#rrBody')).toContainText('Deadwood · 20');
      expect(watched.errors(), 'uncaught exceptions').toEqual([]);
    });
  });
});
