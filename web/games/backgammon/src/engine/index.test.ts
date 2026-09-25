// The engine on the two-seat contract (web/shared/lib/game.ts, DRY round 2, F1): every member is
// the engine's own function under the contract's name, and `over` is the shell's end-screen test.
import { describe, expect, test } from 'vitest';

import { epoch as now } from '../../../../../test/shared/engine-helpers.ts';
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
import { PLAYERS, scripted } from './test-helpers.ts';

describe('ENGINE', () => {
  test("the members are the engine's functions; over is the won match, not the finished game", () => {
    expect(ENGINE.create).toBe(createGame);
    expect(ENGINE.apply).toBe(applyAction);
    expect(ENGINE.viewFor).toBe(viewFor);
    expect(ENGINE.legalActions).toBe(legalActions);
    expect(ENGINE.actorOf).toBe(actorOf);
    expect(ENGINE.decodeState).toBe(decodeState);
    expect(ENGINE.decodeView).toBe(decodeView);
    expect(ENGINE.decodeAction).toBe(decodeAction);
    const game = ENGINE.create(PLAYERS, { matchLength: 3 }, scripted(3, 1), now);
    const view = ENGINE.viewFor(game, 0);
    expect(ENGINE.over(view)).toBe(false);
    expect(ENGINE.over({ ...view, phase: 'over', matchOver: false })).toBe(false);
    expect(ENGINE.over({ ...view, phase: 'over', matchOver: true })).toBe(true);
  });
});
