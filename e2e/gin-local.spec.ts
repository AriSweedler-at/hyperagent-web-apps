// Pass-and-play on one page, gin's half: the curtain covers the hand until the first player takes
// the phone, one full turn (take the upcard, discard), and the curtain comes back for the other
// player naming the move. The shell's half (the switch, the names, the curtain's words, the reveal,
// the names on the table, the save) is e2e/shell-local.spec.ts, for both shell games. Then, through
// the `window.__gin` driver of e2e/fixtures/gin-play.ts, rounds to their end until one is scored: at
// every round over the result sheet shows exactly the cards the engine laid off onto the knocker's
// melds (docs/design/gin-arrangement-and-discards.md §7).
import type { Page } from '@playwright/test';

import { DESKTOP } from './fixtures/geometry.ts';
import { ginAcceptDraw, ginDiscardFirstFree, ginTakeUpcard } from './fixtures/gin.ts';
import { playToRoundOver, readView } from './fixtures/gin-play.ts';
import { DEFAULT_NAMES, curtainTitle, reveal, startLocal } from './fixtures/shell.ts';
import { pagePath } from './fixtures/site.ts';
import { expect, test } from './fixtures/two-players.ts';

/**
 * The result sheet against the engine's result: `.meld-group.laid .card` counts the laid-off
 * cards and the "Laid off onto" label exists exactly when there are any. Returns whether the
 * round was scored (a void hand lays nothing off and proves less).
 */
const expectLaidOffSheet = async (page: Page): Promise<boolean> => {
  const view = await readView(page);
  expect(view?.phase).toBe('roundOver');
  const result = view?.result ?? null;
  expect(result).not.toBeNull();
  const laidOff = result?.void === false ? (result.opponent?.laidOff.length ?? 0) : 0;
  await expect(page.locator('#roundResultOverlay')).toBeVisible();
  await expect(page.locator('#rrBody .meld-group.laid .card')).toHaveCount(laidOff);
  await expect(page.locator('#rrBody .rr-label', { hasText: 'Laid off onto' })).toHaveCount(
    laidOff > 0 ? 1 : 0,
  );
  return result?.void === false;
};

test('pass and play: the curtain covers the hand; one full turn (take the upcard, discard); the curtain comes back naming the move', async ({
  player,
  project,
}) => {
  const { page } = player;
  await startLocal(page, pagePath(project, 'gin-rummy'), DESKTOP);

  // The curtain hides the first player's cards until they take the phone, and it must cover them:
  // the topmost element at every hand card's centre is the curtain (or something inside it), so a
  // CSS regression to .overlay's inset or z-index fails here.
  const curtain = page.locator('#curtainOverlay');
  const title = page.locator('#curtainTitle');
  await expect(page.locator('#hand .card')).toHaveCount(10);
  const exposed = await page.evaluate<number>(
    `Array.from(document.querySelectorAll('#hand .card')).filter((card) => {
      const r = card.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return hit !== null && !document.getElementById('curtainOverlay').contains(hit);
    }).length`,
  );
  expect(exposed, 'hand cards not covered by the curtain').toBe(0);
  await expect(title).toHaveText(curtainTitle(DEFAULT_NAMES));
  const first = (await title.innerText()).replace('Pass the phone to ', '');
  const other = first === DEFAULT_NAMES[0] ? DEFAULT_NAMES[1] : DEFAULT_NAMES[0];
  await reveal(page);
  await expect(page.locator('#hand .card')).toHaveCount(10);
  await expect(page.locator('#statusBanner')).toHaveClass(/mine/);
  await expect(page.locator('#statusSub')).toHaveText('Take the upcard or pass');

  // One full turn: take the upcard (it stays locked), accept it, then discard another card.
  const upcard = await page.locator('#discardPile .card').getAttribute('data-card');
  const HELD_ORDER = `Array.from(document.querySelectorAll('#hand .slot:not(.ghost) .card')).map((c) => c.getAttribute('data-card'))`;
  const order = await page.evaluate<ReadonlyArray<string | null>>(HELD_ORDER);
  expect(order).toHaveLength(10);
  await ginTakeUpcard(page);
  // The ghost slot holds the locked upcard; the ten others kept their data-card order.
  await expect(page.locator('#hand .slot.ghost.shown .card.locked')).toHaveAttribute(
    'data-card',
    upcard ?? '',
  );
  expect(await page.evaluate<ReadonlyArray<string | null>>(HELD_ORDER)).toEqual(order);
  await ginAcceptDraw(page);
  const discarded = await ginDiscardFirstFree(page);
  expect(discarded).not.toBe(upcard);

  // The turn passed: the curtain asks for the other player and names the move, and the table
  // behind it already shows the discard.
  await expect(curtain).toBeVisible();
  await expect(title).toHaveText(`Pass the phone to ${other}`);
  await expect(page.locator('#curtainLast')).toContainText(`${first} discarded the`);
  await expect(page.locator('#discardPile .card')).toHaveAttribute('data-card', discarded);
});

test('pass and play: at every round over the sheet shows the cards laid off, as the engine has them', async ({
  player,
  project,
}) => {
  const { page } = player;
  await page.goto(pagePath(project, 'gin-rummy'));
  await page.locator('#playModeSwitch .mode-btn[data-mode="local"]').click();
  await page.locator('#p1NameInput').fill('Ann');
  await page.locator('#p2NameInput').fill('Bob');
  await page.locator('#localBtn').click();
  // Rounds until one is scored (a void hand's sheet is checked too and continued), three at most.
  const rounds = async (round: number): Promise<void> => {
    await playToRoundOver(page);
    const scored = await expectLaidOffSheet(page);
    if (scored || round === 3) return;
    await page.locator('#rrContinueBtn').click();
    await expect(page.locator('#roundResultOverlay')).toBeHidden();
    await rounds(round + 1);
  };
  await rounds(1);
});
