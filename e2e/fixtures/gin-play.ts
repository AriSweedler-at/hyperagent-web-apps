// Turns of a pass-and-play gin game driven to a round's end, choosing through the documented
// `window.__gin` hook (docs/ARCHITECTURE.md "Documented test hooks"): the least-deadwood discard,
// a knock as soon as one is legal, so a round ends in a few turns (or a void hand when the stock
// runs out). What is clicked is what a player sees (the piles, the cards, the buttons); only the
// choice is read from the hook. e2e/gin-geometry.spec.ts and e2e/gin-local.spec.ts share it.
import { expect, type Page } from '@playwright/test';

import { ginAcceptDraw, ginReveal } from './gin.ts';

export type HookView = Readonly<{
  phase: string;
  discardOptions: Readonly<
    Record<string, Readonly<{ locked?: boolean; deadwood?: number; canKnock?: boolean }>>
  > | null;
  result: Readonly<{
    void: boolean;
    opponent?: Readonly<{ laidOff: ReadonlyArray<unknown> }>;
  }> | null;
}>;

/** The view the page holds, as `window.__gin.app.view` exposes it. */
export const readView = (page: Page): Promise<HookView | null> =>
  page.evaluate<HookView | null>('window.__gin.app.view');

/** The discard that leaves the least deadwood, or the one that lets the player knock. */
export const chooseDiscard = async (
  page: Page,
): Promise<Readonly<{ id: string; knock: boolean }>> => {
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
export const finishTurn = async (page: Page, knock: boolean): Promise<'over' | 'next'> => {
  await page.locator(`#actions [data-act="${knock ? 'knock' : 'discard'}"]`).click();
  const after = await readView(page);
  if (after?.phase === 'roundOver') {
    await expect(page.locator('#roundResultOverlay')).toBeVisible();
    return 'over';
  }
  await expect(page.locator('#curtainOverlay')).toBeVisible();
  return 'next';
};

export const selectCard = async (page: Page, id: string): Promise<void> => {
  const card = page.locator(`#hand .card[data-card="${id}"]`);
  await card.click();
  await expect(card).toHaveClass(/selected/);
};

/**
 * Turns until the round is over: a knock or, when the stock runs out, a void hand. Each turn starts
 * under the curtain when the phone changed hands (not after a redeal to the seat already revealed);
 * an upcard decision is passed, a draw comes from the stock and is accepted.
 */
export const playToRoundOver = async (page: Page, turn = 1): Promise<void> => {
  if (turn > 40) throw new Error('no round end within 40 turns');
  if (await page.locator('#curtainOverlay').isVisible()) await ginReveal(page);
  const before = await readView(page);
  if (before?.phase === 'upcard') {
    await page.locator('#actions [data-act="passUpcard"]').click();
    return playToRoundOver(page, turn + 1);
  }
  if (before?.phase === 'draw') {
    await page.locator('#stockPile').click();
    await ginAcceptDraw(page);
  }
  const pick = await chooseDiscard(page);
  await selectCard(page, pick.id);
  if ((await finishTurn(page, pick.knock)) === 'over') return;
  return playToRoundOver(page, turn + 1);
};
