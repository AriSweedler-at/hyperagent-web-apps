// The seeded random-play driver (dry-round-2.md F3), written once for the five drivers that each
// spelled it: the gin legacy replay and its shards (test/parity/gin.replay.ts), the gin codec
// round trips (gin.codecs.test.ts), the backgammon replay (engine/replay.test.ts) and its codec
// trace (engine/decode.test.ts), and the coin self-test (web/shared/example/coin). The dice come
// from `mulberry32(seed)`, the policy's picks from `mulberry32(seed * 7919)`, and the policy is
// called once per step, before `apply`, over the actor's view: the order every driver had, kept,
// so gin's 400 replayed games and backgammon's rng accounting (its invariant #10) are what they
// were before the move. The env knob (`GIN_REPLAY_GAMES`, `BG_REPLAY_GAMES`) is read off
// `globalThis`: the engine tests beside the engines import this file, so tsconfig.pure.json
// compiles it with no node types.
import { expect } from 'vitest';

import type { Now, Seat, TwoSeatEngine } from '../../web/shared/lib/game.ts';
import { mulberry32, type Rng } from '../../web/shared/lib/rng.ts';
import { countingRng } from './engine-helpers.ts';

/**
 * What the driver needs of an engine: four members of the two-seat contract (web/shared/lib/game.ts
 * `TwoSeatEngine`, D5), so each engine's `ENGINE` passes as it is and the one legacy leg
 * (test/parity/gin.codecs.test.ts) spells only these four.
 */
export type ReplayEngine<S, V, A> = Pick<
  TwoSeatEngine<S, V, A, unknown>,
  'apply' | 'viewFor' | 'legalActions' | 'actorOf'
>;

/** One applied step, for a driver's per-step invariants: `step` counts the steps before it. */
export type Step<S, V, A> = Readonly<{
  before: S;
  after: S;
  /** The actor's view of `before`, the one the policy chose from. */
  view: V;
  actor: Seat;
  action: A;
  /** How many times `apply` read the dice rng. */
  rngCalls: number;
  step: number;
}>;

export type Drive<S, V, A> = Readonly<{
  seed: number;
  now: Now;
  /** The game the seed starts: `createGame(...)` over the dice rng and the clock. */
  start: (rng: Rng, now: Now) => S;
  /** The actor's move, drawn from the picks rng; `legal` is `legalActions` of `view`. */
  policy: (view: V, pick: Rng, legal: ReadonlyArray<A>) => A;
  /** Turns a hang into a failure; a driver asserts `done` afterwards. */
  stepCap: number;
  /** The finished game, read off the state (the contract's `over` reads a view). */
  over: (s: S) => boolean;
  onStep?: (step: Step<S, V, A>) => void;
}>;

export type Driven<S> = Readonly<{
  start: S;
  state: S;
  steps: number;
  /** `over` held before the cap. */
  done: boolean;
  /** The dice rng where the game left it, for a driver's closing refusal. */
  rng: Rng;
}>;

/** One seeded game to `over` or the cap; a refused action fails the test with its label. */
export const driveGame = <S, V, A>(
  engine: ReplayEngine<S, V, A>,
  drive: Drive<S, V, A>,
): Driven<S> => {
  const dice = countingRng(mulberry32(drive.seed));
  const pick = mulberry32(drive.seed * 7919);
  const start = drive.start(dice, drive.now);
  type Run = Readonly<{ state: S; steps: number; done: boolean }>;
  // A fixed range stands in for a loop (the repo bans raw loops); finished games pass through.
  const run = Array.from({ length: drive.stepCap }).reduce<Run>(
    (acc) => {
      if (acc.done) return acc;
      const actor = engine.actorOf(acc.state) ?? 0;
      const view = engine.viewFor(acc.state, actor);
      const action = drive.policy(view, pick, engine.legalActions(view));
      const before = dice.calls();
      const r = engine.apply(acc.state, actor, action, dice, drive.now);
      if (!r.ok) {
        throw new Error(
          `seed ${String(drive.seed)} step ${String(acc.steps)} ${JSON.stringify(action)}: refused: ${r.error}`,
        );
      }
      drive.onStep?.({
        before: acc.state,
        after: r.value,
        view,
        actor,
        action,
        rngCalls: dice.calls() - before,
        step: acc.steps,
      });
      return { state: r.value, steps: acc.steps + 1, done: drive.over(r.value) };
    },
    { state: start, steps: 0, done: drive.over(start) },
  );
  return { start, ...run, rng: dice };
};

/** `count` seeds from `from`. */
export const seeds = (from: number, count: number): ReadonlyArray<number> =>
  Array.from({ length: count }, (_, i) => from + i);

/** Seeds of shard `n` (0-based): the n-th of `of` equal ranges of 1..games. */
export const shard = (n: number, of: number, games: number): ReadonlyArray<number> => {
  const from = Math.floor((n * games) / of) + 1;
  const to = Math.floor(((n + 1) * games) / of);
  return seeds(from, to - from + 1);
};

export type ReplayScale = Readonly<{
  /** The env knob, or `defaultGames`. */
  games: number;
  /** A suite's share of the total, scaled with the knob and never below one. */
  share: (base: number) => number;
  /** Two minutes, stretched with the knob and never shrunk. */
  timeoutMs: number;
}>;

/**
 * How many games a replay plays: `defaultGames` on every push and PR, `<envVar>=1000` in
 * .github/workflows/nightly.yml, lower for a quick local run.
 */
export const replayScale = (envVar: string, defaultGames: number): ReplayScale => {
  const env = (globalThis as { process?: { env?: Readonly<Record<string, string | undefined>> } })
    .process?.env;
  const games = Number(env?.[envVar] ?? defaultGames);
  const scale = games / defaultGames;
  return {
    games,
    share: (base) => Math.max(1, Math.round(base * scale)),
    timeoutMs: Math.ceil(120_000 * Math.max(1, scale)),
  };
};

/** Decoding the JSON text gives back a value whose JSON text is the same. */
export const byteStable = (
  value: unknown,
  decode: (u: unknown) => Readonly<{ ok: boolean; value?: unknown }>,
): boolean => {
  const text = JSON.stringify(value);
  const r = decode(JSON.parse(text) as unknown);
  return r.ok && JSON.stringify(r.value) === text;
};

/** `byteStable` as an assertion, the failure naming the value and the decoder's error. */
export const roundTrips = (
  label: string,
  decode: (x: unknown) => Readonly<{ ok: boolean }>,
  value: unknown,
): void => {
  const text = JSON.stringify(value);
  const r = decode(JSON.parse(text)) as { ok: boolean; value?: unknown; error?: unknown };
  expect(r.ok, `${label}: ${JSON.stringify(r.error)}`).toBe(true);
  expect(JSON.stringify(r.value), label).toBe(text);
};
