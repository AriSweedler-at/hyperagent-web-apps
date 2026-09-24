// The remote handoff (gin's e2e/gin-handoff.spec.ts for the third game): a pass-and-play game in
// progress goes on as a hosted room, seat 0 keeping this device and seat 1 joining from its own
// through the invite, a link that carries the room code (`?join=`, docs/ARCHITECTURE.md
// "Documented test hooks") and nothing else. The offer is the 🌐 beside the table's menu button
// and, since the phone changes hands under the curtain here, the curtain's "Continue online" too;
// both are pass-and-play's alone. `#shareCodeBtn` hands the invite to the share sheet where there
// is one (a phone's OS menu) and to the clipboard otherwise (desktop); an invite link fills the
// join form and leaves the address bar; the offer survives a reload of the waiting room; and
// cancelling the room before anyone joined gives the game back to pass-and-play, the position as
// it stood. The two-device game is @online (WebRTC between two contexts).
import type { Page } from '@playwright/test';

import {
  bgBoardsAgree,
  bgReveal,
  bgRoomCode,
  bgStartLocal,
  boardKey,
  readBoard,
} from './fixtures/backgammon.ts';
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
  return `${pagePath(project, 'backgammon')}${query === '' ? '' : `?${query}`}`;
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
  return bgRoomCode(page);
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
 * Start Ann and Bob's pass-and-play game, lift the opening winner's curtain (its one tap rolls
 * too) and take the table's offer. Returns the confirmed code and the board as it stood.
 */
const handOff = async (
  page: Page,
  url: string,
): Promise<Readonly<{ code: string; before: string }>> => {
  await bgStartLocal(page, url, PHONE);
  await bgReveal(page);
  const before = boardKey(await readBoard(page));
  return { code: await takeOffer(page), before };
};

/**
 * Cancel the room and resume pass-and-play: the board as it stands, read beneath the curtain that
 * names the mover again (its button would roll for a seat still to roll, so it is left up).
 */
const cancelAndResume = async (page: Page): Promise<string> => {
  await page.locator('#cancelHostBtn').click();
  await expect(page.locator('#homeScreen')).toBeVisible();
  await expect(page.locator('#resumeBtn')).toHaveText('Resume pass & play: Ann vs Bob');
  await page.locator('#resumeBtn').click();
  await expect(page.locator('#tableScreen')).toBeVisible();
  await expect(page.locator('#curtainOverlay')).toBeVisible();
  await expect(page.locator('#handoffBtn')).toBeVisible();
  return boardKey(await readBoard(page));
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
    .toEqual({ title: 'Sheshbesh', url: inviteLinkOf(page, code) });

  // A reload while the room waits: the offer comes back as the handoff, under the same code the
  // invite carries, not as a room to host.
  await page.reload();
  await expect(page.locator('#resumeBtn')).toHaveText(OFFER);
  await page.locator('#resumeBtn').click();
  expect(await roomOpen(page)).toBe(code);

  // Nobody joined: cancelling the room gives the game back to pass-and-play, as it stood.
  expect(await cancelAndResume(page)).toBe(before);
});

test('without a share sheet (desktop) the link is copied', async ({ player, project }) => {
  const { page } = player;
  await page.addInitScript({ content: DESKTOP });
  const { code } = await handOff(page, gameUrl(project));
  await page.locator('#shareCodeBtn').click();
  await expect(page.locator('#toast')).toHaveText('Invite copied to clipboard');
  expect(await page.evaluate('window.__copied')).toBe(inviteLinkOf(page, code));
});

test("the curtain's Continue online takes the offer too, with the phone about to change hands; cancel gives it back", async ({
  player,
  project,
}) => {
  const { page } = player;
  await bgStartLocal(page, gameUrl(project), PHONE);
  // The opening winner's curtain: it offers the roll and the handoff.
  await expect(page.locator('#curtainOverlay')).toBeVisible();
  await expect(page.locator('#curtainTitle')).toHaveText(/^Pass the phone to (Ann|Bob)$/);
  const before = boardKey(await readBoard(page));
  await page.locator('#curtainHandoffBtn').click();
  await roomOpen(page);
  await expect(page.locator('#curtainOverlay')).toBeHidden();
  expect(await cancelAndResume(page)).toBe(before);
});

test('an invite link fills the join form: the code, the Play tab, online; nothing stored, and the link leaves the address bar', async ({
  player,
  project,
}) => {
  const { page } = player;
  await page.goto(gameUrl(project));
  await page.evaluate(
    "localStorage.setItem('backgammon_homeTab', 'rules'); localStorage.setItem('backgammon_playMode', 'local');",
  );
  await page.goto(gameUrl(project, { join: 'kqzm' }));
  await expect(page.locator('#playPanel')).toBeVisible();
  await expect(page.locator('#onlineModeContent')).toBeVisible();
  await expect(page.locator('#codeInput')).toHaveValue('KQZM');
  expect(await page.evaluate("localStorage.getItem('backgammon_playMode')")).toBe('local');
  expect(await page.evaluate("localStorage.getItem('backgammon_homeTab')")).toBe('rules');
  expect(await page.evaluate("localStorage.getItem('backgammon_name')")).toBeNull();
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
  'the guest follows the invite link and carries on the same game from its own device',
  { tag: '@online' },
  async ({ players, project }) => {
    const { host, guest } = players;
    const { code, before } = await handOff(host.page, gameUrl(project));
    // Pass-and-play opened no Peer; the handoff opened the room's.
    expect((await host.peerCalls()).map((c) => c.id)).toEqual([`sheshbesh-${code}`]);

    // The link puts the code in the form; Bob types his name and joins as himself.
    await guest.page.goto(gameUrl(project, { join: code }));
    await expect(guest.page.locator('#codeInput')).toHaveValue(code);
    await guest.page.locator('#nameInput').fill('Bob');
    await guest.page.locator('#joinBtn').click();
    await expect(guest.page.locator('#guestWaitScreen')).toBeVisible();

    // The host's join handler keeps the seat, takes the guest's name and broadcasts the position.
    await expect(host.page.locator('#tableScreen')).toBeVisible({ timeout: WEBRTC_TIMEOUT });
    await expect(guest.page.locator('#tableScreen')).toBeVisible({ timeout: WEBRTC_TIMEOUT });
    await expect(host.page.locator('#oppName')).toHaveText('Bob');
    await expect(guest.page.locator('#oppName')).toHaveText('Ann');
    expect(boardKey(await bgBoardsAgree(host.page, guest.page))).toBe(before);
    // Online: no curtain, no offer.
    await expect(host.page.locator('#curtainOverlay')).toBeHidden();
    await expect(guest.page.locator('#curtainOverlay')).toBeHidden();
    await expect(host.page.locator('#handoffBtn')).toBeHidden();
  },
);
