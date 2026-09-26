// The briscola wire codecs (docs/design/briscola.md §4.3, §5.8 `frames`; docs/design/n-seat-sessions.md
// D3, §7): the seven frames a host and its guests exchange over the PeerJS data channel,
// web/shared/lib/protocol.ts's skeleton over this engine's decoders (the trust boundary,
// docs/ARCHITECTURE.md "Module boundaries"), with two things of this game's. First, the room
// `welcome` and `lobby` carry after `hostName` is the table's six options (`GameOptions` in
// types.ts's order: `seatCount`, `gamesToWin`, `removedTwo`, `exchange`, `scoperta`,
// `partnerPeek`), since a guest must know how many sit down and under which house rules the host
// deals. Second, at three and four seats the same two frames go on to carry the table (`seats`:
// one row per guest seat 1..N-1 in order, its name once it has joined and whether its channel is
// up) and `you`, the receiving guest's own seat, so every guest's waiting screen shows the table
// filling and knows where it sits. Both are ordinary room decoders (D3: the skeleton is not
// edited) and both are optional on the wire: at two seats the builders leave them out, so the
// corpus protocol.test.ts recorded in PR-4 stays byte for byte (its three-seat lobby, from before
// the table was on the wire, decodes as it did), and the 3p-*/4p-* goldens beside it are the new
// shapes. When a frame carries them they are checked against its seat count after the field
// decoders (`seatingFault`): the wrong number of rows, or a seat beyond the table, is refused; the
// shell reads them through `seatingOf`. The room is decoded field by
// field, not through the engine's refined `decodeOptions`, because the skeleton takes one decoder
// per key; the shell normalises what it picks off the frame (`cfg.opts.pick`). `join` and `action`
// carry no seat: the host session knows a guest's seat by its channel (n-seat-sessions.md D1), and
// `joinName` hands the session the name a join carries so a same-named rejoin is reseated (D6).
// No legacy corpus exists for this game; protocol.test.ts records one JSON golden per frame under
// test/fixtures/briscola-wire/ and holds the bytes there. A wire-visible change adds a version
// field to the skeleton.
//
// The live intent mirror (docs/design/briscola-battle.md §4.1): one ephemeral frame, `intent`,
// over the skeleton's lane (`extra.ephemeral`), sent by whichever device's hand is live and never
// game state: `seat` the sender's engine seat, `slot` the index into its engine-order hand (an
// index, never a card id: relayed at four it would leak a hidden card) or null to clear, `mode`
// whether the card is hovered or lifted. Its golden is test/fixtures/briscola-wire/intent.json.
import {
  arrayOf,
  boolean,
  integer,
  literal,
  nullable,
  object,
  optional,
  string,
  type Decoded,
  type Shape,
} from '../../../shared/lib/json.ts';
import {
  isEphemeral as sharedIsEphemeral,
  twoSeatProtocol,
  type ActionFrame as SharedActionFrame,
  type DecodeFailure,
  type Frame as SharedFrame,
  type GuestFrame as SharedGuestFrame,
  type HostFrame as SharedHostFrame,
  type LobbyFrame as SharedLobbyFrame,
  type StateFrame as SharedStateFrame,
  type WelcomeFrame as SharedWelcomeFrame,
} from '../../../shared/lib/protocol.ts';
import { err, type Result } from '../../../shared/lib/result.ts';
import {
  EXCHANGE_RULES,
  GAMES_TO_WIN,
  SEAT_COUNTS,
  SUITS,
  decodeAction,
  decodeView,
  type Action,
  type View,
} from './engine/index.ts';

export {
  DEFAULT_GUEST_NAME,
  EPHEMERAL_TAG,
  NAME_MAX,
  TOAST_MAX,
  WIRE_TAGS,
  guestNameFor,
  isGuestFrame,
  type DecodeFailure,
  type FullFrame,
  type JoinFrame,
  type ToastFrame,
  type WireTag,
} from '../../../shared/lib/protocol.ts';

/** The room after `hostName`: the six options in `GameOptions` order (the host save's own fields too, storage.ts `HostExtra`); `exchange` is `false`, `true` or `'leader'` (D12). */
const options = {
  seatCount: literal(...SEAT_COUNTS),
  gamesToWin: literal(...GAMES_TO_WIN),
  removedTwo: literal(...SUITS),
  exchange: literal(...EXCHANGE_RULES),
  scoperta: boolean,
  partnerPeek: boolean,
};
/** Structurally the engine's `GameOptions`. */
export type Room = Shape<typeof options>;

/** A guest seat as the lobby lists it: its name once its join has been heard (null until then), and whether its channel is up. */
const tableSeat = object({ name: nullable(string), connected: boolean });
export type TableSeat = Decoded<typeof tableSeat>;
/** The largest guest seat: four at the table, the host at 0. */
const MAX_GUEST_SEAT = Math.max(...SEAT_COUNTS) - 1;
/**
 * The table after the options, which the builders add at three and four seats: `seats` is one
 * row per guest seat 1..N-1 in order, `you` the receiving guest's seat. Optional so the two-seat
 * frames, which carry neither, decode as PR-4 recorded them; `seatingFault` checks what is there.
 */
const seating = {
  seats: optional(arrayOf(tableSeat)),
  you: optional(integer(1, MAX_GUEST_SEAT)),
};
export type Seating = Shape<typeof seating>;

const room = { ...options, ...seating };
/** What `welcome` and `lobby` carry after `hostName`: the options, and the seating past two seats. */
type RoomWire = Shape<typeof room>;

/** The engine's seats, the hand's slots (`HAND_SIZE` 3) and the two ways a card is shown, as wire literals. */
export const INTENT_SEATS = [0, 1, 2, 3] as const;
export const INTENT_SLOTS = [0, 1, 2] as const;
export const INTENT_MODES = ['hover', 'raised'] as const;
export type IntentSeat = (typeof INTENT_SEATS)[number];
export type IntentSlot = (typeof INTENT_SLOTS)[number];
export type IntentMode = (typeof INTENT_MODES)[number];
/** The lane's frame, keys in wire order (`t`, `seat`, `slot`, `mode`) so the golden re-encodes byte for byte. */
export type IntentFrame = Readonly<{
  t: 'intent';
  seat: IntentSeat;
  slot: IntentSlot | null;
  mode: IntentMode;
}>;
const intentFrame = object({
  t: literal('intent'),
  seat: literal(...INTENT_SEATS),
  slot: nullable(literal(...INTENT_SLOTS)),
  mode: literal(...INTENT_MODES),
});
/** The builder, keys in wire order. */
export const intent = (
  seat: IntentSeat,
  slot: IntentSlot | null,
  mode: IntentMode,
): IntentFrame => ({
  t: 'intent',
  seat,
  slot,
  mode,
});

export type ActionFrame = SharedActionFrame<Action>;
/** What a host hears: the two guest frames and the lane's. */
export type GuestFrame = SharedGuestFrame<Action> | IntentFrame;
export type WelcomeFrame = SharedWelcomeFrame<RoomWire>;
export type LobbyFrame = SharedLobbyFrame<RoomWire>;
/** `viewFor(game, seat)`: one guest seat's view, after every applied action and on (re)connect. */
export type StateFrame = SharedStateFrame<View>;
/** What a guest hears: the five host frames and the lane's. */
export type HostFrame = SharedHostFrame<View, RoomWire> | IntentFrame;
export type Frame = SharedFrame<Action, View, RoomWire, IntentFrame>;

/** The lane's frame, which the boot sends on whichever session is open (`BootConfig.net.isEphemeral`). */
export const isEphemeral = (frame: Frame): frame is IntentFrame => sharedIsEphemeral(frame);

const protocol = twoSeatProtocol({ decodeAction, decodeView, room }, { ephemeral: intentFrame });

export const { decodeGuestFrame, join, action, full, toast, state } = protocol;

// ---- the seating past two seats -------------------------------------------------------------------

/**
 * Why a decoded welcome or lobby's seating does not fit its seat count, worded as the field
 * decoders word a refusal, or null when it fits: a `seats` it carries has one row per guest seat
 * (N-1), a `you` it carries is one of them. A frame carrying neither fits at every count.
 */
const seatingFault = (frame: WelcomeFrame | LobbyFrame): DecodeFailure | null => {
  const guests = frame.seatCount - 1;
  if (frame.seats !== undefined && frame.seats.length !== guests)
    return `$.seats: expected ${String(guests)} seat rows (seatCount - 1)`;
  if (frame.you !== undefined && frame.you > guests)
    return `$.you: expected integer in [1, ${String(guests)}]`;
  return null;
};

/** The skeleton's verdict, then the seating check on the two room frames. */
const fitted = <F extends Frame>(decoded: Result<F, DecodeFailure>): Result<F, DecodeFailure> => {
  if (!decoded.ok) return decoded;
  const frame = decoded.value;
  const fault = frame.t === 'welcome' || frame.t === 'lobby' ? seatingFault(frame) : null;
  return fault === null ? decoded : err(fault);
};

/** Any of the seven frames; a welcome or lobby must also seat its table (`seatingFault`). */
export const decodeFrame = (raw: unknown): Result<Frame, DecodeFailure> =>
  fitted(protocol.decodeFrame(raw));
/** What a guest accepts from its host, the seating checked; `decodeGuestFrame` is the skeleton's (no guest frame carries a seating). */
export const decodeHostFrame = (raw: unknown): Result<HostFrame, DecodeFailure> =>
  fitted(protocol.decodeHostFrame(raw));

/**
 * The room a welcome or lobby carries: the six options alone at two seats (the corpus PR-4
 * recorded, byte for byte), the table and the receiver's seat after them at three and four.
 */
const seated = (opts: Room, seats: ReadonlyArray<TableSeat>, you: number): RoomWire =>
  opts.seatCount === 2 ? opts : { ...opts, seats, you };

/**
 * The frame sent when a guest's channel opens (the host session's codec, net/host.ts):
 * `frames.welcome(myName, opts, seats, you)` of n-seat-sessions.md §7. `seats` is the table as
 * the host knows it at that moment (the newcomer's own row is not yet named: its join follows).
 */
export const welcome = (
  myName: string,
  opts: Room,
  seats: ReadonlyArray<TableSeat>,
  you: number,
): WelcomeFrame => protocol.welcome(myName, seated(opts, seats, you));

/** Repeated to every seated guest on every seating change while the host waits, each with its own `you` (§7 `frames.lobby`). */
export const lobby = (
  myName: string,
  opts: Room,
  seats: ReadonlyArray<TableSeat>,
  you: number,
): LobbyFrame => protocol.lobby(myName, seated(opts, seats, you));

/** The table a welcome or lobby carries at three or four seats; null at two (the frame carries none). */
export const seatingOf = (
  frame: WelcomeFrame | LobbyFrame,
): Readonly<{ seats: ReadonlyArray<TableSeat>; you: number }> | null =>
  frame.seats !== undefined && frame.you !== undefined
    ? { seats: frame.seats, you: frame.you }
    : null;

/**
 * The name a join carries, null for an action: the host session's `codec.joinName`
 * (n-seat-sessions.md D6), so a guest back from a dead tab is reseated where that name last sat.
 */
export const joinName = (frame: GuestFrame): string | null =>
  frame.t === 'join' ? frame.name : null;
