// Learner checkpoints (docs/MIGRATION.md step 8): typed from legacy/fidice/index.html lines
// 1762-1766 (bundle section "// src/bots/strategies/learnerWeights.ts"); the numbers are the
// bundle's, unchanged. Each row is one evolved weight vector (learner.ts `WEIGHT_COUNT` = 28) with
// the generation it came from and the share of its training games it won.
export type Checkpoint = Readonly<{
  generation: number;
  fitness: number;
  weights: ReadonlyArray<number>;
}>;

const CHECKPOINTS: ReadonlyArray<Checkpoint> = [
  {
    generation: 10,
    fitness: 0.3806,
    weights: [
      -1.5989, 0.8353, -1.8903, -1.3154, -1.2299, 0.0477, -0.354, 0.4944, 0.9574, 0.404, -0.2929,
      -0.1049, -0.1329, -1.7613, 0.5894, -0.7672, -0.0234, 0.2747, -0.2599, 0.5704, -1.4063,
      -0.1248, -0.463, -0.8529, -0.5624, -0.1445, -0.1032, 1.3859,
    ],
  },
  {
    generation: 100,
    fitness: 0.2514,
    weights: [
      -4.2899, 2.4972, -0.2729, -0.4371, -2.506, 3.8463, -1.6681, -3.2937, -1.4259, -1.5516,
      -0.7899, 0.4348, -1.3266, 0.7545, 3.6755, 3.1372, 2.8562, 1.9522, -2.308, 4.1968, -0.285,
      -0.2987, 2.437, 0.38, -0.8791, -1.6023, -0.6194, 7.2766,
    ],
  },
  {
    generation: 300,
    fitness: 0.3472,
    weights: [
      -2.566, 7.2015, -6.2582, -0.161, -2.796, -0.8457, -7.148, 0.6985, -4.9041, 0.1276, 0.1494,
      -0.2739, -4.9749, 0.4078, 3.6109, 2.9275, 0.089, 4.869, -0.8445, 2.4152, -0.2296, 4.5378,
      -2.8069, 1.3254, 1.2591, 1.5277, -2.4861, 4.83,
    ],
  },
];

export { CHECKPOINTS };
