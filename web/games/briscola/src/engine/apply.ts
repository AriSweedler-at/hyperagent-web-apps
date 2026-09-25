// The reducer (docs/design/briscola-rules.md D20, E6-E14, E21, E25): `applyAction(state, seat,
// action, rng, now)` returns a new State or a refusal worded for the player, never mutates, never
// throws, and is the single entry the local reducer and the online host share. A `play` moves one
// card from the hand to the trick; the n-th card resolves the trick, draws for every seat while
// the stock lasts and hands the lead to the winner, all in the same state; the last trick ends the
// game and tallies the match; `next` at `over` deals the following game. The rng is read by `next`
// alone (the shuffle); the clock stamps every log entry.
import { err, ok, type Result } from '../../../../shared/lib/result.ts';
import type { Rng } from '../../../../shared/lib/rng.ts';
import { exchangeCardFor, pointsOf, trickWinner } from './cards.ts';
import { entry, exchangeText, nameOf, playText, resultText, trickText } from './log.ts';
import { matchAfter, matchOver, resultOf } from './score.ts';
import { nextSeat, seatsFrom, sideOf } from './seats.ts';
import { nextGame } from './setup.ts';
import type {
  Action,
  Cards,
  GameRecord,
  LogEntry,
  Now,
  Seat,
  State,
  TrickRecord,
} from './types.ts';

/** Refusals, worded for the player who tried (rules §4; pinned by apply.test.ts). */
export const MESSAGES = {
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
} as const;

type Applied = Result<State, string>;

/** E24: who may act: `turn` in 'trick', nobody at 'over' (`next` is open to every seat) and in the reserved phases. */
export const actorOf = (state: State): Seat | null => (state.phase === 'trick' ? state.turn : null);

/** The seat's hand; a seat outside the table (refused before this is read) holds nothing. */
const handOf = (state: State, seat: Seat): Cards => state.hands[seat] ?? [];

/** E14: the seat's side has taken at least one trick (a partner's counts). */
const sideHasTrick = (state: State, seat: Seat): boolean => {
  const n = state.options.seatCount;
  return state.piles.some((pile, s) => pile.length > 0 && sideOf(n, s as Seat) === sideOf(n, seat));
};

/** The card in the seat's hand the trump card calls for, if held (E14). */
const swapCard = (state: State, seat: Seat): Cards[number] | undefined => {
  const wanted = exchangeCardFor(state.trumpCard);
  return wanted === null ? undefined : handOf(state, seat).find((c) => c.id === wanted.id);
};

/**
 * E14: the flag, the trick phase, the actor's own turn, the trump card still on the table, a trick
 * taken by the side, and the called-for card in hand.
 */
export const canExchange = (state: State, seat: Seat): boolean =>
  state.options.exchange &&
  state.phase === 'trick' &&
  state.turn === seat &&
  state.stock.length > 0 &&
  sideHasTrick(state, seat) &&
  swapCard(state, seat) !== undefined;

/** Append entries; the last one becomes `lastAction` (E18). */
const withLog = (state: State, entries: ReadonlyArray<LogEntry>): State => {
  const last = entries.at(-1);
  return last === undefined
    ? state
    : { ...state, log: [...state.log, ...entries], lastAction: last };
};

/** E14's refusals in order, then the swap: the held card goes under the stock, the trump card into the hand. */
const exchange = (state: State, seat: Seat, now: Now): Applied => {
  if (!state.options.exchange) return err(MESSAGES.NO_EXCHANGE);
  if (state.stock.length === 0) return err(MESSAGES.TRUMP_GONE);
  if (!sideHasTrick(state, seat)) return err(MESSAGES.NO_TRICK_YET);
  const gave = swapCard(state, seat);
  if (gave === undefined) return err(MESSAGES.NO_SWAP_CARD);
  const took = state.trumpCard;
  const at = now();
  return ok(
    withLog(
      {
        ...state,
        trumpCard: gave,
        hands: state.hands.map((hand, s) =>
          s === seat ? [...hand.filter((c) => c.id !== gave.id), took] : hand,
        ),
        stock: [...state.stock.slice(0, -1), gave],
        exchanges: [...state.exchanges, { seat, gave, took }],
      },
      [entry(seat, 'exchange', exchangeText(nameOf(state.players, seat), gave, took), at)],
    ),
  );
};

/**
 * E12/E13: the last trick has been taken: the result from the piles, the match tallied, the
 * record added, one `result` line naming the match winner when this game decided it.
 */
const finishGame = (state: State, at: number): State => {
  const n = state.options.seatCount;
  const result = resultOf(n, state.piles);
  const match = matchAfter(state.match, result);
  const record: GameRecord = {
    gameNo: state.gameNo,
    dealer: state.dealer,
    trump: state.trumpCard.s,
    winner: result.winner,
    totals: result.totals,
    endedAt: at,
  };
  return withLog(
    { ...state, phase: 'over', match, result, games: [...state.games, record], endedAt: at },
    [entry(null, 'result', resultText(state.players, n, result, match, matchOver(match)), at)],
  );
};

/**
 * E7-E11: the n-th card is down. The winner takes the cards; while the stock lasts every seat
 * draws one off the top, the winner first then in play order, the last drawer taking the trump
 * card when the stock held exactly n; the winner leads. No rng: the stock's order was fixed by
 * the deal. When every hand is empty the game is over.
 */
const resolveTrick = (state: State, at: number): State => {
  const n = state.options.seatCount;
  const winner = trickWinner(state.trumpCard.s, state.trick);
  const cards = state.trick.map((p) => p.card);
  const drew = state.stock.length > 0 ? seatsFrom(n, winner) : [];
  const drawn = state.stock.slice(0, n);
  const hands: ReadonlyArray<Cards> = state.hands.map((hand, seat) => [
    ...hand,
    ...drawn.filter((_, i) => drew[i] === seat),
  ]);
  const trumpTaken = state.stock.length === n;
  const points = pointsOf(cards);
  const lastTrick: TrickRecord = {
    no: state.trickNo + 1,
    leader: state.leader,
    cards: state.trick,
    winner,
    points,
    drew,
    trumpTaken,
  };
  const taken = withLog(
    {
      ...state,
      leader: winner,
      turn: winner,
      hands,
      stock: state.stock.slice(n),
      trick: [],
      piles: state.piles.map((pile, seat) => (seat === winner ? [...pile, ...cards] : pile)),
      trickNo: lastTrick.no,
      lastTrick,
    },
    [entry(winner, 'trick', trickText(nameOf(state.players, winner), points, trumpTaken), at)],
  );
  return hands.every((hand) => hand.length === 0) ? finishGame(taken, at) : taken;
};

/** E6: any card of the hand; the card joins the trick, the turn passes, `lastAction` says so. */
const play = (state: State, seat: Seat, cardId: string, now: Now): Applied => {
  const card = handOf(state, seat).find((c) => c.id === cardId);
  if (card === undefined) return err(MESSAGES.NOT_IN_HAND);
  const n = state.options.seatCount;
  const at = now();
  const trick = [...state.trick, { seat, card }];
  const next: State = {
    ...state,
    turn: nextSeat(n, seat),
    hands: state.hands.map((hand, s) => (s === seat ? hand.filter((c) => c.id !== cardId) : hand)),
    trick,
    lastAction: entry(
      seat,
      'play',
      playText(nameOf(state.players, seat), card, state.trick.length === 0),
      at,
    ),
  };
  return ok(trick.length === n ? resolveTrick(next, at) : next);
};

/**
 * The reducer. E25's order: a seat the table does not have; the phase (the reserved ones wait; a
 * finished game takes only `next`, refused once the match is decided); in 'trick': `next` is
 * refused, a seat that is not the actor is refused, then the action decides.
 */
export const applyAction = (
  state: State,
  seat: Seat,
  action: Action,
  rng: Rng,
  now: Now,
): Applied => {
  if (seat >= state.options.seatCount) return err(MESSAGES.BAD_SEAT);
  switch (state.phase) {
    case 'deal':
      return err(MESSAGES.DEAL_PENDING);
    case 'draw':
      return err(MESSAGES.DRAW_PENDING);
    case 'over':
      return action.type !== 'next'
        ? err(MESSAGES.GAME_OVER)
        : matchOver(state.match)
          ? err(MESSAGES.MATCH_OVER)
          : ok(nextGame(state, rng, now));
    case 'trick':
      if (action.type === 'next') return err(MESSAGES.GAME_ON);
      if (seat !== state.turn) return err(MESSAGES.NOT_YOUR_TURN);
      return action.type === 'exchange'
        ? exchange(state, seat, now)
        : play(state, seat, action.cardId, now);
  }
};
