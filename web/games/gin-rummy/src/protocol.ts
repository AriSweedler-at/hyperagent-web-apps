// The gin wire codecs (docs/MIGRATION.md step 11): the seven frames the legacy multiplayer UI
// sends over its PeerJS data channel (legacy/gin-rummy/index.html, `conn.send({ t: ... })`),
// typed and frozen by the recorded corpus test/fixtures/legacy/gin-wire/*.json. Since the
// shared-shell design (§4.5 protocol; PR A2) the frames are web/shared/lib/protocol.ts's two-seat
// skeleton over this engine's decoders, which is the trust boundary (docs/ARCHITECTURE.md
// "Module boundaries"); what stays here is the room, the legacy `target` that `welcome` and
// `lobby` carry after `hostName`, so their JSON is the legacy's byte for byte
// (test/parity/gin.protocol.test.ts). A wire-visible change adds a version field to the skeleton.
import { integer, type Shape } from '../../../shared/lib/json.ts';
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
import { decodeAction, decodeView } from './engine/decode.ts';
import type { Action, View } from './engine/types.ts';

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

/** The room after `hostName`: the legacy `target`, the points that win the game. */
const room = { target: integer(1) };
export type Room = Shape<typeof room>;

export type ActionFrame = SharedActionFrame<Action>;
export type GuestFrame = SharedGuestFrame<Action>;
export type WelcomeFrame = SharedWelcomeFrame<Room>;
export type LobbyFrame = SharedLobbyFrame<Room>;
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
