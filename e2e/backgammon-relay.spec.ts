// The relay-forced Sheshbesh game (gin's e2e/gin-relay.spec.ts for the third game): host and guest
// open the page with `?ice-policy=relay` and an ICE list naming the harness's own TURN relay
// (coturn on PORTS.turn, started by playwright.config.ts), so every ICE candidate must go through
// that relay, and the table still joins, starts and toasts "Connected via relay" on both sides;
// the selected candidate pair, read off the RTCPeerConnection, says so too. Hermetic: it plays on
// every PR and skips only where coturn is not installed. The hook itself is also proven alone: a
// page opened with it hands PeerJS `iceTransportPolicy: 'relay'` under the `sheshbesh-` peer id,
// asserted the moment the room is registered, with no join attempted.
import { bgBoardsAgree, bgHostStarts } from './fixtures/backgammon.ts';
import { expectPeerOptions, openGame, type GameHooks } from './fixtures/player.ts';
import { RELAY_TOAST, expectRelayPath, skipWithoutRelay } from './fixtures/relay.ts';
import { expect, hostRoom, joinByCode, test } from './fixtures/two-players.ts';

const RELAY_GAME: GameHooks = { relay: true, ice: 'turn' };

test(
  'relay-forced: host and guest connect through TURN, both toast the relay path, both see the opening',
  { tag: ['@relay', '@online'] },
  async ({ players, project }) => {
    skipWithoutRelay();
    const { host, guest } = players;
    await openGame(host, project, 'backgammon', RELAY_GAME);
    await openGame(guest, project, 'backgammon', RELAY_GAME);

    const code = await hostRoom(host, 'backgammon', 'Host');
    await joinByCode(guest, 'backgammon', code, 'Guest');
    // #toast keeps its text after the `show` class drops, so the assertion cannot miss the window.
    await expect(host.page.locator('#toast')).toHaveText(RELAY_TOAST);
    await expect(guest.page.locator('#toast')).toHaveText(RELAY_TOAST);
    // The connection agrees with the toast: both ends of the selected pair are relay candidates.
    await expectRelayPath(host.page, 'host');
    await expectRelayPath(guest.page, 'guest');

    await bgHostStarts(host.page, guest.page);
    const opening = await bgBoardsAgree(host.page, guest.page);
    expect(opening).toMatchObject({ gameNo: 1, phase: 'toRoll' });
    await expect(host.page.locator('#oppName')).toHaveText('Guest');
    await expect(guest.page.locator('#oppName')).toHaveText('Host');

    // Both Peers were built with the forced policy and the TURN list.
    expectPeerOptions((await host.peerCalls()).at(-1), 0, RELAY_GAME);
    expectPeerOptions((await guest.peerCalls()).at(-1), 0, RELAY_GAME);
  },
);

test(
  'the ?ice-policy=relay hook reaches new Peer on a hosting page (hermetic: no join attempted)',
  { tag: '@relay' },
  async ({ player, project }) => {
    await openGame(player, project, 'backgammon', { relay: true });
    // Registering on the broker is a WebSocket, untouched by the ICE policy, so the room opens.
    const code = await hostRoom(player, 'backgammon', 'Host');
    const call = (await player.peerCalls()).at(-1);
    expect(call?.id).toBe(`sheshbesh-${code}`);
    expectPeerOptions(call, 0, { relay: true });
  },
);
