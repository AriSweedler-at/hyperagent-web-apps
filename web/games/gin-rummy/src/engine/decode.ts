// Decoders for the engine's shapes (docs/MIGRATION.md step 11): a `View` arriving in a wire
// `state` frame and a `State` read back from the `ginRummyMP_v1` save are `unknown` until they pass
// one of these. They are built from web/shared/lib/json combinators with the fields in the order
// the engine's own literals use (game.ts, view.ts, layoff.ts), so `JSON.stringify` of a decoded
// value reproduces the legacy text key for key: the wire goldens and the storage captures re-encode
// byte for byte (test/parity/gin.codecs.test.ts). Structural checks only, plus the one invariant
// the UI leans on (`card.id` is the rank label and the suit); play legality stays with `applyAction`.
import {
  arrayOf,
  boolean,
  integer,
  literal,
  nullable,
  object,
  oneOf,
  optional,
  pair,
  record,
  refine,
  string,
  taggedUnion,
  type Decoder,
} from '../../../../shared/lib/json.ts';
import { count, seat, timestamp } from '../../../../shared/lib/game.ts';
import { rankLabel } from './cards.ts';
import type {
  Action,
  Arrangement,
  Card,
  DiscardOption,
  LastAction,
  LastDrawn,
  Knock,
  LayoffEntry,
  LayoffMelding,
  LayoffView,
  Meld,
  MeldGroups,
  Melding,
  PendingDraw,
  Phase,
  PlayerState,
  RoundRecord,
  RoundResult,
  State,
  UpcardStage,
  View,
} from './types.ts';

// `pair`, `seat`, `count` and `timestamp` are web/shared/lib's since DRY round 2 (F1, F2); `pair`
// is re-exported below because engine tests import it from here.
const phase: Decoder<Phase> = literal(
  'upcard',
  'draw',
  'discard',
  'layoff',
  'roundOver',
  'gameOver',
);
const upcardStage: Decoder<UpcardStage> = literal('nonDealer', 'dealer');
const outcome = literal('gin', 'knock', 'undercut');

const decodeCard: Decoder<Card> = refine(
  object({
    id: string,
    r: literal(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13),
    s: literal('S', 'H', 'D', 'C'),
  }),
  (c) => c.id === rankLabel(c.r) + c.s,
  'a card whose id is its rank label and suit',
);
const cards = arrayOf(decodeCard);
const meld: Decoder<Meld> = refine(cards, (m) => m.length >= 3, 'a meld of three or more cards');
const melds = arrayOf(meld);

const melding: Decoder<Melding> = object({ melds, deadwood: cards, value: count });
const arrangement: Decoder<Arrangement> = object({
  melds,
  deadwood: cards,
  value: count,
  sig: string,
});
const layoffEntry: Decoder<LayoffEntry> = object({ card: decodeCard, onto: count });
/** The knock awaiting the defender's answer (§7b), as the host's save holds it. */
const knock: Decoder<Knock> = object({
  by: seat,
  card: string,
  melding: object({ melds, deadwood: cards, value: count }),
  laidOff: arrayOf(object({ cardId: string, onto: count })),
});
const layoffMelding: Decoder<LayoffMelding> = object({
  melds,
  laidOff: arrayOf(layoffEntry),
  deadwood: cards,
  value: count,
  extendedMelds: melds,
});

const playerState: Decoder<PlayerState> = object({ id: string, name: string, total: integer() });
/** Keyed by player id: the two players' numbers, as `RoundRecord` carries them. */
const byPlayerId = record(integer());

const pendingDraw: Decoder<PendingDraw> = object({
  from: literal('stock', 'discard'),
  cardId: string,
  prevPhase: literal('upcard', 'draw'),
  prevUpcardStage: nullable(upcardStage),
  prevForceStock: boolean,
  prevTurn: seat,
});
const lastAction: Decoder<LastAction> = object({
  text: string,
  card: optional(string),
  by: optional(seat),
});
const lastDrawn: Decoder<LastDrawn> = object({ p: seat, id: string });

const roundResult: Decoder<RoundResult> = oneOf<RoundResult>(
  object({ void: literal(true), ts: timestamp, totals: pair(integer()) }),
  object({
    void: literal(false),
    knockerIdx: seat,
    outcome,
    knockCard: string,
    knocker: melding,
    opponent: layoffMelding,
    scores: pair(integer()),
    scorerIdx: seat,
    loserIdx: seat,
    ts: timestamp,
    totals: pair(integer()),
  }),
);
const roundRecord: Decoder<RoundRecord> = oneOf<RoundRecord>(
  object({ handNumber: integer(1), ts: timestamp, void: literal(true), scores: byPlayerId }),
  object({
    handNumber: integer(1),
    ts: timestamp,
    knockerIdx: seat,
    outcome,
    deadwood: byPlayerId,
    scores: byPlayerId,
  }),
);

/** Groups of card ids, as `setMelds` declares them. */
const meldGroups: Decoder<MeldGroups> = arrayOf(arrayOf(string));

/** The host's full state, as the `ginRummyMP_v1` save holds it (`createGame`'s key order). */
const decodeState: Decoder<State> = object({
  players: pair(playerState),
  target: integer(1),
  dealer: seat,
  turn: seat,
  phase,
  hands: pair(cards),
  stock: cards,
  discard: cards,
  upcardStage: nullable(upcardStage),
  drawnFromDiscard: nullable(string),
  forceStock: boolean,
  pendingDraw: nullable(pendingDraw),
  meldPref: pair(nullable(meldGroups)),
  lastAction: nullable(lastAction),
  handNumber: count,
  rounds: arrayOf(roundRecord),
  result: nullable(roundResult),
  ready: pair(boolean),
  winner: nullable(seat),
  startedAt: timestamp,
  // The named leak (types.ts): absent until the first draw, so optional, and null after undoDraw.
  lastDrawn: optional(nullable(lastDrawn)),
  // The knock being answered (§7b): absent in saves from before the phase, null outside it.
  knock: optional(nullable(knock)),
});

/** What both seats see of a knock being answered (§7b). */
const layoffView: Decoder<LayoffView> = object({
  knocker: seat,
  melds,
  extended: melds,
  laidOff: arrayOf(layoffEntry),
  knockerValue: count,
});

const discardOption: Decoder<DiscardOption> = oneOf<DiscardOption>(
  object({ locked: literal(true) }),
  object({ deadwood: count, canKnock: boolean, isGin: boolean }),
);

/** A redacted view, as a wire `state` frame carries it (`viewFor`'s key order). */
const decodeView: Decoder<View> = object({
  me: object({
    idx: seat,
    id: string,
    name: string,
    total: integer(),
    hand: cards,
    melds,
    deadwood: cards,
    deadwoodValue: count,
  }),
  opp: object({ idx: seat, id: string, name: string, total: integer(), cardCount: count }),
  players: pair(playerState),
  phase,
  turn: seat,
  isMyTurn: boolean,
  dealer: seat,
  upcardStage: nullable(upcardStage),
  stockCount: count,
  discardTop: nullable(decodeCard),
  discardCount: count,
  drawnFromDiscard: nullable(string),
  forceStock: boolean,
  lastAction: nullable(lastAction),
  handNumber: count,
  target: integer(1),
  rounds: arrayOf(roundRecord),
  result: nullable(roundResult),
  ready: pair(boolean),
  winner: nullable(seat),
  startedAt: timestamp,
  discardOptions: nullable(record(discardOption)),
  lastDrawnId: nullable(string),
  canUndo: boolean,
  meldOptions: arrayOf(arrangement),
  activeMeldSig: string,
  knockLimit: count,
  discardIds: optional(arrayOf(string)),
  layoff: optional(layoffView),
});

const ACTION_TYPES = [
  'ready',
  'takeUpcard',
  'passUpcard',
  'drawStock',
  'drawDiscard',
  'undoDraw',
  'discard',
  'knock',
  'setMelds',
  'layOff',
  'takeBack',
  'finishLayoff',
] as const;
const plainAction = object({
  type: literal(
    'ready',
    'takeUpcard',
    'passUpcard',
    'drawStock',
    'drawDiscard',
    'undoDraw',
    'finishLayoff',
  ),
});
const cardAction = object({ type: literal('discard', 'knock', 'takeBack'), cardId: string });
const layOffAction = object({ type: literal('layOff'), cardId: string, onto: count });
const meldsAction = object({ type: literal('setMelds'), melds: meldGroups });

/**
 * A player's move as the wire `action` frame carries it: the type decides which keys must follow,
 * one case per ACTION_TYPES entry in its order (so a refused type names them as before).
 * `setMelds` requires `melds` (the step 10 follow-up: the legacy read `action.melds || []`; the UI
 * always sends the key).
 */
const decodeAction: Decoder<Action> = taggedUnion('type', {
  ready: plainAction,
  takeUpcard: plainAction,
  passUpcard: plainAction,
  drawStock: plainAction,
  drawDiscard: plainAction,
  undoDraw: plainAction,
  discard: cardAction,
  knock: cardAction,
  setMelds: meldsAction,
  layOff: layOffAction,
  takeBack: cardAction,
  finishLayoff: plainAction,
});

export { ACTION_TYPES, decodeAction, decodeCard, decodeState, decodeView, pair };
