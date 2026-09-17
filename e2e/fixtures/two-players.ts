// Two browser contexts, host and guest, in the same Playwright project (docs/ARCHITECTURE.md
// "Testing pyramid"): each with its own seeded Math.random, the Peer recorder and offline routes,
// both aimed at the local PeerServer with ?peer= and at the STUN-only ICE fixture with ?ice=. The
// `player` fixture is the single-context version for pass-and-play, the scorer and smoke.
// Teardown asserts zero uncaught exceptions on every page a spec opened.
import { test as base, expect } from '@playwright/test';

import { fidiceHostLobby, fidiceJoin, fidiceLobbyCode } from './fidice.ts';
import { ginHostRoom, ginJoin, ginRoomCode } from './gin.ts';
import { newPlayer, type Player } from './player.ts';
import { asProject, type Project } from './site.ts';

export type Players = Readonly<{ host: Player; guest: Player }>;

export type OnlineGame = 'gin-rummy' | 'fidice';

type Fixtures = { project: Project; player: Player; players: Players };

export const test = base.extend<Fixtures>({
  project: async ({}, use, testInfo) => {
    await use(asProject(testInfo.project.name));
  },
  player: async ({ browser }, use, testInfo) => {
    const player = await newPlayer(browser, 'solo', testInfo);
    await use(player);
    await player.context.close();
    expect(player.watched.errors(), 'uncaught exceptions').toEqual([]);
  },
  players: async ({ browser }, use, testInfo) => {
    const host = await newPlayer(browser, 'host', testInfo);
    const guest = await newPlayer(browser, 'guest', testInfo);
    await use({ host, guest });
    await Promise.all([host.context.close(), guest.context.close()]);
    expect(host.watched.errors(), 'host uncaught exceptions').toEqual([]);
    expect(guest.watched.errors(), 'guest uncaught exceptions').toEqual([]);
  },
});

export { expect };

/** Host a room or table as `name`; resolves with the code shown in the host DOM. */
export const hostRoom = (player: Player, game: OnlineGame, name: string): Promise<string> =>
  game === 'gin-rummy' ? ginHostRoom(player.page, name) : fidiceHostLobby(player.page, name);

/** The code the host DOM shows right now. */
export const readRoomCode = (player: Player, game: OnlineGame): Promise<string> =>
  game === 'gin-rummy' ? ginRoomCode(player.page) : fidiceLobbyCode(player.page);

/** Drive the guest through the join form; resolves once the guest is connected to the host. */
export const joinByCode = (
  player: Player,
  game: OnlineGame,
  code: string,
  name: string,
): Promise<void> =>
  game === 'gin-rummy' ? ginJoin(player.page, name, code) : fidiceJoin(player.page, name, code);
