// Dice (docs/MIGRATION.md step 8): typed from legacy/fidice/index.html lines 384-391 (bundle
// section "// src/domain/dice.ts"); behaviour is unchanged, test/parity/fidice.legacy.test.ts is
// the oracle. Randomness is injected: `Rng` is the seeded generator of web/shared/lib.
import type { Rng } from '../../../../shared/lib/rng.ts';
import type { DieValue } from './types.ts';

const DIE_VALUES: ReadonlyArray<DieValue> = [1, 2, 3, 4, 5, 6];

const rollDie = (rng: Rng): DieValue => {
  const index = Math.min(5, Math.floor(rng() * 6));
  return DIE_VALUES[index] ?? 6;
};

const rollDice = (count: number, rng: Rng): ReadonlyArray<DieValue> =>
  Array.from({ length: count }, () => rollDie(rng));

const sortDesc = (dice: ReadonlyArray<DieValue>): ReadonlyArray<DieValue> =>
  [...dice].sort((a, b) => b - a);

/** How many dice show each face, faces in order of first appearance; absent faces have no entry. */
const faceCounts = (dice: ReadonlyArray<DieValue>): ReadonlyMap<DieValue, number> =>
  dice.reduce<ReadonlyMap<DieValue, number>>(
    (m, v) => new Map([...m, [v, (m.get(v) ?? 0) + 1]]),
    new Map(),
  );

export { DIE_VALUES, rollDie, rollDice, sortDesc, faceCounts };
