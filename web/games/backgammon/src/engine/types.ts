// Shapes of the backgammon engine (docs/design/backgammon-rules.md §2; rules R1,
// R29, R32). The board is 24 ordered stacks of seat ids in an absolute 0..23 frame plus
// bar/off pairs: homogeneous in portes and Western backgammon, ordered so plakoto's pinning fits
// without a second representation. Every rule speaks the mover's own 1..24 numbering through the
// variant's `ownOf`/`absOf`. Key order here is the wire/save order: setup.ts builds every literal
// in it and decode.ts declares the fields in it, so a decoded value re-encodes byte for byte. The
// seat, the pair, the player and the clock are web/shared/lib/game.ts's (DRY round 2, F1),
// re-exported here under the names every backgammon module imports, so no import path changed.
import type { Pair, Player, Seat } from '../../../../shared/lib/game.ts';

export type { Now, Pair, Player, Seat } from '../../../../shared/lib/game.ts';

export type Die = 1 | 2 | 3 | 4 | 5 | 6;
/** A roll as rolled (Western opening: [hi, lo]); `null` before the first roll of a tavli game. */
export type Dice = Pair<Die>;
export type PointIndex =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18
  | 19
  | 20
  | 21
  | 22
  | 23;
/** Owners bottom -> top. Homogeneous in portes/backgammon; plakoto pins by pushing on top. */
export type Stack = ReadonlyArray<Seat>;
export type Board = Readonly<{
  /** Length 24, absolute: Light (seat 0) moves 23 -> 0, Dark (seat 1) moves 0 -> 23. */
  points: ReadonlyArray<Stack>;
  bar: Pair<number>;
  off: Pair<number>;
}>;
export type From = PointIndex | 'bar';
export type To = PointIndex | 'off';
/**
 * `die` is part of a move's identity: with 6-5 and a lone checker on own 4, 4/off with the 6 and
 * 4/off with the 5 are different moves (R16), so the UI must key moves by (from, to, die).
 */
export type Move = Readonly<{ from: From; to: To; die: Die }>;
/** A move as played: `hit` is read off the board before the move (the toast and the `*` use it). */
export type PlayedMove = Readonly<{ from: From; to: To; die: Die; hit: boolean }>;
/** One maximal play: the single-die moves of a turn, in order. */
export type Play = ReadonlyArray<Move>;

export type Variant = 'portes' | 'backgammon' | 'plakoto' | 'fevga';
/** The two the engine plays; `createGame` is typed on this so an unimplemented variant cannot start. */
export type ShippedVariant = 'portes' | 'backgammon';

/**
 * `opening` is reserved and never emitted in v1: `createGame`/`nextGame` resolve the opening roll,
 * so a game starts in `moving` (Western: the winner plays the opening pair) or `toRoll` (tavli: the
 * winner rerolls). There is no `toDouble` phase (a double is legal in `toRoll` when `canDouble`)
 * and no `done` action (the turn ends by itself when the play is complete, R13).
 */
export type Phase = 'opening' | 'toRoll' | 'cubeOffered' | 'moving' | 'over';

export type CubeValue = 1 | 2 | 4 | 8 | 16 | 32 | 64;
export type Cube = Readonly<{ value: CubeValue; owner: Seat | null }>;
/** 1 single, 2 gammon (a diplo in tavli), 3 backgammon (Western only). */
export type Multiplier = 1 | 2 | 3;

export type Match = Readonly<{
  /** Points to win; >= 1 (the UI offers 1, 3, 5, 7). The winner is derived: `matchWinner`. */
  length: number;
  /** Includes the finished game's points once `phase === 'over'`. */
  score: Pair<number>;
  crawfordDone: boolean;
  /** This game is the Crawford game (no doubling); always false in cube-less variants. */
  isCrawfordGame: boolean;
}>;
export type MatchOptions = Readonly<{
  matchLength: number;
  /** Game n is played under rotation[(n - 1) % rotation.length]. */
  rotation: ReadonlyArray<ShippedVariant>;
  /** Money-play flags (R20): stored so tests can pin them off; no behaviour in v1. */
  jacoby: boolean;
  beavers: boolean;
  automaticDoubles: boolean;
}>;

/** `kind` lets the UI cue sounds and toasts without parsing `text`. */
export type LogKind =
  | 'game'
  | 'opening'
  | 'roll'
  | 'move'
  | 'hit'
  | 'bearOff'
  | 'noMove'
  | 'double'
  | 'take'
  | 'pass'
  | 'result';
export type LogEntry = Readonly<{ seat: Seat | null; kind: LogKind; text: string; at: number }>;

export type ResultReason = 'borneOff' | 'passed';
export type GameResult = Readonly<{
  winner: Seat;
  multiplier: Multiplier;
  /** The cube value the points were multiplied by (the pre-double value on a pass). */
  cube: CubeValue;
  points: number;
  reason: ResultReason;
}>;
export type GameRecord = Readonly<{
  gameNo: number;
  variant: ShippedVariant;
  winner: Seat;
  multiplier: Multiplier;
  points: number;
  reason: ResultReason;
  endedAt: number;
}>;

/** The host's full state (R1); nothing is hidden, `viewFor` adds per-seat selectors. */
export type State = Readonly<{
  players: Pair<Player>;
  options: MatchOptions;
  /** This game's variant (from the rotation). */
  variant: ShippedVariant;
  /** 1-based. */
  gameNo: number;
  phase: Phase;
  /** Never null: the opening roll is resolved before the state exists. */
  turn: Seat;
  board: Board;
  /** The decisive (untied) opening dice, [light, dark]. */
  opening: Pair<Die>;
  /** The last roll; null before the first roll of a tavli game. `movesLeft` is derived from it. */
  dice: Dice | null;
  /** This turn's moves in order; `remainingDice` is the roll minus their dice. */
  played: ReadonlyArray<PlayedMove>;
  /** The previous completed turn's `played` (the opponent's moves animate from it); [] at a game's start and after a forfeited roll. */
  lastPlay: ReadonlyArray<PlayedMove>;
  /** The board when the dice were rolled (undo target); non-null iff the mover is moving. */
  turnStart: Board | null;
  cube: Cube;
  match: Match;
  /** Non-null iff `phase === 'over'`. */
  result: GameResult | null;
  /** Finished games of this match, this one included once it is over. */
  games: ReadonlyArray<GameRecord>;
  /** This game's entries, oldest first. */
  log: ReadonlyArray<LogEntry>;
  lastAction: LogEntry | null;
  startedAt: number;
  endedAt: number | null;
}>;

export const ACTION_TYPES = ['roll', 'move', 'undo', 'double', 'take', 'pass', 'next'] as const;
export type Action =
  | Readonly<{ type: 'roll' | 'undo' | 'double' | 'take' | 'pass' | 'next' }>
  | Readonly<{ type: 'move'; from: From; to: To; die: Die }>;

/** The per-seat view: the state plus the selectors the UI needs, `legal` for the actor only. */
export type View = Readonly<{
  me: Readonly<{ idx: Seat; id: string; name: string }>;
  opp: Readonly<{ idx: Seat; id: string; name: string }>;
  players: Pair<Player>;
  options: MatchOptions;
  variant: ShippedVariant;
  gameNo: number;
  phase: Phase;
  turn: Seat;
  /** Who may act now; null when the game is over (either seat may send `next`). */
  actor: Seat | null;
  isMyTurn: boolean;
  board: Board;
  opening: Pair<Die>;
  dice: Dice | null;
  /** The dice still to play; [] when nobody is moving. */
  movesLeft: ReadonlyArray<Die>;
  played: ReadonlyArray<PlayedMove>;
  lastPlay: ReadonlyArray<PlayedMove>;
  /** My legal next moves (sorted by `moveKey`) when I am moving; else []. */
  legal: ReadonlyArray<Move>;
  /** The maximal plays consistent with `played`, canonical order, at most PLAYS_CAP; else []. */
  plays: ReadonlyArray<Play>;
  /** The true count: `plays.length < playsTotal` iff the list was truncated. */
  playsTotal: number;
  canUndo: boolean;
  canDouble: boolean;
  canBearOff: Pair<boolean>;
  pips: Pair<number>;
  cube: Cube;
  match: Match;
  matchOver: boolean;
  result: GameResult | null;
  games: ReadonlyArray<GameRecord>;
  log: ReadonlyArray<LogEntry>;
  lastAction: LogEntry | null;
  startedAt: number;
  endedAt: number | null;
}>;

/** What differs between the four tavli-family games (R29); only two rows are `implemented`. */
export type VariantRules = Readonly<{
  implemented: boolean;
  /** For log and error text. */
  name: string;
  hasBar: boolean;
  /** R6: the opening winner rerolls both dice (tavli) instead of playing the opening pair. */
  openingReroll: boolean;
  cube: boolean;
  maxMultiplier: 2 | 3;
  /** Opposing checkers that close a point (fevga closes on one). */
  blocksAt: 1 | 2;
  onSingleOpponent: 'hit' | 'pin' | 'illegal';
  /** Fevga: both seats travel the same way, so Dark's frame is a rotation, not a mirror. */
  sameDirection: boolean;
  /** Starting checkers per seat as [own point, count]; `startingBoard` mirrors them via `absOf`. */
  start: ReadonlyArray<readonly [number, number]>;
  /** The mover's own 1..24 numbering of an absolute point, and back. */
  ownOf: (seat: Seat, abs: PointIndex) => number;
  absOf: (seat: Seat, own: number) => PointIndex;
  /**
   * Board-only predicates a single step must pass (fevga's first-checker and prime rules); the
   * enumeration deduplicates by board, so a history-dependent rule could never be honoured here.
   */
  extraMoveConstraints: ReadonlyArray<(board: Board, seat: Seat, move: Move) => boolean>;
  /** Plakoto's mother rule: an end the bear-off count does not see; [] for the shipped variants. */
  extraEndChecks: ReadonlyArray<
    (board: Board) => Readonly<{ winner: Seat; multiplier: Multiplier }> | null
  >;
}>;

export type CreateGameOptions = Readonly<{
  /** DEFAULT_MATCH_LENGTH when absent. */
  matchLength?: number;
  /** [DEFAULT_VARIANT] when absent or empty. */
  rotation?: ReadonlyArray<ShippedVariant>;
}>;

export const POINTS = 24;
export const CHECKERS = 15;
/** A checker on the bar is 25 pips from home. */
export const BAR_PIPS = 25;
export const HOME_SIZE = 6;
/** R19 says no cap; 128 cannot matter in a match of 7 and would break the literal type. */
export const CUBE_MAX: CubeValue = 64;
/** A doubles position can reach tens of thousands of plays; a `state` frame carries this many. */
export const PLAYS_CAP = 512;
export const MATCH_LENGTHS: ReadonlyArray<number> = [1, 3, 5, 7];
export const DEFAULT_MATCH_LENGTH = 5;
export const DEFAULT_VARIANT: ShippedVariant = 'portes';
