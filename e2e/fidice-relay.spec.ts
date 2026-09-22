// The relay-forced Fidice table, the twin of e2e/gin-relay.spec.ts: host and guest open fidice with
// `?ice-policy=relay` and the ICE list naming the harness's TURN relay, the guest joins by code,
// both lobbies show the two seats, the guest toasts "Connected via relay", the selected candidate
// pair on both sides is a relay one, the host starts and both see the same round. Only the guest
// toasts: fidice's client transport probes the path PATH_PROBE_MS after its channel opens and
// shows the toast for TOAST_MS (web/games/fidice/src/net/peerjs.ts describePath), while the host
// side has no such probe, so the guest's #toast is the one to catch, and promptly.
import { fidiceRound, fidiceSeatName, fidiceSeats } from './fixtures/fidice.ts';
import { expectPeerOptions, openGame, type GameHooks } from './fixtures/player.ts';
import { RELAY_TOAST, expectRelayPath, skipWithoutRelay } from './fixtures/relay.ts';
import { expect, hostRoom, joinByCode, test } from './fixtures/two-players.ts';

const RELAY_GAME: GameHooks = { relay: true, ice: 'turn' };

test(
  'relay-forced: host and guest meet through TURN, the guest toasts the relay path, host starts, same round',
  { tag: ['@relay', '@online'] },
  async ({ players, project }) => {
    skipWithoutRelay();
    const { host, guest } = players;
    await openGame(host, project, 'fidice', RELAY_GAME);
    await openGame(guest, project, 'fidice', RELAY_GAME);

    const code = await hostRoom(host, 'fidice', 'Host');
    await joinByCode(guest, 'fidice', code, 'Guest');
    await expect(fidiceSeats(host.page)).toHaveCount(2);
    await expect(fidiceSeatName(host.page, 1)).toContainText('Guest');
    await expect(fidiceSeatName(guest.page, 0)).toContainText('Host');
    // Shown for TOAST_MS only, PATH_PROBE_MS after the channel opened: waited for at once.
    await expect(guest.page.locator('#toast')).toHaveText(RELAY_TOAST);
    await expectRelayPath(host.page, 'host');
    await expectRelayPath(guest.page, 'guest');

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

    // Both Peers were built with the forced policy and the TURN list.
    const hostCall = (await host.peerCalls()).at(-1);
    const guestCall = (await guest.peerCalls()).at(-1);
    expect(hostCall?.id).toBe(`fidice-${code.toLowerCase()}`);
    expectPeerOptions(hostCall, 1, RELAY_GAME);
    expect(guestCall?.id).toBeNull();
    expectPeerOptions(guestCall, 1, RELAY_GAME);
  },
);
