// Decoders for the engine's shapes (docs/design/briscola-rules.md E20, E21): a `View` arriving in
// a wire `state` frame, a `State` read back from the save and an `Action` from a guest are
// `unknown` until they pass one of these. Built from web/shared/lib/json combinators with the
// fields in types.ts's order, so `JSON.stringify` of a decoded value reproduces the engine's own
// text byte for byte. Structural checks plus the invariants the engine leans on (as many hands
// and piles as seats, the deck's multiset exactly once across hands, stock, trick and piles, the
// trump card under the stock, whole tricks in the piles and whole draws in the stock, a result
// iff the game is over), since a save that disagrees would wedge the game; play legality stays
// with `applyAction`. Every card id is refused outside the `LABEL + suit` grammar, every flag
// outside its literals. `count` and `timestamp` are web/shared/lib/game.ts's (DRY round 2 F1);
// `seat` is not: this engine's seats are four (E21).
import { count, timestamp } from '../../../../shared/lib/game.ts';
import {
  arrayOf,
  boolean,
  integer,
  literal,
  nullable,
  object,
  optional,
  refine,
  string,
  taggedUnion,
  type Decoder,
} from '../../../../shared/lib/json.ts';
import { deckFor, idsOf, isCardId } from './cards.ts';
import { nextSeat, sidesOf } from './seats.ts';
import {
  LABEL,
  type Action,
  type Card,
  type Exchange,
  type GameOptions,
  type GameRecord,
  type GameResult,
  type LogEntry,
  type LogKind,
  type Match,
  type Phase,
  type Played,
  type Player,
  type Rank,
  type Seat,
  type SeatView,
  type Side,
  type State,
  type Suit,
  type TrickRecord,
  type View,
} from './types.ts';

/** E21: every seat a table could have; `applyAction` refuses one the table does not (BAD_SEAT). */
export const decodeSeat: Decoder<Seat> = literal(0, 1, 2, 3);
const side: Decoder<Side> = literal(0, 1, 2);
const suit: Decoder<Suit> = literal('C', 'D', 'S', 'B');
const rank: Decoder<Rank> = literal(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
const seatCount = literal(2, 3, 4);
const gamesToWin = literal(1, 2, 3);
const phase: Decoder<Phase> = literal('deal', 'trick', 'draw', 'over');
const logKind: Decoder<LogKind> = literal('game', 'deal', 'play', 'trick', 'exchange', 'result');

/** A card whose `id` is `LABEL[r] + s` (D10): the three fields agree or the card is refused. */
export const decodeCard: Decoder<Card> = refine(
  object({ id: string, r: rank, s: suit }),
  (c) => c.id === LABEL[c.r] + c.s,
  'a card whose id is its label and suit',
);
const cards = arrayOf(decodeCard);

const player: Decoder<Player> = object({ id: string, name: string });

/** E15/E16: scoperta is stored true at two players only, the partner peek at four only. */
export const decodeOptions: Decoder<GameOptions> = refine(
  object({
    seatCount,
    gamesToWin,
    removedTwo: suit,
    exchange: boolean,
    scoperta: boolean,
    partnerPeek: boolean,
  }),
  (o) => (!o.scoperta || o.seatCount === 2) && (!o.partnerPeek || o.seatCount === 4),
  'scoperta at two players and the partner peek at four only',
);

const played: Decoder<Played> = object({ seat: decodeSeat, card: decodeCard });
const trickRecord: Decoder<TrickRecord> = object({
  no: integer(1),
  leader: decodeSeat,
  cards: arrayOf(played),
  winner: decodeSeat,
  points: count,
  drew: arrayOf(decodeSeat),
  trumpTaken: boolean,
});
const exchange: Decoder<Exchange> = object({
  seat: decodeSeat,
  gave: decodeCard,
  took: decodeCard,
});
const match: Decoder<Match> = object({ gamesToWin, wins: arrayOf(count), draws: count });
const gameResult: Decoder<GameResult> = object({
  winner: nullable(side),
  totals: arrayOf(count),
  draw: boolean,
});
const gameRecord: Decoder<GameRecord> = object({
  gameNo: integer(1),
  dealer: decodeSeat,
  trump: suit,
  winner: nullable(side),
  totals: arrayOf(count),
  endedAt: timestamp,
});
const logEntry: Decoder<LogEntry> = object({
  seat: nullable(decodeSeat),
  kind: logKind,
  text: string,
  at: timestamp,
});

type Check<T> = readonly [predicate: (value: T) => boolean, expected: string];

/** One `refine` per check, so a refused save names the invariant it broke. */
const checked = <T>(base: Decoder<T>, checks: ReadonlyArray<Check<T>>): Decoder<T> =>
  checks.reduce((d, [predicate, expected]) => refine(d, predicate, expected), base);

const sorted = (ids: ReadonlyArray<string>): string => [...ids].sort().join(' ');

/** E20's refinements over the shape (the invariants every emitted state holds). */
const STATE_CHECKS: ReadonlyArray<Check<State>> = [
  [(s) => s.players.length === s.options.seatCount, 'as many players as seats'],
  [
    (s) => s.hands.length === s.options.seatCount && s.piles.length === s.options.seatCount,
    'a hand and a pile per seat',
  ],
  [
    (s) => [s.dealer, s.leader, s.turn].every((seat) => seat < s.options.seatCount),
    'the dealer, the leader and the turn seated at the table',
  ],
  [
    (s) =>
      sorted([
        ...idsOf(s.hands.flat()),
        ...idsOf(s.stock),
        ...idsOf(s.trick.map((p) => p.card)),
        ...idsOf(s.piles.flat()),
      ]) === sorted(idsOf(deckFor(s.options))),
    'the deck, every card exactly once across hands, stock, trick and piles',
  ],
  [(s) => idsOf(deckFor(s.options)).includes(s.trumpCard.id), 'a trump card from the deck'],
  [(s) => s.trick.length < s.options.seatCount, 'a trick shorter than the seat count'],
  [
    (s) => s.piles.every((pile) => pile.length % s.options.seatCount === 0),
    'piles of whole tricks',
  ],
  [(s) => s.stock.length % s.options.seatCount === 0, 'a stock of whole draws'],
  [
    (s) => s.stock.length === 0 || s.stock.at(-1)?.id === s.trumpCard.id,
    'the trump card under the stock',
  ],
  [(s) => (s.result !== null) === (s.phase === 'over'), 'a result exactly when the game is over'],
  [
    (s) => s.phase !== 'over' || s.hands.every((hand) => hand.length === 0),
    'empty hands once the game is over',
  ],
  [(s) => s.match.wins.length === sidesOf(s.options.seatCount), 'a win count per side'],
  [
    (s) => {
      const [first] = s.trick;
      const last = s.trick.at(-1);
      return (
        first === undefined ||
        last === undefined ||
        (first.seat === s.leader && s.turn === nextSeat(s.options.seatCount, last.seat))
      );
    },
    'a trick led by the leader, the turn after its last card',
  ],
];

/** The host's full state, as the save holds it (setup.ts's key order). */
export const decodeState: Decoder<State> = checked(
  object({
    players: arrayOf(player),
    options: decodeOptions,
    gameNo: integer(1),
    phase,
    dealer: decodeSeat,
    leader: decodeSeat,
    turn: decodeSeat,
    trumpCard: decodeCard,
    hands: arrayOf(cards),
    stock: cards,
    trick: arrayOf(played),
    piles: arrayOf(cards),
    trickNo: count,
    lastTrick: nullable(trickRecord),
    exchanges: arrayOf(exchange),
    match,
    result: nullable(gameResult),
    games: arrayOf(gameRecord),
    log: arrayOf(logEntry),
    lastAction: nullable(logEntry),
    startedAt: timestamp,
    endedAt: nullable(timestamp),
  }),
  STATE_CHECKS,
);

const seatView: Decoder<SeatView> = object({
  idx: decodeSeat,
  id: string,
  name: string,
  side,
  handCount: count,
  hand: optional(cards),
});

/** What a view must agree on with itself (E17): a seat for every other player, whole draws, a result iff over. */
const VIEW_CHECKS: ReadonlyArray<Check<View>> = [
  [
    (v) =>
      v.players.length === v.options.seatCount &&
      v.others.length === v.options.seatCount - 1 &&
      [v.me.idx, ...v.others.map((o) => o.idx)].every((seat) => seat < v.options.seatCount),
    'the viewer and every other seat, seated at the table',
  ],
  [(v) => v.trick.length < v.options.seatCount, 'a trick shorter than the seat count'],
  [
    (v) => v.stockCount % v.options.seatCount === 0 && v.trumpOnTable === v.stockCount > 0,
    'a stock of whole draws, the trump card on the table while it lasts',
  ],
  [(v) => (v.result !== null) === (v.phase === 'over'), 'a result exactly when the game is over'],
  [
    (v) =>
      v.taken.length === v.options.seatCount &&
      v.tricks.length === v.options.seatCount &&
      v.sides.length === sidesOf(v.options.seatCount) &&
      v.match.wins.length === sidesOf(v.options.seatCount),
    'a score per seat and per side',
  ],
];

/** A per-seat view, as a wire `state` frame carries it (view.ts's key order). */
export const decodeView: Decoder<View> = checked(
  object({
    me: object({ idx: decodeSeat, id: string, name: string, side, hand: cards }),
    others: arrayOf(seatView),
    players: arrayOf(player),
    options: decodeOptions,
    gameNo: integer(1),
    phase,
    dealer: decodeSeat,
    leader: decodeSeat,
    turn: decodeSeat,
    actor: nullable(decodeSeat),
    isMyTurn: boolean,
    trumpCard: decodeCard,
    trumpOnTable: boolean,
    stockCount: count,
    stockTop: nullable(decodeCard),
    trick: arrayOf(played),
    legal: arrayOf(refine(string, isCardId, 'a card id')),
    canExchange: boolean,
    exchanges: arrayOf(exchange),
    taken: arrayOf(count),
    tricks: arrayOf(count),
    sides: arrayOf(count),
    trickNo: count,
    lastTrick: nullable(trickRecord),
    match,
    matchOver: boolean,
    result: nullable(gameResult),
    games: arrayOf(gameRecord),
    log: arrayOf(logEntry),
    lastAction: nullable(logEntry),
    startedAt: timestamp,
    endedAt: nullable(timestamp),
  }),
  VIEW_CHECKS,
);

/** E20: a `cardId` outside the `LABEL + suit` grammar is refused here; whether it is held is `applyAction`'s. */
const playAction: Decoder<Action> = object({
  type: literal('play'),
  cardId: refine(string, isCardId, 'a card id (its label and suit, AC..RB)'),
});
const exchangeAction: Decoder<Action> = object({ type: literal('exchange') });
const nextAction: Decoder<Action> = object({ type: literal('next') });

/**
 * A player's action as the wire `action` frame carries it: the type decides which keys follow, one
 * case per ACTION_TYPES entry in its order (so a refused type names them in that order).
 */
export const decodeAction: Decoder<Action> = taggedUnion('type', {
  play: playAction,
  exchange: exchangeAction,
  next: nextAction,
});
