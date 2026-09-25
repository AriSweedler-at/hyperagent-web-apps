// Drives the shared shell through its DOM (docs/design/shared-shell.md §6.2): the ids the two shell
// games' pages agree on (the home form, the waiting rooms, the curtain, the resume button, the
// table's names and its 🌐), what each page says in its own words read off tools/games.ts SHELL, and
// the code shape off web/shared/lib/roomCode.ts. e2e/shell-*.spec.ts drive both games through these
// once; the game specs import `reveal` and `hostStarts` from here too (dry-round-2.md I5).
// e2e/fixtures/gin.ts and backgammon.ts compose their pass-and-play starters from `startLocal`
// and keep the table halves (what a hand or a board shows), which e2e/fixtures/online-games.ts rows
// up per game for the shell specs. This file may not import either: they import it
// (import-x/no-cycle). Nothing here reads a documented hook: whose room opened and who took the
// phone are read from the elements a player sees.
import { expect, type Page } from '@playwright/test';

import { REGISTRY, SHELL, type ShellGame } from '../../tools/games.ts';
import { ROOM_CODE } from '../../web/shared/lib/roomCode.ts';
import type { Viewport } from './geometry.ts';
import { BROKER_TIMEOUT, WEBRTC_TIMEOUT } from './timeouts.ts';

export type Names = Readonly<[string, string]>;
/** The two seats of a pass-and-play game unless a spec says otherwise (the inputs take 20 characters). */
export const DEFAULT_NAMES: Names = ['Ann', 'Bob'];
/** The two peers of an online game. */
export const ONLINE_NAMES: Names = ['Host', 'Guest'];
/** What `#nameInput` starts at on both pages (each game's shellConfig.ts DEFAULT_NAME). */
export const DEFAULT_NAME = 'Ari';
/**
 * What the game's two pass-and-play inputs show when nothing is remembered, and who is seated
 * when they are left empty: the registry's row (tools/games.ts SHELL `localNames`; the game's
 * shellConfig.ts `localNames`, else web/shared/ui/shell.ts DEFAULT_LOCAL_NAMES).
 */
export const localNames = (game: ShellGame): Names => SHELL[game].localNames;
/** The attribute a prefilled default carries until its first tap (web/shared/ui/home.ts DEFAULT_MARK). */
export const DEFAULT_MARK = 'data-default';

// ---- the shell's copy, byte-identical in both src trees (design §6, risk 10) --------------------

/** `#hostWaitStatus` once the broker has confirmed a fresh room. */
export const WAITING_MSG = 'Waiting for your opponent to join';
/** `#hostWaitStatus` once the guest's join was answered. */
export const joinedMsg = (name: string): string => `${name} joined!`;
/** `#hostWaitStatus` once a resumed room is back on the broker. */
export const reopenedMsg = (code: string): string => `Room ${code} reopened`;
/** `#toast` after `#shareCodeBtn` on a browser with no share sheet. */
export const INVITE_COPIED_MSG = 'Invite copied to clipboard';
/** `#resumeBtn` per save role (ui/state.ts, both games). */
export const resumeLabel = {
  host: (code: string): string => `Resume hosting room ${code}`,
  guest: (code: string): string => `Rejoin room ${code}`,
  local: (names: Names): string => `Resume pass & play: ${names[0]} vs ${names[1]}`,
  /** The handoff's waiting room after a reload, and the table's 🌐 tooltip. */
  handoff: (names: Names): string =>
    `Continue online: ${names[0]} hosts, ${names[1]} joins by invite`,
} as const;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `#curtainTitle`: the seat taking the phone, one of the two. */
export const curtainTitle = (names: Names = DEFAULT_NAMES): RegExp =>
  new RegExp(`^Pass the phone to (${escapeRegExp(names[0])}|${escapeRegExp(names[1])})$`);

// ---- the code -----------------------------------------------------------------------------------

/** A room code's characters as the page shows it: `length` from the game's alphabet. */
const codeSource = (game: ShellGame): string => {
  const { alphabet, length } = ROOM_CODE[game];
  return `[${alphabet}]{${String(length)}}`;
};

/** A whole room code of the game. */
export const codePattern = (game: ShellGame): RegExp => new RegExp(`^${codeSource(game)}$`);

/** `#hostWaitStatus` once the broker has confirmed the handed-off room; only then is `#roomCode` final. */
export const roomOpenMsg = (game: ShellGame, names: Names = DEFAULT_NAMES): RegExp =>
  new RegExp(
    `^Room ${codeSource(game)} is open — send ${escapeRegExp(names[1])} the invite to carry on this game…`,
  );

// ---- storage ------------------------------------------------------------------------------------

/** The game's save key and preference prefix: every shell game has the row (tools/games.test.ts). */
const storageOf = (game: ShellGame): Readonly<{ saveKey: string; prefix: string }> => {
  const storage = REGISTRY[game].storage;
  if (storage === undefined) throw new Error(`${game} has no storage row in tools/games.ts`);
  return storage;
};

/** A shell preference's key: `<prefix><name>` (`homeTab`, `playMode`, `name`, ...). */
export const prefKey = (game: ShellGame, name: string): string =>
  `${storageOf(game).prefix}${name}`;

/** A shell preference as stored, or null. */
export const readPref = (page: Page, game: ShellGame, name: string): Promise<string | null> =>
  page.evaluate<string | null>(`localStorage.getItem(${JSON.stringify(prefKey(game, name))})`);

/** The save of the game in progress, parsed; null when there is none. */
export const readSave = async (page: Page, game: ShellGame): Promise<unknown> =>
  JSON.parse(
    (await page.evaluate<string | null>(
      `localStorage.getItem(${JSON.stringify(storageOf(game).saveKey)})`,
    )) ?? 'null',
  );

// ---- online: the room -----------------------------------------------------------------------------

/** The code `#roomCode` shows. */
export const roomCode = async (page: Page, game: ShellGame): Promise<string> => {
  const code = page.locator('#roomCode');
  await expect(code).toHaveText(codePattern(game));
  return code.innerText();
};

/** Host a room as `name`; resolves with the code once the broker has confirmed the room. */
export const hostRoom = async (page: Page, game: ShellGame, name: string): Promise<string> => {
  await expect(page.locator('#onlineModeContent')).toBeVisible();
  await page.locator('#nameInput').fill(name);
  await page.locator('#hostBtn').click();
  await expect(page.locator('#hostWaitScreen')).toBeVisible();
  // The page re-rolls the code (and rewrites #roomCode) when the broker reports the id taken, so
  // the code is read only after the broker has confirmed the room.
  await expect(page.locator('#hostWaitStatus')).toContainText(WAITING_MSG, {
    timeout: BROKER_TIMEOUT,
  });
  return roomCode(page, game);
};

/** Join a room by code as `name`; resolves once the channel is open and the host has answered the join. */
export const join = async (
  page: Page,
  game: ShellGame,
  name: string,
  code: string,
): Promise<void> => {
  await expect(page.locator('#onlineModeContent')).toBeVisible();
  await page.locator('#nameInput').fill(name);
  // The code field rejects multi-character inserts (it defeats keyboard autocorrect), so type it.
  await page.locator('#codeInput').pressSequentially(code);
  await expect(page.locator('#codeInput')).toHaveValue(code);
  await page.locator('#joinBtn').click();
  await expect(page.locator('#guestWaitScreen')).toBeVisible();
  await expect(page.locator('#guestWaitStatus')).toHaveText(SHELL[game].hostAnswered, {
    timeout: WEBRTC_TIMEOUT,
  });
};

/** Remember `name` under the game's name key, as a player who typed it on an earlier visit would have; the page must be on the game's origin. */
export const rememberName = async (page: Page, game: ShellGame, name: string): Promise<void> => {
  await page.evaluate(
    `localStorage.setItem(${JSON.stringify(prefKey(game, 'name'))}, ${JSON.stringify(name)})`,
  );
};

/**
 * Follow an invite link (`?join=<code>`): the guest is sat down at once, no name typed and no tap
 * on `#joinBtn` (the owner, 2026-09-25: "it shouldn't make you THEN click 'sit down'"), and the
 * link leaves the address bar. Resolves once the host has answered the join.
 */
export const followInvite = async (page: Page, game: ShellGame, url: string): Promise<void> => {
  await page.goto(url);
  await expect(page.locator('#guestWaitScreen')).toBeVisible();
  expect(new URL(page.url()).searchParams.has('join')).toBe(false);
  await expect(page.locator('#guestWaitStatus')).toHaveText(SHELL[game].hostAnswered, {
    timeout: WEBRTC_TIMEOUT,
  });
};

// ---- online: the start ----------------------------------------------------------------------------

/**
 * The host starts from the waiting room; both tables appear. What the tables show next is each
 * game's (`expectOpening` on its e2e/fixtures/online-games.ts row; backgammon's `start` adds that
 * online has no curtain). Moved here from gin's `ginHostDeals` and backgammon's `bgHostStarts`,
 * whose first four statements were the same (dry-round-2.md I5).
 */
export const hostStarts = async (host: Page, guest: Page): Promise<void> => {
  await expect(host.locator('#startGameBtn')).toBeVisible({ timeout: WEBRTC_TIMEOUT });
  await host.locator('#startGameBtn').click();
  await expect(host.locator('#tableScreen')).toBeVisible();
  await expect(guest.locator('#tableScreen')).toBeVisible();
};

// ---- pass and play: the curtain -------------------------------------------------------------------

/** Hand the phone over: the curtain is up, the seat behind it taps its button; the curtain goes. */
export const reveal = async (page: Page): Promise<void> => {
  await expect(page.locator('#curtainOverlay')).toBeVisible();
  await page.locator('#curtainBtn').click();
  await expect(page.locator('#curtainOverlay')).toBeHidden();
};

/**
 * Start pass and play between `names` at `viewport` on the page at `url`: the switch flips to pass
 * and play (Online is the default mode), the two names go in, `beforeStart` sets what the game's
 * panel adds (backgammon's two selects), Start; resolves with the table up and the first curtain
 * over it. The player fixture opens its own context, so a describe's viewport is applied here.
 */
export const startLocal = async (
  page: Page,
  url: string,
  viewport: Viewport,
  names: Names = DEFAULT_NAMES,
  beforeStart?: (page: Page) => Promise<void>,
): Promise<void> => {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(url);
  await page.locator('#playModeSwitch .mode-btn[data-mode="local"]').click();
  await expect(page.locator('#localModeContent')).toBeVisible();
  await page.locator('#p1NameInput').fill(names[0]);
  await page.locator('#p2NameInput').fill(names[1]);
  if (beforeStart !== undefined) await beforeStart(page);
  await page.locator('#localBtn').click();
  await expect(page.locator('#tableScreen')).toBeVisible();
  await expect(page.locator('#curtainOverlay')).toBeVisible();
};

// ---- the handoff ----------------------------------------------------------------------------------

/** The handed-off room is open under its final code (see `hostRoom` for why it is read only now). */
export const roomOpen = async (
  page: Page,
  game: ShellGame,
  names: Names = DEFAULT_NAMES,
): Promise<string> => {
  await expect(page.locator('#hostWaitScreen')).toBeVisible();
  await expect(page.locator('#hostWaitStatus')).toContainText(roomOpenMsg(game, names), {
    timeout: BROKER_TIMEOUT,
  });
  return roomCode(page, game);
};

/** The table's 🌐: shown for pass and play, its tooltip the offer; a click opens the room. */
export const takeOffer = async (
  page: Page,
  game: ShellGame,
  names: Names = DEFAULT_NAMES,
): Promise<string> => {
  const handoffBtn = page.locator('#handoffBtn');
  await expect(handoffBtn).toBeVisible();
  await expect(handoffBtn).toHaveAttribute('title', resumeLabel.handoff(names));
  await handoffBtn.click();
  return roomOpen(page, game, names);
};
