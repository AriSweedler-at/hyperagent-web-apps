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
// shell-home.spec.ts) and @online (nightly.yml's grep, for its deployed and broker jobs). Fidice's
// row in e2e/fixtures/online-games.ts replaced its own e2e/fidice-online.spec.ts (dry-round-2.md
// H1). The last block is the guest's name (the owner, 2026-09-28: the client defines its own):
// what the guest's box shows is what both tables seat, an empty box or a fresh invite link seats
// 'Guest', a clash with the host is deduped once, and the guest wait screen says who you are
// before the table does (backgammon and briscola; gin's page carries no such card), where the
// name can be changed before the deal: the host's status and both tables follow.
import type { Page } from '@playwright/test';

import { GAMES, REGISTRY, SHELL_GAMES } from '../tools/games.ts';
import { peerIdFor } from '../web/shared/lib/roomCode.ts';
import { ONLINE_DRIVERS, SHELL_DRIVERS, connect, connectByLink } from './fixtures/online-games.ts';
import { expectPeerOptions, invitePath, openGame } from './fixtures/player.ts';
import {
  DEFAULT_MARK,
  DEFAULT_NAME,
  followInvite,
  hostRoom,
  hostSeesMsg,
  join,
  joinUntouched,
  joinedMsg,
  readPref,
  rememberName,
  rememberP2Name,
  rename,
} from './fixtures/shell.ts';
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

// The guest's name is the guest's (C11). The host is Ann throughout, so the prefill 'Ari' is a
// name of its own and the clash row is unambiguous.
const HOST = 'Ann';

SHELL_GAMES.forEach((game) => {
  test.describe(game, { tag: `@${game}` }, () => {
    const driver = SHELL_DRIVERS[game];
    const cells = driver.seatNames;

    /** Both tables up: the host's `#oppName` and the guest's own cell both read the guest's seated name; the guest's `#oppName` the host's. */
    const expectSeated = async (host: Page, guest: Page, guestName: string): Promise<void> => {
      await expect(host.locator('#oppName')).toHaveText(guestName);
      await expect(guest.locator('#oppName')).toHaveText(HOST);
      await expect(guest.locator(cells.me)).toHaveText(cells.meText(guestName));
    };
    /** The guest wait screen's name card, on the pages that carry one: shown, its box holding the seated name, its note naming the host. */
    const expectTold = async (guest: Page, name: string): Promise<void> => {
      if (cells.seated === null) return;
      await expect(guest.locator(cells.seated)).toBeVisible();
      await expect(guest.locator('#guestNameInput')).toHaveValue(name);
      await expect(guest.locator('#guestNameNote')).toHaveText(hostSeesMsg(HOST));
    };

    test(
      'the guest is the name it typed, on the wait screens and both tables: not the host`s remembered second seat, not a wire default',
      { tag: '@online' },
      async ({ players, project }) => {
        const { host, guest } = players;
        await openGame(host, project, game);
        await openGame(guest, project, game);
        // The host device remembers its own name and its usual pass-and-play opponent.
        await rememberName(host.page, game, HOST);
        await rememberP2Name(host.page, game, 'Ethan');
        await host.page.reload();
        await expect(host.page.locator('#p2NameInput')).toHaveValue('Ethan');
        const code = await hostRoom(host.page, game, HOST);
        await join(guest.page, game, 'Xyz', code);
        await expect(host.page.locator('#hostWaitStatus')).toContainText(joinedMsg('Xyz'));
        await expectTold(guest.page, 'Xyz');
        await driver.start(host.page, guest.page);
        await expectSeated(host.page, guest.page, 'Xyz');
      },
    );

    test(
      'the prefill left alone joins as itself (the box`s text is the name), and the guest is told before the table',
      { tag: '@online' },
      async ({ players, project }) => {
        const { host, guest } = players;
        await openGame(host, project, game);
        await openGame(guest, project, game);
        const code = await hostRoom(host.page, game, HOST);
        // Fresh storage: the box shows the game's first default, marked as the prefill nobody touched.
        await expect(guest.page.locator('#nameInput')).toHaveValue(DEFAULT_NAME);
        await expect(guest.page.locator('#nameInput')).toHaveAttribute(DEFAULT_MARK, '1');
        await joinUntouched(guest.page, game, code);
        await expectTold(guest.page, DEFAULT_NAME);
        await expect(host.page.locator('#hostWaitStatus')).toContainText(joinedMsg(DEFAULT_NAME));
        await driver.start(host.page, guest.page);
        await expectSeated(host.page, guest.page, DEFAULT_NAME);
      },
    );

    test(
      'a fresh guest by invite link, nothing typed and nothing remembered, joins as Guest and is told; never the local default',
      { tag: '@online' },
      async ({ players, project }) => {
        const { host, guest } = players;
        await openGame(host, project, game);
        await openGame(guest, project, game);
        const code = await hostRoom(host.page, game, HOST);
        await followInvite(guest.page, game, invitePath(project, game, code));
        await expectTold(guest.page, 'Guest');
        await expect(host.page.locator('#hostWaitStatus')).toContainText(joinedMsg('Guest'));
        await driver.start(host.page, guest.page);
        await expectSeated(host.page, guest.page, 'Guest');
      },
    );

    test(
      'the guest changes its name on the wait screen: a link-joined Guest types Xyz and taps Change; the host`s status reads Xyz joined!, the card and both tables seat Xyz, and the name is remembered',
      { tag: '@online' },
      async ({ players, project }) => {
        test.skip(
          cells.seated === null,
          'the page carries no name card (gin: its DOM parity oracle)',
        );
        const { host, guest } = players;
        await openGame(host, project, game);
        await openGame(guest, project, game);
        const code = await hostRoom(host.page, game, HOST);
        await followInvite(guest.page, game, invitePath(project, game, code));
        await expectTold(guest.page, 'Guest');
        await expect(host.page.locator('#hostWaitStatus')).toContainText(joinedMsg('Guest'));
        await rename(guest.page, 'Xyz');
        await expect(host.page.locator('#hostWaitStatus')).toContainText(joinedMsg('Xyz'));
        await expectTold(guest.page, 'Xyz');
        // Remembered as a name typed on the home screen is: the next visit joins under it.
        expect(await readPref(guest.page, game, 'name')).toBe('Xyz');
        await driver.start(host.page, guest.page);
        await expectSeated(host.page, guest.page, 'Xyz');
      },
    );

    test(
      'a guest named like the host is seated once removed, and told: Ann 2 on the wait screen and on both tables',
      { tag: '@online' },
      async ({ players, project }) => {
        const { host, guest } = players;
        await openGame(host, project, game);
        await openGame(guest, project, game);
        const code = await hostRoom(host.page, game, HOST);
        await join(guest.page, game, HOST, code);
        await expectTold(guest.page, `${HOST} 2`);
        await expect(host.page.locator('#hostWaitStatus')).toContainText(joinedMsg(`${HOST} 2`));
        await driver.start(host.page, guest.page);
        await expectSeated(host.page, guest.page, `${HOST} 2`);
      },
    );
  });
});
