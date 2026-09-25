// The two-seat primitives both engines spelled for themselves (DRY round 2, F1;
// docs/design/shared-shell.md §4.3 `cfg.engine`): the seat, the pair it indexes, the player the
// host seats, the injected clock and the refusal text, with the three helpers gin's game.ts and
// backgammon's board.ts and setup.ts each declared (`SEATS`, `otherSeat`, `setAt`) and the three
// decoders both decode.ts files opened with (`seat`, `count`, `timestamp`). `TwoSeatEngine` is the
// surface a two-seat engine publishes: each `engine/index.ts` exports its `ENGINE` typed on it, so
// the shared shell's `cfg.engine` (C2), the seeded replay harness (F3) and the codecs type against
// one contract and a fourth game writes an engine to this shape. Each game's `engine/types.ts`
// re-exports the types under the names its modules import, so no import path changed.
import { integer, literal, type Decoder } from './json.ts';
import type { Result } from './result.ts';
import type { Rng } from './rng.ts';

/** An index into every per-player pair: `players`, `hands`, `ready`, `score`, `bar`, `off`. */
export type Seat = 0 | 1;
export type Pair<T> = readonly [T, T];
/** Who sits where: the peer's id and the name the home screen was given. */
export type Player = Readonly<{ id: string; name: string }>;
/** Milliseconds since the epoch, injected (`Date.now` in main.ts, a constant in tests). */
export type Now = () => number;
/** A refused move, worded for the player who tried it; `apply` returns `Result<S, RuleError>`. */
export type RuleError = string;

export const SEATS: ReadonlyArray<Seat> = [0, 1];
export const otherSeat = (seat: Seat): Seat => (seat === 0 ? 1 : 0);
export const setAt = <T>(pair: Pair<T>, seat: Seat, value: T): Pair<T> =>
  seat === 0 ? [value, pair[1]] : [pair[0], value];

export const seat: Decoder<Seat> = literal(0, 1);
/** A non-negative count: hand sizes, pips, points, a meld index. */
export const count: Decoder<number> = integer(0);
/** Wall-clock milliseconds as the engine's `Now` reports them. */
export const timestamp: Decoder<number> = integer(0);

/**
 * What a two-seat engine publishes, pure and injected (docs/ARCHITECTURE.md "Module boundaries":
 * no DOM, no clock, no randomness of its own). `S` is the host's full state, `V` the per-seat
 * view `viewFor` redacts it to, `A` an action, `Opts` what the home screen chooses for a new game
 * (gin's target and dealer, backgammon's match length and rotation).
 */
export type TwoSeatEngine<S, V, A, Opts> = Readonly<{
  /** A new game for two seated players under `opts`; `rng` draws the dealer or the opening roll. */
  create: (players: Pair<Player>, opts: Opts, rng: Rng, now: Now) => S;
  /** The reducer: a new state or a refusal worded for `seat`; never mutates, never throws. */
  apply: (state: S, seat: Seat, action: A, rng: Rng, now: Now) => Result<S, RuleError>;
  /** The only redaction: what `seat` may see of the state. */
  viewFor: (state: S, seat: Seat) => V;
  /** Every action the viewer may send now, in the engine's order. */
  legalActions: (view: V) => ReadonlyArray<A>;
  /** Who may act now; null when nobody may (backgammon's finished game before `next`). */
  actorOf: (state: S) => Seat | null;
  /** The end screen shows and the save is not resumable: gin's `gameOver`, backgammon's won match. */
  over: (view: V) => boolean;
  /** The save's `State`, the wire's `View` and a guest's `Action`, each in its literal key order. */
  decodeState: Decoder<S>;
  decodeView: Decoder<V>;
  decodeAction: Decoder<A>;
}>;
