// Resume and rejoin (docs/MIGRATION.md step 12): the host deals, reloads the page and resumes the
// room from `ginRummyMP_v1`; the guest, whose channel dropped, rejoins by itself and both tables
// show the same hand again. Then the guest reloads and rejoins from its own save. Runs on both
// origins against the served page (the typed port since docs/MIGRATION.md step 13).
import { BROKER_TIMEOUT, WEBRTC_TIMEOUT } from './fixtures/timeouts.ts';
import { ginHostDeals, readTable } from './fixtures/gin.ts';
import { openGame } from './fixtures/player.ts';
import { expect, hostRoom, joinByCode, test } from './fixtures/two-players.ts';

test(
  'host reloads and resumes the room; the guest rejoins; then the guest reloads and rejoins',
  { tag: '@online' },
  async ({ players, project }) => {
    const { host, guest } = players;
    await openGame(host, project, 'gin-rummy');
    await openGame(guest, project, 'gin-rummy');
    const code = await hostRoom(host, 'gin-rummy', 'Host');
    await joinByCode(guest, 'gin-rummy', code, 'Guest');
    await ginHostDeals(host.page, guest.page);
    const dealt = await readTable(host.page);
    expect(await readTable(guest.page)).toMatchObject({
      discardTop: dealt.discardTop,
      hand: dealt.hand,
    });

    // The host reloads: the save offers the room back; resuming reopens it on the broker.
    await host.page.reload();
    await expect(host.page.locator('#homeScreen')).toBeVisible();
    await expect(host.page.locator('#resumeBtn')).toHaveText(`Resume hosting room ${code}`);
    const saved: unknown = JSON.parse(
      (await host.page.evaluate<string | null>("localStorage.getItem('ginRummyMP_v1')")) ?? 'null',
    );
    expect(saved).toMatchObject({ role: 'host', code, oppName: 'Guest', game: { handNumber: 1 } });
    await host.page.locator('#resumeBtn').click();
    await expect(host.page.locator('#hostWaitScreen')).toBeVisible();
    await expect(host.page.locator('#roomCode')).toHaveText(code);
    await expect(host.page.locator('#hostWaitStatus')).toContainText(`Room ${code} reopened`, {
      timeout: BROKER_TIMEOUT,
    });

    // The guest lost the channel and retries on its own until the room answers; the host's join
    // handler keeps the seat and broadcasts the hand to both.
    await expect(host.page.locator('#tableScreen')).toBeVisible({ timeout: WEBRTC_TIMEOUT });
    await expect(guest.page.locator('#tableScreen')).toBeVisible({ timeout: WEBRTC_TIMEOUT });
    await expect(host.page.locator('#oppName')).toHaveText('Guest');
    await expect(guest.page.locator('#oppName')).toHaveText('Host');
    expect(await readTable(host.page)).toEqual(dealt);
    expect(await readTable(guest.page)).toMatchObject({
      discardTop: dealt.discardTop,
      hand: dealt.hand,
      stockLabel: dealt.stockLabel,
    });

    // The guest reloads: its save offers the rejoin; the host welcomes it back to the same hand.
    await guest.page.reload();
    await expect(guest.page.locator('#homeScreen')).toBeVisible();
    await expect(guest.page.locator('#resumeBtn')).toHaveText(`Rejoin room ${code}`);
    await guest.page.locator('#resumeBtn').click();
    await expect(guest.page.locator('#guestWaitScreen')).toBeVisible();
    await expect(guest.page.locator('#tableScreen')).toBeVisible({ timeout: WEBRTC_TIMEOUT });
    await expect(guest.page.locator('#oppName')).toHaveText('Host');
    expect(await readTable(guest.page)).toMatchObject({
      discardTop: dealt.discardTop,
      hand: dealt.hand,
      stockLabel: dealt.stockLabel,
    });
    await expect(host.page.locator('#connDot')).toHaveClass(/\bon\b/);
  },
);
