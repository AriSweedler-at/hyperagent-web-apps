// Drives the legacy Fidice page through its DOM (ids from the vdom screens in games/fidice/index.html).
import { expect, type Locator, type Page } from '@playwright/test';

import { BROKER_TIMEOUT, WEBRTC_TIMEOUT } from './timeouts.ts';

export const fidiceLobbyCode = async (page: Page): Promise<string> => {
  const code = page.locator('#lobbyCode');
  // The lobby (and its code) renders when the host's Peer opens on the broker.
  await expect(code).toHaveText(/^[A-Z0-9]{5}$/, { timeout: BROKER_TIMEOUT });
  return code.innerText();
};

/** Host a table; resolves with the lobby code once the host is registered on the broker. */
export const fidiceHostLobby = async (page: Page, name: string): Promise<string> => {
  await page.locator('#btnCreate').click();
  await expect(page.locator('#screen-name')).toBeVisible();
  await page.locator('#nameInput').fill(name);
  await page.locator('#btnNameGo').click();
  const code = await fidiceLobbyCode(page);
  await expect(page.locator('#startHint')).toContainText('Share the player link');
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
