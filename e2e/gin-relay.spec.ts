// The relay-forced game (docs/MIGRATION.md step 15, docs/ARCHITECTURE.md "CI"): host and guest
// open gin with `?ice-policy=relay`, so every ICE candidate must go through TURN, and the game
// still joins, deals and toasts "Connected via relay" on both sides. That needs real TURN
// credentials, which only the deployed pages have (they fetch turn.sweedler.com): the local harness
// serves a STUN-only fixture, so a relay-forced pair can never connect there and the game runs
// only under E2E_TARGET=live (the nightly). The hook itself is proven hermetically below, and in
// web/shared/edge/ice.test.ts and transport.test.ts: a page opened with the hook hands PeerJS
// `iceTransportPolicy: 'relay'`, which is asserted the moment the room is registered, with no join
// attempted, so the check stays well under the broker timeout on every project.
import { ginHostDeals, readTable } from './fixtures/gin.ts';
import { expectPeerOptions, openGame } from './fixtures/player.ts';
import { isLive } from './fixtures/site.ts';
import { expect, hostRoom, joinByCode, test } from './fixtures/two-players.ts';

/** Gin's PATH_RELAY_MSG (src/net/peerjs.ts), written to #toast PATH_TOAST_MS after the channel opens. */
const RELAY_TOAST = 'Connected via relay';

test(
  'relay-forced: host and guest connect through TURN, both toast the relay path, both see the deal',
  { tag: ['@relay', '@online'] },
  async ({ players, project }) => {
    test.skip(
      !isLive(),
      'a relay-forced pair needs a TURN server: the local harness has only the STUN-only fixture (run with E2E_TARGET=live)',
    );
    const { host, guest } = players;
    await openGame(host, project, 'gin-rummy', { relay: true });
    await openGame(guest, project, 'gin-rummy', { relay: true });

    const code = await hostRoom(host, 'gin-rummy', 'Host');
    await joinByCode(guest, 'gin-rummy', code, 'Guest');
    // #toast keeps its text after the `show` class drops, so the assertion cannot miss the window.
    await expect(host.page.locator('#toast')).toHaveText(RELAY_TOAST);
    await expect(guest.page.locator('#toast')).toHaveText(RELAY_TOAST);

    await ginHostDeals(host.page, guest.page);
    const [hostTable, guestTable] = await Promise.all([
      readTable(host.page),
      readTable(guest.page),
    ]);
    expect(hostTable.discardTop).toMatch(/^\w+$/);
    expect(guestTable.discardTop).toBe(hostTable.discardTop);
    expect(hostTable).toMatchObject({ handSize: 10, oppCount: '10' });
    expect(guestTable).toMatchObject({ handSize: 10, oppCount: '10' });

    // Both Peers were built with the forced policy (and, live, turn.sweedler.com's servers).
    expectPeerOptions((await host.peerCalls()).at(-1), 0, { relay: true });
    expectPeerOptions((await guest.peerCalls()).at(-1), 0, { relay: true });
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
