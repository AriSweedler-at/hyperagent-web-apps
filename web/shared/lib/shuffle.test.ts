import { describe, expect, test } from 'vitest';

import { mulberry32, type Rng } from './rng.ts';
import { shuffle } from './shuffle.ts';

const counting = (inner: Rng): Rng & { calls: () => number } => {
  let n = 0;
  const rng = (): number => {
    n += 1;
    return inner();
  };
  return Object.assign(rng, { calls: () => n });
};
const range = (m: number): ReadonlyArray<number> => Array.from({ length: m }, (_, i) => i);

describe("shuffle (gin's Fisher-Yates, lifted)", () => {
  test('a permutation: the same items, every one once', () => {
    const out = shuffle(range(40), mulberry32(3));
    expect([...out].sort((a, b) => a - b)).toEqual(range(40));
    expect(out).not.toEqual(range(40));
  });

  test('same seed, same permutation; different seeds differ', () => {
    expect(shuffle(range(52), mulberry32(3))).toEqual(shuffle(range(52), mulberry32(3)));
    expect(shuffle(range(52), mulberry32(3))).not.toEqual(shuffle(range(52), mulberry32(4)));
  });

  test('the legacy permutation, pinned: seed 1 over 0..9 reads the rng nine times', () => {
    const rng = counting(mulberry32(1));
    // The permutation gin's cards.ts produced for this stream before the lift (pinned at the move).
    expect(shuffle(range(10), rng)).toEqual([7, 8, 3, 2, 1, 5, 9, 4, 0, 6]);
    expect(rng.calls()).toBe(9);
  });

  test.each([0, 1, 2, 40, 52])('m = %i items read the rng max(0, m − 1) times', (m) => {
    const rng = counting(mulberry32(7));
    shuffle(range(m), rng);
    expect(rng.calls()).toBe(Math.max(0, m - 1));
  });

  test('a constant rng of 0 rotates each prefix; of just under 1 leaves the order alone', () => {
    // 0: every step swaps `i` with 0, so the first item walks to the end and the rest shift up.
    expect(shuffle(range(5), () => 0)).toEqual([1, 2, 3, 4, 0]);
    // Just under 1: floor(rng * (i + 1)) === i, every swap is with itself.
    expect(shuffle(range(5), () => 0.999999)).toEqual([0, 1, 2, 3, 4]);
  });

  test('the input is not mutated', () => {
    const items = range(8);
    const copy = [...items];
    shuffle(items, mulberry32(9));
    expect(items).toEqual(copy);
  });
});
