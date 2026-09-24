// Decoders for the engine's shapes (rules R32): a `View`
// arriving in a wire `state` frame, a `State` read back from the save and an `Action` from a
// guest are `unknown` until they pass one of these. Built from web/shared/lib/json combinators
// with the fields in types.ts's order, so `JSON.stringify` of a decoded value reproduces the
// engine's own text byte for byte. Structural checks plus the board invariants the engine leans
// on (24 points, fifteen a side, stacks of one owner) and the phase's agreement with the turn
// fields, since a save that disagrees would wedge the game; play legality stays with `applyAction`.
// Only the shipped variants decode: a save naming plakoto or fevga is refused until they ship.
import {
  arrayOf,
  boolean,
  integer,
  literal,
  nullable,
  object,
  oneOf,
  refine,
  string,
  type Decoder,
} from '../../../../shared/lib/json.ts';
import { err, ok } from '../../../../shared/lib/result.ts';
import { isHomogeneous, isWellFormed } from './board.ts';
import {
  ACTION_TYPES,
  POINTS,
  type Action,
  type Board,
  type Cube,
  type CubeValue,
  type Dice,
  type Die,
  type From,
  type GameRecord,
  type GameResult,
  type LogEntry,
  type LogKind,
  type Match,
  type MatchOptions,
  type Move,
  type Multiplier,
  type Pair,
  type Phase,
  type Play,
  type PlayedMove,
  type Player,
  type PointIndex,
  type ResultReason,
  type Seat,
  type ShippedVariant,
  type State,
  type To,
  type View,
} from './types.ts';

/** Exactly two items, as a tuple. */
export const pair =
  <T>(item: Decoder<T>): Decoder<Pair<T>> =>
  (input) => {
    const items = arrayOf(item)(input);
    if (!items.ok) return items;
    const [a, b] = items.value;
    return items.value.length === 2 && a !== undefined && b !== undefined
      ? ok([a, b])
      : err({ path: [], expected: 'array of 2' });
  };

export const decodeSeat: Decoder<Seat> = literal(0, 1);
export const decodeDie: Decoder<Die> = literal(1, 2, 3, 4, 5, 6);
export const decodePointIndex: Decoder<PointIndex> = literal(
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  16,
  17,
  18,
  19,
  20,
  21,
  22,
  23,
);
const shippedVariant: Decoder<ShippedVariant> = literal('portes', 'backgammon');
const phase: Decoder<Phase> = literal('opening', 'toRoll', 'cubeOffered', 'moving', 'over');
const cubeValue: Decoder<CubeValue> = literal(1, 2, 4, 8, 16, 32, 64);
const multiplier: Decoder<Multiplier> = literal(1, 2, 3);
const reason: Decoder<ResultReason> = literal('borneOff', 'passed');
const logKind: Decoder<LogKind> = literal(
  'game',
  'opening',
  'roll',
  'move',
  'hit',
  'bearOff',
  'noMove',
  'double',
  'take',
  'pass',
  'result',
);
const count = integer(0);
/** Wall-clock milliseconds as the engine's `Now` reports them. */
const timestamp = integer(0);

const from: Decoder<From> = oneOf<From>(decodePointIndex, literal('bar'));
const to: Decoder<To> = oneOf<To>(decodePointIndex, literal('off'));
export const decodeMove: Decoder<Move> = object({ from, to, die: decodeDie });
const playedMove: Decoder<PlayedMove> = object({ from, to, die: decodeDie, hit: boolean });
const play: Decoder<Play> = arrayOf(decodeMove);
const dice: Decoder<Dice> = pair(decodeDie);

/** 24 stacks of seat ids, fifteen checkers a side, no stack mixing owners (shipped variants only). */
export const decodeBoard: Decoder<Board> = refine(
  refine(
    object({
      points: refine(arrayOf(arrayOf(decodeSeat)), (pts) => pts.length === POINTS, '24 points'),
      bar: pair(count),
      off: pair(count),
    }),
    isWellFormed,
    'fifteen checkers a side',
  ),
  isHomogeneous,
  'stacks of one owner',
);

const player: Decoder<Player> = object({ id: string, name: string });
const options: Decoder<MatchOptions> = object({
  matchLength: integer(1),
  rotation: refine(arrayOf(shippedVariant), (r) => r.length > 0, 'a non-empty rotation'),
  jacoby: boolean,
  beavers: boolean,
  automaticDoubles: boolean,
});
const cube: Decoder<Cube> = object({ value: cubeValue, owner: nullable(decodeSeat) });
const match: Decoder<Match> = object({
  length: integer(1),
  score: pair(count),
  crawfordDone: boolean,
  isCrawfordGame: boolean,
});
const logEntry: Decoder<LogEntry> = object({
  seat: nullable(decodeSeat),
  kind: logKind,
  text: string,
  at: timestamp,
});
const gameResult: Decoder<GameResult> = object({
  winner: decodeSeat,
  multiplier,
  cube: cubeValue,
  points: count,
  reason,
});
const gameRecord: Decoder<GameRecord> = object({
  gameNo: integer(1),
  variant: shippedVariant,
  winner: decodeSeat,
  multiplier,
  points: count,
  reason,
  endedAt: timestamp,
});

/**
 * The phase decides which turn fields are live: `moving` carries the dice and the turn's starting
 * board, every other phase has nothing played, and `over` is the one phase with a result. The
 * dice may outlive the turn (they show the last roll), so only their absence is checked. A save
 * that disagrees, say `moving` without dice, leaves no action legal for either seat.
 */
const phaseAgrees = (
  s: Pick<State, 'phase' | 'dice' | 'played' | 'result'> & Partial<Pick<State, 'turnStart'>>,
): boolean => {
  const moving = s.phase === 'moving';
  return (
    (!moving || s.dice !== null) &&
    (moving || s.played.length === 0) &&
    (s.turnStart === undefined || (s.turnStart !== null) === moving) &&
    (s.result !== null) === (s.phase === 'over')
  );
};

/** The host's full state, as the save holds it (setup.ts's key order). */
export const decodeState: Decoder<State> = refine(
  object({
    players: pair(player),
    options,
    variant: shippedVariant,
    gameNo: integer(1),
    phase,
    turn: decodeSeat,
    board: decodeBoard,
    opening: pair(decodeDie),
    dice: nullable(dice),
    played: arrayOf(playedMove),
    lastPlay: arrayOf(playedMove),
    turnStart: nullable(decodeBoard),
    cube,
    match,
    result: nullable(gameResult),
    games: arrayOf(gameRecord),
    log: arrayOf(logEntry),
    lastAction: nullable(logEntry),
    startedAt: timestamp,
    endedAt: nullable(timestamp),
  }),
  phaseAgrees,
  'a phase that agrees with dice, played, turnStart and result',
);

const seatInfo = object({ idx: decodeSeat, id: string, name: string });

/** A per-seat view, as a wire `state` frame carries it (view.ts's key order). */
export const decodeView: Decoder<View> = refine(
  object({
    me: seatInfo,
    opp: seatInfo,
    players: pair(player),
    options,
    variant: shippedVariant,
    gameNo: integer(1),
    phase,
    turn: decodeSeat,
    actor: nullable(decodeSeat),
    isMyTurn: boolean,
    board: decodeBoard,
    opening: pair(decodeDie),
    dice: nullable(dice),
    movesLeft: arrayOf(decodeDie),
    played: arrayOf(playedMove),
    lastPlay: arrayOf(playedMove),
    legal: arrayOf(decodeMove),
    plays: arrayOf(play),
    playsTotal: count,
    canUndo: boolean,
    canDouble: boolean,
    canBearOff: pair(boolean),
    pips: pair(count),
    cube,
    match,
    matchOver: boolean,
    result: nullable(gameResult),
    games: arrayOf(gameRecord),
    log: arrayOf(logEntry),
    lastAction: nullable(logEntry),
    startedAt: timestamp,
    endedAt: nullable(timestamp),
  }),
  phaseAgrees,
  'a phase that agrees with dice, played and result',
);

const actionHead = object({ type: literal(...ACTION_TYPES) });
const plainAction = object({ type: literal('roll', 'undo', 'double', 'take', 'pass', 'next') });
const moveAction = object({ type: literal('move'), from, to, die: decodeDie });

/** A player's action as the wire `action` frame carries it: the type decides which keys follow. */
export const decodeAction: Decoder<Action> = (input) => {
  const head = actionHead(input);
  if (!head.ok) return head;
  switch (head.value.type) {
    case 'move':
      return moveAction(input);
    case 'roll':
    case 'undo':
    case 'double':
    case 'take':
    case 'pass':
    case 'next':
      return plainAction(input);
  }
};
