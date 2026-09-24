// The per-seat view (rules §2 `View`): the wire key order, what belongs to the mover only
// (legal, plays, canUndo), the PLAYS_CAP with the true count beside it, canDouble and the finished
// game, and `legalActions` per phase for the actor, which the replay policy draws from.
import { describe, expect, test } from 'vitest';

import { applyAction } from './apply.ts';
import { parsePosition } from './notation.ts';
import { createGame, withPosition } from './setup.ts';
import { PLAYS_CAP, type Board, type Seat, type State } from './types.ts';
import { VARIANTS } from './variants.ts';
import { legalActions, viewFor } from './view.ts';

const PLAYERS = [
  { id: 'a', name: 'Ari' },
  { id: 'b', name: 'Jeff' },
] as const;
const now = (): number => 0;
const scripted = (...dice: ReadonlyArray<number>): (() => number) => {
  let i = 0;
  return () => ((dice[i++] ?? 1) - 0.5) / 6;
};
const pos = (text: string): Board => {
  const r = parsePosition(text, VARIANTS.portes);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const START = 'L: 24:2 13:5 8:3 6:5 | D: 24:2 13:5 8:3 6:5 | bar 0/0 | off 0/0';
const western = createGame(PLAYERS, { rotation: ['backgammon'] }, scripted(3, 1), now);
const must = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe('viewFor', () => {
  test('key order is the wire order; both seats see the same board and pips', () => {
    const v0 = viewFor(western, 0);
    const v1 = viewFor(western, 1);
    expect(Object.keys(v0)).toEqual([
      'me',
      'opp',
      'players',
      'options',
      'variant',
      'gameNo',
      'phase',
      'turn',
      'actor',
      'isMyTurn',
      'board',
      'opening',
      'dice',
      'movesLeft',
      'played',
      'lastPlay',
      'legal',
      'plays',
      'playsTotal',
      'canUndo',
      'canDouble',
      'canBearOff',
      'pips',
      'cube',
      'match',
      'matchOver',
      'result',
      'games',
      'log',
      'lastAction',
      'startedAt',
      'endedAt',
    ]);
    expect(v0.board).toEqual(v1.board);
    expect(v0.pips).toEqual([167, 167]);
    expect(v1.pips).toEqual([167, 167]);
    expect(v0.me).toEqual({ idx: 0, id: 'a', name: 'Ari' });
    expect(v0.opp).toEqual({ idx: 1, id: 'b', name: 'Jeff' });
    expect(v1.me).toEqual({ idx: 1, id: 'b', name: 'Jeff' });
    expect(v0.canBearOff).toEqual([false, false]);
    expect(v0.matchOver).toBe(false);
  });

  test('legal, plays and canUndo belong to the mover only', () => {
    const v0 = viewFor(western, 0);
    const v1 = viewFor(western, 1);
    expect(v0).toMatchObject({ actor: 0, isMyTurn: true, movesLeft: [3, 1], canUndo: false });
    expect(v0.legal).toHaveLength(7);
    expect(v0.plays).toHaveLength(31);
    expect(v0.playsTotal).toBe(31);
    expect(v0.plays.every((p) => p.length === 2)).toBe(true);
    // Canonical order: plays sorted by their move keys, the first move's key leading.
    expect(v0.plays.map((p) => p[0]).slice(0, 2)).toEqual([v0.legal[0], v0.legal[0]]);
    expect(v1).toMatchObject({
      actor: 0,
      isMyTurn: false,
      legal: [],
      plays: [],
      playsTotal: 0,
      canUndo: false,
    });
    expect(v1.movesLeft).toEqual([3, 1]);
    const moved = must(
      applyAction(western, 0, { type: 'move', from: 7, to: 4, die: 3 }, scripted(), now),
    );
    const v = viewFor(moved, 0);
    expect(v.canUndo).toBe(true);
    expect(v.movesLeft).toEqual([1]);
    expect(v.played).toHaveLength(1);
    expect(v.plays.every((p) => p.length === 1)).toBe(true);
  });

  test('plays are capped at PLAYS_CAP with the true count beside them', () => {
    const s = withPosition(western, pos(START), 0, [3, 3]);
    const v = viewFor(s, 0);
    expect(v.playsTotal).toBe(536);
    expect(v.plays).toHaveLength(PLAYS_CAP);
    expect(viewFor(s, 1).playsTotal).toBe(0);
  });

  test('canDouble, matchOver and the finished game', () => {
    const toRoll = withPosition(western, pos(START), 1, null);
    expect(viewFor(toRoll, 1)).toMatchObject({
      canDouble: true,
      isMyTurn: true,
      actor: 1,
      legal: [],
      movesLeft: [],
    });
    expect(viewFor(toRoll, 0).canDouble).toBe(false);
    const offered = must(applyAction(toRoll, 1, { type: 'double' }, scripted(), now));
    expect(viewFor(offered, 0)).toMatchObject({ actor: 0, isMyTurn: true, phase: 'cubeOffered' });
    expect(viewFor(offered, 1).isMyTurn).toBe(false);
    const over = must(applyAction(offered, 0, { type: 'pass' }, scripted(), now));
    const seats: ReadonlyArray<Seat> = [0, 1];
    seats.forEach((seat) => {
      expect(viewFor(over, seat)).toMatchObject({
        actor: null,
        isMyTurn: false,
        matchOver: false,
        legal: [],
      });
    });
    const finished: State = { ...over, match: { ...over.match, score: [0, 5] } };
    expect(viewFor(finished, 0).matchOver).toBe(true);
  });
});

describe('legalActions', () => {
  test('per phase, for the actor only', () => {
    const v0 = viewFor(western, 0);
    expect(legalActions(v0)).toEqual(v0.legal.map((m) => ({ type: 'move', ...m })));
    expect(legalActions(viewFor(western, 1))).toEqual([]);
    const moved = must(
      applyAction(western, 0, { type: 'move', from: 7, to: 4, die: 3 }, scripted(), now),
    );
    expect(legalActions(viewFor(moved, 0)).at(-1)).toEqual({ type: 'undo' });
    const toRoll = withPosition(western, pos(START), 1, null);
    expect(legalActions(viewFor(toRoll, 1))).toEqual([{ type: 'roll' }, { type: 'double' }]);
    // `opening` is reserved: it rolls but never doubles.
    expect(legalActions(viewFor({ ...toRoll, phase: 'opening' }, 1))).toEqual([{ type: 'roll' }]);
    const portes = withPosition(createGame(PLAYERS, {}, scripted(3, 1), now), pos(START), 1, null);
    expect(legalActions(viewFor(portes, 1))).toEqual([{ type: 'roll' }]);
    const offered = must(applyAction(toRoll, 1, { type: 'double' }, scripted(), now));
    expect(legalActions(viewFor(offered, 0))).toEqual([{ type: 'take' }, { type: 'pass' }]);
    expect(legalActions(viewFor(offered, 1))).toEqual([]);
    const over = must(applyAction(offered, 0, { type: 'pass' }, scripted(), now));
    expect(legalActions(viewFor(over, 0))).toEqual([{ type: 'next' }]);
    expect(legalActions(viewFor(over, 1))).toEqual([{ type: 'next' }]);
    expect(legalActions(viewFor({ ...over, match: { ...over.match, score: [0, 5] } }, 1))).toEqual(
      [],
    );
  });
});
