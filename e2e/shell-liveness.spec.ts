// A guest whose page dies without a goodbye (the online review's loss.spec.ts: the whole browser
// context closed, which PeerJS never reports as `close`) is noticed by the host within the
// sessions' grace (web/shared/net/liveness.ts: heartbeats every HB_MS, HB_GRACE_MS of silence is
// the peer gone): the opponent dot goes off and the "they can rejoin with code X" toast shows.
// The same player then comes back in a fresh tab with the code and takes the seat back with the
// current view, never told the room already has two players (the review's A13/A14 screenshots).
// Once per game, since the sessions are shared and each game keeps only its codec and its ids;
// on `pages` only (playwright.config.ts PAGE_ONLY_SPECS): the wait is the sessions' timers, not
// the origin's.
import type { Browser, Page, TestInfo } from '@playwright/test';

import { bgHostStarts } from './fixtures/backgammon.ts';
import { ginHostDeals } from './fixtures/gin.ts';
import { newPlayer, openGame, type Player } from './fixtures/player.ts';
import type { Project } from './fixtures/site.ts';
import { LIVENESS_TIMEOUT, WEBRTC_TIMEOUT } from './fixtures/timeouts.ts';
import { expect, hostRoom, joinByCode, test, type OnlineGame } from './fixtures/two-players.ts';

/** Both games' `ROOM_FULL_MSG` (ui/state.ts), what a third peer's wait screen says. */
const ROOM_FULL_MSG = 'That room already has two players.';

type Shell = Readonly<{
  game: OnlineGame;
  /** The host starts the game; both tables appear. */
  start: (host: Page, guest: Page) => Promise<void>;
  /** The host's opponent dot (`conn-dot on|off`). */
  dot: string;
  /** Something of the game itself the returning guest must see: its hand, or the board. */
  table: string;
}>;

const SHELLS: ReadonlyArray<Shell> = [
  { game: 'gin-rummy', start: ginHostDeals, dot: '#connDot', table: '#hand .card' },
  { game: 'backgammon', start: bgHostStarts, dot: '#oppDot', table: '#board' },
];

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
  game: OnlineGame,
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

SHELLS.forEach(({ game, start, dot, table }) => {
  test(
    `${game}: a guest whose tab dies is noticed within the grace, and back in a new tab it takes its seat`,
    { tag: '@online' },
    async ({ players, project, browser }, testInfo) => {
      const { host, guest } = players;
      await openGame(host, project, game);
      await openGame(guest, project, game);
      const code = await hostRoom(host, game, 'Host');
      await joinByCode(guest, game, code, 'Guest');
      await expect(host.page.locator('#hostWaitStatus')).toContainText('Guest joined!');
      await start(host.page, guest.page);
      await expect(host.page.locator(dot)).toHaveClass(/\bon\b/);

      // The guest's whole context dies: no `close` ever crosses the wire.
      await guest.context.close();
      await expect(host.page.locator('#toast')).toHaveText(
        `Guest disconnected — they can rejoin with code ${code}.`,
        { timeout: LIVENESS_TIMEOUT },
      );
      await expect(host.page.locator(dot)).toHaveClass(/\boff\b/);
      await expect(host.page.locator('#tableScreen')).toBeVisible();

      // The same player, a fresh tab, the same name and code: seated with the current view.
      const back = await returning(browser, project, game, testInfo);
      try {
        await rejoin(back.page, 'Guest', code);
        await expect(back.page.locator(table).first()).toBeVisible();
        await expect(back.page.locator('#guestWaitStatus')).not.toContainText(ROOM_FULL_MSG);
        await expect(back.page.locator('#oppName')).toHaveText('Host');
        await expect(host.page.locator(dot)).toHaveClass(/\bon\b/);
        await expect(host.page.locator('#oppName')).toHaveText('Guest');
      } finally {
        await back.context.close();
      }
      expect(back.watched.errors(), 'returning guest uncaught exceptions').toEqual([]);
    },
  );
});
