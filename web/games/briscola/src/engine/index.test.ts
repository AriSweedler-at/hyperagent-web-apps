// ENGINE, the engine on web/shared/lib/game.ts's two-seat contract as far as it reaches four seats:
// its members are the module's own functions, `over` is the match decided, and the shape minus
// `actorOf` is assignable to `TwoSeatEngine` (the compile-time check below is the pin).
import { describe, expect, test } from 'vitest';

import type { TwoSeatEngine } from '../../../../shared/lib/game.ts';
import { mulberry32 } from '../../../../shared/lib/rng.ts';
import * as B from './index.ts';

const players = [
  { id: 'a', name: 'Ari' },
  { id: 'b', name: 'Jeff' },
] as const;
const now = (): number => 0;

describe('ENGINE (the two-seat contract, N-seat where it fits)', () => {
  test("every member is the module's own function", () => {
    expect(B.ENGINE.create).toBe(B.createGame);
    expect(B.ENGINE.apply).toBe(B.applyAction);
    expect(B.ENGINE.viewFor).toBe(B.viewFor);
    expect(B.ENGINE.legalActions).toBe(B.legalActions);
    expect(B.ENGINE.actorOf).toBe(B.actorOf);
    expect(B.ENGINE.decodeState).toBe(B.decodeState);
    expect(B.ENGINE.decodeView).toBe(B.decodeView);
    expect(B.ENGINE.decodeAction).toBe(B.decodeAction);
  });

  test('over is the match decided: false at the deal, true once a side has gamesToWin', () => {
    const s = B.ENGINE.create(players, { gamesToWin: 1 }, mulberry32(1), now);
    expect(B.ENGINE.over(B.ENGINE.viewFor(s, 0))).toBe(false);
    const decided = { ...s, match: { gamesToWin: 1 as const, wins: [1, 0], draws: 0 } };
    expect(B.ENGINE.over(B.ENGINE.viewFor(decided, 1))).toBe(true);
  });

  test('everything but actorOf is assignable to TwoSeatEngine; actorOf is wider by two seats', () => {
    // A compile-time pin: a two-seat shell may hold the engine minus `actorOf` on the contract.
    const twoSeat: Omit<
      TwoSeatEngine<B.State, B.View, B.Action, B.CreateGameOptions>,
      'actorOf'
    > = B.ENGINE;
    expect(twoSeat.create).toBe(B.createGame);
    // And the engine's own actorOf may name seats 2 and 3, which the contract's Seat cannot.
    const four = B.createGame(
      [...players, { id: 'c', name: 'Kim' }, { id: 'd', name: 'Dan' }],
      {},
      mulberry32(1),
      now,
    );
    const actor: B.Seat | null = B.ENGINE.actorOf(four);
    expect(actor).toBe(four.turn);
  });
});
