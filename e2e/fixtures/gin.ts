// Drives the legacy Gin Rummy page through its DOM (ids from games/gin-rummy/index.html). Nothing
// here reads `window.__gin`: whose turn it is, what may be tapped and what was discarded are all
// read from the same elements a player sees.
import { expect, type Page } from '@playwright/test';

import { BROKER_TIMEOUT, WEBRTC_TIMEOUT } from './timeouts.ts';

export const ginRoomCode = async (page: Page): Promise<string> => {
  const code = page.locator('#roomCode');
  await expect(code).toHaveText(/^[A-Z]{4}$/);
  return code.innerText();
};

/** Host a room; resolves with the code once the room is registered on the broker. */
export const ginHostRoom = async (page: Page, name: string): Promise<string> => {
  await expect(page.locator('#onlineModeContent')).toBeVisible();
  await page.locator('#nameInput').fill(name);
  await page.locator('#hostBtn').click();
  await expect(page.locator('#hostWaitScreen')).toBeVisible();
  const code = await ginRoomCode(page);
  await expect(page.locator('#hostWaitStatus')).toContainText('Waiting for your opponent to join', {
    timeout: BROKER_TIMEOUT,
  });
  return code;
};

/** Join a room by code; resolves once the data channel is open and the host has answered. */
export const ginJoin = async (page: Page, name: string, code: string): Promise<void> => {
  await expect(page.locator('#onlineModeContent')).toBeVisible();
  await page.locator('#nameInput').fill(name);
  // The code field rejects multi-character inserts (it defeats keyboard autocorrect), so type it.
  await page.locator('#codeInput').pressSequentially(code);
  await expect(page.locator('#codeInput')).toHaveValue(code);
  await page.locator('#joinBtn').click();
  await expect(page.locator('#guestWaitScreen')).toBeVisible();
  await expect(page.locator('#guestWaitStatus')).toContainText('Waiting for the host to start', {
    timeout: WEBRTC_TIMEOUT,
  });
};

/** The host deals; both tables appear. */
export const ginHostDeals = async (host: Page, guest: Page): Promise<void> => {
  await expect(host.locator('#startGameBtn')).toBeVisible({ timeout: WEBRTC_TIMEOUT });
  await host.locator('#startGameBtn').click();
  await expect(host.locator('#tableScreen')).toBeVisible();
  await expect(guest.locator('#tableScreen')).toBeVisible();
};

export type TableView = Readonly<{
  discardTop: string | null;
  handSize: number;
  oppCount: string;
  stockLabel: string;
  hand: string;
}>;

/** What the table shows: piles, hand sizes and hand number, as a player reads them. */
export const readTable = async (page: Page): Promise<TableView> => ({
  discardTop: await page.locator('#discardPile .card').getAttribute('data-card'),
  handSize: await page.locator('#hand .card').count(),
  oppCount: await page.locator('#oppCards .opp-count').innerText(),
  stockLabel: await page.locator('#stockPile .pile-label').innerText(),
  hand: await page.locator('#roundBadge').innerText(),
});

export const isMyTurn = async (page: Page): Promise<boolean> =>
  (await page.locator('#statusMain').innerText()) === 'Your turn';

export const ginPassUpcard = async (page: Page): Promise<void> => {
  const pass = page.locator('#actions [data-act="passUpcard"]');
  await expect(pass).toBeVisible();
  await pass.click();
};

/** Select the first card that may be discarded and discard it; returns the card id. */
const discardFirstFree = async (page: Page): Promise<string> => {
  await expect(page.locator('#hand')).toHaveClass(/active/);
  await expect(page.locator('#hand .card')).toHaveCount(11);
  const id = await page.locator('#hand .card:not(.locked)').first().getAttribute('data-card');
  if (id === null) throw new Error('the hand shows a card without data-card');
  const card = page.locator(`#hand .card[data-card="${id}"]`);
  await card.click();
  await expect(card).toHaveClass(/selected/);
  const discard = page.locator('#actions [data-act="discard"]');
  await expect(discard).toBeEnabled();
  await discard.click();
  await expect(page.locator('#hand .card')).toHaveCount(10);
  return id;
};

/** One legal turn from the draw phase: draw from the stock, then discard. Returns the discarded id. */
export const ginDrawAndDiscard = async (page: Page): Promise<string> => {
  const stock = page.locator('#stockPile');
  await expect(stock).toHaveClass(/tappable/);
  await stock.click();
  return discardFirstFree(page);
};

/** One legal first turn: take the upcard (it stays locked), then discard another card. */
export const ginTakeUpcardAndDiscard = async (page: Page): Promise<string> => {
  const take = page.locator('#actions [data-act="takeUpcard"]');
  await expect(take).toBeVisible();
  await take.click();
  return discardFirstFree(page);
};
