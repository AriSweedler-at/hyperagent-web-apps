// The gin engine as one module (docs/MIGRATION.md step 10): the 26 names the legacy GinEngine
// block exported, under the same names, plus the types and four names the port added (`sortMeld`,
// `meldSolver`, `DEFAULT_TARGET`, `HAND_SIZE`), and since step 11 the decoders of its shapes
// (decode.ts: `decodeState`, `decodeView`, `decodeAction`, `decodeCard`, `ACTION_TYPES`) that
// protocol.ts and storage.ts run inbound data through. The memo `altCache` is not re-exported: it is
// module state of melds.algorithms.ts, reachable only by its own test. test/parity loads this for
// the `current` leg and step 12 imports it into the UI, net and app layers. Pure: no DOM, no
// clock, no randomness of its own (docs/ARCHITECTURE.md "Module boundaries"). `ENGINE` is the
// engine on the two-seat contract of web/shared/lib/game.ts (DRY round 2, F1): `create` seats the
// players into `createGame`'s options, `over` is the shell's end-screen test (ui/state.ts reads
// `phase === 'gameOver'`), and the rest are the functions below under the contract's names.
import type { TwoSeatEngine } from '../../../../shared/lib/game.ts';
import { decodeAction, decodeState, decodeView } from './decode.ts';
import { actorOf, applyAction, createGame, legalActions } from './game.ts';
import type { Action, CreateGameOptions, State, View } from './types.ts';
import { viewFor } from './view.ts';

/** The home screen's choices for a new game: `createGame`'s options less the seated players. */
export type GameOptions = Omit<CreateGameOptions, 'players'>;

export const ENGINE: TwoSeatEngine<State, View, Action, GameOptions> = {
  create: (players, opts, rng, now) => createGame({ players, ...opts }, rng, now),
  apply: applyAction,
  viewFor,
  legalActions,
  actorOf,
  over: (view) => view.phase === 'gameOver',
  decodeState,
  decodeView,
  decodeAction,
};

export {
  SUITS,
  SUIT_SYMBOL,
  makeDeck,
  shuffle,
  makeCard,
  cardValue,
  sumValue,
  idsOf,
  rankLabel,
  pretty,
  isSet,
  sortCards,
  sortMeld,
} from './cards.ts';
export { allMelds, meldingFromGroups, meldSig } from './melds.ts';
export { bestMelding, allOptimalMeldings, meldSolver } from './melds.algorithms.ts';
export {
  maximalLayoff,
  bestMeldingWithLayoffs,
  fitsOnto,
  extendedMelds,
  canTakeBack,
} from './layoff.ts';
export {
  STOCK_DRAW_FINAL_MSG,
  createGame,
  dealHand,
  applyAction,
  actorOf,
  legalActions,
  inPlay,
  keptHand,
  bestLayoffActions,
} from './game.ts';
export { viewFor } from './view.ts';
export { ACTION_TYPES, decodeAction, decodeCard, decodeState, decodeView } from './decode.ts';
export { KNOCK_LIMIT, GIN_BONUS, UNDERCUT_BONUS, DEFAULT_TARGET, HAND_SIZE } from './types.ts';
export type {
  Action,
  Arrangement,
  Card,
  Cards,
  CreateGameOptions,
  DiscardOption,
  LastAction,
  LastDrawn,
  Knock,
  LaidOff,
  Layoff,
  LayoffEntry,
  LayoffMelding,
  LayoffView,
  Meld,
  MeldGroups,
  Melding,
  Now,
  Outcome,
  Pair,
  PendingDraw,
  Phase,
  PlayerInfo,
  PlayerState,
  Rank,
  RoundRecord,
  RoundResult,
  RuleError,
  ScoredResult,
  Seat,
  State,
  Suit,
  UpcardStage,
  View,
  VoidResult,
} from './types.ts';
