import { describe, expect, test } from 'vitest';

import { mulberry32, type Rng } from './rng.ts';

const take = (rng: Rng, n: number): number[] => Array.from({ length: n }, () => rng());

describe('mulberry32', () => {
  test('seed 1 yields the reference sequence', () => {
    // First six values of the reference implementation (bryc's mulberry32) for seed 1.
    expect(take(mulberry32(1), 6)).toEqual([
      0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741,
      0.9683778982143849, 0.281103502959013,
    ]);
  });

  test('seed 0 is a valid seed', () => {
    expect(take(mulberry32(0), 2)).toEqual([0.26642920868471265, 0.0003297457005828619]);
  });

  test('same seed, same sequence', () => {
    expect(take(mulberry32(12345), 50)).toEqual(take(mulberry32(12345), 50));
  });

  test('different seeds differ', () => {
    expect(take(mulberry32(1), 5)).not.toEqual(take(mulberry32(2), 5));
  });

  test('the seed is coerced to a 32-bit integer', () => {
    expect(mulberry32(1 + 2 ** 32)()).toBe(mulberry32(1)());
    expect(mulberry32(-1)()).toBe(mulberry32(0xffffffff)());
    expect(mulberry32(1.9)()).toBe(mulberry32(1)());
  });

  test.each([1, 7, 42, 2 ** 31 - 1])('seed %i stays in [0, 1) over 10000 draws', (seed) => {
    const values = take(mulberry32(seed), 10000);
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(values.every((v) => Number.isFinite(v))).toBe(true);
    // Not degenerate: a stuck generator would repeat itself.
    expect(new Set(values).size).toBeGreaterThan(9900);
  });
});
