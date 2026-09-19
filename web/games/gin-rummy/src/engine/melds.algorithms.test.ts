// The branches of the meld solvers that seeded play does not reach (docs/MIGRATION.md step 10):
// empty hands, the default arrangement limit, the memo's eviction and the limit stopping the DFS
// mid-way. test/parity/gin.melds.test.ts is the oracle for everything else, node cap included.
import { describe, expect, test } from 'vitest';

import { makeCard, makeDeck } from './cards.ts';
import {
  ALT_CACHE_LIMIT,
  allOptimalMeldings,
  altCache,
  bestMelding,
  meldSolver,
} from './melds.algorithms.ts';
import type { Cards } from './types.ts';

const deck = makeDeck();
const spades = deck.filter((c) => c.s === 'S');

describe('meldSolver', () => {
  test('an empty hand melds to nothing', () => {
    expect(bestMelding([])).toEqual({ melds: [], deadwood: [], value: 0 });
    expect(allOptimalMeldings([])).toEqual([{ melds: [], deadwood: [], value: 0, sig: '' }]);
  });

  test('a solver answers the whole hand and the hand minus a mask from one memo', () => {
    const hand: Cards = [...spades.slice(0, 4), makeCard(9, 'H'), makeCard(9, 'D')];
    const solver = meldSolver(hand);
    expect(solver.melding().value).toBe(18);
    expect(solver.value()).toBe(18);
    expect(solver.value(solver.maskOf(['9H', '9D']))).toBe(0);
    expect(solver.melding(solver.maskOf(['AS'])).melds.map((m) => m.map((c) => c.id))).toEqual([
      ['2S', '3S', '4S'],
    ]);
  });
});

describe('allOptimalMeldings', () => {
  test('the limit defaults to 12 and 0 means the default too', () => {
    // Six of a rank cannot exist, so use overlapping runs: A-8 of spades has many arrangements.
    const hand = spades.slice(0, 8);
    expect(allOptimalMeldings(hand).length).toBeLessThanOrEqual(12);
    expect(allOptimalMeldings(hand, 0)).toBe(allOptimalMeldings(hand));
    expect(allOptimalMeldings(hand, 2)).toHaveLength(2);
    expect(allOptimalMeldings(hand, 2).every((o) => o.value === 0)).toBe(true);
  });

  test('results are memoised by sorted ids and limit, and the memo is emptied past its limit', () => {
    altCache.clear();
    const hand = spades.slice(0, 5);
    const first = allOptimalMeldings(hand, 3);
    expect(allOptimalMeldings([...hand].reverse(), 3)).toBe(first);
    expect(allOptimalMeldings(hand, 4)).not.toBe(first);
    Array.from({ length: ALT_CACHE_LIMIT }, (_, i) => i + 5).forEach((limit) => {
      allOptimalMeldings(hand, limit);
    });
    expect(altCache.size).toBeLessThanOrEqual(ALT_CACHE_LIMIT + 1);
    expect(altCache.size).toBeLessThan(ALT_CACHE_LIMIT);
  });
});
