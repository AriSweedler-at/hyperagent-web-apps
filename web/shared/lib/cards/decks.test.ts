// The deck kinds (docs/design/card-packs.md §1): the two vocabularies, their ids in suit-major order
// (the briscola design's D10 literal for `italian40`; test/card-packs.test.ts pins `french52`
// against gin's engine, which this leaf may not import), and the id helpers.
import { describe, expect, test } from 'vitest';

import { DECKS, DECK_KINDS, cardIds, cardName, isCardId, isDeckKind, splitId } from './decks.ts';

describe('the deck kinds', () => {
  test('two kinds; each spec names itself, its aspect within the layout range and its fractions small', () => {
    expect(DECK_KINDS).toEqual(['french52', 'italian40']);
    DECK_KINDS.forEach((kind) => {
      expect(isDeckKind(kind)).toBe(true);
      const spec = DECKS[kind];
      expect(spec.kind).toBe(kind);
      expect(spec.aspect).toBeGreaterThan(0.45);
      expect(spec.aspect).toBeLessThan(0.8);
      expect(spec.border).toBeLessThan(0.1);
      expect(spec.radius).toBeLessThan(0.2);
      // Ids are unique and every rank id is one to two characters ahead of a one-letter suit.
      const ids = cardIds(kind);
      expect(new Set(ids).size).toBe(ids.length);
      spec.suits.forEach((s) => {
        expect(s.id).toHaveLength(1);
      });
    });
    expect(isDeckKind('tarot78')).toBe(false);
  });

  test("french52: gin's 52 ids, suit-major S H D C, ace to king, the two red suits and the text symbols", () => {
    const ids = cardIds('french52');
    expect(ids).toHaveLength(52);
    expect(ids.slice(0, 13)).toEqual([
      'AS',
      '2S',
      '3S',
      '4S',
      '5S',
      '6S',
      '7S',
      '8S',
      '9S',
      '10S',
      'JS',
      'QS',
      'KS',
    ]);
    expect(ids[13]).toBe('AH');
    expect(ids[26]).toBe('AD');
    expect(ids[39]).toBe('AC');
    expect(ids.at(-1)).toBe('KC');
    expect(DECKS.french52.suits.map((s) => [s.id, s.colour, s.symbol])).toEqual([
      ['S', 'black', '♠'],
      ['H', 'red', '♥'],
      ['D', 'red', '♦'],
      ['C', 'black', '♣'],
    ]);
    expect(DECKS.french52.aspect).toBeCloseTo(100 / 144, 5);
  });

  test("italian40: the briscola design's forty ids (D10), suit-major C D S B, A 2 … 7 F C R, drawn from the sprite", () => {
    expect(cardIds('italian40')).toEqual([
      ...['AC', '2C', '3C', '4C', '5C', '6C', '7C', 'FC', 'CC', 'RC'],
      ...['AD', '2D', '3D', '4D', '5D', '6D', '7D', 'FD', 'CD', 'RD'],
      ...['AS', '2S', '3S', '4S', '5S', '6S', '7S', 'FS', 'CS', 'RS'],
      ...['AB', '2B', '3B', '4B', '5B', '6B', '7B', 'FB', 'CB', 'RB'],
    ]);
    DECKS.italian40.suits.forEach((s) => {
      expect(s.colour).toBe('none');
      expect(s.symbol).toBeNull();
    });
    expect(DECKS.italian40.ranks.map((r) => r.index)).toEqual([
      'A',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      'F',
      'C',
      'R',
    ]);
    expect(DECKS.italian40.aspect).toBe(0.518);
  });

  test('splitId reads the suit off the last letter and the rank off the rest; strangers are null', () => {
    expect(splitId('french52', '10H')).toMatchObject({
      rank: { id: '10', label: 'ten' },
      suit: { id: 'H', label: 'hearts' },
    });
    expect(splitId('italian40', 'CC')).toMatchObject({
      rank: { id: 'C', label: 'cavallo', english: 'knight' },
      suit: { id: 'C', label: 'coppe', english: 'cups' },
    });
    // A rank of one deck with a suit of the other, a suit alone, an empty id, gin's ten in Italy.
    expect(splitId('italian40', 'KC')).toBeNull();
    expect(splitId('french52', '7B')).toBeNull();
    expect(splitId('italian40', 'S')).toBeNull();
    expect(splitId('italian40', '')).toBeNull();
    expect(splitId('italian40', '10C')).toBeNull();
    expect(isCardId('italian40', '7S')).toBe(true);
    expect(isCardId('french52', '7S')).toBe(true);
    expect(isCardId('french52', 'RB')).toBe(false);
  });

  test('cardName speaks the deck\'s language: "sette di spade", "seven of spades"; null for a stranger', () => {
    expect(cardName('italian40', '7S')).toBe('sette di spade');
    expect(cardName('italian40', 'AD')).toBe('asso di denari');
    expect(cardName('italian40', 'RB')).toBe('re di bastoni');
    expect(cardName('french52', '7S')).toBe('seven of spades');
    expect(cardName('french52', 'QH')).toBe('queen of hearts');
    expect(cardName('french52', 'ZZ')).toBeNull();
  });
});
