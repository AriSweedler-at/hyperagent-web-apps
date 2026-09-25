// The running score, the game's result and the match (docs/design/briscola-rules.md D4, D7, D9,
// E12, E13). Nothing is stored twice: `taken`, `tricks` and `sides` are read off `piles`, and the
// result is the unique strictly highest side, or a draw when the top is shared (61 wins and 60-60
// draws at two sides; nobody needs 61 at three players).
import { seatsOfSide, sideList } from './seats.ts';
import type { Cards, GameOptions, GameResult, Match, Seat, SeatCount, Side } from './types.ts';
import { pointsOf } from './cards.ts';

/** D9: points per seat. */
export const takenOf = (piles: ReadonlyArray<Cards>): ReadonlyArray<number> => piles.map(pointsOf);

/** D9: tricks per seat (a pile holds n cards per trick). */
export const tricksOf = (n: SeatCount, piles: ReadonlyArray<Cards>): ReadonlyArray<number> =>
  piles.map((pile) => pile.length / n);

/** E12: points per side, `Σ taken` over the side's seats. */
export const sideTotals = (n: SeatCount, piles: ReadonlyArray<Cards>): ReadonlyArray<number> =>
  sideList(n).map((side) =>
    pointsOf(piles.filter((_, seat) => seatsOfSide(n, side).includes(seat as Seat)).flat()),
  );

/** E12: the unique strictly highest side wins; a tie for the top is a draw (`winner: null`). */
export const resultOf = (n: SeatCount, piles: ReadonlyArray<Cards>): GameResult => {
  const totals = sideTotals(n, piles);
  const top = Math.max(...totals);
  const leaders = sideList(n).filter((side) => totals[side] === top);
  const [winner] = leaders;
  return leaders.length === 1 && winner !== undefined
    ? { winner, totals, draw: false }
    : { winner: null, totals, draw: true };
};

/** E13: the match after a game: `wins[winner] += 1` on a win, `draws += 1` on a draw. */
export const matchAfter = (match: Match, result: GameResult): Match =>
  result.winner === null
    ? { ...match, draws: match.draws + 1 }
    : { ...match, wins: match.wins.map((w, side) => (side === result.winner ? w + 1 : w)) };

/** E13: a side has reached `gamesToWin`. */
export const matchOver = (match: Match): boolean => match.wins.some((w) => w >= match.gamesToWin);

/** The side that took the match, or null while it is on. */
export const matchWinner = (match: Match): Side | null => {
  const side = match.wins.findIndex((w) => w >= match.gamesToWin);
  return side === -1 ? null : (side as Side);
};

export const freshMatch = (options: Pick<GameOptions, 'seatCount' | 'gamesToWin'>): Match => ({
  gamesToWin: options.gamesToWin,
  wins: sideList(options.seatCount).map(() => 0),
  draws: 0,
});
