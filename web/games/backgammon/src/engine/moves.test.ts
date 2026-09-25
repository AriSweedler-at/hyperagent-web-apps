// The test-position table (T1-T30 and the coverage rows, in own numbering,
// deduplicated, with corrected pip counts), one row per tricky rule: bar entry, the
// higher-die rule, a low die that would kill the high die, doubles with fewer than four playable,
// exact / higher-die / highest-point bear-off, hits, blocked primes. Every row is checked three
// ways: the legal first moves equal the pinned set, they equal the first moves of `maximalPlays`
// (the enumeration is the oracle for the level-set algorithm), and after every offered move the
// continuations equal the second moves of the maximal plays (maximality is hereditary).
import { describe, expect, test } from 'vitest';

import { mulberry32 } from '../../../../shared/lib/rng.ts';
import { afterMove } from './board.ts';
import {
  distinctOutcomes,
  chainsFrom,
  expandDice,
  legalFirstMoves,
  levelCount,
  legalMoves,
  maximalPlays,
  moveKey,
  movesEqual,
  movesFrom,
  moveTo,
  playableDepth,
  reachableLevels,
  remainingDice,
  removeOne,
  singleSteps,
  sortMoves,
} from './moves.ts';
import { moveLabel } from './notation.ts';
import { pipCount } from './score.ts';
import { createGame, withPosition } from './setup.ts';
import { START, mv, pos } from './test-helpers.ts';
import type { Board, Dice, Move, Seat } from './types.ts';
import { VARIANTS } from './variants.ts';

const R = VARIANTS.portes;
const labels = (board: Board, seat: Seat, moves: ReadonlyArray<Move>): ReadonlyArray<string> =>
  moves.map((m) => moveLabel(board, seat, m, R));
const sorted = (xs: ReadonlyArray<string>): ReadonlyArray<string> => [...xs].sort();
const keys = (moves: ReadonlyArray<Move>): ReadonlySet<string> => new Set(moves.map(moveKey));

const D_START = 'D: 24:2 13:5 8:3 6:5';
const D_ANCHOR = 'D: 13:5 8:3 6:5 1:2';

type Row = Readonly<{
  id: string;
  pos: string;
  seat: Seat;
  dice: Dice;
  /** The exact legal set, own numbering, `*` a hit, `(n)` a die that is not the pip distance. */
  legal: string;
  plays?: number;
  outcomes?: number;
  /** Too many sequences to enumerate; only the legal set and the level pin are checked. */
  heavy?: true;
}>;

// prettier-ignore
const ROWS: ReadonlyArray<Row> = [
  { id: 'T1 opening 3-1', pos: START, seat: 0, dice: [3, 1], legal: '24/21 24/23 13/10 8/5 8/7 6/3 6/5', plays: 31, outcomes: 16 },
  { id: 'T2 opening 6-5 (24/19 and 6/1 blocked)', pos: START, seat: 0, dice: [6, 5], legal: '24/18 13/7 13/8 8/2 8/3', plays: 14, outcomes: 7 },
  { id: 'T3 dark mirror of T1', pos: START, seat: 1, dice: [3, 1], legal: '24/21 24/23 13/10 8/5 8/7 6/3 6/5', plays: 31, outcomes: 16 },
  { id: 'T4 opening 6-6 (portes)', pos: START, seat: 0, dice: [6, 6], legal: '24/18 13/7 8/2', plays: 71, outcomes: 11 },
  { id: 'T5 only the 1 enters, then the 6 plays', pos: `L: 24:1 13:5 8:3 6:5 | ${D_START} | bar 1/0 | off 0/0`, seat: 0, dice: [6, 1], legal: 'bar/24', plays: 3 },
  { id: 'T6 two on the bar, the 6 is forfeited', pos: `L: 13:5 8:3 6:5 | ${D_START} | bar 2/0 | off 0/0`, seat: 0, dice: [6, 1], legal: 'bar/24', plays: 1 },
  { id: 'T7 higher die: 8/7 alone is legal but the 6 has a play', pos: 'L: 8:1 | D: 24:2 13:13 | bar 0/0 | off 14/0', seat: 0, dice: [6, 1], legal: '8/2', plays: 1 },
  { id: 'T8 the low die first would leave the 6 dead', pos: 'L: 8:1 3:1 | D: 24:2 13:13 | bar 0/0 | off 13/0', seat: 0, dice: [6, 1], legal: '8/2 3/2', plays: 2, outcomes: 1 },
  { id: 'T9 doubles, three of four playable', pos: 'L: 24:1 10:1 9:1 8:1 | D: 5:2 23:2 24:2 13:9 | bar 0/0 | off 11/0', seat: 0, dice: [4, 4], legal: '10/6 9/5 8/4', plays: 6, outcomes: 1 },
  { id: 'T10 exact bear-off', pos: 'L: 6:2 5:2 4:2 3:2 2:2 1:2 | D: 13:15 | bar 0/0 | off 3/0', seat: 0, dice: [6, 5], legal: '6/off 5/off 6/1', plays: 4 },
  { id: 'T11 own 5 empty, a checker above: move inside, no 4/off', pos: 'L: 6:1 4:1 | D: 13:15 | bar 0/0 | off 13/0', seat: 0, dice: [5, 1], legal: '6/1 6/5 4/3', plays: 4 },
  { id: 'T12 nothing above 4: bear off from the highest with either die', pos: 'L: 4:1 2:1 | D: 13:15 | bar 0/0 | off 13/0', seat: 0, dice: [6, 5], legal: '4/off(6) 4/off(5)', plays: 2 },
  { id: 'T13 a dark blot on light 5', pos: `L: 24:2 13:5 8:3 6:5 | D: 24:2 13:5 8:3 6:4 20:1 | bar 0/0 | off 0/0`, seat: 0, dice: [3, 1], legal: '24/21 24/23 13/10 8/5* 8/7 6/3 6/5*', plays: 31 },
  { id: 'T14 blocked six-prime: no move', pos: 'L: 24:2 6:3 5:3 4:3 3:2 2:2 | D: 2:2 3:2 4:2 5:2 6:2 7:2 13:3 | bar 0/0 | off 0/0', seat: 0, dice: [6, 6], legal: '' },
  { id: 'T15 only the lower die has a play', pos: 'L: 24:2 6:3 5:3 4:3 3:2 2:2 | D: 2:2 3:2 4:2 5:2 6:2 7:2 13:3 | bar 0/0 | off 0/0', seat: 0, dice: [6, 5], legal: '6/1', plays: 1 },
  { id: 'T16 closed board, a checker on the bar', pos: 'L: 13:14 | D: 1:2 2:2 3:2 4:2 5:2 6:2 13:3 | bar 1/0 | off 0/0', seat: 0, dice: [3, 1], legal: '' },
  { id: 'T17 dark hits the bearing-off blot', pos: 'L: 6:2 2:1 | D: 24:1 13:14 | bar 0/0 | off 12/0', seat: 1, dice: [2, 1], legal: '24/23* 24/22 13/12 13/11', plays: 10, outcomes: 6 },
  { id: 'T18 hit while bearing off: enter first, no 6/off', pos: 'L: 6:2 | D: 23:1 11:1 13:13 | bar 1/0 | off 12/0', seat: 0, dice: [6, 2], legal: 'bar/19 bar/23', plays: 3 },
  { id: 'T19 two on the bar with 3-3', pos: `L: 13:5 8:3 6:5 | ${D_START} | bar 2/0 | off 0/0`, seat: 0, dice: [3, 3], legal: 'bar/22', plays: 11, outcomes: 8 },
  { id: 'T20 both dice above the highest point', pos: 'L: 3:1 2:1 | D: 13:15 | bar 0/0 | off 13/0', seat: 0, dice: [6, 4], legal: '3/off(6) 3/off(4)', plays: 2 },
  { id: 'T21 3/off(4) only after 5/3', pos: 'L: 5:1 3:1 | D: 13:15 | bar 0/0 | off 13/0', seat: 0, dice: [4, 2], legal: '5/1 5/3 3/1', plays: 3 },
  { id: 'T22 forced order: the 5 first', pos: 'L: 24:1 6:5 5:5 4:4 | D: 24:2 7:2 13:11 | bar 0/0 | off 0/0', seat: 0, dice: [6, 5], legal: '24/19', plays: 1 },
  { id: 'T23 only the lower die, the 6 is forfeited', pos: 'L: 24:1 6:5 5:5 4:4 | D: 7:2 6:2 13:11 | bar 0/0 | off 0/0', seat: 0, dice: [6, 5], legal: '6/1', plays: 1 },
  { id: 'T24 the 5 is dead until 6/4 makes 4 the highest', pos: 'L: 6:1 3:1 | D: 24:2 13:13 | bar 0/0 | off 13/0', seat: 0, dice: [5, 2], legal: '6/4', plays: 1 },
  { id: 'T25 the higher die must bear off the last checker', pos: 'L: 1:1 | D: 13:15 | bar 0/0 | off 14/0', seat: 0, dice: [1, 4], legal: '1/off(4)', plays: 1 },
  { id: 'T26 last checker, dark in light home', pos: 'L: 1:1 | D: 20:1 13:14 | bar 0/0 | off 14/0', seat: 0, dice: [2, 1], legal: '1/off(2)', plays: 1 },
  { id: 'T27 last checker with 1-1', pos: 'L: 1:1 | D: 13:14 | bar 0/1 | off 14/0', seat: 0, dice: [1, 1], legal: '1/off', plays: 1 },
  { id: 'T28 last checker, dark has one off', pos: 'L: 1:1 | D: 13:14 | bar 0/0 | off 14/1', seat: 0, dice: [3, 1], legal: '1/off(3)', plays: 1 },
  { id: 'T29 2-2 in the home board: 1/off not first', pos: 'L: 6:1 3:1 2:1 1:1 | D: 13:15 | bar 0/0 | off 11/0', seat: 0, dice: [2, 2], legal: '6/4 3/1 2/off', plays: 15, outcomes: 2 },
  { id: 'T30 either die enters, then the other is free', pos: `L: 24:1 13:5 8:3 6:5 | ${D_START} | bar 1/0 | off 0/0`, seat: 0, dice: [4, 2], legal: 'bar/21 bar/23', plays: 8, outcomes: 8 },
  { id: 'P07 neither die enters: the roll is forfeited', pos: 'L: 24:1 13:5 8:3 6:5 | D: 24:2 13:3 6:2 5:2 4:2 3:2 2:2 | bar 1/0 | off 0/0', seat: 0, dice: [6, 4], legal: '' },
  { id: 'P08 two on the bar, only the 5 enters', pos: 'L: 13:5 8:3 6:5 | D: 24:2 13:3 8:3 6:5 2:2 | bar 2/0 | off 0/0', seat: 0, dice: [5, 2], legal: 'bar/20', plays: 1 },
  { id: 'P09 higher die: both playable alone, neither continues', pos: 'L: 13:1 1:14 | D: 20:2 5:13 | bar 0/0 | off 0/0', seat: 0, dice: [6, 2], legal: '13/7', plays: 1 },
  { id: 'P10 only the low die is playable', pos: 'L: 13:1 1:14 | D: 20:2 18:2 5:11 | bar 0/0 | off 0/0', seat: 0, dice: [6, 2], legal: '13/11', plays: 1 },
  { id: 'P11 order matters: the 6 must go first', pos: 'L: 13:1 1:14 | D: 15:2 5:13 | bar 0/0 | off 0/0', seat: 0, dice: [6, 3], legal: '13/7', plays: 1 },
  { id: 'P12 13/8 is a legal step but leaves no 3', pos: 'L: 13:1 9:1 1:13 | D: 20:2 19:2 15:2 5:9 | bar 0/0 | off 0/0', seat: 0, dice: [5, 3], legal: '9/4', plays: 1 },
  { id: 'P13 doubles with three playable', pos: 'L: 12:1 9:1 8:1 6:1 1:11 | D: 23:2 21:2 5:11 | bar 0/0 | off 0/0', seat: 0, dice: [4, 4], legal: '12/8 9/5', plays: 3 },
  { id: 'P15 bear-off exact, 4/1 blocked by the anchor', pos: `L: 6:3 5:3 4:3 3:3 2:3 | ${D_START} | bar 0/0 | off 0/0`, seat: 0, dice: [6, 3], legal: '6/off 6/3 5/2 3/off', plays: 6 },
  { id: 'P16 rolled points empty, checkers above: move inside', pos: `L: 6:2 5:2 2:4 1:7 | ${D_ANCHOR} | bar 0/0 | off 0/0`, seat: 0, dice: [4, 3], legal: '6/2 5/1 6/3 5/2', plays: 8 },
  { id: 'P17 nothing above: bear off from the highest with either die', pos: `L: 3:2 2:1 1:2 | ${D_ANCHOR} | bar 0/0 | off 10/0`, seat: 0, dice: [6, 5], legal: '3/off(6) 3/off(5)', plays: 2 },
  { id: 'P18 exact, highest-with-big-die and inside', pos: `L: 4:1 2:1 | ${D_ANCHOR} | bar 0/0 | off 13/0`, seat: 0, dice: [6, 2], legal: '4/off(6) 4/2 2/off', plays: 3 },
  { id: 'P19 only the exact 6; the 5 is blocked by the anchor', pos: `L: 6:1 | ${D_START} | bar 0/0 | off 14/0`, seat: 0, dice: [6, 5], legal: '6/off', plays: 1 },
  { id: 'P20 a hit with either die', pos: 'L: 24:2 13:5 8:3 6:5 | D: 24:1 20:1 13:5 8:3 6:5 | bar 0/0 | off 0/0', seat: 0, dice: [3, 1], legal: '24/21 24/23 13/10 8/7 8/5* 6/5* 6/3', plays: 31 },
  { id: 'P21 blocked six-prime, two back: no move', pos: 'L: 24:2 6:5 5:4 4:4 | D: 13:3 7:2 6:2 5:2 4:2 3:2 2:2 | bar 0/0 | off 0/0', seat: 0, dice: [6, 6], legal: '' },
  { id: 'P22 closed but for the 24-point: one enters', pos: 'L: 6:5 5:4 4:4 | D: 13:3 7:2 6:2 5:2 4:2 3:2 2:2 | bar 2/0 | off 0/0', seat: 0, dice: [3, 1], legal: 'bar/24', plays: 1 },
  { id: 'P23 hit while bearing off: enter, never 3/off', pos: 'L: 5:2 3:1 | D: 24:2 3:2 1:11 | bar 1/0 | off 11/0', seat: 0, dice: [6, 3], legal: 'bar/19', plays: 2 },
  { id: 'P24 dark enters and hits with the 4', pos: 'L: 24:2 13:5 8:3 6:4 4:1 | D: 24:1 13:5 8:3 6:5 | bar 0/1 | off 0/0', seat: 1, dice: [4, 2], legal: 'bar/23 bar/21*', plays: 8 },
  { id: 'P25 dark bears off, its 1-point blocked', pos: 'L: 24:2 13:5 8:3 6:5 | D: 6:3 5:3 4:3 3:3 2:3 | bar 0/0 | off 0/0', seat: 1, dice: [6, 1], legal: '6/off 6/5 5/4 4/3 3/2', plays: 8 },
  { id: 'P26 opening 1-1', pos: START, seat: 0, dice: [1, 1], legal: '24/23 8/7 6/5', plays: 245 },
  { id: 'P27 fifteen singletons with 1-1 (worst case)', pos: 'L: 24:1 22:1 20:1 18:1 16:1 14:1 13:1 11:1 10:1 9:1 8:1 7:1 6:1 5:1 4:1 | D: 24:15 | bar 0/0 | off 0/0', seat: 0, dice: [1, 1], legal: '24/23 22/21 20/19 18/17 16/15 14/13 13/12 11/10 10/9 9/8 8/7 7/6 6/5 5/4 4/3', heavy: true },
  { id: 'P28 fifteen singletons with 2-2', pos: 'L: 24:1 22:1 20:1 18:1 16:1 14:1 13:1 11:1 10:1 9:1 8:1 7:1 6:1 5:1 4:1 | D: 24:15 | bar 0/0 | off 0/0', seat: 0, dice: [2, 2], legal: '24/22 22/20 20/18 18/16 16/14 14/12 13/11 11/9 10/8 9/7 8/6 7/5 6/4 5/3 4/2', heavy: true },
  { id: 'P29 chained hits with 4-4', pos: 'L: 24:2 13:5 8:3 6:5 | D: 24:3 13:5 9:1 8:3 6:2 5:1 | bar 0/0 | off 0/0', seat: 0, dice: [4, 4], legal: '24/20* 13/9 8/4 6/2', plays: 411 },
  { id: 'P30 bear-off doubles: 4/off(6) only after both 6s are off', pos: `L: 6:2 4:3 1:2 | ${D_ANCHOR} | bar 0/0 | off 8/0`, seat: 0, dice: [6, 6], legal: '6/off', plays: 1 },
  { id: 'P31 four off with 6s from the 3-point', pos: `L: 3:4 | ${D_ANCHOR} | bar 0/0 | off 11/0`, seat: 0, dice: [6, 6], legal: '3/off(6)', plays: 1 },
  { id: 'P32 either die enters and hits', pos: 'L: 24:1 13:5 8:3 6:5 | D: 24:2 13:4 8:3 6:4 5:1 3:1 | bar 1/0 | off 0/0', seat: 0, dice: [5, 3], legal: 'bar/20* bar/22*', plays: 6 },
];

describe('the test-position table', () => {
  ROWS.forEach((row) => {
    test(row.id, () => {
      const board = pos(row.pos);
      const dice = expandDice(row.dice);
      const legal = legalFirstMoves(board, row.seat, dice, R);
      const expected = row.legal === '' ? [] : row.legal.split(' ');
      expect(sorted(labels(board, row.seat, legal))).toEqual(sorted(expected));
      // Canonical order (bar < 0..23 < off, die descending) and no duplicates.
      expect(legal).toEqual(sortMoves(legal));
      expect(keys(legal).size).toBe(legal.length);
      // legalMoves(state) is the same function of (board, dice, played).
      const game = createGame(
        [
          { id: 'a', name: 'Ari' },
          { id: 'b', name: 'Jeff' },
        ],
        {},
        mulberry32(1),
        () => 0,
      );
      expect(legalMoves(withPosition(game, board, row.seat, row.dice))).toEqual(legal);
      if (row.heavy === true) return;
      // The enumeration is the oracle for the root set...
      const plays = maximalPlays(board, row.seat, dice, R);
      expect(keys(plays.flatMap((p) => p.slice(0, 1)))).toEqual(keys(legal));
      if (row.plays !== undefined) expect(plays).toHaveLength(row.plays);
      if (row.outcomes !== undefined)
        expect(distinctOutcomes(board, row.seat, dice, R)).toHaveLength(row.outcomes);
      // ...and maximality is hereditary: every offered move's continuations are the second moves.
      legal.forEach((m) => {
        const after = afterMove(board, row.seat, m, R);
        const next = legalFirstMoves(after, row.seat, removeOne(dice, m.die), R);
        const seconds = plays.filter((p) => movesEqual(p[0] ?? m, m)).flatMap((p) => p.slice(1, 2));
        expect(keys(next)).toEqual(keys(seconds));
        expect(next).toEqual(sortMoves(next));
      });
    });
  });
});

describe('continuations pinned by the table notes', () => {
  const after = (text: string, seat: Seat, moves: ReadonlyArray<string>): Board =>
    moves.reduce((b, m) => afterMove(b, seat, mv(seat, m), R), pos(text));
  const legalAfter = (text: string, seat: Seat, dice: Dice, moves: ReadonlyArray<string>) => {
    const b = after(text, seat, moves);
    const rest = moves.reduce((d, m) => removeOne(d, mv(seat, m).die), expandDice(dice));
    return sorted(labels(b, seat, legalFirstMoves(b, seat, rest, R)));
  };
  const t5 = `L: 24:1 13:5 8:3 6:5 | ${D_START} | bar 1/0 | off 0/0`;
  const t13 = 'L: 24:2 13:5 8:3 6:5 | D: 24:2 13:5 8:3 6:4 20:1 | bar 0/0 | off 0/0';
  const t30 = `L: 24:1 13:5 8:3 6:5 | ${D_START} | bar 1/0 | off 0/0`;

  test('T5: after bar/24 the 6 plays anywhere; T6: nothing after the entry', () => {
    expect(legalAfter(t5, 0, [6, 1], ['bar/24'])).toEqual(sorted(['24/18', '13/7', '8/2']));
    const t6 = `L: 13:5 8:3 6:5 | ${D_START} | bar 2/0 | off 0/0`;
    expect(legalAfter(t6, 0, [6, 1], ['bar/24'])).toEqual([]);
  });

  test('T13: after 8/5* the blot is on the bar and 6/5 covers', () => {
    const b = after(t13, 0, ['8/5*']);
    expect(b.bar).toEqual([0, 1]);
    expect(b.points[4]).toEqual([0]);
    expect(legalAfter(t13, 0, [3, 1], ['8/5*'])).toEqual(sorted(['5/4', '6/5', '8/7', '24/23']));
    expect(after(t13, 0, ['8/5*', '6/5']).points[4]).toEqual([0, 0]);
  });

  test('T19, T21, T24, T30, P30: the second move set', () => {
    const t19 = `L: 13:5 8:3 6:5 | ${D_START} | bar 2/0 | off 0/0`;
    expect(legalAfter(t19, 0, [3, 3], ['bar/22', 'bar/22'])).toEqual(
      sorted(['13/10', '8/5', '6/3']),
    );
    expect(legalAfter('L: 5:1 3:1 | D: 13:15 | bar 0/0 | off 13/0', 0, [4, 2], ['5/3'])).toEqual([
      '3/off(4)',
    ]);
    expect(
      legalAfter('L: 6:1 3:1 | D: 24:2 13:13 | bar 0/0 | off 13/0', 0, [5, 2], ['6/4']),
    ).toEqual(['4/off(5)']);
    expect(legalAfter(t30, 0, [4, 2], ['bar/21'])).toEqual(
      sorted(['24/22', '13/11', '8/6', '6/4']),
    );
    expect(legalAfter(t30, 0, [4, 2], ['bar/23'])).toEqual(sorted(['24/20', '13/9', '8/4', '6/2']));
    const p30 = `L: 6:2 4:3 1:2 | ${D_ANCHOR} | bar 0/0 | off 8/0`;
    expect(legalAfter(p30, 0, [6, 6], ['6/off'])).toEqual(['6/off']);
    expect(legalAfter(p30, 0, [6, 6], ['6/off', '6/off'])).toEqual(['4/off(6)']);
  });

  test('P29: chained hits grow the bar by one each and add 20 and 16 pips', () => {
    const p29 = 'L: 24:2 13:5 8:3 6:5 | D: 24:3 13:5 9:1 8:3 6:2 5:1 | bar 0/0 | off 0/0';
    // The corrected count: dark's own 5 then own 9 go to the bar (25): 187 -> 207 -> 223.
    expect(pipCount(pos(p29), 1, R)).toBe(187);
    const one = after(p29, 0, ['24/20*']);
    expect(one.bar).toEqual([0, 1]);
    expect(pipCount(one, 1, R)).toBe(207);
    expect(labels(one, 0, movesFrom(legalFirstMoves(one, 0, [4, 4, 4], R), 19))).toEqual([
      '20/16*',
    ]);
    const two = after(p29, 0, ['24/20*', '20/16*']);
    expect(two.bar).toEqual([0, 2]);
    expect(pipCount(two, 1, R)).toBe(223);
  });
});

describe('the worst cases: fifteen singletons under doubles', () => {
  // Consecutive singletons with nothing blocked, then the same with the 1-point blocked (P27).
  const e1 = pos(
    'L: 21:1 20:1 19:1 18:1 17:1 16:1 15:1 14:1 13:1 12:1 11:1 10:1 9:1 8:1 7:1 | D: 1:15 | bar 0/0 | off 0/0',
  );
  const p27 = pos(
    'L: 24:1 22:1 20:1 18:1 16:1 14:1 13:1 11:1 10:1 9:1 8:1 7:1 6:1 5:1 4:1 | D: 24:15 | bar 0/0 | off 0/0',
  );

  test('the level sets are deduplicated: 1654 boards at level 4 for E1, 2135 for P27', () => {
    expect(reachableLevels(e1, 0, [1, 1, 1, 1], R).map((l) => l.length)).toEqual([
      1, 15, 106, 484, 1654,
    ]);
    expect(reachableLevels(p27, 0, [1, 1, 1, 1], R).map((l) => l.length)).toEqual([
      1, 15, 112, 561, 2135,
    ]);
    expect(reachableLevels(p27, 0, [2, 2, 2, 2], R).map((l) => l.length)).toEqual([
      1, 15, 106, 481, 1614,
    ]);
    expect(playableDepth(e1, 0, [1, 1, 1, 1], R)).toBe(4);
    expect(playableDepth(pos(START), 0, [6, 5], R)).toBe(2);
    expect(
      playableDepth(
        pos('L: 13:14 | D: 1:2 2:2 3:2 4:2 5:2 6:2 13:3 | bar 1/0 | off 0/0'),
        0,
        [3, 1],
        R,
      ),
    ).toBe(0);
  });

  test('legalFirstMoves offers every singleton on both worst-case boards', () => {
    // No wall-clock bound: CI's coverage job ran these at 222 ms under v8 instrumentation where
    // node alone takes 40-70 ms, so a duration pin flakes; the level-set counts above are the
    // guard against recomputing the levels per first move (15^4 sequences, not 1654 boards).
    expect(legalFirstMoves(e1, 0, [1, 1, 1, 1], R)).toHaveLength(15);
    expect(legalFirstMoves(p27, 0, [1, 1, 1, 1], R)).toHaveLength(15);
  });
});

describe('dice and move helpers', () => {
  test('expandDice, removeOne', () => {
    expect(expandDice([3, 1])).toEqual([3, 1]);
    expect(expandDice([4, 4])).toEqual([4, 4, 4, 4]);
    expect(removeOne([4, 4, 4], 4)).toEqual([4, 4]);
    expect(removeOne([3, 1], 1)).toEqual([3]);
    expect(removeOne([3, 1], 6)).toEqual([3, 1]);
  });

  test('remainingDice follows the phase and the played dice', () => {
    const game = createGame(
      [
        { id: 'a', name: 'Ari' },
        { id: 'b', name: 'Jeff' },
      ],
      {},
      mulberry32(1),
      () => 0,
    );
    expect(game.phase).toBe('toRoll');
    expect(remainingDice(game)).toEqual([]);
    const s = withPosition(game, pos(START), 0, [3, 1]);
    expect(remainingDice(s)).toEqual([3, 1]);
    expect(remainingDice({ ...s, played: [{ ...mv(0, '8/5'), hit: false }] })).toEqual([1]);
    expect(
      remainingDice({ ...s, dice: [2, 2], played: [{ ...mv(0, '8/6'), hit: false }] }),
    ).toEqual([2, 2, 2]);
    expect(legalMoves({ ...s, phase: 'toRoll' })).toEqual([]);
    expect(legalFirstMoves(pos(START), 0, [], R)).toEqual([]);
  });

  test('levelCount: the distinct boards after the whole order, 0 when it cannot all be played', () => {
    const e1 = pos(
      'L: 21:1 20:1 19:1 18:1 17:1 16:1 15:1 14:1 13:1 12:1 11:1 10:1 9:1 8:1 7:1 | D: 1:15 | bar 0/0 | off 0/0',
    );
    expect(levelCount(e1, 0, [1, 1, 1, 1], R)).toBe(1654);
    expect(levelCount(pos(START), 0, [3, 1], R)).toBe(
      reachableLevels(pos(START), 0, [3, 1], R)[2]?.length,
    );
    expect(
      levelCount(
        pos('L: 24:1 10:1 9:1 8:1 | D: 5:2 23:2 24:2 13:9 | bar 0/0 | off 11/0'),
        0,
        [4, 4, 4, 4],
        R,
      ),
    ).toBe(0);
    expect(levelCount(pos('L: 8:1 | D: 24:2 13:13 | bar 0/0 | off 14/0'), 0, [1, 6], R)).toBe(0);
  });

  test('chainsFrom: the same-checker chains a maximal play allows', () => {
    const chains = (text: string, seat: Seat, dice: Dice, from: Move['from']) =>
      chainsFrom(pos(text), seat, expandDice(dice), from, R).map((c) =>
        c
          .map((m, i) =>
            moveLabel(
              c.slice(0, i).reduce((b, x) => afterMove(b, seat, x, R), pos(text)),
              seat,
              m,
              R,
            ),
          )
          .join(' '),
      );
    expect(sorted(chains(START, 0, [3, 1], 23))).toEqual(
      sorted(['24/21', '24/21 21/20', '24/23', '24/23 23/20']),
    );
    expect(
      chains(`L: 24:1 13:5 8:3 6:5 | ${D_START} | bar 1/0 | off 0/0`, 0, [6, 1], 'bar'),
    ).toEqual(['bar/24', 'bar/24 24/18']);
    expect(chains('L: 4:1 2:1 | D: 13:15 | bar 0/0 | off 13/0', 0, [6, 5], 3)).toEqual([
      '4/off(6)',
      '4/off(5)',
    ]);
    expect(chains(START, 0, [3, 1], 12)).toEqual(['13/10', '13/10 10/9']);
    expect(chains(START, 0, [3, 1], 0)).toEqual([]);
  });

  test('moveKey, sortMoves, movesEqual, movesFrom', () => {
    const a = mv(0, 'bar/20');
    const b = mv(0, '4/off(6)');
    const c = mv(0, '4/off(5)');
    const d = mv(0, '8/5');
    expect(moveKey(a)).toBe('-1>19/5');
    expect(moveKey(b)).toBe('3>24/6');
    expect(sortMoves([d, c, b, a])).toEqual([a, b, c, d]);
    expect(movesEqual(b, { ...b })).toBe(true);
    expect(movesEqual(b, c)).toBe(false);
    expect(movesFrom([a, b, c, d], 3)).toEqual([b, c]);
    expect(movesFrom([a, b, c, d], 'bar')).toEqual([a]);
  });

  test('moveTo: the exact die when own(from) === die, else the largest legal die', () => {
    const exact = legalFirstMoves(pos('L: 4:1 2:1 | D: 13:15 | bar 0/0 | off 13/0'), 0, [6, 4], R);
    expect(moveTo(exact, 3, 'off', 0, R)).toEqual(mv(0, '4/off'));
    const t20 = legalFirstMoves(pos('L: 3:1 2:1 | D: 13:15 | bar 0/0 | off 13/0'), 0, [6, 4], R);
    expect(moveTo(t20, 2, 'off', 0, R)).toEqual(mv(0, '3/off(6)'));
    const t1 = legalFirstMoves(pos(START), 0, [3, 1], R);
    expect(moveTo(t1, 7, 4, 0, R)).toEqual(mv(0, '8/5'));
    expect(moveTo(t1, 7, 'off', 0, R)).toBeNull();
    expect(moveTo(t1, 12, 11, 0, R)).toBeNull();
    const bar = legalFirstMoves(pos(t5Pos), 0, [6, 1], R);
    expect(moveTo(bar, 'bar', 23, 0, R)).toEqual(mv(0, 'bar/24'));
  });
  const t5Pos = `L: 24:1 13:5 8:3 6:5 | ${D_START} | bar 1/0 | off 0/0`;

  test('singleSteps: with a checker on the bar only the entry is offered', () => {
    const b = pos(`L: 24:1 13:5 8:3 6:5 | ${D_START} | bar 1/0 | off 0/0`);
    expect(labels(b, 0, singleSteps(b, 0, 1, R))).toEqual(['bar/24']);
    expect(singleSteps(b, 0, 6, R)).toEqual([]);
    const dark = pos(`L: 24:2 13:5 8:3 6:5 | ${D_START} | bar 0/1 | off 0/0`);
    expect(singleSteps(dark, 1, 3, R)).toEqual([{ from: 'bar', to: 2, die: 3 }]);
    expect(singleSteps(dark, 1, 6, R)).toEqual([]);
  });
});
