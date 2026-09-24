// The backgammon wire codecs (docs/design/backgammon-board.md §5.2): the seven frames a host
// and its guest exchange over the PeerJS data channel, gin's frame for frame with one change:
// `welcome` and `lobby` carry `matchLength` and `variant` instead of gin's `target`, since the
// guest must know which ruleset the host deals under. Since the shared-shell design (§4.5
// protocol; PR A2) the frames are web/shared/lib/protocol.ts's two-seat skeleton over this
// engine's decoders, which is the trust boundary (docs/ARCHITECTURE.md "Module boundaries");
// what stays here is that room, in emit order after `hostName`, so a decoded frame re-encodes byte
// for byte (R32: every optional is `null`, nothing BinaryPack cannot carry). No legacy corpus
// exists for this game; protocol.test.ts records one JSON golden per frame under
// test/fixtures/backgammon-wire/ and holds the bytes there. A wire-visible change adds a version
// field to the skeleton.
import { integer, literal, type Shape } from '../../../shared/lib/json.ts';
import {
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
  decodeAction,
  decodeView,
  SHIPPED_VARIANTS,
  type Action,
  type View,
} from './engine/index.ts';

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

/**
 * The room after `hostName`: the match length (the engine accepts any length >= 1, R21; the home
 * screen offers 1, 3, 5 and 7) and the shipped variant the host deals under.
 */
const room = { matchLength: integer(1), variant: literal(...SHIPPED_VARIANTS) };
export type Room = Shape<typeof room>;

/** `roll` from a guest asks the host to roll for it (Q9: the host holds the dice). */
export type ActionFrame = SharedActionFrame<Action>;
export type GuestFrame = SharedGuestFrame<Action>;
export type WelcomeFrame = SharedWelcomeFrame<Room>;
export type LobbyFrame = SharedLobbyFrame<Room>;
/** `viewFor(game, 1)`: the guest's seat, after every applied action and on (re)connect. */
export type StateFrame = SharedStateFrame<View>;
export type HostFrame = SharedHostFrame<View, Room>;
export type Frame = SharedFrame<Action, View, Room>;

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
} = twoSeatProtocol({ decodeAction, decodeView, room });
