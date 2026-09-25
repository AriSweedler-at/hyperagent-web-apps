// The four Italian suit symbols (docs/design/card-packs.md §4): one per suit of `italian40`, in the
// deck's order, each well-formed SVG markup in its own box, and the placement helper's arithmetic.
import { describe, expect, test } from 'vitest';

import { DECKS } from './decks.ts';
import { ITALIAN_SUIT_SYMBOLS, fmt, placedSymbol, suitSymbol, suitSymbolId } from './suits.ts';

describe('the Italian suit symbols', () => {
  test('one per suit, in the deck order, coloured in the print colours, the long ones 1:5', () => {
    expect(ITALIAN_SUIT_SYMBOLS.map((s) => s.id)).toEqual(DECKS.italian40.suits.map((s) => s.id));
    expect(ITALIAN_SUIT_SYMBOLS.map((s) => [s.width, s.height])).toEqual([
      [100, 100],
      [100, 100],
      [20, 100],
      [20, 100],
    ]);
    ITALIAN_SUIT_SYMBOLS.forEach((s) => {
      expect(s.colour).toMatch(/^#[0-9a-f]{6}$/);
      // Balanced, self-closing shapes only: no text, no external references.
      expect(s.markup).toMatch(/^(<(path|circle|ellipse) [^<>]*\/>)+$/);
      expect(s.markup).toContain(`fill="${s.colour}"`);
      expect(s.markup).toContain('stroke="#2b2118"');
    });
  });

  test('suitSymbol finds a symbol by suit id, null for a French suit; suitSymbolId is the sprite id', () => {
    expect(suitSymbol('D')?.colour).toBe('#d3a12a');
    expect(suitSymbol('H')).toBeNull();
    expect(suitSymbolId('S')).toBe('suit-S');
  });

  test('placedSymbol centres the box on the point and scales it to the height; fmt trims to three decimals', () => {
    const coppe = ITALIAN_SUIT_SYMBOLS[0];
    const spade = ITALIAN_SUIT_SYMBOLS[2];
    if (coppe === undefined || spade === undefined) throw new Error('four symbols');
    expect(placedSymbol(coppe, 50, 50, 20)).toBe(
      `<g transform="translate(40 40) scale(0.2)">${coppe.markup}</g>`,
    );
    // A 20 × 100 box at height 60: scale 0.6, 12 wide, so its left edge sits 6 left of the centre.
    expect(placedSymbol(spade, 30, 100, 60)).toBe(
      `<g transform="translate(24 70) scale(0.6)">${spade.markup}</g>`,
    );
    expect(fmt(1 / 3)).toBe('0.333');
    expect(fmt(2)).toBe('2');
    expect(fmt(-0.0004)).toBe('0');
  });
});
