// The remote handoff: a pass-and-play game in progress goes on as a hosted room, seat 0 keeping
// this device and seat 1 joining from its own through the invite, a link that carries the room
// code (`?join=`, docs/ARCHITECTURE.md "Documented test hooks"). `#shareCodeBtn` hands the invite
// to the share sheet where there is one (a phone's OS menu) and to the clipboard otherwise
// (desktop); an invite link fills the join form; cancelling the room before anyone joined gives
// the game back to pass-and-play. The two-device game is @online (WebRTC between two contexts).
import type { Page } from '@playwright/test';

import {
  ginReveal,
  ginRoomCode,
  ginStartLocal,
  readTable,
  type TableView,
} from './fixtures/gin.ts';
import { gameQuery } from './fixtures/player.ts';
import { pagePath, type Project } from './fixtures/site.ts';
import { BROKER_TIMEOUT, WEBRTC_TIMEOUT } from './fixtures/timeouts.ts';
import { expect, test } from './fixtures/two-players.ts';

const PHONE = { width: 390, height: 844 } as const;

/** A phone's share sheet: the payload is recorded instead of shown. */
const SHARE_SHEET = `Object.defineProperty(navigator, 'share', {
  configurable: true,
  value: (payload) => { window.__shared = payload; return Promise.resolve(); },
});`;
/** A desktop browser: no share sheet; the clipboard records what was written. */
const DESKTOP = `Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: { writeText: (text) => { window.__copied = text; return Promise.resolve(); } },
});`;

/** The page's path with the harness hooks (`?peer=`, `?ice=`) and `extra` query parameters. */
const gameUrl = (project: Project, extra: Readonly<Record<string, string>> = {}): string => {
  const params = new URLSearchParams(gameQuery());
  Object.entries(extra).forEach(([key, value]) => {
    params.set(key, value);
  });
  const query = params.toString();
  return `${pagePath(project, 'gin-rummy')}${query === '' ? '' : `?${query}`}`;
};

/** The page's URL without its query: what the invite link is built from. */
const pageUrlOf = (page: Page): string => page.url().split('?')[0] ?? page.url();

/**
 * Start Ann and Bob's pass-and-play game, reload, and take the offer: the room is open under a
 * code before the broker has answered. Returns the code and the table as the first mover saw it.
 */
const handOff = async (
  page: Page,
  url: string,
): Promise<Readonly<{ code: string; before: TableView }>> => {
  await ginStartLocal(page, url, PHONE);
  const before = await readTable(page);
  await page.reload();
  await expect(page.locator('#resumeBtn')).toHaveText('Resume pass & play: Ann vs Bob');
  const handoffBtn = page.locator('#handoffBtn');
  await expect(handoffBtn).toHaveText('Continue online: Ann hosts, Bob joins by invite');
  await handoffBtn.click();
  await expect(page.locator('#hostWaitScreen')).toBeVisible();
  return { code: await ginRoomCode(page), before };
};

test('a pass-and-play game is offered online; the share sheet gets the invite with its link; cancel gives the game back', async ({
  player,
  project,
}) => {
  const { page } = player;
  await page.addInitScript({ content: SHARE_SHEET });
  const { code, before } = await handOff(page, gameUrl(project));
  await page.locator('#shareCodeBtn').click();
  await expect
    .poll(() => page.evaluate('window.__shared'))
    .toEqual({
      title: 'Gin Rummy',
      text: `Join my Gin Rummy game — room code ${code}.`,
      url: `${pageUrlOf(page)}?join=${code}`,
    });

  // Nobody joined: cancelling the room gives the hand back to pass-and-play, as it stood.
  await page.locator('#cancelHostBtn').click();
  await expect(page.locator('#homeScreen')).toBeVisible();
  await expect(page.locator('#resumeBtn')).toHaveText('Resume pass & play: Ann vs Bob');
  await expect(page.locator('#handoffBtn')).toBeVisible();
  await page.locator('#resumeBtn').click();
  await ginReveal(page);
  expect(await readTable(page)).toEqual(before);
});

test('without a share sheet (desktop) the invite is copied: the text, then the link', async ({
  player,
  project,
}) => {
  const { page } = player;
  await page.addInitScript({ content: DESKTOP });
  const { code } = await handOff(page, gameUrl(project));
  await page.locator('#shareCodeBtn').click();
  await expect(page.locator('#toast')).toHaveText('Invite copied to clipboard');
  expect(await page.evaluate('window.__copied')).toBe(
    `Join my Gin Rummy game — room code ${code}. ${pageUrlOf(page)}?join=${code}`,
  );
});

test('an invite link fills the join form: the code, the Play tab, online; nothing is stored', async ({
  player,
  project,
}) => {
  const { page } = player;
  await page.goto(gameUrl(project));
  await page.evaluate(
    "localStorage.setItem('ginRummy_homeTab', 'rules'); localStorage.setItem('ginRummy_playMode', 'local');",
  );
  await page.goto(gameUrl(project, { join: 'kqzm' }));
  await expect(page.locator('#playPanel')).toBeVisible();
  await expect(page.locator('#onlineModeContent')).toBeVisible();
  await expect(page.locator('#codeInput')).toHaveValue('KQZM');
  expect(await page.evaluate("localStorage.getItem('ginRummy_playMode')")).toBe('local');
  expect(await page.evaluate("localStorage.getItem('ginRummy_homeTab')")).toBe('rules');
});

test(
  'the guest follows the invite link and carries on the same hand from its own device',
  { tag: '@online' },
  async ({ players, project }) => {
    const { host, guest } = players;
    const { code, before } = await handOff(host.page, gameUrl(project));
    await expect(host.page.locator('#hostWaitStatus')).toContainText(
      `Room ${code} is open — send Bob the invite`,
      { timeout: BROKER_TIMEOUT },
    );

    // The link puts the code in the form; the guest names itself and joins.
    await guest.page.goto(gameUrl(project, { join: code }));
    await expect(guest.page.locator('#codeInput')).toHaveValue(code);
    await guest.page.locator('#nameInput').fill('Bobby');
    await guest.page.locator('#joinBtn').click();
    await expect(guest.page.locator('#guestWaitScreen')).toBeVisible();

    // The host's join handler keeps the seat, takes the guest's name and broadcasts the hand.
    await expect(host.page.locator('#tableScreen')).toBeVisible({ timeout: WEBRTC_TIMEOUT });
    await expect(guest.page.locator('#tableScreen')).toBeVisible({ timeout: WEBRTC_TIMEOUT });
    await expect(host.page.locator('#oppName')).toHaveText('Bobby');
    await expect(guest.page.locator('#oppName')).toHaveText('Ann');
    const piles = {
      discardTop: before.discardTop,
      stockLabel: before.stockLabel,
      hand: before.hand,
    };
    expect(await readTable(host.page)).toMatchObject({ ...piles, handSize: 10 });
    expect(await readTable(guest.page)).toMatchObject({ ...piles, handSize: 10 });
  },
);
