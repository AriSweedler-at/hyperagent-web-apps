// Drives the Gin Rummy page through its DOM (the legacy ids, kept by web/games/gin-rummy/index.html). Nothing
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
  // The page re-rolls the code (and rewrites #roomCode) when the broker reports the id taken, so
  // the code is read only after the broker has confirmed the room.
  await expect(page.locator('#hostWaitStatus')).toContainText('Waiting for your opponent to join', {
    timeout: BROKER_TIMEOUT,
  });
  return ginRoomCode(page);
};

/**
 * The guest's status once the host has answered its join. The guest itself writes
 * 'Connected. Waiting for the host to start…' when the channel opens, before its join message is
 * sent; only the host's reply carries a name and a target.
 */
export const GIN_HOST_ANSWERED =
  /^Connected to .+'s room \(playing to \d+\)\. Waiting for the host to start/;

/** Join a room by code; resolves once the data channel is open and the host has answered the join. */
export const ginJoin = async (page: Page, name: string, code: string): Promise<void> => {
  await expect(page.locator('#onlineModeContent')).toBeVisible();
  await page.locator('#nameInput').fill(name);
  // The code field rejects multi-character inserts (it defeats keyboard autocorrect), so type it.
  await page.locator('#codeInput').pressSequentially(code);
  await expect(page.locator('#codeInput')).toHaveValue(code);
  await page.locator('#joinBtn').click();
  await expect(page.locator('#guestWaitScreen')).toBeVisible();
  await expect(page.locator('#guestWaitStatus')).toHaveText(GIN_HOST_ANSWERED, {
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
  // textContent, not innerText: .pile-label is uppercased by CSS and innerText returns the
  // rendered case on Linux Chromium ("STOCK · 31"), while the page writes "Stock · 31".
  stockLabel: ((await page.locator('#stockPile .pile-label').textContent()) ?? '').trim(),
  hand: await page.locator('#roundBadge').innerText(),
});

export const isMyTurn = async (page: Page): Promise<boolean> =>
  (await page.locator('#statusMain').innerText()) === 'Your turn';

/** Hand the phone over: the pass-and-play curtain is up, the seat behind it taps to reveal. */
export const ginReveal = async (page: Page): Promise<void> => {
  await expect(page.locator('#curtainOverlay')).toBeVisible();
  await page.locator('#curtainBtn').click();
  await expect(page.locator('#curtainOverlay')).toBeHidden();
};

/**
 * Start pass-and-play (Ann and Bob unless `names` says otherwise; the inputs take 20 characters) at
 * `viewport` on the page at `url` and reveal the first seat: the upcard decision. The player fixture
 * opens its own context, so a describe's `viewport` is applied to its page here.
 */
export const ginStartLocal = async (
  page: Page,
  url: string,
  viewport: Readonly<{ width: number; height: number }>,
  names: Readonly<[string, string]> = ['Ann', 'Bob'],
): Promise<void> => {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(url);
  await page.locator('#playModeSwitch .mode-btn[data-mode="local"]').click();
  await page.locator('#p1NameInput').fill(names[0]);
  await page.locator('#p2NameInput').fill(names[1]);
  await page.locator('#localBtn').click();
  await ginReveal(page);
  await expect(page.locator('#statusSub')).toHaveText('Take the upcard or pass');
};

export const ginPassUpcard = async (page: Page): Promise<void> => {
  const pass = page.locator('#actions [data-act="passUpcard"]');
  await expect(pass).toBeVisible();
  await pass.click();
};

/**
 * Accept the drawn card from the ghost slot (docs/design/gin-draw-ghost-slot.md: the owner's
 * second tap puts it into the hand): the ghost cell goes and the hand holds eleven cards.
 */
export const ginAcceptDraw = async (page: Page): Promise<void> => {
  const ghost = page.locator('#hand .slot.ghost .card');
  await expect(ghost).toHaveCount(1);
  await ghost.click();
  await expect(page.locator('#hand .slot.ghost')).toHaveCount(0);
  await expect(page.locator('#hand .card')).toHaveCount(11);
};

/** Select the first card that may be discarded and discard it; returns the card id. */
export const ginDiscardFirstFree = async (page: Page): Promise<string> => {
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

/** Take the upcard: it lands in the ghost slot, locked, until it is accepted. */
export const ginTakeUpcard = async (page: Page): Promise<void> => {
  const take = page.locator('#actions [data-act="takeUpcard"]');
  await expect(take).toBeVisible();
  await take.click();
  await expect(page.locator('#hand .slot.ghost.shown .card.locked')).toHaveCount(1);
};

/**
 * One legal turn from the draw phase: draw from the stock, accept the card from the ghost slot
 * (the owner's two-tap flow), then discard. Returns the discarded id.
 */
export const ginDrawAndDiscard = async (page: Page): Promise<string> => {
  const stock = page.locator('#stockPile');
  await expect(stock).toHaveClass(/tappable/);
  await stock.click();
  await expect(page.locator('#hand .slot.ghost.shown .card.fresh')).toHaveCount(1);
  await ginAcceptDraw(page);
  return ginDiscardFirstFree(page);
};

/** One legal first turn: take the upcard (it stays locked), accept it, then discard another card. */
export const ginTakeUpcardAndDiscard = async (page: Page): Promise<string> => {
  await ginTakeUpcard(page);
  await ginAcceptDraw(page);
  return ginDiscardFirstFree(page);
};
