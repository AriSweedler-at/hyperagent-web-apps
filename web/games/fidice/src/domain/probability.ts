// Odds for the bots (docs/MIGRATION.md step 8): typed from legacy/fidice/index.html lines 883-903
// (bundle section "// src/domain/probability.ts"); behaviour is unchanged,
// test/parity/fidice.legacy.test.ts is the oracle. The enumeration and its memo live in
// probability.algorithms.ts (the one loop-and-mutation file of the domain) and are re-exported here
// under their legacy names.
import { cache, cartesian, survivalFor } from './probability.algorithms.ts';
import { HAND_COUNT, type DieValue, type Rank } from './types.ts';

/** Probability that `tableDice` plus `cupCount` random dice rank at least `rank`. */
const probabilityAtLeast = (
  tableDice: ReadonlyArray<DieValue>,
  cupCount: number,
  rank: Rank,
): number => survivalFor(tableDice, cupCount)[rank] ?? 0;

/** Expected rank after rerolling `rerolled` dice next to the `kept` ones. */
const expectedRank = (kept: ReadonlyArray<DieValue>, rerolled: number): number =>
  survivalFor(kept, rerolled)
    .slice(1, HAND_COUNT)
    .reduce((a, p) => a + p, 0);

export { cache, cartesian, survivalFor, probabilityAtLeast, expectedRank };
