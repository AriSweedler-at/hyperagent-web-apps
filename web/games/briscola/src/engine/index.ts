// The briscola engine as one module (docs/design/briscola-rules.md): the UI, protocol and storage
// import only from here. Pure: no DOM, no clock, no randomness of its own; `rng` and `now` are
// injected into `createGame`, `nextGame`, `replayGame` and `applyAction` (docs/ARCHITECTURE.md
// "Module boundaries"). N-seat from day one: every entry takes a `Seat` 0..3 and the state's
// `seatCount` says which of them are at the table.
//
// `ENGINE` is the engine on web/shared/lib/game.ts's two-seat contract (DRY round 2 F1) as far as
// it reaches four seats. What fits: `create` (a `Pair<Player>` is one of the `Players` tuples, so
// the two-seat shell may call it as it calls gin's), `apply` and `viewFor` (a function over seats
// 0..3 accepts a seat 0..1), `legalActions`, `over` (the match decided) and the three decoders.
// What does not: `actorOf` returns a seat 0..3, which the contract's `Seat | null` (0..1) cannot
// hold, so its slot here is widened to this engine's `Seat`; a shell that types against the
// contract narrows it at its config boundary (the briscola design's risk 4) until the contract is
// N-seat. `game.ts`'s `Seat`, `Pair`, `SEATS`, `otherSeat` and `setAt` are not used at all.
import type { TwoSeatEngine } from '../../../../shared/lib/game.ts';
import { actorOf, applyAction } from './apply.ts';
import { decodeAction, decodeState, decodeView } from './decode.ts';
import { createGame } from './setup.ts';
import type { Action, CreateGameOptions, Seat, State, View } from './types.ts';
import { legalActions, viewFor } from './view.ts';

/** The two-seat contract with `actorOf` widened to this engine's four seats (see above). */
export type NSeatEngine = Omit<TwoSeatEngine<State, View, Action, CreateGameOptions>, 'actorOf'> &
  Readonly<{ actorOf: (state: State) => Seat | null }>;

export const ENGINE: NSeatEngine = {
  create: createGame,
  apply: applyAction,
  viewFor,
  legalActions,
  actorOf,
  over: (view) => view.matchOver,
  decodeState,
  decodeView,
  decodeAction,
};

export { actorOf, applyAction, canExchange, MESSAGES } from './apply.ts';
export {
  cardById,
  cardName,
  carichiLost,
  deckFor,
  exchangeCardFor,
  idsOf,
  isCardId,
  isCarico,
  makeCard,
  makeDeck,
  pointsOf,
  SUIT_NAME,
  trickFacts,
  trickWinner,
  valueClassOf,
  winningClassOf,
} from './cards.ts';
export {
  decodeAction,
  decodeCard,
  decodeEvent,
  decodeOptions,
  decodeSeat,
  decodeState,
  decodeView,
} from './decode.ts';
export {
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
export type { Detail } from './log.ts';
export {
  freshMatch,
  matchAfter,
  matchOver,
  matchWinner,
  resultOf,
  sideTotals,
  takenOf,
  tricksOf,
} from './score.ts';
export { nextSeat, seatsFrom, seatsOf, seatsOfSide, sideList, sideOf, sidesOf } from './seats.ts';
export {
  createGame,
  drawDealer,
  nextGame,
  normaliseOptions,
  replayGame,
  withPosition,
} from './setup.ts';
export {
  ACTION_TYPES,
  DECK_POINTS,
  DEFAULT_GAMES_TO_WIN,
  DEFAULT_REMOVED_TWO,
  EVENT_KINDS,
  EXCHANGE_RULES,
  GAMES_TO_WIN,
  HAND_SIZE,
  LABEL,
  POINTS,
  RANKS,
  SEAT_COUNTS,
  STRENGTH,
  SUITS,
} from './types.ts';
export type {
  Action,
  Card,
  Cards,
  CreateGameOptions,
  DealData,
  EventKind,
  EventOf,
  Exchange,
  ExchangeData,
  GameData,
  GameEvent,
  GameOptions,
  GameRecord,
  GameResult,
  GamesToWin,
  Match,
  Now,
  Phase,
  Played,
  Player,
  Players,
  Rank,
  ResultData,
  RuleError,
  Seat,
  SeatCount,
  SeatView,
  Side,
  State,
  Suit,
  TrickData,
  TrickFacts,
  TrickRecord,
  ValueClass,
  View,
  WinningClass,
} from './types.ts';
export { lastPlayed, legalActions, viewFor } from './view.ts';
