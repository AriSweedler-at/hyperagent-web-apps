// Shapes the fidice domain shares (docs/MIGRATION.md step 8), recovered from how the de-bundled
// modules and the protocol decoders use them. The values live in the modules that build them
// (hands.ts owns the ladder tables, game.ts the reducers); this file holds the types, plus the two
// counts the index types are derived from and the name rule the forms, the seats and the wire
// share, so a later phase can type bots, net and view against the same names.
import type { NameRule } from '../../../../shared/lib/name.ts';

/** The integers 0 .. N-1 as a union of literals: `Below<3>` is `0 | 1 | 2`. */
type Below<N extends number, Acc extends ReadonlyArray<number> = []> = Acc['length'] extends N
  ? Acc[number]
  : Below<N, readonly [...Acc, Acc['length']]>;

/** Rows of the hand ladder: one per multiset of five dice, C(6 + 5 - 1, 5) = 252 (hands.ts). */
export const HAND_COUNT = 252;
/** Chairs at the table (game.ts, lobby.ts). */
export const MAX_SEATS = 6;
/**
 * A player's name: at most 16 characters, 'Player' when nothing is typed (the legacy literals the
 * name form, lobby.ts's seats and the hello frame's cut all spelled; docs/design/dry-round-2.md H4).
 */
export const NAME_RULE: NameRule = { max: 16, fallback: 'Player' };

/** A row of the ladder, 0 (weakest) .. 251 (strongest); `isRank`/`asRank` in hands.ts check one. */
export type Rank = Below<typeof HAND_COUNT>;
/** An index into `State.players`; `seat()` in game.ts is the constructor. */
export type Seat = Below<typeof MAX_SEATS>;
export type DieValue = 1 | 2 | 3 | 4 | 5 | 6;

/** A list with at least one element, for the tables built by grouping. */
export type NonEmpty<T> = readonly [T, ...T[]];

export type Category =
  'high' | 'pair' | 'twopair' | 'trips' | 'straight' | 'fullhouse' | 'quads' | 'five';

/** What five dice show, before ranking: `secondary` is 0 unless the category has a second face. */
export type Shape = Readonly<{
  cat: Category;
  primary: DieValue;
  secondary: DieValue | 0;
  kickers: ReadonlyArray<DieValue>;
}>;

/** A row of the ladder: its shape plus the names the UI and the bid search use. */
export type Hand = Shape &
  Readonly<{
    rank: Rank;
    name: string;
    group: string;
    variant: string;
    groupKey: string;
    dice: ReadonlyArray<DieValue>;
    catLabel: string;
  }>;

/** Hands that share a spoken name (`6s full`), strongest first. */
export type Group = Readonly<{
  key: string;
  cat: Category;
  name: string;
  hands: NonEmpty<Hand>;
  maxRank: Rank;
  minRank: Rank;
  collapsible: boolean;
}>;

export type CategoryInfo = Readonly<{
  cat: Category;
  label: string;
  blurb: string;
  hands: ReadonlyArray<Hand>;
  groups: ReadonlyArray<Group>;
  minRank: Rank;
  maxRank: Rank;
  best: Hand;
}>;

export type Phase = 'lobby' | 'playing' | 'over';

/** `strategy` is a bots/registry id; `random` marks a strategy drawn at random for the seat. */
export type BotProfile = Readonly<{ strategy: string; random: boolean }>;

export type Player = Readonly<{
  id: string;
  name: string;
  lives: number;
  losses: number;
  connected: boolean;
  bot: BotProfile | null;
}>;

export type Die = Readonly<{ value: DieValue; inCup: boolean }>;
export type Bid = Readonly<{ seat: Seat; rank: Rank }>;

export type Round = Readonly<{
  holder: Seat;
  bid: Rank | null;
  bidder: Seat | null;
  rolled: boolean;
  touched: boolean;
  history: ReadonlyArray<Bid>;
  dice: ReadonlyArray<Die>;
}>;

export type Reveal = Readonly<{
  dice: ReadonlyArray<DieValue>;
  real: Rank;
  bid: Rank;
  holds: boolean;
  caller: Seat;
  bidder: Seat;
  loser: Seat;
}>;

export type RoundRecord = Readonly<{
  roundNo: number;
  bids: ReadonlyArray<Bid>;
  bidder: Seat;
  caller: Seat;
  bid: Rank;
  real: Rank;
  holds: boolean;
  loser: Seat;
}>;

export type LogEntry = Readonly<{ text: string; big: boolean; at: number | null }>;

/** The host's full game state; guests and bots see it through `redactFor` (publicState.ts). */
export type State = Readonly<{
  code: string;
  lives: number;
  phase: Phase;
  players: ReadonlyArray<Player>;
  spectators: number;
  roundNo: number;
  round: Round | null;
  reveal: Reveal | null;
  winner: Seat | null;
  log: ReadonlyArray<LogEntry>;
  records: ReadonlyArray<RoundRecord>;
  hostSeat: Seat | null;
  autoNextAt: number | null;
}>;

/** A die as a viewer sees it: `value` is null under a cup the viewer may not look at. */
export type PublicDie = Readonly<{ value: DieValue | null; inCup: boolean }>;
export type PublicRound = Readonly<Omit<Round, 'dice'> & { dice: ReadonlyArray<PublicDie> }>;
export type PublicState = Readonly<Omit<State, 'round'> & { round: PublicRound | null }>;

export type Actor = Readonly<{ kind: 'host' }> | Readonly<{ kind: 'seat'; seat: Seat }>;
export type Viewer = Readonly<{ kind: 'spectator' }> | Readonly<{ kind: 'seat'; seat: Seat }>;

export type Action =
  | Readonly<{ type: 'start' | 'next' | 'peek' | 'call' | 'finish' }>
  | Readonly<{ type: 'pull'; die: number }>
  | Readonly<{
      type: 'roll';
      cup: boolean;
      table: ReadonlyArray<number>;
      intoCup: ReadonlyArray<number>;
    }>
  | Readonly<{ type: 'bid'; rank: Rank }>;

/** A refused move, worded for the player who tried it; the reducers return `Result<State, RuleError>`. */
export type RuleError = string;

/** A row of the bid search (search.ts): a whole group, or one hand of a collapsible group. */
export type Suggestion = Readonly<{
  group: boolean;
  label: string;
  rank: Rank;
  variants: number;
  score: number;
}>;
