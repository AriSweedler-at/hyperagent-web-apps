// Byte-stable round trips (E20, V5): every state of seeded matches at two, three and four seats
// and every seat's view re-encode to the same JSON text after decoding; and the refusals the
// decoders owe the trust boundary (V6, V7, E3): a card twice, the trump card not under the stock,
// a flag outside its literals, an id outside the grammar, each invariant named in the error.
import { describe, expect, test } from 'vitest';

import { formatError, type DecodeError } from '../../../../shared/lib/json.ts';
import { mulberry32 } from '../../../../shared/lib/rng.ts';
import { actorOf, applyAction } from './apply.ts';
import { cardById } from './cards.ts';
import {
  decodeAction,
  decodeCard,
  decodeOptions,
  decodeSeat,
  decodeState,
  decodeView,
} from './decode.ts';
import { seatsOf } from './seats.ts';
import { createGame } from './setup.ts';
import type { Card, Cards, CreateGameOptions, Players, SeatCount, State } from './types.ts';
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
const viaJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const failureOf = (r: { ok: boolean; error?: DecodeError }): string =>
  r.ok || r.error === undefined ? 'ok' : formatError(r.error);
const c = (id: string): Card => {
  const card = cardById(id);
  if (card === null) throw new Error(`not a card: ${id}`);
  return card;
};
const cs = (ids: string): Cards => ids.split(' ').filter(Boolean).map(c);

/** One seeded match played by a random policy (exchanges at half the offers): the state after every action. */
const trace = (n: SeatCount, seed: number, opts: CreateGameOptions): ReadonlyArray<State> => {
  const rng = mulberry32(seed);
  const pick = mulberry32(seed * 7919);
  const start = createGame(players(n), opts, rng, now);
  // A fixed range stands in for a loop (the repo bans raw loops everywhere); a finished match passes through.
  return Array.from({ length: 2_000 }).reduce<ReadonlyArray<State>>(
    (states) => {
      const s = states.at(-1) ?? start;
      if (s.phase === 'over' && viewFor(s, 0).matchOver) return states;
      const actor = actorOf(s) ?? 0;
      const actions = legalActions(viewFor(s, actor)).filter(
        (a) => a.type !== 'exchange' || pick() < 0.5,
      );
      const action = actions[Math.floor(pick() * actions.length)];
      if (action === undefined) throw new Error(`no action at step ${String(states.length)}`);
      const r = applyAction(s, actor, action, rng, now);
      if (!r.ok) throw new Error(r.error);
      return [...states, r.value];
    },
    [start],
  );
};

describe('decodeState / decodeView round-trip the engine text (V5)', () => {
  test.each([
    [2, 7, { exchange: true, scoperta: true }],
    [3, 3, { exchange: true, removedTwo: 'S' }],
    [4, 11, { exchange: true, partnerPeek: true }],
  ] as const)('%i players, seed %i: every state and every view, byte for byte', (n, seed, opts) => {
    const states = trace(n, seed, opts);
    expect(states.length).toBeGreaterThan(40);
    expect(states.at(-1)?.phase).toBe('over');
    states.forEach((s, i) => {
      const text = JSON.stringify(s);
      const decoded = decodeState(JSON.parse(text));
      expect(failureOf(decoded), `state ${String(i)}`).toBe('ok');
      expect(JSON.stringify(decoded.ok ? decoded.value : null), `state ${String(i)}`).toBe(text);
      seatsOf(n).forEach((seat) => {
        const view = viewFor(s, seat);
        const vtext = JSON.stringify(view);
        const dv = decodeView(JSON.parse(vtext));
        expect(failureOf(dv), `view ${String(i)} seat ${String(seat)}`).toBe('ok');
        expect(JSON.stringify(dv.ok ? dv.value : null)).toBe(vtext);
      });
    });
    // The optional `hand` on another seat appears somewhere in a scoperta or partner-peek match and never as `undefined`.
    const revealed = states.some((s) => viewFor(s, 0).others.some((o) => 'hand' in o));
    expect(revealed).toBe(n !== 3);
  });
});

const base = (): State => createGame(players(2), {}, mulberry32(1), now);

describe('decodeState refuses what the engine never emits (V6, V7, E20)', () => {
  test('V6: the 2C in a hand and in a pile → the multiset is not the deck', () => {
    const s = base();
    const bad = { ...s, piles: [cs('2C'), []] };
    expect(failureOf(decodeState(viaJson(bad)))).toBe(
      '$: expected the deck, every card exactly once across hands, stock, trick and piles',
    );
  });

  test('V7: a stock whose last card is not the trump card', () => {
    const s = base();
    const bad = { ...s, stock: [...s.stock.slice(1), s.stock[0]] };
    expect(failureOf(decodeState(viaJson(bad)))).toBe('$: expected the trump card under the stock');
  });

  test.each([
    ['as many players as seats', (s: State): unknown => ({ ...s, players: [P.a] })],
    ['a hand and a pile per seat', (s: State): unknown => ({ ...s, piles: [[]] })],
    [
      'the dealer, the leader and the turn seated at the table',
      (s: State): unknown => ({ ...s, turn: 2 }),
    ],
    [
      'a trick shorter than the seat count',
      (s: State): unknown => ({
        ...s,
        hands: [s.hands[0]?.slice(1) ?? [], s.hands[1]?.slice(1) ?? []],
        trick: [
          { seat: s.leader, card: s.hands[s.leader]?.[0] },
          { seat: s.turn === 0 ? 1 : 0, card: s.hands[s.turn === 0 ? 1 : 0]?.[0] },
        ],
      }),
    ],
    [
      'piles of whole tricks',
      // One card off the top into a pile: the deck is whole, the pile is not a trick.
      (s: State): unknown => ({ ...s, stock: s.stock.slice(1), piles: [[s.stock[0]], []] }),
    ],
    [
      'a stock of whole draws',
      (s: State): unknown => ({
        ...s,
        hands: [[...(s.hands[0] ?? []), s.stock[0]], s.hands[1]],
        stock: s.stock.slice(1),
      }),
    ],
    [
      'a result exactly when the game is over',
      (s: State): unknown => ({ ...s, result: { winner: 0, totals: [61, 59], draw: false } }),
    ],
    [
      'empty hands once the game is over',
      (s: State): unknown => ({
        ...s,
        phase: 'over',
        result: { winner: 0, totals: [61, 59], draw: false },
      }),
    ],
    ['a win count per side', (s: State): unknown => ({ ...s, match: { ...s.match, wins: [0] } })],
    [
      'a trick led by the leader, the turn after its last card',
      (s: State): unknown => ({
        ...s,
        hands: [s.hands[0]?.slice(1) ?? [], s.hands[1]],
        trick: [{ seat: 0, card: s.hands[0]?.[0] }],
        leader: 1,
        turn: 1,
      }),
    ],
  ])('%s', (expected, mutate) => {
    const r = decodeState(viaJson(mutate(base())));
    expect(failureOf(r)).toBe(`$: expected ${expected}`);
  });

  test('a trump card outside the deck (the removed 2 at three players)', () => {
    const s = createGame(players(3), { removedTwo: 'C' }, mulberry32(2), now);
    const bad = { ...s, trumpCard: c('2C'), stock: [...s.stock.slice(0, -1), c('2C')] };
    // The multiset check fires first: 2C is in the stock but not in the deck, and one card is missing.
    expect(failureOf(decodeState(viaJson(bad)))).toBe(
      '$: expected the deck, every card exactly once across hands, stock, trick and piles',
    );
    const empty = { ...s, stock: [], trumpCard: c('2C'), phase: 'trick' };
    const r = decodeState(viaJson(empty));
    expect(failureOf(r)).toBe(
      '$: expected the deck, every card exactly once across hands, stock, trick and piles',
    );
  });

  test('a card whose id disagrees with its rank and suit, anywhere', () => {
    const s = base();
    const bad = { ...s, trumpCard: { id: 'AC', r: 2, s: 'C' } };
    expect(failureOf(decodeState(viaJson(bad)))).toBe(
      '$.trumpCard: expected a card whose id is its label and suit',
    );
    expect(failureOf(decodeCard({ id: '10B', r: 10, s: 'B' }))).toBe(
      '$: expected a card whose id is its label and suit',
    );
    expect(failureOf(decodeCard({ id: 'AH', r: 1, s: 'H' }))).toBe(
      '$.s: expected one of "C" | "D" | "S" | "B"',
    );
    expect(failureOf(decodeCard({ id: 'AC', r: 11, s: 'C' }))).toBe(
      '$.r: expected one of 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10',
    );
    expect(decodeCard({ id: 'RB', r: 10, s: 'B' })).toEqual({ ok: true, value: c('RB') });
  });

  test('the flags: a seat count, a match length or a suit outside its literals; scoperta at three, the peek at two', () => {
    const o = base().options;
    expect(failureOf(decodeOptions({ ...o, seatCount: 5 }))).toBe(
      '$.seatCount: expected one of 2 | 3 | 4',
    );
    expect(failureOf(decodeOptions({ ...o, gamesToWin: 4 }))).toBe(
      '$.gamesToWin: expected one of 1 | 2 | 3',
    );
    expect(failureOf(decodeOptions({ ...o, removedTwo: 'H' }))).toBe(
      '$.removedTwo: expected one of "C" | "D" | "S" | "B"',
    );
    expect(failureOf(decodeOptions({ ...o, exchange: 'yes' }))).toBe(
      '$.exchange: expected boolean',
    );
    expect(failureOf(decodeOptions({ ...o, seatCount: 3, scoperta: true }))).toBe(
      '$: expected scoperta at two players and the partner peek at four only',
    );
    expect(failureOf(decodeOptions({ ...o, partnerPeek: true }))).toBe(
      '$: expected scoperta at two players and the partner peek at four only',
    );
    expect(decodeOptions({ ...o, seatCount: 4, partnerPeek: true })).toEqual({
      ok: true,
      value: { ...o, seatCount: 4, partnerPeek: true },
    });
    // An unknown flag is dropped, not kept: a state that carried one would not re-encode, so the engine never emits one.
    const extra = decodeOptions({ ...o, cappotto: true });
    expect(extra.ok && !('cappotto' in extra.value)).toBe(true);
  });

  test('the phase, the log kinds and the seats decode as literals', () => {
    const s = base();
    expect(failureOf(decodeState(viaJson({ ...s, phase: 'dealing' })))).toBe(
      '$.phase: expected one of "deal" | "trick" | "draw" | "over"',
    );
    expect(failureOf(decodeState(viaJson({ ...s, log: [{ ...s.log[0], kind: 'hit' }] })))).toBe(
      '$.log[0].kind: expected one of "game" | "deal" | "play" | "trick" | "exchange" | "result"',
    );
    expect(failureOf(decodeSeat(4))).toBe('$: expected one of 0 | 1 | 2 | 3');
    expect(decodeSeat(3)).toEqual({ ok: true, value: 3 });
    expect(failureOf(decodeState('nope'))).toBe('$: expected object');
  });
});

describe('decodeView refuses a view that disagrees with itself', () => {
  const v = (): unknown => viaJson(viewFor(base(), 0));
  const mutate = (patch: Record<string, unknown>): unknown => ({
    ...(v() as Record<string, unknown>),
    ...patch,
  });

  test.each([
    ['the viewer and every other seat, seated at the table', { others: [] }],
    [
      'a trick shorter than the seat count',
      {
        trick: [
          { seat: 0, card: c('AC') },
          { seat: 1, card: c('2C') },
        ],
      },
    ],
    ['a stock of whole draws, the trump card on the table while it lasts', { stockCount: 33 }],
    ['a stock of whole draws, the trump card on the table while it lasts', { trumpOnTable: false }],
    [
      'a result exactly when the game is over',
      { result: { winner: 0, totals: [61, 59], draw: false } },
    ],
    ['a score per seat and per side', { sides: [0, 0, 0] }],
  ])('%s', (expected, patch) => {
    expect(failureOf(decodeView(mutate(patch)))).toBe(`$: expected ${expected}`);
  });

  test('a legal id outside the grammar, a foreign key in me', () => {
    expect(failureOf(decodeView(mutate({ legal: ['ZZ'] })))).toBe('$.legal[0]: expected a card id');
    const r = decodeView(
      mutate({ me: { idx: 0, id: 'a', name: 'Ari', side: 0, hand: [], extra: 1 } }),
    );
    expect(r.ok && !('extra' in r.value.me)).toBe(true);
  });
});

describe('decodeAction (E3, E20)', () => {
  test('play with a card id decodes; outside the grammar it is refused; the type decides the keys', () => {
    expect(decodeAction({ type: 'play', cardId: 'AC' })).toEqual({
      ok: true,
      value: { type: 'play', cardId: 'AC' },
    });
    expect(failureOf(decodeAction({ type: 'play', cardId: 'ZZ' }))).toBe(
      '$.cardId: expected a card id (its label and suit, AC..RB)',
    );
    expect(failureOf(decodeAction({ type: 'play', cardId: '10B' }))).toBe(
      '$.cardId: expected a card id (its label and suit, AC..RB)',
    );
    expect(failureOf(decodeAction({ type: 'play' }))).toBe('$.cardId: expected string');
    expect(decodeAction({ type: 'exchange' })).toEqual({ ok: true, value: { type: 'exchange' } });
    expect(decodeAction({ type: 'next' })).toEqual({ ok: true, value: { type: 'next' } });
    // Extra keys are dropped: an exchange carrying a cardId re-encodes as `{"type":"exchange"}`.
    expect(JSON.stringify(decodeAction({ type: 'exchange', cardId: 'AC' }))).toBe(
      '{"ok":true,"value":{"type":"exchange"}}',
    );
    expect(failureOf(decodeAction({ type: 'undo' }))).toBe(
      '$.type: expected one of "play" | "exchange" | "next"',
    );
    expect(failureOf(decodeAction(null))).toBe('$: expected object');
  });
});
