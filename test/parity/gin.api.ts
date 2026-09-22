// The surface of the legacy gin engine as the parity suites see it (docs/MIGRATION.md steps 2 and
// 10). The legacy engine mutates its state in place; these types say so (no readonly) because the
// characterization tests build positions by assignment. The `current` leg added in step 10 adapts
// the TypeScript engine to this same shape, so test/parity/gin.legacy.test.ts runs unchanged on
// both.
import { createRequire } from 'node:module';

import * as engine from '../../web/games/gin-rummy/src/engine/index.ts';
import type {
  CreateGameOptions as EngineOptions,
  Seat,
  State,
} from '../../web/games/gin-rummy/src/engine/index.ts';
import { mulberry32 } from '../../web/shared/lib/rng.ts';

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
  /**
   * Set by every draw and cleared by undoDraw. The legacy dealHand leaves it alone (the leak
   * docs/MIGRATION.md step 15 fixes); the current one resets it to null once the key exists.
   */
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
  /** The current engine's addition (docs/design/gin-arrangement-and-discards.md §8); the legacy view has none. */
  discardIds?: string[];
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

/**
 * The `current` leg (docs/MIGRATION.md step 10): the TypeScript engine behind the legacy calling
 * convention. The engine returns a new State; the adapter copies it onto the object the test holds,
 * as the legacy engine's in-place mutation would leave it (the same keys in the same order, so
 * `lastDrawn` still appears only after the first draw). `Result<State, RuleError>` becomes the
 * legacy `{ ok, error }`; the private card a stock draw reported is read from `pendingDraw`.
 * Where the legacy defaulted to `Math.random` (an omitted rng) the adapter passes a fixed seed:
 * every test that consumes randomness passes its own. The clock is `Date.now`, as the legacy read
 * it; the suites mask `ts` and `startedAt`.
 */
export const loadCurrentGin = (): GinEngine => {
  const rngOr = (rng: Rng | undefined): Rng => rng ?? mulberry32(0);
  const adapted = {
    ...engine,
    createGame: (opts: CreateGameOptions): GinState => {
      const { rng, ...rest } = opts;
      return engine.createGame(
        rest as unknown as EngineOptions,
        rngOr(rng),
        Date.now,
      ) as unknown as GinState;
    },
    dealHand: (state: GinState, rng?: Rng): GinState =>
      Object.assign(state, engine.dealHand(state as unknown as State, rngOr(rng))),
    applyAction: (state: GinState, pIdx: number, action: GinAction, rng?: Rng): ApplyResult => {
      const r = engine.applyAction(
        state as unknown as State,
        pIdx as Seat,
        action,
        rngOr(rng),
        Date.now,
      );
      if (!r.ok) return { ok: false, error: r.error };
      Object.assign(state, r.value);
      const drawnFromStock = action.type === 'drawStock' ? r.value.pendingDraw?.cardId : undefined;
      return drawnFromStock === undefined
        ? { ok: true }
        : { ok: true, privateCard: drawnFromStock };
    },
  };
  return adapted as unknown as GinEngine;
};
