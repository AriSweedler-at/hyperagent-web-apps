// The remote handoff: a pass-and-play game in progress goes on as a hosted room, seat 0 keeping
// this device and seat 1 joining from its own through the invite, a link that carries the room
// code and the invited seat's name (`?join=&name=`, docs/ARCHITECTURE.md "Documented test
// hooks"). The offer sits on the home screen's resume box and on the pass-and-play curtain (the
// moment the phone would change hands). `#shareCodeBtn` hands the invite to the share sheet where
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
const inviteLinkOf = (page: Page, code: string): string =>
  `${pageUrlOf(page)}?join=${code}&name=Bob`;

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

/**
 * Start Ann and Bob's pass-and-play game, reload, and take the home screen's offer. Returns the
 * confirmed code and the table as the first mover saw it.
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
  await expect(handoffBtn).toHaveText(OFFER);
  await handoffBtn.click();
  return { code: await roomOpen(page), before };
};

/** Cancel the room and resume pass-and-play: the hand as it stood. */
const cancelAndResume = async (page: Page): Promise<TableView> => {
  await page.locator('#cancelHostBtn').click();
  await expect(page.locator('#homeScreen')).toBeVisible();
  await expect(page.locator('#resumeBtn')).toHaveText('Resume pass & play: Ann vs Bob');
  await expect(page.locator('#handoffBtn')).toBeVisible();
  await page.locator('#resumeBtn').click();
  await ginReveal(page);
  return readTable(page);
};

test('a pass-and-play game is offered online; the share sheet gets the invite with its link; the offer survives a reload; cancel gives the game back', async ({
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
      url: inviteLinkOf(page, code),
    });

  // A reload while the room waits: the offer comes back as the handoff, under the same code the
  // invite carries, not as a room to host.
  await page.reload();
  await expect(page.locator('#resumeBtn')).toHaveText(OFFER);
  await expect(page.locator('#handoffBtn')).toBeHidden();
  await page.locator('#resumeBtn').click();
  expect(await roomOpen(page)).toBe(code);

  // Nobody joined: cancelling the room gives the hand back to pass-and-play, as it stood.
  expect(await cancelAndResume(page)).toEqual(before);
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
    `Join my Gin Rummy game — room code ${code}. ${inviteLinkOf(page, code)}`,
  );
});

test('the curtain offers the game online from the table: no reload, the curtain marks cleared, cancel gives it back', async ({
  player,
  project,
}) => {
  const { page } = player;
  await ginStartLocal(page, gameUrl(project), PHONE);
  // The first mover passes; the phone is to go to the other seat, and the curtain offers to hand
  // the game off instead.
  await ginPassUpcard(page);
  await expect(page.locator('#curtainOverlay')).toBeVisible();
  await expect(page.locator('#curtainTitle')).toHaveText(/^Pass the phone to (Ann|Bob)$/);
  const before = await readTable(page);
  const offer = page.locator('#curtainHandoffBtn');
  await expect(offer).toHaveText(OFFER);
  await offer.click();
  await roomOpen(page);
  await expect(page.locator('#curtainOverlay')).toBeHidden();
  expect(await cancelAndResume(page)).toEqual(before);
});

test('an invite link fills the join form: the code, the invited name, the Play tab, online; nothing stored, and the link leaves the address bar', async ({
  player,
  project,
}) => {
  const { page } = player;
  await page.goto(gameUrl(project));
  await page.evaluate(
    "localStorage.setItem('ginRummy_homeTab', 'rules'); localStorage.setItem('ginRummy_playMode', 'local');",
  );
  await page.goto(gameUrl(project, { join: 'kqzm', name: 'Bob' }));
  await expect(page.locator('#playPanel')).toBeVisible();
  await expect(page.locator('#onlineModeContent')).toBeVisible();
  await expect(page.locator('#codeInput')).toHaveValue('KQZM');
  await expect(page.locator('#nameInput')).toHaveValue('Bob');
  expect(await page.evaluate("localStorage.getItem('ginRummy_playMode')")).toBe('local');
  expect(await page.evaluate("localStorage.getItem('ginRummy_homeTab')")).toBe('rules');
  expect(await page.evaluate("localStorage.getItem('ginRummy_name')")).toBeNull();
  // The link is spent: the harness hooks stay, the invite's parameters do not, so a reload is the
  // ordinary home screen (the stored Rules tab and pass-and-play mode).
  const url = new URL(page.url());
  expect(url.searchParams.has('join')).toBe(false);
  expect(url.searchParams.has('name')).toBe(false);
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

    // The link puts the code and Bob's name in the form; Bob joins as himself.
    await guest.page.goto(gameUrl(project, { join: code, name: 'Bob' }));
    await expect(guest.page.locator('#codeInput')).toHaveValue(code);
    await expect(guest.page.locator('#nameInput')).toHaveValue('Bob');
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
