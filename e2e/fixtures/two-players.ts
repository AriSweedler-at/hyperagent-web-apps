// Two browser contexts, host and guest, in the same Playwright project (docs/ARCHITECTURE.md
// "Testing pyramid"): each with its own seeded Math.random, the Peer recorder and offline routes,
// both aimed at the local PeerServer with ?peer= and at the STUN-only ICE fixture with ?ice=. The
// `player` fixture is the single-context version for pass-and-play, the scorer and smoke.
// Teardown asserts zero uncaught exceptions on every page a spec opened.
import { test as base, expect, type Page } from '@playwright/test';

import type { Game } from '../../tools/games.ts';
import { fidiceHostLobby, fidiceJoin, fidiceLobbyCode } from './fidice.ts';
import { ginHostRoom, ginJoin, ginRoomCode } from './gin.ts';
import { newPlayer, type Player } from './player.ts';
import { asProject, type Project } from './site.ts';

export type Players = Readonly<{ host: Player; guest: Player }>;

export type OnlineGame = Game;

/** How one game's pages are driven through hosting and joining (e2e/fixtures/<g>.ts). */
type Driver = Readonly<{
  /** Host a room or table as `name`; resolves with the code shown in the host DOM. */
  hostRoom: (page: Page, name: string) => Promise<string>;
  /** The code the host DOM shows right now. */
  readRoomCode: (page: Page) => Promise<string>;
  /** Drive the guest through the join form; resolves once the guest is connected to the host. */
  joinByCode: (page: Page, name: string, code: string) => Promise<void>;
}>;

/** One driver per game: a game the registry knows without a driver is a type error here. */
const DRIVERS: Readonly<Record<OnlineGame, Driver>> = {
  'gin-rummy': { hostRoom: ginHostRoom, readRoomCode: ginRoomCode, joinByCode: ginJoin },
  fidice: { hostRoom: fidiceHostLobby, readRoomCode: fidiceLobbyCode, joinByCode: fidiceJoin },
  // Online play arrives with the backgammon online PR (PR-D); until then a spec that names it fails loudly.
  backgammon: {
    hostRoom: () => Promise.reject(new Error('backgammon online is not wired yet (PR-D)')),
    readRoomCode: () => Promise.reject(new Error('backgammon online is not wired yet (PR-D)')),
    joinByCode: () => Promise.reject(new Error('backgammon online is not wired yet (PR-D)')),
  },
};

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
  DRIVERS[game].hostRoom(player.page, name);

/** The code the host DOM shows right now. */
export const readRoomCode = (player: Player, game: OnlineGame): Promise<string> =>
  DRIVERS[game].readRoomCode(player.page);

/** Drive the guest through the join form; resolves once the guest is connected to the host. */
export const joinByCode = (
  player: Player,
  game: OnlineGame,
  code: string,
  name: string,
): Promise<void> => DRIVERS[game].joinByCode(player.page, name, code);
