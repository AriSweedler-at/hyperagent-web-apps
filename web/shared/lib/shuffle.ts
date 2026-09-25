// The one shuffle every card game deals from: gin's Fisher-Yates (web/games/gin-rummy/src/engine/
// cards.ts, ported from the legacy page in docs/MIGRATION.md step 10) lifted here so briscola deals
// with the same permutation for the same seeded stream (docs/design/briscola-rules.md E4). Gin
// re-exports it and its parity suites pin the permutation, so the body is the legacy one to the
// letter: from the top, one rng call per step, m − 1 calls for m items.
import type { Rng } from './rng.ts';

const swapped = <T>(items: ReadonlyArray<T>, i: number, j: number): ReadonlyArray<T> =>
  items.map((item, k) => (k === i ? (items[j] ?? item) : k === j ? (items[i] ?? item) : item));

/**
 * Fisher-Yates from the top: for i = m − 1 down to 1, swap `i` with a draw in [0, i]. One rng
 * call per step, in this order, so a seeded stream reproduces the legacy permutation exactly; an
 * empty or one-item list reads the rng zero times.
 */
export const shuffle = <T>(items: ReadonlyArray<T>, rng: Rng): ReadonlyArray<T> =>
  Array.from({ length: Math.max(0, items.length - 1) }, (_, k) => items.length - 1 - k).reduce(
    (acc, i) => swapped(acc, i, Math.floor(rng() * (i + 1))),
    items,
  );
