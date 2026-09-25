// Two peers on every game through the local PeerServer (or 0.peerjs.com under E2E_BROKER=cloud):
// the host opens a room, the guest joins by the code read off the host's screen, the host sees the
// join and starts, both tables show the same opening (gin's deal: the same upcard, ten cards each,
// 31 in the stock, hand 1; backgammon's seeded opening roll, the host seat 0 and the guest seat 1;
// fidice's round 1 with the cup at the same seat) with the names crossed over, and the recorded
// Peer constructions prove the ?peer= broker override and the ?ice= configuration reached PeerJS
// under the game's own peer id (web/shared/lib/roomCode.ts `peerIdFor`). The play that follows is
// each game's own: e2e/gin-online.spec.ts (a draw and a discard over the wire, the discards sheet)
// and e2e/backgammon-online.spec.ts (a roll out of turn refused, the guest's roll rolled by the
// host, a move propagating). Both origins: a spec about the origin. Tagged per game (see
// shell-home.spec.ts) and @online (ci.yml's broker job and the nightly grep for it). Fidice's row
// in e2e/fixtures/online-games.ts replaced its own e2e/fidice-online.spec.ts (dry-round-2.md H1).
import { GAMES, REGISTRY, SHELL_GAMES } from '../tools/games.ts';
import { peerIdFor } from '../web/shared/lib/roomCode.ts';
import { ONLINE_DRIVERS, SHELL_DRIVERS, connect, connectByLink } from './fixtures/online-games.ts';
import { expectPeerOptions } from './fixtures/player.ts';
import { expect, test } from './fixtures/two-players.ts';

GAMES.forEach((game) => {
  test.describe(game, { tag: `@${game}` }, () => {
    const spec = REGISTRY[game];
    const driver = ONLINE_DRIVERS[game];

    test(
      'host opens a room, guest joins by code, the host starts, both see the opening, the Peers carry the harness hooks',
      { tag: '@online' },
      async ({ players, project }) => {
        const { host, guest } = players;
        const code = await connect(players, project, game);
        await driver.start(host.page, guest.page);
        await driver.expectOpening(host.page, guest.page);
        await driver.expectNames?.(host.page, guest.page);

        // PeerJS was constructed with the harness's broker and ICE configuration on both sides.
        const hostCall = (await host.peerCalls()).at(-1);
        const guestCall = (await guest.peerCalls()).at(-1);
        expect(hostCall?.id).toBe(peerIdFor(game, code));
        expectPeerOptions(hostCall, spec.debug);
        expect(guestCall?.id).toBeNull();
        expectPeerOptions(guestCall, spec.debug);
      },
    );
  });
});

// The shell games' invite (the owner, 2026-09-25: "when you visit a '?join=TNJQ' link, it
// shouldn't make you THEN click 'sit down'"): the guest, its name remembered from an earlier visit,
// follows the link and is sat down at once, no tap; the host sees the join and starts, and both
// tables show the opening with the names crossed over as when the code was typed.
SHELL_GAMES.forEach((game) => {
  test.describe(game, { tag: `@${game}` }, () => {
    const driver = SHELL_DRIVERS[game];

    test(
      'the guest follows the invite link: seated at once under the remembered name, no tap; the host starts, both see the opening',
      { tag: '@online' },
      async ({ players, project }) => {
        const { host, guest } = players;
        await connectByLink(players, project, game);
        await driver.start(host.page, guest.page);
        await driver.expectOpening(host.page, guest.page);
        await driver.expectNames?.(host.page, guest.page);
      },
    );
  });
});
