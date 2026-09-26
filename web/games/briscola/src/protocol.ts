// The briscola wire codecs (docs/design/briscola.md §4.3, §5.8 `frames`): the seven frames a host
// and its guest exchange over the PeerJS data channel, web/shared/lib/protocol.ts's two-seat
// skeleton over this engine's decoders (the trust boundary, docs/ARCHITECTURE.md "Module
// boundaries"), with one thing of this game's: the room `welcome` and `lobby` carry after
// `hostName` is the table's six options (`GameOptions` in types.ts's order: `seatCount`,
// `gamesToWin`, `removedTwo`, `exchange`, `scoperta`, `partnerPeek`), since a guest must know how
// many sit down and under which house rules the host deals. The room is decoded field by field,
// not through the engine's refined `decodeOptions`, because the skeleton takes one decoder per key;
// the shell normalises what it picks off the frame (`cfg.opts.pick`), so a frame that turns
// scoperta on at three players seats a legal room. Two seats today: the N-seat lobby (`seats`,
// `you`) is PR-5's and versions nothing here, since the wire corpus below pins only these shapes.
// No legacy corpus exists for this game; protocol.test.ts records one JSON golden per frame under
// test/fixtures/briscola-wire/ and holds the bytes there. A wire-visible change adds a version
// field to the skeleton.
//
// The live intent mirror (docs/design/briscola-battle.md §4.1): one ephemeral frame, `intent`,
// over the skeleton's lane (`extra.ephemeral`), sent by whichever device's hand is live and never
// game state: `seat` the sender's engine seat, `slot` the index into its engine-order hand (an
// index, never a card id: relayed at four it would leak a hidden card) or null to clear, `mode`
// whether the card is hovered or lifted. Its golden is test/fixtures/briscola-wire/intent.json.
import { boolean, literal, nullable, object, type Shape } from '../../../shared/lib/json.ts';
import {
  isEphemeral as sharedIsEphemeral,
  twoSeatProtocol,
  type ActionFrame as SharedActionFrame,
  type Frame as SharedFrame,
  type GuestFrame as SharedGuestFrame,
  type HostFrame as SharedHostFrame,
  type LobbyFrame as SharedLobbyFrame,
  type StateFrame as SharedStateFrame,
  type WelcomeFrame as SharedWelcomeFrame,
} from '../../../shared/lib/protocol.ts';
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
const room = {
  seatCount: literal(...SEAT_COUNTS),
  gamesToWin: literal(...GAMES_TO_WIN),
  removedTwo: literal(...SUITS),
  exchange: literal(...EXCHANGE_RULES),
  scoperta: boolean,
  partnerPeek: boolean,
};
/** Structurally the engine's `GameOptions`. */
export type Room = Shape<typeof room>;

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
export type WelcomeFrame = SharedWelcomeFrame<Room>;
export type LobbyFrame = SharedLobbyFrame<Room>;
/** `viewFor(game, 1)`: the guest's seat, after every applied action and on (re)connect. */
export type StateFrame = SharedStateFrame<View>;
/** What a guest hears: the five host frames and the lane's. */
export type HostFrame = SharedHostFrame<View, Room> | IntentFrame;
export type Frame = SharedFrame<Action, View, Room, IntentFrame>;

/** The lane's frame, which the boot sends on whichever session is open (`BootConfig.net.isEphemeral`). */
export const isEphemeral = (frame: Frame): frame is IntentFrame => sharedIsEphemeral(frame);

export const {
  decodeFrame,
  decodeGuestFrame,
  decodeHostFrame,
  join,
  action,
  welcome,
  lobby,
  full,
  toast,
  state,
} = twoSeatProtocol({ decodeAction, decodeView, room }, { ephemeral: intentFrame });
