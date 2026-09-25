// Starting a game (docs/design/briscola-rules.md D8, E4, E15, E16, E19, E22): the options
// normalised, the dealer of game 1 drawn from the rng, the shuffle, three cards to each seat in
// play order (the leader first, the dealer last), the trump card turned and laid under the stock,
// and the `State` literal in types.ts's key order. `createGame` is infallible: the `Players` tuple
// fixes the seat count and every option has a default. `nextGame` deals the following game of the
// same match with the dealer rotated; `withPosition` seats a position for tests, stories and
// `__briscola.setup`.
import type { Rng } from '../../../../shared/lib/rng.ts';
import { shuffle } from '../../../../shared/lib/shuffle.ts';
import { deckFor, makeCard } from './cards.ts';
import { dealText, entry, gameText, nameOf } from './log.ts';
import { freshMatch } from './score.ts';
import { nextSeat, seatsFrom } from './seats.ts';
import {
  DEFAULT_GAMES_TO_WIN,
  DEFAULT_REMOVED_TWO,
  HAND_SIZE,
  type Card,
  type Cards,
  type CreateGameOptions,
  type GameOptions,
  type LogEntry,
  type Match,
  type Now,
  type Player,
  type Players,
  type Seat,
  type SeatCount,
  type State,
} from './types.ts';

/** E15/E16: scoperta is a two-player flag and the partner peek a four-player one; the rest default. */
export const normaliseOptions = (seatCount: SeatCount, opts: CreateGameOptions): GameOptions => ({
  seatCount,
  gamesToWin: opts.gamesToWin ?? DEFAULT_GAMES_TO_WIN,
  removedTwo: opts.removedTwo ?? DEFAULT_REMOVED_TWO,
  exchange: opts.exchange ?? false,
  scoperta: seatCount === 2 && (opts.scoperta ?? false),
  partnerPeek: seatCount === 4 && (opts.partnerPeek ?? false),
});

/** D8: one rng draw for the dealer of game 1; the cast is safe for an rng in [0, 1) and `min` pins n − 1. */
export const drawDealer = (n: SeatCount, rng: Rng): Seat =>
  Math.min(n - 1, Math.floor(rng() * n)) as Seat;

type Deal = Readonly<{ hands: ReadonlyArray<Cards>; trumpCard: Card; stock: Cards }>;

/**
 * E4: from the top of the shuffled deck, three cards to `nextSeat(dealer)`, three to the next, …,
 * three to the dealer last; then the trump card, then the rest, and the trump card is laid under
 * the stock as its last element. `stock.length` is 40 − 3n (34 / 30 / 28) or 39 − 9 = 30 at three,
 * a multiple of n either way. Safe indexing: the deck holds at least 3n + 1 cards.
 */
const deal = (deck: Cards, n: SeatCount, dealer: Seat): Deal => {
  const order = seatsFrom(n, nextSeat(n, dealer));
  const hands = seatsFrom(n, 0).map((seat) => {
    const k = order.indexOf(seat);
    return deck.slice(HAND_SIZE * k, HAND_SIZE * (k + 1));
  });
  const turned = deck.slice(HAND_SIZE * n, HAND_SIZE * n + 1);
  return {
    hands,
    // The deck holds 3n + 1 cards and more, which the type system cannot see: the fallback is unreachable.
    trumpCard: turned[0] ?? makeCard(1, 'C'),
    stock: [...deck.slice(HAND_SIZE * n + 1), ...turned],
  };
};

/** Game `gameNo` of a match: the literal in the wire order, every key present (E20). */
const startGame = (
  players: ReadonlyArray<Player>,
  options: GameOptions,
  gameNo: number,
  dealer: Seat,
  match: Match,
  games: State['games'],
  rng: Rng,
  now: Now,
): State => {
  const n = options.seatCount;
  const dealt = deal(shuffle(deckFor(options), rng), n, dealer);
  const leader = nextSeat(n, dealer);
  const startedAt = now();
  const dealEntry: LogEntry = entry(
    dealer,
    'deal',
    dealText(nameOf(players, dealer), dealt.trumpCard),
    startedAt,
  );
  return {
    players,
    options,
    gameNo,
    phase: 'trick',
    dealer,
    leader,
    turn: leader,
    trumpCard: dealt.trumpCard,
    hands: dealt.hands,
    stock: dealt.stock,
    trick: [],
    piles: seatsFrom(n, 0).map(() => []),
    trickNo: 0,
    lastTrick: null,
    exchanges: [],
    match,
    result: null,
    games,
    // Game 1 opens the match with its deal; later games announce themselves first (D6).
    log: gameNo === 1 ? [dealEntry] : [entry(null, 'game', gameText(gameNo), startedAt), dealEntry],
    lastAction: dealEntry,
    startedAt,
    endedAt: null,
  };
};

/**
 * A new match (E19: 1 + (m − 1) rng calls, the dealer then the shuffle). `players.length` is the
 * seat count; every option defaults (D3).
 */
export const createGame = (
  players: Players,
  opts: CreateGameOptions,
  rng: Rng,
  now: Now,
): State => {
  const options = normaliseOptions(players.length, opts);
  const dealer = drawDealer(options.seatCount, rng);
  return startGame(players, options, 1, dealer, freshMatch(options), [], rng, now);
};

/** E13: the following game of the same match: the dealer rotates, the record of the finished game is already in `games`. */
export const nextGame = (state: State, rng: Rng, now: Now): State =>
  startGame(
    state.players,
    state.options,
    state.gameNo + 1,
    nextSeat(state.options.seatCount, state.dealer),
    state.match,
    state.games,
    rng,
    now,
  );

/**
 * E22: `state` at a given position, `leader` to lead an empty trick: `stock` as the state holds
 * it (top first, the trump card last while it is on the table), `trumpCard` naming the trump suit
 * even once the stock is out. Piles, the tally and the log are the caller's (spread them in).
 */
export const withPosition = (
  state: State,
  hands: ReadonlyArray<Cards>,
  stock: Cards,
  trumpCard: Card,
  leader: Seat,
): State => ({
  ...state,
  phase: 'trick',
  leader,
  turn: leader,
  trumpCard,
  hands,
  stock,
  trick: [],
  result: null,
  endedAt: null,
});
