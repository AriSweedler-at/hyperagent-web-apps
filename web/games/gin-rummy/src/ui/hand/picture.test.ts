import { describe, expect, test } from 'vitest';

import { mulberry32 } from '../../../../../shared/lib/rng.ts';
import { makeCard } from '../../engine/cards.ts';
import { applyAction, createGame, viewFor } from '../../engine/index.ts';
import type { Action, Cards, Seat, State, View } from '../../engine/index.ts';
import type { DrawStage } from './draw.ts';
import {
  DESKTOP_COLUMNS,
  PHONE_COLUMNS,
  cardsOf,
  engineOf,
  onTable,
  phoneRows,
  rowsOf,
  samePicture,
  settlePicture,
  spansOf,
  type Picture,
} from './picture.ts';

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
const ids = (cards: Cards): ReadonlyArray<string> => cards.map((c) => c.id);

const [as, ah, ad, s5, s6, s7, s8, k, q, d9, c2, jh] = [
  makeCard(1, 'S'),
  makeCard(1, 'H'),
  makeCard(1, 'D'),
  makeCard(5, 'S'),
  makeCard(6, 'S'),
  makeCard(7, 'S'),
  makeCard(8, 'S'),
  makeCard(13, 'C'),
  makeCard(12, 'H'),
  makeCard(9, 'D'),
  makeCard(2, 'C'),
  makeCard(11, 'H'),
];
const aces = [as, ah, ad];
const spades = [s5, s6, s7, s8];
const loose = [k, q, d9];
const ten = [...aces, ...spades, ...loose];

const view = (over: Partial<View> = {}, me: Partial<View['me']> = {}): View =>
  ({
    me: {
      idx: 0,
      id: 'p1',
      name: 'Ann',
      total: 0,
      hand: ten,
      melds: [aces, spades],
      deadwood: loose,
      deadwoodValue: 32,
      ...me,
    },
    phase: 'discard',
    isMyTurn: true,
    lastDrawnId: null,
    drawnFromDiscard: null,
    ...over,
  }) as View;
const pic = (
  groups: ReadonlyArray<Cards>,
  dead: Cards,
  human: ReadonlyArray<string> = [],
): Picture => ({
  groups,
  loose: dead,
  human,
});
const kept = pic([aces, spades], loose);
/** `settlePicture` with the engine's melding as the fresh arrangement. */
const settle = (prev: Picture | null, v: View, stage: DrawStage | null = null): Picture =>
  settlePicture(prev, v, stage, () => engineOf(v, stage));
const shownJH: DrawStage = { kind: 'shown', from: 'stock', cardId: 'JH' };

describe('cardsOf / onTable / engineOf', () => {
  test('cardsOf is the groups then the loose cards, in order', () => {
    expect(ids(cardsOf(kept))).toEqual(ids(ten));
    expect(cardsOf(pic([], []))).toEqual([]);
  });

  test('onTable leaves the drawn card out only while the stage shows it', () => {
    const v = view({}, { hand: [...ten, jh] });
    expect(ids(onTable(v, null))).toEqual(ids([...ten, jh]));
    expect(ids(onTable(v, { kind: 'waiting', from: 'stock' }))).toEqual(ids([...ten, jh]));
    expect(ids(onTable(v, shownJH))).toEqual(ids(ten));
  });

  test("engineOf is the view's melding; a meld the shown card leaves broken goes loose", () => {
    expect(engineOf(view(), null)).toEqual(kept);
    // The eleven melded with the jack in a set of three: without it the pair is loose, at the end.
    const v = view(
      {},
      { hand: [...ten, jh], melds: [aces, [q, jh, k]], deadwood: [...spades, d9] },
    );
    expect(engineOf(v, shownJH)).toEqual(pic([aces], [...spades, d9, q, k]));
    // A run of four minus the drawn card is still a meld.
    const four = view({}, { hand: [...ten, jh], melds: [aces, spades], deadwood: [k, q, d9, jh] });
    expect(engineOf(four, shownJH)).toEqual(kept);
    expect(engineOf(four, { kind: 'shown', from: 'stock', cardId: '8S' })).toEqual(
      pic([aces, [s5, s6, s7]], [k, q, d9, jh]),
    );
  });
});

describe('samePicture', () => {
  test('group by group, then loose, then the hand-made marks, by id and order', () => {
    expect(samePicture(kept, pic([aces, spades], loose))).toBe(true);
    expect(samePicture(kept, pic([spades, aces], loose))).toBe(false);
    expect(samePicture(kept, pic([aces, spades], [q, k, d9]))).toBe(false);
    expect(samePicture(kept, pic([aces], [...spades, ...loose]))).toBe(false);
    expect(samePicture(kept, pic([aces, spades, []], loose))).toBe(false);
    expect(samePicture(kept, pic([aces, spades], loose, ['AS', 'AH', 'AD']))).toBe(false);
    expect(
      samePicture(pic([aces], loose, ['AH', 'AS', 'AD']), pic([aces], loose, ['AS', 'AD', 'AH'])),
    ).toBe(true);
  });
});

describe('settlePicture', () => {
  test('(a) no picture yet, or my draw or upcard phase: the fresh arrangement', () => {
    const drawPhase = view({ phase: 'draw' }, { melds: [spades, aces] });
    expect(settle(null, view())).toEqual(kept);
    expect(settle(kept, drawPhase)).toEqual(pic([spades, aces], loose));
    expect(settle(kept, view({ phase: 'upcard' }, { melds: [spades, aces] }))).toEqual(
      pic([spades, aces], loose),
    );
    // Their draw phase is not my turn start: the picture is kept.
    expect(settle(kept, view({ phase: 'draw', isMyTurn: false }, { melds: [spades, aces] }))).toBe(
      kept,
    );
    // The thunk is not called when a rule keeps the picture.
    expect(
      settlePicture(kept, view(), null, () => {
        throw new Error('fresh computed');
      }),
    ).toBe(kept);
  });

  test('(b) the same cards on the table: kept as is, whatever the engine now says', () => {
    const remelded = view({}, { melds: [spades, aces], deadwood: [q, k, d9] });
    expect(settle(kept, remelded)).toBe(kept);
    // A draw: the eleventh card sits in the ghost cell, the ten on the table are the same.
    const drawn = view(
      { lastDrawnId: 'JH' },
      { hand: [...ten, jh], melds: [], deadwood: [...ten, jh] },
    );
    expect(settle(kept, drawn, shownJH)).toBe(kept);
    expect(settle(kept, view({ isMyTurn: false }))).toBe(kept);
  });

  test('(c) one card more: appended loose (the accept takes the ghost cell)', () => {
    const accepted = view(
      { lastDrawnId: 'JH' },
      { hand: [...ten, jh], melds: [], deadwood: [...ten, jh] },
    );
    expect(settle(kept, accepted)).toEqual(pic([aces, spades], [...loose, jh]));
    const marked = pic([aces, spades], loose, ['AS', 'AH', 'AD']);
    expect(settle(marked, accepted).human).toEqual(['AS', 'AH', 'AD']);
  });

  test('(d) one card fewer: it leaves in place; a group left under three stays a group', () => {
    const eleven = pic([aces, spades], [...loose, jh], ['AS', 'AH', 'AD']);
    const theirs = { isMyTurn: false, phase: 'draw' } as const;
    const discardedLoose = view(theirs, { hand: [...ten, jh].filter((c) => c.id !== 'QH') });
    expect(settle(eleven, discardedLoose)).toEqual(
      pic([aces, spades], [k, d9, jh], ['AS', 'AH', 'AD']),
    );
    const discardedFromMeld = view(theirs, { hand: [...ten, jh].filter((c) => c.id !== 'AH') });
    expect(settle(eleven, discardedFromMeld)).toEqual(
      pic([[as, ad], spades], [...loose, jh], ['AS', 'AD']),
    );
    // The last card of a group leaves the group with it.
    const lone = pic([[as], spades], loose);
    expect(settle(lone, view(theirs, { hand: [...spades, ...loose] }))).toEqual(
      pic([spades], loose),
    );
  });

  test('(e) anything else (a deal, a seat switch, a resume): the fresh arrangement', () => {
    const other = view(
      {},
      {
        hand: [jh, c2, ...aces, ...loose, s5, s6],
        melds: [aces],
        deadwood: [jh, c2, ...loose, s5, s6],
      },
    );
    expect(settle(kept, other)).toEqual(pic([aces], [jh, c2, ...loose, s5, s6]));
    // Two cards more, or one in and one out, are not an accept.
    const two = view(
      {},
      { hand: [...ten, jh, c2], melds: [aces, spades], deadwood: [...loose, jh, c2] },
    );
    expect(settle(kept, two)).toEqual(pic([aces, spades], [...loose, jh, c2]));
    const swapped = view(
      {},
      { hand: [...aces, ...spades, k, q, jh], melds: [aces, spades], deadwood: [k, q, jh] },
    );
    expect(settle(kept, swapped)).toEqual(pic([aces, spades], [k, q, jh]));
  });

  test('through a real game: the turn-start picture, kept over a draw, extended on accept, trimmed on discard', () => {
    const dealt = createGame({ players: PLAYERS, target: 100, dealer: 1 }, mulberry32(3), now);
    const passed = play(dealt, [
      [0, { type: 'passUpcard' }],
      [1, { type: 'passUpcard' }],
    ]);
    const start = settle(null, viewFor(passed, 0));
    expect(start).toEqual(engineOf(viewFor(passed, 0), null));
    const drawn = play(passed, [[0, { type: 'drawStock' }]]);
    const drawnId = drawn.lastDrawn?.id ?? '';
    const shown = settle(start, viewFor(drawn, 0), {
      kind: 'shown',
      from: 'stock',
      cardId: drawnId,
    });
    expect(shown).toBe(start);
    const accepted = settle(shown, viewFor(drawn, 0));
    expect(ids(cardsOf(accepted))).toEqual([...ids(cardsOf(start)), drawnId]);
    const discardId = cardsOf(start)[0]?.id ?? '';
    const discarded = play(drawn, [[0, { type: 'discard', cardId: discardId }]]);
    const after = settle(accepted, viewFor(discarded, 0));
    expect(ids(cardsOf(after))).toEqual(ids(cardsOf(accepted)).filter((id) => id !== discardId));
    // Bob's turn passes; Ann's next draw phase re-melds.
    const theirs = play(discarded, [[1, { type: 'drawStock' }]]);
    expect(settle(after, viewFor(theirs, 0))).toBe(after);
    const mine = play(theirs, [[1, { type: 'discard', cardId: theirs.hands[1][0]?.id ?? '' }]]);
    expect(settle(after, viewFor(mine, 0))).toEqual(engineOf(viewFor(mine, 0), null));
  });
});

describe('spansOf / rowsOf / phoneRows', () => {
  test('spans are the groups, one per loose card, and the ghost cell while ten or fewer are held', () => {
    expect(spansOf(kept)).toEqual([3, 4, 1, 1, 1, 1]);
    expect(spansOf(pic([aces, spades], [...loose, jh]))).toEqual([3, 4, 1, 1, 1, 1]);
    expect(spansOf(pic([], []))).toEqual([1]);
  });

  test('desktop: eleven columns, always one row', () => {
    expect(rowsOf([3, 4, 1, 1, 1, 1], DESKTOP_COLUMNS)).toEqual([11]);
    expect(rowsOf([4, 4, 3], DESKTOP_COLUMNS)).toEqual([11]);
  });

  test('phone: dense placement lets loose cards and the ghost fill the holes melds leave', () => {
    expect(rowsOf([4, 3, 1, 1, 1, 1], PHONE_COLUMNS)).toEqual([6, 5]);
    expect(rowsOf([3, 3, 3, 1, 1], PHONE_COLUMNS)).toEqual([6, 5]);
    expect(rowsOf([5, 5, 1], PHONE_COLUMNS)).toEqual([6, 5]);
    expect(rowsOf([4, 3, 3, 1], PHONE_COLUMNS)).toEqual([5, 6]);
    expect(rowsOf([4, 4, 3], PHONE_COLUMNS)).toEqual([4, 4, 3]);
    expect(rowsOf([4, 4, 1, 1, 1], PHONE_COLUMNS)).toEqual([6, 5]);
    expect(rowsOf([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], PHONE_COLUMNS)).toEqual([6, 5]);
    expect(rowsOf([], PHONE_COLUMNS)).toEqual([]);
  });

  test('a run of seven or more wraps inside a two-row cell on the phone', () => {
    expect(rowsOf([7, 3, 1], PHONE_COLUMNS)).toEqual([6, 1, 4]);
    // Dense flow: the wide item takes the first two free rows and the group after it comes back
    // to the hole beside the loose card in the first row.
    expect(rowsOf([1, 7, 3], PHONE_COLUMNS)).toEqual([4, 6, 1]);
    expect(rowsOf([7, 3, 1], DESKTOP_COLUMNS)).toEqual([11]);
  });

  test('phoneRows counts the phone rows of a picture', () => {
    expect(phoneRows(kept)).toBe(2);
    expect(phoneRows(pic([spades, [as, ah, ad, k], [q, d9, c2]], []))).toBe(3);
    expect(phoneRows(pic([[s5, s6, s7, s8, as, ah, ad], aces], [jh]))).toBe(3);
  });
});
