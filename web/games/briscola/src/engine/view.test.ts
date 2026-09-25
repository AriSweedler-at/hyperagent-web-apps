// The per-seat view over the table rows V1-V4 and V8 of docs/design/briscola-rules.md §2.3 (E15-E17,
// D21): the viewer's own hand, counts for the others, no piles and no stock, the running score,
// scoperta's and the partner peek's reveals, `legal` for the actor alone, `others` in play order.
import { describe, expect, test } from 'vitest';

import { mulberry32 } from '../../../../shared/lib/rng.ts';
import { applyAction } from './apply.ts';
import { cardById, idsOf } from './cards.ts';
import { seatsOf } from './seats.ts';
import { createGame, withPosition } from './setup.ts';
import type { Card, Cards, CreateGameOptions, Players, Seat, SeatCount, State } from './types.ts';
import { legalActions, viewFor } from './view.ts';

const P = {
  a: { id: 'a', name: 'Ari' },
  b: { id: 'b', name: 'Jeff' },
  c: { id: 'c', name: 'Kim' },
  d: { id: 'd', name: 'Dan' },
} as const;
const players = (n: SeatCount): Players =>
  n === 2 ? [P.a, P.b] : n === 3 ? [P.a, P.b, P.c] : [P.a, P.b, P.c, P.d];
const now = (): number => 1_700_000_000_000;
const c = (id: string): Card => {
  const card = cardById(id);
  if (card === null) throw new Error(`not a card: ${id}`);
  return card;
};
const cs = (ids: string): Cards => ids.split(' ').filter(Boolean).map(c);
const game = (n: SeatCount, opts: CreateGameOptions = {}): State =>
  createGame(players(n), opts, mulberry32(1), now);
const at = (
  n: SeatCount,
  hands: ReadonlyArray<string>,
  stock: string,
  trump: string,
  leader: Seat = 0,
  opts: CreateGameOptions = {},
): State => withPosition(game(n, opts), hands.map(cs), cs(stock), c(trump), leader);
const must = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

/** The View's keys in wire order (types.ts); decode.ts declares the same, so a frame re-encodes byte for byte. */
const VIEW_KEYS = [
  'me',
  'others',
  'players',
  'options',
  'gameNo',
  'phase',
  'dealer',
  'leader',
  'turn',
  'actor',
  'isMyTurn',
  'trumpCard',
  'trumpOnTable',
  'stockCount',
  'stockTop',
  'trick',
  'legal',
  'canExchange',
  'exchanges',
  'taken',
  'tricks',
  'sides',
  'trickNo',
  'lastTrick',
  'match',
  'matchOver',
  'result',
  'games',
  'log',
  'lastAction',
  'startedAt',
  'endedAt',
];

describe('viewFor (V1-V4, V8)', () => {
  test('V1: n2 mid-game, seat 0: own hand, the other as a count, no piles, no stock, the running score', () => {
    const s0 = at(2, ['AS 3D 7C', 'RB 2C 5S'], '5D 6D 7D FD 4C', '4C');
    const s = must(applyAction(s0, 0, { type: 'play', cardId: 'AS' }, () => 0, now));
    const v = viewFor(s, 0);
    expect(v.me).toEqual({ idx: 0, id: 'a', name: 'Ari', side: 0, hand: cs('3D 7C') });
    expect(v.others).toEqual([{ idx: 1, id: 'b', name: 'Jeff', side: 1, handCount: 3 }]);
    expect(v.others[0]).not.toHaveProperty('hand');
    expect(v).not.toHaveProperty('piles');
    expect(v).not.toHaveProperty('stock');
    expect(v).not.toHaveProperty('hands');
    expect(v.stockCount).toBe(s.stock.length);
    expect(v.stockTop).toBeNull();
    expect(v.trumpOnTable).toBe(true);
    expect(v.taken).toEqual([0, 0]);
    expect(v.tricks).toEqual([0, 0]);
    expect(v.sides).toEqual([0, 0]);
    expect(v.trick).toEqual([{ seat: 0, card: c('AS') }]);
    expect(v.actor).toBe(1);
    expect(v.isMyTurn).toBe(false);
    expect(v.legal).toEqual([]);
    expect(v.lastAction?.text).toBe('Ari led the asso di spade');
    expect(Object.keys(v)).toEqual(VIEW_KEYS);
    expect(Object.keys(v.me)).toEqual(['idx', 'id', 'name', 'side', 'hand']);
    expect(Object.keys(v.others[0] ?? {})).toEqual(['idx', 'id', 'name', 'side', 'handCount']);
  });

  test('V2: n2 scoperta, stock [x y T]: the other hand and the top of the stock are public; stock [T] → stockTop null', () => {
    const s = at(2, ['AS 3D 7C', 'RB 2C 5S'], '5D 6D 4C', '4C', 0, { scoperta: true });
    const v = viewFor(s, 0);
    expect(v.others[0]?.hand).toEqual(cs('RB 2C 5S'));
    expect(v.stockTop).toEqual(c('5D'));
    expect(Object.keys(v.others[0] ?? {})).toEqual([
      'idx',
      'id',
      'name',
      'side',
      'handCount',
      'hand',
    ]);
    // The other seat sees mine too (scoperta is symmetric).
    expect(viewFor(s, 1).others[0]?.hand).toEqual(cs('AS 3D 7C'));
    const last = { ...s, stock: cs('4C') };
    expect(viewFor(last, 0).stockTop).toBeNull();
    expect(viewFor(last, 0).trumpOnTable).toBe(true);
    expect(viewFor({ ...s, stock: [] }, 0).stockTop).toBeNull();
    // Off, nothing shows.
    expect(viewFor(at(2, ['AS 3D 7C', 'RB 2C 5S'], '5D 6D 4C', '4C'), 0).stockTop).toBeNull();
  });

  test("V3: n4 partnerPeek, stock []: seat 1 sees seats 2, 3, 0 in that order and only seat 3's hand; with a stock, none", () => {
    const hands = ['AS 3D', 'RB 2C', '5S 6S', '7S FS'];
    const s = at(4, hands, '', '4C', 1, { partnerPeek: true });
    const v = viewFor(s, 1);
    expect(v.others.map((o) => o.idx)).toEqual([2, 3, 0]);
    expect(v.others.map((o) => 'hand' in o)).toEqual([false, true, false]);
    expect(v.others[1]?.hand).toEqual(cs('7S FS'));
    expect(v.others.map((o) => o.side)).toEqual([0, 1, 0]);
    expect(v.me.side).toBe(1);
    // Seat 3 sees seat 1's in return; the opponents see no hand.
    expect(viewFor(s, 3).others.find((o) => o.idx === 1)?.hand).toEqual(cs('RB 2C'));
    expect(viewFor(s, 0).others.every((o) => !('hand' in o))).toBe(false);
    expect(viewFor(s, 0).others.find((o) => o.idx === 2)?.hand).toEqual(cs('5S 6S'));
    expect(viewFor(s, 0).others.find((o) => o.idx === 1)).not.toHaveProperty('hand');
    // With cards in the stock nobody peeks.
    const early = at(4, hands, '5D 6D 7D 4C', '4C', 1, { partnerPeek: true });
    expect(viewFor(early, 1).others.every((o) => !('hand' in o))).toBe(true);
    // Off, nothing shows even with the stock out.
    expect(viewFor(at(4, hands, '', '4C', 1), 1).others.every((o) => !('hand' in o))).toBe(true);
  });

  test("V4: n4, seat 2's turn: legal is seat 2's hand, empty for the others, actor 2", () => {
    const s = at(4, ['AS 3D', 'RB 2C', '5S 6S', '7S FS'], '5D 6D 7D 4C', '4C', 2);
    expect(viewFor(s, 2).legal).toEqual(['5S', '6S']);
    expect(viewFor(s, 2).isMyTurn).toBe(true);
    expect(viewFor(s, 0).legal).toEqual([]);
    expect(viewFor(s, 1).legal).toEqual([]);
    expect(viewFor(s, 3).legal).toEqual([]);
    seatsOf(4).forEach((seat) => {
      expect(viewFor(s, seat).actor).toBe(2);
    });
    expect(legalActions(viewFor(s, 0))).toEqual([]);
  });

  test('V8: n3 over [50, 40, 30]: sides has three entries; n4 gives two', () => {
    const three: State = {
      ...game(3),
      phase: 'over',
      hands: [[], [], []],
      piles: [cs('AC AD AS AB CC CD'), cs('3C 3D 3S 3B'), cs('RC RD RS RB CS CB FC FD FS FB')],
      result: { winner: 0, totals: [50, 40, 30], draw: false },
    };
    const v = viewFor(three, 1);
    expect(v.sides).toEqual([50, 40, 30]);
    expect(v.taken).toEqual([50, 40, 30]);
    expect(v.tricks).toEqual([2, 4 / 3, 10 / 3]);
    expect(v.actor).toBeNull();
    expect(v.isMyTurn).toBe(false);
    expect(legalActions(v)).toEqual([{ type: 'next' }]);
    const four = { ...game(4), piles: [cs('AD'), cs('AS'), cs('3C'), cs('RC')] };
    expect(viewFor(four, 0).sides).toEqual([21, 15]);
    expect(viewFor(four, 0).taken).toEqual([11, 11, 10, 4]);
  });

  test('others runs in play order from every viewer, at three and at four', () => {
    expect(viewFor(game(3), 0).others.map((o) => o.idx)).toEqual([1, 2]);
    expect(viewFor(game(3), 1).others.map((o) => o.idx)).toEqual([2, 0]);
    expect(viewFor(game(3), 2).others.map((o) => o.idx)).toEqual([0, 1]);
    expect(viewFor(game(4), 3).others.map((o) => o.idx)).toEqual([0, 1, 2]);
    expect(viewFor(game(2), 1).others.map((o) => o.idx)).toEqual([0]);
  });

  test('every seat agrees on the public fields and sees its own hand', () => {
    const s = game(4, { exchange: true });
    const views = seatsOf(4).map((seat) => viewFor(s, seat));
    views.forEach((v, seat) => {
      expect(v.me.idx).toBe(seat);
      expect(v.me.hand).toEqual(s.hands[seat]);
      expect(v.others.map((o) => o.handCount)).toEqual([3, 3, 3]);
      expect(v.trumpCard).toEqual(s.trumpCard);
      expect(v.stockCount).toBe(28);
      expect(v.trumpOnTable).toBe(true);
      expect(v.match).toEqual(s.match);
      expect(v.matchOver).toBe(false);
      expect(v.log).toEqual(s.log);
      expect(v.players).toEqual(s.players);
      expect(v.options).toEqual(s.options);
      expect(v.canExchange).toBe(false);
      expect(idsOf(v.me.hand)).toEqual(v.isMyTurn ? v.legal : idsOf(v.me.hand));
    });
    expect(views.filter((v) => v.legal.length > 0)).toHaveLength(1);
  });
});
