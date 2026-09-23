// Scoring selectors (understand.md §5 R17, R18, R21, R22, R24; panel E1 §5 `score.ts`): the pip
// count, who has borne everything off, the single/gammon/backgammon multiplier capped per variant,
// and the match arithmetic. The match winner is derived from the score (R24's spirit), never
// stored; the Crawford flags are computed here and evaluated by `createGame` as well as
// `nextGame`, so a 1-point match's only game is the Crawford game (0 = N - 1 at the start).
import { otherSeat, POINT_INDICES, stackAt } from './board.ts';
import {
  BAR_PIPS,
  CHECKERS,
  HOME_SIZE,
  POINTS,
  type Board,
  type Match,
  type Multiplier,
  type Seat,
  type VariantRules,
} from './types.ts';

/** R24: the sum of own point numbers over the seat's checkers; a checker on the bar counts 25. */
export const pipCount = (board: Board, seat: Seat, rules: VariantRules): number =>
  POINT_INDICES.reduce<number>(
    (n, abs) => n + stackAt(board, abs).filter((s) => s === seat).length * rules.ownOf(seat, abs),
    0,
  ) +
  board.bar[seat] * BAR_PIPS;

/** The seat that has borne all fifteen off, if any (R17). */
export const winnerOf = (board: Board): Seat | null =>
  board.off[0] === CHECKERS ? 0 : board.off[1] === CHECKERS ? 1 : null;

/**
 * R17/R18 when the last checker comes off: 1 once the loser has borne off anything; else 3
 * (backgammon) with a loser's checker on the bar or in the winner's home board (the loser's own
 * 19..24), else 2 (gammon); then the variant's cap (portes stops at 2, the diplo).
 */
export const multiplierFor = (board: Board, winner: Seat, rules: VariantRules): Multiplier => {
  const loser = otherSeat(winner);
  if (board.off[loser] > 0) return 1;
  const inWinnersHome = POINT_INDICES.some(
    (abs) => stackAt(board, abs).includes(loser) && rules.ownOf(loser, abs) > POINTS - HOME_SIZE,
  );
  const raw: Multiplier = board.bar[loser] > 0 || inWinnersHome ? 3 : 2;
  return raw === 3 && rules.maxMultiplier === 2 ? 2 : raw;
};

/** R21: first to `length` points; overshoot earns nothing more. */
export const matchWinner = (match: Match): Seat | null =>
  match.score[0] >= match.length ? 0 : match.score[1] >= match.length ? 1 : null;

export const matchOver = (match: Match): boolean => matchWinner(match) !== null;

/**
 * R22: the game that starts with either score at exactly `length - 1` is the Crawford game, once
 * per match and only where there is a cube.
 */
export const crawfordFor = (
  match: Pick<Match, 'length' | 'score' | 'crawfordDone'>,
  rules: VariantRules,
): Pick<Match, 'isCrawfordGame' | 'crawfordDone'> => {
  const isCrawfordGame =
    rules.cube && !match.crawfordDone && match.score.some((s) => s === match.length - 1);
  return { isCrawfordGame, crawfordDone: match.crawfordDone || isCrawfordGame };
};
