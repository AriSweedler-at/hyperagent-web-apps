// The briscola engine as one module (docs/design/briscola-rules.md): the UI, protocol and storage
// import only from here. Pure: no DOM, no clock, no randomness of its own; `rng` and `now` are
// injected into `createGame`, `nextGame` and `applyAction` (docs/ARCHITECTURE.md "Module
// boundaries"). N-seat from day one: every entry takes a `Seat` 0..3 and the state's `seatCount`
// says which of them are at the table.
export { actorOf, applyAction, canExchange, MESSAGES } from './apply.ts';
export {
  cardById,
  cardName,
  deckFor,
  exchangeCardFor,
  idsOf,
  isCardId,
  makeCard,
  makeDeck,
  pointsOf,
  SUIT_NAME,
  trickWinner,
} from './cards.ts';
export {
  decodeAction,
  decodeCard,
  decodeOptions,
  decodeSeat,
  decodeState,
  decodeView,
} from './decode.ts';
export {
  dealText,
  exchangeText,
  gameText,
  playText,
  resultText,
  sideName,
  trickText,
} from './log.ts';
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
export { createGame, drawDealer, nextGame, normaliseOptions, withPosition } from './setup.ts';
export {
  ACTION_TYPES,
  DECK_POINTS,
  DEFAULT_GAMES_TO_WIN,
  DEFAULT_REMOVED_TWO,
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
  Exchange,
  GameOptions,
  GameRecord,
  GameResult,
  GamesToWin,
  LogEntry,
  LogKind,
  Match,
  Now,
  Phase,
  Played,
  Player,
  Players,
  Rank,
  Seat,
  SeatCount,
  SeatView,
  Side,
  State,
  Suit,
  TrickRecord,
  View,
} from './types.ts';
export { legalActions, viewFor } from './view.ts';
