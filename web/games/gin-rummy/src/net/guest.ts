// Gin's guest session: the shared two-seat session (web/shared/net/guest.ts, gin's own moved there
// by docs/design/shared-shell.md A1) with gin's protocol.ts as its codec and 'gin-rummy' as the
// room's game, so it connects to `ginrummy-ari-<CODE>` and joins with gin's `{t: 'join', name}`
// byte for byte (test/parity/gin.sessions.test.ts). Every constant and message ui/state.ts,
// main.ts and the tests import is re-exported.
import {
  GuestSession as SharedGuestSession,
  type GuestCodec,
  type GuestDeps as SharedGuestDeps,
  type GuestEvents as SharedGuestEvents,
  type GuestOptions as SharedGuestOptions,
} from '../../../../shared/net/guest.ts';
import { decodeHostFrame, join, type GuestFrame, type HostFrame } from '../protocol.ts';

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
} from '../../../../shared/net/guest.ts';

export type GuestEvents = SharedGuestEvents<HostFrame>;
export type GuestDeps = SharedGuestDeps<HostFrame>;
export type GuestOptions = Omit<SharedGuestOptions, 'game'>;

const codec: GuestCodec<GuestFrame, HostFrame> = { decode: decodeHostFrame, join };

export class GuestSession extends SharedGuestSession<GuestFrame, HostFrame> {
  constructor(deps: GuestDeps, opts: GuestOptions) {
    super(deps, codec, { ...opts, game: 'gin-rummy' });
  }
}
