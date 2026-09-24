// The reducer (rules R7, R12-R14, R19, R21, R22, R26-R28; the turn
// flow, the cube and Crawford, undo, the actor and refusal order): `applyAction(state, seat, action, rng,
// now)` returns a new State or a refusal worded for the player, never mutates, never throws, and
// is the single entry the local reducer and the online host share. A move is legal iff
// `legalMoves` offers it; the turn ends by itself when nothing extends `played` (no `done`
// action); a roll nobody can play passes the turn at once; a double is answered in
// `cubeOffered`; `next` starts the following game of the match. The rng is read only by `roll`
// and by `next` (the opening roll); the clock stamps every log entry.
import { err, ok, type Result } from '../../../../shared/lib/result.ts';
import type { Rng } from '../../../../shared/lib/rng.ts';
import { afterMove, hits, otherSeat, setAt } from './board.ts';
import { expandDice, legalFirstMoves, legalMoves, moveKey } from './moves.ts';
import { diceText, playText, pointName, pointsText } from './notation.ts';
import { matchOver, multiplierFor } from './score.ts';
import { nextGame, rollDie } from './setup.ts';
import {
  CHECKERS,
  CUBE_MAX,
  type Action,
  type Board,
  type CubeValue,
  type Dice,
  type GameRecord,
  type GameResult,
  type LogEntry,
  type LogKind,
  type Move,
  type Multiplier,
  type Now,
  type PlayedMove,
  type ResultReason,
  type Seat,
  type State,
} from './types.ts';
import { rulesOf } from './variants.ts';

/** Refusals, worded for the player who tried (pinned by apply.test.ts). */
export const MESSAGES = {
  NOT_YOUR_TURN: "It's not your turn.",
  GAME_OVER: 'The game is over.',
  MATCH_OVER: 'The match is over.',
  GAME_ON: 'The game is still on.',
  ROLL_FIRST: 'Roll the dice first.',
  ALREADY_ROLLED: "You've already rolled.",
  ILLEGAL_MOVE: "That move isn't legal.",
  NOTHING_TO_UNDO: 'Nothing to undo.',
  NO_CUBE: (variant: string): string => `There is no doubling cube in ${variant}.`,
  CRAWFORD: 'No doubling in the Crawford game.',
  NOT_CUBE_OWNER: "You don't own the cube.",
  CUBE_MAX_MSG: 'The cube is already at 64.',
  CANT_DOUBLE_NOW: "You can't double after rolling.",
  NO_DOUBLE_PENDING: 'No double to answer.',
  ANSWER_DOUBLE: 'Answer the double first.',
} as const;

type Applied = Result<State, string>;

/** Who may act: the mover, the seat answering a double, nobody once the game is over (`next` is open to both). */
export const actorOf = (state: State): Seat | null =>
  state.phase === 'over'
    ? null
    : state.phase === 'cubeOffered'
      ? otherSeat(state.turn)
      : state.turn;

/** R19/R22: before rolling, with a cube the seat owns or nobody owns, outside the Crawford game, below 64. */
export const canDouble = (state: State, seat: Seat): boolean =>
  rulesOf(state.variant).cube &&
  state.phase === 'toRoll' &&
  state.turn === seat &&
  !state.match.isCrawfordGame &&
  (state.cube.owner === null || state.cube.owner === seat) &&
  state.cube.value < CUBE_MAX;

/** The next cube face; 64 is the cap (`canDouble` refuses before this is reached). */
const DOUBLED: Readonly<Record<CubeValue, CubeValue>> = {
  1: 2,
  2: 4,
  4: 8,
  8: 16,
  16: 32,
  32: 64,
  64: 64,
};

const nameOf = (state: State, seat: Seat): string => state.players[seat].name;

const entry = (seat: Seat | null, kind: LogKind, text: string, at: number): LogEntry => ({
  seat,
  kind,
  text,
  at,
});

/** Append entries; the last one becomes `lastAction`. */
const withLog = (state: State, entries: ReadonlyArray<LogEntry>): State => {
  const last = entries.at(-1);
  return last === undefined
    ? state
    : { ...state, log: [...state.log, ...entries], lastAction: last };
};

/**
 * R28: a completed turn logs one `move` line, then one `hit` line per blot sent to the bar and
 * one `bearOff` line with the count, so the history reads in own numbering and the UI cues each.
 */
const turnEntries = (
  state: State,
  seat: Seat,
  played: ReadonlyArray<PlayedMove>,
  at: number,
): ReadonlyArray<LogEntry> => {
  const rules = rulesOf(state.variant);
  const name = nameOf(state, seat);
  const opp = nameOf(state, otherSeat(seat));
  const moved = entry(seat, 'move', `${name} moved ${playText(seat, played, rules)}`, at);
  const hitLines = played
    .filter((m) => m.hit)
    .map((m) =>
      entry(seat, 'hit', `${name} hit ${opp} on the ${pointName(seat, m.to, rules)}-point`, at),
    );
  const off = played.filter((m) => m.to === 'off').length;
  const bore = off > 0 ? [entry(seat, 'bearOff', `${name} bore off ${String(off)}`, at)] : [];
  return [moved, ...hitLines, ...bore];
};

/** R7: the turn flips; the finished play stays as `lastPlay` for the opponent's animation. */
const endTurn = (
  state: State,
  seat: Seat,
  board: Board,
  played: ReadonlyArray<PlayedMove>,
  at: number,
): State =>
  withLog(
    {
      ...state,
      phase: 'toRoll',
      turn: otherSeat(seat),
      board,
      played: [],
      lastPlay: played,
      turnStart: null,
    },
    turnEntries(state, seat, played, at),
  );

const resultText = (multiplier: Multiplier, points: number): string =>
  multiplier === 1
    ? pointsText(points)
    : `a ${multiplier === 2 ? 'gammon' : 'backgammon'} (${pointsText(points)})`;

/**
 * R17/R18/R21: the game ends; points go to the winner's score, the record joins `games`, and the
 * log gains the finishing turn's lines (when a bear-off ended it) and the result line, which names
 * the match winner when the score reaches the length.
 */
const finishGame = (
  state: State,
  winner: Seat,
  multiplier: Multiplier,
  cube: CubeValue,
  reason: ResultReason,
  board: Board,
  played: ReadonlyArray<PlayedMove>,
  at: number,
): State => {
  const points = multiplier * cube;
  const score = setAt(state.match.score, winner, state.match.score[winner] + points);
  const match = { ...state.match, score };
  const result: GameResult = { winner, multiplier, cube, points, reason };
  const record: GameRecord = {
    gameNo: state.gameNo,
    variant: state.variant,
    winner,
    multiplier,
    points,
    reason,
    endedAt: at,
  };
  const took = matchOver(match)
    ? ` and takes the match ${String(score[winner])}–${String(score[otherSeat(winner)])}`
    : '';
  const text = `${nameOf(state, winner)} wins ${resultText(multiplier, points)}${took}`;
  const turnLines = played.length > 0 ? turnEntries(state, state.turn, played, at) : [];
  return withLog(
    {
      ...state,
      phase: 'over',
      board,
      played: [],
      lastPlay: played.length > 0 ? played : state.lastPlay,
      turnStart: null,
      match,
      result,
      games: [...state.games, record],
      endedAt: at,
    },
    [...turnLines, entry(winner, 'result', text, at)],
  );
};

/** R7/R14: two dice from the rng; a roll with no legal play is logged and passes the turn at once. */
const roll = (state: State, seat: Seat, rng: Rng, now: Now): Applied => {
  const dice: Dice = [rollDie(rng), rollDie(rng)];
  const name = nameOf(state, seat);
  const at = now();
  if (legalFirstMoves(state.board, seat, expandDice(dice), rulesOf(state.variant)).length === 0)
    return ok(
      withLog(
        {
          ...state,
          phase: 'toRoll',
          turn: otherSeat(seat),
          dice,
          played: [],
          lastPlay: [],
          turnStart: null,
        },
        [entry(seat, 'noMove', `${name} rolled ${diceText(dice)} and cannot move`, at)],
      ),
    );
  return ok(
    withLog({ ...state, phase: 'moving', dice, played: [], turnStart: state.board }, [
      entry(seat, 'roll', `${name} rolled ${diceText(dice)}`, at),
    ]),
  );
};

/** R12/R13: only a move `legalMoves` offers; the game ends at fifteen off, the turn when nothing extends. */
const move = (state: State, seat: Seat, action: Move, now: Now): Applied => {
  const key = moveKey(action);
  if (!legalMoves(state).some((m) => moveKey(m) === key)) return err(MESSAGES.ILLEGAL_MOVE);
  const rules = rulesOf(state.variant);
  const board = afterMove(state.board, seat, action, rules);
  const played: ReadonlyArray<PlayedMove> = [
    ...state.played,
    {
      from: action.from,
      to: action.to,
      die: action.die,
      hit: hits(state.board, seat, action, rules),
    },
  ];
  const at = now();
  if (board.off[seat] === CHECKERS)
    return ok(
      finishGame(
        state,
        seat,
        multiplierFor(board, seat, rules),
        state.cube.value,
        'borneOff',
        board,
        played,
        at,
      ),
    );
  const next: State = { ...state, phase: 'moving', board, played };
  return ok(legalMoves(next).length === 0 ? endTurn(next, seat, board, played, at) : next);
};

/** R26: back to the board the dice were rolled on; the dice stay, nothing is logged. */
const undo = (state: State): Applied =>
  state.turnStart === null || state.played.length === 0
    ? err(MESSAGES.NOTHING_TO_UNDO)
    : ok({ ...state, board: state.turnStart, played: [] });

/** R19: the refusals in E1's order, then the offer for the opponent to answer. */
const double = (state: State, seat: Seat, now: Now): Applied => {
  const rules = rulesOf(state.variant);
  if (!rules.cube) return err(MESSAGES.NO_CUBE(rules.name));
  if (state.match.isCrawfordGame) return err(MESSAGES.CRAWFORD);
  if (state.cube.owner !== null && state.cube.owner !== seat) return err(MESSAGES.NOT_CUBE_OWNER);
  if (state.cube.value >= CUBE_MAX) return err(MESSAGES.CUBE_MAX_MSG);
  const text = `${nameOf(state, seat)} doubles to ${String(DOUBLED[state.cube.value])}`;
  return ok(withLog({ ...state, phase: 'cubeOffered' }, [entry(seat, 'double', text, now())]));
};

/** R19: the taker owns the cube at twice the value and the doubler rolls. */
const take = (state: State, seat: Seat, now: Now): Applied => {
  const value = DOUBLED[state.cube.value];
  return ok(
    withLog({ ...state, phase: 'toRoll', cube: { value, owner: seat } }, [
      entry(seat, 'take', `${nameOf(state, seat)} takes at ${String(value)}`, now()),
    ]),
  );
};

/** R19: the doubler wins the pre-double value at once. */
const pass = (state: State, seat: Seat, now: Now): Applied => {
  const at = now();
  const passed = withLog(state, [entry(seat, 'pass', `${nameOf(state, seat)} passes`, at)]);
  return ok(
    finishGame(passed, otherSeat(seat), 1, state.cube.value, 'passed', state.board, [], at),
  );
};

const toRollPhase = (state: State, seat: Seat, action: Action, rng: Rng, now: Now): Applied => {
  switch (action.type) {
    case 'roll':
      return roll(state, seat, rng, now);
    case 'double':
      return double(state, seat, now);
    case 'move':
      return err(MESSAGES.ROLL_FIRST);
    case 'undo':
      return err(MESSAGES.NOTHING_TO_UNDO);
    case 'take':
    case 'pass':
      return err(MESSAGES.NO_DOUBLE_PENDING);
    case 'next':
      return err(MESSAGES.GAME_ON);
  }
};

const movingPhase = (state: State, seat: Seat, action: Action, now: Now): Applied => {
  switch (action.type) {
    case 'move':
      return move(state, seat, action, now);
    case 'undo':
      return undo(state);
    case 'roll':
      return err(MESSAGES.ALREADY_ROLLED);
    case 'double':
      return err(MESSAGES.CANT_DOUBLE_NOW);
    case 'take':
    case 'pass':
      return err(MESSAGES.NO_DOUBLE_PENDING);
    case 'next':
      return err(MESSAGES.GAME_ON);
  }
};

const cubePhase = (state: State, seat: Seat, action: Action, now: Now): Applied => {
  switch (action.type) {
    case 'take':
      return take(state, seat, now);
    case 'pass':
      return pass(state, seat, now);
    case 'roll':
    case 'move':
    case 'undo':
    case 'double':
      return err(MESSAGES.ANSWER_DOUBLE);
    case 'next':
      return err(MESSAGES.GAME_ON);
  }
};

/**
 * The reducer. Order of refusals: a finished game takes only `next` (refused once the match is
 * over); `next` elsewhere is refused; a seat that is not the actor is refused (R33); then the
 * phase decides.
 */
export const applyAction = (
  state: State,
  seat: Seat,
  action: Action,
  rng: Rng,
  now: Now,
): Applied => {
  if (state.phase === 'over')
    return action.type !== 'next'
      ? err(MESSAGES.GAME_OVER)
      : matchOver(state.match)
        ? err(MESSAGES.MATCH_OVER)
        : ok(nextGame(state, rng, now));
  if (action.type === 'next') return err(MESSAGES.GAME_ON);
  if (seat !== actorOf(state)) return err(MESSAGES.NOT_YOUR_TURN);
  switch (state.phase) {
    // `opening` is reserved and never emitted (types.ts); were it decoded, it would wait for a roll.
    case 'opening':
    case 'toRoll':
      return toRollPhase(state, seat, action, rng, now);
    case 'moving':
      return movingPhase(state, seat, action, now);
    case 'cubeOffered':
      return cubePhase(state, seat, action, now);
  }
};
