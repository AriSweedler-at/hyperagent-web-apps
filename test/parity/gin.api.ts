// The surface of the legacy gin engine as the parity suites see it (docs/MIGRATION.md steps 2 and
// 10). The legacy engine mutates its state in place; these types say so (no readonly) because the
// characterization tests build positions by assignment. The `current` leg added in step 10 adapts
// the TypeScript engine to this same shape, so test/parity/gin.legacy.test.ts runs unchanged on
// both.
import { createRequire } from 'node:module';

export type Suit = 'S' | 'H' | 'D' | 'C';
export type Card = { id: string; r: number; s: Suit };
export type Rng = () => number;
export type Phase = 'upcard' | 'draw' | 'discard' | 'roundOver' | 'gameOver';
export type Outcome = 'gin' | 'knock' | 'undercut';

export type Player = { id: string; name: string; total: number };
export type Melding = { melds: Card[][]; deadwood: Card[]; value: number };
export type Arrangement = Melding & { sig: string };
export type LayoffEntry = { card: Card; onto: number };
export type LayoffMelding = Melding & { laidOff: LayoffEntry[]; extendedMelds: Card[][] };

export type RoundResult =
  | { void: true; ts: number; totals: number[] }
  | {
      void: false;
      knockerIdx: number;
      outcome: Outcome;
      knockCard: string;
      knocker: Melding;
      opponent: LayoffMelding;
      scores: number[];
      scorerIdx: number;
      loserIdx: number;
      ts: number;
      totals: number[];
    };

export type RoundRecord = {
  handNumber: number;
  ts: number;
  void?: boolean;
  knockerIdx?: number;
  outcome?: Outcome;
  deadwood?: Record<string, number>;
  scores: Record<string, number>;
};

export type PendingDraw = {
  from: 'stock' | 'discard';
  cardId: string;
  prevPhase: Phase;
  prevUpcardStage: string | null;
  prevForceStock: boolean;
  prevTurn: number;
};

export type LastAction = { text: string; card?: string; by?: number };

export type GinState = {
  players: Player[];
  target: number;
  dealer: number;
  turn: number;
  phase: Phase;
  hands: Card[][];
  stock: Card[];
  discard: Card[];
  upcardStage: 'nonDealer' | 'dealer' | null;
  drawnFromDiscard: string | null;
  forceStock: boolean;
  pendingDraw: PendingDraw | null;
  meldPref: (string[][] | null)[];
  lastAction: LastAction | null;
  handNumber: number;
  rounds: RoundRecord[];
  result: RoundResult | null;
  ready: boolean[];
  winner: number | null;
  startedAt: number;
  /** Set by every draw and cleared only by undoDraw; dealHand leaves it alone (the named leak). */
  lastDrawn?: { p: number; id: string } | null;
};

export type GinAction =
  | { type: 'ready' | 'takeUpcard' | 'passUpcard' | 'drawStock' | 'drawDiscard' | 'undoDraw' }
  | { type: 'discard' | 'knock'; cardId: string }
  | { type: 'setMelds'; melds: string[][] };

export type DiscardOption =
  { locked: true } | { locked?: undefined; deadwood: number; canKnock: boolean; isGin: boolean };

export type GinView = {
  me: {
    idx: number;
    id: string;
    name: string;
    total: number;
    hand: Card[];
    melds: Card[][];
    deadwood: Card[];
    deadwoodValue: number;
  };
  opp: { idx: number; id: string; name: string; total: number; cardCount: number };
  players: Player[];
  phase: Phase;
  turn: number;
  isMyTurn: boolean;
  dealer: number;
  upcardStage: string | null;
  stockCount: number;
  discardTop: Card | null;
  discardCount: number;
  drawnFromDiscard: string | null;
  forceStock: boolean;
  lastAction: LastAction | null;
  handNumber: number;
  target: number;
  rounds: RoundRecord[];
  result: RoundResult | null;
  ready: boolean[];
  winner: number | null;
  startedAt: number;
  discardOptions: Record<string, DiscardOption> | null;
  lastDrawnId: string | null;
  canUndo: boolean;
  meldOptions: Arrangement[];
  activeMeldSig: string;
  knockLimit: number;
};

export type ApplyResult = { ok: true; privateCard?: string } | { ok: false; error: string };

export type CreateGameOptions = {
  players: { id: string; name: string }[];
  target?: number;
  dealer?: number;
  rng?: Rng;
};

export type GinEngine = {
  SUITS: Suit[];
  SUIT_SYMBOL: Record<Suit, string>;
  KNOCK_LIMIT: number;
  GIN_BONUS: number;
  UNDERCUT_BONUS: number;
  makeDeck: () => Card[];
  shuffle: (cards: Card[], rng: Rng) => Card[];
  makeCard: (r: number, s: Suit) => Card;
  cardValue: (c: Card) => number;
  sumValue: (cards: Card[]) => number;
  rankLabel: (r: number) => string;
  pretty: (c: Card) => string;
  allMelds: (cards: Card[]) => Card[][];
  bestMelding: (cards: Card[]) => Melding;
  bestMeldingWithLayoffs: (cards: Card[], knockerMelds: Card[][]) => LayoffMelding | null;
  maximalLayoff: (
    cards: Card[],
    knockerMelds: Card[][],
  ) => { laidOff: LayoffEntry[]; remaining: Card[]; extendedMelds: Card[][] };
  isSet: (meld: Card[]) => boolean;
  sortCards: (cards: Card[]) => Card[];
  allOptimalMeldings: (cards: Card[], limit?: number) => Arrangement[];
  meldingFromGroups: (cards: Card[], groups: unknown) => Melding | null;
  meldSig: (melds: Card[][]) => string;
  createGame: (opts: CreateGameOptions) => GinState;
  dealHand: (state: GinState, rng?: Rng) => GinState;
  applyAction: (state: GinState, pIdx: number, action: GinAction, rng?: Rng) => ApplyResult;
  viewFor: (state: GinState, pIdx: number) => GinView;
  legalActions: (view: GinView) => GinAction[];
};

const load = createRequire(import.meta.url);

/** The sha256-pinned legacy engine (test/fixtures/legacy/MANIFEST.json), loaded through its UMD branch. */
export const loadLegacyGin = (): GinEngine =>
  load('../fixtures/legacy/gin-engine.cjs') as GinEngine;
