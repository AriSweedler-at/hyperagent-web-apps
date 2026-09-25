// The reducer over the table positions of docs/design/briscola-rules.md §2.2-2.3: the tricks and
// who leads (T), the deal (D), the draw (W), the results (S), the match (M), the exchange (X) and
// the refusals (E), every MESSAGES entry reachable. Positions are seated with `withPosition`
// unless a row says `createGame`; the rng is `mulberry32(seed)` or a constant stub.
import { describe, expect, test } from 'vitest';

import { mulberry32, type Rng } from '../../../../shared/lib/rng.ts';
import { shuffle } from '../../../../shared/lib/shuffle.ts';
import { actorOf, applyAction, canExchange, MESSAGES } from './apply.ts';
import { cardById, deckFor, idsOf, pointsOf } from './cards.ts';
import { playText, summaryOf } from './log.ts';
import { matchOver, matchWinner } from './score.ts';
import { nextSeat, seatsOf } from './seats.ts';
import {
  createGame,
  drawDealer,
  nextGame,
  normaliseOptions,
  replayGame,
  withPosition,
} from './setup.ts';
import type {
  Action,
  Card,
  Cards,
  CreateGameOptions,
  Players,
  Seat,
  SeatCount,
  State,
  TrickData,
} from './types.ts';
import { lastPlayed, legalActions, viewFor } from './view.ts';

const P = {
  a: { id: 'a', name: 'Ari' },
  b: { id: 'b', name: 'Jeff' },
  c: { id: 'c', name: 'Kim' },
  d: { id: 'd', name: 'Dan' },
} as const;
const players = (n: SeatCount): Players =>
  n === 2 ? [P.a, P.b] : n === 3 ? [P.a, P.b, P.c] : [P.a, P.b, P.c, P.d];
const NOW = 1_700_000_000_000;
const now = (): number => NOW;
/** Counts the calls so a test can pin how often the engine reads the rng. */
const counting = (inner: Rng): Rng & { calls: () => number } => {
  let n = 0;
  const rng = (): number => {
    n += 1;
    return inner();
  };
  return Object.assign(rng, { calls: () => n });
};
const c = (id: string): Card => {
  const card = cardById(id);
  if (card === null) throw new Error(`not a card: ${id}`);
  return card;
};
/** `'AS 3D 7C'` -> the cards; `''` -> none. */
const cs = (ids: string): Cards => ids.split(' ').filter(Boolean).map(c);
const must = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const fail = (r: { ok: boolean; error?: string }): string => (r.ok ? 'ok' : (r.error ?? ''));
const apply = (
  s: State,
  seat: Seat,
  action: Action,
  rng: Rng = () => 0,
): ReturnType<typeof applyAction> => applyAction(s, seat, action, rng, now);
const play = (s: State, seat: Seat, id: string): ReturnType<typeof applyAction> =>
  apply(s, seat, { type: 'play', cardId: id });
/** Plays in order, each must be accepted. */
const plays = (s: State, moves: ReadonlyArray<readonly [Seat, string]>): State =>
  moves.reduce((st, [seat, id]) => must(play(st, seat, id)), s);
const game = (n: SeatCount, opts: CreateGameOptions = {}, rng: Rng = mulberry32(1)): State =>
  createGame(players(n), opts, rng, now);

type Position = Readonly<{
  hands: ReadonlyArray<string>;
  /** The stock as the state holds it: top first, the trump card last while on the table. */
  stock: string;
  trump: string;
  leader?: Seat;
  opts?: CreateGameOptions;
  piles?: ReadonlyArray<string>;
}>;
/** A seated position over a fresh game's frame (the match, the log and the tally are the game's). */
const at = (n: SeatCount, pos: Position): State => {
  const base = withPosition(
    game(n, pos.opts),
    pos.hands.map(cs),
    cs(pos.stock),
    c(pos.trump),
    pos.leader ?? 0,
  );
  return pos.piles === undefined ? base : { ...base, piles: pos.piles.map(cs) };
};
const FILLERS = '5D 6D 7D FD';
/**
 * `'s0:AS s1:2C'`: each seat holds the one card it plays, the stock holds n filler cards over the
 * 4 of trumps (so the draw refills the hands and the game goes on), and the first seat leads.
 */
const trick = (n: SeatCount, trump: 'C' | 'D' | 'S' | 'B', text: string): State => {
  const moves = text.split(' ').map((token) => {
    const [seat, id] = token.split(':');
    return [Number(seat?.slice(1)) as Seat, id ?? ''] as const;
  });
  const hands = seatsOf(n).map((seat) => moves.find(([s]) => s === seat)?.[1] ?? '');
  const stock = `${FILLERS.split(' ').slice(0, n).join(' ')} 4${trump}`;
  const leader = moves[0]?.[0] ?? 0;
  return plays(at(n, { hands, stock, trump: `4${trump}`, leader }), moves);
};
/** Every event's history line (E18): the sentences are derived, never stored. */
const texts = (s: State): ReadonlyArray<string> =>
  s.events.map((e) => summaryOf(e, s.players, s.options.seatCount));
/** The last event's kind. */
const lastKind = (s: State): string | undefined => s.events.at(-1)?.kind;
/** The data of the last trick event, which the position must have made. */
const trickData = (s: State): TrickData => {
  const e = s.events.at(-1);
  if (e?.kind !== 'trick') throw new Error(`no trick event: ${String(e?.kind)}`);
  return e.data;
};
/** The dealt deck the engine saw: the dealer draw, then the shuffle from the same stream. */
const dealtDeck = (n: SeatCount, seed: number, opts: CreateGameOptions = {}): Cards => {
  const rng = mulberry32(seed);
  drawDealer(n, rng);
  return shuffle(deckFor(normaliseOptions(n, opts)), rng);
};

describe('tricks (T1-T12): the winner takes, draws first and leads', () => {
  test.each([
    ['T1', 2, 'C', 's0:AS s1:2C', 1, 11],
    ['T2', 2, 'C', 's0:3D s1:AD', 1, 21],
    ['T3', 2, 'C', 's0:3D s1:AS', 0, 21],
    ['T4', 2, 'C', 's0:7C s1:FC', 1, 2],
    ['T5', 2, 'C', 's0:RC s1:3C', 1, 14],
    ['T6', 2, 'C', 's0:2B s1:4B', 1, 0],
    ['T7', 4, 'C', 's0:2D s1:4D s2:AC s3:3C', 2, 21],
    ['T8', 4, 'C', 's1:5B s2:6B s3:7B s0:4B', 3, 0],
    ['T9', 3, 'C', 's0:2S s1:AD s2:3S', 2, 21],
    ['T10', 3, 'B', 's2:AS s0:2B s1:AB', 1, 22],
  ] as const)('%s: %s players, T=%s, %s', (_row, n, trump, text, winner, points) => {
    const s = trick(n, trump, text);
    expect(s.lastTrick).toMatchObject({ no: 1, winner, points, trumpTaken: false });
    expect(s.lastTrick?.cards.map((p) => p.card.id)).toEqual(
      text.split(' ').map((t) => t.split(':')[1]),
    );
    expect(s.leader).toBe(winner);
    expect(s.turn).toBe(winner);
    expect(s.trick).toEqual([]);
    expect(s.trickNo).toBe(1);
    expect(pointsOf(s.piles[winner] ?? [])).toBe(points);
    expect(s.piles.filter((_, seat) => seat !== winner).every((pile) => pile.length === 0)).toBe(
      true,
    );
    expect(lastKind(s)).toBe('trick');
    expect(trickData(s)).toMatchObject({ no: 1, winner, points, trumpTaken: null });
  });

  test('T7: the 21 points sit in piles[2] and side 2 (the seat itself) reads 21 in every view', () => {
    const s = trick(4, 'C', 's0:2D s1:4D s2:AC s3:3C');
    expect(pointsOf(s.piles[2] ?? [])).toBe(21);
    seatsOf(4).forEach((seat) => {
      expect(viewFor(s, seat).sides).toEqual([0, 0, 21, 0]);
      expect(viewFor(s, seat).taken).toEqual([0, 0, 21, 0]);
    });
  });

  test('T8: the leader was seat 1; the winner 3 leads next (E11)', () => {
    const s = trick(4, 'C', 's1:5B s2:6B s3:7B s0:4B');
    expect(s.lastTrick?.leader).toBe(1);
    expect([s.leader, s.turn]).toEqual([3, 3]);
  });

  test('T10: with cards in the stock the draw starts at the winner: drew = [1, 2, 0]', () => {
    const s = trick(3, 'B', 's2:AS s0:2B s1:AB');
    expect(s.lastTrick?.drew).toEqual([1, 2, 0]);
  });

  test('T11: after T1 seat 1 leads an empty trick; the trick line reads Jeff took the trick · 11 points · stolen with a briscola', () => {
    const s = trick(2, 'C', 's0:AS s1:2C');
    expect([s.leader, s.turn]).toEqual([1, 1]);
    expect(s.trick).toEqual([]);
    expect(s.lastTrick?.no).toBe(1);
    // The 2 of trumps took the led asso: a steal, and the summary says so (design §4, §6).
    expect(texts(s).at(-1)).toBe('Jeff took the trick · 11 points · stolen with a briscola');
    expect(texts(trick(2, 'C', 's0:4S s1:2C')).at(-1)).toBe('Jeff took the trick · 0 points');
    expect(lastPlayed(s)).toEqual({ seat: 1, card: c('2C') });
  });

  test('T12: no obligation to follow suit: legal is the whole hand (E6)', () => {
    const s = must(
      play(at(2, { hands: ['AS 2D 3B', '2C 3D 7S'], stock: '5D 6D 4C', trump: '4C' }), 0, 'AS'),
    );
    expect(viewFor(s, 1).legal).toEqual(['2C', '3D', '7S']);
    expect(viewFor(s, 0).legal).toEqual([]);
    expect(legalActions(viewFor(s, 1))).toEqual([
      { type: 'play', cardId: '2C' },
      { type: 'play', cardId: '3D' },
      { type: 'play', cardId: '7S' },
    ]);
    // Mid-trick nothing is recorded; the card led is on the table, `lastPlayed` names it (E6).
    expect(s.events).toHaveLength(1);
    expect(lastPlayed(s)).toEqual({ seat: 0, card: c('AS') });
    expect(s.trick).toEqual([{ seat: 0, card: c('AS') }]);
    expect(s.turn).toBe(1);
    const t = must(play(s, 1, '3D'));
    expect(lastKind(t)).toBe('trick');
    expect(t.events).toHaveLength(2);
  });

  test('a follower\'s status reads "played", the leader\'s "led" (playText over lastPlayed)', () => {
    const s = at(3, { hands: ['AS 2D', '2C 3D', '7S FB'], stock: '5D 6D 7D 4C', trump: '4C' });
    const s1 = must(play(s, 0, '2D'));
    const led = lastPlayed(s1);
    expect(led).toEqual({ seat: 0, card: c('2D') });
    expect(playText('Ari', c('2D'), s1.trick.length === 1)).toBe('Ari led the due di denari');
    const s2 = must(play(s1, 1, '3D'));
    expect(lastPlayed(s2)).toEqual({ seat: 1, card: c('3D') });
    expect(playText('Jeff', c('3D'), s2.trick.length === 1)).toBe('Jeff played the tre di denari');
    expect(s2.turn).toBe(2);
    expect(s2.events).toHaveLength(1);
  });
});

describe('trick events (F1-F6): the facts of the trick, once, on the event', () => {
  const NO_FLAGS = { briscola: false, steal: false, overtrump: false, carichiLost: [] };

  test('F1 steal: the led asso di coppe taken by the 2 di bastoni, bastoni trump; Ari lost his asso', () => {
    const s = trick(2, 'B', 's0:AC s1:2B');
    expect(s.events.at(-1)).toEqual({
      id: 1,
      kind: 'trick',
      seat: 1,
      at: NOW,
      data: {
        no: 1,
        leader: 0,
        cards: [
          { seat: 0, card: c('AC') },
          { seat: 1, card: c('2B') },
        ],
        winner: 1,
        winnerSide: 1,
        points: 11,
        valueClass: 'big',
        winningCard: c('2B'),
        winningClass: 'pip',
        briscola: true,
        steal: true,
        overtrump: false,
        carichiLost: [0],
        drew: [1, 0],
        trumpTaken: null,
      },
    });
    expect(texts(s).at(-1)).toBe('Jeff took the trick · 11 points · stolen with a briscola');
  });

  test('F2 overtrump: the asso di bastoni over the 4 di bastoni; no steal in the trump suit, no carico lost', () => {
    expect(trickData(trick(2, 'B', 's0:4B s1:AB'))).toMatchObject({
      winner: 1,
      points: 11,
      valueClass: 'big',
      winningCard: c('AB'),
      winningClass: 'asso',
      briscola: true,
      steal: false,
      overtrump: true,
      carichiLost: [],
    });
  });

  test('F3 carico lost without a briscola: the asso over the tre in the led suit, 21 points, huge', () => {
    expect(trickData(trick(2, 'C', 's0:3D s1:AD'))).toMatchObject({
      ...NO_FLAGS,
      winner: 1,
      points: 21,
      valueClass: 'huge',
      winningCard: c('AD'),
      winningClass: 'asso',
      carichiLost: [0],
    });
  });

  test('F4 the pointless trick of four pips: the sei di denari takes nothing, and the line says 0 points', () => {
    const s = trick(4, 'C', 's0:2D s1:4D s2:5D s3:6D');
    expect(trickData(s)).toMatchObject({
      ...NO_FLAGS,
      winner: 3,
      winnerSide: 3,
      points: 0,
      valueClass: 'pointless',
      winningCard: c('6D'),
      winningClass: 'pip',
    });
    expect(texts(s).at(-1)).toBe('Dan took the trick · 0 points');
  });

  test('F5 the 22-point trick (T10): a steal and an overtrump at once, huge, Kim lost the asso di spade', () => {
    const s = trick(3, 'B', 's2:AS s0:2B s1:AB');
    expect(trickData(s)).toMatchObject({
      leader: 2,
      winner: 1,
      points: 22,
      valueClass: 'huge',
      winningCard: c('AB'),
      winningClass: 'asso',
      briscola: true,
      steal: true,
      overtrump: true,
      carichiLost: [2],
      drew: [1, 2, 0],
    });
    expect(texts(s).at(-1)).toBe('Jeff took the trick · 22 points · stolen with a briscola');
  });

  test("F6 steal at three and at four: every other seat's carichi are lost (no partners at four)", () => {
    expect(trickData(trick(3, 'B', 's0:AC s1:5C s2:2B'))).toMatchObject({
      winner: 2,
      steal: true,
      carichiLost: [0],
      valueClass: 'big',
    });
    // Seat 2 trumps: Ari's asso and Jeff's tre are both stolen (a free-for-all: nobody is a partner).
    const four = trick(4, 'B', 's0:AC s1:3C s2:2B s3:5D');
    expect(trickData(four)).toMatchObject({
      winner: 2,
      winnerSide: 2,
      points: 21,
      valueClass: 'huge',
      steal: true,
      overtrump: false,
      carichiLost: [0, 1],
    });
    expect(texts(four).at(-1)).toBe('Kim took the trick · 21 points · stolen with a briscola');
    // A trump over an asso and two pips: the asso is anyone else's, so it is stolen.
    expect(trickData(trick(4, 'B', 's0:AC s1:5D s2:2B s3:6D'))).toMatchObject({
      briscola: true,
      steal: true,
      carichiLost: [0],
    });
  });

  test('the trump card taken at the last draw sits on the event as the seat that took it', () => {
    const s0 = at(3, { hands: ['2D', '3D', 'AD'], stock: '5S 6S 4C', trump: '4C' });
    const s = plays(s0, [
      [0, '2D'],
      [1, '3D'],
      [2, 'AD'],
    ]);
    expect(trickData(s)).toMatchObject({ winner: 2, drew: [2, 0, 1], trumpTaken: 1 });
    expect(texts(s).at(-1)).toBe('Kim took the trick · 21 points · briscola taken');
  });
});

describe('the deal (D1-D7)', () => {
  test('D1: createGame n2 seed 1: three to the leader, three to the dealer, the trump card under a stock of 34', () => {
    const s = game(2, {}, mulberry32(1));
    const deck = dealtDeck(2, 1);
    const leader = nextSeat(2, s.dealer);
    expect(s.leader).toBe(leader);
    expect(s.turn).toBe(leader);
    expect(s.phase).toBe('trick');
    expect(s.hands[leader]).toEqual(deck.slice(0, 3));
    expect(s.hands[s.dealer]).toEqual(deck.slice(3, 6));
    expect(s.trumpCard).toEqual(deck[6]);
    expect(s.stock).toHaveLength(34);
    expect(s.stock.at(-1)?.id).toBe(s.trumpCard.id);
    expect(s.stock.slice(0, -1)).toEqual(deck.slice(7));
    expect(s.trick).toEqual([]);
    expect(s.piles).toEqual([[], []]);
    expect(s.trickNo).toBe(0);
    expect(s.lastTrick).toBeNull();
    expect(s.exchanges).toEqual([]);
    expect(s.gameNo).toBe(1);
    expect(s.match).toEqual({ gamesToWin: 2, wins: [0, 0], draws: 0 });
    expect(s.result).toBeNull();
    expect(s.games).toEqual([]);
    expect(s.startedAt).toBe(NOW);
    expect(s.endedAt).toBeNull();
    expect(s.events).toEqual([
      {
        id: 0,
        kind: 'deal',
        seat: s.dealer,
        at: NOW,
        data: { dealer: s.dealer, trumpCard: s.trumpCard },
      },
    ]);
    expect(texts(s)[0]).toMatch(/^(Ari|Jeff) dealt · the briscola is the /);
  });

  test('D2: n3 removedTwo C: 39 cards, no 2C anywhere, a stock of 30, 120 points', () => {
    const s = game(3, { removedTwo: 'C' });
    const all = [...s.hands.flat(), ...s.stock, ...s.piles.flat()];
    expect(all).toHaveLength(39);
    expect(idsOf(all)).not.toContain('2C');
    expect(new Set(idsOf(all)).size).toBe(39);
    expect(s.stock).toHaveLength(30);
    expect(pointsOf(all)).toBe(120);
    expect(s.options).toEqual({
      seatCount: 3,
      gamesToWin: 2,
      removedTwo: 'C',
      exchange: false,
      scoperta: false,
      partnerPeek: false,
    });
  });

  test('D3: n3 removedTwo S: 2S absent, 2C present', () => {
    const s = game(3, { removedTwo: 'S' });
    const ids = idsOf([...s.hands.flat(), ...s.stock]);
    expect(ids).not.toContain('2S');
    expect(ids).toContain('2C');
  });

  test('D4: n4 seed 7: four hands of three, a stock of 28, the leader first and the dealer last', () => {
    const s = game(4, {}, mulberry32(7));
    const deck = dealtDeck(4, 7);
    expect(s.hands.map((h) => h.length)).toEqual([3, 3, 3, 3]);
    expect(s.stock).toHaveLength(28);
    expect(s.hands[nextSeat(4, s.dealer)]).toEqual(deck.slice(0, 3));
    expect(s.hands[s.dealer]).toEqual(deck.slice(9, 12));
    expect(s.trumpCard).toEqual(deck[12]);
    expect(s.match.wins).toEqual([0, 0, 0, 0]);
    expect(s.piles).toEqual([[], [], [], []]);
  });

  test.each([
    [2, 40],
    [3, 39],
    [4, 40],
  ] as const)('D5: createGame with %i players reads the rng %i times (E19)', (n, calls) => {
    const rng = counting(mulberry32(5));
    game(n, {}, rng);
    expect(rng.calls()).toBe(calls);
  });

  test('D8: the dealer of game 1 is one rng draw, min(n − 1, floor(rng × n))', () => {
    expect(drawDealer(3, () => 0)).toBe(0);
    expect(drawDealer(3, () => 0.34)).toBe(1);
    expect(drawDealer(3, () => 0.999)).toBe(2);
    expect(drawDealer(2, () => 0.5)).toBe(1);
    expect(drawDealer(4, () => 0.76)).toBe(3);
    // A stuck rng at 1 is clamped to the last seat.
    expect(drawDealer(4, () => 1)).toBe(3);
  });

  test('D6: next at over with the match on: the dealer rotates, the leader follows, 38 rng calls at three, Game 2 begins then the deal', () => {
    const over: State = {
      ...game(3, {}),
      phase: 'over',
      dealer: 1,
      hands: [[], [], []],
      result: { winner: 0, totals: [61, 30, 29], draw: false },
      match: { gamesToWin: 2, wins: [1, 0, 0], draws: 0 },
      endedAt: NOW,
    };
    const rng = counting(mulberry32(6));
    const s = must(apply(over, 2, { type: 'next' }, rng));
    expect(rng.calls()).toBe(38);
    expect(s.dealer).toBe(2);
    expect([s.leader, s.turn]).toEqual([0, 0]);
    expect(s.gameNo).toBe(2);
    expect(s.match).toEqual({ gamesToWin: 2, wins: [1, 0, 0], draws: 0 });
    // The stream runs across the match: game 1's deal, then game 2 announces itself and deals.
    expect(s.events.map((e) => e.kind)).toEqual(['deal', 'game', 'deal']);
    expect(s.events.map((e) => e.id)).toEqual([0, 1, 2]);
    expect(s.events[1]).toEqual({
      id: 1,
      kind: 'game',
      seat: null,
      at: NOW,
      data: { gameNo: 2, dealer: 2 },
    });
    expect(s.events[2]).toMatchObject({ kind: 'deal', seat: 2, data: { dealer: 2 } });
    expect(texts(s)[1]).toBe('Game 2 begins');
    expect(texts(s)[2]).toMatch(/^Kim dealt · the briscola is the /);
    expect(s.phase).toBe('trick');
    expect(s.result).toBeNull();
    expect(s.trickNo).toBe(0);
    expect(s.exchanges).toEqual([]);
    expect(s.stock).toHaveLength(30);
    // nextGame is what `next` calls; the same stream gives the same deal.
    expect(nextGame(over, counting(mulberry32(6)), now)).toEqual(s);
  });

  test('replayGame: a new match for the same table after a decided one, the dealer passed on, the tally and the stream fresh, no rng read for the dealer', () => {
    const over: State = {
      ...game(3, { gamesToWin: 1 }),
      phase: 'over',
      dealer: 1,
      hands: [[], [], []],
      result: { winner: 0, totals: [61, 30, 29], draw: false },
      match: { gamesToWin: 1, wins: [1, 0, 0], draws: 0 },
      games: [{ gameNo: 1, dealer: 1, trump: 'S', winner: 0, totals: [61, 30, 29], endedAt: NOW }],
      endedAt: NOW,
    };
    const rng = counting(mulberry32(6));
    const s = replayGame(over, rng, now);
    // The shuffle alone: 38 cards at three (E19), the dealer taken from the finished game.
    expect(rng.calls()).toBe(38);
    expect(s.dealer).toBe(2);
    expect([s.leader, s.turn]).toEqual([0, 0]);
    expect(s.gameNo).toBe(1);
    expect(s.players).toBe(over.players);
    expect(s.options).toBe(over.options);
    expect(s.match).toEqual({ gamesToWin: 1, wins: [0, 0, 0], draws: 0 });
    expect(s.games).toEqual([]);
    expect(s.events.map((e) => e.kind)).toEqual(['deal']);
    expect(s.events[0]).toMatchObject({ id: 0, kind: 'deal', seat: 2, data: { dealer: 2 } });
    expect(s.phase).toBe('trick');
    expect(s.result).toBeNull();
    expect(s.stock).toHaveLength(30);
    // The seat after the last one wraps to the first.
    expect(replayGame({ ...over, dealer: 2 }, mulberry32(1), now).dealer).toBe(0);
  });

  test('D7: scoperta is stored false at three and four seats, kept at two; the partner peek the other way round (E15, E16)', () => {
    expect(game(3, { scoperta: true }).options.scoperta).toBe(false);
    expect(game(4, { scoperta: true }).options.scoperta).toBe(false);
    expect(game(2, { scoperta: true }).options.scoperta).toBe(true);
    expect(game(2, { partnerPeek: true }).options.partnerPeek).toBe(false);
    expect(game(3, { partnerPeek: true }).options.partnerPeek).toBe(false);
    expect(game(4, { partnerPeek: true }).options.partnerPeek).toBe(true);
    expect(game(2, { gamesToWin: 3, exchange: true, removedTwo: 'B' }).options).toEqual({
      seatCount: 2,
      gamesToWin: 3,
      removedTwo: 'B',
      exchange: true,
      scoperta: false,
      partnerPeek: false,
    });
  });
});

describe('the draw (W1-W6)', () => {
  test('W1: n2, stock [x y … T], seat 1 wins: 1 gets x, 0 gets y, drew [1, 0], the trump card stays', () => {
    const s0 = at(2, { hands: ['AS 2D 3B', '2C 3D 7S'], stock: '5D 6D 7D FD 4C', trump: '4C' });
    const s = plays(s0, [
      [0, 'AS'],
      [1, '2C'],
    ]);
    expect(s.hands[1]).toEqual(cs('3D 7S 5D'));
    expect(s.hands[0]).toEqual(cs('2D 3B 6D'));
    expect(s.lastTrick?.drew).toEqual([1, 0]);
    expect(s.lastTrick?.trumpTaken).toBe(false);
    expect(s.stock).toEqual(cs('7D FD 4C'));
    expect(viewFor(s, 0).stockCount).toBe(3);
    expect(viewFor(s, 0).trumpOnTable).toBe(true);
  });

  test('W2: n2, stock [x T], seat 0 wins: 0 gets x, the loser takes the briscola; the log says so', () => {
    const s0 = at(2, { hands: ['AC 2D 3B', '2C 3D 7S'], stock: '5D 4C', trump: '4C' });
    const s = plays(s0, [
      [0, 'AC'],
      [1, '2C'],
    ]);
    expect(s.hands[0]).toEqual(cs('2D 3B 5D'));
    expect(s.hands[1]).toEqual(cs('3D 7S 4C'));
    expect(s.stock).toEqual([]);
    expect(s.lastTrick?.trumpTaken).toBe(true);
    expect(s.lastTrick?.drew).toEqual([0, 1]);
    expect(texts(s).at(-1)).toBe('Ari took the trick · 11 points · briscola taken');
    expect(trickData(s)).toMatchObject({ trumpTaken: 1, drew: [0, 1] });
    const v = viewFor(s, 1);
    expect(v.trumpOnTable).toBe(false);
    expect(v.stockCount).toBe(0);
    // The trump suit is still the trump card's (E5).
    expect(v.trumpCard).toEqual(c('4C'));
  });

  test('W3: n3, stock [x y T], seat 2 wins: 2:x, 0:y, 1:T; drew [2, 0, 1]', () => {
    const s0 = at(3, { hands: ['2D', '3D', 'AD'], stock: '5S 6S 4C', trump: '4C' });
    const s = plays(s0, [
      [0, '2D'],
      [1, '3D'],
      [2, 'AD'],
    ]);
    expect(s.hands).toEqual([cs('6S'), cs('4C'), cs('5S')]);
    expect(s.lastTrick?.drew).toEqual([2, 0, 1]);
    expect(s.lastTrick?.trumpTaken).toBe(true);
  });

  test('W4: n4, stock [w x y T], seat 1 wins: 1:w, 2:x, 3:y, 0:T', () => {
    const s0 = at(4, { hands: ['2D', 'AD', '3B', '5B'], stock: '5S 6S 7S 4C', trump: '4C' });
    const s = plays(s0, [
      [0, '2D'],
      [1, 'AD'],
      [2, '3B'],
      [3, '5B'],
    ]);
    expect(s.hands).toEqual([cs('4C'), cs('5S'), cs('6S'), cs('7S')]);
    expect(s.lastTrick?.drew).toEqual([1, 2, 3, 0]);
    expect(s.lastTrick?.winner).toBe(1);
  });

  test('W5: n2, an empty stock: nobody draws, hands go from 3 to 2', () => {
    const s0 = at(2, { hands: ['AS 2D 3B', '2C 3D 7S'], stock: '', trump: '4C' });
    const s = plays(s0, [
      [0, 'AS'],
      [1, '2C'],
    ]);
    expect(s.lastTrick?.drew).toEqual([]);
    expect(s.lastTrick?.trumpTaken).toBe(false);
    expect(s.hands.map((h) => h.length)).toEqual([2, 2]);
    expect(s.phase).toBe('trick');
  });

  /** Seeded play to the end of one game by a fixed policy: the first legal card every time. */
  const playOut = (n: SeatCount, seed: number): { state: State; steps: number } =>
    Array.from({ length: 200 }).reduce<{ state: State; steps: number }>(
      ({ state, steps }) => {
        if (state.phase === 'over') return { state, steps };
        const actor = actorOf(state) ?? 0;
        const id = viewFor(state, actor).legal[0] ?? '';
        return { state: must(play(state, actor, id)), steps: steps + 1 };
      },
      { state: game(n, {}, mulberry32(seed)), steps: 0 },
    );

  test.each([
    [2, 20, 40],
    [3, 13, 39],
    [4, 10, 40],
  ] as const)(
    'W6: %i players play exactly %i tricks (%i cards), then over with every hand empty',
    (n, tricks, cards) => {
      const { state, steps } = playOut(n, 11);
      expect(steps).toBe(cards);
      expect(state.trickNo).toBe(tricks);
      expect(state.phase).toBe('over');
      expect(state.hands.every((h) => h.length === 0)).toBe(true);
      expect(state.stock).toEqual([]);
      expect(state.piles.reduce((sum, p) => sum + p.length, 0)).toBe(cards);
      expect(pointsOf(state.piles.flat())).toBe(120);
      expect(state.result?.totals.reduce((a, b) => a + b, 0)).toBe(120);
      expect(state.games).toHaveLength(1);
      expect(state.endedAt).toBe(NOW);
      expect(actorOf(state)).toBeNull();
    },
  );
});

/** Piles worth the given points, the last trick (11 points, seat 0's AC over a 2D) still to be played. */
const lastTrick = (
  n: SeatCount,
  piles: ReadonlyArray<string>,
  opts: CreateGameOptions = {},
): State =>
  at(n, {
    hands: ['AC', '2D', '4D', '5D'].slice(0, n),
    stock: '',
    trump: 'CC',
    opts,
    piles,
  });
const finish = (s: State): State =>
  plays(
    s,
    seatsOf(s.options.seatCount).map((seat) => [seat, s.hands[seat]?.[0]?.id ?? ''] as const),
  );

describe('results (S1-S7)', () => {
  test('S1: [61, 59] → seat 0 wins, wins [1, 0]', () => {
    const s = finish(lastTrick(2, ['3C 3D 3S 3B RC RD FC', 'AD AS AB RS RB CC CD CS CB FD FS FB']));
    expect(s.result).toEqual({ winner: 0, totals: [61, 59], draw: false });
    expect(s.match).toEqual({ gamesToWin: 2, wins: [1, 0], draws: 0 });
    expect(texts(s).at(-1)).toBe('Ari wins 61–59');
    expect(s.events.slice(-2).map((e) => e.kind)).toEqual(['trick', 'result']);
    expect(s.events.at(-1)).toEqual({
      id: 2,
      kind: 'result',
      seat: null,
      at: NOW,
      data: { winner: 0, totals: [61, 59], draw: false, decided: false, wins: [1, 0] },
    });
    expect(s.games).toEqual([
      { gameNo: 1, dealer: s.dealer, trump: 'C', winner: 0, totals: [61, 59], endedAt: NOW },
    ]);
    expect(matchOver(s.match)).toBe(false);
    expect(viewFor(s, 1).sides).toEqual([61, 59]);
  });

  test('S2: [60, 60] → a draw: winner null, wins [0, 0], draws 1, "A draw, 60–60"', () => {
    const s = finish(lastTrick(2, ['AD AS AB CC CD CS CB RC', '3C 3D 3S 3B RD RS RB FC FD FS FB']));
    expect(s.result).toEqual({ winner: null, totals: [60, 60], draw: true });
    expect(s.match).toEqual({ gamesToWin: 2, wins: [0, 0], draws: 1 });
    expect(texts(s).at(-1)).toBe('A draw, 60–60');
    expect(s.games[0]?.winner).toBeNull();
  });

  test('S3: n4 taken [30, 20, 35, 35] → four sides, a tie for the top: a draw, "A draw, 30–20–35–35"', () => {
    const s = finish(
      lastTrick(4, ['3C RC CC FC', '3D 3S', 'AD AS 3B CD', 'AB RD RS RB CS CB FD FS FB']),
    );
    expect(viewFor(s, 0).taken).toEqual([30, 20, 35, 35]);
    expect(viewFor(s, 0).sides).toEqual([30, 20, 35, 35]);
    expect(s.result).toEqual({ winner: null, totals: [30, 20, 35, 35], draw: true });
    expect(texts(s).at(-1)).toBe('A draw, 30–20–35–35');
    expect(s.match).toMatchObject({ wins: [0, 0, 0, 0], draws: 1 });
  });

  test('S4: n3 [50, 40, 30] → seat 0 wins without 61', () => {
    const s = finish(
      lastTrick(3, ['AD AS AB CC CD', '3C 3D 3S 3B', 'RC RD RS RB CS CB FC FD FS FB']),
    );
    expect(s.result).toEqual({ winner: 0, totals: [50, 40, 30], draw: false });
    expect(texts(s).at(-1)).toBe('Ari wins 50–40–30');
    expect(s.match.wins).toEqual([1, 0, 0]);
  });

  test('S5: n3 [40, 40, 40] → a draw', () => {
    const s = finish(
      lastTrick(3, ['AD RC RD RS RB FC', '3C 3D 3S 3B', 'AS AB CC CD CS CB FD FS FB']),
    );
    expect(s.result).toEqual({ winner: null, totals: [40, 40, 40], draw: true });
    expect(texts(s).at(-1)).toBe('A draw, 40–40–40');
  });

  test('S6: n3 [45, 45, 30] → a draw (a tie for the top)', () => {
    const s = finish(
      lastTrick(3, ['AD AS RC RD RS', '3C 3D 3S 3B CC FC', 'AB RB CD CS CB FD FS FB']),
    );
    expect(s.result).toEqual({ winner: null, totals: [45, 45, 30], draw: true });
    expect(s.match.draws).toBe(1);
  });

  test('S7: [120, 0] → a plain win, wins [1, 0] (no cappotto)', () => {
    const s = finish(
      lastTrick(2, ['3C 3D 3S 3B AD AS AB RC RD RS RB CC CD CS CB FC FD FS FB', '']),
    );
    expect(s.result).toEqual({ winner: 0, totals: [120, 0], draw: false });
    expect(s.match.wins).toEqual([1, 0]);
    expect(texts(s).at(-1)).toBe('Ari wins 120–0');
  });

  test('the winner\'s figure comes first: seat 1 winning 59–61 reads "Jeff wins 61–59"', () => {
    const s = finish(lastTrick(2, ['3C 3D 3S 3B RC RD', 'AD AS AB RS RB CC CD CS CB FD FS FB FC']));
    expect(s.result).toEqual({ winner: 1, totals: [59, 61], draw: false });
    expect(texts(s).at(-1)).toBe('Jeff wins 61–59');
  });
});

describe('the match (M1-M5)', () => {
  const S1_PILES = ['3C 3D 3S 3B RC RD FC', 'AD AS AB RS RB CC CD CS CB FD FS FB'];
  const S2_PILES = ['AD AS AB CC CD CS CB RC', '3C 3D 3S 3B RD RS RB FC FD FS FB'];

  test('M1: gamesToWin 2, wins [1, 0], seat 0 wins → [2, 0], the match is over, next → MATCH_OVER', () => {
    const before = {
      ...lastTrick(2, S1_PILES),
      match: { gamesToWin: 2 as const, wins: [1, 0], draws: 0 },
    };
    const s = finish(before);
    expect(s.match.wins).toEqual([2, 0]);
    expect(matchOver(s.match)).toBe(true);
    expect(matchWinner(s.match)).toBe(0);
    expect(texts(s).at(-1)).toBe('Ari wins 61–59 and takes the match 2–0');
    expect(s.events.at(-1)).toMatchObject({
      kind: 'result',
      data: { decided: true, wins: [2, 0] },
    });
    expect(viewFor(s, 0).matchOver).toBe(true);
    expect(legalActions(viewFor(s, 0))).toEqual([]);
    expect(fail(apply(s, 0, { type: 'next' }))).toBe(MESSAGES.MATCH_OVER);
    expect(fail(apply(s, 1, { type: 'next' }))).toBe(MESSAGES.MATCH_OVER);
  });

  test('M1 at four: one player per side, the winner first in the line, "Dan wins … and takes the match 1–0–0–0"', () => {
    const before = {
      ...lastTrick(4, ['3C RC CC FC', '3D 3S AD', 'AS 3B CD', 'AB RD RS RB CS CB FD FS FB']),
      match: { gamesToWin: 1 as const, wins: [0, 0, 0, 0], draws: 0 },
    };
    const s = finish(before);
    const totals = viewFor(s, 0).taken;
    expect(s.result).toEqual({ winner: 3, totals, draw: false });
    expect(texts(s).at(-1)).toBe(
      `Dan wins ${[totals[3], totals[0], totals[1], totals[2]].map(String).join('–')} and takes the match 1–0–0–0`,
    );
  });

  test('M2: gamesToWin 1: the first decided game ends the match; a draw first does not', () => {
    const won = finish(lastTrick(2, S1_PILES, { gamesToWin: 1 }));
    expect(matchOver(won.match)).toBe(true);
    expect(texts(won).at(-1)).toBe('Ari wins 61–59 and takes the match 1–0');
    const drawn = finish(lastTrick(2, S2_PILES, { gamesToWin: 1 }));
    expect(matchOver(drawn.match)).toBe(false);
    expect(matchWinner(drawn.match)).toBeNull();
    expect(legalActions(viewFor(drawn, 1))).toEqual([{ type: 'next' }]);
    const next = must(apply(drawn, 1, { type: 'next' }, mulberry32(2)));
    expect(next.gameNo).toBe(2);
    expect(next.match).toEqual({ gamesToWin: 1, wins: [0, 0], draws: 1 });
  });

  test('M3: gamesToWin 2, wins [1, 1], a draw → draws 1, the match on, next deals game 4', () => {
    const before = {
      ...lastTrick(2, S2_PILES),
      gameNo: 3,
      match: { gamesToWin: 2 as const, wins: [1, 1], draws: 0 },
    };
    const s = finish(before);
    expect(s.match).toEqual({ gamesToWin: 2, wins: [1, 1], draws: 1 });
    expect(matchOver(s.match)).toBe(false);
    const next = must(apply(s, 0, { type: 'next' }, mulberry32(3)));
    expect(next.gameNo).toBe(4);
    expect(next.dealer).toBe(nextSeat(2, s.dealer));
    expect(next.games).toHaveLength(1);
    expect(next.games[0]?.gameNo).toBe(3);
  });

  test('M4: next during a game → GAME_ON, from any seat', () => {
    const s = game(2);
    expect(fail(apply(s, s.turn, { type: 'next' }))).toBe(MESSAGES.GAME_ON);
    expect(fail(apply(s, nextSeat(2, s.turn), { type: 'next' }))).toBe(MESSAGES.GAME_ON);
  });

  test('M5: play or exchange at over → GAME_OVER', () => {
    const s = finish(lastTrick(2, S1_PILES));
    expect(fail(play(s, 0, 'AC'))).toBe(MESSAGES.GAME_OVER);
    expect(fail(apply(s, 1, { type: 'exchange' }))).toBe(MESSAGES.GAME_OVER);
    expect(legalActions(viewFor(s, 0))).toEqual([{ type: 'next' }]);
  });
});

describe('the exchange (X1-X11)', () => {
  /** Seat 0 to play, T on the table over one filler, seat 0 holding `hand`, a trick taken by `taker` (or nobody). */
  const table = (
    n: SeatCount,
    trump: string,
    hand: string,
    taker: Seat | null,
    exchange = true,
    leader: Seat = 0,
  ): State =>
    at(n, {
      hands: [hand, '3D 4D', '5D 6D', '7D FD'].slice(0, n),
      stock: `2S ${trump}`,
      trump,
      leader,
      opts: { exchange },
      piles: seatsOf(n).map((seat) =>
        seat === taker ? '2B 4B 5B 6B'.split(' ').slice(0, n).join(' ') : '',
      ),
    });
  const exchange = (s: State, seat: Seat): ReturnType<typeof applyAction> =>
    apply(s, seat, { type: 'exchange' });

  test('X1: the flag off → NO_EXCHANGE, whatever is held', () => {
    const s = table(2, 'AC', '7C 2D', 0, false);
    expect(canExchange(s, 0)).toBe(false);
    expect(fail(exchange(s, 0))).toBe(MESSAGES.NO_EXCHANGE);
    expect(viewFor(s, 0).canExchange).toBe(false);
  });

  test('X2: T=AC on the table, seat 0 holds 7C, has a trick, own turn → the swap, the turn unchanged', () => {
    const s0 = table(2, 'AC', '7C 2D', 0);
    expect(canExchange(s0, 0)).toBe(true);
    expect(legalActions(viewFor(s0, 0))).toEqual([
      { type: 'play', cardId: '7C' },
      { type: 'play', cardId: '2D' },
      { type: 'exchange' },
    ]);
    const s = must(exchange(s0, 0));
    expect(s.hands[0]).toEqual(cs('2D AC'));
    expect(s.trumpCard).toEqual(c('7C'));
    expect(s.stock).toEqual(cs('2S 7C'));
    expect(s.exchanges).toEqual([{ seat: 0, gave: c('7C'), took: c('AC') }]);
    expect(s.turn).toBe(0);
    expect(s.leader).toBe(0);
    expect(s.trick).toEqual([]);
    expect(texts(s).at(-1)).toBe('Ari exchanged the sette di coppe for the asso di coppe');
    expect(s.events.at(-1)).toEqual({
      id: 1,
      kind: 'exchange',
      seat: 0,
      at: NOW,
      data: { seat: 0, gave: c('7C'), took: c('AC') },
    });
    // No rng is read by an exchange (E19).
    const rng = counting(() => 0);
    must(apply(s0, 0, { type: 'exchange' }, rng));
    expect(rng.calls()).toBe(0);
  });

  test('X3: as X2 with no trick taken → NO_TRICK_YET', () => {
    const s = table(2, 'AC', '7C 2D', null);
    expect(canExchange(s, 0)).toBe(false);
    expect(fail(exchange(s, 0))).toBe(MESSAGES.NO_TRICK_YET);
  });

  test('X4: T=5C, seat 0 holds 2C, a trick taken → the 5C in hand, the 2C on the table', () => {
    const s = must(exchange(table(2, '5C', '2C 3D', 0), 0));
    expect(s.hands[0]).toEqual(cs('3D 5C'));
    expect(s.trumpCard).toEqual(c('2C'));
    expect(s.stock.at(-1)).toEqual(c('2C'));
  });

  test('X5: T=5C, seat 0 holds the 7C only → NO_SWAP_CARD', () => {
    const s = table(2, '5C', '7C 3D', 0);
    expect(canExchange(s, 0)).toBe(false);
    expect(fail(exchange(s, 0))).toBe(MESSAGES.NO_SWAP_CARD);
  });

  test('X6: T=2C → canExchange false; exchange → NO_SWAP_CARD', () => {
    const s = table(2, '2C', '7C AC', 0);
    expect(canExchange(s, 0)).toBe(false);
    expect(fail(exchange(s, 0))).toBe(MESSAGES.NO_SWAP_CARD);
  });

  test('X7: the flag on, the stock empty → TRUMP_GONE', () => {
    const s = { ...table(2, 'AC', '7C 2D', 0), stock: [] };
    expect(canExchange(s, 0)).toBe(false);
    expect(fail(exchange(s, 0))).toBe(MESSAGES.TRUMP_GONE);
  });

  test("X8: as X2 on seat 1's turn: seat 0's exchange → NOT_YOUR_TURN", () => {
    const s = table(2, 'AC', '7C 2D', 0, true, 1);
    expect(canExchange(s, 0)).toBe(false);
    expect(fail(exchange(s, 0))).toBe(MESSAGES.NOT_YOUR_TURN);
  });

  test("X9: n4, another seat took the trick, piles[0] empty → not yet (no partners: only a trick of one's own counts)", () => {
    const s0 = table(4, 'AC', '7C 2D', 2);
    expect(s0.piles[0]).toEqual([]);
    expect(canExchange(s0, 0)).toBe(false);
    // An opponent's trick would not do: seat 1 (side 1) holding the 7 with only side 0's trick.
    const opp = at(4, {
      hands: ['2D', '7C 3D', '5D', 'FD'],
      stock: '2S AC',
      trump: 'AC',
      leader: 1,
      opts: { exchange: true },
      piles: ['2B 4B 5B 6B', '', '', ''],
    });
    expect(fail(exchange(opp, 1))).toBe(MESSAGES.NO_TRICK_YET);
  });

  test('X10: after X2 (T=7C) seat 1 holds the 2C, has a trick, own turn → ok; then nothing exchanges a 2', () => {
    const afterX2 = must(exchange(table(2, 'AC', '7C 2D', 0), 0));
    // Seat 0 plays; seat 1's turn with a trick of its own and the 2C in hand.
    const s1: State = {
      ...must(play(afterX2, 0, '2D')),
      hands: [afterX2.hands[0]?.filter((k) => k.id !== '2D') ?? [], cs('2C 4D')],
      piles: [afterX2.piles[0] ?? [], cs('3B 5B')],
    };
    expect(s1.turn).toBe(1);
    expect(canExchange(s1, 1)).toBe(true);
    const s = must(exchange(s1, 1));
    expect(s.trumpCard).toEqual(c('2C'));
    expect(s.hands[1]).toEqual(cs('4D 7C'));
    expect(s.exchanges).toHaveLength(2);
    expect(canExchange(s, 1)).toBe(false);
    expect(fail(exchange(s, 1))).toBe(MESSAGES.NO_SWAP_CARD);
    expect(texts(s).at(-1)).toBe('Jeff exchanged the due di coppe for the sette di coppe');
  });

  test('X11: seat 0 holds 7C, T=AC, stock [x T] → canExchange true; the view agrees', () => {
    const s = table(2, 'AC', '7C 2D', 0);
    expect(s.stock).toHaveLength(2);
    expect(canExchange(s, 0)).toBe(true);
    expect(viewFor(s, 0).canExchange).toBe(true);
    expect(viewFor(s, 1).canExchange).toBe(false);
  });
});

describe('refusals (E1-E4) and the reserved phases', () => {
  test("E1: a card not held → NOT_IN_HAND (another seat's card too)", () => {
    const s = at(2, { hands: ['AS 3D 7C', 'RB 2C 5S'], stock: '5D 6D 4C', trump: '4C' });
    expect(fail(play(s, 0, 'RB'))).toBe(MESSAGES.NOT_IN_HAND);
    expect(fail(play(s, 0, 'AC'))).toBe(MESSAGES.NOT_IN_HAND);
    expect(fail(play(s, 0, 'ZZ'))).toBe(MESSAGES.NOT_IN_HAND);
  });

  test("E2: seat 1 playing its own card on seat 0's turn → NOT_YOUR_TURN", () => {
    const s = at(2, { hands: ['AS 3D 7C', 'RB 2C 5S'], stock: '5D 6D 4C', trump: '4C' });
    expect(fail(play(s, 1, 'RB'))).toBe(MESSAGES.NOT_YOUR_TURN);
  });

  test('E3: a seat the table does not have → BAD_SEAT before anything else', () => {
    const s = game(2);
    expect(fail(apply(s, 2, { type: 'next' }))).toBe(MESSAGES.BAD_SEAT);
    expect(fail(apply(s, 3, { type: 'exchange' }))).toBe(MESSAGES.BAD_SEAT);
    expect(fail(play(game(3), 3, 'AC'))).toBe(MESSAGES.BAD_SEAT);
    // At over too (a bad seat may not deal the next game).
    const over = finish(
      lastTrick(2, ['3C 3D 3S 3B RC RD FC', 'AD AS AB RS RB CC CD CS CB FD FS FB']),
    );
    expect(fail(apply(over, 2, { type: 'next' }))).toBe(MESSAGES.BAD_SEAT);
  });

  test('E4: n3 seed 3 played to over: every wrong-seat play along the way → NOT_YOUR_TURN', () => {
    const run = Array.from({ length: 200 }).reduce<State>(
      (state) => {
        if (state.phase === 'over') return state;
        const actor = actorOf(state) ?? 0;
        const id = viewFor(state, actor).legal[0] ?? '';
        seatsOf(3)
          .filter((seat) => seat !== actor)
          .forEach((seat) => {
            const own = state.hands[seat]?.[0]?.id ?? '';
            expect(fail(play(state, seat, own))).toBe(MESSAGES.NOT_YOUR_TURN);
            expect(fail(apply(state, seat, { type: 'exchange' }))).toBe(MESSAGES.NOT_YOUR_TURN);
          });
        return must(play(state, actor, id));
      },
      game(3, {}, mulberry32(3)),
    );
    expect(run.phase).toBe('over');
  });

  test('the reserved phases refuse everything: DEAL_PENDING and DRAW_PENDING (E24)', () => {
    const s = game(2);
    const dealing: State = { ...s, phase: 'deal' };
    const drawing: State = { ...s, phase: 'draw' };
    expect(actorOf(dealing)).toBeNull();
    expect(actorOf(drawing)).toBeNull();
    expect(fail(play(dealing, s.turn, s.hands[s.turn]?.[0]?.id ?? ''))).toBe(MESSAGES.DEAL_PENDING);
    expect(fail(apply(drawing, s.turn, { type: 'next' }))).toBe(MESSAGES.DRAW_PENDING);
    expect(legalActions(viewFor(dealing, s.turn))).toEqual([]);
  });

  test('the MESSAGES texts are the rules §4 table', () => {
    expect(MESSAGES).toEqual({
      NOT_YOUR_TURN: 'It is not your turn',
      NOT_IN_HAND: 'That card is not in your hand',
      GAME_OVER: 'The game is over — deal the next one',
      GAME_ON: 'The game is still on',
      MATCH_OVER: 'The match is over',
      NO_EXCHANGE: 'This table does not play the exchange',
      TRUMP_GONE: 'The briscola has been drawn',
      NO_TRICK_YET: 'Take a trick before you exchange',
      NO_SWAP_CARD:
        'Only the sette (or the due) of briscola can be exchanged, and only for a higher card',
      BAD_SEAT: 'No such seat at this table',
      DEAL_PENDING: 'Dealing…',
      DRAW_PENDING: 'Drawing…',
    });
  });
});
