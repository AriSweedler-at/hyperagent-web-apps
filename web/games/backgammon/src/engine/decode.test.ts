// Byte-stable round trips (R32): every state of one seeded match and both of its views re-encode
// to the same JSON text after decoding; and the rejections the decoders owe the trust boundary.
import { describe, expect, test } from 'vitest';

import { failureOf, now, viaJson } from '../../../../../test/shared/engine-helpers.ts';
import { driveGame } from '../../../../../test/shared/replay.ts';
import { mulberry32 } from '../../../../shared/lib/rng.ts';
import { actorOf, applyAction } from './apply.ts';
import {
  decodeAction,
  decodeBoard,
  decodeDie,
  decodeMove,
  decodePointIndex,
  decodeSeat,
  decodeState,
  decodeView,
  pair,
} from './decode.ts';
import { createGame } from './setup.ts';
import { PLAYERS } from './test-helpers.ts';
import { ACTION_TYPES, type State } from './types.ts';
import { legalActions, viewFor } from './view.ts';

const seats = [0, 1] as const;

/** One seeded Western match to 3 played by a random policy: the state after every action. */
const trace = (seed: number): ReadonlyArray<State> => {
  const states: State[] = [];
  const run = driveGame(
    { apply: applyAction, viewFor, legalActions, actorOf },
    {
      seed,
      now,
      start: (dice, clock) =>
        createGame(PLAYERS, { matchLength: 3, rotation: ['backgammon'] }, dice, clock),
      // Doubling and passing are rare, as at a real table, or every game ends in a few steps.
      policy: (_view, pick, legal) => {
        const actions = legal.filter(
          (a) => (a.type !== 'double' || pick() < 0.1) && (a.type !== 'pass' || pick() < 0.2),
        );
        const action = actions[Math.floor(pick() * actions.length)];
        if (action === undefined) throw new Error(`no action at step ${String(states.length)}`);
        return action;
      },
      stepCap: 20_000,
      over: (s) => s.phase === 'over' && viewFor(s, 0).matchOver,
      onStep: ({ after }) => {
        states.push(after);
      },
    },
  );
  return [run.start, ...states];
};

describe('decodeState / decodeView round-trip the engine text', () => {
  test('every state and both views of a seeded match, byte for byte', () => {
    const states = trace(7);
    expect(states.length).toBeGreaterThan(100);
    expect(states.at(-1)?.games.length).toBeGreaterThan(0);
    states.forEach((state) => {
      const r = decodeState(viaJson(state));
      expect(failureOf(r)).toBe('ok');
      expect(r.ok && JSON.stringify(r.value)).toBe(JSON.stringify(state));
      seats.forEach((seat) => {
        const view = viewFor(state, seat);
        const d = decodeView(viaJson(view));
        expect(failureOf(d)).toBe('ok');
        expect(d.ok && JSON.stringify(d.value)).toBe(JSON.stringify(view));
      });
    });
  });

  test('the reserved phase and a decoded state deep-equal the original', () => {
    const s = createGame(PLAYERS, {}, mulberry32(1), now);
    const r = decodeState(viaJson({ ...s, phase: 'opening' }));
    expect(r.ok && r.value.phase).toBe('opening');
    const same = decodeState(viaJson(s));
    expect(same.ok && same.value).toEqual(s);
  });
});

describe('rejections', () => {
  const s = createGame(PLAYERS, { rotation: ['backgammon'] }, mulberry32(1), now);
  const json = viaJson(s) as Record<string, unknown> & {
    board: { points: unknown[]; off: unknown };
  };
  const bad = (patch: Record<string, unknown>): string =>
    failureOf(decodeState({ ...json, ...patch }));

  test('boards: 23 points, sixteen checkers, a stack of two owners', () => {
    expect(bad({ board: { ...json.board, points: json.board.points.slice(1) } })).toBe(
      '$.board.points: expected 24 points',
    );
    expect(bad({ board: { ...json.board, off: [1, 0] } })).toBe(
      '$.board: expected fifteen checkers a side',
    );
    const points = json.board.points.map((st, i) =>
      i === 0 ? [1, 0] : i === 5 ? [0, 0, 0, 0, 1] : st,
    );
    expect(bad({ board: { ...json.board, points } })).toBe('$.board: expected stacks of one owner');
    expect(failureOf(decodeBoard({ points: [], bar: [0], off: [0, 0] }))).toBe(
      '$.points: expected 24 points',
    );
    expect(failureOf(decodeBoard({ ...json.board, bar: [0] }))).toBe('$.bar: expected array of 2');
  });

  test('dice, variants, rotations and the reserved words', () => {
    expect(bad({ dice: [7, 1] })).toBe('$.dice[0]: expected one of 1 | 2 | 3 | 4 | 5 | 6');
    expect(bad({ variant: 'plakoto' })).toBe('$.variant: expected one of "portes" | "backgammon"');
    const options = json['options'] as Record<string, unknown>;
    expect(bad({ options: { ...options, rotation: [] } })).toBe(
      '$.options.rotation: expected a non-empty rotation',
    );
    expect(bad({ options: { ...options, rotation: ['fevga'] } })).toContain(
      '$.options.rotation[0]',
    );
    expect(bad({ phase: 'toDouble' })).toContain('$.phase: expected one of');
    expect(bad({ cube: { value: 128, owner: null } })).toContain('$.cube.value');
    expect(bad({ lastPlay: [{ from: 7, to: 4, die: 3 }] })).toBe(
      '$.lastPlay[0].hit: expected boolean',
    );
  });

  test('the phase must agree with the turn fields, or no action would ever be legal', () => {
    // A Western game 1 is `moving` with dice; a save that lost them would wedge the game.
    const wedged = '$: expected a phase that agrees with dice, played, turnStart and result';
    expect(bad({ dice: null, turnStart: null })).toBe(wedged);
    expect(bad({ turnStart: null })).toBe(wedged);
    expect(bad({ phase: 'toRoll' })).toBe(wedged);
    expect(bad({ phase: 'over' })).toBe(wedged);
    expect(
      bad({ phase: 'toRoll', turnStart: null, played: [{ from: 7, to: 4, die: 3, hit: false }] }),
    ).toBe(wedged);
    expect(
      bad({ result: { winner: 0, multiplier: 1, cube: 1, points: 1, reason: 'passed' } }),
    ).toBe(wedged);
    expect(bad({ phase: 'toRoll', turnStart: null })).toBe('ok');
    const view = viaJson(viewFor(s, 0)) as Record<string, unknown>;
    expect(failureOf(decodeView({ ...view, dice: null }))).toBe(
      '$: expected a phase that agrees with dice, played and result',
    );
    expect(failureOf(decodeView({ ...view, phase: 'over' }))).toContain('$: expected a phase');
    expect(failureOf(decodeView({ ...view, phase: 'toRoll' }))).toBe('ok');
  });

  test('actions: the type decides the keys; nothing else is accepted', () => {
    // The taggedUnion table has one case per ACTION_TYPES entry, in its order (D5): every entry
    // decodes, and a refused type names all seven in that order.
    ACTION_TYPES.forEach((type) => {
      const input = type === 'move' ? { type, from: 7, to: 4, die: 3 } : { type };
      const r = decodeAction({ ...input, extra: 1 });
      expect(r.ok && JSON.stringify(r.value)).toBe(JSON.stringify(input));
    });
    expect(decodeAction({ type: 'roll', extra: 1 })).toEqual({ ok: true, value: { type: 'roll' } });
    expect(decodeAction({ type: 'move', from: 'bar', to: 18, die: 6 })).toEqual({
      ok: true,
      value: { type: 'move', from: 'bar', to: 18, die: 6 },
    });
    expect(decodeAction({ type: 'move', from: 3, to: 'off', die: 6 }).ok).toBe(true);
    expect(failureOf(decodeAction({ type: 'move', from: 'off', to: 3, die: 1 }))).toBe(
      '$.from: expected one of 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 or one of "bar"',
    );
    expect(failureOf(decodeAction({ type: 'move', from: 7, to: 'bar', die: 1 }))).toContain('$.to');
    expect(failureOf(decodeAction({ type: 'move', from: 7, to: 4 }))).toBe(
      '$.die: expected one of 1 | 2 | 3 | 4 | 5 | 6',
    );
    expect(failureOf(decodeAction({ type: 'resign', level: 2 }))).toBe(
      '$.type: expected one of "roll" | "move" | "undo" | "double" | "take" | "pass" | "next"',
    );
    expect(failureOf(decodeAction('roll'))).toBe('$: expected object');
  });

  test('the small decoders', () => {
    expect(decodeSeat(1)).toEqual({ ok: true, value: 1 });
    expect(decodeSeat(2).ok).toBe(false);
    expect(decodeDie(6).ok).toBe(true);
    expect(decodeDie(0).ok).toBe(false);
    expect(decodePointIndex(23).ok).toBe(true);
    expect(decodePointIndex(24).ok).toBe(false);
    expect(decodeMove({ from: 0, to: 'off', die: 1 }).ok).toBe(true);
    expect(failureOf(pair(decodeDie)([1]))).toBe('$: expected array of 2');
    expect(failureOf(pair(decodeDie)([1, 2, 3]))).toBe('$: expected array of 2');
    expect(failureOf(pair(decodeDie)('x'))).toBe('$: expected array');
    const view = viewFor(s, 0);
    expect(failureOf(decodeView({ ...view, playsTotal: -1 }))).toBe(
      '$.playsTotal: expected integer in [0, 9007199254740991]',
    );
    expect(failureOf(decodeView({ ...view, actor: 2 }))).toContain('$.actor');
  });
});
