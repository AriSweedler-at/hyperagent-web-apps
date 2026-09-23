// The one registry of the games the harness enumerates (README.md "Add a game" step 7): the e2e
// fixtures, the dist guards and the computed-style oracle read these lists instead of each
// spelling its own. `Game` itself is web/shared/lib/roomCode.ts's closed union, so a game the
// harness names must have a room-code row, and a game the union gains shows up here as a type
// error until it is listed. tools/games.test.ts pins every value.
import type { Game } from '../web/shared/lib/roomCode.ts';

export type { Game };

/** The pages smoke opens: every game and the landing page. */
export type PageName = Game | 'landing';

/** Every game the site builds, in the order the landing page lists them. */
export const GAMES: ReadonlyArray<Game> = ['gin-rummy', 'fidice', 'backgammon'];

/** The games with a frozen legacy page under legacy/<g>/index.html (the oracle source, never served). */
export const LEGACY_GAMES: ReadonlyArray<Game> = ['gin-rummy', 'fidice'];

/** `<title>` of each page, as e2e/smoke.spec.ts expects it. */
export const PAGE_TITLES: Readonly<Record<PageName, string>> = {
  landing: "Ari's web apps",
  'gin-rummy': 'Gin Rummy',
  fidice: "Fidice — one-cup liar's dice",
  backgammon: 'Sheshbesh — Sephardic backgammon',
};

/** The documented test hook each page exposes once its boot finished (docs/ARCHITECTURE.md "Documented test hooks"). */
export const HOOKS: Readonly<Record<Game, string>> = {
  'gin-rummy': 'window.__gin',
  fidice: 'window.__fidice',
  backgammon: 'window.__backgammon',
};

/** The landing page's card links, relative to the site root, in GAMES order. */
export const LANDING_HREFS: ReadonlyArray<string> = GAMES.map((game) => `games/${game}/`);
