// The engine decoders against the legacy text (docs/MIGRATION.md step 11): every state and every
// view of seeded games on BOTH engines decodes and re-encodes to the same JSON text (values and key
// order), as do the views inside the recorded wire `state` frames and the games inside the captured
// `ginRummyMP_v1` saves. This is what lets protocol.ts and storage.ts promise byte-identical
// re-encoding without knowing the shapes themselves.
import { describe, expect, test } from 'vitest';

import * as current from '../../web/games/gin-rummy/src/engine/index.ts';
import type { Seat } from '../../web/games/gin-rummy/src/engine/index.ts';
import { PLAYERS, now, viaJson } from '../shared/engine-helpers.ts';
import { driveGame, roundTrips } from '../shared/replay.ts';
import { loadLegacyGin, type GinAction, type GinState, type GinView } from './gin.api.ts';
import { storageCaptures, wireFrames } from './gin.fixtures.ts';
import { actor, policy } from './gin.policy.ts';

const legacy = loadLegacyGin();
const SEEDS = Array.from({ length: 12 }, (_, i) => i + 101);
const STEP_CAP = 5000;

type Counted = { states: number; views: number };

/** Every state and both views after a step, re-encoded byte for byte. */
const roundTripsStep = <S>(
  label: string,
  state: S,
  viewFor: (s: S, seat: Seat) => unknown,
): void => {
  roundTrips(`${label} state`, current.decodeState, state);
  roundTrips(`${label} view 0`, current.decodeView, viewFor(state, 0));
  roundTrips(`${label} view 1`, current.decodeView, viewFor(state, 1));
};

/** One seeded game on the current engine, every state and view round-tripped. */
const currentGame = (seed: number): Counted => {
  const run = driveGame(
    {
      apply: current.applyAction,
      viewFor: current.viewFor,
      legalActions: current.legalActions,
      actorOf: (s) => actor(s as unknown as GinState) as Seat,
    },
    {
      seed,
      now,
      start: (rng, clock) =>
        current.createGame({ players: PLAYERS, target: 100, dealer: 0 }, rng, clock),
      policy: (view, pick, legal) =>
        policy(pick, viaJson(view) as Parameters<typeof policy>[1], viaJson(legal) as never),
      stepCap: STEP_CAP,
      over: (s) => s.phase === 'gameOver',
      onStep: ({ after, step }) => {
        roundTripsStep(`seed ${String(seed)} step ${String(step + 1)}`, after, current.viewFor);
      },
    },
  );
  expect(run.state.phase).toBe('gameOver');
  return { states: run.steps, views: run.steps * 2 };
};

/** The same on the legacy engine: its states and views are what the pages actually stored/sent. */
const legacyGame = (seed: number): Counted => {
  const run = driveGame<GinState, GinView, GinAction>(
    {
      // The legacy mutates in place and answers `{ ok }`: the state it was handed is the state after.
      apply: (s, seat, a, rng) => {
        const r = legacy.applyAction(s, seat, a, rng);
        return r.ok ? { ok: true, value: s } : { ok: false, error: r.error };
      },
      viewFor: legacy.viewFor,
      legalActions: legacy.legalActions,
      actorOf: (s) => actor(s) as Seat,
    },
    {
      seed,
      now,
      start: (rng) => legacy.createGame({ players: [...PLAYERS], target: 100, dealer: 1, rng }),
      policy: (view, pick, legal) => policy(pick, view, [...legal]),
      stepCap: STEP_CAP,
      over: (s) => s.phase === 'gameOver',
      onStep: ({ after, step }) => {
        roundTripsStep(
          `legacy seed ${String(seed)} step ${String(step + 1)}`,
          after,
          legacy.viewFor,
        );
      },
    },
  );
  return { states: run.steps, views: run.steps * 2 };
};

// Re-encoding every state and view of the seeded games takes ~1.5 s here and ~6 s on a CI runner
// under v8 coverage instrumentation, past vitest's 5 s default; the bound is generous on purpose.
const SEEDED_GAMES_TIMEOUT_MS = 60_000;

describe('engine decoders re-encode the engine text byte for byte', () => {
  test(
    'every state and view of seeded games on the current engine',
    () => {
      const counted = SEEDS.map(currentGame);
      expect(counted.reduce((n, c) => n + c.states, 0)).toBeGreaterThan(SEEDS.length * 100);
    },
    SEEDED_GAMES_TIMEOUT_MS,
  );

  test(
    'every state and view of seeded games on the legacy engine',
    () => {
      const counted = SEEDS.map(legacyGame);
      expect(counted.reduce((n, c) => n + c.views, 0)).toBeGreaterThan(SEEDS.length * 200);
    },
    SEEDED_GAMES_TIMEOUT_MS,
  );

  test('the views inside every recorded wire state frame', () => {
    const states = wireFrames().filter(({ frame }) => frame['t'] === 'state');
    expect(states.length).toBeGreaterThan(30);
    states.forEach(({ file, index, frame }) => {
      roundTrips(`${file}[${String(index)}].view`, current.decodeView, frame['view']);
    });
  });

  test('the games inside every captured ginRummyMP_v1 save that holds one', () => {
    const saves = storageCaptures()
      .filter((c) => c.key === 'ginRummyMP_v1')
      .map((c) => ({ variant: c.variant, save: JSON.parse(c.raw) as Record<string, unknown> }))
      .filter(({ save }) => save['game'] !== null && save['game'] !== undefined);
    expect(saves.map((s) => s.variant).sort()).toEqual([
      'host.midHand',
      'local.dealt',
      'local.midHand',
      'local.pendingDraw',
    ]);
    saves.forEach(({ variant, save }) => {
      roundTrips(`${variant}.game`, current.decodeState, save['game']);
    });
  });

  test('the actions of every recorded wire action frame', () => {
    const actions = wireFrames().filter(({ frame }) => frame['t'] === 'action');
    expect(actions).toHaveLength(9);
    actions.forEach(({ file, index, frame }) => {
      roundTrips(`${file}[${String(index)}].action`, current.decodeAction, frame['action']);
    });
  });
});
