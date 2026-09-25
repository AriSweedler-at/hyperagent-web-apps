// The coin game as the self-test of the shared replay driver (dry-round-2.md F3, §6 "the
// shared-integration suite's fake game"): the driver reaches `done` under the cap, reads the dice
// from `mulberry32(seed)` and the picks from `mulberry32(seed * 7919)`, calls the policy once per
// step before `apply` (the order gin's legacy leg and backgammon's invariant #10 depend on), counts
// one rng read per flip and none per pass, and the seeds, shards, env knob, byte stability and
// round trips behave; then the coin's own rules and decoders, every branch, for its 100% row.
import { describe, expect, test } from 'vitest';

import {
  countingRng,
  epoch,
  failureOf,
  must,
  now,
  NOW,
  PLAYERS,
  runIntents,
  viaJson,
} from '../../../../test/shared/engine-helpers.ts';
import {
  byteStable,
  driveGame,
  replayScale,
  roundTrips,
  seeds,
  shard,
  type Step,
} from '../../../../test/shared/replay.ts';
import { mulberry32 } from '../../lib/rng.ts';
import * as coin from './coin.ts';
import type { Action, State, View } from './coin.ts';

const start = (rng: () => number, clock: () => number): State =>
  coin.create(PLAYERS, { target: 3 }, rng, clock);
/** Flips three times in four, passes otherwise: one pick per step. */
const policy = (_view: View, pick: () => number, legal: ReadonlyArray<Action>): Action => {
  const action = legal[pick() < 0.75 ? 0 : 1];
  if (action === undefined) throw new Error('no legal action');
  return action;
};
const heads = (): number => 0.1;
const tails = (): number => 0.9;

describe('driveGame', () => {
  test('plays the seed to `over` under the cap; every step chains; the policy runs before apply', () => {
    const order: string[] = [];
    const run = driveGame(coin, {
      seed: 7,
      now,
      start,
      policy: (view, pick, legal) => {
        order.push('policy');
        return policy(view, pick, legal);
      },
      stepCap: 500,
      over: coin.over,
      onStep: ({ before, after, view, actor, step }) => {
        order.push('apply');
        expect(step).toBe(order.length / 2 - 1);
        expect(view).toEqual(coin.viewFor(before, actor));
        expect(actor).toBe(before.turn);
        expect(after.turn).toBe(coin.otherSeat(actor));
      },
    });
    expect(run.done).toBe(true);
    expect(run.state.phase).toBe('over');
    expect(run.steps).toBeGreaterThan(2);
    expect(run.start.phase).toBe('play');
    expect(order).toEqual(Array.from({ length: run.steps }).flatMap(() => ['policy', 'apply']));
  });

  test('the dice are mulberry32(seed), the picks mulberry32(seed * 7919); one read per flip, none per pass', () => {
    const steps: Step<State, View, Action>[] = [];
    const firstPicks: number[] = [];
    const run = driveGame(coin, {
      seed: 11,
      now: epoch,
      start,
      policy: (view, pick, legal) => {
        const p = pick();
        firstPicks.push(p);
        return policy(view, () => p, legal);
      },
      stepCap: 500,
      over: coin.over,
      onStep: (step) => steps.push(step),
    });
    expect(run.start.turn).toBe(mulberry32(11)() < 0.5 ? 0 : 1);
    expect(firstPicks[0]).toBe(mulberry32(11 * 7919)());
    steps.forEach(({ action, rngCalls }) => {
      expect(rngCalls).toBe(action.type === 'flip' ? 1 : 0);
    });
    const flips = steps.filter((s) => s.action.type === 'flip').length;
    expect(flips).toBeGreaterThan(0);
    expect(steps.length - flips).toBeGreaterThan(0);
    // The returned rng is the dice where the game left them: `create` read once, each flip once.
    expect((run.rng as ReturnType<typeof countingRng>).calls()).toBe(1 + flips);
    // Same seed, same game, byte for byte.
    const again = driveGame(coin, {
      seed: 11,
      now: epoch,
      start,
      policy,
      stepCap: 500,
      over: coin.over,
    });
    expect(JSON.stringify(again.state)).toBe(JSON.stringify(run.state));
    expect(again.steps).toBe(run.steps);
  });

  test('the cap turns a hang into `done: false`; a game over at the start takes no step', () => {
    const passing = driveGame(coin, {
      seed: 1,
      now,
      start,
      policy: () => ({ type: 'pass' as const }),
      stepCap: 5,
      over: coin.over,
    });
    expect(passing).toMatchObject({ steps: 5, done: false });
    const finished = driveGame(coin, {
      seed: 1,
      now,
      start: (rng, clock) => coin.create(PLAYERS, { target: 0 }, rng, clock),
      policy,
      stepCap: 5,
      over: (s) => coin.viewFor(s, 0).result !== null,
    });
    expect(finished).toMatchObject({ steps: 0, done: true });
  });

  test('a refused action fails with the seed, the step and the action', () => {
    expect(() =>
      driveGame(
        { ...coin, actorOf: (s) => coin.otherSeat(s.turn) },
        {
          seed: 3,
          now,
          start,
          policy: () => ({ type: 'flip' as const }),
          stepCap: 5,
          over: coin.over,
        },
      ),
    ).toThrow('seed 3 step 0 {"type":"flip"}: refused: Not your turn');
  });
});

describe('seeds, shards and the env knob', () => {
  test('seeds(from, count) and shard(n, of, games) partition 1..games in order, without overlap', () => {
    expect(seeds(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(seeds(101, 0)).toEqual([]);
    expect([0, 1, 2, 3].flatMap((n) => shard(n, 4, 100))).toEqual(seeds(1, 100));
    expect(shard(0, 4, 10)).toEqual([1, 2]);
    expect(shard(1, 4, 10)).toEqual([3, 4, 5]);
    expect(shard(3, 4, 10)).toEqual([8, 9, 10]);
  });

  test('replayScale reads the knob and scales the shares and the timeout, never below the defaults', () => {
    const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } })
      .process.env;
    delete env['COIN_REPLAY_GAMES'];
    const base = replayScale('COIN_REPLAY_GAMES', 91);
    expect(base.games).toBe(91);
    expect([base.share(60), base.share(25), base.share(6)]).toEqual([60, 25, 6]);
    expect(base.timeoutMs).toBe(120_000);
    env['COIN_REPLAY_GAMES'] = '182';
    const doubled = replayScale('COIN_REPLAY_GAMES', 91);
    expect(doubled.games).toBe(182);
    expect([doubled.share(60), doubled.share(0)]).toEqual([120, 1]);
    expect(doubled.timeoutMs).toBe(240_000);
    env['COIN_REPLAY_GAMES'] = '45';
    const quick = replayScale('COIN_REPLAY_GAMES', 91);
    expect(quick.share(6)).toBe(3);
    expect(quick.timeoutMs).toBe(120_000);
    delete env['COIN_REPLAY_GAMES'];
  });
});

describe('byteStable and roundTrips', () => {
  test('every state and both views of a driven game re-encode byte for byte', () => {
    driveGame(coin, {
      seed: 5,
      now,
      start,
      policy,
      stepCap: 500,
      over: coin.over,
      onStep: ({ after, step }) => {
        expect(byteStable(after, coin.decodeState)).toBe(true);
        roundTrips(`step ${String(step)} state`, coin.decodeState, after);
        roundTrips(`step ${String(step)} view 0`, coin.decodeView, coin.viewFor(after, 0));
        roundTrips(`step ${String(step)} view 1`, coin.decodeView, coin.viewFor(after, 1));
      },
    });
  });

  test('a decoder that drops a key, or refuses, is not byte-stable', () => {
    expect(byteStable({ type: 'flip', extra: 1 }, coin.decodeAction)).toBe(false);
    expect(byteStable({ type: 'resign' }, coin.decodeAction)).toBe(false);
    expect(byteStable({ type: 'pass' }, coin.decodeAction)).toBe(true);
  });
});

describe('the coin rules', () => {
  const s0 = coin.create(PLAYERS, {}, heads, now);

  test('create: the default target, the first seat from one rng read, the clock', () => {
    expect(s0).toEqual({
      players: PLAYERS,
      target: coin.DEFAULT_TARGET,
      heads: [0, 0],
      lastFlip: [null, null],
      turn: 0,
      phase: 'play',
      startedAt: NOW,
      endedAt: null,
    });
    expect(coin.create(PLAYERS, { target: 1 }, tails, epoch)).toMatchObject({
      target: 1,
      turn: 1,
      startedAt: 0,
    });
  });

  test('a pass changes the turn and reads nothing; the wrong seat is refused', () => {
    const rng = countingRng(heads);
    const passed = must(coin.apply(s0, 0, { type: 'pass' }, rng, now));
    expect(passed).toEqual({ ...s0, turn: 1 });
    expect(rng.calls()).toBe(0);
    expect(failureOf(coin.apply(s0, 1, { type: 'pass' }, rng, now))).toBe(
      coin.MESSAGES.NOT_YOUR_TURN,
    );
  });

  test('a flip reads once; heads count, tails do not; the target ends the game', () => {
    const rng = countingRng(heads);
    const one = must(coin.apply(s0, 0, { type: 'flip' }, rng, now));
    expect(rng.calls()).toBe(1);
    expect(one).toMatchObject({ heads: [1, 0], lastFlip: ['heads', null], turn: 1, phase: 'play' });
    const miss = must(coin.apply(one, 1, { type: 'flip' }, tails, now));
    expect(miss).toMatchObject({ heads: [1, 0], lastFlip: ['heads', 'tails'], turn: 0 });
    const won = [0, 1, 0].reduce(
      (s, seat) => must(coin.apply(s, seat as 0 | 1, { type: 'flip' }, heads, now)),
      miss,
    );
    expect(won).toMatchObject({ heads: [3, 1], phase: 'over', endedAt: NOW });
    expect(coin.actorOf(won)).toBeNull();
    expect(coin.over(won)).toBe(true);
    expect(failureOf(coin.apply(won, 0, { type: 'flip' }, heads, now))).toBe(
      coin.MESSAGES.GAME_OVER,
    );
    expect(coin.viewFor(won, 0).result).toBe(0);
    expect(coin.viewFor(won, 1).result).toBe(0);
    // Seat 1 reaching the target first.
    const other = [1, 0, 1, 0, 1].reduce<State>(
      (s, seat) =>
        must(
          coin.apply(
            s,
            seat as 0 | 1,
            seat === 1 ? { type: 'flip' } : { type: 'pass' },
            heads,
            now,
          ),
        ),
      { ...s0, turn: 1 },
    );
    expect(coin.viewFor(other, 0).result).toBe(1);
  });

  test('viewFor hides the other seat’s last flip; legalActions only for the actor', () => {
    const one = must(coin.apply(s0, 0, { type: 'flip' }, heads, now));
    const v0 = coin.viewFor(one, 0);
    const v1 = coin.viewFor(one, 1);
    expect(v0).toEqual({
      me: { idx: 0, name: 'Alice', heads: 1, lastFlip: 'heads' },
      opp: { name: 'Bob', heads: 0 },
      target: 3,
      phase: 'play',
      turn: 1,
      isMyTurn: false,
      result: null,
      startedAt: NOW,
    });
    expect(v1.me).toEqual({ idx: 1, name: 'Bob', heads: 0, lastFlip: null });
    expect(v1.opp).toEqual({ name: 'Alice', heads: 1 });
    expect(v1.isMyTurn).toBe(true);
    expect(coin.legalActions(v0)).toEqual([]);
    expect(coin.legalActions(v1)).toEqual([{ type: 'flip' }, { type: 'pass' }]);
    expect(coin.actorOf(one)).toBe(1);
  });

  test('the decoders refuse the wrong shapes with the shared error texts', () => {
    const json = viaJson(s0) as Record<string, unknown>;
    expect(failureOf(coin.decodeState({ ...json, turn: 2 }))).toBe('$.turn: expected one of 0 | 1');
    expect(failureOf(coin.decodeState({ ...json, heads: [0] }))).toBe(
      '$.heads: expected array of 2',
    );
    expect(failureOf(coin.decodeState({ ...json, heads: 'x' }))).toBe('$.heads: expected array');
    expect(failureOf(coin.decodeState({ ...json, lastFlip: ['edge', null] }))).toBe(
      '$.lastFlip[0]: expected one of "heads" | "tails"',
    );
    expect(failureOf(coin.decodeState({ ...json, phase: 'paused' }))).toBe(
      '$.phase: expected one of "play" | "over"',
    );
    // `oneOf` names every alternative at the root: the nested path is not kept.
    expect(failureOf(coin.decodeAction({ type: 'resign' }))).toBe(
      '$: expected one of "flip" or one of "pass"',
    );
    expect(
      failureOf(coin.decodeView({ ...(viaJson(coin.viewFor(s0, 0)) as object), result: 2 })),
    ).toBe('$.result: expected one of 0 | 1');
    expect(coin.decodeState(json)).toEqual({ ok: true, value: s0 });
  });
});

describe('the engine helpers', () => {
  test('failureOf reads both result shapes; must unwraps or throws; viaJson copies', () => {
    expect(failureOf({ ok: true })).toBe('ok');
    expect(failureOf({ ok: false, error: 'nope' })).toBe('nope');
    expect(failureOf({ ok: false, error: { path: ['a', 0], expected: 'integer' } })).toBe(
      '$.a[0]: expected integer',
    );
    expect(must({ ok: true, value: 4 })).toBe(4);
    expect(() => must({ ok: false, error: 'refused' })).toThrow('refused');
    const value = { a: [1, { b: null }] };
    expect(viaJson(value)).toEqual(value);
    expect(viaJson(value)).not.toBe(value);
  });

  test('runIntents dispatches in turn and concatenates the effects', () => {
    type App = Readonly<{ n: number }>;
    const reduce = (
      app: App,
      intent: number,
      ctx: Readonly<{ k: number }>,
    ): Readonly<{ app: App; effects: ReadonlyArray<string> }> => ({
      app: { n: app.n + intent * ctx.k },
      effects: [`+${String(intent)}`],
    });
    const run = runIntents(reduce, { k: 10 });
    expect(run({ n: 0 }, 1, 2, 3)).toEqual({ app: { n: 60 }, effects: ['+1', '+2', '+3'] });
    expect(run({ n: 5 })).toEqual({ app: { n: 5 }, effects: [] });
  });
});
