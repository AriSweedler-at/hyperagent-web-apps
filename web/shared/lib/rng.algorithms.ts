// mulberry32 in its stateful form. `Rng` is `() => number` by contract (docs/ARCHITECTURE.md
// "Module boundaries"): the engines and bots take a generator, not a state, so a seeded generator
// has to carry its 32-bit state between calls. Threading the state through every caller is not an
// option there, so the one mutable cell lives here, in a closure, and nowhere else.

const step = (a: number): number => (a + 0x6d2b79f5) | 0;

const output = (a: number): number => {
  const t = Math.imul(a ^ (a >>> 15), 1 | a);
  const u = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((u ^ (u >>> 14)) >>> 0) / 4294967296;
};

/**
 * Seeded generator with the reference mulberry32 sequence (seed coerced to int32). Same seed,
 * same sequence, on every runtime; values in [0, 1).
 */
export const mulberry32 = (seed: number): (() => number) => {
  let a = seed | 0;
  return (): number => {
    a = step(a);
    return output(a);
  };
};
