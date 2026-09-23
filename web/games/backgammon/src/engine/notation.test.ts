import { describe, expect, test } from 'vitest';

import {
  diceText,
  formatPosition,
  moveLabel,
  moveText,
  parseMove,
  parsePosition,
  playText,
  pointName,
  pointsText,
} from './notation.ts';
import type { Board, Move } from './types.ts';
import { VARIANTS } from './variants.ts';

const R = VARIANTS.portes;
const pos = (text: string): Board => {
  const r = parsePosition(text, R);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const mv = (seat: 0 | 1, text: string): Move => {
  const r = parseMove(seat, text, R);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const START = 'L: 24:2 13:5 8:3 6:5 | D: 24:2 13:5 8:3 6:5 | bar 0/0 | off 0/0';

describe('move text (R28)', () => {
  test('pointName and moveText speak the mover own numbering', () => {
    expect(pointName(0, 'bar', R)).toBe('bar');
    expect(pointName(0, 'off', R)).toBe('off');
    expect(pointName(0, 7, R)).toBe('8');
    expect(pointName(1, 7, R)).toBe('17');
    expect(moveText(0, { from: 7, to: 4, die: 3, hit: false }, R)).toBe('8/5');
    expect(moveText(0, { from: 7, to: 4, die: 3, hit: true }, R)).toBe('8/5*');
    expect(moveText(1, { from: 'bar', to: 4, die: 5, hit: false }, R)).toBe('bar/20');
    expect(moveText(0, { from: 5, to: 'off', die: 6, hit: false }, R)).toBe('6/off');
  });

  test('moveLabel reads the hit off the board and names a die that is not the distance', () => {
    const b = pos('L: 8:1 4:1 | D: 20:1 13:14 | bar 0/0 | off 13/0');
    expect(moveLabel(b, 0, mv(0, '8/5'), R)).toBe('8/5*');
    expect(moveLabel(b, 0, mv(0, '4/off(6)'), R)).toBe('4/off(6)');
    expect(moveLabel(b, 0, mv(0, '4/off'), R)).toBe('4/off');
    expect(moveLabel(pos(START), 0, mv(0, '13/10'), R)).toBe('13/10');
  });

  test('playText collapses adjacent repeats only', () => {
    const p = (texts: ReadonlyArray<string>, hits: ReadonlyArray<boolean> = []) =>
      playText(
        0,
        texts.map((t, i) => ({ ...mv(0, t), hit: hits[i] ?? false })),
        R,
      );
    expect(p(['8/5', '6/5'])).toBe('8/5 6/5');
    expect(p(['13/7', '13/7'])).toBe('13/7(2)');
    expect(p(['6/off', '6/off', '4/off(6)', '4/off(6)'])).toBe('6/off(2) 4/off(2)');
    expect(p(['8/5', '6/5'], [true, false])).toBe('8/5* 6/5');
    expect(p(['13/7', '8/2', '13/7'])).toBe('13/7 8/2 13/7');
    expect(p([])).toBe('');
  });

  test('diceText and pointsText', () => {
    expect(diceText([3, 1])).toBe('3-1');
    expect(diceText([6, 6])).toBe('6-6');
    expect(pointsText(1)).toBe('1 point');
    expect(pointsText(2)).toBe('2 points');
  });
});

describe('parseMove', () => {
  test('die is the pip distance unless (n) says otherwise; bar is 25, off is 0', () => {
    expect(mv(0, '8/5*')).toEqual({ from: 7, to: 4, die: 3 });
    expect(mv(0, 'bar/20')).toEqual({ from: 'bar', to: 19, die: 5 });
    expect(mv(0, '4/off(6)')).toEqual({ from: 3, to: 'off', die: 6 });
    expect(mv(0, '3/off')).toEqual({ from: 2, to: 'off', die: 3 });
    expect(mv(1, '24/21')).toEqual({ from: 0, to: 3, die: 3 });
    expect(mv(1, 'bar/24')).toEqual({ from: 'bar', to: 0, die: 1 });
  });

  test('refusals', () => {
    expect(parseMove(0, 'nonsense', R)).toEqual({ ok: false, error: 'bad move "nonsense"' });
    expect(parseMove(0, '25/3', R)).toEqual({ ok: false, error: 'point out of range in "25/3"' });
    expect(parseMove(0, '8/0', R).ok).toBe(false);
    expect(parseMove(0, '8/1', R)).toEqual({ ok: false, error: 'die out of range in "8/1"' });
    expect(parseMove(0, '5/6', R).ok).toBe(false);
    expect(parseMove(0, '4/off(0)', R).ok).toBe(false);
  });
});

describe('parsePosition / formatPosition', () => {
  test('round trip on several positions', () => {
    [
      START,
      'L: 8:1 3:1 | D: 24:2 13:13 | bar 0/0 | off 13/0',
      'L: 13:5 8:3 6:5 | D: 24:2 13:5 8:3 6:5 | bar 2/0 | off 0/0',
      'L: | D: 13:15 | bar 0/0 | off 15/0',
    ].forEach((text) => {
      expect(formatPosition(pos(text), R)).toBe(text);
    });
  });

  test('places dark in its own numbering', () => {
    const b = pos('L: 6:5 | D: 6:5 20:1 | bar 0/0 | off 10/9');
    expect(b.points[5]).toEqual([0, 0, 0, 0, 0]);
    expect(b.points[18]).toEqual([1, 1, 1, 1, 1]);
    expect(b.points[4]).toEqual([1]);
    expect(b.off).toEqual([10, 9]);
  });

  test('refusals name the part', () => {
    const bad = (text: string): string => {
      const r = parsePosition(text, R);
      return r.ok ? 'ok' : r.error;
    };
    expect(bad('L: 6:1 | D: 6:1 | bar 0/0')).toBe('expected "L: … | D: … | bar a/b | off a/b"');
    expect(bad('L: 6:1 | D: 6:1 | bar 0/0 | off 0/0 | extra')).toContain('expected');
    expect(bad('X: 6:1 | D: 6:1 | bar 0/0 | off 0/0')).toBe('expected "L:" in "X: 6:1"');
    expect(bad('L: 6:1 | L: 6:1 | bar 0/0 | off 0/0')).toBe('expected "D:" in "L: 6:1"');
    expect(bad('L: 25:1 | D: 6:1 | bar 0/0 | off 0/0')).toBe('bad checker entry "25:1"');
    expect(bad('L: 6 | D: 6:1 | bar 0/0 | off 0/0')).toBe('bad checker entry "6"');
    expect(bad('L: 6:1 | D: 6:1 | bar x | off 0/0')).toBe('expected "bar a/b" in "bar x"');
    expect(bad('L: 6:1 | D: 6:1 | bar 0/0 | of 0/0')).toBe('expected "off a/b" in "of 0/0"');
  });
});
