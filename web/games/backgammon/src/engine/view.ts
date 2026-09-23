// The per-seat view (understand.md §5 R13, R24, R26, R33; panel E1 §5 `view.ts` with E2's
// `legalActions` graft). Nothing in backgammon is hidden, so `viewFor` is the state plus the
// selectors the UI needs, computed for the viewer: `legal` and `plays` are non-empty only for the
// seat that is moving, `canDouble` only for the seat that may double, and both seats' views
// carry the same board. The literal is built in types.ts's key order so a `state` frame
// re-encodes byte for byte.
import { actorOf, canDouble } from './apply.ts';
import { canBearOff, otherSeat } from './board.ts';
import { compareMoves, legalMoves, maximalPlays, remainingDice } from './moves.ts';
import { matchOver, pipCount } from './score.ts';
import { PLAYS_CAP, type Action, type Play, type Seat, type State, type View } from './types.ts';
import { rulesOf } from './variants.ts';

/** The canonical order of plays: move by move in `sortMoves`'s order (maximal plays are equally long). */
const comparePlays = (a: Play, b: Play): number =>
  a.reduce((acc, m, i) => (acc !== 0 ? acc : compareMoves(m, b[i] ?? m)), 0);

export const viewFor = (state: State, seat: Seat): View => {
  const rules = rulesOf(state.variant);
  const actor = actorOf(state);
  const isMyTurn = actor === seat;
  const moving = isMyTurn && state.phase === 'moving';
  const plays = moving ? maximalPlays(state.board, seat, remainingDice(state), rules) : [];
  const sortedPlays = [...plays].sort(comparePlays);
  const me = state.players[seat];
  const opp = state.players[otherSeat(seat)];
  return {
    me: { idx: seat, id: me.id, name: me.name },
    opp: { idx: otherSeat(seat), id: opp.id, name: opp.name },
    players: state.players,
    options: state.options,
    variant: state.variant,
    gameNo: state.gameNo,
    phase: state.phase,
    turn: state.turn,
    actor,
    isMyTurn,
    board: state.board,
    opening: state.opening,
    dice: state.dice,
    movesLeft: remainingDice(state),
    played: state.played,
    lastPlay: state.lastPlay,
    legal: moving ? legalMoves(state) : [],
    plays: sortedPlays.slice(0, PLAYS_CAP),
    playsTotal: sortedPlays.length,
    canUndo: moving && state.played.length > 0,
    canDouble: canDouble(state, seat),
    canBearOff: [canBearOff(state.board, 0, rules), canBearOff(state.board, 1, rules)],
    pips: [pipCount(state.board, 0, rules), pipCount(state.board, 1, rules)],
    cube: state.cube,
    match: state.match,
    matchOver: matchOver(state.match),
    result: state.result,
    games: state.games,
    log: state.log,
    lastAction: state.lastAction,
    startedAt: state.startedAt,
    endedAt: state.endedAt,
  };
};

/** Every action the viewer may send now (the replay policy and the `__backgammon` hook use it). */
export const legalActions = (view: View): ReadonlyArray<Action> => {
  if (view.phase === 'over') return view.matchOver ? [] : [{ type: 'next' }];
  if (!view.isMyTurn) return [];
  switch (view.phase) {
    case 'opening':
    case 'toRoll':
      return view.canDouble ? [{ type: 'roll' }, { type: 'double' }] : [{ type: 'roll' }];
    case 'moving': {
      const moves: ReadonlyArray<Action> = view.legal.map((m) => ({
        type: 'move',
        from: m.from,
        to: m.to,
        die: m.die,
      }));
      return view.canUndo ? [...moves, { type: 'undo' }] : moves;
    }
    case 'cubeOffered':
      return [{ type: 'take' }, { type: 'pass' }];
  }
};
