import { describe, expect, test } from 'vitest';

import { mulberry32 } from '../../../../../shared/lib/rng.ts';
import { makeCard } from '../../engine/cards.ts';
import { applyAction, bestMelding, createGame, viewFor } from '../../engine/index.ts';
import type { Cards, View } from '../../engine/index.ts';
import {
  arrangedOf,
  declarable,
  sorted,
  standing,
  toggleMeld,
  type HumanMelds,
} from './arrange.ts';
import { engineOf, type Picture } from './picture.ts';

const [as, ah, ad, ac, s5, s6, s7, s8, k, q, d9, jh] = [
  makeCard(1, 'S'),
  makeCard(1, 'H'),
  makeCard(1, 'D'),
  makeCard(1, 'C'),
  makeCard(5, 'S'),
  makeCard(6, 'S'),
  makeCard(7, 'S'),
  makeCard(8, 'S'),
  makeCard(13, 'C'),
  makeCard(12, 'H'),
  makeCard(9, 'D'),
  makeCard(11, 'H'),
];
const aces = [as, ah, ad];
const spades = [s5, s6, s7, s8];
const loose = [k, q, d9];
const ten = [...aces, ...spades, ...loose];
const ids = (cards: Cards): ReadonlyArray<string> => cards.map((c) => c.id);

const view = (hand: Cards, over: Partial<View> = {}): View => {
  const best = bestMelding(hand);
  return {
    me: {
      idx: 0,
      id: 'p1',
      name: 'Ann',
      total: 0,
      hand,
      melds: best.melds,
      deadwood: best.deadwood,
      deadwoodValue: best.value,
    },
    handNumber: 1,
    phase: 'discard',
    isMyTurn: true,
    lastDrawnId: null,
    drawnFromDiscard: null,
    ...over,
  } as View;
};
const pic = (
  groups: ReadonlyArray<Cards>,
  dead: Cards,
  human: ReadonlyArray<string> = [],
): Picture => ({
  groups,
  loose: dead,
  human,
});
const mine = (...groups: ReadonlyArray<Cards>): HumanMelds => ({
  hand: 1,
  groups: groups.map(ids),
});

describe('standing', () => {
  test('a hand-made meld stands while its cards are held and still meld; another hand has none', () => {
    expect(standing(mine(aces), 1, ten)).toEqual([aces]);
    expect(standing(mine(aces), 2, ten)).toEqual([]);
    expect(standing(null, 1, ten)).toEqual([]);
    // The ace of hearts was discarded: two aces are no meld.
    expect(
      standing(
        mine(aces),
        1,
        ten.filter((c) => c.id !== 'AH'),
      ),
    ).toEqual([]);
    // A run of four loses its end and stands as three.
    expect(
      standing(
        mine(spades),
        1,
        ten.filter((c) => c.id !== '8S'),
      ),
    ).toEqual([[s5, s6, s7]]);
    // Sets sort by suit, runs by rank, as the engine shows a meld.
    expect(standing({ hand: 1, groups: [['AD', 'AS', 'AH']] }, 1, ten)).toEqual([[as, ah, ad]]);
  });
});

describe('sorted', () => {
  const p = pic([spades, aces], [k, d9, q]);

  test('melds: untouched', () => {
    expect(sorted(p, 'melds')).toBe(p);
  });

  test('rank: groups by their lowest card, then the loose cards by rank', () => {
    expect(sorted(p, 'rank')).toEqual(pic([aces, spades], [d9, q, k]));
  });

  test('suit: spades, hearts, diamonds, clubs, then rank', () => {
    expect(sorted(p, 'suit')).toEqual(pic([aces, spades], [q, d9, k]));
    // A group's suit is its lowest card's under the same key: the aces lead on the spade.
    expect(sorted(pic([[ah, ad, ac], spades], []), 'suit').groups).toEqual([spades, [ah, ad, ac]]);
  });
});

describe('arrangedOf', () => {
  test("nothing hand-made: the engine's melding, sorted", () => {
    const v = view(ten);
    expect(arrangedOf(v, null, null, 'melds')).toEqual(engineOf(v, null));
    expect(arrangedOf(v, null, mine(aces), 'melds').human).toEqual(['AS', 'AH', 'AD']);
    expect(arrangedOf(v, null, { hand: 2, groups: [ids(aces)] }, 'melds')).toEqual(
      engineOf(v, null),
    );
  });

  test('a hand-made meld leads and the solver melds the rest, even when the engine melds differently', () => {
    // 5S 6S 7S + 5H 5D: the run leaves 10 deadwood, the set of fives 13, so the solver takes the
    // run; the player wants the fives and gets them, the 6S 7S loose.
    const hand = [s5, s6, s7, makeCard(5, 'H'), makeCard(5, 'D'), k, q, d9, ad, jh];
    const v = view(hand);
    expect(engineOf(v, null).groups).toEqual([[s5, s6, s7]]);
    const fives = [s5, makeCard(5, 'H'), makeCard(5, 'D')];
    const arranged = arrangedOf(v, null, mine(fives), 'melds');
    expect(arranged.groups).toEqual([fives]);
    expect(ids(arranged.loose)).toEqual(['6S', '7S', 'JH', 'QH', 'AD', '9D', 'KC']);
    expect(arranged.human).toEqual(['5S', '5H', '5D']);
  });

  test('the shown card is not on the table: the hand-made meld is judged on the ten', () => {
    const v = view([...ten, jh], { lastDrawnId: 'JH' });
    const arranged = arrangedOf(
      v,
      { kind: 'shown', from: 'stock', cardId: 'JH' },
      mine(aces),
      'melds',
    );
    expect(ids([...arranged.groups.flat(), ...arranged.loose])).not.toContain('JH');
    expect(arranged.groups[0]).toEqual(aces);
  });
});

describe('toggleMeld', () => {
  test('a card in no meld yet: the meld with it that leaves the least deadwood becomes hand-made', () => {
    expect(toggleMeld(null, 1, ten, 'AS')).toEqual(mine(aces));
    // The 6S sits in 5-6-7-8; the whole run beats 5-6-7 or 6-7-8 on the deadwood it leaves.
    expect(toggleMeld(null, 1, ten, '6S')).toEqual(mine(spades));
  });

  test('a card that can join no meld: null, and the hand-made melds are unchanged', () => {
    expect(toggleMeld(null, 1, ten, 'KC')).toBeNull();
    expect(toggleMeld(mine(aces), 1, ten, 'QH')).toBeNull();
    expect(toggleMeld(null, 1, ten, 'ZZ')).toBeNull();
  });

  test('a card in a hand-made meld dissolves that meld and no other', () => {
    expect(toggleMeld(mine(aces, spades), 1, ten, 'AH')).toEqual(mine(spades));
    expect(toggleMeld(mine(aces), 1, ten, 'AS')).toEqual({ hand: 1, groups: [] });
  });

  test('a card a hand-made meld can take joins it before it makes a meld of its own', () => {
    // Three spades hand-made; the 8S extends them rather than forming nothing alone.
    const three = mine([s5, s6, s7]);
    expect(toggleMeld(three, 1, ten, '8S')).toEqual(mine(spades));
    // A fourth ace joins the set.
    const withClub = [...ten, ac];
    expect(toggleMeld(mine(aces), 1, withClub, 'AC')).toEqual(mine([as, ah, ad, ac]));
  });

  test('a new meld is made from the cards no hand-made meld holds', () => {
    // With 5S 6S 7S hand-made, the 8S is free but alone: it cannot start a run (5-6-7 are taken)
    // and joins the three instead; with the four spades hand-made, the 5H needs two more fives.
    const hand = [s5, s6, s7, s8, makeCard(5, 'H'), makeCard(5, 'D'), k, q, d9, ad];
    expect(toggleMeld(mine(spades), 1, hand, '5H')).toBeNull();
    // The 5S dissolves the run; then the fives can be made, and the solver keeps 6-7-8.
    const dissolved = toggleMeld(mine(spades), 1, hand, '5S');
    expect(dissolved).toEqual({ hand: 1, groups: [] });
    const fives = toggleMeld(dissolved, 1, hand, '5H');
    expect(fives).toEqual(mine([s5, makeCard(5, 'H'), makeCard(5, 'D')]));
    expect(arrangedOf(view(hand), null, fives, 'melds').groups[1]).toEqual([s6, s7, s8]);
  });

  test('another hand number starts from no hand-made melds', () => {
    expect(toggleMeld(mine(spades), 2, ten, 'AS')).toEqual({ hand: 2, groups: [ids(aces)] });
  });
});

describe('declarable', () => {
  test('groups that score as well as the solver are declared; worse ones are not', () => {
    const hand = [s5, s6, s7, s8, makeCard(5, 'H'), makeCard(5, 'D'), k, q, d9, ad];
    const fives = [s5, makeCard(5, 'H'), makeCard(5, 'D')];
    expect(declarable(hand, pic([fives, [s6, s7, s8]], [ad, k, q, d9]))).toEqual([
      ['5S', '5H', '5D'],
      ['6S', '7S', '8S'],
    ]);
    // Only the fives: the 6-7-8 count as deadwood in the picture, but the solver would meld them,
    // so the declaration still scores the same and is allowed.
    expect(declarable(hand, pic([fives], [s6, s7, s8, ad, k, q, d9]))).toEqual([
      ['5S', '5H', '5D'],
    ]);
    // A pair is not a meld.
    expect(declarable(ten, pic([[as, ah]], [ad, ...spades, ...loose]))).toBeNull();
    // Melding the fives from 5S 5H 5D 6S 7S: the run 5-6-7 would score better.
    const tight = [s5, s6, s7, makeCard(5, 'H'), makeCard(5, 'D'), k, q, d9, ad, jh];
    expect(
      declarable(
        tight,
        pic([[s5, makeCard(5, 'H'), makeCard(5, 'D')]], [s6, s7, k, q, d9, ad, jh]),
      ),
    ).toBeNull();
  });

  test('through a real deal: the solver melding declares as itself', () => {
    const dealt = createGame(
      {
        players: [
          { id: 'p1', name: 'Ann' },
          { id: 'p2', name: 'Bob' },
        ],
        target: 100,
        dealer: 1,
      },
      mulberry32(3),
      () => 1_700_000_000_000,
    );
    const passed = applyAction(dealt, 0, { type: 'passUpcard' }, mulberry32(0), () => 0);
    if (!passed.ok) throw new Error(passed.error);
    const v = viewFor(passed.value, 0);
    expect(declarable(v.me.hand, engineOf(v, null))).toEqual(v.me.melds.map(ids));
  });
});
