// Shapes of the gin engine (docs/MIGRATION.md step 10), read off the legacy GinEngine block
// (legacy/gin-rummy/index.html, pinned as test/fixtures/legacy/gin-engine.cjs). Every object the
// engine builds has the legacy keys in the legacy order, so the parity replay can compare the two
// engines' states and views as JSON text. The values live in the modules that build them (cards.ts
// the deck, melds.ts and melds.algorithms.ts the meldings, game.ts the reducer, view.ts the
// redaction); this file holds the types and the scoring constants.

export type Suit = 'S' | 'H' | 'D' | 'C';
/** Ace low only: 1 is the ace, 11..13 the jack, queen and king. */
export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;
/** `id` is the rank label and the suit letter (`AS`, `10H`, `KC`), the key every message uses. */
export type Card = Readonly<{ id: string; r: Rank; s: Suit }>;
export type Cards = ReadonlyArray<Card>;
/** Three or four of a rank, or three or more of a suit in sequence. */
export type Meld = ReadonlyArray<Card>;

/** An index into `State.players`, `hands`, `ready` and `meldPref`. */
export type Seat = 0 | 1;
export type Pair<T> = readonly [T, T];

export type Phase = 'upcard' | 'draw' | 'discard' | 'roundOver' | 'gameOver';
export type UpcardStage = 'nonDealer' | 'dealer';
export type Outcome = 'gin' | 'knock' | 'undercut';

export const KNOCK_LIMIT = 10;
export const GIN_BONUS = 25;
export const UNDERCUT_BONUS = 25;
export const DEFAULT_TARGET = 100;
export const HAND_SIZE = 10;

/** A hand split into melds and deadwood; `value` is the deadwood's point count. */
export type Melding = Readonly<{ melds: ReadonlyArray<Meld>; deadwood: Cards; value: number }>;
/** One of the equally scoring arrangements of a hand; `sig` is its `meldSig`. */
export type Arrangement = Readonly<{
  melds: ReadonlyArray<Meld>;
  deadwood: Cards;
  value: number;
  sig: string;
}>;
/** A card laid off onto the knocker's meld at index `onto`. */
export type LayoffEntry = Readonly<{ card: Card; onto: number }>;
export type Layoff = Readonly<{
  laidOff: ReadonlyArray<LayoffEntry>;
  remaining: Cards;
  extendedMelds: ReadonlyArray<Meld>;
}>;
/** The opponent's answer to a knock: own melds, layoffs and what is left as deadwood. */
export type LayoffMelding = Readonly<{
  melds: ReadonlyArray<Meld>;
  laidOff: ReadonlyArray<LayoffEntry>;
  deadwood: Cards;
  value: number;
  extendedMelds: ReadonlyArray<Meld>;
}>;
/** A player's declared arrangement: groups of card ids (`setMelds`). */
export type MeldGroups = ReadonlyArray<ReadonlyArray<string>>;

export type PlayerInfo = Readonly<{ id: string; name: string }>;
export type PlayerState = Readonly<{ id: string; name: string; total: number }>;

/** What a draw changed, so `undoDraw` can put it back. */
export type PendingDraw = Readonly<{
  from: 'stock' | 'discard';
  cardId: string;
  prevPhase: 'upcard' | 'draw';
  prevUpcardStage: UpcardStage | null;
  prevForceStock: boolean;
  prevTurn: Seat;
}>;
/** The last move, worded for the table; `card` names a card that became public, `by` who moved. */
export type LastAction = Readonly<{ text: string; card?: string; by?: Seat }>;
export type LastDrawn = Readonly<{ p: Seat; id: string }>;

export type ScoredResult = Readonly<{
  void: false;
  knockerIdx: Seat;
  outcome: Outcome;
  knockCard: string;
  knocker: Melding;
  opponent: LayoffMelding;
  scores: Pair<number>;
  scorerIdx: Seat;
  loserIdx: Seat;
  ts: number;
  totals: Pair<number>;
}>;
export type VoidResult = Readonly<{ void: true; ts: number; totals: Pair<number> }>;
export type RoundResult = VoidResult | ScoredResult;

/** A line of the game history; `deadwood` and `scores` are keyed by player id. */
export type RoundRecord =
  | Readonly<{
      handNumber: number;
      ts: number;
      void: true;
      scores: Readonly<Record<string, number>>;
    }>
  | Readonly<{
      handNumber: number;
      ts: number;
      knockerIdx: Seat;
      outcome: Outcome;
      deadwood: Readonly<Record<string, number>>;
      scores: Readonly<Record<string, number>>;
    }>;

/** The host's full game state; players see it through `viewFor` (view.ts). */
export type State = Readonly<{
  players: Pair<PlayerState>;
  target: number;
  dealer: Seat;
  turn: Seat;
  phase: Phase;
  hands: Pair<Cards>;
  stock: Cards;
  discard: Cards;
  upcardStage: UpcardStage | null;
  drawnFromDiscard: string | null;
  forceStock: boolean;
  pendingDraw: PendingDraw | null;
  meldPref: Pair<MeldGroups | null>;
  lastAction: LastAction | null;
  handNumber: number;
  rounds: ReadonlyArray<RoundRecord>;
  result: RoundResult | null;
  ready: Pair<boolean>;
  winner: Seat | null;
  startedAt: number;
  /**
   * The card the last draw added and to whom, for the view's "fresh" mark: set by every draw,
   * cleared by `undoDraw` and by every deal after the first (docs/MIGRATION.md step 15; the legacy
   * dealt over it, so a card drawn in the previous hand showed as "last drawn" when the redeal
   * happened to give it back). Absent until the first draw, as the legacy key was on the wire.
   */
  lastDrawn?: LastDrawn | null;
}>;

export type Action =
  | Readonly<{
      type: 'ready' | 'takeUpcard' | 'passUpcard' | 'drawStock' | 'drawDiscard' | 'undoDraw';
    }>
  | Readonly<{ type: 'discard' | 'knock'; cardId: string }>
  | Readonly<{ type: 'setMelds'; melds: MeldGroups }>;

/** A refused move, worded for the player who tried it; `applyAction` returns `Result<State, RuleError>`. */
export type RuleError = string;

export type CreateGameOptions = Readonly<{
  players: Pair<PlayerInfo>;
  /** Points to win; 100 when absent (or 0, as the legacy `||` read it). */
  target?: number;
  /** Drawn from the rng when absent. */
  dealer?: Seat;
}>;

/** Milliseconds since the epoch, injected (`Date.now` in main.ts, a constant in tests). */
export type Now = () => number;

/** What discarding a card would leave; `locked` marks the card just taken from the discard pile. */
export type DiscardOption =
  Readonly<{ locked: true }> | Readonly<{ deadwood: number; canKnock: boolean; isGin: boolean }>;

/** The redacted per-player view (`viewFor`): the viewer's hand, a count of the other. */
export type View = Readonly<{
  me: Readonly<{
    idx: Seat;
    id: string;
    name: string;
    total: number;
    hand: Cards;
    melds: ReadonlyArray<Meld>;
    deadwood: Cards;
    deadwoodValue: number;
  }>;
  opp: Readonly<{ idx: Seat; id: string; name: string; total: number; cardCount: number }>;
  players: Pair<PlayerState>;
  phase: Phase;
  turn: Seat;
  isMyTurn: boolean;
  dealer: Seat;
  upcardStage: UpcardStage | null;
  stockCount: number;
  discardTop: Card | null;
  discardCount: number;
  drawnFromDiscard: string | null;
  forceStock: boolean;
  lastAction: LastAction | null;
  handNumber: number;
  target: number;
  rounds: ReadonlyArray<RoundRecord>;
  result: RoundResult | null;
  ready: Pair<boolean>;
  winner: Seat | null;
  startedAt: number;
  discardOptions: Readonly<Record<string, DiscardOption>> | null;
  lastDrawnId: string | null;
  canUndo: boolean;
  meldOptions: ReadonlyArray<Arrangement>;
  activeMeldSig: string;
  knockLimit: number;
}>;
