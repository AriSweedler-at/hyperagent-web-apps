// Board primitives every other engine module shares (understand.md §5 R2, R8, R10, R11, R15;
// panel E1 §2.1): the frame helpers routed through the variant's `ownOf`/`absOf`, open/blocked
// with the single-opponent hook (hit, pin, illegal), the one function that moves a checker, and
// the structural checks the decoder and the replay lean on. All O(24), all pure.
import {
  BAR_PIPS,
  CHECKERS,
  HOME_SIZE,
  POINTS,
  type Board,
  type Die,
  type Move,
  type Pair,
  type PointIndex,
  type Seat,
  type Stack,
  type VariantRules,
} from './types.ts';

/** Every absolute point, typed, so iterating the board never casts an index. */
export const POINT_INDICES: ReadonlyArray<PointIndex> = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
];

export const otherSeat = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

export const setAt = <T>(pair: Pair<T>, seat: Seat, value: T): Pair<T> =>
  seat === 0 ? [value, pair[1]] : [pair[0], value];

export const emptyBoard = (): Board => ({
  points: Array.from({ length: POINTS }, (): Stack => []),
  bar: [0, 0],
  off: [0, 0],
});

/** The stack on `abs`; a board always has 24, so the fallback only satisfies the index type. */
export const stackAt = (board: Board, abs: number): Stack => board.points[abs] ?? [];

/** Only the top checker of a stack can move (a pinned plakoto checker is not on top). */
export const topIs = (stack: Stack, seat: Seat): boolean => stack.at(-1) === seat;

/**
 * R8 + R29: opposing checkers on the stack decide. Under `pin` a lone opposing checker may be
 * pinned, and a point the mover already pins takes more of the mover's checkers, but a checker
 * that is itself pinning ([me, opp]) cannot be pinned in turn.
 */
export const isOpen = (stack: Stack, seat: Seat, rules: VariantRules): boolean => {
  const opponents = stack.filter((s) => s !== seat).length;
  if (opponents === 0) return true;
  if (opponents >= rules.blocksAt) return false;
  switch (rules.onSingleOpponent) {
    case 'hit':
      return true;
    case 'pin':
      return topIs(stack, seat) || stack.length === 1;
    case 'illegal':
      return false;
  }
};

/** R11: a die `n` enters from the bar onto own point 25 - n (the opponent's home board). */
export const entryPoint = (seat: Seat, die: Die, rules: VariantRules): PointIndex =>
  rules.absOf(seat, BAR_PIPS - die);

/** R10: landing on a lone opposing checker sends it to the bar (only under `hit` rules). */
export const hits = (board: Board, seat: Seat, move: Move, rules: VariantRules): boolean => {
  if (move.to === 'off' || rules.onSingleOpponent !== 'hit') return false;
  const target = stackAt(board, move.to);
  return target.length === 1 && !topIs(target, seat);
};

/** The moved checker leaves the top of its stack; a hit blot goes to the bar; a pin pushes on top. */
export const afterMove = (board: Board, seat: Seat, move: Move, rules: VariantRules): Board => {
  const lifted: Board =
    move.from === 'bar'
      ? { ...board, bar: setAt(board.bar, seat, board.bar[seat] - 1) }
      : { ...board, points: board.points.map((st, i) => (i === move.from ? st.slice(0, -1) : st)) };
  if (move.to === 'off') return { ...lifted, off: setAt(lifted.off, seat, lifted.off[seat] + 1) };
  const hit = hits(board, seat, move, rules);
  const opp = otherSeat(seat);
  const to = move.to;
  return {
    points: lifted.points.map((st, i) => (i === to ? (hit ? [seat] : [...st, seat]) : st)),
    bar: hit ? setAt(lifted.bar, opp, lifted.bar[opp] + 1) : lifted.bar,
    off: lifted.off,
  };
};

/** R15: nothing on the bar and every remaining checker inside own 1..6. */
export const canBearOff = (board: Board, seat: Seat, rules: VariantRules): boolean =>
  board.bar[seat] === 0 &&
  POINT_INDICES.every(
    (abs) => !stackAt(board, abs).includes(seat) || rules.ownOf(seat, abs) <= HOME_SIZE,
  );

/** The highest own point holding one of `seat`'s checkers, 0 when none (R16's "higher point"). */
export const highestPoint = (board: Board, seat: Seat, rules: VariantRules): number =>
  POINT_INDICES.reduce<number>(
    (h, abs) => (stackAt(board, abs).includes(seat) ? Math.max(h, rules.ownOf(seat, abs)) : h),
    0,
  );

export const checkerCount = (board: Board, seat: Seat): number =>
  board.points.reduce((n, st) => n + st.filter((s) => s === seat).length, 0) +
  board.bar[seat] +
  board.off[seat];

/** No stack mixes owners: true of every portes/backgammon board (only plakoto pins). */
export const isHomogeneous = (board: Board): boolean =>
  board.points.every((st) => st.every((s) => s === st[0]));

/** The structural invariant the decoder refines on: 24 points, 15 a side, nothing negative. */
export const isWellFormed = (board: Board): boolean =>
  board.points.length === POINTS &&
  checkerCount(board, 0) === CHECKERS &&
  checkerCount(board, 1) === CHECKERS &&
  board.bar.every((n) => n >= 0) &&
  board.off.every((n) => n >= 0);

/** Dedupe key for the enumeration; stack order is included, so it is exact for plakoto too. */
export const boardKey = (board: Board): string =>
  `${board.points.map((st) => st.join('')).join(',')}|${board.bar.join('/')}|${board.off.join('/')}`;
