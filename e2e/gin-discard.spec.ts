// The discard flow as the owner asked for it (docs/design/gin-arrangement-and-discards.md §5, §11):
// "selecting a card to discard and then clicking other stuff - that won't rearrange your hand",
// and the hand is re-arranged at the start of the next turn. Pass-and-play on one page at a phone
// and a laptop viewport: the upcard is taken and accepted (the ten keep their boxes, the taken
// card fills the ghost cell's), a free card is selected, and then everything else on the table is
// tapped (another card, the same card, the locked card, both piles, the rules, the history, the
// arrange sheet, the discarded-cards sheet and, when the hand melds two ways, the chooser) while
// every slot cell holds its box; the discard goes through, the curtain passes the phone, and the
// other seat's turn starts with Arrange idle (its hand is the engine's arrangement). The
// discarded-cards sheet (§8) is checked after the deal: the upcard is the one chip greyed and
// ringed, the toggle greys the ten held cards too, and both ways of closing work. The `player`
// fixture seeds Math.random per title, so the deal is the same on every run.
import type { Page } from '@playwright/test';

import { expectSameBoxes, slotBoxes } from './fixtures/boxes.ts';
import { ginAcceptDraw, ginStartLocal, ginTakeUpcard } from './fixtures/gin.ts';
import { pagePath } from './fixtures/site.ts';
import { expect, test } from './fixtures/two-players.ts';

const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
} as const;

Object.entries(VIEWPORTS).forEach(([name, vp]) => {
  test.describe(name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('a selection survives every other tap without moving a cell; the discard passes the turn; the next seat starts arranged', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await ginStartLocal(page, pagePath(project, 'gin-rummy'), vp);

      // The discarded-cards sheet after the deal: the upcard alone, greyed and ringed; the toggle
      // greys my ten as well; the button and the backdrop both close it.
      const upcard = await page.locator('#discardPile .card').getAttribute('data-card');
      await page.locator('#discardsBtn').click();
      await expect(page.locator('#discardsOverlay')).toBeVisible();
      await expect(page.locator('#discardsGrid .dc')).toHaveCount(52);
      await expect(page.locator('#discardsGrid .dc.seen')).toHaveCount(1);
      await expect(page.locator('#discardsGrid .dc.top')).toHaveAttribute(
        'data-card',
        upcard ?? '',
      );
      await expect(page.locator('#discardsGrid .dc.held')).toHaveCount(0);
      await expect(page.locator('#discardsSub')).toHaveText('1 of 52 discarded');
      await page.locator('#discardsHandToggle').check();
      await expect(page.locator('#discardsGrid .dc.held')).toHaveCount(10);
      await expect(page.locator('#discardsSub')).toHaveText('1 of 52 discarded · 10 in your hand');
      await page.locator('#closeDiscardsBtn').click();
      await expect(page.locator('#discardsOverlay')).toBeHidden();
      await page.locator('#discardsBtn').click();
      await expect(page.locator('#discardsOverlay')).toBeVisible();
      await page.locator('#discardsOverlay').click({ position: { x: 4, y: 4 } });
      await expect(page.locator('#discardsOverlay')).toBeHidden();

      const ghost = page.locator('#hand .slot.ghost');
      const ghostBox = await ghost.boundingBox();
      await ginTakeUpcard(page);
      const before = await slotBoxes(page);
      const taken = (await page.locator('#hand .slot.ghost .card').getAttribute('data-card')) ?? '';

      // Accept: the ten keep their cells, the taken card's cell is the ghost's.
      await ginAcceptDraw(page);
      const accepted = await slotBoxes(page);
      expectSameBoxes(
        Object.fromEntries(Object.entries(accepted).filter(([id]) => id !== taken)),
        Object.fromEntries(Object.entries(before).filter(([id]) => id !== taken)),
        'accept',
      );
      expect(accepted[taken]?.x, 'the taken card in the ghost cell').toBeCloseTo(
        ghostBox?.x ?? -1,
        0,
      );
      expect(accepted[taken]?.y).toBeCloseTo(ghostBox?.y ?? -1, 0);
      await expect(page.locator('#actions [data-act="undoDraw"]')).toBeVisible();
      await expect(page.locator('#arrangeBtn')).toBeEnabled();

      // Select a free card.
      const free = page.locator('#hand .card:not(.locked)');
      const firstId = (await free.nth(0).getAttribute('data-card')) ?? '';
      const secondId = (await free.nth(1).getAttribute('data-card')) ?? '';
      const card = (id: string): ReturnType<Page['locator']> =>
        page.locator(`#hand .card[data-card="${id}"]`);
      await card(firstId).click();
      await expect(card(firstId)).toHaveClass(/selected/);
      await expect(page.locator('#statusSub')).toHaveText('Discard it, or knock if you can');
      await expect(page.locator('#deadwoodInfo')).toContainText('Deadwood after discard:');
      await expect(page.locator('#actions [data-act="discard"]')).toBeEnabled();
      const still = async (when: string): Promise<void> => {
        expectSameBoxes(await slotBoxes(page), accepted, when);
      };
      await still('selected');

      // Click other stuff: nothing moves a cell.
      await card(secondId).click();
      await expect(card(secondId)).toHaveClass(/selected/);
      await still('another card');
      await card(secondId).click();
      await expect(page.locator('#hand .card.selected')).toHaveCount(0);
      await still('deselected');
      await card(firstId).click();
      await expect(card(firstId)).toHaveClass(/selected/);
      await card(taken).click();
      await expect(page.locator('#toast')).toHaveText(
        "You can't discard the card you just took from the discard pile.",
      );
      await expect(card(firstId)).toHaveClass(/selected/);
      await still('the locked card');
      await page.locator('#stockPile').click();
      await page.locator('#discardPile').click();
      await still('the piles');
      await page.locator('#rulesBtnGame').click();
      await expect(page.locator('#rulesOverlay')).toBeVisible();
      await page.locator('#closeRulesBtn').click();
      await page.locator('#historyBtn').click();
      await expect(page.locator('#historyOverlay')).toBeVisible();
      await page.locator('#closeHistoryBtn').click();
      await still('rules and history');
      await page.locator('#arrangeBtn').click();
      await expect(page.locator('#arrangeOverlay')).toBeVisible();
      await page.locator('#closeArrangeBtn').click();
      await expect(page.locator('#arrangeOverlay')).toBeHidden();
      await still('the arrange sheet');
      await page.locator('#discardsBtn').click();
      await expect(page.locator('#discardsOverlay')).toBeVisible();
      await page.locator('#closeDiscardsBtn').click();
      await expect(page.locator('#discardsOverlay')).toBeHidden();
      await still('the discarded-cards sheet');
      if ((await page.locator('#deadwoodInfo.tappable-dw').count()) === 1) {
        await page.locator('#deadwoodInfo').click();
        await expect(page.locator('#meldOverlay')).toBeVisible();
        await page.locator('#closeMeldBtn').click();
        await still('the chooser');
      }
      await expect(card(firstId)).toHaveClass(/selected/);

      // Discard: ten cards, the discarded one on the pile, the curtain up for the other seat.
      await page.locator('#actions [data-act="discard"]').click();
      await expect(page.locator('#hand .card')).toHaveCount(10);
      await expect(page.locator('#discardPile .card')).toHaveAttribute('data-card', firstId);
      await expect(page.locator('#curtainOverlay')).toBeVisible();
      await page.locator('#curtainBtn').click();

      // The other seat's turn starts arranged: Arrange enabled but not due.
      await expect(page.locator('#statusMain')).toHaveText('Your turn');
      await expect(page.locator('#arrangeBtn')).toBeEnabled();
      await expect(page.locator('#arrangeBtn')).not.toHaveClass(/due/);
      await page.locator('#stockPile').click();
      await expect(page.locator('#hand .slot.ghost.shown .card.fresh')).toHaveCount(1);
      await expect(page.locator('#actions [data-act="undoDraw"]')).toHaveCount(0);
      await expect(page.locator('#arrangeBtn')).toBeDisabled();
      await ginAcceptDraw(page);
      await expect(page.locator('#arrangeBtn')).toBeEnabled();
    });
  });
});
