// The table half of each shell game for e2e/shell-*.spec.ts (docs/design/shared-shell.md §6.3, the
// `afterConnect` of §6.1): what a shell spec must ask the game itself once the shell has done its
// part, one row per SHELL_GAMES entry, over the game's own fixtures (e2e/fixtures/gin.ts,
// backgammon.ts). A shell game without a row is a type error here. Its own file because those
// fixtures import e2e/fixtures/shell.ts (import-x/no-cycle). The connection itself is here too:
// what every online shell spec opens with before it asks the game anything.
import { expect, type Page } from '@playwright/test';

import type { ShellGame } from '../../tools/games.ts';
import { bgBoardsAgree, bgHostStarts, boardKey, readBoard, requireBoard } from './backgammon.ts';
import { ginHostDeals, ginPassUpcard, readTable } from './gin.ts';
import { openGame, type GameHooks } from './player.ts';
import { ONLINE_NAMES, hostRoom, join, joinedMsg, reveal, roomOpen, takeOffer } from './shell.ts';
import type { Project } from './site.ts';
import type { Players } from './two-players.ts';

export type ShellDriver = Readonly<{
  /** The curtain's sub line for the seat taking the phone (`first`) while the other looks away. */
  curtainSub: (first: string, other: string) => string;
  /** The host starts from the waiting room; both tables come up. */
  start: (host: Page, guest: Page) => Promise<void>;
  /** The table as one page shows it, as one comparable string. */
  snapshot: (page: Page) => Promise<string>;
  /** Both tables agree (the guest's frame arrives a beat later); resolves with the host's snapshot. */
  agree: (host: Page, guest: Page) => Promise<string>;
  /** The opening both tables must show right after `start`: the deal, or the seeded opening roll. */
  expectOpening: (host: Page, guest: Page) => Promise<void>;
  /** What the host's save carries beyond the shell's `role`, `code`, `myName` and `oppName`. */
  hostSave: Readonly<Record<string, unknown>>;
  /** What the pass-and-play save carries beyond `role: 'local'` once the first seat has revealed. */
  localSave: Readonly<Record<string, unknown>>;
  /** The handoff offered while a curtain is up (e2e/shell-handoff.spec.ts, the case under the curtain). */
  curtainOffer: Readonly<{
    /** The case, as its test is titled. */
    title: string;
    /** From the first curtain of a fresh game to the curtain the case is about. */
    toCurtain: (page: Page) => Promise<void>;
    /** Take the offer from under that curtain; resolves with the room's confirmed code. */
    take: (page: Page) => Promise<string>;
  }>;
}>;

/** The deal both gin tables show: ten cards each, 31 in the stock, hand 1. */
const GIN_DEALT = {
  handSize: 10,
  oppCount: '10',
  stockLabel: 'Stock · 31',
  hand: 'Hand 1',
} as const;

const ginSnapshot = async (page: Page): Promise<string> => JSON.stringify(await readTable(page));

const gin: ShellDriver = {
  curtainSub: (_first, other) => `${other}, look away`,
  start: ginHostDeals,
  snapshot: ginSnapshot,
  agree: async (host, guest) => {
    const table = await ginSnapshot(host);
    await expect.poll(() => ginSnapshot(guest)).toBe(table);
    return table;
  },
  expectOpening: async (host, guest) => {
    // Both tables agree on the deal: same upcard, ten cards each, 31 in the stock, hand 1.
    const [hostTable, guestTable] = await Promise.all([readTable(host), readTable(guest)]);
    expect(hostTable.discardTop).toMatch(/^\w+$/);
    expect(guestTable.discardTop).toBe(hostTable.discardTop);
    expect(hostTable).toMatchObject(GIN_DEALT);
    expect(guestTable).toMatchObject(GIN_DEALT);
  },
  hostSave: { game: { handNumber: 1 } },
  localSave: { game: { handNumber: 1 } },
  curtainOffer: {
    title:
      "the offer is the table's alone: the curtain carries none; after a pass the next seat reveals and takes it, the curtain marks cleared",
    // The first mover passes; the phone goes to the other seat under the curtain.
    toCurtain: async (page) => {
      await reveal(page);
      await ginPassUpcard(page);
    },
    take: async (page) => {
      await reveal(page);
      return takeOffer(page, 'gin-rummy');
    },
  },
};

const bgSnapshot = async (page: Page): Promise<string> => boardKey(await readBoard(page));

const backgammon: ShellDriver = {
  curtainSub: () => 'Your turn.',
  start: bgHostStarts,
  snapshot: bgSnapshot,
  agree: async (host, guest) => boardKey(await bgBoardsAgree(host, guest)),
  expectOpening: async (host, guest) => {
    // Both boards agree on the opening: the host is seat 0 and the guest seat 1, the opening roll
    // resolved and the winner to roll.
    const opening = await bgBoardsAgree(host, guest);
    expect(opening).toMatchObject({ gameNo: 1, phase: 'toRoll', me: { idx: 0 } });
    expect(await requireBoard(guest)).toMatchObject({ me: { idx: 1 }, turn: opening.turn });
    await expect(host.locator('#gameBadge')).toHaveText('Game 1 · 0–0 · to 5');
    await expect(guest.locator('#gameBadge')).toHaveText('Game 1 · 0–0 · to 5');
  },
  hostSave: { matchLength: 5, variant: 'portes', game: { gameNo: 1 } },
  // The reveal rolls for the opening winner, so the saved game is mid-turn.
  localSave: { game: { gameNo: 1, phase: 'moving' } },
  curtainOffer: {
    title:
      "the curtain's Continue online takes the offer too, with the phone about to change hands",
    // The opening winner's curtain is up as the game starts: it offers the roll and the handoff.
    toCurtain: () => Promise.resolve(),
    take: async (page) => {
      await page.locator('#curtainHandoffBtn').click();
      return roomOpen(page, 'backgammon');
    },
  },
};

export const SHELL_DRIVERS: Readonly<Record<ShellGame, ShellDriver>> = {
  'gin-rummy': gin,
  backgammon,
};

/**
 * Host and guest open the game's page with the harness hooks, the host opens a room, the guest
 * joins by the code read off the host's screen and the host sees the join. Resolves with the code,
 * the host still in its waiting room: the spec starts the game when it has asked what it wants of
 * the connection (the relay toast, the candidate pair).
 */
export const connect = async (
  players: Players,
  project: Project,
  game: ShellGame,
  hooks: GameHooks = {},
): Promise<string> => {
  const { host, guest } = players;
  await openGame(host, project, game, hooks);
  await openGame(guest, project, game, hooks);
  const code = await hostRoom(host.page, game, ONLINE_NAMES[0]);
  await join(guest.page, game, ONLINE_NAMES[1], code);
  await expect(host.page.locator('#hostWaitStatus')).toContainText(joinedMsg(ONLINE_NAMES[1]));
  return code;
};
