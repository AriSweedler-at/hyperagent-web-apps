import { describe, expect, test } from 'vitest';

import { mulberry32 } from '../../../../../shared/lib/rng.ts';
import { applyAction, createGame, viewFor } from '../../engine/index.ts';
import type { Action, Seat, State, View } from '../../engine/index.ts';
import { drawSource, holdOf, settleDraw, type DrawStage } from './draw.ts';

const now = (): number => 1_700_000_000_000;
const PLAYERS = [
  { id: 'p1', name: 'Ann' },
  { id: 'p2', name: 'Bob' },
] as const;
const play = (state: State, moves: ReadonlyArray<readonly [Seat, Action]>): State =>
  moves.reduce((g, [seat, a]) => {
    const r = applyAction(g, seat, a, mulberry32(0), now);
    if (!r.ok) throw new Error(r.error);
    return r.value;
  }, state);

/** Dealer 1, so seat 0 (Ann) is the non-dealer and moves first. */
const dealt = createGame({ players: PLAYERS, target: 100, dealer: 1 }, mulberry32(3), now);
const passed = play(dealt, [
  [0, { type: 'passUpcard' }],
  [1, { type: 'passUpcard' }],
]);
const drawn = play(passed, [[0, { type: 'drawStock' }]]);
const undone = play(drawn, [[0, { type: 'undoDraw' }]]);
const took = play(dealt, [[0, { type: 'takeUpcard' }]]);

const hold = holdOf(viewFor(passed, 0).me);
const waiting: DrawStage = { kind: 'waiting', from: 'stock', hold };
const drawnId = viewFor(drawn, 0).lastDrawnId ?? '';
const shown: DrawStage = { kind: 'shown', from: 'stock', cardId: drawnId, hold };

describe('holdOf / drawSource', () => {
  test('the hold is the melds and deadwood of the view, nothing else', () => {
    const me = viewFor(passed, 0).me;
    expect(hold).toEqual({ melds: me.melds, deadwood: me.deadwood });
    expect(Object.keys(hold)).toEqual(['melds', 'deadwood']);
  });

  test('the three draws name their source; every other action is not a draw', () => {
    expect(drawSource({ type: 'drawStock' })).toBe('stock');
    expect(drawSource({ type: 'drawDiscard' })).toBe('discard');
    expect(drawSource({ type: 'takeUpcard' })).toBe('discard');
    (
      [
        { type: 'passUpcard' },
        { type: 'undoDraw' },
        { type: 'ready' },
        { type: 'discard', cardId: 'AS' },
        { type: 'knock', cardId: 'AS' },
        { type: 'setMelds', melds: [] },
      ] satisfies ReadonlyArray<Action>
    ).forEach((a) => {
      expect(drawSource(a)).toBeNull();
    });
  });
});

describe('settleDraw', () => {
  const v = viewFor(drawn, 0);

  test('no stage stays no stage, whatever the view', () => {
    expect(settleDraw(null, v)).toBeNull();
    expect(settleDraw(null, viewFor(passed, 0))).toBeNull();
  });

  test('a view carrying my undoable draw shows the drawn card; the same shown stage is kept as is', () => {
    expect(settleDraw(waiting, v)).toEqual(shown);
    expect(settleDraw(shown, v)).toBe(shown);
    // The hold travels from the waiting stage: the ten cards as they were before the draw.
    expect(settleDraw(waiting, v)?.hold).toBe(hold);
  });

  test('a shown stage for another card (a stale stage) is re-keyed to the view', () => {
    const stale: DrawStage = { ...shown, cardId: 'ZZ' };
    expect(settleDraw(stale, v)).toEqual(shown);
  });

  test('waiting survives a view that still awaits my draw (draw or upcard phase, my turn)', () => {
    expect(settleDraw(waiting, viewFor(passed, 0))).toBe(waiting);
    const upcard: DrawStage = {
      kind: 'waiting',
      from: 'discard',
      hold: holdOf(viewFor(dealt, 0).me),
    };
    expect(settleDraw(upcard, viewFor(dealt, 0))).toBe(upcard);
  });

  test('anything else clears it: the undo, the opponent turn, a discard already made, no undo', () => {
    expect(settleDraw(shown, viewFor(undone, 0))).toBeNull();
    expect(settleDraw(waiting, viewFor(undone, 1))).toBeNull();
    expect(settleDraw(shown, viewFor(drawn, 1))).toBeNull();
    const noUndo: View = { ...v, canUndo: false };
    expect(settleDraw(shown, noUndo)).toBeNull();
    const noFresh: View = { ...v, lastDrawnId: null };
    expect(settleDraw(waiting, noFresh)).toBeNull();
    const theirs: View = { ...v, isMyTurn: false };
    expect(settleDraw(shown, theirs)).toBeNull();
  });

  test('the upcard taken: shown from the discard pile with the locked card', () => {
    const stage: DrawStage = {
      kind: 'waiting',
      from: 'discard',
      hold: holdOf(viewFor(dealt, 0).me),
    };
    const settled = settleDraw(stage, viewFor(took, 0));
    expect(settled?.kind).toBe('shown');
    expect(settled?.from).toBe('discard');
    expect(settled !== null && settled.kind === 'shown' ? settled.cardId : null).toBe(
      took.drawnFromDiscard,
    );
  });
});
