// Starting a game (understand.md §5 R3, R5, R6, R21-R23, R27; panel E1 §3 "Opening" and "Match"):
// the starting board from the variant's own-numbered `start`, the one die formula, the opening
// roll (rerolled on a tie) and the `State` literal in types.ts's key order. `createGame` is
// infallible: the option type only admits shipped variants, and the Crawford flags are evaluated
// here as well as in `nextGame`. The winner of the opening roll acts first from `phase 'opening'`:
// in Western play the opening dice are the first turn's roll, in tavli the winner rolls afresh.
import type { Rng } from '../../../../shared/lib/rng.ts';
import { emptyBoard } from './board.ts';
import { diceText } from './notation.ts';
import { crawfordFor } from './score.ts';
import {
  DEFAULT_MATCH_LENGTH,
  DEFAULT_VARIANT,
  type Board,
  type CreateGameOptions,
  type Dice,
  type Die,
  type LogEntry,
  type Match,
  type MatchOptions,
  type Now,
  type Pair,
  type Player,
  type Seat,
  type State,
  type VariantRules,
} from './types.ts';
import { rulesOf } from './variants.ts';

const SEATS: ReadonlyArray<Seat> = [0, 1];

type Placement = Readonly<{ seat: Seat; abs: number; count: number }>;

/** R3 mirrored onto the board for both seats through the variant's frame. */
export const startingBoard = (rules: VariantRules): Board => ({
  points: SEATS.flatMap((seat) =>
    rules.start.map(([own, count]): Placement => ({ seat, abs: rules.absOf(seat, own), count })),
  ).reduce(
    (pts, p) =>
      pts.map((st, i) =>
        i === p.abs ? [...st, ...Array.from({ length: p.count }, () => p.seat)] : st,
      ),
    emptyBoard().points,
  ),
  bar: [0, 0],
  off: [0, 0],
});

/** R27: the one formula every die uses; the cast is safe for an rng in [0, 1) and `min` pins 1. */
export const rollDie = (rng: Rng): Die => Math.min(6, Math.floor(rng() * 6) + 1) as Die;

export type Opening = Readonly<{
  /** The decisive pair, [light, dark]. */
  dice: Pair<Die>;
  winner: Seat;
  /** One `opening` entry per tie ("Both rolled 4 — again"). */
  ties: ReadonlyArray<LogEntry>;
}>;

/** R5/R6: one die each, rerolled together while they tie; the higher die's seat starts. */
export const openingRoll = (rng: Rng, now: Now, ties: ReadonlyArray<LogEntry> = []): Opening => {
  const light = rollDie(rng);
  const dark = rollDie(rng);
  if (light === dark)
    return openingRoll(rng, now, [
      ...ties,
      { seat: null, kind: 'opening', text: `Both rolled ${String(light)} — again`, at: now() },
    ]);
  return { dice: [light, dark], winner: light > dark ? 0 : 1, ties };
};

const gameText = (gameNo: number, isCrawfordGame: boolean): string =>
  `Game ${String(gameNo)} begins${isCrawfordGame ? ' — the Crawford game' : ''}`;

const openingText = (
  players: Pair<Player>,
  opening: Opening,
  firstRoll: Dice | null,
  rules: VariantRules,
): string => {
  const who = `${players[0].name} rolled ${String(opening.dice[0])}, ${players[1].name} rolled ${String(opening.dice[1])} — ${players[opening.winner].name}`;
  return firstRoll === null || rules.openingReroll
    ? `${who} starts`
    : `${who} plays ${diceText(firstRoll)}`;
};

/** Game `gameNo` of a match: the literal in the wire order, every key present (R32). */
const startGame = (
  players: Pair<Player>,
  options: MatchOptions,
  gameNo: number,
  carried: Pick<Match, 'length' | 'score' | 'crawfordDone'>,
  games: State['games'],
  rng: Rng,
  now: Now,
): State => {
  const variant = options.rotation[(gameNo - 1) % options.rotation.length] ?? DEFAULT_VARIANT;
  const rules = rulesOf(variant);
  const board = startingBoard(rules);
  const crawford = crawfordFor(carried, rules);
  const startedAt = now();
  const opening = openingRoll(rng, now);
  const [hi, lo] = [Math.max(...opening.dice), Math.min(...opening.dice)] as Pair<Die>;
  // Western: the opening pair is the first roll (R5); tavli: the winner rerolls (R6).
  const dice: Dice | null = rules.openingReroll ? null : [hi, lo];
  const openingEntry: LogEntry = {
    seat: opening.winner,
    kind: 'opening',
    text: openingText(players, opening, dice, rules),
    at: startedAt,
  };
  return {
    players,
    options,
    variant,
    gameNo,
    phase: 'opening',
    turn: opening.winner,
    board,
    opening: opening.dice,
    dice,
    played: [],
    turnStart: dice === null ? null : board,
    cube: { value: 1, owner: null },
    match: {
      length: carried.length,
      score: carried.score,
      crawfordDone: crawford.crawfordDone,
      isCrawfordGame: crawford.isCrawfordGame,
    },
    result: null,
    games,
    log: [
      { seat: null, kind: 'game', text: gameText(gameNo, crawford.isCrawfordGame), at: startedAt },
      ...opening.ties,
      openingEntry,
    ],
    lastAction: openingEntry,
    startedAt,
    endedAt: null,
  };
};

/** A new match: `matchLength ?? 5`, `rotation` non-empty or ['portes'], then game 1's opening. */
export const createGame = (
  players: Pair<Player>,
  opts: CreateGameOptions,
  rng: Rng,
  now: Now,
): State => {
  const matchLength = opts.matchLength ?? DEFAULT_MATCH_LENGTH;
  const rotation =
    opts.rotation !== undefined && opts.rotation.length > 0 ? opts.rotation : [DEFAULT_VARIANT];
  const options: MatchOptions = {
    matchLength,
    rotation,
    jacoby: false,
    beavers: false,
    automaticDoubles: false,
  };
  const carried = { length: matchLength, score: [0, 0] as Pair<number>, crawfordDone: false };
  return startGame(players, options, 1, carried, [], rng, now);
};

/** R21: the following game of the same match; the finished game's record is already in `games`. */
export const nextGame = (state: State, rng: Rng, now: Now): State =>
  startGame(
    state.players,
    state.options,
    state.gameNo + 1,
    {
      length: state.match.length,
      score: state.match.score,
      crawfordDone: state.match.crawfordDone,
    },
    state.games,
    rng,
    now,
  );

/**
 * `state` with a given position (tests and a sandbox): `turn` to move, mid-turn with `dice`
 * (`turnStart` is the position, nothing played yet) or waiting to roll when `dice` is null.
 */
export const withPosition = (state: State, board: Board, turn: Seat, dice: Dice | null): State => ({
  ...state,
  phase: dice === null ? 'toRoll' : 'moving',
  turn,
  board,
  dice,
  played: [],
  turnStart: dice === null ? null : board,
});
