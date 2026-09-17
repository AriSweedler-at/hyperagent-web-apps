// The surface of the legacy fidice core as the parity suites see it (docs/MIGRATION.md steps 2 and
// 6). Only what the tests call is typed; the fixture exports every top-level binding of the bundle.
// The `current` leg added in step 6 exposes the de-bundled modules under this same shape.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

export type Rng = () => number;
export type Category =
  'high' | 'pair' | 'twopair' | 'trips' | 'straight' | 'fullhouse' | 'quads' | 'five';

export type Shape = { cat: Category; primary: number; secondary: number; kickers: number[] };
export type Hand = Shape & {
  rank: number;
  name: string;
  group: string;
  variant: string;
  groupKey: string;
  dice: number[];
  catLabel: string;
};
export type Group = {
  key: string;
  cat: Category;
  name: string;
  hands: Hand[];
  maxRank: number;
  minRank: number;
  collapsible: boolean;
};
export type CategoryInfo = {
  cat: Category;
  label: string;
  blurb: string;
  hands: Hand[];
  groups: Group[];
  minRank: number;
  maxRank: number;
  best: Hand;
};

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export type BotProfile = { strategy: string; random: boolean };
export type Player = {
  id: string;
  name: string;
  lives: number;
  losses: number;
  connected: boolean;
  bot: BotProfile | null;
};
/** A die as a viewer sees it: `value` is null for a die under a cup the viewer may not see. */
export type DieState = { value: number | null; inCup: boolean };
export type Bid = { seat: number; rank: number };
export type Round = {
  holder: number;
  bid: number | null;
  bidder: number | null;
  rolled: boolean;
  touched: boolean;
  history: Bid[];
  dice: DieState[];
};
export type Reveal = {
  dice: number[];
  real: number;
  bid: number;
  holds: boolean;
  caller: number;
  bidder: number;
  loser: number;
};
export type RoundRecord = {
  roundNo: number;
  bids: Bid[];
  bidder: number;
  caller: number;
  bid: number;
  real: number;
  holds: boolean;
  loser: number;
};
export type LogEntry = { text: string; big: boolean; at: number | null };
export type GamePhase = 'lobby' | 'playing' | 'over';
export type GameState = {
  code: string;
  lives: number;
  phase: GamePhase;
  players: Player[];
  spectators: number;
  roundNo: number;
  round: Round | null;
  reveal: Reveal | null;
  winner: number | null;
  log: LogEntry[];
  records: RoundRecord[];
  hostSeat: number | null;
  autoNextAt: number | null;
};

export type Actor = { kind: 'host' } | { kind: 'seat'; seat: number };
export type Viewer = { kind: 'spectator' } | { kind: 'seat'; seat: number };

export type Action =
  | { type: 'start' | 'next' | 'peek' | 'call' | 'finish' }
  | { type: 'pull'; die: number }
  | { type: 'roll'; cup: boolean; table: number[]; intoCup: number[] }
  | { type: 'bid'; rank: number };

export type ClientMessage =
  | { t: 'hello'; role: 'player' | 'spectator'; name: string | null; token: string | null }
  | { t: 'act'; action: Action };
export type ServerMessage =
  | {
      t: 'state';
      state: GameState;
      you: { seat: number | null; token: string | null; role: 'player' | 'spectator' };
    }
  | { t: 'error' | 'info'; message: string };

export type BotView = { state: GameState; me: number };
export type Step = { delay: number; action: Action };
export type Decision = { step: Step; memory: unknown };
export type Strategy = {
  id: string;
  name: string;
  blurb: string;
  fresh: () => unknown;
  decide: (view: BotView, memory: unknown, rng: Rng) => Decision;
};
export type Memories = Map<string, unknown>;

export type Suggestion = {
  group: boolean;
  label: string;
  rank: number;
  variants: number;
  score: number;
};

export type FidiceCore = {
  // domain/dice
  DIE_VALUES: number[];
  rollDice: (count: number, rng: Rng) => number[];
  // domain/hands
  CATEGORIES: Category[];
  CATEGORY_INFO: CategoryInfo[];
  HAND_COUNT: number;
  TOP_RANK: number;
  BOTTOM_RANK: number;
  HANDS: Hand[];
  GROUPS: Group[];
  isRank: (n: unknown) => boolean;
  asRank: (n: number) => number;
  classify: (dice: number[]) => Shape;
  compareShapes: (a: Shape, b: Shape) => number;
  rankOf: (dice: number[]) => number;
  handAt: (rank: number) => Hand;
  groupOf: (hand: Hand) => Group;
  groupTop: (rank: number) => number;
  spokenName: (rank: number) => string;
  // domain/game + lobby + publicState
  MAX_SEATS: number;
  MIN_PLAYERS: number;
  HOST: Actor;
  bySeat: (seat: number) => Actor;
  newGame: (code: string, lives: number) => GameState;
  makeHuman: (id: string, name: string, lives: number) => Player;
  makeBot: (s: GameState, id: string, profile: BotProfile) => Player;
  seatPlayer: (s: GameState, player: Player) => Result<GameState>;
  startGame: (s: GameState, rng: Rng) => Result<GameState>;
  apply: (s: GameState, actor: Actor, action: Action, rng: Rng) => Result<GameState>;
  canSeeCup: (s: GameState, viewer: Viewer) => boolean;
  redactFor: (s: GameState, viewer: Viewer) => GameState;
  // domain/probability
  survivalFor: (tableDice: number[], cupCount: number) => number[];
  probabilityAtLeast: (tableDice: number[], cupCount: number, rank: number) => number;
  // bots
  POOL: Strategy[];
  SHIPPED: Strategy[];
  RANDOM_STRATEGY: string;
  strategyFor: (profile: BotProfile) => Strategy;
  profileFor: (choice: string, rng: Rng) => BotProfile;
  emptyMemories: Memories;
  decide: (s: GameState, memories: Memories, rng: Rng) => { step: Step; memories: Memories } | null;
  // net/protocol
  decodeAction: (x: unknown) => Result<Action>;
  decodeClientMessage: (x: unknown) => Result<ClientMessage>;
  decodeServerMessage: (x: unknown) => Result<ServerMessage>;
  // domain/search
  tokenize: (text: string) => string[];
  suggestHands: (query: string, above: number | null, limit?: number) => Suggestion[];
};

const load = createRequire(import.meta.url);

/** The sha256-pinned legacy core (test/fixtures/legacy/MANIFEST.json). */
export const loadLegacyFidice = (): FidiceCore =>
  load('../fixtures/legacy/fidice-core.cjs') as FidiceCore;

const FIDICE_DIR = resolve(import.meta.dirname, '..', '..', 'web', 'games', 'fidice');
/** The last de-bundled module inside the legacy fixture's range (docs/MIGRATION.md step 2). */
const LAST_PURE_MODULE = 'src/domain/search.js';

/**
 * The de-bundled modules the fixture range covers, in bundle order (web/games/fidice/MANIFEST.json
 * lists the files in that order). None of them needs a DOM to evaluate: the net/ modules reach
 * `Peer` and `HyperIce` only inside functions, like the fixture.
 */
export const currentFidiceModules = (): ReadonlyArray<string> => {
  const manifest = JSON.parse(readFileSync(resolve(FIDICE_DIR, 'MANIFEST.json'), 'utf8')) as {
    files: Record<string, unknown>;
  };
  const modules = Object.keys(manifest.files).filter((file) => file.startsWith('src/'));
  const last = modules.indexOf(LAST_PURE_MODULE);
  if (last < 0) throw new Error(`${LAST_PURE_MODULE} is not in the manifest`);
  return modules.slice(0, last + 1);
};

/** One de-bundled module's namespace, evaluated in node. */
export const importFidiceModule = (file: string): Promise<Readonly<Record<string, unknown>>> =>
  import(/* @vite-ignore */ `../../web/games/fidice/${file}`) as Promise<
    Readonly<Record<string, unknown>>
  >;

/**
 * The `current` leg (docs/MIGRATION.md step 6): the de-bundled pure modules merged into the same
 * flat surface as the fixture. Top-level names are unique across the bundle, so nothing collides.
 */
export const loadCurrentFidice = async (): Promise<FidiceCore> => {
  const namespaces = await Promise.all(currentFidiceModules().map(importFidiceModule));
  return namespaces.reduce<Record<string, unknown>>(
    (acc, ns) => ({ ...acc, ...ns }),
    {},
  ) as unknown as FidiceCore;
};
