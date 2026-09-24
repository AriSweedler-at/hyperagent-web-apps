// The board primitives (rules R2, R8, R10, R11, R15): the
// frame from own to absolute numbering, `isOpen` with the single-opponent hook, `afterMove` for
// plain moves, hits, pins, bar entry and bearing off, and the shape checks the decoders lean on.
import { describe, expect, test } from 'vitest';

import {
  afterMove,
  boardKey,
  canBearOff,
  checkerCount,
  emptyBoard,
  entryPoint,
  highestPoint,
  hits,
  isHomogeneous,
  isOpen,
  isWellFormed,
  otherSeat,
  setAt,
  stackAt,
  topIs,
} from './board.ts';
import { parsePosition } from './notation.ts';
import type { Board, Stack, VariantRules } from './types.ts';
import { VARIANTS } from './variants.ts';

const R = VARIANTS.portes;
const pos = (text: string): Board => {
  const r = parsePosition(text, R);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const START = pos('L: 24:2 13:5 8:3 6:5 | D: 24:2 13:5 8:3 6:5 | bar 0/0 | off 0/0');

describe('primitives', () => {
  test('otherSeat, setAt, stackAt, topIs', () => {
    expect(otherSeat(0)).toBe(1);
    expect(otherSeat(1)).toBe(0);
    expect(setAt([1, 2], 0, 9)).toEqual([9, 2]);
    expect(setAt([1, 2], 1, 9)).toEqual([1, 9]);
    expect(stackAt(START, 23)).toEqual([0, 0]);
    expect(stackAt(START, 99)).toEqual([]);
    expect(topIs([1, 0], 0)).toBe(true);
    expect(topIs([1, 0], 1)).toBe(false);
    expect(topIs([], 0)).toBe(false);
  });

  test('emptyBoard has 24 empty points and nothing on the bar or off', () => {
    const b = emptyBoard();
    expect(b.points).toHaveLength(24);
    expect(b.points.every((st) => st.length === 0)).toBe(true);
    expect(b.bar).toEqual([0, 0]);
    expect(b.off).toEqual([0, 0]);
  });

  test('entryPoint: a die n enters on own 25 - n', () => {
    expect(entryPoint(0, 6, R)).toBe(18);
    expect(entryPoint(0, 1, R)).toBe(23);
    expect(entryPoint(1, 6, R)).toBe(5);
    expect(entryPoint(1, 1, R)).toBe(0);
  });
});

describe('isOpen (R8 + the single-opponent hook)', () => {
  const pin: VariantRules = VARIANTS.plakoto;
  const illegal: VariantRules = VARIANTS.fevga;
  const rows: ReadonlyArray<readonly [string, Stack, VariantRules, boolean]> = [
    ['empty', [], R, true],
    ['own checkers', [0, 0, 0], R, true],
    ['a blot under hit rules', [1], R, true],
    ['two opponents block', [1, 1], R, false],
    ['a blot under pin rules', [1], pin, true],
    ['a point I already pin takes more of mine', [1, 0], pin, true],
    ['a checker that is itself pinning cannot be pinned', [0, 1], pin, false],
    ['two opponents block under pin rules too', [1, 1], pin, false],
    ['a lone opponent blocks under illegal rules (fevga blocks on one)', [1], illegal, false],
  ];
  rows.forEach(([name, stack, rules, open]) => {
    test(name, () => {
      expect(isOpen(stack, 0, rules)).toBe(open);
    });
  });
});

describe('afterMove', () => {
  test('a plain move lifts the top checker and lands it', () => {
    const b = afterMove(START, 0, { from: 7, to: 4, die: 3 }, R);
    expect(stackAt(b, 7)).toEqual([0, 0]);
    expect(stackAt(b, 4)).toEqual([0]);
    expect(b.bar).toEqual([0, 0]);
    expect(b.off).toEqual([0, 0]);
    expect(checkerCount(b, 0)).toBe(15);
  });

  test('a hit sends the blot to the opponent bar', () => {
    const b0 = pos('L: 8:1 | D: 20:1 | bar 0/0 | off 0/0');
    const move = { from: 7, to: 4, die: 3 } as const;
    expect(hits(b0, 0, move, R)).toBe(true);
    const b = afterMove(b0, 0, move, R);
    expect(stackAt(b, 4)).toEqual([0]);
    expect(b.bar).toEqual([0, 1]);
    expect(hits(b0, 0, { from: 7, to: 'off', die: 6 }, R)).toBe(false);
    expect(hits(b0, 0, move, VARIANTS.plakoto)).toBe(false);
  });

  test('a pin pushes on top of the lone opposing checker', () => {
    const b0 = pos('L: 8:1 | D: 20:1 | bar 0/0 | off 0/0');
    const b = afterMove(b0, 0, { from: 7, to: 4, die: 3 }, VARIANTS.plakoto);
    expect(stackAt(b, 4)).toEqual([1, 0]);
    expect(b.bar).toEqual([0, 0]);
    expect(isHomogeneous(b)).toBe(false);
  });

  test('bar entry decrements the bar; bearing off increments off', () => {
    const b0 = pos('L: 6:1 | D: 13:15 | bar 1/0 | off 13/0');
    const entered = afterMove(b0, 0, { from: 'bar', to: 20, die: 4 }, R);
    expect(entered.bar).toEqual([0, 0]);
    expect(stackAt(entered, 20)).toEqual([0]);
    const off = afterMove(entered, 0, { from: 5, to: 'off', die: 6 }, R);
    expect(off.off).toEqual([14, 0]);
    expect(stackAt(off, 5)).toEqual([]);
  });
});

describe('bear-off and structure', () => {
  test('canBearOff needs an empty bar and every checker home; highestPoint is own-numbered', () => {
    const home = pos('L: 6:2 4:1 | D: 24:2 13:13 | bar 0/0 | off 12/0');
    expect(canBearOff(home, 0, R)).toBe(true);
    expect(canBearOff(home, 1, R)).toBe(false);
    expect(highestPoint(home, 0, R)).toBe(6);
    expect(highestPoint(home, 1, R)).toBe(24);
    expect(canBearOff({ ...home, bar: [1, 0] }, 0, R)).toBe(false);
    expect(canBearOff(pos('L: 7:1 6:1 | D: 13:15 | bar 0/0 | off 13/0'), 0, R)).toBe(false);
    expect(highestPoint(pos('L: | D: 13:15 | bar 0/0 | off 15/0'), 0, R)).toBe(0);
  });

  test('checkerCount, isHomogeneous, isWellFormed', () => {
    expect(checkerCount(START, 0)).toBe(15);
    expect(checkerCount(START, 1)).toBe(15);
    expect(isHomogeneous(START)).toBe(true);
    expect(isWellFormed(START)).toBe(true);
    expect(isWellFormed({ ...START, points: START.points.slice(1) })).toBe(false);
    expect(isWellFormed({ ...START, off: [1, 0] })).toBe(false);
    expect(isWellFormed({ ...START, bar: [-1, 1] })).toBe(false);
  });

  test('boardKey tells stack order apart and equal boards together', () => {
    const a = pos('L: 8:1 | D: 20:1 | bar 0/0 | off 0/0');
    expect(boardKey(a)).toBe(boardKey(pos('L: 8:1 | D: 20:1 | bar 0/0 | off 0/0')));
    const pinned = afterMove(a, 0, { from: 7, to: 4, die: 3 }, VARIANTS.plakoto);
    const flipped: Stack = [0, 1];
    const reversed = { ...pinned, points: pinned.points.map((st, i) => (i === 4 ? flipped : st)) };
    expect(boardKey(pinned)).not.toBe(boardKey(reversed));
    expect(boardKey(START)).toContain('|0/0|0/0');
  });
});
