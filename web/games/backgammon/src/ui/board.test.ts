// The table's builders as strings and tables (design §7 "pinned strings from statusText",
// §4.1's helpers over the engine's test positions): the keyed markup, the ids of the viewer's
// frame, which dice are dead, what a selected source reaches and with which dice, the chip tray,
// the status and result copy, the aria labels and the flights between two paints.
import { describe, expect, test } from 'vitest';

import {
  applyAction,
  createGame,
  parseMove,
  parsePosition,
  VARIANTS,
  viewFor,
  withPosition,
  type Action,
  type Board,
  type Dice,
  type Move,
  type PlayedMove,
  type Seat,
  type ShippedVariant,
  type State,
  type View,
} from '../engine/index.ts';
import {
  absOfId,
  barHtml,
  barIdFor,
  barsOf,
  chainsFrom,
  checkerHtml,
  checkersHtml,
  chipLabel,
  hitsAgainst,
  chipsFor,
  chipsHtml,
  chipsKey,
  cubeOwner,
  cubeText,
  deadDice,
  diceFor,
  diceHtml,
  diceWords,
  effectiveSelection,
  MAX_FLIGHTS,
  flightsBetween,
  offHtml,
  offIdFor,
  ownPoint,
  pipHtml,
  placeAria,
  placeIdOf,
  pointHtml,
  pointId,
  resultText,
  sideOf,
  slabsHtml,
  sourcesOf,
  stackKey,
  PLAIN_STATUS,
  statusText,
  targetsOf,
  type Chain,
} from './board.ts';

const R = VARIANTS.portes;
const NOW = 1_700_000_000_000;
const now = (): number => NOW;
/** Dice come from a scripted queue: `(d - 0.5) / 6` makes `rollDie` yield exactly `d`. */
const scripted = (...dice: ReadonlyArray<number>): (() => number) => {
  const queue = [...dice];
  return () => ((queue.shift() ?? 1) - 0.5) / 6;
};
const PLAYERS = [
  { id: 'a', name: 'Ari' },
  { id: 'b', name: 'Jeff' },
] as const;

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
/** A game in `variant` (portes: Light starts, waiting to roll) with the given position set. */
const stateAt = (
  text: string,
  turn: Seat,
  dice: Dice | null,
  variant: ShippedVariant = 'portes',
): State =>
  withPosition(
    createGame(PLAYERS, { matchLength: 5, rotation: [variant] }, scripted(3, 1), now),
    pos(text),
    turn,
    dice,
  );
const viewAt = (text: string, turn: Seat, dice: Dice | null, viewer: Seat = turn): View =>
  viewFor(stateAt(text, turn, dice), viewer);
const step = (state: State, seat: Seat, action: Action): State => {
  const r = applyAction(state, seat, action, scripted(6, 6), now);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const move = (state: State, text: string): State =>
  step(state, state.turn, { type: 'move', ...mv(state.turn, text) });

const START = 'L: 24:2 13:5 8:3 6:5 | D: 24:2 13:5 8:3 6:5 | bar 0/0 | off 0/0';
/** T13: a Dark blot on Light's 5-point. */
const BLOT_ON_5 = 'L: 24:2 13:5 8:3 6:5 | D: 24:2 13:5 8:3 6:4 20:1 | bar 0/0 | off 0/0';
/** Design §4.3: a Dark blot on Light's 7-point, so 13 reaches 4 two ways with 6-3. */
const BLOT_ON_7 = 'L: 24:2 13:5 8:3 6:5 | D: 24:2 13:5 8:3 6:4 18:1 | bar 0/0 | off 0/0';
const T5 = 'L: 24:1 13:5 8:3 6:5 | D: 24:2 13:5 8:3 6:5 | bar 1/0 | off 0/0';
const T9 = 'L: 24:1 10:1 9:1 8:1 | D: 5:2 23:2 24:2 13:9 | bar 0/0 | off 11/0';
const T10 = 'L: 6:2 5:2 4:2 3:2 2:2 1:2 | D: 13:15 | bar 0/0 | off 3/0';
const T12 = 'L: 4:1 2:1 | D: 13:15 | bar 0/0 | off 13/0';
const T15 = 'L: 24:2 6:3 5:3 4:3 3:2 2:2 | D: 2:2 3:2 4:2 5:2 6:2 7:2 13:3 | bar 0/0 | off 0/0';
const T25 = 'L: 1:1 | D: 13:15 | bar 0/0 | off 14/0';

describe('keyed markup', () => {
  test('checkers: --i per index, the top visible one marked, the badge past five', () => {
    expect(checkerHtml(0, 0, 1)).toBe('<div class="checker ck-light top" style="--i:0"></div>');
    expect(checkerHtml(1, 2, 3)).toBe('<div class="checker ck-dark top" style="--i:2"></div>');
    expect(checkerHtml(1, 1, 3)).toBe('<div class="checker ck-dark" style="--i:1"></div>');
    // Seven checkers: all seven are emitted (CSS hides the sixth onward), the fifth is the top.
    const seven = checkersHtml(1, 7);
    expect(seven.match(/<div/g)).toHaveLength(7);
    expect(seven).toContain('<div class="checker ck-dark top" style="--i:4" data-count="7"></div>');
    expect(seven).not.toContain('style="--i:5" data-count');
    expect(checkersHtml(null, 0)).toBe('');
  });

  test('points, bars, trays and their keys', () => {
    expect(pointHtml([0, 0])).toBe(checkersHtml(0, 2));
    expect(pointHtml([])).toBe('');
    expect(barHtml(1, 1)).toBe('<div class="checker ck-dark top" style="--i:0"></div>');
    expect(barHtml(1, 0)).toBe('');
    expect(slabsHtml(3)).toBe(
      '<div class="slab"></div><div class="slab"></div><div class="slab"></div>',
    );
    expect(offHtml(0)).toBe('');
    expect([stackKey([0, 0, 0, 0, 0]), stackKey([1, 1]), stackKey([])]).toEqual(['L5', 'D2', '-0']);
    expect(pipHtml(167)).toBe('167<span class="sr-only"> pips</span>');
  });
});

describe("the viewer's frame", () => {
  test('ids: points are 1-based absolute, the bars relative to me, the trays fixed by colour', () => {
    const light = viewAt(START, 0, null);
    const dark = viewAt(START, 0, null, 1);
    expect(pointId(0)).toBe('point-1');
    expect(pointId(23)).toBe('point-24');
    expect([barIdFor(light, 0), barIdFor(light, 1)]).toEqual(['barBottom', 'barTop']);
    expect([barIdFor(dark, 0), barIdFor(dark, 1)]).toEqual(['barTop', 'barBottom']);
    expect([offIdFor(0), offIdFor(1)]).toEqual(['offLight', 'offDark']);
    expect(placeIdOf(dark, 1, 'bar')).toBe('barBottom');
    expect(placeIdOf(dark, 1, 'off')).toBe('offDark');
    expect(placeIdOf(light, 0, 4)).toBe('point-5');
    expect([absOfId('point-1'), absOfId('point-24'), absOfId('barTop')]).toEqual([0, 23, null]);
  });

  test('own numbering, sides and the bar halves', () => {
    const light = viewAt(START, 0, null);
    const dark = viewAt(START, 0, null, 1);
    expect([
      ownPoint(light, 0),
      ownPoint(light, 23),
      ownPoint(dark, 0),
      ownPoint(dark, 23),
    ]).toEqual([1, 24, 24, 1]);
    expect([sideOf(1), sideOf(12), sideOf(13), sideOf(24)]).toEqual(['near', 'near', 'far', 'far']);
    const hit = viewAt(T5, 0, [6, 1], 1);
    expect(barsOf(hit)).toEqual({ top: { seat: 0, count: 1 }, bottom: { seat: 1, count: 0 } });
    expect(barsOf(viewAt(T5, 0, [6, 1]))).toEqual({
      top: { seat: 1, count: 0 },
      bottom: { seat: 0, count: 1 },
    });
  });
});

describe('dice', () => {
  test("dead dice: the die no play uses; a double's unplayable tail; nothing for the non-actor", () => {
    expect(deadDice(viewAt(T15, 0, [6, 5]))).toEqual([6]);
    expect(deadDice(viewAt(T9, 0, [4, 4]))).toEqual([4]);
    expect(deadDice(viewAt(START, 0, [3, 1]))).toEqual([]);
    // T6: two on the bar, only the 1 enters: the 6 is dead from the start.
    expect(
      deadDice(viewAt('L: 13:5 8:3 6:5 | D: 24:2 13:5 8:3 6:5 | bar 2/0 | off 0/0', 0, [6, 1])),
    ).toEqual([6]);
    expect(deadDice(viewAt(T15, 0, [6, 5], 1))).toEqual([]);
  });

  test('diceFor: blank before a roll, faces while moving, theirs from the other seat, picked', () => {
    expect(diceFor(viewAt(START, 0, null))).toEqual({ faces: [], theirs: false, key: 'blank' });
    const mine = diceFor(viewAt(T15, 0, [6, 5]));
    expect(mine.faces).toEqual([
      { die: 6, state: 'dead', picked: false },
      { die: 5, state: 'live', picked: false },
    ]);
    expect(mine.theirs).toBe(false);
    expect(mine.key).toBe('6-5:dl:-:0');
    const theirs = diceFor(viewAt(START, 0, [3, 1], 1));
    expect(theirs.theirs).toBe(true);
    expect(theirs.faces.map((f) => f.state)).toEqual(['live', 'live']);
    const picked = diceFor(viewAt(START, 0, [3, 1]), 1);
    expect(picked.faces.map((f) => f.picked)).toEqual([false, true]);
    expect(picked.key).toBe('3-1:ll:1:0');
  });

  test('a double after one move: used first, then live, the unplayable tail dead', () => {
    const after = viewFor(move(stateAt(T9, 0, [4, 4]), '8/4'), 0);
    expect(diceFor(after).faces.map((f) => f.state)).toEqual(['used', 'live', 'live', 'dead']);
    expect(diceFor(after).key).toBe('4-4:ulld:-:0');
  });

  test('the final roll stays live when the game is over; a forfeited roll is all dead while held', () => {
    const over = viewFor(move(stateAt(T25, 0, [1, 4]), '1/off(4)'), 0);
    expect(over.phase).toBe('over');
    expect(diceFor(over).faces.map((f) => f.state)).toEqual(['live', 'live']);
    // T14: a blocked six-prime; the roll is forfeited inside `roll`.
    const blocked = stateAt(T15, 0, null);
    const passed = viewFor(step(blocked, 0, { type: 'roll' }), 0);
    expect(passed.lastAction?.kind).toBe('noMove');
    expect(diceFor(passed)).toEqual({ faces: [], theirs: false, key: 'blank' });
    // The scripted roll is 6-6: a double, four faces, none playable.
    const held = diceFor(passed, null, true);
    expect(held.faces.map((f) => f.state)).toEqual(['dead', 'dead', 'dead', 'dead']);
    expect(held.theirs).toBe(false);
    expect(diceFor(viewFor(step(blocked, 0, { type: 'roll' }), 1), null, true).theirs).toBe(true);
  });

  test('diceHtml and the words for the status line', () => {
    expect(diceHtml(diceFor(viewAt(START, 0, null)))).toBe(
      '<span class="die blank" aria-hidden="true"></span><span class="die blank" aria-hidden="true"></span>',
    );
    expect(diceHtml(diceFor(viewAt(T15, 0, [6, 5]), 5))).toBe(
      '<span class="die die-6 dead" data-die="6" aria-label="die 6, cannot be played" aria-disabled="true"></span>' +
        '<span class="die die-5 picked" data-die="5" aria-label="die 5"></span>',
    );
    expect(diceHtml(diceFor(viewAt(START, 0, [3, 1], 1)))).toContain('class="die die-3 theirs"');
    const after = viewFor(move(stateAt(START, 0, [3, 1]), '8/5'), 0);
    expect(diceHtml(diceFor(after))).toContain(
      '<span class="die die-3 used" data-die="3" aria-label="die 3, played" aria-disabled="true"></span>',
    );
    expect([diceWords([6, 4]), diceWords([1, 1]), diceWords(null)]).toEqual([
      'six and four',
      'one and one',
      '',
    ]);
  });

  test('the cube', () => {
    expect(cubeText({ value: 4, owner: 1 })).toBe('4');
    expect([
      cubeOwner({ value: 1, owner: null }, 0),
      cubeOwner({ value: 2, owner: 0 }, 0),
      cubeOwner({ value: 2, owner: 0 }, 1),
    ]).toEqual(['none', 'near', 'far']);
  });
});

describe('selection', () => {
  test('sources are the distinct froms of the legal moves, the bar first; a stale tap is dropped', () => {
    const t1 = viewAt(START, 0, [3, 1]);
    expect(sourcesOf(t1)).toEqual([5, 7, 12, 23]);
    expect(effectiveSelection(null, t1)).toBeNull();
    expect(effectiveSelection(7, t1)).toBe(7);
    expect(effectiveSelection(3, t1)).toBeNull();
    const bar = viewAt(T5, 0, [6, 1]);
    expect(sourcesOf(bar)).toEqual(['bar']);
    expect(effectiveSelection(null, bar)).toBe('bar');
    expect(effectiveSelection(7, bar)).toBe('bar');
    expect(sourcesOf(viewAt(START, 0, [3, 1], 1))).toEqual([]);
  });

  test('chainsFrom: the single steps and the two-die continuations of one checker (T1, own 8)', () => {
    const t1 = viewAt(START, 0, [3, 1]);
    const chains = chainsFrom(t1, 7, null);
    const shape = (c: Chain): string =>
      `${c.moves.map((m) => `${String(m.from)}>${String(m.to)}/${String(m.die)}`).join(' ')} to=${String(c.to)} via=${c.via.join(',')} hits=${c.hits.join(',')}`;
    expect(chains.map(shape)).toEqual([
      '7>4/3 to=4 via= hits=',
      '7>4/3 4>3/1 to=3 via=4 hits=',
      '7>6/1 to=6 via= hits=',
      '7>6/1 6>3/3 to=3 via=6 hits=',
    ]);
    // A picked die keeps its single step only.
    expect(chainsFrom(t1, 7, 1).map(shape)).toEqual(['7>6/1 to=6 via= hits=']);
    expect(chainsFrom(viewAt(START, 0, [3, 1], 1), 7, null)).toEqual([]);
    expect(chainsFrom(viewAt(START, 0, null), 7, null)).toEqual([]);
  });

  test('targetsOf: one-step targets name their die, a two-order point is target-2 (design §4.2)', () => {
    const t = targetsOf(viewAt(START, 0, [3, 1]), 7, null);
    expect(t.map(({ to, kind, die, opens }) => ({ to, kind, die, opens }))).toEqual([
      { to: 3, kind: 'target-2', die: '3+1', opens: false },
      { to: 4, kind: 'target', die: '3', opens: false },
      { to: 6, kind: 'target', die: '1', opens: false },
    ]);
    // The chains of the combined target are in chip order: the higher first die first.
    expect(t[0]?.chains.map((c) => c.moves.map((m) => m.die))).toEqual([
      [3, 1],
      [1, 3],
    ]);
    expect(targetsOf(viewAt(START, 0, [3, 1]), null, null)).toEqual([]);
    expect(targetsOf(viewAt(START, 0, [3, 1]), 7, 1).map((x) => x.die)).toEqual(['1']);
    // Doubles: three or four of a kind as `3×3`, `3×4`, so the pill fits a desktop point.
    expect(targetsOf(viewAt(START, 0, [3, 3]), 12, null).map((x) => [x.to, x.die])).toEqual([
      [3, '3×3'],
      [6, '3+3'],
      [9, '3'],
    ]);
    const open = 'L: 24:2 13:5 8:3 6:5 | D: 1:2 13:5 8:3 6:5 | bar 0/0 | off 0/0';
    expect(targetsOf(viewAt(open, 0, [3, 3]), 12, null).map((x) => x.die)).toEqual([
      '3×4',
      '3×3',
      '3+3',
      '3',
    ]);
  });

  test('a hit on one path opens the tray (T13 and design §4.3); either die bearing off reads 6·5 (T12)', () => {
    const t13 = targetsOf(viewAt(BLOT_ON_5, 0, [3, 1]), 7, null);
    expect(t13.map((x) => [x.to, x.die, x.opens])).toEqual([
      [3, '3+1?', true],
      [4, '3', false],
      [6, '1', false],
    ]);
    expect(t13[0]?.chains.map((c) => c.hits)).toEqual([[4], []]);
    const mock = targetsOf(viewAt(BLOT_ON_7, 0, [6, 3]), 12, null);
    expect(mock.map((x) => [x.to, x.kind, x.die])).toEqual([
      [3, 'target-2', '6+3?'],
      [6, 'target', '6'],
      [9, 'target', '3'],
    ]);
    const off = targetsOf(viewAt(T12, 0, [6, 5]), 3, null);
    expect(off.map((x) => [x.to, x.kind, x.die, x.opens])).toEqual([
      ['off', 'target', '6·5', true],
    ]);
    expect(off[0]?.chains.map((c) => c.moves[0]?.die)).toEqual([6, 5]);
  });

  test("chips: own numbering, the mockup's labels, the tray markup and its key", () => {
    const v = viewAt(BLOT_ON_7, 0, [6, 3]);
    const target = targetsOf(v, 12, null).find((x) => x.to === 3);
    const chips = chipsFor(v, target?.chains ?? []);
    expect(chips).toEqual([
      { dice: [6, 3], to: 4, via: [7], hits: [7] },
      { dice: [3, 6], to: 4, via: [10], hits: [] },
    ]);
    // Digits, not die glyphs (⚅ drew as a box at chip size); the landing on its own line.
    expect(chips.map(chipLabel)).toEqual(['6·3 → 4 via 7, hits', '3·6 → 4 via 10']);
    expect(chipsHtml(chips)).toBe(
      '<button type="button" class="chip hits" data-index="0" data-dice="6+3" data-to="4" data-via="7" data-hit="7" aria-label="6·3 → 4 via 7, hits"><span class="faces">6·3</span><span class="via">→ 4 via 7, hits</span></button>' +
        '<button type="button" class="chip" data-index="1" data-dice="3+6" data-to="4" data-via="10" data-hit="" aria-label="3·6 → 4 via 10"><span class="faces">3·6</span><span class="via">→ 4 via 10</span></button>',
    );
    expect(chipsKey(chips)).toBe('6+3>4/7/7|3+6>4/10/');
    const off = viewAt(T12, 0, [6, 5]);
    const offChips = chipsFor(off, targetsOf(off, 3, null)[0]?.chains ?? []);
    expect(offChips.map(chipLabel)).toEqual(['6 → off', '5 → off']);
  });
});

describe('statusText', () => {
  const western = (turn: Seat, dice: Dice | null, viewer: Seat = turn): View =>
    viewFor(stateAt(START, turn, dice, 'backgammon'), viewer);

  test('my turn: before the roll, both dice, the bar, a dead die, a double, bear-off, the last move', () => {
    expect(statusText(viewAt(START, 0, null))).toBe('Your turn. Buen mazal!');
    expect(statusText(western(0, null))).toBe('Your turn. Double or roll');
    expect(statusText(viewAt(START, 0, [3, 1]))).toBe('3-1 · play both dice');
    // A forced die is confirmed on the line (the tray, when open, comes first).
    expect(statusText(viewAt(START, 0, [6, 4]), { ...PLAIN_STATUS, picked: 6 })).toBe(
      '6-4 · playing the 6',
    );
    expect(statusText(viewAt(T5, 0, [6, 1]), { ...PLAIN_STATUS, picked: 1 })).toBe(
      '6-1 · playing the 1',
    );
    expect(statusText(viewAt(START, 0, [6, 6]))).toBe('6-6 · play all four');
    expect(statusText(viewAt(T5, 0, [6, 1]))).toBe('6-1 · enter from the bar');
    expect(statusText(viewAt(T15, 0, [6, 5]))).toBe('6-5 · the 6 cannot be played');
    expect(statusText(viewAt(T9, 0, [4, 4]))).toBe('4-4 · only three of the four can be played');
    expect(statusText(viewFor(move(stateAt(T9, 0, [4, 4]), '8/4'), 0))).toBe('4-4 · 2 moves left');
    expect(statusText(viewAt(T10, 0, [6, 5]))).toBe('6-5 · bear off');
    // T24 after 6/4: one die left, one play; the engine will end the turn on the next move.
    const last: State = {
      ...stateAt('L: 4:1 3:1 | D: 24:2 13:13 | bar 0/0 | off 13/0', 0, [5, 2]),
      played: [{ from: 5, to: 3, die: 2, hit: false }],
    };
    expect(viewFor(last, 0).movesLeft).toEqual([5]);
    expect(statusText(viewFor(last, 0))).toBe('Last move: the turn ends when you play it');
    expect(statusText(viewFor(move(stateAt(START, 0, [3, 1]), '8/5'), 0))).toBe(
      'Last move: the turn ends when you play it',
    );
  });

  test('the tray open', () => {
    const v = viewAt(BLOT_ON_7, 0, [6, 3]);
    const target = targetsOf(v, 12, null).find((x) => x.to === 3);
    expect(
      statusText(v, {
        pending: { from: 12, to: 3, chains: target?.chains ?? [] },
        noMoveShown: false,
      }),
    ).toBe('13 · 6+3 reaches 4 two ways');
    const off = viewAt(T12, 0, [6, 5]);
    expect(
      statusText(off, {
        pending: { from: 3, to: 'off', chains: targetsOf(off, 3, null)[0]?.chains ?? [] },
        noMoveShown: false,
      }),
    ).toBe('4 · either die bears off');
  });

  test("the opponent's turn, the cube, the forfeited roll and the end", () => {
    expect(statusText(viewAt(START, 0, null, 1))).toBe('Ari is rolling…');
    expect(statusText(western(0, null, 1))).toBe('Ari may double');
    expect(statusText(viewAt(START, 0, [3, 1], 1))).toBe('Ari to move · 3-1');
    const offered = step(stateAt(START, 0, null, 'backgammon'), 0, { type: 'double' });
    expect(statusText(viewFor(offered, 1))).toBe('Ari doubles to 2. Take or pass?');
    expect(statusText(viewFor(offered, 0))).toBe('Jeff is answering the double');
    const passed = step(stateAt(T15, 0, null), 0, { type: 'roll' });
    expect(statusText(viewFor(passed, 0))).toBe('Jeff is rolling…');
    expect(statusText(viewFor(passed, 0), { pending: null, noMoveShown: true })).toBe(
      '6-6 · no move — turn passes',
    );
    const noEntry = step(
      stateAt('L: 13:14 | D: 1:2 2:2 3:2 4:2 5:2 6:2 13:3 | bar 1/0 | off 0/0', 0, null),
      0,
      { type: 'roll' },
    );
    expect(statusText(viewFor(noEntry, 1), { pending: null, noMoveShown: true })).toBe(
      '6-6 · no entry — turn passes',
    );
    expect(statusText(viewFor(move(stateAt(T25, 0, [1, 4]), '1/off(4)'), 1))).toBe(
      'Ari wins 2 points · gammon',
    );
  });
});

describe('hitsAgainst', () => {
  test('the points a seat was hit on in the turn just finished, in their own numbering', () => {
    // Ari's 8/5* 6/5 against the blot on his 5-point: Jeff's own 20.
    const turn = move(move(stateAt(BLOT_ON_5, 0, [3, 1]), '8/5'), '6/5');
    expect(turn).toMatchObject({ turn: 1, phase: 'toRoll' });
    expect(hitsAgainst(viewFor(turn, 1), 1)).toEqual([20]);
    // The hitter has nothing against him; nobody before a turn is played.
    expect(hitsAgainst(viewFor(turn, 0), 0)).toEqual([]);
    expect(hitsAgainst(viewAt(START, 0, null), 1)).toEqual([]);
    // A forfeited roll after the hit: the last turn line is a noMove, so nothing is stale.
    const forfeited: View = {
      ...viewFor(turn, 0),
      lastPlay: [],
      log: [
        ...turn.log,
        { seat: 1, kind: 'noMove', text: 'Jeff rolled 6-6 and cannot move', at: NOW },
      ],
    };
    expect(hitsAgainst(forfeited, 0)).toEqual([]);
  });
});

describe('resultText and placeAria', () => {
  test('a gammon, a single with the cube, a pass', () => {
    const gammon = viewFor(move(stateAt(T25, 0, [1, 4]), '1/off(4)'), 0);
    expect(resultText(gammon)).toEqual({
      title: 'Ari wins 2 points · gammon',
      sub: 'Jeff had 15 checkers left · 195 pips',
      score: 'Ari 2 – 0 Jeff · match to 5',
    });
    const cubed: State = { ...stateAt(T25, 0, [1, 4], 'backgammon'), cube: { value: 2, owner: 0 } };
    expect(resultText(viewFor(move(cubed, '1/off(4)'), 1)).title).toBe(
      'Ari wins 4 points · gammon, cube 2',
    );
    const single = 'L: 1:1 | D: 13:14 | bar 0/0 | off 14/1';
    expect(resultText(viewFor(move(stateAt(single, 0, [3, 1]), '1/off(3)'), 0))).toMatchObject({
      title: 'Ari wins 1 point',
      sub: 'Jeff had 14 checkers left · 182 pips',
    });
    const singleCubed: State = {
      ...stateAt(single, 0, [3, 1], 'backgammon'),
      cube: { value: 2, owner: 1 },
    };
    expect(resultText(viewFor(move(singleCubed, '1/off(3)'), 0)).title).toBe(
      'Ari wins 2 points · cube 2',
    );
    const offered = step(stateAt(START, 0, null, 'backgammon'), 0, { type: 'double' });
    const passed = viewFor(step(offered, 1, { type: 'pass' }), 0);
    expect(resultText(passed)).toEqual({
      title: 'Jeff passed · Ari wins 1 point',
      sub: 'Jeff passed the double',
      score: 'Ari 1 – 0 Jeff · match to 5',
    });
    expect(resultText(viewAt(START, 0, null))).toEqual({
      title: '',
      sub: '',
      score: 'Ari 0 – 0 Jeff · match to 5',
    });
  });

  test('aria labels name the place in my numbering, its owner and count, and one highlight', () => {
    const v = viewAt(T5, 0, [6, 1]);
    expect(placeAria(v, 'point-8', { canMove: true, selected: false, die: null })).toBe(
      'Your 8-point, 3 checkers, can move',
    );
    expect(placeAria(v, 'point-12')).toBe("Jeff's 12-point, 5 checkers");
    expect(placeAria(v, 'point-5', { canMove: false, selected: false, die: '3' })).toBe(
      'Point 5, empty, target with the 3',
    );
    // A doubles pill is spoken in words, the tray's "?" left out.
    expect(placeAria(v, 'point-5', { canMove: false, selected: false, die: '3×3?' })).toBe(
      'Point 5, empty, target with the three 3s',
    );
    expect(placeAria(v, 'barBottom', { canMove: true, selected: true, die: null })).toBe(
      'Your bar, 1 checker, selected',
    );
    expect(placeAria(v, 'barTop')).toBe("Jeff's bar, empty");
    expect(placeAria(v, 'offLight', { canMove: false, selected: false, die: '6' })).toBe(
      'Your tray, 0 off, target with the 6',
    );
    expect(placeAria(v, 'offDark')).toBe("Jeff's tray, 0 off");
    // Seat 1 counts the other way: absolute point 24 is Dark's 1-point.
    const dark = viewAt(START, 1, null, 1);
    expect(placeAria(dark, 'point-24')).toBe("Ari's 1-point, 2 checkers");
    expect(placeAria(dark, 'point-1')).toBe('Your 24-point, 2 checkers');
  });
});

describe('flightsBetween', () => {
  const t1 = stateAt(START, 0, [3, 1]);
  const t13 = stateAt(BLOT_ON_5, 0, [3, 1]);
  const both = (s: State): readonly [View, View] => [viewFor(s, 0), viewFor(s, 1)];

  test("a move flies its checker; a hit adds the blot's trip to the bar, viewer-relative", () => {
    const [before0, before1] = both(t1);
    const [after0] = both(move(t1, '8/5'));
    expect(flightsBetween(before0, after0)).toEqual([
      { fromContainer: 'point-8', toContainer: 'point-5' },
    ]);
    const hit = move(t13, '8/5*');
    expect(flightsBetween(viewFor(t13, 0), viewFor(hit, 0))).toEqual([
      { fromContainer: 'point-8', toContainer: 'point-5' },
      { fromContainer: 'point-5', toContainer: 'barTop', hit: true },
    ]);
    expect(flightsBetween(viewFor(t13, 1), viewFor(hit, 1))).toEqual([
      { fromContainer: 'point-8', toContainer: 'point-5' },
      { fromContainer: 'point-5', toContainer: 'barBottom', hit: true },
    ]);
    // The same view twice, or a roll, flies nothing.
    expect(flightsBetween(before0, before0)).toEqual([]);
    expect(flightsBetween(viewAt(START, 0, null), before0)).toEqual([]);
    expect(flightsBetween(before1, viewFor(t1, 1))).toEqual([]);
  });

  test('an undo reverses the removed tail, the blot first', () => {
    const hit = move(t13, '8/5*');
    const undone = step(hit, 0, { type: 'undo' });
    expect(flightsBetween(viewFor(hit, 0), viewFor(undone, 0))).toEqual([
      { fromContainer: 'barTop', toContainer: 'point-5' },
      { fromContainer: 'point-5', toContainer: 'point-8' },
    ]);
  });

  test('the turn ends: the finished play beyond what was shown, from either side of the table', () => {
    const one = move(t1, '8/5');
    const done = move(one, '6/5');
    expect(done.phase).toBe('toRoll');
    expect(flightsBetween(viewFor(one, 0), viewFor(done, 0))).toEqual([
      { fromContainer: 'point-6', toContainer: 'point-5' },
    ]);
    // The guest saw only the roll: both moves arrive with the turn's end.
    expect(flightsBetween(viewFor(t1, 1), viewFor(done, 1))).toEqual([
      { fromContainer: 'point-8', toContainer: 'point-5' },
      { fromContainer: 'point-6', toContainer: 'point-5' },
    ]);
    // A frame that skipped the turn's start still animates the whole play.
    expect(flightsBetween(viewAt(START, 0, null, 1), viewFor(done, 1))).toHaveLength(2);
    // The next paint of the same finished turn flies nothing again.
    expect(flightsBetween(viewFor(done, 1), viewFor(done, 1))).toEqual([]);
    // A forfeited roll flips the turn with no play.
    const passed = step(stateAt(T15, 0, null), 0, { type: 'roll' });
    expect(flightsBetween(viewAt(T15, 0, null), viewFor(passed, 0))).toEqual([]);
  });

  test("a bear-off lands as a slab and the game's end still flies; a new game and a crowd do not", () => {
    const last = stateAt(T25, 0, [1, 4]);
    const over = move(last, '1/off(4)');
    expect(over.phase).toBe('over');
    expect(flightsBetween(viewFor(last, 0), viewFor(over, 0))).toEqual([
      { fromContainer: 'point-1', toContainer: 'offLight', slab: true },
    ]);
    expect(flightsBetween(viewFor(over, 0), viewFor(over, 0))).toEqual([]);
    expect(flightsBetween(viewFor(over, 0), viewFor(step(over, 0, { type: 'next' }), 0))).toEqual(
      [],
    );
    // A double's four moves, every one a hit: eight flights, the most one play can make, all fly
    // (MAX_FLIGHTS; the owner asked for every move to be seen), staggered by fly.ts.
    const crowd: PlayedMove[] = [
      { from: 12, to: 6, die: 6, hit: true },
      { from: 12, to: 6, die: 6, hit: true },
      { from: 7, to: 1, die: 6, hit: true },
      { from: 7, to: 1, die: 6, hit: true },
    ];
    const prev = viewFor({ ...t1, dice: [6, 6] }, 0);
    const next = viewFor({ ...t1, dice: [6, 6], played: crowd }, 0);
    expect(MAX_FLIGHTS).toBe(8);
    expect(flightsBetween(prev, next)).toHaveLength(8);
    expect(
      flightsBetween(prev, viewFor({ ...t1, dice: [6, 6], played: crowd.slice(1) }, 0)),
    ).toHaveLength(6);
    // Beyond the cap (nothing a play produces): cold.
    const nine = [
      ...flightsBetween(prev, next),
      { fromContainer: 'point-1', toContainer: 'point-2' },
    ];
    expect(nine.length > MAX_FLIGHTS).toBe(true);
  });
});
