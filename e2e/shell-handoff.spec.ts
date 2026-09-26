// The remote handoff on both shell games: a pass-and-play game in progress goes on as a hosted room,
// seat 0 keeping this device and seat 1 joining from its own through the invite, a link that carries
// the room code (`?join=`, docs/ARCHITECTURE.md "Documented test hooks") and nothing else. The offer
// is the table's 🌐 (beside gin's leave button, backgammon's menu button), shown for pass and play
// alone, its tooltip naming who hosts and who joins; under the curtain gin offers nothing but the
// reveal, while backgammon, where the phone changes hands under it, offers "Continue online" there
// too (SHELL.curtainButtons and the driver's `curtainOffer`, e2e/fixtures/online-games.ts).
// `#shareCodeBtn` hands the invite to the share sheet where there is one (a phone's OS menu) and to
// the clipboard otherwise (desktop); an invite link fills the join form, sits the guest down at once
// (no tap on Sit down: the owner, 2026-09-25) and leaves the address bar, a malformed one seats nobody;
// the offer survives a reload of the waiting room; and cancelling the room before anyone joined
// gives the game back to pass and play, the table as it stood. The two-device game is @online
// (WebRTC between two contexts): pass and play opened no Peer, the handoff opened the room's, and
// online there is no curtain and no offer. Both origins. Tagged per game (see shell-home.spec.ts).
import type { Page } from '@playwright/test';

import { SHELL, SHELL_GAMES, type ShellGame } from '../tools/games.ts';
import { ROOM_CODE, peerIdFor } from '../web/shared/lib/roomCode.ts';
import { PHONE } from './fixtures/geometry.ts';
import { gamePath, gameSearch, invitePath } from './fixtures/player.ts';
import {
  DEFAULT_NAMES,
  INVITE_COPIED_MSG,
  curtainTitle,
  prefKey,
  readPref,
  rememberName,
  resumeLabel,
  reveal,
  roomOpen,
  startLocal,
  takeOffer,
  unhostedCode,
} from './fixtures/shell.ts';
import { SHELL_DRIVERS, type ShellDriver } from './fixtures/online-games.ts';
import { WEBRTC_TIMEOUT } from './fixtures/timeouts.ts';
import { expect, test } from './fixtures/two-players.ts';

const [ANN, BOB] = DEFAULT_NAMES;

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

/** The page's origin and path: what the invite link is built from, whatever the query or hash. */
const pageUrlOf = (page: Page): string => {
  const url = new URL(page.url());
  return `${url.origin}${url.pathname}`;
};

/** The invite link for `code`, as the host page builds it. */
const inviteLinkOf = (page: Page, code: string): string => `${pageUrlOf(page)}?join=${code}`;

/**
 * Start Ann and Bob's pass-and-play game, lift the first curtain and take the table's offer.
 * Returns the confirmed code and the table as the first mover saw it.
 */
const handOff = async (
  page: Page,
  game: ShellGame,
  driver: ShellDriver,
  url: string,
): Promise<Readonly<{ code: string; before: string }>> => {
  await startLocal(page, url, PHONE);
  await reveal(page);
  const before = await driver.snapshot(page);
  return { code: await takeOffer(page, game), before };
};

/**
 * Cancel the room and resume pass and play: the table as it stands, read beneath the curtain that
 * names the mover again (its reveal would bring backgammon's roll modal for a seat still to roll, so it is left up).
 */
const cancelAndResume = async (page: Page, driver: ShellDriver): Promise<string> => {
  await page.locator('#cancelHostBtn').click();
  await expect(page.locator('#homeScreen')).toBeVisible();
  await expect(page.locator('#resumeBtn')).toHaveText(resumeLabel.local(DEFAULT_NAMES));
  await page.locator('#resumeBtn').click();
  await expect(page.locator('#tableScreen')).toBeVisible();
  await expect(page.locator('#curtainOverlay')).toBeVisible();
  await expect(page.locator('#handoffBtn')).toBeVisible();
  return driver.snapshot(page);
};

SHELL_GAMES.forEach((game) => {
  test.describe(game, { tag: `@${game}` }, () => {
    const shell = SHELL[game];
    const driver = SHELL_DRIVERS[game];

    test('a pass-and-play game is offered online; the share sheet gets the link alone; the offer survives a reload; cancel gives the game back', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await page.addInitScript({ content: SHARE_SHEET });
      const { code, before } = await handOff(page, game, driver, gamePath(project, game));
      await page.locator('#shareCodeBtn').click();
      await expect
        .poll(() => page.evaluate('window.__shared'))
        .toEqual({ title: shell.shareTitle, url: inviteLinkOf(page, code) });

      // A reload while the room waits: the offer comes back as the handoff, under the same code the
      // invite carries, not as a room to host.
      await page.reload();
      await expect(page.locator('#resumeBtn')).toHaveText(resumeLabel.handoff(DEFAULT_NAMES));
      await page.locator('#resumeBtn').click();
      expect(await roomOpen(page, game)).toBe(code);

      // Nobody joined: cancelling the room gives the game back to pass and play, as it stood.
      expect(await cancelAndResume(page, driver)).toBe(before);
    });

    test('without a share sheet (desktop) the link is copied', async ({ player, project }) => {
      const { page } = player;
      await page.addInitScript({ content: DESKTOP });
      const { code } = await handOff(page, game, driver, gamePath(project, game));
      await page.locator('#shareCodeBtn').click();
      await expect(page.locator('#toast')).toHaveText(INVITE_COPIED_MSG);
      expect(await page.evaluate('window.__copied')).toBe(inviteLinkOf(page, code));
    });

    test(`${driver.curtainOffer.title}; cancel gives it back`, async ({ player, project }) => {
      const { page } = player;
      await startLocal(page, gamePath(project, game), PHONE);
      await driver.curtainOffer.toCurtain(page);
      // The curtain names the seat about to take the phone and carries the game's buttons.
      await expect(page.locator('#curtainOverlay')).toBeVisible();
      await expect(page.locator('#curtainTitle')).toHaveText(curtainTitle(DEFAULT_NAMES));
      await expect(page.locator('#curtainOverlay .btn')).toHaveCount(shell.curtainButtons);
      const before = await driver.snapshot(page);
      await driver.curtainOffer.take(page);
      await expect(page.locator('#curtainOverlay')).toBeHidden();
      expect(await cancelAndResume(page, driver)).toBe(before);
    });

    test('an invite link sits the guest down at once: the waiting room with no tap, nothing stored, the link out of the address bar; cancel is the home screen with the code still in the form', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await page.goto(gamePath(project, game));
      await page.evaluate(
        `localStorage.setItem(${JSON.stringify(prefKey(game, 'homeTab'))}, 'rules'); localStorage.setItem(${JSON.stringify(prefKey(game, 'playMode'))}, 'local');`,
      );
      // A room nobody hosts (a code of the game's length, typed in lower case as a link may carry
      // it): the guest is in its waiting room all the same, the session asking after it.
      const nobody = unhostedCode(game);
      await page.goto(invitePath(project, game, nobody.toLowerCase()));
      await expect(page.locator('#guestWaitScreen')).toBeVisible();
      await expect(page.locator('#homeScreen')).toBeHidden();
      expect(await readPref(page, game, 'playMode')).toBe('local');
      expect(await readPref(page, game, 'homeTab')).toBe('rules');
      expect(await readPref(page, game, 'name')).toBeNull();
      // The link is spent: the harness hooks and the page's own query stay, the invite's parameters do not.
      const url = new URL(page.url());
      expect(url.searchParams.has('join')).toBe(false);
      expect(url.search).toBe(gameSearch(game));
      // Cancel is the ordinary home screen (the link stored nothing: the Rules tab comes back) with
      // the code the link filled still in the form, so the guest can try again by hand.
      await page.locator('#cancelGuestBtn').click();
      await expect(page.locator('#homeScreen')).toBeVisible();
      await expect(page.locator('#rulesPanel')).toBeVisible();
      await expect(page.locator('#codeInput')).toHaveValue(nobody);
      // A reload is the ordinary home screen (the stored Rules tab and pass-and-play mode).
      await page.reload();
      await expect(page.locator('#rulesPanel')).toBeVisible();
      await expect(page.locator('#codeInput')).toHaveValue('');
    });

    test('a malformed invite (a code of the wrong length) seats nobody: the join form with the code and the message, no Peer opened', async ({
      player,
      project,
    }) => {
      const { page } = player;
      await page.goto(invitePath(project, game, 'ab'));
      await expect(page.locator('#homeScreen')).toBeVisible();
      await expect(page.locator('#onlineModeContent')).toBeVisible();
      await expect(page.locator('#codeInput')).toHaveValue('AB');
      await expect(page.locator('#toast')).toHaveText(ROOM_CODE[game].lengthError);
      await expect(page.locator('#guestWaitScreen')).toBeHidden();
      expect(await player.peerCalls()).toEqual([]);
    });

    test(
      'the guest follows the invite link and carries on the same game from its own device',
      { tag: '@online' },
      async ({ players, project }) => {
        const { host, guest } = players;
        const { code, before } = await handOff(host.page, game, driver, gamePath(project, game));
        // Pass and play opened no Peer; the handoff opened the room's.
        expect((await host.peerCalls()).map((c) => c.id)).toEqual([peerIdFor(game, code)]);

        // Bob's phone remembers his name from an earlier visit; the link sits him down as himself,
        // with nothing to type and nothing to tap.
        await guest.page.goto(gamePath(project, game));
        await rememberName(guest.page, game, BOB);
        await guest.page.goto(invitePath(project, game, code));
        await expect(guest.page.locator('#guestWaitScreen')).toBeVisible();
        await expect(guest.page.locator('#codeInput')).toHaveValue(code);

        // The host's join handler keeps the seat, takes the guest's name and broadcasts the game.
        await expect(host.page.locator('#tableScreen')).toBeVisible({ timeout: WEBRTC_TIMEOUT });
        await expect(guest.page.locator('#tableScreen')).toBeVisible({ timeout: WEBRTC_TIMEOUT });
        await expect(host.page.locator('#oppName')).toHaveText(BOB);
        await expect(guest.page.locator('#oppName')).toHaveText(ANN);
        expect(await driver.agree(host.page, guest.page)).toBe(before);
        // Online: no curtain, no offer.
        await expect(host.page.locator('#curtainOverlay')).toBeHidden();
        await expect(guest.page.locator('#curtainOverlay')).toBeHidden();
        await expect(host.page.locator('#handoffBtn')).toBeHidden();
      },
    );
  });
});
