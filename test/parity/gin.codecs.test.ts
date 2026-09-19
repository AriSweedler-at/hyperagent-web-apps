// The engine decoders against the legacy text (docs/MIGRATION.md step 11): every state and every
// view of seeded games on BOTH engines decodes and re-encodes to the same JSON text (values and key
// order), as do the views inside the recorded wire `state` frames and the games inside the captured
// `ginRummyMP_v1` saves. This is what lets protocol.ts and storage.ts promise byte-identical
// re-encoding without knowing the shapes themselves.
import { describe, expect, test } from 'vitest';

import * as current from '../../web/games/gin-rummy/src/engine/index.ts';
import type { Seat, State } from '../../web/games/gin-rummy/src/engine/index.ts';
import { mulberry32 } from '../../web/shared/lib/rng.ts';
import { loadLegacyGin, type GinState } from './gin.api.ts';
import { storageCaptures, wireFrames } from './gin.fixtures.ts';
import { actor, policy } from './gin.policy.ts';

const legacy = loadLegacyGin();
const SEEDS = Array.from({ length: 12 }, (_, i) => i + 101);
const STEP_CAP = 5000;
const PLAYERS = [
  { id: 'a', name: 'Alice' },
  { id: 'b', name: 'Bob' },
] as const;
const now = (): number => 1_700_000_000_000;

const viaJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

/** Decoding the JSON text gives back a value whose JSON text is the same. */
const roundTrips = (
  label: string,
  decode: (x: unknown) => { ok: boolean },
  value: unknown,
): void => {
  const text = JSON.stringify(value);
  const r = decode(JSON.parse(text)) as { ok: boolean; value?: unknown; error?: unknown };
  expect(r.ok, `${label}: ${JSON.stringify(r.error)}`).toBe(true);
  expect(JSON.stringify(r.value), label).toBe(text);
};

type Counted = { states: number; views: number };

/** One seeded game on the current engine, every state and view round-tripped. */
const currentGame = (seed: number): Counted => {
  const rng = mulberry32(seed);
  const choices = mulberry32(seed * 7919);
  const step = (acc: { state: State; n: number }): { state: State; n: number } => {
    const { state, n } = acc;
    if (n >= STEP_CAP || state.phase === 'gameOver') return acc;
    const seat = actor(state as unknown as GinState) as Seat;
    const view = current.viewFor(state, seat);
    const legacyView = viaJson(view) as Parameters<typeof policy>[1];
    const action = policy(choices, legacyView, viaJson(current.legalActions(view)) as never);
    const r = current.applyAction(state, seat, action, rng, now);
    if (!r.ok) throw new Error(r.error);
    const label = `seed ${String(seed)} step ${String(n + 1)}`;
    roundTrips(`${label} state`, current.decodeState, r.value);
    roundTrips(`${label} view 0`, current.decodeView, current.viewFor(r.value, 0));
    roundTrips(`${label} view 1`, current.decodeView, current.viewFor(r.value, 1));
    return step({ state: r.value, n: n + 1 });
  };
  const start = current.createGame({ players: PLAYERS, target: 100, dealer: 0 }, rng, now);
  const final = step({ state: start, n: 0 });
  expect(final.state.phase).toBe('gameOver');
  return { states: final.n, views: final.n * 2 };
};

/** The same on the legacy engine: its states and views are what the pages actually stored/sent. */
const legacyGame = (seed: number): Counted => {
  const rng = mulberry32(seed);
  const choices = mulberry32(seed * 7919);
  const state = legacy.createGame({ players: [...PLAYERS], target: 100, dealer: 1, rng });
  const step = (n: number): number => {
    if (n >= STEP_CAP || state.phase === 'gameOver') return n;
    const seat = actor(state);
    const view = legacy.viewFor(state, seat);
    const action = policy(choices, view, legacy.legalActions(view));
    const r = legacy.applyAction(state, seat, action, rng);
    if (!r.ok) throw new Error(r.error);
    const label = `legacy seed ${String(seed)} step ${String(n + 1)}`;
    roundTrips(`${label} state`, current.decodeState, state);
    roundTrips(`${label} view 0`, current.decodeView, legacy.viewFor(state, 0));
    roundTrips(`${label} view 1`, current.decodeView, legacy.viewFor(state, 1));
    return step(n + 1);
  };
  const steps = step(0);
  return { states: steps, views: steps * 2 };
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
