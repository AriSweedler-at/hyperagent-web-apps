// One row per game for the online specs (e2e/shell-online.spec.ts and shell-relay.spec.ts loop
// over every game, fidice included: dry-round-2.md H1) and the table half of each shell game for
// the other e2e/shell-*.spec.ts (docs/design/shared-shell.md §6.3, the `afterConnect` of §6.1):
// what a spec must ask the game itself once the connection has done its part, over the game's own
// fixtures (e2e/fixtures/gin.ts, backgammon.ts, fidice.ts). A game without a row is a type error
// here. Its own file because those fixtures import e2e/fixtures/shell.ts (import-x/no-cycle). The
// connection itself is here too: what every online spec opens with before it asks the game anything.
import { expect, type Page } from '@playwright/test';

import type { Game, ShellGame } from '../../tools/games.ts';
import { bgBoardsAgree, bgHostStarts, boardKey, readBoard, requireBoard } from './backgammon.ts';
import { fidiceHostStarts, fidiceSameRound, fidiceSeatName, fidiceSeats } from './fidice.ts';
import { ginHostDeals, ginPassUpcard, readTable } from './gin.ts';
import { openGame, type GameHooks } from './player.ts';
import { ONLINE_NAMES, joinedMsg, reveal, roomOpen, takeOffer } from './shell.ts';
import type { Project } from './site.ts';
import { hostRoom, joinByCode, type Players } from './two-players.ts';

/** What the online specs ask of any game once host and guest have opened their pages. */
export type OnlineDriver = Readonly<{
  /**
   * The host has seen the join (`connect` ends here): the shell's `#hostWaitStatus`; fidice's two
   * lobbies showing the same two seats, each side marked as itself, the guest told to wait.
   */
  joined: (host: Page, guest: Page) => Promise<void>;
  /** The host starts from the waiting room; both tables come up. */
  start: (host: Page, guest: Page) => Promise<void>;
  /** The opening both tables must show right after `start`: the deal, or the seeded opening roll, or round 1 with the cup at one seat. */
  expectOpening: (host: Page, guest: Page) => Promise<void>;
  /** The names once the table is up: the shell's `#oppName` crossed over. Fidice's seats carried theirs in the lobby (`joined`). */
  expectNames?: (host: Page, guest: Page) => Promise<void>;
  /**
   * Who toasts "Connected via relay" (e2e/fixtures/relay.ts RELAY_TOAST) on a relay-forced game:
   * both shell pages (web/shared/edge/peer.ts PATH_RELAY_MSG); fidice's guest alone.
   */
  relayToasts: ReadonlyArray<'host' | 'guest'>;
}>;

/** A shell game's row: the online half and what the other shell specs ask of its table. */
export type ShellDriver = OnlineDriver &
  Readonly<{
    /** The curtain's sub line for the seat taking the phone (`first`) while the other looks away. */
    curtainSub: (first: string, other: string) => string;
    /** The table as one page shows it, as one comparable string. */
    snapshot: (page: Page) => Promise<string>;
    /** Both tables agree (the guest's frame arrives a beat later); resolves with the host's snapshot. */
    agree: (host: Page, guest: Page) => Promise<string>;
    /** What the host's save carries beyond the shell's `role`, `code`, `myName` and `oppName`. */
    hostSave: Readonly<Record<string, unknown>>;
    /** What the pass-and-play save carries beyond `role: 'local'` once the first seat has revealed. */
    localSave: Readonly<Record<string, unknown>>;
    /** Something of the game itself a seated page shows: the hand's cards, the board (e2e/shell-liveness.spec.ts). */
    table: string;
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

/** The shell's own online half, the same for both shell games (their shell copy is byte-identical). */
const shellOnline: Pick<OnlineDriver, 'joined' | 'expectNames' | 'relayToasts'> = {
  joined: async (host) => {
    await expect(host.locator('#hostWaitStatus')).toContainText(joinedMsg(ONLINE_NAMES[1]));
  },
  expectNames: async (host, guest) => {
    await expect(host.locator('#oppName')).toHaveText(ONLINE_NAMES[1]);
    await expect(guest.locator('#oppName')).toHaveText(ONLINE_NAMES[0]);
  },
  // #toast keeps its text after the `show` class drops, so the assertion cannot miss the window.
  relayToasts: ['host', 'guest'],
};

/** The deal both gin tables show: ten cards each, 31 in the stock, hand 1. */
const GIN_DEALT = {
  handSize: 10,
  oppCount: '10',
  stockLabel: 'Stock · 31',
  hand: 'Hand 1',
} as const;

const ginSnapshot = async (page: Page): Promise<string> => JSON.stringify(await readTable(page));

const gin: ShellDriver = {
  ...shellOnline,
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
  table: '#hand .card',
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
  ...shellOnline,
  curtainSub: () => 'Your turn. Roll when you have the phone.',
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
  // The reveal only reveals (the roll is the modal's, design §4.7), so the saved game is at the roll.
  localSave: { game: { gameNo: 1, phase: 'toRoll' } },
  table: '#board',
  curtainOffer: {
    title:
      "the curtain's Continue online takes the offer too, with the phone about to change hands",
    // The opening winner's curtain is up as the game starts: it offers the reveal and the handoff.
    toCurtain: () => Promise.resolve(),
    take: async (page) => {
      await page.locator('#curtainHandoffBtn').click();
      return roomOpen(page, 'backgammon');
    },
  },
};

/** Fidice's legacy lobby and table (e2e/fixtures/fidice.ts), until its restyle brings the shell (shared-shell.md §4.6). */
const fidice: OnlineDriver = {
  joined: async (host, guest) => {
    // Both lobbies show the same two seats, each side marked as itself.
    await expect(fidiceSeats(host)).toHaveCount(2);
    await expect(fidiceSeatName(host, 0)).toContainText(ONLINE_NAMES[0]);
    await expect(fidiceSeatName(host, 0)).toContainText('(you)');
    await expect(fidiceSeatName(host, 1)).toContainText(ONLINE_NAMES[1]);
    await expect(fidiceSeatName(guest, 0)).toContainText(ONLINE_NAMES[0]);
    await expect(fidiceSeatName(guest, 1)).toContainText(ONLINE_NAMES[1]);
    await expect(fidiceSeatName(guest, 1)).toContainText('(you)');
    await expect(guest.locator('#startHint')).toContainText('Waiting for the host to start');
    await expect(guest.locator('#btnStart')).toHaveCount(0);
  },
  start: fidiceHostStarts,
  expectOpening: fidiceSameRound,
  // Only the guest toasts: fidice's client transport probes the path PATH_PROBE_MS after its
  // channel opens and shows the toast for TOAST_MS (web/games/fidice/src/net/peerjs.ts
  // describePath), while the host side has no such probe, so the guest's #toast is the one to
  // catch, and promptly: it empties again when the toast clears.
  relayToasts: ['guest'],
};

export const SHELL_DRIVERS: Readonly<Record<ShellGame, ShellDriver>> = {
  'gin-rummy': gin,
  backgammon,
};

/** Every game's online row: the shell games' drivers and fidice's. */
export const ONLINE_DRIVERS: Readonly<Record<Game, OnlineDriver>> = {
  ...SHELL_DRIVERS,
  fidice,
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
  game: Game,
  hooks: GameHooks = {},
): Promise<string> => {
  const { host, guest } = players;
  await openGame(host, project, game, hooks);
  await openGame(guest, project, game, hooks);
  const code = await hostRoom(host, game, ONLINE_NAMES[0]);
  await joinByCode(guest, game, code, ONLINE_NAMES[1]);
  await ONLINE_DRIVERS[game].joined(host.page, guest.page);
  return code;
};
