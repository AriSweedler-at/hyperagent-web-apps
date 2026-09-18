// The cartesian enumeration behind the bots' odds (docs/ARCHITECTURE.md "*.algorithms.ts";
// docs/MIGRATION.md step 8), typed from legacy/fidice/index.html lines 883-903 (bundle section
// "// src/domain/probability.ts"). `survivalFor` lists every outcome of the dice still under the
// cup (6^cupCount of them) and turns the ranks they reach into a survival curve: entry `r` is the
// probability of ending at rank `r` or better.
//
// Why not the functional form: the density is a floating-point sum, and its exact value depends on
// the order of the additions (one `1 / combos.length` per outcome, in enumeration order). The
// seeded bot replays in test/parity deep-equal every decision against the legacy bundle, and a
// bot's choice can turn on the last bit of one of these probabilities, so the accumulation has to
// be the legacy one: an in-place `+=` per outcome. The memo `cache` is module state the bundle kept
// too (it is exported for the parity oracle); it is keyed by the sorted table dice and the cup
// count, so the enumeration runs once per distinct question.
import { DIE_VALUES } from './dice.ts';
import { HAND_COUNT, rankOf } from './hands.ts';
import type { DieValue } from './types.ts';

export const cache = new Map<string, ReadonlyArray<number>>();

/** Every sequence of `count` faces, first die varying slowest. */
export const cartesian = (count: number): ReadonlyArray<ReadonlyArray<DieValue>> =>
  count === 0 ? [[]] : DIE_VALUES.flatMap((v) => cartesian(count - 1).map((rest) => [v, ...rest]));

/**
 * `survival[r]` for r in 0..HAND_COUNT: the probability that `tableDice` plus `cupCount` random
 * dice rank at least `r`; `survival[HAND_COUNT]` is 0.
 */
export const survivalFor = (
  tableDice: ReadonlyArray<DieValue>,
  cupCount: number,
): ReadonlyArray<number> => {
  // Faces are single digits, so the numeric sort equals the legacy default (string) sort.
  const key = `${[...tableDice].sort((a, b) => a - b).join('')}|${String(cupCount)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const combos = cartesian(cupCount);
  const density: number[] = Array.from({ length: HAND_COUNT + 1 }, () => 0);
  for (const cup of combos) {
    const r = rankOf([...tableDice, ...cup]);
    density[r] = (density[r] ?? 0) + 1 / combos.length;
  }
  const survival = density.reduceRight<ReadonlyArray<number>>(
    (acc, p) => [p + (acc[0] ?? 0), ...acc],
    [],
  );
  cache.set(key, survival);
  return survival;
};
