// The engine on the two-seat contract (web/shared/lib/game.ts, DRY round 2, F1): `create` is the
// adapter over `createGame`'s options, `over` the end-screen test, the rest the engine's own
// functions; and `actorOf`, new engine surface with no legacy oracle, pinned here on its own.
import { describe, expect, test } from 'vitest';

import { mulberry32 } from '../../../../shared/lib/rng.ts';
import {
  ENGINE,
  actorOf,
  applyAction,
  createGame,
  decodeAction,
  decodeState,
  decodeView,
  legalActions,
  viewFor,
} from './index.ts';

const now = (): number => 1_700_000_000_000;
const PLAYERS = [
  { id: 'a', name: 'Alice' },
  { id: 'b', name: 'Bob' },
] as const;

describe('ENGINE', () => {
  test('create seats the players into createGame; the defaults apply when the options are empty', () => {
    const chosen = ENGINE.create(PLAYERS, { target: 50, dealer: 1 }, mulberry32(1), now);
    expect(chosen).toEqual(
      createGame({ players: PLAYERS, target: 50, dealer: 1 }, mulberry32(1), now),
    );
    const defaults = ENGINE.create(PLAYERS, {}, mulberry32(2), now);
    expect(defaults).toEqual(createGame({ players: PLAYERS }, mulberry32(2), now));
    expect(defaults.target).toBe(100);
  });

  test("over is the shell's gameOver test; the other members are the engine's functions", () => {
    const game = createGame({ players: PLAYERS, dealer: 0 }, mulberry32(3), now);
    const view = viewFor(game, 0);
    expect(ENGINE.over(view)).toBe(false);
    expect(ENGINE.over({ ...view, phase: 'roundOver' })).toBe(false);
    expect(ENGINE.over({ ...view, phase: 'gameOver' })).toBe(true);
    expect(ENGINE.apply).toBe(applyAction);
    expect(ENGINE.viewFor).toBe(viewFor);
    expect(ENGINE.legalActions).toBe(legalActions);
    expect(ENGINE.actorOf).toBe(actorOf);
    expect(ENGINE.decodeState).toBe(decodeState);
    expect(ENGINE.decodeView).toBe(decodeView);
    expect(ENGINE.decodeAction).toBe(decodeAction);
  });
});

describe('actorOf', () => {
  test('the turn while a hand is played; between hands the first seat not yet ready', () => {
    const game = createGame({ players: PLAYERS, dealer: 0 }, mulberry32(4), now);
    expect(game.phase).toBe('upcard');
    expect(actorOf(game)).toBe(game.turn);
    expect(actorOf({ ...game, phase: 'draw', turn: 1 })).toBe(1);
    expect(actorOf({ ...game, phase: 'discard', turn: 0 })).toBe(0);
    expect(actorOf({ ...game, phase: 'layoff', turn: 1 })).toBe(1);
    (['roundOver', 'gameOver'] as const).forEach((phase) => {
      expect(actorOf({ ...game, phase, turn: 1, ready: [false, false] })).toBe(0);
      expect(actorOf({ ...game, phase, turn: 0, ready: [true, false] })).toBe(1);
      expect(actorOf({ ...game, phase, turn: 1, ready: [false, true] })).toBe(0);
    });
  });

  test('the seat it names is the one whose action the engine accepts', () => {
    const dealt = createGame({ players: PLAYERS, dealer: 1 }, mulberry32(5), now);
    const seat = actorOf(dealt);
    expect(applyAction(dealt, seat, { type: 'passUpcard' }, mulberry32(0), now).ok).toBe(true);
    expect(
      applyAction(dealt, seat === 0 ? 1 : 0, { type: 'passUpcard' }, mulberry32(0), now),
    ).toEqual({
      ok: false,
      error: "It's not your turn.",
    });
  });
});
