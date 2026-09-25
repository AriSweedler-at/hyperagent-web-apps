// The finished games under the history sheet's list (the owner, 2026-09-25: "after a game is
// finished (either online or pass-and-play) the datetime & score should be recorded, including
// the victor. p1 on the device should be considered the user, so those games get shown as
// victories or losses"): `#recentGames`, the slot every shell page carries under `#historyList`
// (web/shared/markup/shell/sheets.html; HISTORY_IDS.recent), painted from the shell state's
// `recentGames` (web/shared/ui/shell.ts, read at `home/init`, the game that just ended put first)
// as one line per game, newest first: the local date and time, the two names, the game's own
// score and W, L or D from the user's seat. Keyed through the keyed slot on the list's length and
// newest clock, so the sheet's other repaints leave it alone; nothing for an empty list (the slot
// collapses, shell.css `.recent-games:empty`). No game noun here: the score is the game's string
// and the names are whatever the seats were called. Not lint-pure: `paintRecentGames` writes the
// document through dom.ts, carved out of the pure profile like history.ts (eslint.config.js `PURE`).
import { requireId, safeHtml, trustedHtml, type DocumentLike, type SafeHtml } from '../edge/dom.ts';
import type { Outcome, RecentGame } from '../lib/recentGames.ts';
import { HISTORY_IDS } from './ids.ts';
import { ensureKeyed } from './keyed.ts';

/** The section's heading. */
export const RECENT_GAMES_TITLE = 'Recent games';

/** The one letter each line ends with: the outcome from the user's seat. */
export const OUTCOME_MARKS: Readonly<Record<Outcome, string>> = { win: 'W', loss: 'L', draw: 'D' };

/** The local date and time a game ended, in the device's locale ("Sep 25, 2026, 2:41 PM"). */
export const formatWhen = (at: number): string =>
  new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** The key a painted list is built under: how many games and the newest clock, `-` for none. */
export const recentGamesKey = (games: ReadonlyArray<RecentGame>): string => {
  const newest = games[0];
  return newest === undefined ? '-' : `${String(games.length)}:${String(newest.at)}`;
};

/**
 * One game's line: `<li class="recent-game" data-outcome data-mode>` with the time, the names
 * (seat order, so the first is the device's user in pass-and-play and the host online), the
 * score and the mark. No `</div>` inside (the gin DOM-parity oracle drops the slot up to its first).
 */
export const recentGameHtml = (game: RecentGame): SafeHtml =>
  safeHtml`<li class="recent-game" data-outcome="${game.outcome}" data-mode="${game.mode}"><span class="recent-game-when">${formatWhen(game.at)}</span><span class="recent-game-players">${game.players.join(' · ')}</span><span class="recent-game-score">${game.score}</span><span class="recent-game-outcome">${OUTCOME_MARKS[game.outcome]}</span></li>`;

/** The whole section: the heading and one line per game, newest first; nothing for no games. */
export const recentGamesHtml = (games: ReadonlyArray<RecentGame>): SafeHtml =>
  games.length === 0
    ? trustedHtml('')
    : safeHtml`<h3 class="recent-games-title">${RECENT_GAMES_TITLE}</h3><ol class="recent-games-list">${games.map(recentGameHtml)}</ol>`;

/**
 * Paint `#recentGames` from the list through the keyed slot (keyed.ts): rebuilt only when a game
 * was added (or the list read anew at `home/init`), so the sheet's other repaints leave it be.
 */
export const paintRecentGames = (doc: DocumentLike, games: ReadonlyArray<RecentGame>): void => {
  ensureKeyed(
    requireId(doc, HISTORY_IDS.recent),
    recentGamesKey(games),
    () => recentGamesHtml(games).markup,
  );
};
