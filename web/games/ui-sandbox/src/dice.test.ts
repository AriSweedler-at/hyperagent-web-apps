// The mock dice: as many pips as the face, on the standard cells, each inside the 3x3 grid.
import { describe, expect, test } from 'vitest';

import type { Die } from '../../../shared/lib/appClip.ts';
import { PIPS, dieMarkup, pipsMarkup } from './dice.ts';

const FACES: ReadonlyArray<Die> = [1, 2, 3, 4, 5, 6];

describe('the mock dice', () => {
  test('a face has as many pips as its number, every one on the grid, none twice', () => {
    FACES.forEach((face) => {
      const cells = PIPS[face];
      expect(cells).toHaveLength(face);
      cells.forEach(([row, col]) => {
        expect(row).toBeGreaterThanOrEqual(1);
        expect(row).toBeLessThanOrEqual(3);
        expect(col).toBeGreaterThanOrEqual(1);
        expect(col).toBeLessThanOrEqual(3);
      });
      expect(new Set(cells.map(([r, c]) => `${String(r)}${String(c)}`)).size).toBe(face);
    });
  });

  test('the odd faces hold the centre, the even ones do not; six is the two outer columns', () => {
    const centre = (face: Die): boolean => PIPS[face].some(([r, c]) => r === 2 && c === 2);
    expect(FACES.map(centre)).toEqual([true, false, true, false, true, false]);
    expect(PIPS[6].every(([, c]) => c !== 2)).toBe(true);
  });

  test('the markup: one pip element per pip, placed by grid-area; the die wears its name and face', () => {
    expect(pipsMarkup(3).markup.match(/class="pip"/g)).toHaveLength(3);
    expect(pipsMarkup(1).markup).toBe('<i class="pip" style="grid-area: 2 / 2"></i>');
    const die = dieMarkup('two', 6).markup;
    expect(die).toContain('data-die="two"');
    expect(die).toContain('data-face="6"');
    expect(die).toContain('aria-label="die two shows 6"');
    expect(die.match(/class="pip"/g)).toHaveLength(6);
  });
});
