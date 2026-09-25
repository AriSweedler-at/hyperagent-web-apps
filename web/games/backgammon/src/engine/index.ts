// The backgammon engine as one module (docs/design/backgammon-rules.md): the UI, protocol
// and storage import only from here. Pure: no DOM, no clock, no randomness of its own; `rng` and
// `now` are injected into `createGame`, `nextGame` and `applyAction` (docs/ARCHITECTURE.md
// "Module boundaries"). `ENGINE` is the engine on the two-seat contract of web/shared/lib/game.ts
// (DRY round 2, F1): the functions below under the contract's names, with `over` the shell's
// end-screen test (ui/state.ts reads `view.matchOver`).
import type { TwoSeatEngine } from '../../../../shared/lib/game.ts';
import { actorOf, applyAction } from './apply.ts';
import { decodeAction, decodeState, decodeView } from './decode.ts';
import { createGame } from './setup.ts';
import type { Action, CreateGameOptions, State, View } from './types.ts';
import { legalActions, viewFor } from './view.ts';

export const ENGINE: TwoSeatEngine<State, View, Action, CreateGameOptions> = {
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

export { actorOf, applyAction, canDouble, MESSAGES } from './apply.ts';
export {
  afterMove,
  boardKey,
  canBearOff,
  checkerCount,
  emptyBoard,
  entryPoint,
  highestPoint,
  hits,
  isHomogeneous,
  isOpen,
  isWellFormed,
  otherSeat,
  POINT_INDICES,
  stackAt,
  topIs,
} from './board.ts';
export {
  decodeAction,
  decodeBoard,
  decodeDie,
  decodeMove,
  decodePointIndex,
  decodeSeat,
  decodeState,
  decodeView,
  pair,
} from './decode.ts';
export {
  chainsFrom,
  compareMoves,
  distinctOutcomes,
  expandDice,
  legalFirstMoves,
  legalMoves,
  levelCount,
  maximalPlays,
  moveKey,
  movesEqual,
  movesFrom,
  moveTo,
  playableDepth,
  reachableLevels,
  remainingDice,
  removeOne,
  singleSteps,
  sortMoves,
} from './moves.ts';
export {
  diceText,
  formatPosition,
  moveLabel,
  moveText,
  parseMove,
  parsePosition,
  playText,
  pointName,
  pointsText,
} from './notation.ts';
export { crawfordFor, matchOver, matchWinner, multiplierFor, pipCount, winnerOf } from './score.ts';
export {
  createGame,
  nextGame,
  OPENING_TIE_CAP,
  openingRoll,
  rollDie,
  startingBoard,
  withPosition,
  type Opening,
} from './setup.ts';
export {
  ACTION_TYPES,
  BAR_PIPS,
  CHECKERS,
  CUBE_MAX,
  DEFAULT_MATCH_LENGTH,
  DEFAULT_VARIANT,
  HOME_SIZE,
  MATCH_LENGTHS,
  PLAYS_CAP,
  POINTS,
} from './types.ts';
export type {
  Action,
  Board,
  CreateGameOptions,
  Cube,
  CubeValue,
  Dice,
  Die,
  From,
  GameRecord,
  GameResult,
  LogEntry,
  LogKind,
  Match,
  MatchOptions,
  Move,
  Multiplier,
  Now,
  Pair,
  Phase,
  Play,
  PlayedMove,
  Player,
  PointIndex,
  ResultReason,
  Seat,
  ShippedVariant,
  Stack,
  State,
  To,
  Variant,
  VariantRules,
  View,
} from './types.ts';
export { isShippedVariant, rulesOf, SHIPPED_VARIANTS, VARIANTS } from './variants.ts';
export { legalActions, viewFor } from './view.ts';
