// The decoders the shell path reads fidice's engine through (docs/design/fidice-shell-adoption.md
// §3 "Protocol and sessions", §4 M3): the trust boundary for a `state` frame off the wire, a save
// out of localStorage and a hand-made position (`position/load`). The legacy wire decoded an
// action field by field (src/net/protocol.ts `decodeAction`, KEEP: imported here, never moved)
// and passed the host's state through on a shape check alone (docs/MIGRATION.md "Deviations",
// step 8); the shared protocol skeleton (web/shared/lib/protocol.ts) takes one json.ts decoder per
// payload, so this module spells the two the domain never had, `decodeState` (the host's full
// state, the save's) and `decodeView` (a `PublicState`: a die under a cup the viewer may not see
// is null), field by field in the literals' order (domain/types.ts `State`, game.ts `newGame`,
// publicState.ts `redactFor`), so a decoded value re-encodes byte for byte. `decodeAction` is the
// legacy decoder wrapped into the json.ts shape: its refusal text becomes the error's `expected`
// at the root, so the wire log reads `$.action: expected bid needs a rank 0–251.` where the
// legacy read the sentence alone. Nothing under domain/** changes (the parity oracles hold).
import {
  arrayOf,
  boolean,
  integer,
  literal,
  nullable,
  number,
  object,
  string,
  type Decoder,
} from '../../../shared/lib/json.ts';
import { err } from '../../../shared/lib/result.ts';
import { HAND_COUNT, isRank } from './domain/hands.ts';
import type { Action, PublicState, Rank, Seat, State } from './domain/types.ts';
import { decodeAction as legacyDecodeAction } from './net/protocol.ts';

/** The legacy action decoder (src/net/protocol.ts), its sentence as the root's `expected`. */
export const decodeAction: Decoder<Action> = (input) => {
  const decoded = legacyDecodeAction(input);
  return decoded.ok ? decoded : err({ path: [], expected: decoded.error });
};

/** A chair at the table: 0 .. MAX_SEATS-1 (domain/types.ts `Seat`). */
export const decodeSeat: Decoder<Seat> = literal(0, 1, 2, 3, 4, 5);
/** A row of the ladder: 0 .. 251 (hands.ts `isRank` is the guard). */
export const decodeRank: Decoder<Rank> = (input) =>
  isRank(input)
    ? { ok: true, value: input }
    : err({ path: [], expected: `a rank 0–${String(HAND_COUNT - 1)}` });
const dieValue = literal(1, 2, 3, 4, 5, 6);

const botProfile = object({ strategy: string, random: boolean });
const player = object({
  id: string,
  name: string,
  lives: integer(0),
  losses: integer(0),
  connected: boolean,
  bot: nullable(botProfile),
});
const bid = object({ seat: decodeSeat, rank: decodeRank });
const die = object({ value: dieValue, inCup: boolean });
/** `redactFor` spells a public die `inCup` first (publicState.ts), so the decoder does too and a frame re-encodes byte for byte. */
const publicDie = object({ inCup: boolean, value: nullable(dieValue) });
/** A round's fields but the dice, in the literal's order (game.ts `startRound`). */
const roundHead = {
  holder: decodeSeat,
  bid: nullable(decodeRank),
  bidder: nullable(decodeSeat),
  rolled: boolean,
  touched: boolean,
  history: arrayOf(bid),
};
const round = object({ ...roundHead, dice: arrayOf(die) });
const publicRound = object({ ...roundHead, dice: arrayOf(publicDie) });
const reveal = object({
  dice: arrayOf(dieValue),
  real: decodeRank,
  bid: decodeRank,
  holds: boolean,
  caller: decodeSeat,
  bidder: decodeSeat,
  loser: decodeSeat,
});
const record = object({
  roundNo: integer(0),
  bids: arrayOf(bid),
  bidder: decodeSeat,
  caller: decodeSeat,
  bid: decodeRank,
  real: decodeRank,
  holds: boolean,
  loser: decodeSeat,
});
const logEntry = object({ text: string, big: boolean, at: nullable(number) });

/** The state's fields but the round, in the literal's order (`newGame`); the round differs between the two shapes. */
const stateFields = {
  code: string,
  lives: integer(0),
  phase: literal('lobby', 'playing', 'over'),
  players: arrayOf(player),
  spectators: integer(0),
  roundNo: integer(0),
};
const stateTail = {
  reveal: nullable(reveal),
  winner: nullable(decodeSeat),
  log: arrayOf(logEntry),
  records: arrayOf(record),
  hostSeat: nullable(decodeSeat),
  autoNextAt: nullable(number),
};

/** The host's full state: the save's shape and `position/load`'s. */
export const decodeState: Decoder<State> = object({
  ...stateFields,
  round: nullable(round),
  ...stateTail,
});
/** A viewer's redaction (`redactFor`): the `state` frame's payload. */
export const decodeView: Decoder<PublicState> = object({
  ...stateFields,
  round: nullable(publicRound),
  ...stateTail,
});
