// A guest whose page dies without a goodbye (the online review's loss.spec.ts: the whole browser
// context closed, which PeerJS never reports as `close`) is noticed by the host within the
// sessions' grace (web/shared/net/liveness.ts: heartbeats every HB_MS, HB_GRACE_MS of silence is
// the peer gone): the opponent dot goes off and the "they can rejoin with code X" toast shows.
// The same player then comes back in a fresh tab with the code and takes the seat back with the
// current view, never told the room already has two players (the review's A13/A14 screenshots),
// whether it returns after the host's toast or within seconds of the death, while the host still
// takes its dead tab for a quiet guest: that join is held until the silence reaches HB_MISSED_MS
// (web/shared/net/host.ts `accept`; the liveness review's L2-early read "room full" five times
// before). And a blink of the broker socket under a live channel leaves the game alone: the
// guest's reconnect opens no second channel, so no "lost", no "room full", no dot flicker (the
// review's B4). Once per shell game, since the sessions are shared and each game keeps only its
// codec and its ids: one describe per game off tools/games.ts, tagged `@<game>` so each game's e2e
// job plays its own (see shell-home.spec.ts); on `pages` only (playwright.config.ts
// PAGE_ONLY_SPECS): the wait is the sessions' timers, not the origin's. Status and toast texts are
// collected by a MutationObserver from the moment of interest, so a message that flashed between
// two polls is not missed.
import { resolve } from 'node:path';

import type { Browser, Page, TestInfo } from '@playwright/test';

import { SHELL, SHELL_GAMES, type ShellGame } from '../tools/games.ts';
import { HB_MS } from '../web/shared/net/liveness.ts';
import { newPlayer, openGame, type Player } from './fixtures/player.ts';
import { ONLINE_NAMES } from './fixtures/shell.ts';
import { SHELL_DRIVERS, connect } from './fixtures/shell-games.ts';
import type { Project } from './fixtures/site.ts';
import { LIVENESS_TIMEOUT, WEBRTC_TIMEOUT } from './fixtures/timeouts.ts';
import { expect, test, type Players } from './fixtures/two-players.ts';

const [HOST, GUEST] = ONLINE_NAMES;

/** Both games' `ROOM_FULL_MSG` (ui/state.ts), what a third peer's wait screen says. */
const ROOM_FULL_MSG = 'That room already has two players.';
/** Both games' `LOST_HOST_MSG`: the guest's toast when its channel to the host is lost. */
const LOST_HOST_MSG = 'Lost connection to the host — reconnecting…';
/** Both games' `guestGoneMsg`: the host's toast when the guest's channel is lost. */
const guestGoneMsg = (name: string, code: string): string =>
  `${name} disconnected — they can rejoin with code ${code}.`;
/** How soon after its tab dies the returning guest knocks in the early case: well within HB_MISSED_MS. */
const EARLY_RETURN_MS = 2000;

const RECORD_SOCKETS_SCRIPT = resolve(import.meta.dirname, 'browser', 'record-sockets.js');

type Shell = Readonly<{
  game: ShellGame;
  /** The host starts the game; both tables appear. */
  start: (host: Page, guest: Page) => Promise<void>;
  /** The opponent dot (`conn-dot on|off`), the same id on both sides. */
  dot: string;
  /** Something of the game itself the returning guest must see: its hand, or the board. */
  table: string;
}>;

/** A shell game's row here, off its registry row (tools/games.ts SHELL) and its driver (e2e/fixtures/shell-games.ts). */
const shellOf = (game: ShellGame): Shell => ({
  game,
  start: SHELL_DRIVERS[game].start,
  dot: SHELL[game].connDot,
  table: SHELL_DRIVERS[game].table,
});

/**
 * Every distinct text `#id` shows from now on, in order, starting with what it shows now. Read
 * with the returned function. Installed in the page, so it survives no navigation.
 */
const watchText = async (page: Page, id: string): Promise<() => Promise<ReadonlyArray<string>>> => {
  await page.evaluate(
    `(() => {
      const seen = [];
      (window.__texts ??= {})[${JSON.stringify(id)}] = seen;
      const read = () => {
        const text = (document.getElementById(${JSON.stringify(id)})?.textContent ?? '').trim();
        if (seen[seen.length - 1] !== text) seen.push(text);
      };
      read();
      new MutationObserver(read).observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    })()`,
  );
  return () => page.evaluate<ReadonlyArray<string>>(`window.__texts[${JSON.stringify(id)}]`);
};

/** How many RTCPeerConnections the page has built (e2e/browser/record-pc.js). */
const peerConnections = (page: Page): Promise<number> =>
  page.evaluate<number>('window.__peerConnections.length');

/**
 * Sit down again mid-game: the join form, then the table (a rejoining guest gets the host's
 * `state` right after its join, so the lobby status the drivers wait for never shows).
 */
const rejoin = async (page: Page, name: string, code: string): Promise<void> => {
  await expect(page.locator('#onlineModeContent')).toBeVisible();
  await page.locator('#nameInput').fill(name);
  await page.locator('#codeInput').pressSequentially(code);
  await expect(page.locator('#codeInput')).toHaveValue(code);
  await page.locator('#joinBtn').click();
  await expect(page.locator('#tableScreen')).toBeVisible({ timeout: WEBRTC_TIMEOUT });
};

const returning = async (
  browser: Browser,
  project: Project,
  game: ShellGame,
  testInfo: TestInfo,
): Promise<Player> => {
  // A seed of its own: `newPlayer` seeds by title path and role, and the first guest holds this one's.
  const player = await newPlayer(browser, 'guest', {
    ...testInfo,
    titlePath: [...testInfo.titlePath, 'returning'],
  });
  await openGame(player, project, game);
  return player;
};

/** Host and guest into a started game (the shell's connection, then the game's start); resolves with the room code. */
const started = async (shell: Shell, players: Players, project: Project): Promise<string> => {
  const { host, guest } = players;
  const code = await connect(players, project, shell.game);
  await shell.start(host.page, guest.page);
  await expect(host.page.locator(shell.dot)).toHaveClass(/\bon\b/);
  await expect(guest.page.locator(shell.dot)).toHaveClass(/\bon\b/);
  return code;
};

/** The returning guest is seated with the current view, both sides naming each other, the host's dot on. */
const seated = async (shell: Shell, host: Player, back: Player): Promise<void> => {
  await expect(back.page.locator(shell.table).first()).toBeVisible();
  await expect(back.page.locator('#oppName')).toHaveText(HOST);
  await expect(host.page.locator(shell.dot)).toHaveClass(/\bon\b/);
  await expect(host.page.locator('#oppName')).toHaveText(GUEST);
};

SHELL_GAMES.forEach((game) => {
  test.describe(game, { tag: `@${game}` }, () => {
    const shell = shellOf(game);
    const { dot } = shell;

    test(
      'a guest whose tab dies is noticed within the grace, and back in a new tab after the toast it takes its seat',
      { tag: '@online' },
      async ({ players, project, browser }, testInfo) => {
        const { host, guest } = players;
        const code = await started(shell, players, project);

        // The guest's whole context dies: no `close` ever crosses the wire.
        await guest.context.close();
        await expect(host.page.locator('#toast')).toHaveText(guestGoneMsg(GUEST, code), {
          timeout: LIVENESS_TIMEOUT,
        });
        await expect(host.page.locator(dot)).toHaveClass(/\boff\b/);
        await expect(host.page.locator('#tableScreen')).toBeVisible();

        // The same player, a fresh tab, the same name and code: seated with the current view, and
        // its wait screen never said the room was full.
        const back = await returning(browser, project, game, testInfo);
        try {
          const statuses = await watchText(back.page, 'guestWaitStatus');
          await rejoin(back.page, GUEST, code);
          await seated(shell, host, back);
          expect(await statuses()).not.toContain(ROOM_FULL_MSG);
        } finally {
          await back.context.close();
        }
        expect(back.watched.errors(), 'returning guest uncaught exceptions').toEqual([]);
      },
    );

    test(
      "a guest back within seconds of its tab dying is held, never told the room is full, and seated; the host's seat never shows empty",
      { tag: '@online' },
      async ({ players, project, browser }, testInfo) => {
        const { host, guest } = players;
        const code = await started(shell, players, project);
        const hostToasts = await watchText(host.page, 'toast');

        // The guest dies and is back EARLY_RETURN_MS later: to the host its old channel is merely
        // quiet, so the new join waits for the silence to reach HB_MISSED_MS, then takes the seat.
        await guest.context.close();
        await host.page.waitForTimeout(EARLY_RETURN_MS);
        const back = await returning(browser, project, game, testInfo);
        try {
          const statuses = await watchText(back.page, 'guestWaitStatus');
          await rejoin(back.page, GUEST, code);
          await seated(shell, host, back);
          expect(await statuses()).not.toContain(ROOM_FULL_MSG);
          // The dead channel was replaced, not lost: no toast, and the dot never went off.
          expect(await hostToasts()).not.toContain(guestGoneMsg(GUEST, code));
        } finally {
          await back.context.close();
        }
        expect(back.watched.errors(), 'returning guest uncaught exceptions').toEqual([]);
      },
    );

    test(
      "the guest's broker socket blinks mid-game: no second channel, no lost, no room full, both dots stay on",
      { tag: '@online' },
      async ({ players, project }) => {
        const { host, guest } = players;
        await guest.context.addInitScript({ path: RECORD_SOCKETS_SCRIPT });
        const code = await started(shell, players, project);
        const guestToasts = await watchText(guest.page, 'toast');
        const guestStatuses = await watchText(guest.page, 'guestWaitStatus');
        const hostToasts = await watchText(host.page, 'toast');
        const [hostPcs, guestPcs] = await Promise.all([
          peerConnections(host.page),
          peerConnections(guest.page),
        ]);

        // The PeerJS socket closes under the guest; keepPeerAlive reconnects 400 ms later and the
        // Peer's `open` runs tryJoin, which finds the channel open and joins nothing.
        const dropped = await guest.page.evaluate<number>(
          `window.__sockets.filter((s) => s.readyState === WebSocket.OPEN).map((s) => s.close()).length`,
        );
        expect(dropped, 'an open broker socket to drop').toBeGreaterThanOrEqual(1);
        // Long enough for the reconnect and at least one heartbeat each way on the untouched channel.
        await guest.page.waitForTimeout(HB_MS + 2000);

        // The blink itself was shown (the network error, as ever), and nothing else happened.
        expect(await guestToasts()).toContainEqual(expect.stringContaining('[network]'));
        expect(await guestToasts()).not.toContain(LOST_HOST_MSG);
        expect(await guestStatuses()).not.toContain(ROOM_FULL_MSG);
        expect(await hostToasts()).not.toContain(guestGoneMsg(GUEST, code));
        await expect(host.page.locator(dot)).toHaveClass(/\bon\b/);
        await expect(guest.page.locator(dot)).toHaveClass(/\bon\b/);
        expect(await peerConnections(host.page), 'host RTCPeerConnections').toBe(hostPcs);
        expect(await peerConnections(guest.page), 'guest RTCPeerConnections').toBe(guestPcs);
      },
    );
  });
});
