// Fidice's guest session on the shell path (docs/design/fidice-shell-adoption.md §4 M3): the
// shared session (web/shared/net/guest.ts, docs/design/shared-shell.md §4.5) with this game's
// protocol.ts as its codec and 'fidice' as the table's game, so it connects to `fidice-<code>`
// (web/shared/lib/roomCode.ts; sessions.test.ts pins it) and runs the shared retry ladder (plan §7
// D4: 40 x 3 s joins, the 12 s stall note, the relay hint) in place of the legacy client's one 12 s
// timeout (src/net/client.ts, on disk unimported until M6). Every constant and message
// ui/state.ts, main.ts and the tests import is re-exported.
import {
  GuestSession as SharedGuestSession,
  type GuestCodec,
  type GuestDeps as SharedGuestDeps,
  type GuestEvents as SharedGuestEvents,
  type GuestOptions as SharedGuestOptions,
} from '../../../../../shared/net/guest.ts';
import { decodeHostFrame, join, type GuestFrame, type HostFrame } from '../../protocol.ts';

export {
  CONNECTED_MSG,
  ERROR_TOAST_MS,
  GUEST_WATCHDOG_MSG,
  JOIN_RETRY_MS,
  MAX_JOIN_TRIES,
  REJOIN_MS,
  STALL_MS,
  connectingMsg,
  foundServiceMsg,
  notFoundMsg,
  reconnectingMsg,
  retryingMsg,
  stalledMsg,
  type GuestContext,
} from '../../../../../shared/net/guest.ts';

export type GuestEvents = SharedGuestEvents<HostFrame>;
export type GuestDeps = SharedGuestDeps<HostFrame>;
export type GuestOptions = Omit<SharedGuestOptions, 'game'>;

const codec: GuestCodec<GuestFrame, HostFrame> = { decode: decodeHostFrame, join };

export class GuestSession extends SharedGuestSession<GuestFrame, HostFrame> {
  constructor(deps: GuestDeps, opts: GuestOptions) {
    super(deps, codec, { ...opts, game: 'fidice' });
  }
}
