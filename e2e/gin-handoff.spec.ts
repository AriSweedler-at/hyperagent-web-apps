// The remote handoff: a pass-and-play game in progress goes on as a hosted room, seat 0 keeping
// this device and seat 1 joining from its own through the invite, a link that carries the room
// code (`?join=`, docs/ARCHITECTURE.md "Documented test hooks") and nothing else. The offer is
// the 🌐 button beside the table's leave button, shown for pass-and-play alone, its tooltip naming
// who hosts and who joins. `#shareCodeBtn` hands the invite to the share sheet where
// there is one (a phone's OS menu) and to the clipboard otherwise (desktop); an invite link fills
// the join form and leaves the address bar; the offer survives a reload of the waiting room; and
// cancelling the room before anyone joined gives the game back to pass-and-play. The two-device
// game is @online (WebRTC between two contexts).
import type { Page } from '@playwright/test';

import {
  ginPassUpcard,
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
const OFFER = 'Continue online: Ann hosts, Bob joins by invite';
/** The broker has confirmed the handed-off room: only then is `#roomCode` final. */
const ROOM_OPEN = /^Room [A-Z]{4} is open — send Bob the invite to carry on this game…/;

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

/** The page's origin and path: what the invite link is built from, whatever the query or hash. */
const pageUrlOf = (page: Page): string => {
  const url = new URL(page.url());
  return `${url.origin}${url.pathname}`;
};

/** The invite link for `code`, as the host page builds it. */
const inviteLinkOf = (page: Page, code: string): string => `${pageUrlOf(page)}?join=${code}`;

/**
 * The room is open under its final code: the page re-rolls the code (and rewrites `#roomCode`)
 * when the broker reports the id taken, so it is read only after the broker has confirmed it.
 */
const roomOpen = async (page: Page): Promise<string> => {
  await expect(page.locator('#hostWaitScreen')).toBeVisible();
  await expect(page.locator('#hostWaitStatus')).toContainText(ROOM_OPEN, {
    timeout: BROKER_TIMEOUT,
  });
  return ginRoomCode(page);
};

/** The table's 🌐: shown for pass-and-play, its tooltip the offer; a click opens the room. */
const takeOffer = async (page: Page): Promise<string> => {
  const handoffBtn = page.locator('#handoffBtn');
  await expect(handoffBtn).toBeVisible();
  await expect(handoffBtn).toHaveAttribute('title', OFFER);
  await handoffBtn.click();
  return roomOpen(page);
};

/**
 * Start Ann and Bob's pass-and-play game and take the table's offer. Returns the confirmed code
 * and the table as the first mover saw it.
 */
const handOff = async (
  page: Page,
  url: string,
): Promise<Readonly<{ code: string; before: TableView }>> => {
  await ginStartLocal(page, url, PHONE);
  const before = await readTable(page);
  return { code: await takeOffer(page), before };
};

/** Cancel the room and resume pass-and-play: the hand as it stood. */
const cancelAndResume = async (page: Page): Promise<TableView> => {
  await page.locator('#cancelHostBtn').click();
  await expect(page.locator('#homeScreen')).toBeVisible();
  await expect(page.locator('#resumeBtn')).toHaveText('Resume pass & play: Ann vs Bob');
  await page.locator('#resumeBtn').click();
  await ginReveal(page);
  await expect(page.locator('#handoffBtn')).toBeVisible();
  return readTable(page);
};

test('a pass-and-play game is offered online; the share sheet gets the link alone; the offer survives a reload; cancel gives the game back', async ({
  player,
  project,
}) => {
  const { page } = player;
  await page.addInitScript({ content: SHARE_SHEET });
  const { code, before } = await handOff(page, gameUrl(project));
  await page.locator('#shareCodeBtn').click();
  await expect
    .poll(() => page.evaluate('window.__shared'))
    .toEqual({ title: 'Gin Rummy', url: inviteLinkOf(page, code) });

  // A reload while the room waits: the offer comes back as the handoff, under the same code the
  // invite carries, not as a room to host.
  await page.reload();
  await expect(page.locator('#resumeBtn')).toHaveText(OFFER);
  await page.locator('#resumeBtn').click();
  expect(await roomOpen(page)).toBe(code);

  // Nobody joined: cancelling the room gives the hand back to pass-and-play, as it stood.
  expect(await cancelAndResume(page)).toEqual(before);
});

test('without a share sheet (desktop) the link is copied', async ({ player, project }) => {
  const { page } = player;
  await page.addInitScript({ content: DESKTOP });
  const { code } = await handOff(page, gameUrl(project));
  await page.locator('#shareCodeBtn').click();
  await expect(page.locator('#toast')).toHaveText('Invite copied to clipboard');
  expect(await page.evaluate('window.__copied')).toBe(inviteLinkOf(page, code));
});

test("the offer is the table's alone: the curtain carries none; after a pass the next seat reveals and takes it, the curtain marks cleared, cancel gives it back", async ({
  player,
  project,
}) => {
  const { page } = player;
  await ginStartLocal(page, gameUrl(project), PHONE);
  // The first mover passes; the phone goes to the other seat under the curtain, which offers
  // nothing but the reveal.
  await ginPassUpcard(page);
  await expect(page.locator('#curtainOverlay')).toBeVisible();
  await expect(page.locator('#curtainTitle')).toHaveText(/^Pass the phone to (Ann|Bob)$/);
  await expect(page.locator('#curtainOverlay .btn')).toHaveCount(1);
  await ginReveal(page);
  const before = await readTable(page);
  await takeOffer(page);
  await expect(page.locator('#curtainOverlay')).toBeHidden();
  expect(await cancelAndResume(page)).toEqual(before);
});

test('an invite link fills the join form: the code, the Play tab, online; nothing stored, and the link leaves the address bar', async ({
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
  expect(await page.evaluate("localStorage.getItem('ginRummy_name')")).toBeNull();
  // The link is spent: the harness hooks stay, the invite's parameters do not, so a reload is the
  // ordinary home screen (the stored Rules tab and pass-and-play mode).
  const url = new URL(page.url());
  expect(url.searchParams.has('join')).toBe(false);
  expect(url.search).toBe(gameQuery());
  await page.reload();
  await expect(page.locator('#rulesPanel')).toBeVisible();
  await expect(page.locator('#codeInput')).toHaveValue('');
});

test(
  'the guest follows the invite link and carries on the same hand from its own device',
  { tag: '@online' },
  async ({ players, project }) => {
    const { host, guest } = players;
    const { code, before } = await handOff(host.page, gameUrl(project));

    // The link puts the code in the form; Bob types his name and joins as himself.
    await guest.page.goto(gameUrl(project, { join: code }));
    await expect(guest.page.locator('#codeInput')).toHaveValue(code);
    await guest.page.locator('#nameInput').fill('Bob');
    await guest.page.locator('#joinBtn').click();
    await expect(guest.page.locator('#guestWaitScreen')).toBeVisible();

    // The host's join handler keeps the seat, takes the guest's name and broadcasts the hand.
    await expect(host.page.locator('#tableScreen')).toBeVisible({ timeout: WEBRTC_TIMEOUT });
    await expect(guest.page.locator('#tableScreen')).toBeVisible({ timeout: WEBRTC_TIMEOUT });
    await expect(host.page.locator('#oppName')).toHaveText('Bob');
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
