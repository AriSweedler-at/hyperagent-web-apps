// Gin's host session: the shared two-seat session (web/shared/net/host.ts, gin's own moved there by
// docs/design/shared-shell.md A1) with gin's protocol.ts as its codec and 'gin-rummy' as the room's
// game, so the peer id stays `ginrummy-ari-<CODE>` and the welcome `{t, hostName, target}` byte for
// byte (test/parity/gin.sessions.test.ts). Every constant and message ui/state.ts, main.ts and the
// tests import is re-exported, so nothing outside net/ knows where the session lives.
import {
  HostSession as SharedHostSession,
  type HostCodec,
  type HostContext as SharedHostContext,
  type HostDeps as SharedHostDeps,
  type HostEvents as SharedHostEvents,
  type HostOptions as SharedHostOptions,
} from '../../../../shared/net/host.ts';
import {
  decodeGuestFrame,
  full,
  welcome,
  type GuestFrame,
  type HostFrame,
  type Room,
} from '../protocol.ts';

export {
  BUSY_RETRY_MS,
  CODE_BUSY_MSG,
  ERROR_TOAST_MS,
  FULL_CLOSE_MS,
  HOST_WATCHDOG_MSG,
  OPENING_MSG,
  WAITING_MSG,
  handoffMsg,
  reconnectingMsg,
  reopenedMsg,
} from '../../../../shared/net/host.ts';
/** The room's payload beside the shell fields: protocol.ts's `Room`, the target score `welcome` tells the guest (A2). */
export type { Room } from '../protocol.ts';

export type HostContext = SharedHostContext<Room>;
export type HostEvents = SharedHostEvents<GuestFrame>;
export type HostDeps = SharedHostDeps<GuestFrame, Room>;
export type HostOptions = Omit<SharedHostOptions, 'game'>;

const codec: HostCodec<GuestFrame, HostFrame, Room> = {
  decode: decodeGuestFrame,
  welcome: (ctx) => welcome(ctx.myName, { target: ctx.target }),
  full,
};

export class HostSession extends SharedHostSession<GuestFrame, HostFrame, Room> {
  constructor(deps: HostDeps, opts: HostOptions) {
    super(deps, codec, { ...opts, game: 'gin-rummy' });
  }
}
