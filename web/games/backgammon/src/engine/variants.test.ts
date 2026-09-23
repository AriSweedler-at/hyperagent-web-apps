import { describe, expect, test } from 'vitest';

import { POINT_INDICES } from './board.ts';
import { CHECKERS, type Seat, type Variant } from './types.ts';
import { isShippedVariant, rulesOf, SHIPPED_VARIANTS, VARIANTS } from './variants.ts';

const ALL: ReadonlyArray<Variant> = ['portes', 'backgammon', 'plakoto', 'fevga'];
const SEATS: ReadonlyArray<Seat> = [0, 1];

describe('the four rule rows (R29-R31)', () => {
  test('portes: tavli opening, no cube, diplo cap, hits', () => {
    const r = VARIANTS.portes;
    expect(r).toMatchObject({
      implemented: true,
      name: 'Portes',
      hasBar: true,
      openingReroll: true,
      cube: false,
      maxMultiplier: 2,
      blocksAt: 2,
      onSingleOpponent: 'hit',
      sameDirection: false,
    });
    expect(r.start).toEqual([
      [24, 2],
      [13, 5],
      [8, 3],
      [6, 5],
    ]);
    expect(r.extraMoveConstraints).toEqual([]);
    expect(r.extraEndChecks).toEqual([]);
  });

  test('backgammon: the opening pair is the first roll, cube on, backgammon cap', () => {
    expect(VARIANTS.backgammon).toMatchObject({
      implemented: true,
      name: 'Backgammon',
      openingReroll: false,
      cube: true,
      maxMultiplier: 3,
      onSingleOpponent: 'hit',
    });
    expect(VARIANTS.backgammon.start).toEqual(VARIANTS.portes.start);
  });

  test('plakoto and fevga are typed but not implemented', () => {
    expect(VARIANTS.plakoto).toMatchObject({
      implemented: false,
      hasBar: false,
      onSingleOpponent: 'pin',
      maxMultiplier: 2,
      cube: false,
      start: [[24, 15]],
    });
    expect(VARIANTS.fevga).toMatchObject({
      implemented: false,
      hasBar: false,
      blocksAt: 1,
      onSingleOpponent: 'illegal',
      sameDirection: true,
      start: [[24, 15]],
    });
  });

  test('every row starts with fifteen checkers a side', () => {
    ALL.forEach((v) => {
      expect(VARIANTS[v].start.reduce((n, [, count]) => n + count, 0)).toBe(CHECKERS);
    });
  });
});

describe('shipped variants', () => {
  test('exactly portes and backgammon; the guard refuses the rest', () => {
    expect(SHIPPED_VARIANTS).toEqual(['portes', 'backgammon']);
    expect(isShippedVariant('portes')).toBe(true);
    expect(isShippedVariant('backgammon')).toBe(true);
    expect(isShippedVariant('plakoto')).toBe(false);
    expect(isShippedVariant('fevga')).toBe(false);
    expect(isShippedVariant('chess')).toBe(false);
    expect(rulesOf('portes')).toBe(VARIANTS.portes);
    expect(rulesOf('backgammon')).toBe(VARIANTS.backgammon);
  });
});

describe('frames (R2, R31)', () => {
  test('ownOf and absOf are inverse for every variant, seat and point', () => {
    ALL.forEach((v) => {
      const r = VARIANTS[v];
      SEATS.forEach((seat) => {
        POINT_INDICES.forEach((abs) => {
          const own = r.ownOf(seat, abs);
          expect(own).toBeGreaterThanOrEqual(1);
          expect(own).toBeLessThanOrEqual(24);
          expect(r.absOf(seat, own)).toBe(abs);
        });
      });
    });
  });

  test('the mirror: light counts up from abs 0, dark down from abs 23', () => {
    const r = VARIANTS.portes;
    expect(r.ownOf(0, 0)).toBe(1);
    expect(r.ownOf(0, 23)).toBe(24);
    expect(r.ownOf(1, 23)).toBe(1);
    expect(r.ownOf(1, 0)).toBe(24);
    // Bar entry with a 6 lands on own 19: abs 18 for light, abs 5 for dark.
    expect(r.absOf(0, 19)).toBe(18);
    expect(r.absOf(1, 19)).toBe(5);
  });

  test('fevga rotates dark by twelve points instead of mirroring', () => {
    const r = VARIANTS.fevga;
    expect(r.ownOf(0, 5)).toBe(6);
    expect(r.absOf(1, 1)).toBe(12);
    expect(r.absOf(1, 6)).toBe(17);
    expect(r.absOf(1, 12)).toBe(23);
    expect(r.absOf(1, 13)).toBe(0);
    expect(r.absOf(1, 24)).toBe(11);
    expect(r.ownOf(1, 11)).toBe(24);
  });
});
