// Two-peer Gin Rummy through the local PeerServer (or 0.peerjs.com under E2E_BROKER=cloud), gin's
// half: once the shell has connected the two pages and the host has dealt, the guest plays one legal
// draw + discard through the UI, the host's table reflects it, and both discards sheets agree. The
// shell's half (the room, the join, the deal on both tables, the names, the recorded Peer
// constructions with the ?peer= and ?ice= hooks) is e2e/shell-online.spec.ts, for both shell games.
import { ginDrawAndDiscard, ginPassUpcard, isMyTurn } from './fixtures/gin.ts';
import { connect } from './fixtures/online-games.ts';
import { hostStarts } from './fixtures/shell.ts';
import { expect, test } from './fixtures/two-players.ts';

test(
  'after the deal both pass the upcard, the guest draws and discards, the host reflects it, both discards sheets agree',
  { tag: '@online' },
  async ({ players, project }) => {
    const { host, guest } = players;
    await connect(players, project, 'gin-rummy');
    await hostStarts(host.page, guest.page);

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
  },
);
