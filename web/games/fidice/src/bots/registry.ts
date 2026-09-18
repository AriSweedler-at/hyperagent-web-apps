// The strategy pool (docs/MIGRATION.md step 8): typed from legacy/fidice/index.html lines
// 1769-1799 (bundle section "// src/bots/registry.ts"); behaviour is unchanged,
// test/parity/fidice.legacy.test.ts pins the pool, the fallbacks and the random draw. Every
// strategy the page can seat, by id, plus the three difficulty presets the menu offers.
import type { Rng } from '../../../../shared/lib/rng.ts';
import type { BotProfile, NonEmpty } from '../domain/types.ts';
import { classicCautious, classicReckless, classicSteady } from './strategies/classic.ts';
import { gambler } from './strategies/gambler.ts';
import { learnerWith } from './strategies/learner.ts';
import { CHECKPOINTS } from './strategies/learnerWeights.ts';
import { pressure } from './strategies/pressure.ts';
import { profiler } from './strategies/profiler.ts';
import { trapper } from './strategies/trapper.ts';
import { anyStrategy } from './strategy.ts';
import type { AnyStrategy } from './types.ts';

export type Difficulty = Readonly<{
  id: string;
  label: string;
  strategy: AnyStrategy;
  blurb: string;
}>;

const LEARNERS: ReadonlyArray<AnyStrategy> = CHECKPOINTS.map((c) =>
  anyStrategy(
    learnerWith(
      `learner-${String(c.generation)}`,
      `Learner (gen ${String(c.generation)})`,
      `Trained by evolution for ${String(c.generation)} generations against the shipped AIs; won ${(c.fitness * 100).toFixed(0)}% of its training games.`,
      c.weights,
    ),
  ),
);
/** The menu choice that draws one of SHIPPED at random when the bot sits down. */
const RANDOM_STRATEGY = 'random';
/** The three the menu's difficulties and the random draw pick from; the first is the fallback. */
const SHIPPED: NonEmpty<AnyStrategy> = [
  anyStrategy(gambler),
  anyStrategy(profiler),
  anyStrategy(pressure),
];
const POOL: ReadonlyArray<AnyStrategy> = [
  ...SHIPPED,
  anyStrategy(trapper),
  anyStrategy(classicCautious),
  anyStrategy(classicSteady),
  anyStrategy(classicReckless),
  ...LEARNERS,
];
const byId: ReadonlyMap<string, AnyStrategy> = new Map(POOL.map((s) => [s.id, s]));
/** The profile's strategy; an id the pool does not know falls back to the first shipped one. */
const strategyFor = (profile: BotProfile): AnyStrategy => byId.get(profile.strategy) ?? SHIPPED[0];
const profileFor = (choice: string, rng: Rng): BotProfile =>
  choice === RANDOM_STRATEGY
    ? // rng() is in [0, 1), so the index is always in range; `??` only narrows the type.
      { strategy: (SHIPPED[Math.floor(rng() * SHIPPED.length)] ?? SHIPPED[0]).id, random: true }
    : { strategy: byId.has(choice) ? choice : SHIPPED[0].id, random: false };
const DIFFICULTIES: readonly [Difficulty, Difficulty, Difficulty] = [
  {
    id: 'easy',
    label: 'Easy',
    strategy: anyStrategy(pressure),
    blurb: 'The Showman — all theatre; calls too much and can be bluffed.',
  },
  {
    id: 'medium',
    label: 'Medium',
    strategy: anyStrategy(profiler),
    blurb: 'The Reader — learns your habits over the game and uses them.',
  },
  {
    id: 'hard',
    label: 'Hard',
    strategy: anyStrategy(gambler),
    blurb: 'The Gambler — the tournament winner; punishes small raises and rarely calls wrong.',
  },
];
const difficultyById = (id: string): Difficulty =>
  DIFFICULTIES.find((d) => d.id === id) ?? DIFFICULTIES[1];
const difficultyOfChoice = (choice: string): string | null =>
  DIFFICULTIES.find((d) => d.strategy.id === choice)?.id ?? null;
const learnerGeneration = (choice: string): number | null => {
  const m = /^learner-(\d+)$/.exec(choice);
  return m !== null ? Number(m[1]) : null;
};
const choiceLabel = (choice: string): string =>
  choice === RANDOM_STRATEGY
    ? '🎲 Random strategy'
    : learnerGeneration(choice) !== null
      ? `Self-taught · ${String(learnerGeneration(choice))} generations`
      : (byId.get(choice)?.name ?? SHIPPED[0].name);
const describeProfile = (profile: BotProfile): string =>
  `${strategyFor(profile).name}${profile.random ? ' (random)' : ''}`;

export {
  LEARNERS,
  RANDOM_STRATEGY,
  SHIPPED,
  POOL,
  byId,
  strategyFor,
  profileFor,
  DIFFICULTIES,
  difficultyById,
  difficultyOfChoice,
  learnerGeneration,
  choiceLabel,
  describeProfile,
};
