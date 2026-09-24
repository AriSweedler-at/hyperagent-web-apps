// Resume and rejoin (gin's e2e/gin-resume.spec.ts for the third game): the host starts the match,
// reloads the page and resumes the room from `backgammonMP_v1`; the guest, whose channel dropped,
// rejoins by itself and both boards show the same position again. Then the guest reloads and
// rejoins from its own save. A pass-and-play game offers itself back under the players' names.
// Runs on both origins against the served page.
import {
  bgBoardsAgree,
  bgHostStarts,
  bgStartLocal,
  boardKey,
  readBoard,
} from './fixtures/backgammon.ts';
import { gameQuery, openGame } from './fixtures/player.ts';
import { pagePath } from './fixtures/site.ts';
import { BROKER_TIMEOUT, WEBRTC_TIMEOUT } from './fixtures/timeouts.ts';
import { expect, hostRoom, joinByCode, test } from './fixtures/two-players.ts';

const PHONE = { width: 390, height: 844 } as const;

test(
  'host reloads and resumes the room; the guest rejoins; then the guest reloads and rejoins',
  { tag: '@online' },
  async ({ players, project }) => {
    const { host, guest } = players;
    await openGame(host, project, 'backgammon');
    await openGame(guest, project, 'backgammon');
    const code = await hostRoom(host, 'backgammon', 'Host');
    await joinByCode(guest, 'backgammon', code, 'Guest');
    await bgHostStarts(host.page, guest.page);
    const started = boardKey(await bgBoardsAgree(host.page, guest.page));

    // The host reloads: the save offers the room back; resuming reopens it on the broker.
    await host.page.reload();
    await expect(host.page.locator('#homeScreen')).toBeVisible();
    await expect(host.page.locator('#resumeBtn')).toHaveText(`Resume hosting room ${code}`);
    const saved: unknown = JSON.parse(
      (await host.page.evaluate<string | null>("localStorage.getItem('backgammonMP_v1')")) ??
        'null',
    );
    expect(saved).toMatchObject({
      role: 'host',
      code,
      myName: 'Host',
      oppName: 'Guest',
      matchLength: 5,
      variant: 'portes',
      game: { gameNo: 1 },
    });
    await host.page.locator('#resumeBtn').click();
    await expect(host.page.locator('#hostWaitScreen')).toBeVisible();
    await expect(host.page.locator('#roomCode')).toHaveText(code);
    await expect(host.page.locator('#hostWaitStatus')).toContainText(`Room ${code} reopened`, {
      timeout: BROKER_TIMEOUT,
    });

    // The guest lost the channel and retries on its own until the room answers; the host's join
    // handler keeps the seat and broadcasts the position to both.
    await expect(host.page.locator('#tableScreen')).toBeVisible({ timeout: WEBRTC_TIMEOUT });
    await expect(guest.page.locator('#tableScreen')).toBeVisible({ timeout: WEBRTC_TIMEOUT });
    await expect(host.page.locator('#oppName')).toHaveText('Guest');
    await expect(guest.page.locator('#oppName')).toHaveText('Host');
    expect(boardKey(await bgBoardsAgree(host.page, guest.page))).toBe(started);

    // The guest reloads: its save offers the rejoin; the host welcomes it back to the same position.
    await guest.page.reload();
    await expect(guest.page.locator('#homeScreen')).toBeVisible();
    await expect(guest.page.locator('#resumeBtn')).toHaveText(`Rejoin room ${code}`);
    await guest.page.locator('#resumeBtn').click();
    await expect(guest.page.locator('#guestWaitScreen')).toBeVisible();
    await expect(guest.page.locator('#tableScreen')).toBeVisible({ timeout: WEBRTC_TIMEOUT });
    await expect(guest.page.locator('#oppName')).toHaveText('Host');
    expect(boardKey(await bgBoardsAgree(host.page, guest.page))).toBe(started);
    await expect(host.page.locator('#oppDot')).toHaveClass(/\bon\b/);
    await expect(guest.page.locator('#oppDot')).toHaveClass(/\bon\b/);
  },
);

test('a pass-and-play match offers itself back under the players` names, the position as it stood', async ({
  player,
  project,
}) => {
  const { page } = player;
  await bgStartLocal(page, `${pagePath(project, 'backgammon')}${gameQuery()}`, PHONE);
  const before = boardKey(await readBoard(page));
  await page.reload();
  await expect(page.locator('#homeScreen')).toBeVisible();
  await expect(page.locator('#resumeBtn')).toHaveText('Resume pass & play: Ann vs Bob');
  await page.locator('#resumeBtn').click();
  await expect(page.locator('#tableScreen')).toBeVisible();
  await expect(page.locator('#curtainOverlay')).toBeVisible();
  expect(boardKey(await readBoard(page))).toBe(before);
  // Pass-and-play opens no Peer.
  expect(await player.peerCalls()).toEqual([]);
});
