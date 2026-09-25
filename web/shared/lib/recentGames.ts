// The record every finished game leaves in browser storage (the owner, 2026-09-25: "after a game is
// finished (either online or pass-and-play) the datetime & score should be recorded, including the
// victor. p1 on the device should be considered the user, so those games get shown as victories or
// losses. This is a general engine rule. Save up to 20 games of history in browser storage."): the
// shape of one record, the cap, the append that keeps the list newest first under it, the outcome
// from the user's seat, and the decoder a stored list is read back through. Pure: the shell reducer
// (web/shared/ui/shell.ts) builds a record from its `cfg.result` adapters when a view first shows
// the game over, the `recordGame` effect appends it through the game's `recentGames` pref
// (web/shared/edge/prefs.ts, under the game's own `<game>_recentGames` key like its sound font,
// docs/design/sound-fonts.md §6), and web/shared/ui/recentGames.ts paints the list in the history
// sheet. No game noun here: the score is the game's own string, the winner a seat.
import { arrayOf, integer, literal, nullable, object, string, type Decoder } from './json.ts';
import { ok } from './result.ts';

/** The game as the user on this device saw it end: a win, a loss, or nobody's (a draw). */
export type Outcome = 'win' | 'loss' | 'draw';
export const OUTCOMES: ReadonlyArray<Outcome> = ['win', 'loss', 'draw'];

/** One finished game, as stored; the newest is first in the list. */
export type RecentGame = Readonly<{
  /** When the result was recorded (wall-clock milliseconds, the reducer's `ctx.now()`). */
  at: number;
  /** Pass-and-play on this device, or a room. */
  mode: 'local' | 'online';
  /** The seats' names in seat order (seat 0 first: pass-and-play's first name, online's host). */
  players: ReadonlyArray<string>;
  /** The game's own final score, spelled by its `result.scoreOf` (gin "104–87", backgammon "5–3"). */
  score: string;
  /** The winning seat, or null when nobody won. */
  winner: number | null;
  /** The result from the user's seat: seat 0 on one device, the local seat online. */
  outcome: Outcome;
}>;

/** How many finished games a device keeps (the owner's number). */
export const RECENT_GAMES_CAP = 20;

/** The list with `entry` first and the oldest beyond `cap` dropped. */
export const appendCapped = <T>(
  list: ReadonlyArray<T>,
  entry: T,
  cap: number = RECENT_GAMES_CAP,
): ReadonlyArray<T> => [entry, ...list].slice(0, cap);

/** The user's outcome: their seat won, somebody else did, or nobody (`winner` null). */
export const outcomeFor = (userSeat: number, winner: number | null): Outcome =>
  winner === null ? 'draw' : winner === userSeat ? 'win' : 'loss';

/** One stored record, field by field in the literal's order. */
export const decodeRecentGame: Decoder<RecentGame> = object({
  at: integer(0),
  mode: literal('local', 'online'),
  players: arrayOf(string),
  score: string,
  winner: nullable(integer(0)),
  outcome: literal(...OUTCOMES),
});

/**
 * A stored list, read leniently: what is not a list reads as an empty one, and an entry the
 * decoder refuses is dropped rather than losing the ones beside it (a record is a convenience, not
 * a save: nothing downstream needs the failure). Never an error, so a caller reads a list or [].
 */
export const decodeRecentGames: Decoder<ReadonlyArray<RecentGame>> = (input) =>
  ok(
    Array.isArray(input)
      ? (input as ReadonlyArray<unknown>).flatMap((item) => {
          const decoded = decodeRecentGame(item);
          return decoded.ok ? [decoded.value] : [];
        })
      : [],
  );
