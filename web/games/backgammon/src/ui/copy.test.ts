// The status line's blocks hold their caps on the widest input the engine can give them (copy.ts;
// design §2.4 "The copy budget"): a name clips on a grapheme with one ellipsis and no space before
// it, and a template renders no longer than its worst case.
import { describe, expect, test } from 'vitest';

import { NAME_MAX } from '../../../../shared/lib/protocol.ts';
import { CUBE_MAX } from '../engine/index.ts';
import {
  CAPS,
  clip,
  count,
  countWord,
  cube,
  die,
  name,
  pair,
  place,
  points,
  render,
  roll,
  shape,
  worstCase,
  type Block,
  type Template,
} from './copy.ts';

/** A name at the shell's cap. */
const LONG = 'Konstantinopoulos XX';

const holds = (b: Block): void => {
  expect(b.text.length, `${b.kind} "${b.text}" over its cap ${String(b.cap)}`).toBeLessThanOrEqual(
    b.cap,
  );
};

describe('clip', () => {
  test('whole when it fits; else the first graphemes and one …, never a space before it; a cap under 1 leaves nothing', () => {
    expect(LONG.length).toBe(NAME_MAX);
    expect(clip(LONG, NAME_MAX)).toBe(LONG);
    // Room for 18: "Konstantinopoulos " ends in a space, which the ellipsis does not follow.
    expect(clip(LONG, 19)).toBe('Konstantinopoulos…');
    expect(clip(LONG, 12)).toBe('Konstantino…');
    expect(clip(LONG, 6)).toBe('Konst…');
    expect(clip('Ari', 6)).toBe('Ari');
    expect(clip(LONG, 1)).toBe('…');
    expect(clip(LONG, 0)).toBe('');
  });

  test('a cut lands on a grapheme boundary: a combining accent or a flag is kept whole or dropped whole', () => {
    // 'Zoë' with a combining diaeresis (e + U+0308): four code units, three graphemes.
    const zoe = 'Zoë Konstantinos';
    expect(clip(zoe, 4)).toBe('Zo…');
    expect(clip(zoe, 5)).toBe('Zoë…');
    // A flag is two regional indicators, four code units: the second flag does not fit in five.
    const flags = '\u{1F1EC}\u{1F1F7}\u{1F1EC}\u{1F1F7} Kostas';
    expect(clip(flags, 6)).toBe('\u{1F1EC}\u{1F1F7}…');
    expect(clip(flags, 4)).toBe('…');
  });
});

describe('the blocks hold their caps at the widest input', () => {
  test('roll 6-6 (3), die (1), a double`s four moves (1), three (5), cube 64 (2), points 192 (3), bar/24 (3), 6+5 (3), a clipped name', () => {
    expect(CAPS).toEqual({
      roll: 3,
      die: 1,
      count: 1,
      countWord: 5,
      cube: 2,
      points: 3,
      place: 3,
      pair: 3,
    });
    const widest = [
      roll([6, 6]),
      die(6),
      count(4),
      countWord(3),
      cube(CUBE_MAX),
      points(3 * CUBE_MAX),
      place('bar'),
      place('24'),
      pair([6, 5]),
      name(6, LONG),
      name(NAME_MAX, LONG),
    ];
    widest.forEach(holds);
    expect(widest.map((b) => b.text)).toEqual([
      '6-6',
      '6',
      '4',
      'three',
      '64',
      '192',
      'bar',
      '24',
      '6+5',
      'Konst…',
      LONG,
    ]);
    expect(roll(null).text).toBe('');
    expect(countWord(7).text).toBe('7');
  });
});

describe('templates', () => {
  test('render joins the pieces; worstCase is the literals plus the caps and never under the render; shape names the blocks', () => {
    const t: Template = [name(6, LONG), ' to move · ', roll([6, 6])];
    expect(render(t)).toBe('Konst… to move · 6-6');
    expect(worstCase(t)).toBe(20);
    expect(render(t).length).toBeLessThanOrEqual(worstCase(t));
    expect(shape(t)).toBe('{name:6} to move · {roll:3}');
    const short: Template = [name(6, 'Ari'), ' to move · ', roll(null)];
    expect(render(short)).toBe('Ari to move · ');
    expect(worstCase(short)).toBe(20);
    expect(render([])).toBe('');
    expect(worstCase([])).toBe(0);
  });
});
