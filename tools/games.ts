// The one registry of the games the harness enumerates (README.md "Add a game" step 7;
// docs/design/shared-shell.md §6.1): one row per game holding what the e2e fixtures, the dist
// guards and the computed-style oracle used to spell each in a list of their own, so a fact about
// a game (its title, its hook, its storage keys, the shape of its page, the class-contract floors,
// the PeerJS debug level) is written once; GAMES, PAGE_TITLES and HOOKS are read off the rows.
// `Game` itself is web/shared/lib/roomCode.ts's closed union, so a game the harness names must
// have a room-code row, and a game the union gains shows up here as a type error until it has a
// row. tools/games.test.ts pins every value. The `shell` block of §6.1 (the tabs, the guest-answered
// status, the curtain copy, the connection dot, the local fields) joins with D1's shared shell
// fixtures, once bg-online has given backgammon a guest-answered string to assert.
import type { Game } from '../web/shared/lib/roomCode.ts';

export type { Game };

/** The pages smoke opens: every game and the landing page. */
export type PageName = Game | 'landing';

/** One game's row: every fact about it the harness reads. */
export type GameSpec = Readonly<{
  /** `<title>` of the page, as e2e/smoke.spec.ts expects it and the dist guards find it. */
  title: string;
  /** The documented test hook the page exposes once its boot finished (docs/ARCHITECTURE.md "Documented test hooks"). */
  hook: string;
  /**
   * The shell's localStorage keys (shared-shell.md §6.1): the save of the game in progress and the
   * prefix every preference key carries (`<prefix>homeTab`, `<prefix>playMode`, ...), as the game's
   * storage.ts STORAGE_KEYS spells them (the test pins the two equal). Absent for fidice, whose one
   * key (`fidice-name`) is neither; it gains the row with its restyle (§4.6).
   */
  storage?: Readonly<{ saveKey: string; prefix: string }>;
  /** The PeerJS `debug` level main.ts passes to `realTransport`, which `expectPeerOptions` asserts. */
  debug: 0 | 1;
  /**
   * What the built page must carry (test/dist/dist-parity.test.ts): the ids of its static screens
   * (fidice ships one mount point, `#app`, and paints the rest from TS) and whether the two rules
   * lists ship empty, to be filled at boot from ui/rules.ts.
   */
  pageShape: Readonly<{ ids: ReadonlyArray<string>; rulesSlots: boolean }>;
  /**
   * How many class names the class-contract extraction must find in the game's TypeScript and in
   * its page markup (test/dist/class-contract.test.ts), so an extraction that silently finds
   * nothing (a moved file, a changed helper name) fails there rather than passing the two orphan
   * tests vacuously. TypeScript: gin and fidice spell most names out; backgammon's board builders
   * make theirs by template (`die-${face}`, `ck-${owner}`, the `conn-dot` attribute), which the
   * extraction cannot see (42 seen; the rest are CONTRACT.md rows). Markup: fidice paints its whole
   * page from TS into `#app` (-1: any count passes), gin's and backgammon's pages carry their screens.
   */
  contractFloors: Readonly<{ ts: number; markup: number }>;
}>;

/** The 24 points, direct children of #board in absolute order (docs/design/backgammon-board.md §2.2.1). */
const POINT_IDS: ReadonlyArray<string> = Array.from(
  { length: 24 },
  (_, i) => `point-${String(i + 1)}`,
);

/** Every game the site builds, one row each, in the order the landing page lists them. */
export const REGISTRY: Readonly<Record<Game, GameSpec>> = {
  'gin-rummy': {
    title: 'Gin Rummy',
    hook: 'window.__gin',
    storage: { saveKey: 'ginRummyMP_v1', prefix: 'ginRummy_' },
    debug: 0,
    // The legacy ids, kept by web/games/gin-rummy/index.html, with the two rules slots empty.
    pageShape: {
      ids: ['app', 'homeScreen', 'tableScreen', 'scResOverlay', 'toast'],
      rulesSlots: true,
    },
    contractFloors: { ts: 50, markup: 40 },
  },
  fidice: {
    title: "Fidice — one-cup liar's dice",
    hook: 'window.__fidice',
    debug: 1,
    pageShape: { ids: ['app'], rulesSlots: false },
    contractFloors: { ts: 50, markup: -1 },
  },
  backgammon: {
    title: 'Sheshbesh — backgammon',
    hook: 'window.__backgammon',
    storage: { saveKey: 'backgammonMP_v1', prefix: 'backgammon_' },
    debug: 0,
    // Gin-shaped: static screens, the 24 points (the seat mapping is an attribute, so the markup
    // ships seat 0's `data-own` for every point) and the same empty rules slots.
    pageShape: {
      ids: ['app', 'homeScreen', 'tableScreen', 'board', 'toast', ...POINT_IDS],
      rulesSlots: true,
    },
    contractFloors: { ts: 35, markup: 40 },
  },
};

/** Every game the site builds, in the order the landing page lists them: REGISTRY's row order. */
export const GAMES: ReadonlyArray<Game> = Object.keys(REGISTRY) as ReadonlyArray<Game>;

/** One value per game, read off its row (the cast: Object.fromEntries widens the keys to string). */
const perGame = <T>(pick: (spec: GameSpec) => T): Readonly<Record<Game, T>> =>
  Object.fromEntries(GAMES.map((game) => [game, pick(REGISTRY[game])])) as Record<Game, T>;

/** The games with a frozen legacy page under legacy/<g>/index.html (the oracle source, never served). */
export const LEGACY_GAMES: ReadonlyArray<Game> = ['gin-rummy', 'fidice'];

/** `<title>` of each page, as e2e/smoke.spec.ts expects it. */
export const PAGE_TITLES: Readonly<Record<PageName, string>> = {
  landing: "Ari's web apps",
  ...perGame((spec) => spec.title),
};

/** The documented test hook each page exposes once its boot finished (docs/ARCHITECTURE.md "Documented test hooks"). */
export const HOOKS: Readonly<Record<Game, string>> = perGame((spec) => spec.hook);

/** The landing page's card links, relative to the site root, in GAMES order. */
export const LANDING_HREFS: ReadonlyArray<string> = GAMES.map((game) => `games/${game}/`);

/**
 * A game's second URL name -> the game folder it stands for: `/sheshbesh/` is the backgammon page.
 * An alias is not a game: no landing card, no room-code row, no REGISTRY row, and never a GAMES entry.
 * On the Pages origin web/games/<alias>/index.html is a stub that forwards to `../<game>/`, query
 * and hash intact; on games.sweedler.com the Worker serves `/<alias>/` from `games/<game>/` in place
 * (infra/games-proxy/worker.ts keeps its own copy of this map, since wrangler deploys that file
 * alone; its test pins the two equal). The dist guards check each stub, and only the game's own URL
 * is linked from the landing page. The values are folder names rather than `Game`: backgammon's
 * page and its `Game` row land separately from this alias.
 */
export const ALIASES: Readonly<Record<string, string>> = { sheshbesh: 'backgammon' };
