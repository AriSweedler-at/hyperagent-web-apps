// The relay-forced game on every game (docs/MIGRATION.md step 15, docs/ARCHITECTURE.md "CI"):
// host and guest open the page with `?ice-policy=relay` and an ICE list naming the harness's own
// TURN relay (coturn on PORTS.turn, started by playwright.config.ts), so every ICE candidate must go
// through that relay, and the game still joins, starts and toasts "Connected via relay" (both
// sides on every page: the row's `relayToasts` in e2e/fixtures/online-games.ts); the
// selected candidate pair, read off the RTCPeerConnection, says so too. Hermetic: it plays on every
// PR, and skips only where coturn is not installed (until issue #19 the relay was turn.sweedler.com
// and the nightly the one place this could run; now the nightly, E2E_TARGET=deployed, plays this
// same spec with the deployed page and this same local relay). The hook itself is also proven alone
// below, and in web/shared/edge/ice.test.ts and transport.test.ts: a page opened with it hands
// PeerJS `iceTransportPolicy: 'relay'` under the game's peer id, asserted the moment the room is
// registered, with no join attempted. Fidice's row replaced its own e2e/fidice-relay.spec.ts
// (dry-round-2.md H1) and drives its shell path since M5 of docs/design/fidice-shell-adoption.md.
// Tagged per game (see shell-home.spec.ts), @relay and @online.
import { REGISTRY, SHELL_GAMES } from '../tools/games.ts';
import { peerIdFor } from '../web/shared/lib/roomCode.ts';
import { SHELL_DRIVERS, connect } from './fixtures/online-games.ts';
import { expectPeerOptions, openGame, type GameHooks } from './fixtures/player.ts';
import { RELAY_TOAST, expectRelayPath, skipWithoutRelay } from './fixtures/relay.ts';
import { ONLINE_NAMES } from './fixtures/shell.ts';
import { expect, hostRoom, test } from './fixtures/two-players.ts';

const RELAY_GAME: GameHooks = { relay: true, ice: 'turn' };

SHELL_GAMES.forEach((game) => {
  test.describe(game, { tag: `@${game}` }, () => {
    const spec = REGISTRY[game];
    const driver = SHELL_DRIVERS[game];

    test(
      'relay-forced: host and guest connect through TURN, the relay path is toasted, both see the opening',
      { tag: ['@relay', '@online'] },
      async ({ players, project }) => {
        skipWithoutRelay();
        const { host, guest } = players;
        const code = await connect(players, project, game, RELAY_GAME);
        await Promise.all(
          driver.relayToasts.map((side) =>
            expect(players[side].page.locator('#toast')).toHaveText(RELAY_TOAST),
          ),
        );
        // The connection agrees with the toast: both ends of the selected pair are relay candidates.
        await expectRelayPath(host.page, 'host');
        await expectRelayPath(guest.page, 'guest');

        await driver.start(host.page, guest.page);
        await driver.expectOpening(host.page, guest.page);
        await driver.expectNames?.(host.page, guest.page);

        // Both Peers were built with the forced policy and the TURN list, under the game's peer id.
        const hostCall = (await host.peerCalls()).at(-1);
        const guestCall = (await guest.peerCalls()).at(-1);
        expect(hostCall?.id).toBe(peerIdFor(game, code));
        expectPeerOptions(hostCall, spec.debug, RELAY_GAME);
        expect(guestCall?.id).toBeNull();
        expectPeerOptions(guestCall, spec.debug, RELAY_GAME);
      },
    );

    test(
      'the ?ice-policy=relay hook reaches new Peer on a hosting page (hermetic: no join attempted)',
      { tag: '@relay' },
      async ({ player, project }) => {
        await openGame(player, project, game, { relay: true });
        // Registering on the broker is a WebSocket, untouched by the ICE policy, so the room opens.
        const code = await hostRoom(player, game, ONLINE_NAMES[0]);
        const call = (await player.peerCalls()).at(-1);
        expect(call?.id).toBe(peerIdFor(game, code));
        expectPeerOptions(call, spec.debug, { relay: true });
      },
    );
  });
});
