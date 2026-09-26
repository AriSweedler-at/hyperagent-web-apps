// Fidice's host session on the shell path (docs/design/fidice-shell-adoption.md §3 "Protocol and
// sessions", §4 M3): the shared session (web/shared/net/host.ts, docs/design/shared-shell.md §4.5,
// docs/design/n-seat-sessions.md) with this game's protocol.ts as its codec and 'fidice' as the
// table's game, so the peer id is `fidice-<code>` lower-cased (web/shared/lib/roomCode.ts). The
// shared session hosts `capacity - 1` guest seats (the shell's `startHost` effect passes
// `opts.capacity`, the room's seat count, plan §7 D10) and this codec is its N-seat form: the
// welcome carries the table's terms (`Room`: lives, seatCount, bots, botChoice, watch) in place
// of gin's `target` and, past two seats, the table as the host knows it (`seats`, read off the
// context) and the seat the channel took (`you`, the session's second argument); `joinName` hands
// the session the name a join carries so a guest back from a dead tab is reseated where that name
// last sat (D6; plan §7 D5: no tokens). NOT in the session (n-seat-sessions.md D9; plan §7 D5-D7):
// bots (a term of the room the reducer seats at the deal), spectators (Watch is a local mode),
// tokens, seat swaps, a mixed local/remote table. The legacy src/net/host.ts (its own transport,
// tokens, spectators and the bot loop) stays on disk unimported until M6; the bot loop's semantics
// live in ui/state.ts's timers. The context is the shell's host context plus `seats`
// (`HostContext`): the reducer's `hostContextOf` supplies them from `ShellState.seats`. Every
// constant and message ui/state.ts, main.ts and the tests import is re-exported.
import {
  HostSession as SharedHostSession,
  type HostCodec,
  type HostContext as SharedHostContext,
  type HostDeps as SharedHostDeps,
  type HostEvents as SharedHostEvents,
  type HostOptions as SharedHostOptions,
} from '../../../../../shared/net/host.ts';
import {
  decodeGuestFrame,
  full,
  joinName,
  welcome,
  type GuestFrame,
  type HostFrame,
  type Room,
  type TableSeat,
} from '../../protocol.ts';

export {
  BUSY_RETRY_MS,
  CODE_BUSY_MSG,
  ERROR_TOAST_MS,
  FULL_CLOSE_MS,
  HB_GRACE_MS,
  HB_MISSED_MS,
  HB_MS,
  HOST_WATCHDOG_MSG,
  OPENING_MSG,
  WAITING_MSG,
  handoffMsg,
  reconnectingMsg,
  reopenedMsg,
  type Seat,
} from '../../../../../shared/net/host.ts';
/** The room's payload beside the shell fields: protocol.ts's `Room`, the terms `welcome` tells the guest, and the wire's seat row. */
export type { Room, TableSeat } from '../../protocol.ts';

/**
 * What this codec reads off the app beyond the shell's fields: the room's terms (the welcome's
 * room) and the guest seats 1..N-1 as the shell holds them (`ShellState.seats`, n-seat-sessions.md
 * §7), which the welcome lists past two seats. At two seats `seats` is not read.
 */
export type HostRoom = Room & Readonly<{ seats: ReadonlyArray<TableSeat> }>;
export type HostContext = SharedHostContext<HostRoom>;
export type HostEvents = SharedHostEvents<GuestFrame>;
export type HostDeps = SharedHostDeps<GuestFrame, HostRoom>;
export type HostOptions = Omit<SharedHostOptions, 'game'>;

/** The room's terms alone off the context (the shell's fields and `seats` sit beside them). */
const roomOf = (ctx: HostContext): Room => ({
  lives: ctx.lives,
  seatCount: ctx.seatCount,
  bots: ctx.bots,
  botChoice: ctx.botChoice,
  watch: ctx.watch,
});

const codec: HostCodec<GuestFrame, HostFrame, HostRoom> = {
  decode: decodeGuestFrame,
  welcome: (ctx, seat) => welcome(ctx.myName, roomOf(ctx), ctx.seats, seat),
  full,
  joinName,
};

export class HostSession extends SharedHostSession<GuestFrame, HostFrame, HostRoom> {
  constructor(deps: HostDeps, opts: HostOptions) {
    super(deps, codec, { ...opts, game: 'fidice' });
  }
}
