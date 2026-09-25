// The copy of the event stream (E18, D23, E23): `summaryOf` is a history row's line and `detailOf`
// its expanded label/value pairs, for every kind, derived from the event alone; the sentence
// builders behind them are pinned here too (their reducer uses are pinned in apply.test.ts).
import { describe, expect, test } from 'vitest';

import { cardById } from './cards.ts';
import {
  dealText,
  detailOf,
  exchangeText,
  gameText,
  nameOf,
  playText,
  resultText,
  sideName,
  summaryOf,
  trickText,
} from './log.ts';
import type { Card, GameEvent, Played, TrickData } from './types.ts';

const P = [
  { id: 'a', name: 'Ari' },
  { id: 'b', name: 'Jeff' },
  { id: 'c', name: 'Kim' },
  { id: 'd', name: 'Dan' },
] as const;
const AT = 1_700_000_000_000;
const c = (id: string): Card => {
  const card = cardById(id);
  if (card === null) throw new Error(`not a card: ${id}`);
  return card;
};
/** `s0:AS s1:2C` -> the plays in order. */
const plays = (text: string): ReadonlyArray<Played> =>
  text.split(' ').map((token) => {
    const [seat, id] = token.split(':');
    return { seat: Number(seat?.slice(1)) as 0 | 1 | 2 | 3, card: c(id ?? '') };
  });
const trickEvent = (data: TrickData): GameEvent => ({
  id: 3,
  kind: 'trick',
  seat: data.winner,
  at: AT,
  data,
});
/** The steal of T11 at two players: the 2 di coppe over the led asso di spade, both drawing. */
const STEAL: TrickData = {
  no: 1,
  leader: 0,
  cards: plays('s0:AS s1:2C'),
  winner: 1,
  winnerSide: 1,
  points: 11,
  valueClass: 'big',
  winningCard: c('2C'),
  winningClass: 'pip',
  briscola: true,
  steal: true,
  overtrump: false,
  carichiLost: [0],
  drew: [1, 0],
  trumpTaken: null,
};

describe('the sentence builders (E4, E6, E8, E12, E14, E23)', () => {
  test('names: the player at the seat, "Seat n" past the table; a side at four is one player', () => {
    expect(nameOf(P.slice(0, 2), 1)).toBe('Jeff');
    expect(nameOf(P.slice(0, 2), 3)).toBe('Seat 3');
    expect(sideName(P, 4, 0)).toBe('Ari');
    expect(sideName(P, 4, 1)).toBe('Jeff');
    expect(sideName(P.slice(0, 3), 3, 2)).toBe('Kim');
  });

  test('game, deal, play, exchange', () => {
    expect(gameText(3)).toBe('Game 3 begins');
    expect(dealText('Ari', c('7C'))).toBe('Ari dealt · the briscola is the sette di coppe');
    expect(playText('Ari', c('AC'), true)).toBe('Ari led the asso di coppe');
    expect(playText('Jeff', c('3S'), false)).toBe('Jeff played the tre di spade');
    expect(exchangeText('Ari', c('7C'), c('AC'))).toBe(
      'Ari exchanged the sette di coppe for the asso di coppe',
    );
  });

  test('trickText: the points, then the steal clause, then the trump card taken', () => {
    expect(trickText('Jeff', 14, false, false)).toBe('Jeff took the trick · 14 points');
    expect(trickText('Jeff', 14, true, false)).toBe(
      'Jeff took the trick · 14 points · stolen with a briscola',
    );
    expect(trickText('Jeff', 0, false, true)).toBe(
      'Jeff took the trick · 0 points · briscola taken',
    );
    expect(trickText('Jeff', 22, true, true)).toBe(
      'Jeff took the trick · 22 points · stolen with a briscola · briscola taken',
    );
  });

  test("resultText over a ResultData: the winner first, the pair's verbs, the match suffix, a draw", () => {
    const base = { draw: false, decided: false, wins: [0, 1] };
    expect(resultText(P.slice(0, 2), 2, { ...base, winner: 1, totals: [59, 61] })).toBe(
      'Jeff wins 61–59',
    );
    expect(
      resultText(P.slice(0, 2), 2, { ...base, winner: 1, totals: [59, 61], decided: true }),
    ).toBe('Jeff wins 61–59 and takes the match 1–0');
    expect(
      resultText(P, 4, {
        winner: 1,
        totals: [54, 66, 0, 0],
        draw: false,
        decided: true,
        wins: [1, 2, 0, 0],
      }),
    ).toBe('Jeff wins 66–54–0–0 and takes the match 2–1–0–0');
    expect(
      resultText(P.slice(0, 3), 3, {
        winner: null,
        totals: [45, 45, 30],
        draw: true,
        decided: false,
        wins: [0, 0, 0],
      }),
    ).toBe('A draw, 45–45–30');
  });
});

describe('summaryOf: one line per kind (E18)', () => {
  test.each<[string, GameEvent, string]>([
    [
      'game',
      { id: 0, kind: 'game', seat: null, at: AT, data: { gameNo: 2, dealer: 1 } },
      'Game 2 begins',
    ],
    [
      'deal',
      { id: 1, kind: 'deal', seat: 1, at: AT, data: { dealer: 1, trumpCard: c('CB') } },
      'Jeff dealt · the briscola is the cavallo di bastoni',
    ],
    ['trick', trickEvent(STEAL), 'Jeff took the trick · 11 points · stolen with a briscola'],
    [
      'trick, the trump card taken',
      trickEvent({ ...STEAL, steal: false, trumpTaken: 0 }),
      'Jeff took the trick · 11 points · briscola taken',
    ],
    [
      'exchange',
      { id: 2, kind: 'exchange', seat: 0, at: AT, data: { seat: 0, gave: c('7C'), took: c('AC') } },
      'Ari exchanged the sette di coppe for the asso di coppe',
    ],
    [
      'result',
      {
        id: 9,
        kind: 'result',
        seat: null,
        at: AT,
        data: { winner: 0, totals: [61, 59], draw: false, decided: true, wins: [2, 0] },
      },
      'Ari wins 61–59 and takes the match 2–0',
    ],
  ])('%s', (_kind, event, line) => {
    expect(summaryOf(event, P.slice(0, 2), 2)).toBe(line);
  });
});

describe('detailOf: the expanded rows per kind (E18)', () => {
  test('game and deal: the dealer; the dealer, the card and who leads', () => {
    expect(
      detailOf({ id: 0, kind: 'game', seat: null, at: AT, data: { gameNo: 2, dealer: 1 } }, P, 4),
    ).toEqual([['Dealer', 'Jeff']]);
    expect(
      detailOf(
        { id: 1, kind: 'deal', seat: 2, at: AT, data: { dealer: 2, trumpCard: c('7C') } },
        P.slice(0, 3),
        3,
      ),
    ).toEqual([
      ['Dealer', 'Kim'],
      ['Briscola', 'sette di coppe'],
      ['Leads', 'Ari'],
    ]);
  });

  test('a steal: the cards with the briscola marked, won by X over the Y, the points, stolen from, lost, drew', () => {
    expect(detailOf(trickEvent(STEAL), P.slice(0, 2), 2)).toEqual([
      ['Led', 'Ari · asso di spade'],
      ['Then', 'Jeff · due di coppe (briscola)'],
      ['Won by', 'due di coppe over the asso di spade'],
      ['Points', '11'],
      ['Stolen from', 'Ari'],
      ['Lost', 'Ari · asso di spade'],
      ['Drew', 'Jeff, Ari'],
    ]);
  });

  test('no contender: an off-suit asso gifted to a pip; nothing drawn; the trump card taken', () => {
    const gifted: TrickData = {
      no: 20,
      leader: 0,
      cards: plays('s0:4D s1:AS'),
      winner: 0,
      winnerSide: 0,
      points: 11,
      valueClass: 'big',
      winningCard: c('4D'),
      winningClass: 'pip',
      briscola: false,
      steal: false,
      overtrump: false,
      carichiLost: [1],
      drew: [],
      trumpTaken: null,
    };
    expect(detailOf(trickEvent(gifted), P.slice(0, 2), 2)).toEqual([
      ['Led', 'Ari · quattro di denari'],
      ['Then', 'Jeff · asso di spade'],
      ['Won by', 'quattro di denari'],
      ['Points', '11'],
      ['Lost', 'Jeff · asso di spade'],
    ]);
    expect(
      detailOf(trickEvent({ ...gifted, drew: [0, 1], trumpTaken: 1 }), P.slice(0, 2), 2).slice(-2),
    ).toEqual([
      ['Drew', 'Ari, Jeff'],
      ['Briscola taken by', 'Jeff'],
    ]);
  });

  test("at four: an overtrump over the partner's asso; the opponents' tre is stolen, the partner's asso is not lost", () => {
    const four: TrickData = {
      no: 3,
      leader: 0,
      cards: plays('s0:AC s1:3C s2:4B s3:2B'),
      winner: 2,
      winnerSide: 0,
      points: 21,
      valueClass: 'huge',
      winningCard: c('4B'),
      winningClass: 'pip',
      briscola: true,
      steal: true,
      overtrump: true,
      carichiLost: [1],
      drew: [2, 3, 0, 1],
      trumpTaken: null,
    };
    expect(detailOf(trickEvent(four), P, 4)).toEqual([
      ['Led', 'Ari · asso di coppe'],
      ['Then', 'Jeff · tre di coppe'],
      ['Then', 'Kim · quattro di bastoni (briscola)'],
      ['Then', 'Dan · due di bastoni (briscola)'],
      ['Won by', 'quattro di bastoni over the due di bastoni'],
      ['Points', '21'],
      ['Stolen from', 'Jeff'],
      ['Lost', 'Jeff · tre di coppe'],
      ['Drew', 'Kim, Dan, Ari, Jeff'],
    ]);
  });

  test('exchange and result: the cards swapped; a total per side and the match tally', () => {
    expect(
      detailOf(
        {
          id: 2,
          kind: 'exchange',
          seat: 0,
          at: AT,
          data: { seat: 0, gave: c('2C'), took: c('5C') },
        },
        P.slice(0, 2),
        2,
      ),
    ).toEqual([
      ['Gave', 'due di coppe'],
      ['Took', 'cinque di coppe'],
    ]);
    expect(
      detailOf(
        {
          id: 9,
          kind: 'result',
          seat: null,
          at: AT,
          data: {
            winner: 1,
            totals: [54, 66, 0, 0],
            draw: false,
            decided: false,
            wins: [1, 1, 0, 0],
          },
        },
        P,
        4,
      ),
    ).toEqual([
      ['Ari', '54'],
      ['Jeff', '66'],
      ['Kim', '0'],
      ['Dan', '0'],
      ['Match', 'Ari 1 · Jeff 1 · Kim 0 · Dan 0'],
    ]);
    expect(
      detailOf(
        {
          id: 9,
          kind: 'result',
          seat: null,
          at: AT,
          data: { winner: null, totals: [40, 40, 40], draw: true, decided: false, wins: [0, 0, 0] },
        },
        P.slice(0, 3),
        3,
      ),
    ).toEqual([
      ['Ari', '40'],
      ['Jeff', '40'],
      ['Kim', '40'],
      ['Match', 'Ari 0 · Jeff 0 · Kim 0'],
    ]);
  });
});
