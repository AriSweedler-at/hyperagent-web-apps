// The deck (E1-E3, D10), the names (D23), the trick winner (E7) and the exchange table (E14) as
// selectors, apart from any state. The 40 ids are pinned as a literal here; once the shared card
// vocabulary lands (design §3, `cardIds('italian40')`) that pin moves to an equality against it.
import { describe, expect, test } from 'vitest';

import {
  cardById,
  cardName,
  deckFor,
  exchangeCardFor,
  idsOf,
  isCardId,
  makeCard,
  makeDeck,
  pointsOf,
  trickWinner,
} from './cards.ts';
import { nextSeat, seatsFrom, seatsOf, seatsOfSide, sideList, sideOf, sidesOf } from './seats.ts';
import { DECK_POINTS, POINTS, RANKS, STRENGTH, SUITS, type Card, type Played } from './types.ts';

const c = (id: string): Card => {
  const card = cardById(id);
  if (card === null) throw new Error(`not a card: ${id}`);
  return card;
};
/** `s0:AS s1:2C` -> the played cards in play order. */
const trick = (text: string): ReadonlyArray<Played> =>
  text.split(' ').map((token) => {
    const [seat, id] = token.split(':');
    return { seat: Number(seat?.slice(1)) as 0 | 1 | 2 | 3, card: c(id ?? '') };
  });

describe('the deck (E1, E2, D10)', () => {
  test('40 cards suit-major C D S B, rank 1..10, ids LABEL + suit', () => {
    expect(idsOf(makeDeck())).toEqual([
      ...'AC 2C 3C 4C 5C 6C 7C FC CC RC'.split(' '),
      ...'AD 2D 3D 4D 5D 6D 7D FD CD RD'.split(' '),
      ...'AS 2S 3S 4S 5S 6S 7S FS CS RS'.split(' '),
      ...'AB 2B 3B 4B 5B 6B 7B FB CB RB'.split(' '),
    ]);
    expect(new Set(idsOf(makeDeck())).size).toBe(40);
    expect(makeCard(9, 'B')).toEqual({ id: 'CB', r: 9, s: 'B' });
  });

  test('120 points in the 40 and in every 39-card deck', () => {
    expect(pointsOf(makeDeck())).toBe(DECK_POINTS);
    SUITS.forEach((removedTwo) => {
      const deck = deckFor({ seatCount: 3, removedTwo });
      expect(deck).toHaveLength(39);
      expect(idsOf(deck)).not.toContain(`2${removedTwo}`);
      expect(pointsOf(deck)).toBe(120);
    });
    expect(deckFor({ seatCount: 2, removedTwo: 'C' })).toHaveLength(40);
    expect(deckFor({ seatCount: 4, removedTwo: 'C' })).toHaveLength(40);
  });

  test('POINTS 11/10/4/3/2 and STRENGTH A 3 R C F 7 6 5 4 2 (E3: never by rank)', () => {
    expect(RANKS.map((r) => POINTS[r])).toEqual([11, 0, 10, 0, 0, 0, 0, 2, 3, 4]);
    const byStrength = [...RANKS].sort((a, b) => STRENGTH[b] - STRENGTH[a]);
    expect(byStrength).toEqual([1, 3, 10, 9, 8, 7, 6, 5, 4, 2]);
  });

  test('cardById and isCardId: the grammar and nothing else', () => {
    expect(cardById('AC')).toEqual({ id: 'AC', r: 1, s: 'C' });
    expect(cardById('RB')).toEqual({ id: 'RB', r: 10, s: 'B' });
    expect(cardById('FS')).toEqual({ id: 'FS', r: 8, s: 'S' });
    ['ZZ', '10B', '1D', 'A', 'AH', 'ac', '', 'AC ', '8C'].forEach((id) => {
      expect(cardById(id), id).toBeNull();
      expect(isCardId(id), id).toBe(false);
    });
    expect(makeDeck().every((card) => isCardId(card.id))).toBe(true);
  });

  test('cardName: the Italian names (D23)', () => {
    expect(cardName(c('AC'))).toBe('asso di coppe');
    expect(cardName(c('7D'))).toBe('sette di denari');
    expect(cardName(c('FS'))).toBe('fante di spade');
    expect(cardName(c('CB'))).toBe('cavallo di bastoni');
    expect(cardName(c('RB'))).toBe('re di bastoni');
    expect(cardName(c('2C'))).toBe('due di coppe');
  });
});

describe('seats and sides (D1, D6, E12, E17)', () => {
  test('play order runs to the next index and wraps', () => {
    expect(seatsOf(2)).toEqual([0, 1]);
    expect(seatsOf(4)).toEqual([0, 1, 2, 3]);
    expect(nextSeat(2, 1)).toBe(0);
    expect(nextSeat(3, 2)).toBe(0);
    expect(nextSeat(4, 1)).toBe(2);
    expect(seatsFrom(4, 2)).toEqual([2, 3, 0, 1]);
    expect(seatsFrom(3, 1)).toEqual([1, 2, 0]);
  });

  test('sides: the seat itself at 2 and 3, seat % 2 at four', () => {
    expect(sidesOf(2)).toBe(2);
    expect(sidesOf(3)).toBe(3);
    expect(sidesOf(4)).toBe(2);
    expect(sideList(3)).toEqual([0, 1, 2]);
    expect(sideList(4)).toEqual([0, 1]);
    expect(seatsOf(4).map((s) => sideOf(4, s))).toEqual([0, 1, 0, 1]);
    expect(seatsOf(3).map((s) => sideOf(3, s))).toEqual([0, 1, 2]);
    expect(seatsOfSide(4, 0)).toEqual([0, 2]);
    expect(seatsOfSide(4, 1)).toEqual([1, 3]);
    expect(seatsOfSide(2, 1)).toEqual([1]);
  });
});

describe('trickWinner (E7) on the table rows T1-T10 as selectors', () => {
  test.each([
    ['T1 any briscola beats an off-suit asso', 'C', 's0:AS s1:2C', 1, 11],
    ['T2 asso over tre in the led suit', 'C', 's0:3D s1:AD', 1, 21],
    ['T3 an off-suit non-trump never wins', 'C', 's0:3D s1:AS', 0, 21],
    ['T4 STRENGTH F > 7', 'C', 's0:7C s1:FC', 1, 2],
    ['T5 tre over re', 'C', 's0:RC s1:3C', 1, 14],
    ['T6 4 over 2 by strength, no points', 'C', 's0:2B s1:4B', 1, 0],
    [
      'T7 the asso of trumps over the tre of trumps, four cards',
      'C',
      's0:2D s1:4D s2:AC s3:3C',
      2,
      21,
    ],
    ['T8 highest of the led suit, leader 1', 'C', 's1:5B s2:6B s3:7B s0:4B', 3, 0],
    ['T9 3S highest of the led suit, AD off-suit', 'C', 's0:2S s1:AD s2:3S', 2, 21],
    ['T10 asso di bastoni over the due, T=B, leader 2', 'B', 's2:AS s0:2B s1:AB', 1, 22],
  ] as const)('%s', (_name, trump, text, winner, points) => {
    const cards = trick(text);
    expect(trickWinner(trump, cards)).toBe(winner);
    expect(pointsOf(cards.map((p) => p.card))).toBe(points);
  });
});

describe('exchangeCardFor (E14)', () => {
  test('the 7 for a higher trump card, the 2 for the 7..4, nothing for the 2', () => {
    ['AC', '3C', 'RC', 'CC', 'FC'].forEach((id) => {
      expect(exchangeCardFor(c(id)), id).toEqual(c('7C'));
    });
    ['7D', '6D', '5D', '4D'].forEach((id) => {
      expect(exchangeCardFor(c(id)), id).toEqual(c('2D'));
    });
    expect(exchangeCardFor(c('2S'))).toBeNull();
  });
});
