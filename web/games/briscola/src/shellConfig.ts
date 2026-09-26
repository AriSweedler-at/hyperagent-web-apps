// The half of briscola's shell config the game spells from its engine, protocol and storage alone
// (docs/design/briscola.md §5.8; docs/design/shared-shell.md §4.3): the id the table codes are made
// for, the default host name, the tabs, the two stored modes, the copy the shared flows paint (the
// two leave confirms, the guest's status once the host has answered, the sessions' three status
// strings the shell paints before a session speaks, and the N-seat forms below), the option codec
// (`GameOptions`, the room's six terms: the host save's own fields, the welcome frame's, the resume
// offer's; the home screen sets the seat count alone, the rest are the fixed `TABLE_TERMS`, and the
// whole is normalised as the engine normalises a room), the engine adapters, the frame builders,
// the cue memory's start and the shell's store. The first game booted through the shared shell
// (D18): the table hooks (`rendered` with the settle beat and the event-driven cues, `refuse`, the
// per-site `reset`, pass-and-play's `viewer`/`revealer` over two, three or four seats) and the rest
// of `home` are the reducer's (ui/state.ts `BRISCOLA`), which completes this record; a value import
// both ways would be a cycle. Online seats two, three or four (docs/design/n-seat-sessions.md §7,
// §6.12): `seats` is the table's range, `fixed` because a room starts full (the three-seat deck is
// another deck: a table of three cannot be dealt to two), `opts.capacity` reads the room's seat
// count as the session's capacity, `engine.create` deals to the list the shell seated (the host,
// then every guest seat in order) through `seatPlayers`, `renameGuest` renames the seat a rejoin
// names, and `frames.lobby` takes the table and the receiver's seat, which protocol.ts puts on the
// wire past two seats and leaves off at two (PR-4's corpus). The welcome is the session codec's
// (net/host.ts), not a frame the shell sends. Every N-seat copy form is the shell's two-seat
// string at a table of two, so the two-seat pins and specs read what they read.
import {
  OPPONENT_LEFT_MSG,
  WAITING_FOR_GUEST_MSG,
  guestGoneMsg,
  joinedMsg,
  type Player,
  type ShellGameData,
} from '../../../shared/ui/shell.ts';
import { connectingMsg } from '../../../shared/net/guest.ts';
import { OPENING_MSG, WAITING_MSG, handoffMsg } from '../../../shared/net/host.ts';
import {
  SEAT_COUNTS,
  applyAction,
  createGame,
  decodeState,
  nameOf,
  normaliseOptions,
  viewFor,
  type GameOptions,
  type Players,
  type SeatCount,
} from './engine/index.ts';
import { action, lobby, state, toast } from './protocol.ts';
import {
  DEFAULT_CARD_PACK,
  DEFAULT_SPEED,
  DEFAULT_HOME_TAB,
  DEFAULT_OPTS,
  DEFAULT_PLAY_MODE,
  HOME_TABS,
  LANG_PREF,
  ONE_GAME,
  SHELL_STORE,
  TABLE_TERMS,
  readCardPack,
  readSpeed,
  readOpts,
  readP3Name,
  readP4Name,
  type PlayMode,
} from './storage.ts';
import { INITIAL_CUES } from './ui/sound.ts';
import type { Briscola, Raw } from './ui/state.ts';

export type Opts = GameOptions;
export { DEFAULT_OPTS, ONE_GAME, TABLE_TERMS };

export const DEFAULT_NAME = 'Ari';
/**
 * The four pass-and-play seats when nothing is remembered or typed (the owner, 2026-09-25:
 * "briscola is Ari and Lavi (with p3 Sandro and p4 Grant)"); the first is `#nameInput`'s markup
 * value (DEFAULT_NAME) too, since the shell's `fillName` reaches that input. The first two are
 * tools/games.ts SHELL's `localNames` for the e2e; ui/home.ts paints the third and fourth.
 */
export const LOCAL_NAMES: ReadonlyArray<string> = ['Ari', 'Lavi', 'Sandro', 'Grant'];
export const LEAVE_LOCAL_MSG = 'End this game? The score will be cleared.';
export const LEAVE_ONLINE_MSG = 'Leave this game? The table will close.';

// ---- the N-seat copy (n-seat-sessions.md §7; the two-seat string at a table of two) ------------

/** "Seat 3": a seat nobody has named yet, numbered as the waiting room lists it (the host is Seat 1). */
export const emptySeatName = (seat: number): string => `Seat ${String(seat + 1)}`;
/**
 * `#guestWaitStatus` once the host's welcome or lobby frame names the room (tools/games.ts SHELL
 * `hostAnswered` pins the two-seat shape); past two seats the count rides in front.
 */
export const hostRoomMsg = (hostName: string, seated = 2, capacity = 2): string =>
  capacity === 2
    ? `Connected — waiting for ${hostName} to deal`
    : `Connected — ${String(seated)} of ${String(capacity)} seated · waiting for ${hostName} to deal`;
/** `#hostWaitStatus` while the room waits with no hand dealt (`HostOptions.waiting`): the session's line at two, the count past. */
export const waitingMsg = (capacity: number): string =>
  capacity === 2 ? WAITING_MSG : `Waiting for ${String(capacity - 1)} players to join`;
/** `#hostWaitStatus` after a join: the shell's line once the table is full, else how many are still to come. */
export const joinedText = (name: string, remaining: number): string =>
  remaining === 0 ? joinedMsg(name) : `${name} joined! Waiting for ${String(remaining)} more.`;
/** A seat that left the lobby: the shell's line at two seats; past two, who left and the count. */
export const seatLeftMsg = (
  name: string | null,
  seat: number,
  seated: number,
  capacity: number,
): string =>
  capacity === 2
    ? OPPONENT_LEFT_MSG
    : `${name ?? emptySeatName(seat)} left. ${String(seated)} of ${String(capacity)} seated.`;
/** A seat's channel down mid-game: the shell's toast, the seat's player named (or its number, for a seat never named). */
export const seatGoneMsg = (name: string | null, code: string | null, seat: number): string =>
  guestGoneMsg(name ?? emptySeatName(seat), code);
/** `#startGameBtn` below a full table: the shell's line at two seats, else the count. */
export const notEnoughMsg = (seated: number, min: number): string =>
  min === 2
    ? WAITING_FOR_GUEST_MSG
    : `${String(seated)} of ${String(min)} seated — waiting for ${String(min - seated)} more.`;
/** A spare peer at a full table; the `full` frame carries no count, so the line names none. */
export const TABLE_FULL_MSG = 'That table is full.';

// ---- the options and the seats -----------------------------------------------------------------

/** A seat count from a select's raw value (`"3"`), else `fallback`. */
export const parseSeatCount = (raw: string | undefined, fallback: SeatCount): SeatCount =>
  SEAT_COUNTS.find((n) => String(n) === raw) ?? fallback;

/**
 * The room's terms off the raw inputs (`Raw`): the seat count from the Online select or its
 * pass-and-play twin, whichever the click carried, falling back to the shell's current count; the
 * rest are the fixed `TABLE_TERMS` (one game, the house rules at their defaults), whatever the
 * current room carried (a resumed save may still hold a match), normalised as the engine
 * normalises a room (E15, E16).
 */
export const parseOpts = (raw: Raw, current: GameOptions): GameOptions =>
  normaliseOptions(parseSeatCount(raw.players ?? raw.localPlayers, current.seatCount), TABLE_TERMS);

/** The six option fields alone off a record that carries them (a welcome frame, a save, an offer), normalised. */
export const pickOpts = (from: GameOptions): GameOptions =>
  normaliseOptions(from.seatCount, {
    gamesToWin: from.gamesToWin,
    removedTwo: from.removedTwo,
    exchange: from.exchange,
    scoperta: from.scoperta,
    partnerPeek: from.partnerPeek,
  });

/**
 * The engine's `Players` tuple for `n` seats from a list (the shell's pass-and-play seats, or the
 * host and every guest seat in order at a hosted table); a missing seat is `Player N`, which the
 * shell's `localSeats` never leaves and a full table never has.
 */
export const seatPlayers = (n: SeatCount, seats: ReadonlyArray<Player>): Players => {
  const at = (i: number): Player =>
    seats[i] ?? { id: `p${String(i + 1)}`, name: `Player ${String(i + 1)}` };
  switch (n) {
    case 2:
      return [at(0), at(1)];
    case 3:
      return [at(0), at(1), at(2)];
    case 4:
      return [at(0), at(1), at(2), at(3)];
  }
};

export const BRISCOLA_SHELL: ShellGameData<Briscola> = {
  id: 'briscola',
  names: { default: DEFAULT_NAME },
  localNames: LOCAL_NAMES,
  tabs: { list: HOME_TABS, default: DEFAULT_HOME_TAB },
  modes: {
    default: DEFAULT_PLAY_MODE,
    parse: (raw) => {
      const mode: PlayMode = raw === 'local' ? 'local' : 'online';
      return { shown: mode, stored: mode };
    },
  },
  copy: {
    leaveLocal: LEAVE_LOCAL_MSG,
    leaveOnline: LEAVE_ONLINE_MSG,
    opening: OPENING_MSG,
    connecting: connectingMsg,
    handoff: handoffMsg,
    hostRoom: (hostName, _opts, seated, capacity) => hostRoomMsg(hostName, seated, capacity),
    waiting: waitingMsg,
    joined: (name, _names, remaining) => joinedText(name, remaining),
    seatLeft: seatLeftMsg,
    guestGone: seatGoneMsg,
    roomFull: TABLE_FULL_MSG,
    notEnough: notEnoughMsg,
  },
  /** Two, three or four at a table, fixed when the room opens (`opts.capacity`, n-seat-sessions.md D2) and started full (`fixed`). */
  seats: { min: 2, max: 4, fixed: true },
  opts: {
    initial: DEFAULT_OPTS,
    parse: parseOpts,
    ofGame: (game) => game.options,
    pick: pickOpts,
    /** The session hosts `seatCount - 1` guest channels. */
    capacity: (opts: GameOptions) => opts.seatCount,
  },
  engine: {
    /** The deal over the seats the shell lists (the host first): the engine's tuple for the room's count. */
    create: (players, opts, rng, now) =>
      createGame(seatPlayers(opts.seatCount, players), opts, rng, now),
    apply: applyAction,
    viewFor,
    /** `position/load` (`window.__briscola.setup`): the save's decoder, E20's invariants refined. */
    decodeState,
    // One game per sitting (the owner, 2026-09-25): a game is over when its last trick is played,
    // decided or drawn; the engine's match runs on underneath (a save from before may hold one).
    over: (view) => view.phase === 'over',
    finished: (game) => game.phase === 'over',
    names: (game) => [nameOf(game.players, 0), nameOf(game.players, 1)],
    /** `game.players[seat].name = name` on a rejoin (D6): the seat the session reseated the name at. */
    renameGuest: (game, name, seat) => ({
      ...game,
      players: game.players.map((p, i) => (i === seat ? { ...p, name } : p)),
    }),
  },
  // The finished game's record (the owner, 2026-09-25): a game is its deal's clock (Play again
  // deals under a new one), every seat's name, its score the points per side ("71–49",
  // "50–40–30"), its victor the side the result names (null for a draw): every seat is its own
  // side (a free-for-all at three and four), so the outcome for the device's user reads off it as
  // off a seat.
  result: {
    keyOf: (view) => String(view.startedAt),
    playersOf: (view) => view.players.map((p) => p.name),
    scoreOf: (view) => (view.result?.totals ?? view.sides).map(String).join('–'),
    winnerOf: (view) => view.result?.winner ?? null,
  },
  frames: { lobby, state, toast, action },
  cues: { initial: INITIAL_CUES },
  home: {
    // This page's own keys: the seat count (the default when unreadable) on the fixed terms, the card pack, the language pack, the beat's speed, the third and fourth names.
    read: (store) => {
      const pack = readCardPack(store);
      const p3 = readP3Name(store);
      const p4 = readP4Name(store);
      const speed = readSpeed(store);
      return {
        opts: readOpts(store),
        cardPack: pack.ok ? pack.value : DEFAULT_CARD_PACK,
        lang: LANG_PREF.orDefault(store),
        speed: speed.ok ? speed.value : DEFAULT_SPEED,
        p3Name: p3.ok ? p3.value : null,
        p4Name: p4.ok ? p4.value : null,
      };
    },
  },
  prefs: SHELL_STORE,
};
