// Briscola's host session: the shared session (web/shared/net/host.ts, docs/design/shared-shell.md
// §4.5) with this game's protocol.ts as its codec and 'briscola' as the table's game, so the peer id
// is `briscola-<CODE>` (web/shared/lib/roomCode.ts, D19) and the welcome carries the six options
// (`Room`: seatCount, gamesToWin, removedTwo, exchange, scoperta, partnerPeek) in place of gin's
// `target` (docs/design/briscola.md §4.3, §5.8; sessions.test.ts pins both). Two seats in this PR
// (D16): the default capacity, a one-parameter `welcome`, no `joinName`; the N-seat lobby is PR-5's.
// Every constant and message ui/state.ts, main.ts and the tests import is re-exported.
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
/** The room's payload beside the shell fields: protocol.ts's `Room`, the six options `welcome` tells the guest. */
export type { Room } from '../protocol.ts';

export type HostContext = SharedHostContext<Room>;
export type HostEvents = SharedHostEvents<GuestFrame>;
export type HostDeps = SharedHostDeps<GuestFrame, Room>;
export type HostOptions = Omit<SharedHostOptions, 'game'>;

const codec: HostCodec<GuestFrame, HostFrame, Room> = {
  decode: decodeGuestFrame,
  welcome: (ctx) =>
    welcome(ctx.myName, {
      seatCount: ctx.seatCount,
      gamesToWin: ctx.gamesToWin,
      removedTwo: ctx.removedTwo,
      exchange: ctx.exchange,
      scoperta: ctx.scoperta,
      partnerPeek: ctx.partnerPeek,
    }),
  full,
};

export class HostSession extends SharedHostSession<GuestFrame, HostFrame, Room> {
  constructor(deps: HostDeps, opts: HostOptions) {
    super(deps, codec, { ...opts, game: 'briscola' });
  }
}
