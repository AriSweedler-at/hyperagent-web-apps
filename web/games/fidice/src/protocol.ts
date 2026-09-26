// The fidice wire codecs on the shell path (docs/design/fidice-shell-adoption.md §3 "Protocol and
// sessions", §4 M3; docs/design/n-seat-sessions.md D3, §7): the seven frames a host and its guests
// exchange over the PeerJS data channel, web/shared/lib/protocol.ts's skeleton over this game's
// decoders (codec.ts: the legacy `decodeAction` imported, `decodeView` spelled there), briscola's
// protocol.ts shape for shape. What the room `welcome` and `lobby` carry after `hostName` is the
// table's terms (`Opts`, shellConfig.ts, in the host save's order: `lives`, `seatCount`, `bots`,
// `botChoice`, `watch`), since a guest must know how many chairs the host opened, how many
// computers sit down with it and whether it plays or watches (plan §7 D6, D7, D10). Past two seats
// the same two frames go on to carry the table (`seats`: one row per guest seat 1..N-1, its name
// once it has joined and whether its channel is up) and `you`, the receiving guest's own seat;
// both optional on the wire, left off by the builders at two seats, checked against the seat
// count after the field decoders (`seatingFault`) and read by the shell through `seatingOf`. The
// legacy wire (src/net/protocol.ts `hello`/`act`/`state`/`error`/`info`, its tokens, its
// spectator role) is not spoken here: D5 rejoins by name, D6 keeps no spectator online. The
// N-seat wire pins are the skeleton's (`NAME_MAX` 20, `TOAST_MAX` 500, `DEFAULT_GUEST_NAME`
// 'Jeff', the `{t, hostName, ...room}` key order; plan §7 D1) and the goldens under
// test/fixtures/fidice-wire/ (2p-*, 6p-*) are recorded by protocol.test.ts as briscola's are. A
// wire-visible change adds a version field to the skeleton.
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
import { decodeAction, decodeView } from './codec.ts';
import type { Action, PublicState } from './domain/types.ts';

export {
  DEFAULT_GUEST_NAME,
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

/** The chairs a room may open, the host's included (domain/types.ts `MAX_SEATS` 6; plan §7 D10). */
export const SEAT_COUNTS = [2, 3, 4, 5, 6] as const;
export type SeatCount = (typeof SEAT_COUNTS)[number];
/** At most five computers: one chair is the host's, or a human's when the host watches. */
export const MAX_BOTS = 5;

/**
 * The room after `hostName`: the table's terms in the host save's order (storage.ts `HostExtra`):
 * the kayaks each (0 keeps score), the chairs, the computers and their strategy choice (a
 * bots/registry.ts id or `random`), and whether the host watches instead of taking a chair.
 */
const options = {
  lives: integer(0),
  seatCount: literal(...SEAT_COUNTS),
  bots: integer(0, MAX_BOTS),
  botChoice: string,
  watch: boolean,
};
/** Structurally shellConfig.ts's `Opts`. */
export type Room = Shape<typeof options>;

/** A guest seat as the lobby lists it: its name once its join has been heard (null until then), and whether its channel is up. */
const tableSeat = object({ name: nullable(string), connected: boolean });
export type TableSeat = Decoded<typeof tableSeat>;
/** The largest guest seat: six at the table, the host at 0. */
const MAX_GUEST_SEAT = Math.max(...SEAT_COUNTS) - 1;
/**
 * The table after the options, which the builders add past two seats: `seats` is one row per
 * guest seat 1..N-1 in order, `you` the receiving guest's seat. Optional so a two-seat frame,
 * which carries neither, is the skeleton's literal; `seatingFault` checks what is there.
 */
const seating = {
  seats: optional(arrayOf(tableSeat)),
  you: optional(integer(1, MAX_GUEST_SEAT)),
};
export type Seating = Shape<typeof seating>;

const room = { ...options, ...seating };
/** What `welcome` and `lobby` carry after `hostName`: the options, and the seating past two seats. */
type RoomWire = Shape<typeof room>;

export type ActionFrame = SharedActionFrame<Action>;
/** What a host hears: the two guest frames. */
export type GuestFrame = SharedGuestFrame<Action>;
export type WelcomeFrame = SharedWelcomeFrame<RoomWire>;
export type LobbyFrame = SharedLobbyFrame<RoomWire>;
/** `viewFor(game, seat)`: one guest seat's redaction, after every applied action and on (re)connect. */
export type StateFrame = SharedStateFrame<PublicState>;
/** What a guest hears: the five host frames. */
export type HostFrame = SharedHostFrame<PublicState, RoomWire>;
export type Frame = SharedFrame<Action, PublicState, RoomWire>;

const protocol = twoSeatProtocol({ decodeAction, decodeView, room });

export const { decodeGuestFrame, join, action, full, toast, state } = protocol;

// ---- the seating past two seats -------------------------------------------------------------------

/**
 * Why a decoded welcome or lobby's seating does not fit its seat count, worded as the field
 * decoders word a refusal, or null when it fits: a `seats` it carries has one row per guest seat
 * (N-1), a `you` it carries is one of them. A frame carrying neither fits at every count.
 */
export const seatingFault = (frame: WelcomeFrame | LobbyFrame): DecodeFailure | null => {
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
 * The room a welcome or lobby carries: the options alone at two seats (the skeleton's literal,
 * as gin's and backgammon's), the table and the receiver's seat after them past two.
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

/** The table a welcome or lobby carries past two seats; null at two (the frame carries none). */
export const seatingOf = (
  frame: WelcomeFrame | LobbyFrame,
): Readonly<{ seats: ReadonlyArray<TableSeat>; you: number }> | null =>
  frame.seats !== undefined && frame.you !== undefined
    ? { seats: frame.seats, you: frame.you }
    : null;

/**
 * The name a join carries, null for an action: the host session's `codec.joinName`
 * (n-seat-sessions.md D6; plan §7 D5), so a guest back from a dead tab is reseated where that
 * name last sat, with no token.
 */
export const joinName = (frame: GuestFrame): string | null =>
  frame.t === 'join' ? frame.name : null;
