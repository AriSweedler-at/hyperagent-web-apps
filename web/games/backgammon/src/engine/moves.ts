// Legal play (understand.md §5 R4, R7-R9, R11-R14, R16; panel E1 §2.2-2.4): every rule about one
// die lives in `singleSteps`; the obligation to play as many dice as possible and the higher-die
// rule are a level-by-level enumeration of the boards reachable with the remaining dice,
// deduplicated by resulting board at every level (two orderings of independent moves meet there),
// tried in both die orders for a non-double. Maximality is hereditary (E1 §2.4, brute-forced over
// 3000 positions): after any offered move, the legal continuations from the new board with the
// remaining multiset are exactly the completions of the maximal plays, so `legalMoves` is a
// function of (board, dice, played) alone, the same function decides UI offers, action legality
// and the automatic end of the turn, and no play tree is stored.
import {
  afterMove,
  boardKey,
  canBearOff,
  entryPoint,
  highestPoint,
  isOpen,
  POINT_INDICES,
  stackAt,
  topIs,
} from './board.ts';
import type { Board, Dice, Die, From, Move, Play, Seat, State, To, VariantRules } from './types.ts';
import { rulesOf } from './variants.ts';

type Order = ReadonlyArray<Die>;

/** R7: a double is four moves of the same die. */
export const expandDice = ([a, b]: Dice): ReadonlyArray<Die> => (a === b ? [a, a, a, a] : [a, b]);

/** Multiset minus one occurrence. */
export const removeOne = (dice: ReadonlyArray<Die>, die: Die): ReadonlyArray<Die> => {
  const i = dice.indexOf(die);
  return i < 0 ? dice : [...dice.slice(0, i), ...dice.slice(i + 1)];
};

/** The dice still to play this turn: the roll expanded, minus the dice of the moves played. */
export const remainingDice = (state: State): ReadonlyArray<Die> =>
  state.phase === 'moving' && state.dice !== null
    ? state.played.reduce((rest, m) => removeOne(rest, m.die), expandDice(state.dice))
    : [];

/** Canonical order for byte-stable views: bar before 0, off after 23; then the die descending. */
const slot = (place: From | To): number => (place === 'bar' ? -1 : place === 'off' ? 24 : place);
export const moveKey = (m: Move): string =>
  `${String(slot(m.from))}>${String(slot(m.to))}/${String(m.die)}`;
export const compareMoves = (a: Move, b: Move): number =>
  slot(a.from) - slot(b.from) || slot(a.to) - slot(b.to) || b.die - a.die;
export const sortMoves = (moves: ReadonlyArray<Move>): ReadonlyArray<Move> =>
  [...moves].sort(compareMoves);
export const movesEqual = (a: Move, b: Move): boolean => moveKey(a) === moveKey(b);

/**
 * R11 bar first; R8 open; R15/R16 bear off exactly, or with a bigger die only from the highest
 * point; R4 forward only. Distinct from-points give distinct moves, so nothing needs deduping.
 */
export const singleSteps = (
  board: Board,
  seat: Seat,
  die: Die,
  rules: VariantRules,
): ReadonlyArray<Move> => {
  const steps = ((): ReadonlyArray<Move> => {
    if (rules.hasBar && board.bar[seat] > 0) {
      const entry = entryPoint(seat, die, rules);
      return isOpen(stackAt(board, entry), seat, rules) ? [{ from: 'bar', to: entry, die }] : [];
    }
    const bearing = canBearOff(board, seat, rules);
    const highest = highestPoint(board, seat, rules);
    return POINT_INDICES.flatMap((abs): ReadonlyArray<Move> => {
      if (!topIs(stackAt(board, abs), seat)) return [];
      const own = rules.ownOf(seat, abs);
      const target = own - die;
      if (target >= 1) {
        const to = rules.absOf(seat, target);
        return isOpen(stackAt(board, to), seat, rules) ? [{ from: abs, to, die }] : [];
      }
      return bearing && (target === 0 || own === highest) ? [{ from: abs, to: 'off', die }] : [];
    });
  })();
  return steps.filter((move) => rules.extraMoveConstraints.every((ok) => ok(board, seat, move)));
};

/** The die orders to try: both for two different dice, one otherwise (doubles, or one die left). */
const orders = (remaining: ReadonlyArray<Die>): ReadonlyArray<Order> => {
  const [a, b] = remaining;
  return a !== undefined && b !== undefined && remaining.length === 2 && a !== b
    ? [remaining, [b, a]]
    : [remaining];
};

/**
 * A board reached during the enumeration and, as a bitmask over the indices of the first moves
 * tried, which first moves can reach it: two paths meeting on one board merge their masks, so
 * the deepest level's union says which first moves keep the maximum reachable.
 */
type Node = Readonly<{ key: string; board: Board; origins: number }>;

const node = (board: Board, origins: number): Node => ({ key: boardKey(board), board, origins });

const byKey = (a: Node, b: Node): number => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** One node per distinct board, origins merged (sorted by key, then adjacent runs folded). */
const merged = (nodes: ReadonlyArray<Node>): ReadonlyArray<Node> =>
  [...nodes].sort(byKey).reduce<ReadonlyArray<Node>>((acc, n) => {
    const last = acc.at(-1);
    return last?.key === n.key
      ? [...acc.slice(0, -1), { ...last, origins: last.origins | n.origins }]
      : [...acc, n];
  }, []);

/** Level k+1: every board one `die` step from a board of level k, deduplicated by resulting board. */
const nextLevel = (
  level: ReadonlyArray<Node>,
  seat: Seat,
  die: Die,
  rules: VariantRules,
): ReadonlyArray<Node> =>
  merged(
    level.flatMap((n) =>
      singleSteps(n.board, seat, die, rules).map((m) =>
        node(afterMove(n.board, seat, m, rules), n.origins),
      ),
    ),
  );

type Levels = Readonly<{ levels: ReadonlyArray<ReadonlyArray<Node>>; open: boolean }>;

/** The levels after `level1`, one per further die, stopping at the first die that cannot be played. */
const deeper = (
  level1: ReadonlyArray<Node>,
  seat: Seat,
  rest: Order,
  rules: VariantRules,
): ReadonlyArray<ReadonlyArray<Node>> =>
  rest.reduce<Levels>(
    ({ levels, open }, die) => {
      if (!open) return { levels, open };
      const next = nextLevel(levels.at(-1) ?? [], seat, die, rules);
      return next.length === 0 ? { levels, open: false } : { levels: [...levels, next], open };
    },
    { levels: [level1], open: true },
  ).levels;

/** The first moves of `order` and the levels they reach; level 0 is `board` itself. */
type Explored = Readonly<{
  order: Order;
  firsts: ReadonlyArray<Move>;
  levels: ReadonlyArray<ReadonlyArray<Node>>;
}>;

const explore = (board: Board, seat: Seat, order: Order, rules: VariantRules): Explored => {
  const [die, ...rest] = order;
  const firsts = die === undefined ? [] : singleSteps(board, seat, die, rules);
  const level1 = merged(firsts.map((m, i) => node(afterMove(board, seat, m, rules), 1 << i)));
  const root = [node(board, 0)];
  return {
    order,
    firsts,
    levels: level1.length === 0 ? [root] : [root, ...deeper(level1, seat, rest, rules)],
  };
};

/**
 * Levels 0..k of the distinct boards reachable by playing `order`'s dice in that order, stopping
 * at the first die that cannot be played. The level-4 count of E1's worst case (fifteen
 * consecutive singletons under 1-1: 1654) is the dedupe's regression pin.
 */
export const reachableLevels = (
  board: Board,
  seat: Seat,
  order: Order,
  rules: VariantRules,
): ReadonlyArray<ReadonlyArray<Board>> =>
  explore(board, seat, order, rules).levels.map((level) => level.map((n) => n.board));

/** How many dice of `order`, in that order, can be played from `board`. */
export const playableDepth = (
  board: Board,
  seat: Seat,
  order: Order,
  rules: VariantRules,
): number => reachableLevels(board, seat, order, rules).length - 1;

/** The first moves whose origin bit survives to the deepest level: they keep the maximum reachable. */
const survivors = ({ firsts, levels }: Explored): ReadonlyArray<Move> => {
  const mask = (levels.at(-1) ?? []).reduce((m, n) => m | n.origins, 0);
  return firsts.filter((_, i) => (mask & (1 << i)) !== 0);
};

/** The most dice any order can play from here, and the first moves that keep that reachable. */
type Analysis = Readonly<{ best: number; firsts: ReadonlyArray<Move> }>;

/**
 * R12/R13: `best` is the most dice any order can play; only orders reaching it contribute; when
 * best is 1 with two different dice and either could be played alone, only the higher die's
 * moves are kept (R12); a first move stays only if the rest of its order is fully playable after
 * it, so a low die that would leave the high die dead is never offered.
 */
const analyse = (
  board: Board,
  seat: Seat,
  remaining: ReadonlyArray<Die>,
  rules: VariantRules,
): Analysis => {
  const [first, second] = remaining;
  if (first === undefined) return { best: 0, firsts: [] };
  // One die left (half of all calls): its single steps are the maximal plays.
  if (second === undefined) {
    const steps = sortMoves(singleSteps(board, seat, first, rules));
    return { best: steps.length === 0 ? 0 : 1, firsts: steps };
  }
  const explored = orders(remaining).map((order) => explore(board, seat, order, rules));
  const best = Math.max(...explored.map((e) => e.levels.length - 1));
  if (best === 0) return { best, firsts: [] };
  const full = explored.filter((e) => e.levels.length - 1 === best);
  const kept =
    best === 1 && full.length === 2
      ? full.filter((e) => e.order[0] === Math.max(...remaining))
      : full;
  return { best, firsts: sortMoves(kept.flatMap(survivors)) };
};

/** The first moves of every maximal play for the multiset `remaining`, sorted by `moveKey`. */
export const legalFirstMoves = (
  board: Board,
  seat: Seat,
  remaining: ReadonlyArray<Die>,
  rules: VariantRules,
): ReadonlyArray<Move> => analyse(board, seat, remaining, rules).firsts;

/** What the UI is offered (R13): the distinct next moves of the maximal plays consistent with `played`. */
export const legalMoves = (state: State): ReadonlyArray<Move> =>
  state.phase === 'moving'
    ? legalFirstMoves(state.board, state.turn, remainingDice(state), rulesOf(state.variant))
    : [];

const distinctDice = (dice: ReadonlyArray<Die>): ReadonlyArray<Die> =>
  dice.filter((d, i) => dice.indexOf(d) === i);

/** Every legal sequence of exactly `depth` more single steps from `board` with `dice`. */
const sequences = (
  board: Board,
  seat: Seat,
  dice: ReadonlyArray<Die>,
  depth: number,
  rules: VariantRules,
): ReadonlyArray<Play> =>
  depth === 0
    ? [[]]
    : distinctDice(dice).flatMap((die) =>
        singleSteps(board, seat, die, rules).flatMap((m) =>
          sequences(
            afterMove(board, seat, m, rules),
            seat,
            removeOne(dice, die),
            depth - 1,
            rules,
          ).map((tail): Play => [m, ...tail]),
        ),
      );

/**
 * Every maximal play as a sequence (tests, history, `View.plays`): a legal first move followed by
 * any legal sequence of `best - 1` more steps, since every play of the maximum length is maximal
 * and the higher-die rule only ever decides the root. Cheaper than recursing on the level sets.
 */
export const maximalPlays = (
  board: Board,
  seat: Seat,
  remaining: ReadonlyArray<Die>,
  rules: VariantRules,
): ReadonlyArray<Play> => {
  const { best, firsts } = analyse(board, seat, remaining, rules);
  return firsts.flatMap((m) =>
    sequences(
      afterMove(board, seat, m, rules),
      seat,
      removeOne(remaining, m.die),
      best - 1,
      rules,
    ).map((tail): Play => [m, ...tail]),
  );
};

const distinctBoards = (boards: ReadonlyArray<Board>): ReadonlyArray<Board> => [
  ...new Map(boards.map((b) => [boardKey(b), b] as const)).values(),
];

/** The distinct end boards of the maximal plays (tests: "16 outcomes"). */
export const distinctOutcomes = (
  board: Board,
  seat: Seat,
  remaining: ReadonlyArray<Die>,
  rules: VariantRules,
): ReadonlyArray<Board> =>
  distinctBoards(
    maximalPlays(board, seat, remaining, rules).map((play) =>
      play.reduce((b, m) => afterMove(b, seat, m, rules), board),
    ),
  );

/** The legal moves of one checker (tap-to-move groups by `from`). */
export const movesFrom = (legal: ReadonlyArray<Move>, from: From): ReadonlyArray<Move> =>
  legal.filter((m) => m.from === from);

/**
 * The move a tap on `to` means: only a bear-off can be reached with more than one die, and then
 * the exact die (own(from) === die) wins, else the largest legal die.
 */
export const moveTo = (
  legal: ReadonlyArray<Move>,
  from: From,
  to: To,
  seat: Seat,
  rules: VariantRules,
): Move | null => {
  const candidates = legal.filter((m) => m.from === from && m.to === to);
  const exact = candidates.find((m) => m.from !== 'bar' && rules.ownOf(seat, m.from) === m.die);
  return (
    exact ?? candidates.reduce<Move | null>((b, m) => (b === null || m.die > b.die ? m : b), null)
  );
};

/**
 * The distinct boards after playing all of `order` (0 when it cannot be played in full): the
 * dedupe's regression pin (a 15-singleton board under 1-1 reaches 1654, not 15^4).
 */
export const levelCount = (board: Board, seat: Seat, order: Order, rules: VariantRules): number => {
  const levels = reachableLevels(board, seat, order, rules);
  return levels.length === order.length + 1 ? (levels.at(-1)?.length ?? 0) : 0;
};

/**
 * The same-checker chains from `from` that a maximal play allows: depth 1 is the legal first
 * moves of that checker; each chain ending on a point extends by the legal moves of that point
 * after the chain is applied. Exact by heredity, and at most 15 board applications, so the UI
 * derives two-die targets from the board and `movesLeft` instead of scanning `View.plays`.
 */
export const chainsFrom = (
  board: Board,
  seat: Seat,
  movesLeft: ReadonlyArray<Die>,
  from: From,
  rules: VariantRules,
): ReadonlyArray<Play> =>
  movesFrom(legalFirstMoves(board, seat, movesLeft, rules), from).flatMap(
    (m): ReadonlyArray<Play> =>
      m.to === 'off'
        ? [[m]]
        : [
            [m],
            ...chainsFrom(
              afterMove(board, seat, m, rules),
              seat,
              removeOne(movesLeft, m.die),
              m.to,
              rules,
            ).map((tail) => [m, ...tail]),
          ],
  );
