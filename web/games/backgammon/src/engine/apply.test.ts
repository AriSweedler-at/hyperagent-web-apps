// The reducer's action x phase matrix (panel E1 §4 scenarios S1-S15, every MESSAGES entry
// reachable), the turn flows of the table rows that end turns and games through `applyAction`
// (auto-end, forfeited roll, hits, bear-off finishes), the cube, Crawford and the match.
import { describe, expect, test } from 'vitest';

import type { Rng } from '../../../../shared/lib/rng.ts';
import { actorOf, applyAction, canDouble, MESSAGES } from './apply.ts';
import { legalMoves, remainingDice } from './moves.ts';
import { moveLabel, parseMove, parsePosition } from './notation.ts';
import { createGame, nextGame, withPosition } from './setup.ts';
import type { Action, Board, Dice, Move, Seat, ShippedVariant, State } from './types.ts';
import { VARIANTS } from './variants.ts';

const R = VARIANTS.portes;
const PLAYERS = [
  { id: 'a', name: 'Ari' },
  { id: 'b', name: 'Jeff' },
] as const;
const NOW = 1_700_000_000_000;
const now = (): number => NOW;
/** An rng whose successive `rollDie` results are exactly `dice`; 1s once the script runs out. */
const scripted = (...dice: ReadonlyArray<number>): Rng => {
  let i = 0;
  return () => ((dice[i++] ?? 1) - 0.5) / 6;
};
/** Counts the calls so a test can pin how often the engine reads the rng. */
const counting = (inner: Rng): Rng & { calls: () => number } => {
  let n = 0;
  const rng = (): number => {
    n += 1;
    return inner();
  };
  return Object.assign(rng, { calls: () => n });
};
const pos = (text: string): Board => {
  const r = parsePosition(text, R);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const mv = (seat: Seat, text: string): Move => {
  const r = parseMove(seat, text, R);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const moveAction = (seat: Seat, text: string): Action => ({ type: 'move', ...mv(seat, text) });
const must = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const fail = (r: { ok: boolean; error?: string }): string => (r.ok ? 'ok' : (r.error ?? ''));
const START = 'L: 24:2 13:5 8:3 6:5 | D: 24:2 13:5 8:3 6:5 | bar 0/0 | off 0/0';

const game = (variant: ShippedVariant, matchLength = 5, rng: Rng = scripted(3, 1)): State =>
  createGame(PLAYERS, { matchLength, rotation: [variant] }, rng, now);
/** A game at `text`, `seat` mid-turn with `dice` (or waiting to roll when null). */
const at = (variant: ShippedVariant, text: string, seat: Seat, dice: Dice | null): State =>
  withPosition(game(variant), pos(text), seat, dice);
const apply = (
  s: State,
  seat: Seat,
  action: Action,
  rng: Rng = scripted(),
): ReturnType<typeof applyAction> => applyAction(s, seat, action, rng, now);
const play = (s: State, seat: Seat, texts: ReadonlyArray<string>): State =>
  texts.reduce((st, t) => must(apply(st, seat, moveAction(seat, t))), s);
const labels = (s: State): ReadonlyArray<string> =>
  legalMoves(s)
    .map((m) => moveLabel(s.board, s.turn, m, R))
    .sort();
const texts = (s: State): ReadonlyArray<string> => s.log.map((e) => e.text);

describe('openings (S1-S3)', () => {
  test('S1 Western: the winner plays the opening pair from `moving`', () => {
    const rng = counting(scripted(3, 1));
    const s = createGame(PLAYERS, { rotation: ['backgammon'] }, rng, now);
    expect(s).toMatchObject({
      variant: 'backgammon',
      gameNo: 1,
      phase: 'moving',
      turn: 0,
      opening: [3, 1],
      dice: [3, 1],
      played: [],
      lastPlay: [],
      cube: { value: 1, owner: null },
      match: { length: 5, score: [0, 0], crawfordDone: false, isCrawfordGame: false },
      result: null,
      games: [],
      startedAt: NOW,
      endedAt: null,
    });
    expect(s.options).toEqual({
      matchLength: 5,
      rotation: ['backgammon'],
      jacoby: false,
      beavers: false,
      automaticDoubles: false,
    });
    expect(s.turnStart).toEqual(s.board);
    expect(texts(s)).toEqual(['Ari rolled 3, Jeff rolled 1 — Ari plays 3-1']);
    expect(s.lastAction).toEqual(s.log[0]);
    expect(s.log[0]).toMatchObject({ seat: 0, kind: 'opening', at: NOW });
    expect(labels(s)).toEqual(['13/10', '24/21', '24/23', '6/3', '6/5', '8/5', '8/7']);
    expect(rng.calls()).toBe(2);
  });

  test('S2 a tie is rerolled and logged; the higher die starts', () => {
    const rng = counting(scripted(4, 4, 2, 5));
    const s = createGame(PLAYERS, { rotation: ['backgammon'] }, rng, now);
    expect(texts(s)).toEqual([
      'Both rolled 4 — again',
      'Ari rolled 2, Jeff rolled 5 — Jeff plays 5-2',
    ]);
    expect(s.log[0]).toMatchObject({ seat: null, kind: 'opening' });
    expect(s).toMatchObject({ turn: 1, dice: [5, 2], opening: [2, 5], phase: 'moving' });
    expect(rng.calls()).toBe(4);
  });

  test('S3 portes: the winner rerolls both dice from `toRoll`; doubles possible on move one', () => {
    const s = game('portes');
    expect(s).toMatchObject({ phase: 'toRoll', dice: null, turn: 0, turnStart: null });
    expect(texts(s)).toEqual(['Ari rolled 3, Jeff rolled 1 — Ari starts']);
    const rolled = must(apply(s, 0, { type: 'roll' }, scripted(6, 6)));
    expect(rolled).toMatchObject({ phase: 'moving', dice: [6, 6], played: [] });
    expect(rolled.turnStart).toEqual(s.board);
    expect(remainingDice(rolled)).toEqual([6, 6, 6, 6]);
    expect(labels(rolled)).toEqual(['13/7', '24/18', '8/2']);
    expect(rolled.lastAction?.text).toBe('Ari rolled 6-6');
    expect(rolled.lastAction?.kind).toBe('roll');
    expect(rolled.log).toHaveLength(2);
  });

  test('defaults: portes, match to 5; an empty rotation falls back too', () => {
    const s = createGame(PLAYERS, {}, scripted(3, 1), now);
    expect(s.variant).toBe('portes');
    expect(s.match.length).toBe(5);
    expect(createGame(PLAYERS, { rotation: [] }, scripted(3, 1), now).options.rotation).toEqual([
      'portes',
    ]);
  });
});

describe('a turn (S4-S7, T5/T6/T9/T13 through applyAction)', () => {
  const t1 = (): State => at('portes', START, 0, [3, 1]);

  test('refusals in toRoll and by the wrong seat', () => {
    const s = game('portes');
    expect(fail(apply(s, 1, { type: 'roll' }))).toBe(MESSAGES.NOT_YOUR_TURN);
    expect(fail(apply(s, 0, moveAction(0, '8/5')))).toBe(MESSAGES.ROLL_FIRST);
    expect(fail(apply(s, 0, { type: 'undo' }))).toBe(MESSAGES.NOTHING_TO_UNDO);
    expect(fail(apply(s, 0, { type: 'take' }))).toBe(MESSAGES.NO_DOUBLE_PENDING);
    expect(fail(apply(s, 0, { type: 'pass' }))).toBe(MESSAGES.NO_DOUBLE_PENDING);
    expect(fail(apply(s, 0, { type: 'next' }))).toBe(MESSAGES.GAME_ON);
    expect(fail(apply(s, 1, { type: 'next' }))).toBe(MESSAGES.GAME_ON);
    // `opening` is reserved; were a save to carry it, it waits for a roll like toRoll.
    expect(must(apply({ ...s, phase: 'opening' }, 0, { type: 'roll' }, scripted(3, 1))).phase).toBe(
      'moving',
    );
  });

  test('refusals while moving', () => {
    const s = t1();
    expect(fail(apply(s, 0, moveAction(0, '13/12')))).toBe(MESSAGES.ILLEGAL_MOVE);
    expect(fail(apply(s, 1, moveAction(1, '8/5')))).toBe(MESSAGES.NOT_YOUR_TURN);
    expect(fail(apply(s, 0, { type: 'roll' }))).toBe(MESSAGES.ALREADY_ROLLED);
    expect(fail(apply(s, 0, { type: 'double' }))).toBe(MESSAGES.CANT_DOUBLE_NOW);
    expect(fail(apply(s, 0, { type: 'take' }))).toBe(MESSAGES.NO_DOUBLE_PENDING);
    expect(fail(apply(s, 0, { type: 'undo' }))).toBe(MESSAGES.NOTHING_TO_UNDO);
    expect(fail(apply(s, 0, { type: 'next' }))).toBe(MESSAGES.GAME_ON);
    // T8: the low die first would leave the 6 dead.
    const t8 = at('portes', 'L: 8:1 3:1 | D: 24:2 13:13 | bar 0/0 | off 13/0', 0, [6, 1]);
    expect(fail(apply(t8, 0, moveAction(0, '8/7')))).toBe(MESSAGES.ILLEGAL_MOVE);
    expect(apply(t8, 0, moveAction(0, '8/2')).ok).toBe(true);
  });

  test('S4 undo rewinds to turnStart, keeps the dice, logs nothing', () => {
    const s = t1();
    const moved = must(apply(s, 0, moveAction(0, '8/5')));
    expect(moved.phase).toBe('moving');
    expect(moved.played).toEqual([{ ...mv(0, '8/5'), hit: false }]);
    expect(remainingDice(moved)).toEqual([1]);
    expect(moved.log).toEqual(s.log);
    const undone = must(apply(moved, 0, { type: 'undo' }));
    expect(undone.board).toEqual(s.board);
    expect(undone.played).toEqual([]);
    expect(undone.dice).toEqual([3, 1]);
    expect(remainingDice(undone)).toEqual([3, 1]);
    expect(labels(undone)).toHaveLength(7);
    expect(undone.log).toEqual(s.log);
    expect(fail(apply(undone, 0, { type: 'undo' }))).toBe(MESSAGES.NOTHING_TO_UNDO);
  });

  test('S5 the turn ends by itself after the last playable die', () => {
    const s = t1();
    const done = play(s, 0, ['8/5', '6/5']);
    expect(done).toMatchObject({
      phase: 'toRoll',
      turn: 1,
      played: [],
      turnStart: null,
      dice: [3, 1],
    });
    expect(done.lastPlay).toEqual([
      { ...mv(0, '8/5'), hit: false },
      { ...mv(0, '6/5'), hit: false },
    ]);
    expect(done.lastAction).toMatchObject({ seat: 0, kind: 'move', text: 'Ari moved 8/5 6/5' });
    expect(done.log).toHaveLength(s.log.length + 1);
    expect(fail(apply(done, 0, { type: 'undo' }))).toBe(MESSAGES.NOT_YOUR_TURN);
    expect(fail(apply(done, 1, { type: 'undo' }))).toBe(MESSAGES.NOTHING_TO_UNDO);
  });

  test('S7 a roll nobody can play passes the turn and is logged', () => {
    const t14 = at(
      'portes',
      'L: 24:2 6:3 5:3 4:3 3:2 2:2 | D: 2:2 3:2 4:2 5:2 6:2 7:2 13:3 | bar 0/0 | off 0/0',
      0,
      null,
    );
    const rolled = must(apply(t14, 0, { type: 'roll' }, scripted(6, 6)));
    expect(rolled).toMatchObject({
      turn: 1,
      phase: 'toRoll',
      dice: [6, 6],
      played: [],
      lastPlay: [],
      turnStart: null,
    });
    expect(rolled.lastAction).toMatchObject({
      seat: 0,
      kind: 'noMove',
      text: 'Ari rolled 6-6 and cannot move',
      at: NOW,
    });
    expect(rolled.log).toHaveLength(t14.log.length + 1);
  });

  test('T6 and T9: unplayable dice end the turn after the last legal move', () => {
    const t6 = at(
      'portes',
      'L: 13:5 8:3 6:5 | D: 24:2 13:5 8:3 6:5 | bar 2/0 | off 0/0',
      0,
      [6, 1],
    );
    const entered = must(apply(t6, 0, moveAction(0, 'bar/24')));
    expect(entered).toMatchObject({ phase: 'toRoll', turn: 1, played: [] });
    expect(entered.board.bar).toEqual([1, 0]);
    expect(entered.lastAction?.text).toBe('Ari moved bar/24');
    const t9 = at(
      'portes',
      'L: 24:1 10:1 9:1 8:1 | D: 5:2 23:2 24:2 13:9 | bar 0/0 | off 11/0',
      0,
      [4, 4],
    );
    const two = play(t9, 0, ['10/6', '9/5']);
    expect(two.phase).toBe('moving');
    expect(remainingDice(two)).toEqual([4, 4]);
    const three = play(two, 0, ['8/4']);
    expect(three).toMatchObject({ phase: 'toRoll', turn: 1 });
    expect(three.lastAction?.text).toBe('Ari moved 10/6 9/5 8/4');
  });

  test('T13 a hit through applyAction: bar, `hit` flag, the hit line', () => {
    const t13 = at(
      'portes',
      'L: 24:2 13:5 8:3 6:5 | D: 24:2 13:5 8:3 6:4 20:1 | bar 0/0 | off 0/0',
      0,
      [3, 1],
    );
    const hit = must(apply(t13, 0, moveAction(0, '8/5')));
    expect(hit.board.bar).toEqual([0, 1]);
    expect(hit.played).toEqual([{ ...mv(0, '8/5'), hit: true }]);
    expect(labels(hit)).toEqual(['24/23', '5/4', '6/5', '8/7']);
    const done = play(hit, 0, ['6/5']);
    expect(texts(done).slice(-2)).toEqual(['Ari moved 8/5* 6/5', 'Ari hit Jeff on the 5-point']);
    expect(done.log.at(-1)).toMatchObject({ seat: 0, kind: 'hit' });
    expect(done.lastAction?.kind).toBe('hit');
    // Jeff must enter: with a 6 blocked (Ari's 6-point) only the 1 enters, then the 6 plays.
    const jeff = must(apply(done, 1, { type: 'roll' }, scripted(6, 1)));
    expect(labels(jeff)).toEqual(['bar/24']);
  });

  test('T17 -> T18: a checker hit while bearing off must re-enter before bearing off resumes', () => {
    const t17 = at('portes', 'L: 6:2 2:1 | D: 24:1 13:14 | bar 0/0 | off 12/0', 1, [2, 1]);
    const d = play(t17, 1, ['24/23', '13/11']);
    expect(d.board.bar).toEqual([1, 0]);
    expect(d.turn).toBe(0);
    const l = must(apply(d, 0, { type: 'roll' }, scripted(6, 2)));
    expect(labels(l)).toEqual(['bar/19', 'bar/23']);
    expect(labels(l)).not.toContain('6/off');
  });
});

describe('bearing off ends the game (T25-T28, S12)', () => {
  const finish = (
    variant: ShippedVariant,
    text: string,
    dice: Dice,
    move: string,
    s0?: State,
  ): State => must(apply(s0 ?? at(variant, text, 0, dice), 0, moveAction(0, move)));

  test('T25 gammon in both variants; the result, score, record and log', () => {
    const s = finish('portes', 'L: 1:1 | D: 13:15 | bar 0/0 | off 14/0', [1, 4], '1/off(4)');
    expect(s.phase).toBe('over');
    expect(s.result).toEqual({ winner: 0, multiplier: 2, cube: 1, points: 2, reason: 'borneOff' });
    expect(s.match.score).toEqual([2, 0]);
    expect(s.games).toEqual([
      {
        gameNo: 1,
        variant: 'portes',
        winner: 0,
        multiplier: 2,
        points: 2,
        reason: 'borneOff',
        endedAt: NOW,
      },
    ]);
    expect(s.endedAt).toBe(NOW);
    expect(s.board.off).toEqual([15, 0]);
    expect(s.played).toEqual([]);
    expect(s.lastPlay).toEqual([{ ...mv(0, '1/off(4)'), hit: false }]);
    expect(texts(s).slice(-3)).toEqual([
      'Ari moved 1/off',
      'Ari bore off 1',
      'Ari wins a gammon (2 points)',
    ]);
    expect(s.lastAction).toMatchObject({ seat: 0, kind: 'result' });
    expect(actorOf(s)).toBeNull();
    expect(
      finish('backgammon', 'L: 1:1 | D: 13:15 | bar 0/0 | off 14/0', [1, 4], '1/off(4)').result
        ?.points,
    ).toBe(2);
  });

  test('T26/T27 backgammon in Western, capped at 2 in portes; T28 a single', () => {
    const w = finish(
      'backgammon',
      'L: 1:1 | D: 20:1 13:14 | bar 0/0 | off 14/0',
      [2, 1],
      '1/off(2)',
    );
    expect(w.result).toMatchObject({ multiplier: 3, points: 3 });
    expect(w.lastAction?.text).toBe('Ari wins a backgammon (3 points)');
    const p = finish('portes', 'L: 1:1 | D: 20:1 13:14 | bar 0/0 | off 14/0', [2, 1], '1/off(2)');
    expect(p.result).toMatchObject({ multiplier: 2, points: 2 });
    expect(
      finish('backgammon', 'L: 1:1 | D: 13:14 | bar 0/1 | off 14/0', [1, 1], '1/off').result
        ?.multiplier,
    ).toBe(3);
    const single = finish(
      'backgammon',
      'L: 1:1 | D: 13:14 | bar 0/0 | off 14/1',
      [3, 1],
      '1/off(3)',
    );
    expect(single.result).toMatchObject({ multiplier: 1, points: 1 });
    expect(single.lastAction?.text).toBe('Ari wins 1 point');
  });

  test('S12 with the cube at 2 the points double and the match can end', () => {
    const s0 = {
      ...at('backgammon', 'L: 1:1 | D: 20:1 13:14 | bar 0/0 | off 14/0', 0, [2, 1]),
      cube: { value: 2 as const, owner: 0 as const },
    };
    const s = finish('backgammon', '', [2, 1], '1/off(2)', s0);
    expect(s.result).toEqual({ winner: 0, multiplier: 3, cube: 2, points: 6, reason: 'borneOff' });
    expect(s.match.score).toEqual([6, 0]);
    expect(s.lastAction?.text).toBe('Ari wins a backgammon (6 points) and takes the match 6–0');
    expect(fail(apply(s, 0, { type: 'next' }))).toBe(MESSAGES.MATCH_OVER);
    expect(fail(apply(s, 1, { type: 'roll' }))).toBe(MESSAGES.GAME_OVER);
    const cube2 = finish('backgammon', '', [3, 1], '1/off(3)', {
      ...at('backgammon', 'L: 1:1 | D: 13:14 | bar 0/0 | off 14/1', 0, [3, 1]),
      cube: { value: 2 as const, owner: 1 as const },
    });
    expect(cube2.lastAction?.text).toBe('Ari wins 2 points');
  });

  test('P31 a game ends inside a doubles turn; T12 the second move ends it', () => {
    const p31 = at('portes', 'L: 3:4 | D: 13:5 8:3 6:5 1:2 | bar 0/0 | off 11/0', 0, [6, 6]);
    const s = play(p31, 0, ['3/off(6)', '3/off(6)', '3/off(6)', '3/off(6)']);
    expect(s.phase).toBe('over');
    expect(s.board.off[0]).toBe(15);
    expect(texts(s).slice(-3)).toEqual([
      'Ari moved 3/off(4)',
      'Ari bore off 4',
      'Ari wins a gammon (2 points)',
    ]);
    const t12 = at('portes', 'L: 4:1 2:1 | D: 13:15 | bar 0/0 | off 13/0', 0, [6, 5]);
    expect(play(t12, 0, ['4/off(6)', '2/off(5)']).phase).toBe('over');
  });
});

describe('the cube and the Crawford game (S8-S10)', () => {
  const western = (): State => game('backgammon');
  /** Western, dark to roll (the opening was played): the plain toRoll position. */
  const toRoll = (): State => at('backgammon', START, 1, null);

  test('S8 double, take: the taker owns the cube and the doubler rolls', () => {
    const s = toRoll();
    expect(canDouble(s, 1)).toBe(true);
    expect(canDouble(s, 0)).toBe(false);
    const offered = must(apply(s, 1, { type: 'double' }));
    expect(offered.phase).toBe('cubeOffered');
    expect(actorOf(offered)).toBe(0);
    expect(offered.lastAction).toMatchObject({
      seat: 1,
      kind: 'double',
      text: 'Jeff doubles to 2',
    });
    expect(fail(apply(offered, 1, { type: 'take' }))).toBe(MESSAGES.NOT_YOUR_TURN);
    expect(fail(apply(offered, 0, { type: 'roll' }))).toBe(MESSAGES.ANSWER_DOUBLE);
    expect(fail(apply(offered, 0, moveAction(0, '8/5')))).toBe(MESSAGES.ANSWER_DOUBLE);
    expect(fail(apply(offered, 0, { type: 'undo' }))).toBe(MESSAGES.ANSWER_DOUBLE);
    expect(fail(apply(offered, 0, { type: 'double' }))).toBe(MESSAGES.ANSWER_DOUBLE);
    expect(fail(apply(offered, 0, { type: 'next' }))).toBe(MESSAGES.GAME_ON);
    const taken = must(apply(offered, 0, { type: 'take' }));
    expect(taken).toMatchObject({ phase: 'toRoll', turn: 1, cube: { value: 2, owner: 0 } });
    expect(taken.lastAction).toMatchObject({ seat: 0, kind: 'take', text: 'Ari takes at 2' });
    expect(canDouble(taken, 1)).toBe(false);
    expect(fail(apply(taken, 1, { type: 'double' }))).toBe(MESSAGES.NOT_CUBE_OWNER);
    expect(canDouble(taken, 0)).toBe(false);
    // Once it is Ari's turn, the owner may redouble to 4.
    const ariToRoll = { ...taken, turn: 0 as const };
    expect(canDouble(ariToRoll, 0)).toBe(true);
    expect(must(apply(ariToRoll, 0, { type: 'double' })).lastAction?.text).toBe('Ari doubles to 4');
  });

  test('S9 double, pass: the doubler wins the pre-double value at once', () => {
    const offered = must(apply(toRoll(), 1, { type: 'double' }));
    const s = must(apply(offered, 0, { type: 'pass' }));
    expect(s.phase).toBe('over');
    expect(s.result).toEqual({ winner: 1, multiplier: 1, cube: 1, points: 1, reason: 'passed' });
    expect(s.match.score).toEqual([0, 1]);
    expect(s.cube).toEqual({ value: 1, owner: null });
    expect(texts(s).slice(-3)).toEqual(['Jeff doubles to 2', 'Ari passes', 'Jeff wins 1 point']);
    expect(s.log.at(-2)).toMatchObject({ seat: 0, kind: 'pass' });
    expect(s.lastPlay).toEqual([]);
    expect(s.games).toHaveLength(1);
  });

  test('S10 refusals: no cube in portes, the Crawford game, the cap at 64', () => {
    expect(fail(apply(game('portes'), 0, { type: 'double' }))).toBe(
      'There is no doubling cube in Portes.',
    );
    const s = western();
    const before = { ...s, match: { ...s.match, score: [4, 2] as const } };
    const crawford = nextGame({ ...before, phase: 'over' }, scripted(3, 1), now);
    expect(crawford.match).toEqual({
      length: 5,
      score: [4, 2],
      crawfordDone: true,
      isCrawfordGame: true,
    });
    expect(crawford.gameNo).toBe(2);
    expect(texts(crawford)[0]).toBe('Game 2 begins — the Crawford game');
    const cr = withPosition(crawford, pos(START), 1, null);
    expect(canDouble(cr, 1)).toBe(false);
    expect(fail(apply(cr, 1, { type: 'double' }))).toBe(MESSAGES.CRAWFORD);
    const after = nextGame({ ...crawford, phase: 'over' }, scripted(3, 1), now);
    expect(after.match).toMatchObject({ crawfordDone: true, isCrawfordGame: false });
    expect(texts(after)[0]).toBe('Game 3 begins');
    expect(apply(withPosition(after, pos(START), 1, null), 1, { type: 'double' }).ok).toBe(true);
    const maxed = { ...toRoll(), cube: { value: 64 as const, owner: 1 as const } };
    expect(fail(apply(maxed, 1, { type: 'double' }))).toBe(MESSAGES.CUBE_MAX_MSG);
    expect(canDouble(maxed, 1)).toBe(false);
  });
});

describe('the match (S11, S13, S15)', () => {
  test('S11 points accumulate; the game after a score of length - 1 is Crawford; a 1-point match starts Crawford', () => {
    const s0 = at('backgammon', 'L: 1:1 | D: 13:15 | bar 0/0 | off 14/0', 0, [1, 4]);
    const s = must(
      apply({ ...s0, match: { ...s0.match, score: [2, 2] } }, 0, moveAction(0, '1/off(4)')),
    );
    expect(s.match.score).toEqual([4, 2]);
    expect(s.result?.points).toBe(2);
    const rng = counting(scripted(4, 4, 6, 2));
    const next = must(applyAction(s, 1, { type: 'next' }, rng, now));
    // The tie is rerolled: Ari 6, Jeff 2, so Ari starts with 6-2.
    expect(next).toMatchObject({ gameNo: 2, phase: 'moving', turn: 0, dice: [6, 2] });
    expect(next.match).toEqual({
      length: 5,
      score: [4, 2],
      crawfordDone: true,
      isCrawfordGame: true,
    });
    expect(next.games).toEqual(s.games);
    expect(next.result).toBeNull();
    expect(rng.calls()).toBe(4);
    expect(game('backgammon', 1).match.isCrawfordGame).toBe(true);
    expect(game('portes', 1).match.isCrawfordGame).toBe(false);
  });

  test('S13 the match ends: no next game, no other action either', () => {
    const s0 = at('portes', 'L: 1:1 | D: 13:15 | bar 0/0 | off 14/0', 0, [1, 4]);
    const s = must(
      apply({ ...s0, match: { ...s0.match, length: 1 } }, 0, moveAction(0, '1/off(4)')),
    );
    expect(s.lastAction?.text).toBe('Ari wins a gammon (2 points) and takes the match 2–0');
    expect(fail(apply(s, 0, { type: 'next' }))).toBe(MESSAGES.MATCH_OVER);
    expect(fail(apply(s, 1, { type: 'next' }))).toBe(MESSAGES.MATCH_OVER);
    expect(fail(apply(s, 0, { type: 'roll' }))).toBe(MESSAGES.GAME_OVER);
    expect(fail(apply(s, 1, moveAction(1, '8/5')))).toBe(MESSAGES.GAME_OVER);
  });

  test('S15 a rotation alternates variants game by game', () => {
    const g1 = createGame(
      PLAYERS,
      { matchLength: 3, rotation: ['portes', 'backgammon'] },
      scripted(3, 1),
      now,
    );
    expect(g1.variant).toBe('portes');
    const g2 = nextGame({ ...g1, phase: 'over' }, scripted(3, 1), now);
    expect(g2.variant).toBe('backgammon');
    expect(g2.phase).toBe('moving');
    const g3 = nextGame({ ...g2, phase: 'over' }, scripted(3, 1), now);
    expect(g3.variant).toBe('portes');
    expect(g3.gameNo).toBe(3);
  });

  test('rng accounting: roll reads two, moves and cube actions none', () => {
    const rng = counting(scripted(3, 1, 6, 5));
    const s = game('portes');
    const rolled = must(applyAction(s, 0, { type: 'roll' }, rng, now));
    expect(rng.calls()).toBe(2);
    const moved = must(applyAction(rolled, 0, moveAction(0, '8/5'), rng, now));
    must(applyAction(moved, 0, { type: 'undo' }, rng, now));
    expect(rng.calls()).toBe(2);
    const w = toRollWestern();
    must(
      applyAction(
        must(applyAction(w, 1, { type: 'double' }, rng, now)),
        0,
        { type: 'take' },
        rng,
        now,
      ),
    );
    expect(rng.calls()).toBe(2);
  });
  const toRollWestern = (): State => at('backgammon', START, 1, null);
});
