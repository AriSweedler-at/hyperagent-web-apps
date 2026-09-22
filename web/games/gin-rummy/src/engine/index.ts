// The gin engine as one module (docs/MIGRATION.md step 10): the 26 names the legacy GinEngine
// block exported, under the same names, plus the types and four names the port added (`sortMeld`,
// `meldSolver`, `DEFAULT_TARGET`, `HAND_SIZE`), and since step 11 the decoders of its shapes
// (decode.ts: `decodeState`, `decodeView`, `decodeAction`, `decodeCard`, `ACTION_TYPES`) that
// protocol.ts and storage.ts run inbound data through. The memo `altCache` is not re-exported: it is
// module state of melds.algorithms.ts, reachable only by its own test. test/parity loads this for
// the `current` leg and step 12 imports it into the UI, net and app layers. Pure: no DOM, no
// clock, no randomness of its own (docs/ARCHITECTURE.md "Module boundaries").
export {
  SUITS,
  SUIT_SYMBOL,
  makeDeck,
  shuffle,
  makeCard,
  cardValue,
  sumValue,
  rankLabel,
  pretty,
  isSet,
  sortCards,
  sortMeld,
} from './cards.ts';
export { allMelds, meldingFromGroups, meldSig } from './melds.ts';
export { bestMelding, allOptimalMeldings, meldSolver } from './melds.algorithms.ts';
export { maximalLayoff, bestMeldingWithLayoffs } from './layoff.ts';
export { STOCK_DRAW_FINAL_MSG, createGame, dealHand, applyAction, legalActions } from './game.ts';
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
  Layoff,
  LayoffEntry,
  LayoffMelding,
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
