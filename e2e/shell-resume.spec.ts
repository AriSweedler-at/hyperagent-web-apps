// Resume and rejoin on both shell games (docs/MIGRATION.md step 12): the host starts, reloads the
// page and resumes the room from its save (`ginRummyMP_v1`, `backgammonMP_v1`: REGISTRY.storage);
// the guest, whose channel dropped, rejoins by itself and both tables show the same game again.
// Then the guest reloads and rejoins from its own save, and both connection dots are on. And a
// pass-and-play game offers itself back under the players' names, the table as it stood, with no
// Peer opened. Both origins against the served page (the typed port since docs/MIGRATION.md step
// 13). Tagged per game (see shell-home.spec.ts); the two-peer case @online.
import { SHELL, SHELL_GAMES } from '../tools/games.ts';
import { PHONE } from './fixtures/geometry.ts';
import { gameQuery } from './fixtures/player.ts';
import {
  DEFAULT_NAMES,
  ONLINE_NAMES,
  readSave,
  reopenedMsg,
  resumeLabel,
  startLocal,
} from './fixtures/shell.ts';
import { SHELL_DRIVERS, connect } from './fixtures/online-games.ts';
import { pagePath } from './fixtures/site.ts';
import { BROKER_TIMEOUT, WEBRTC_TIMEOUT } from './fixtures/timeouts.ts';
import { expect, test } from './fixtures/two-players.ts';

const [HOST, GUEST] = ONLINE_NAMES;

SHELL_GAMES.forEach((game) => {
  test.describe(game, { tag: `@${game}` }, () => {
    const shell = SHELL[game];
    const driver = SHELL_DRIVERS[game];

    test(
      'host reloads and resumes the room; the guest rejoins; then the guest reloads and rejoins',
      { tag: '@online' },
      async ({ players, project }) => {
        const { host, guest } = players;
        const code = await connect(players, project, game);
        await driver.start(host.page, guest.page);
        const started = await driver.agree(host.page, guest.page);

        // The host reloads: the save offers the room back; resuming reopens it on the broker.
        await host.page.reload();
        await expect(host.page.locator('#homeScreen')).toBeVisible();
        await expect(host.page.locator('#resumeBtn')).toHaveText(resumeLabel.host(code));
        expect(await readSave(host.page, game)).toMatchObject({
          role: 'host',
          code,
          myName: HOST,
          oppName: GUEST,
          ...driver.hostSave,
        });
        await host.page.locator('#resumeBtn').click();
        await expect(host.page.locator('#hostWaitScreen')).toBeVisible();
        await expect(host.page.locator('#roomCode')).toHaveText(code);
        await expect(host.page.locator('#hostWaitStatus')).toContainText(reopenedMsg(code), {
          timeout: BROKER_TIMEOUT,
        });

        // The guest lost the channel and retries on its own until the room answers; the host's join
        // handler keeps the seat and broadcasts the game to both.
        await expect(host.page.locator('#tableScreen')).toBeVisible({ timeout: WEBRTC_TIMEOUT });
        await expect(guest.page.locator('#tableScreen')).toBeVisible({ timeout: WEBRTC_TIMEOUT });
        await expect(host.page.locator('#oppName')).toHaveText(GUEST);
        await expect(guest.page.locator('#oppName')).toHaveText(HOST);
        expect(await driver.agree(host.page, guest.page)).toBe(started);

        // The guest reloads: its save offers the rejoin; the host welcomes it back to the same game.
        await guest.page.reload();
        await expect(guest.page.locator('#homeScreen')).toBeVisible();
        await expect(guest.page.locator('#resumeBtn')).toHaveText(resumeLabel.guest(code));
        await guest.page.locator('#resumeBtn').click();
        await expect(guest.page.locator('#guestWaitScreen')).toBeVisible();
        await expect(guest.page.locator('#tableScreen')).toBeVisible({ timeout: WEBRTC_TIMEOUT });
        await expect(guest.page.locator('#oppName')).toHaveText(HOST);
        expect(await driver.agree(host.page, guest.page)).toBe(started);
        await expect(host.page.locator(shell.connDot)).toHaveClass(/\bon\b/);
        await expect(guest.page.locator(shell.connDot)).toHaveClass(/\bon\b/);
      },
    );

    test("a pass-and-play game offers itself back under the players' names, the table as it stood", async ({
      player,
      project,
    }) => {
      const { page } = player;
      await startLocal(page, `${pagePath(project, game)}${gameQuery()}`, PHONE);
      const before = await driver.snapshot(page);
      await page.reload();
      await expect(page.locator('#homeScreen')).toBeVisible();
      await expect(page.locator('#resumeBtn')).toHaveText(resumeLabel.local(DEFAULT_NAMES));
      await page.locator('#resumeBtn').click();
      await expect(page.locator('#tableScreen')).toBeVisible();
      await expect(page.locator('#curtainOverlay')).toBeVisible();
      expect(await driver.snapshot(page)).toBe(before);
      // Pass and play opens no Peer.
      expect(await player.peerCalls()).toEqual([]);
    });
  });
});
