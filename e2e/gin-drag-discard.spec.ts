// A hand card dragged onto the discard pile is discarded (docs/design/gin-arrangement-and-discards.md
// §5d; the owner: "you should also be able to click and drag it to be over the discard pile … the
// 'discard button' and the 'discard pile' should light up … when you hover over it such that
// releasing would discard it should hover green", the hitbox "within 50% of the discard pile"): while
// the card is in the air both targets carry `drop-ready`; over the pile, and just beside it inside
// its box grown by half, the pile carries `drop`; over the button the button does; the release
// discards the card and the turn passes under the curtain. Page-only: the same bytes on both origins.
import { expect, test } from '@playwright/test';

import { ginAcceptDraw, ginStartLocal, ginTakeUpcard } from './fixtures/gin.ts';
import { ALLOWED_FAILURES } from './fixtures/offline.ts';
import { pagePath } from './fixtures/site.ts';
import { watchPage } from './fixtures/watch.ts';

const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
} as const;

const DROP = /(^| )drop( |$)/;
const READY = /(^| )drop-ready( |$)/;

Object.entries(VIEWPORTS).forEach(([name, vp]) => {
  test.describe(name, () => {
    test('drag a card to the discard pile: the targets light, a near miss counts, the release discards', async ({
      page,
    }, testInfo) => {
      test.skip(testInfo.project.name !== 'pages', 'runs once: the same bytes on both origins');
      const watched = watchPage(page, ALLOWED_FAILURES);
      await ginStartLocal(page, pagePath('pages', 'gin-rummy'), vp);
      await ginTakeUpcard(page);
      // Accepted into the hand: no drag begins while the drawn card waits in the ghost cell.
      await ginAcceptDraw(page);
      const pile = page.locator('#discardPile');
      const button = page.locator('#actions [data-act="discard"]');
      // A loose card that is not the one just taken (that one is locked).
      const card = page.locator('#hand .slot.dead .card:not(.locked)').first();
      const id = await card.getAttribute('data-card');
      const from = await card.boundingBox();
      const to = await pile.boundingBox();
      const btn = await button.boundingBox();
      if (id === null || from === null || to === null || btn === null) throw new Error('no boxes');
      await expect(pile).not.toHaveClass(READY);

      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 12, {
        steps: 2,
      });
      // In the air: both targets say they take the card; neither is under the pointer yet.
      await expect(pile).toHaveClass(READY);
      await expect(button).toHaveClass(READY);
      await expect(pile).not.toHaveClass(DROP);

      // Beside the pile, outside its box but inside the box grown by half: a near miss still counts.
      await page.mouse.move(to.x + to.width + to.width * 0.2, to.y + to.height / 2, { steps: 4 });
      await expect(pile).toHaveClass(DROP);
      // Far away again: dark.
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2, { steps: 4 });
      await expect(pile).not.toHaveClass(DROP);
      // Over the Discard button: the button and the pile are one target, so both turn green.
      await page.mouse.move(btn.x + btn.width / 2, btn.y + btn.height / 2, { steps: 4 });
      await expect(button).toHaveClass(DROP);
      await expect(pile).toHaveClass(DROP);

      // Released on the pile: the card is discarded and the phone passes to the other seat.
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 4 });
      await expect(pile).toHaveClass(DROP);
      await page.mouse.up();
      await expect(page.locator('#curtainOverlay')).toBeVisible();
      await expect(page.locator(`#discardPile .card[data-card="${id}"]`)).toHaveCount(1);
      await expect(page.locator('#hand .card')).toHaveCount(10);
      await expect(pile).not.toHaveClass(READY);
      expect(watched.errors(), 'uncaught exceptions').toEqual([]);
    });
  });
});
