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
  record,
  refine,
  string,
  type Decoder,
} from '../../../../shared/lib/json.ts';
import { err, ok } from '../../../../shared/lib/result.ts';
import { rankLabel } from './cards.ts';
import type {
  Action,
  Arrangement,
  Card,
  DiscardOption,
  LastAction,
  LastDrawn,
  LayoffEntry,
  LayoffMelding,
  Meld,
  MeldGroups,
  Melding,
  Pair,
  PendingDraw,
  Phase,
  PlayerState,
  RoundRecord,
  RoundResult,
  Seat,
  State,
  UpcardStage,
  View,
} from './types.ts';

/** Exactly two items, as a tuple. */
const pair =
  <T>(item: Decoder<T>): Decoder<Pair<T>> =>
  (input) => {
    const items = arrayOf(item)(input);
    if (!items.ok) return items;
    const [a, b] = items.value;
    return items.value.length === 2 && a !== undefined && b !== undefined
      ? ok([a, b])
      : err({ path: [], expected: 'array of 2' });
  };

const seat: Decoder<Seat> = literal(0, 1);
const phase: Decoder<Phase> = literal('upcard', 'draw', 'discard', 'roundOver', 'gameOver');
const upcardStage: Decoder<UpcardStage> = literal('nonDealer', 'dealer');
const outcome = literal('gin', 'knock', 'undercut');
const count = integer(0);
/** Wall-clock milliseconds as the engine's `Now` reports them. */
const timestamp = integer(0);

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
] as const;
const actionHead = object({ type: literal(...ACTION_TYPES) });
const plainAction = object({
  type: literal('ready', 'takeUpcard', 'passUpcard', 'drawStock', 'drawDiscard', 'undoDraw'),
});
const cardAction = object({ type: literal('discard', 'knock'), cardId: string });
const meldsAction = object({ type: literal('setMelds'), melds: meldGroups });

/**
 * A player's move as the wire `action` frame carries it: the type decides which keys must follow.
 * `setMelds` requires `melds` (the step 10 follow-up: the legacy read `action.melds || []`; the UI
 * always sends the key).
 */
const decodeAction: Decoder<Action> = (input) => {
  const head = actionHead(input);
  if (!head.ok) return head;
  switch (head.value.type) {
    case 'ready':
    case 'takeUpcard':
    case 'passUpcard':
    case 'drawStock':
    case 'drawDiscard':
    case 'undoDraw':
      return plainAction(input);
    case 'discard':
    case 'knock':
      return cardAction(input);
    case 'setMelds':
      return meldsAction(input);
  }
};

export { ACTION_TYPES, decodeAction, decodeCard, decodeState, decodeView, pair };
