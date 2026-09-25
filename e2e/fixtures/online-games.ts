// One row per game for the online specs (e2e/shell-online.spec.ts and shell-relay.spec.ts loop
// over every game, fidice included: dry-round-2.md H1) and the table half of each shell game for
// the other e2e/shell-*.spec.ts (docs/design/shared-shell.md §6.3, the `afterConnect` of §6.1):
// what a spec must ask the game itself once the connection has done its part, over the game's own
// fixtures (e2e/fixtures/gin.ts, backgammon.ts, fidice.ts). A game without a row is a type error
// here. Its own file because those fixtures import e2e/fixtures/shell.ts (import-x/no-cycle). The
// connection itself is here too: what every online spec opens with before it asks the game anything.
import { expect, type Page } from '@playwright/test';

import type { Game, ShellGame } from '../../tools/games.ts';
import { bgBoardsAgree, bgStartLocal, boardKey, readBoard, requireBoard } from './backgammon.ts';
import {
  briscolaReveal,
  briscolaStartLocal,
  readView as readBriscola,
  requireView as requireBriscola,
} from './briscola.ts';
import { fidiceHostStarts, fidiceSameRound, fidiceSeatName, fidiceSeats } from './fidice.ts';
import type { Viewport } from './geometry.ts';
import { ginPassUpcard, ginStartLocal, readTable } from './gin.ts';
import { openGame, type GameHooks } from './player.ts';
import {
  DEFAULT_NAMES,
  ONLINE_NAMES,
  hostStarts,
  joinedMsg,
  reveal,
  roomOpen,
  takeOffer,
} from './shell.ts';
import type { Project } from './site.ts';
import { WEBRTC_TIMEOUT } from './timeouts.ts';
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
    /**
     * The glossary links (docs/design/glossary-links.md §4; e2e/shell-glossary.spec.ts, dry-round-2.md
     * I4): the words and the `#rule-<id>` ids the spec taps on this game's page (its ui/glossary.ts
     * and ui/rules.ts), and the way to a table with the rules overlay up.
     */
    glossary: Readonly<{
      /** A word of the About copy, linked: exactly this text (a plain word), and the rule it names. */
      aboutTerm: string;
      aboutRule: string;
      /** In the home Rules list: a rule whose body links `innerTo`; the tap moves there. */
      innerFrom: string;
      innerTo: string;
      /** The rule a `#rule-<id>` deep link at boot opens. */
      deepLink: string;
      /**
       * In the rules overlay over a table: a rule whose body links `overlayTo`. Its own pair, not
       * `innerFrom`/`innerTo`: backgammon's is Western-only (Crawford names the cube), which the home
       * list under Portes has not, so the two lists are tried on different rules.
       */
      overlayFrom: string;
      overlayTo: string;
      /** From the game's `url` at `viewport` to a pass-and-play table with the rules overlay opening. */
      openRulesOverTable: (page: Page, url: string, viewport: Viewport) => Promise<void>;
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
  start: hostStarts,
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
  glossary: {
    aboutTerm: 'knocks',
    aboutRule: 'knock',
    // Knock names deadwood.
    innerFrom: 'knock',
    innerTo: 'deadwood',
    deepLink: 'undercut',
    // Gin names the layoff.
    overlayFrom: 'gin',
    overlayTo: 'layoff',
    // The table's own Rules button (the header's) opens the overlay.
    openRulesOverTable: async (page, url, viewport) => {
      await ginStartLocal(page, url, viewport);
      await page.locator('#rulesBtnGame').click();
    },
  },
};

const bgSnapshot = async (page: Page): Promise<string> => boardKey(await readBoard(page));

const backgammon: ShellDriver = {
  ...shellOnline,
  curtainSub: () => 'Your turn. Roll when you have the phone.',
  // The shell's start, then what backgammon's online table adds: no curtain on either side (pass
  // and play alone has one). The two asserts came here from `bgHostStarts` (dry-round-2.md I5).
  start: async (host, guest) => {
    await hostStarts(host, guest);
    await expect(host.locator('#curtainOverlay')).toBeHidden();
    await expect(guest.locator('#curtainOverlay')).toBeHidden();
  },
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
  glossary: {
    aboutTerm: 'gammon',
    aboutRule: 'scoring',
    // Goal names bearing off twice ("bear them off", "bear off"): the spec taps the first.
    innerFrom: 'goal',
    innerTo: 'bearing-off',
    deepLink: 'blocks',
    // Western backgammon: "cube" and "doubling" both point at the cube rule; the first is the word itself.
    overlayFrom: 'crawford',
    overlayTo: 'cube',
    // A Western game, so the overlay carries the cube and Crawford rules. The curtain is up for the
    // starter and its button lifts it; under Western the opening winner plays the opening dice
    // (backgammon-local.spec.ts "Western rules"), so the reveal lands on the moving phase with no
    // roll modal between it and the menu (dry-round-2.md I4 sketched the roll step: that is Portes,
    // where the winner rolls again); the menu opens the rules.
    openRulesOverTable: async (page, url, viewport) => {
      await bgStartLocal(page, url, viewport, DEFAULT_NAMES, { variant: 'backgammon' });
      await reveal(page);
      await expect(page.locator('#rollOverlay')).toBeHidden();
      await page.locator('#menuBtn').click();
      await page.locator('#menuRulesBtn').click();
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

/** What both briscola tables must agree on: the deal, whose turn, the fan, the tally and the events so far. */
const briscolaKey = (v: Awaited<ReturnType<typeof readBriscola>>): string =>
  v === null
    ? 'none'
    : JSON.stringify([
        v.gameNo,
        v.phase,
        v.turn,
        v.trumpCard.id,
        v.stockCount,
        v.trick,
        v.taken,
        v.events.length,
      ]);
const briscolaSnapshot = async (page: Page): Promise<string> =>
  briscolaKey(await readBriscola(page));

/** The deal both briscola tables show: three cards each, the trump card included in a stock of 34. */
const BRISCOLA_DEALT = { gameNo: 1, phase: 'trick', stockCount: 34, trickNo: 0 } as const;

const briscola: ShellDriver = {
  ...shellOnline,
  curtainSub: (_first, other) => `${other}, look away`,
  // The host deals from the waiting room; both tables come up with no curtain (online).
  start: async (host, guest) => {
    await expect(host.locator('#startGameBtn')).toBeVisible({ timeout: WEBRTC_TIMEOUT });
    await host.locator('#startGameBtn').click();
    await expect(host.locator('#tableScreen')).toBeVisible();
    await expect(guest.locator('#tableScreen')).toBeVisible();
    await expect(host.locator('#curtainOverlay')).toBeHidden();
    await expect(guest.locator('#curtainOverlay')).toBeHidden();
  },
  snapshot: briscolaSnapshot,
  agree: async (host, guest) => {
    const table = briscolaKey(await requireBriscola(host));
    await expect.poll(() => briscolaSnapshot(guest)).toBe(table);
    return table;
  },
  expectOpening: async (host, guest) => {
    // Both tables agree on the deal: the host is seat 0 and the guest seat 1, the same briscola,
    // three cards each, 34 in the stock, game 1 of a best of three.
    const opening = await requireBriscola(host);
    expect(opening).toMatchObject({ ...BRISCOLA_DEALT, me: { idx: 0 } });
    expect(opening.me.hand).toHaveLength(3);
    await expect.poll(() => briscolaSnapshot(guest)).toBe(briscolaKey(opening));
    const theirs = await requireBriscola(guest);
    expect(theirs).toMatchObject({ ...BRISCOLA_DEALT, me: { idx: 1 }, turn: opening.turn });
    expect(theirs.trumpCard).toEqual(opening.trumpCard);
    expect(theirs.me.hand).toHaveLength(3);
    await expect(host.locator('#stockCount')).toHaveText('Stock · 34');
    await expect(guest.locator('#stockCount')).toHaveText('Stock · 34');
    await expect(host.locator('#briscola .card')).toHaveAttribute(
      'data-card',
      opening.trumpCard.id,
    );
    await expect(guest.locator('#briscola .card')).toHaveAttribute(
      'data-card',
      opening.trumpCard.id,
    );
    await expect(host.locator('#gameBadge')).toHaveText('Game 1 · 0–0 · best of 3');
    await expect(guest.locator('#gameBadge')).toHaveText('Game 1 · 0–0 · best of 3');
    await expect(host.locator('#hand .card')).toHaveCount(3);
    await expect(guest.locator('#hand .card')).toHaveCount(3);
  },
  // The host's save carries the room's six terms (protocol.ts's order) and the game at its first deal.
  hostSave: { seatCount: 2, gamesToWin: 2, game: { gameNo: 1 } },
  localSave: { game: { gameNo: 1, trickNo: 0 } },
  table: '#hand .card',
  curtainOffer: {
    title:
      "the curtain's Continue online takes the offer too, with the phone about to change hands",
    // The leader's curtain is up as the game starts: it offers the reveal and, at two seats, the handoff.
    toCurtain: () => Promise.resolve(),
    take: async (page) => {
      await page.locator('#curtainHandoffBtn').click();
      return roomOpen(page, 'briscola');
    },
  },
  // The Rules and About copy (ui/rules.ts, ui/glossary.ts) land with their own stage; the pairs
  // below follow docs/design/briscola.md §5.8's rule ids and are unverified until they do.
  glossary: {
    aboutTerm: 'briscola',
    aboutRule: 'trick',
    innerFrom: 'trick',
    innerTo: 'draw',
    deepLink: 'scoring',
    overlayFrom: 'last-trick',
    overlayTo: 'draw',
    openRulesOverTable: async (page, url, viewport) => {
      await briscolaStartLocal(page, url, viewport);
      await briscolaReveal(page);
      if (await page.locator('#rulesBtnGame').isVisible())
        await page.locator('#rulesBtnGame').click();
      else {
        await page.locator('#menuBtn').click();
        await page.locator('#menuRulesBtn').click();
      }
    },
  },
};

export const SHELL_DRIVERS: Readonly<Record<ShellGame, ShellDriver>> = {
  'gin-rummy': gin,
  backgammon,
  briscola,
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
