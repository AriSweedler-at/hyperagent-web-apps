// Two-peer Gin Rummy through the local PeerServer (or 0.peerjs.com under E2E_BROKER=cloud): the
// host opens a room, the guest joins by the code read off the host's screen, the host deals, both
// tables show the same discard pile and hand sizes, the guest plays one legal draw + discard
// through the UI, and the host's table reflects it. Finally the recorded Peer constructions prove
// the ?peer= broker override and the ?ice= configuration reached PeerJS.
import {
  ginDrawAndDiscard,
  ginHostDeals,
  ginPassUpcard,
  isMyTurn,
  readTable,
} from './fixtures/gin.ts';
import { expectPeerOptions, openGame } from './fixtures/player.ts';
import { expect, hostRoom, joinByCode, test } from './fixtures/two-players.ts';

test(
  'host creates a room, guest joins by code, both see the deal, guest draws and discards',
  { tag: '@online' },
  async ({ players, project }) => {
    const { host, guest } = players;
    await openGame(host, project, 'gin-rummy');
    await openGame(guest, project, 'gin-rummy');

    const code = await hostRoom(host, 'gin-rummy', 'Host');
    await joinByCode(guest, 'gin-rummy', code, 'Guest');
    await expect(host.page.locator('#hostWaitStatus')).toContainText('Guest joined!');
    await ginHostDeals(host.page, guest.page);

    // Both tables agree on the deal: same upcard, ten cards each, 31 in the stock, hand 1.
    const [hostTable, guestTable] = await Promise.all([
      readTable(host.page),
      readTable(guest.page),
    ]);
    expect(hostTable.discardTop).toMatch(/^\w+$/);
    expect(guestTable.discardTop).toBe(hostTable.discardTop);
    const dealt = { handSize: 10, oppCount: '10', stockLabel: 'Stock · 31', hand: 'Hand 1' };
    expect(hostTable).toMatchObject(dealt);
    expect(guestTable).toMatchObject(dealt);
    await expect(host.page.locator('#oppName')).toHaveText('Guest');
    await expect(guest.page.locator('#oppName')).toHaveText('Host');

    // Upcard phase: the non-dealer decides, then the dealer. Both pass, so the non-dealer must draw
    // from the stock. Whichever side dealt, the guest ends up in the draw phase.
    const hostFirst = await isMyTurn(host.page);
    const [first, second] = hostFirst ? [host.page, guest.page] : [guest.page, host.page];
    await ginPassUpcard(first);
    await ginPassUpcard(second);
    if (hostFirst) await ginDrawAndDiscard(host.page);
    await expect(guest.page.locator('#statusBanner')).toHaveClass(/mine/);
    const discarded = await ginDrawAndDiscard(guest.page);

    // The host's table reflects the guest's move.
    await expect(host.page.locator('#discardPile .card')).toHaveAttribute('data-card', discarded);
    await expect(host.page.locator('#lastAction')).toContainText('Guest discarded the');
    await expect(host.page.locator('#statusMain')).toHaveText('Your turn');
    await expect(host.page.locator('#oppCards .opp-count')).toHaveText('10');
    await expect(guest.page.locator('#discardPile .card')).toHaveAttribute('data-card', discarded);

    // The discarded-cards sheet (docs/design/gin-arrangement-and-discards.md §8): the guest's view
    // carries the same discarded ids as the host's, so both sheets grey the same chips.
    const seenOn = async (page: typeof host.page): Promise<ReadonlyArray<string | null>> => {
      await page.locator('#discardsBtn').click();
      await expect(page.locator('#discardsOverlay')).toBeVisible();
      const seen = await page.evaluate<ReadonlyArray<string | null>>(
        "Array.from(document.querySelectorAll('#discardsGrid .dc.seen')).map((c) => c.getAttribute('data-card'))",
      );
      await expect(page.locator('#discardsGrid .dc.top')).toHaveAttribute('data-card', discarded);
      await page.locator('#closeDiscardsBtn').click();
      await expect(page.locator('#discardsOverlay')).toBeHidden();
      return seen;
    };
    const hostSeen = await seenOn(host.page);
    expect(hostSeen).toContain(discarded);
    expect(await seenOn(guest.page)).toEqual(hostSeen);

    // PeerJS was constructed with the harness's broker and ICE configuration on both sides.
    const hostCall = (await host.peerCalls()).at(-1);
    const guestCall = (await guest.peerCalls()).at(-1);
    expect(hostCall?.id).toBe(`ginrummy-ari-${code}`);
    expectPeerOptions(hostCall, 0);
    expect(guestCall?.id).toBeNull();
    expectPeerOptions(guestCall, 0);
  },
);
