// Two-peer Fidice through the local PeerServer (or 0.peerjs.com under E2E_BROKER=cloud): the host
// opens a lobby, the guest joins by the code on the host's screen, both see two seats, the host
// starts and both see the same round with the cup at the same seat. The recorded Peer
// constructions prove the ?peer= broker override and the ?ice= configuration reached PeerJS.
import { fidiceRound, fidiceSeatName, fidiceSeats } from './fixtures/fidice.ts';
import { expectedPeerOptions, openGame } from './fixtures/player.ts';
import { expect, hostRoom, joinByCode, test } from './fixtures/two-players.ts';

test(
  'host opens a lobby, guest joins by code, both see two seats, host starts, same round',
  { tag: '@online' },
  async ({ players, project }) => {
    const { host, guest } = players;
    await openGame(host, project, 'fidice');
    await openGame(guest, project, 'fidice');

    const code = await hostRoom(host, 'fidice', 'Host');
    await expect(fidiceSeats(host.page)).toHaveCount(1);
    await joinByCode(guest, 'fidice', code, 'Guest');

    // Both lobbies show the same two seats, each side marked as itself.
    await expect(fidiceSeats(host.page)).toHaveCount(2);
    await expect(fidiceSeatName(host.page, 0)).toContainText('Host');
    await expect(fidiceSeatName(host.page, 0)).toContainText('(you)');
    await expect(fidiceSeatName(host.page, 1)).toContainText('Guest');
    await expect(fidiceSeatName(guest.page, 0)).toContainText('Host');
    await expect(fidiceSeatName(guest.page, 1)).toContainText('Guest');
    await expect(fidiceSeatName(guest.page, 1)).toContainText('(you)');
    await expect(guest.page.locator('#startHint')).toContainText('Waiting for the host to start');
    await expect(guest.page.locator('#btnStart')).toHaveCount(0);

    const start = host.page.locator('#btnStart');
    await expect(start).toBeEnabled();
    await start.click();
    await expect(host.page.locator('#screen-game')).toBeVisible();
    await expect(guest.page.locator('#screen-game')).toBeVisible();
    await expect(fidiceRound(host.page)).toHaveText('Round 1');
    await expect(fidiceRound(guest.page)).toHaveText('Round 1');
    const holder = host.page.locator('#screen-game .seat.holder');
    await expect(holder).toHaveCount(1);
    const holderSeat = await holder.getAttribute('data-seat');
    await expect(guest.page.locator('#screen-game .seat.holder')).toHaveAttribute(
      'data-seat',
      holderSeat ?? '',
    );

    // PeerJS was constructed with the harness's broker and ICE configuration on both sides.
    const hostCall = (await host.peerCalls()).at(-1);
    const guestCall = (await guest.peerCalls()).at(-1);
    expect(hostCall?.id).toBe(`fidice-${code.toLowerCase()}`);
    expect(hostCall?.options).toEqual(expectedPeerOptions(1));
    expect(guestCall?.id).toBeNull();
    expect(guestCall?.options).toEqual(expectedPeerOptions(1));
  },
);
