// Drives the legacy Fidice page through its DOM (ids from the vdom screens in legacy/fidice/index.html).
import { expect, type Locator, type Page } from '@playwright/test';

import { BROKER_TIMEOUT, WEBRTC_TIMEOUT } from './timeouts.ts';

export const fidiceLobbyCode = async (page: Page): Promise<string> => {
  const code = page.locator('#lobbyCode');
  // The lobby (and its code) renders when the host's Peer opens on the broker.
  await expect(code).toHaveText(/^[A-Z0-9]{5}$/, { timeout: BROKER_TIMEOUT });
  return code.innerText();
};

/** Host a table; resolves with the lobby code once the host is registered on the broker, its one seat shown. */
export const fidiceHostLobby = async (page: Page, name: string): Promise<string> => {
  await page.locator('#btnCreate').click();
  await expect(page.locator('#screen-name')).toBeVisible();
  await page.locator('#nameInput').fill(name);
  await page.locator('#btnNameGo').click();
  const code = await fidiceLobbyCode(page);
  await expect(page.locator('#startHint')).toContainText('Share the player link');
  await expect(fidiceSeats(page)).toHaveCount(1);
  return code;
};

/** Join a table by code; resolves once the guest sees the lobby with both seats. */
export const fidiceJoin = async (page: Page, name: string, code: string): Promise<void> => {
  await page.locator('#btnJoin').click();
  await expect(page.locator('#screen-name')).toBeVisible();
  await page.locator('#nameInput').fill(name);
  await page.locator('#joinCode').fill(code);
  await page.locator('#btnNameGo').click();
  await expect(page.locator('#screen-lobby')).toBeVisible({ timeout: WEBRTC_TIMEOUT });
  await expect(fidiceSeats(page)).toHaveCount(2, { timeout: WEBRTC_TIMEOUT });
};

export const fidiceSeats = (page: Page): Locator => page.locator('#screen-lobby [data-seat]');

export const fidiceSeatName = (page: Page, seat: number): Locator =>
  page.locator(`[data-seat="${String(seat)}"] .nm`);

/** The "Round N" label on the game screen. */
export const fidiceRound = (page: Page): Locator =>
  page.locator('#screen-game').getByText(/^Round \d+$/);

// ---- online: the table (the fidice row of e2e/fixtures/online-games.ts) -------------------------

/** The host starts from the lobby; both game screens come up. */
export const fidiceHostStarts = async (host: Page, guest: Page): Promise<void> => {
  const start = host.locator('#btnStart');
  await expect(start).toBeEnabled();
  await start.click();
  await expect(host.locator('#screen-game')).toBeVisible();
  await expect(guest.locator('#screen-game')).toBeVisible();
};

/** Both game screens show the same round, with the cup at the same seat. */
export const fidiceSameRound = async (host: Page, guest: Page): Promise<void> => {
  await expect(fidiceRound(host)).toHaveText('Round 1');
  await expect(fidiceRound(guest)).toHaveText('Round 1');
  const holder = host.locator('#screen-game .seat.holder');
  await expect(holder).toHaveCount(1);
  const holderSeat = await holder.getAttribute('data-seat');
  await expect(guest.locator('#screen-game .seat.holder')).toHaveAttribute(
    'data-seat',
    holderSeat ?? '',
  );
};
