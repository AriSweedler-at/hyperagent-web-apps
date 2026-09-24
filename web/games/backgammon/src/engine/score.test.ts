// Scoring (rules R17, R18, R21-R24): pip counts with the
// corrected rows (T13, P20), the winner and the multiplier on the end-position table for
// both variants, and the match arithmetic including the Crawford flags.
import { describe, expect, test } from 'vitest';

import { afterMove } from './board.ts';
import { parseMove, parsePosition } from './notation.ts';
import { crawfordFor, matchOver, matchWinner, multiplierFor, pipCount, winnerOf } from './score.ts';
import type { Board, Match, Seat } from './types.ts';
import { VARIANTS } from './variants.ts';

const P = VARIANTS.portes;
const W = VARIANTS.backgammon;
const pos = (text: string): Board => {
  const r = parsePosition(text, P);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const START = pos('L: 24:2 13:5 8:3 6:5 | D: 24:2 13:5 8:3 6:5 | bar 0/0 | off 0/0');

describe('pipCount (R24)', () => {
  test('167 each at the start; T9, T14; a hit adds 25 minus the blot own point', () => {
    expect(pipCount(START, 0, P)).toBe(167);
    expect(pipCount(START, 1, P)).toBe(167);
    expect(
      pipCount(pos('L: 24:1 10:1 9:1 8:1 | D: 5:2 23:2 24:2 13:9 | bar 0/0 | off 11/0'), 0, P),
    ).toBe(51);
    const t14 = pos(
      'L: 24:2 6:3 5:3 4:3 3:2 2:2 | D: 2:2 3:2 4:2 5:2 6:2 7:2 13:3 | bar 0/0 | off 0/0',
    );
    expect(pipCount(t14, 0, P)).toBe(103);
    expect(pipCount(t14, 1, P)).toBe(93);
    // T13 (corrected): dark is 181 before 8/5* and 186 after (own 20 -> the bar, 25).
    const t13 = pos('L: 24:2 13:5 8:3 6:5 | D: 24:2 13:5 8:3 6:4 20:1 | bar 0/0 | off 0/0');
    expect(pipCount(t13, 1, P)).toBe(181);
    const hit = parseMove(0, '8/5*', P);
    expect(hit.ok && pipCount(afterMove(t13, 0, hit.value, P), 1, P)).toBe(186);
    // P20 (corrected): 163 -> 168.
    const p20 = pos('L: 24:2 13:5 8:3 6:5 | D: 24:1 20:1 13:5 8:3 6:5 | bar 0/0 | off 0/0');
    expect(pipCount(p20, 1, P)).toBe(163);
    expect(hit.ok && pipCount(afterMove(p20, 0, hit.value, P), 1, P)).toBe(168);
    expect(pipCount(pos('L: | D: 13:15 | bar 0/0 | off 15/0'), 0, P)).toBe(0);
  });
});

describe('winnerOf and multiplierFor (R17/R18)', () => {
  test('winnerOf: fifteen off', () => {
    expect(winnerOf(START)).toBeNull();
    expect(winnerOf(pos('L: | D: 13:15 | bar 0/0 | off 15/0'))).toBe(0);
    expect(winnerOf(pos('L: 13:15 | D: | bar 0/0 | off 0/15'))).toBe(1);
  });

  /** Light has just borne off its last checker; [position, Western, portes]. */
  const rows: ReadonlyArray<readonly [string, string, 1 | 2 | 3, 1 | 2]> = [
    ['T25: dark has nothing off, nothing behind', 'L: | D: 13:15 | bar 0/0 | off 15/0', 2, 2],
    ['T26: a dark checker in light home', 'L: | D: 20:1 13:14 | bar 0/0 | off 15/0', 3, 2],
    ['T27: a dark checker on the bar', 'L: | D: 13:14 | bar 0/1 | off 15/0', 3, 2],
    ['T28: dark has borne off one', 'L: | D: 13:14 | bar 0/0 | off 15/1', 1, 1],
    [
      'E1: dark has borne off one, all home',
      'L: | D: 6:5 5:4 4:2 3:2 2:1 | bar 0/0 | off 15/1',
      1,
      1,
    ],
    [
      'E2: nothing off, nothing on the bar or in light home',
      'L: | D: 18:2 13:3 8:3 6:5 1:2 | bar 0/0 | off 15/0',
      2,
      2,
    ],
    [
      'E3: a dark checker on light 3 (dark own 22)',
      'L: | D: 22:1 13:4 8:3 6:5 1:2 | bar 0/0 | off 15/0',
      3,
      2,
    ],
    ['E4: a dark checker on the bar', 'L: | D: 13:4 8:3 6:5 1:2 | bar 0/1 | off 15/0', 3, 2],
    [
      'E5: dark on light 7 is the outer board, not home',
      'L: | D: 18:1 13:4 8:3 6:5 1:2 | bar 0/0 | off 15/0',
      2,
      2,
    ],
    [
      'P19: two dark on light 1 (dark own 24)',
      'L: | D: 24:2 13:5 8:3 6:5 | bar 0/0 | off 15/0',
      3,
      2,
    ],
  ];
  rows.forEach(([name, text, western, portes]) => {
    test(name, () => {
      const b = pos(text);
      expect(multiplierFor(b, 0, W)).toBe(western);
      expect(multiplierFor(b, 0, P)).toBe(portes);
    });
  });

  test('mirrored for a dark winner', () => {
    expect(multiplierFor(pos('L: 20:1 13:14 | D: | bar 0/0 | off 0/15'), 1, W)).toBe(3);
    expect(multiplierFor(pos('L: 13:14 | D: | bar 1/0 | off 0/15'), 1, W)).toBe(3);
    expect(multiplierFor(pos('L: 13:15 | D: | bar 0/0 | off 0/15'), 1, W)).toBe(2);
    expect(multiplierFor(pos('L: 13:14 | D: | bar 0/0 | off 1/15'), 1, W)).toBe(1);
  });
});

describe('match arithmetic (R21/R22)', () => {
  const m = (length: number, score: readonly [number, number], crawfordDone = false): Match => ({
    length,
    score,
    crawfordDone,
    isCrawfordGame: false,
  });

  test('matchWinner and matchOver: first to length, overshoot allowed', () => {
    expect(matchWinner(m(5, [4, 2]))).toBeNull();
    expect(matchOver(m(5, [4, 2]))).toBe(false);
    expect(matchWinner(m(5, [5, 2]))).toBe(0);
    expect(matchWinner(m(5, [2, 7]))).toBe(1);
    expect(matchOver(m(1, [0, 1]))).toBe(true);
  });

  test('crawfordFor: once, only with a cube, when a score sits at length - 1', () => {
    expect(crawfordFor(m(5, [4, 2]), W)).toEqual({ isCrawfordGame: true, crawfordDone: true });
    expect(crawfordFor(m(5, [2, 4]), W)).toEqual({ isCrawfordGame: true, crawfordDone: true });
    expect(crawfordFor(m(5, [4, 2], true), W)).toEqual({
      isCrawfordGame: false,
      crawfordDone: true,
    });
    expect(crawfordFor(m(5, [3, 2]), W)).toEqual({ isCrawfordGame: false, crawfordDone: false });
    expect(crawfordFor(m(1, [0, 0]), W)).toEqual({ isCrawfordGame: true, crawfordDone: true });
    expect(crawfordFor(m(5, [4, 2]), P)).toEqual({ isCrawfordGame: false, crawfordDone: false });
    const seats: ReadonlyArray<Seat> = [0, 1];
    seats.forEach((s) => {
      expect(matchWinner(m(3, s === 0 ? [3, 0] : [0, 3]))).toBe(s);
    });
  });
});
