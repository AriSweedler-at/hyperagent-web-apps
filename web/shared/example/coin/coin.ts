// The coin game (dry-round-2.md F3; the folder docs/design/test-partition.md reserves): the
// smallest engine on the two-seat contract (web/shared/lib/game.ts `TwoSeatEngine`, D5), `create`,
// `apply`, `viewFor`, `legalActions`, `actorOf`, `over` and byte-stable decoders published as
// `ENGINE` the way gin's and backgammon's engine/index.ts publish theirs, so the shared replay
// driver (test/shared/replay.ts) is proved on a game whose every rng read and every branch can be
// counted, and so the shared-shell integration suite has a real game to boot that is nobody's
// product. Two seats flip a coin in turn: a flip reads the rng once, a pass reads nothing, and the
// first seat to `target` heads wins. The view hides the other seat's last flip, as gin's hides
// the other hand. The seat primitives and the `pair` decoder are web/shared/lib's (F1, F2).
import {
  otherSeat,
  seat as decodeSeat,
  setAt,
  type Now,
  type Pair,
  type Player,
  type Seat,
  type TwoSeatEngine,
} from '../../lib/game.ts';
import {
  boolean,
  integer,
  literal,
  nullable,
  object,
  oneOf,
  pair,
  string,
  type Decoder,
} from '../../lib/json.ts';
import { err, ok, type Result } from '../../lib/result.ts';
import type { Rng } from '../../lib/rng.ts';

export type Face = 'heads' | 'tails';
export type Phase = 'play' | 'over';
export type Action = Readonly<{ type: 'flip' }> | Readonly<{ type: 'pass' }>;
export type Options = Readonly<{
  /** Heads to win; `DEFAULT_TARGET` when absent. */
  target?: number;
}>;

export type State = Readonly<{
  players: Pair<Player>;
  target: number;
  heads: Pair<number>;
  lastFlip: Pair<Face | null>;
  turn: Seat;
  phase: Phase;
  startedAt: number;
  endedAt: number | null;
}>;

export type View = Readonly<{
  me: Readonly<{ idx: Seat; name: string; heads: number; lastFlip: Face | null }>;
  /** The other seat's last flip stays private, as a hand does. */
  opp: Readonly<{ name: string; heads: number }>;
  target: number;
  phase: Phase;
  turn: Seat;
  isMyTurn: boolean;
  /** The winner, once a seat reached the target. */
  result: Seat | null;
  startedAt: number;
}>;

export const DEFAULT_TARGET = 3;

export const MESSAGES = {
  NOT_YOUR_TURN: 'Not your turn',
  GAME_OVER: 'The game is over',
} as const;

/** The first seat is drawn from the rng, as a backgammon opening is: one read. */
export const create = (players: Pair<Player>, opts: Options, rng: Rng, now: Now): State => ({
  players,
  target: opts.target ?? DEFAULT_TARGET,
  heads: [0, 0],
  lastFlip: [null, null],
  turn: rng() < 0.5 ? 0 : 1,
  phase: 'play',
  startedAt: now(),
  endedAt: null,
});

const winnerOf = (s: State): Seat | null =>
  s.heads[0] >= s.target ? 0 : s.heads[1] >= s.target ? 1 : null;

/** A pass changes the turn and reads nothing; a flip reads the rng once and may end the game. */
export const apply = (
  s: State,
  seat: Seat,
  action: Action,
  rng: Rng,
  now: Now,
): Result<State, string> => {
  if (s.phase === 'over') return err(MESSAGES.GAME_OVER);
  if (seat !== s.turn) return err(MESSAGES.NOT_YOUR_TURN);
  if (action.type === 'pass') return ok({ ...s, turn: otherSeat(seat) });
  const face: Face = rng() < 0.5 ? 'heads' : 'tails';
  const heads = setAt(s.heads, seat, s.heads[seat] + (face === 'heads' ? 1 : 0));
  const won = heads[seat] >= s.target;
  return ok({
    ...s,
    heads,
    lastFlip: setAt(s.lastFlip, seat, face),
    turn: otherSeat(seat),
    phase: won ? 'over' : 'play',
    endedAt: won ? now() : null,
  });
};

export const viewFor = (s: State, seat: Seat): View => {
  const opp = otherSeat(seat);
  return {
    me: {
      idx: seat,
      name: s.players[seat].name,
      heads: s.heads[seat],
      lastFlip: s.lastFlip[seat],
    },
    opp: { name: s.players[opp].name, heads: s.heads[opp] },
    target: s.target,
    phase: s.phase,
    turn: s.turn,
    isMyTurn: s.phase === 'play' && s.turn === seat,
    result: winnerOf(s),
    startedAt: s.startedAt,
  };
};

export const legalActions = (view: View): ReadonlyArray<Action> =>
  view.isMyTurn ? [{ type: 'flip' }, { type: 'pass' }] : [];

export const actorOf = (s: State): Seat | null => (s.phase === 'over' ? null : s.turn);

/** The end screen shows: the contract's `over` reads a view, since the shell holds only views. */
export const over = (view: View): boolean => view.phase === 'over';

const face: Decoder<Face> = literal('heads', 'tails');
const phase: Decoder<Phase> = literal('play', 'over');
const player: Decoder<Player> = object({ id: string, name: string });

export const decodeAction: Decoder<Action> = oneOf<Action>(
  object({ type: literal('flip') }),
  object({ type: literal('pass') }),
);

/** The fields in the order `create` and `apply` write them, so the re-encoding is the same text. */
export const decodeState: Decoder<State> = object({
  players: pair(player),
  target: integer(1),
  heads: pair(integer(0)),
  lastFlip: pair(nullable(face)),
  turn: decodeSeat,
  phase,
  startedAt: integer(0),
  endedAt: nullable(integer(0)),
});

export const decodeView: Decoder<View> = object({
  me: object({ idx: decodeSeat, name: string, heads: integer(0), lastFlip: nullable(face) }),
  opp: object({ name: string, heads: integer(0) }),
  target: integer(1),
  phase,
  turn: decodeSeat,
  isMyTurn: boolean,
  result: nullable(decodeSeat),
  startedAt: integer(0),
});

/** The coin on the two-seat contract: what the shared shell boots and the replay driver drives. */
export const ENGINE: TwoSeatEngine<State, View, Action, Options> = {
  create,
  apply,
  viewFor,
  legalActions,
  actorOf,
  over,
  decodeState,
  decodeView,
  decodeAction,
};
