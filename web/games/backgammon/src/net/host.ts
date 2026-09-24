// Sheshbesh's host session: the shared two-seat session (web/shared/net/host.ts, gin's session
// moved there by docs/design/shared-shell.md A1; this file was its copy with three edits) with this
// game's protocol.ts as its codec and 'backgammon' as the room's game, so the peer id is
// `sheshbesh-<CODE>` and the welcome carries `matchLength` and `variant` in place of gin's `target`
// (docs/design/backgammon-board.md §5.2; sessions.test.ts pins both). Every constant and message ui/state.ts, main.ts and
// the tests import is re-exported.
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
/** The room's payload beside the shell fields: protocol.ts's `Room`, the match `welcome` tells the guest (gin's `target` twin, A2). */
export type { Room } from '../protocol.ts';

export type HostContext = SharedHostContext<Room>;
export type HostEvents = SharedHostEvents<GuestFrame>;
export type HostDeps = SharedHostDeps<GuestFrame, Room>;
export type HostOptions = Omit<SharedHostOptions, 'game'>;

const codec: HostCodec<GuestFrame, HostFrame, Room> = {
  decode: decodeGuestFrame,
  welcome: (ctx) => welcome(ctx.myName, { matchLength: ctx.matchLength, variant: ctx.variant }),
  full,
};

export class HostSession extends SharedHostSession<GuestFrame, HostFrame, Room> {
  constructor(deps: HostDeps, opts: HostOptions) {
    super(deps, codec, { ...opts, game: 'backgammon' });
  }
}
