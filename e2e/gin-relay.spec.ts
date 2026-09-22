// The relay-forced game (docs/MIGRATION.md step 15, docs/ARCHITECTURE.md "CI"): host and guest
// open gin with `?ice-policy=relay` and an ICE list naming the harness's own TURN relay (coturn on
// PORTS.turn, started by playwright.config.ts), so every ICE candidate must go through that relay,
// and the game still joins, deals and toasts "Connected via relay" on both sides; the selected
// candidate pair, read off the RTCPeerConnection, says so too. Hermetic: it plays on every PR, and
// skips only where coturn is not installed (the nightly, E2E_TARGET=live, was the one place it
// could run when the credentials had to come from turn.sweedler.com, issue #19; live, the same
// spec still plays through that relay). The hook itself is also proven alone below, and in
// web/shared/edge/ice.test.ts and transport.test.ts: a page opened with it hands PeerJS
// `iceTransportPolicy: 'relay'`, asserted the moment the room is registered, with no join attempted.
import { ginHostDeals, readTable } from './fixtures/gin.ts';
import { expectPeerOptions, openGame, type GameHooks } from './fixtures/player.ts';
import { RELAY_TOAST, expectRelayPath, skipWithoutRelay } from './fixtures/relay.ts';
import { expect, hostRoom, joinByCode, test } from './fixtures/two-players.ts';

const RELAY_GAME: GameHooks = { relay: true, ice: 'turn' };

test(
  'relay-forced: host and guest connect through TURN, both toast the relay path, both see the deal',
  { tag: ['@relay', '@online'] },
  async ({ players, project }) => {
    skipWithoutRelay();
    const { host, guest } = players;
    await openGame(host, project, 'gin-rummy', RELAY_GAME);
    await openGame(guest, project, 'gin-rummy', RELAY_GAME);

    const code = await hostRoom(host, 'gin-rummy', 'Host');
    await joinByCode(guest, 'gin-rummy', code, 'Guest');
    // #toast keeps its text after the `show` class drops, so the assertion cannot miss the window.
    await expect(host.page.locator('#toast')).toHaveText(RELAY_TOAST);
    await expect(guest.page.locator('#toast')).toHaveText(RELAY_TOAST);
    // The connection agrees with the toast: both ends of the selected pair are relay candidates.
    await expectRelayPath(host.page, 'host');
    await expectRelayPath(guest.page, 'guest');

    await ginHostDeals(host.page, guest.page);
    const [hostTable, guestTable] = await Promise.all([
      readTable(host.page),
      readTable(guest.page),
    ]);
    expect(hostTable.discardTop).toMatch(/^\w+$/);
    expect(guestTable.discardTop).toBe(hostTable.discardTop);
    expect(hostTable).toMatchObject({ handSize: 10, oppCount: '10' });
    expect(guestTable).toMatchObject({ handSize: 10, oppCount: '10' });

    // Both Peers were built with the forced policy and the TURN list (live, turn.sweedler.com's).
    expectPeerOptions((await host.peerCalls()).at(-1), 0, RELAY_GAME);
    expectPeerOptions((await guest.peerCalls()).at(-1), 0, RELAY_GAME);
  },
);

test(
  'the ?ice-policy=relay hook reaches new Peer on a hosting page (hermetic: no join attempted)',
  { tag: '@relay' },
  async ({ player, project }) => {
    await openGame(player, project, 'gin-rummy', { relay: true });
    // Registering on the broker is a WebSocket, untouched by the ICE policy, so the room opens.
    const code = await hostRoom(player, 'gin-rummy', 'Host');
    const call = (await player.peerCalls()).at(-1);
    expect(call?.id).toBe(`ginrummy-ari-${code}`);
    expectPeerOptions(call, 0, { relay: true });
  },
);
