// The half of fidice's shell config the game spells from its engine, protocol and storage alone
// (docs/design/fidice-shell-adoption.md §3 "ShellGameData", §4 M3; docs/design/shared-shell.md
// §4.3), briscola's shellConfig.ts shape for shape: the id the table codes are made for
// (`fidice-<code>`), the default host name, the tabs in the composed page's order, the four modes
// (Online and Pass the phone stored; Solo and Watch shown only, gin's Sandbox precedent, plan §7
// D9), the copy the shared flows paint (the two leave confirms, the guest's status once the host
// has answered, the sessions' status strings the shell paints before a session speaks, and the
// N-seat forms below), the option codec (`Opts`, the room's five terms: the host save's own
// fields, the welcome frame's, the resume offer's; the host card sets lives, chairs, computers and
// their strategy, the waiting room's toggle sets `watch`), the engine adapters over the domain
// (KEEP, byte for byte: `apply`, `redactFor`, lobby.ts's seating), the frame builders, the cue
// memory's start and the shell's store. The table hooks (`rendered`, `refuse`, the per-site
// `reset`, pass the phone's `viewer`/`revealer` from the legacy `handoffFor`, plan §7 D8) and the
// rest of `home` are the reducer's (ui/state.ts `FIDICE`), which completes this record; a value
// import both ways would be a cycle.
//
// Seats (docs/design/n-seat-sessions.md §7; plan §7 D10, §6 risk 12): `seats {min: 1, max: 6}`,
// not fixed, so Start is enabled with the host alone (a human and a computer make a table) and
// gates on the engine's own "Need at least 2 players." (game.ts `startGame`) as the toast: zero
// shared change. `opts.capacity` reads the chairs as the session's capacity, so the room hosts
// `seatCount - 1` guest channels. The engine's seats are indices into `State.players`; the shell's
// are the host (0) and the guest channels (1..N-1). The two meet through the player ids
// (`seatId`): the host is `host`, the guests `guest`, `guest2`, … (the ids the shell's own deal
// spells, web/shared/ui/shell.ts `host/deal`), the computers `bot0`, `bot1`, …; `engineSeatOf`
// finds a shell seat's chair by id, so a chair left empty online (dropped at the deal, never dealt
// to as `Jeff`) or a host who watches (no chair: `hostSeat` null, the HOST actor and the spectator
// view) shifts nobody's view or turn. `seatTable` seats a table from the players the reducer lists
// (the host first unless the room watches, then every connected guest in seat order) and the
// room's computers, each with `profileFor(botChoice)` (a chair too many is refused by the engine
// and skipped, as the legacy `addBotTo` skipped it); it returns the lobby-phase state, and the
// reducer applies `start` (the deal, the toast). The welcome is the session codec's (net/host.ts),
// not a frame the shell sends. Every N-seat copy form is the shell's two-seat string at a table of
// two, so the two-seat pins and specs read what they read.
import { normaliseName } from '../../../shared/lib/name.ts';
import { err, ok } from '../../../shared/lib/result.ts';
import type { Rng } from '../../../shared/lib/rng.ts';
import { connectingMsg } from '../../../shared/net/guest.ts';
import { OPENING_MSG, WAITING_MSG, handoffMsg } from '../../../shared/net/host.ts';
import {
  OPPONENT_LEFT_MSG,
  guestGoneMsg,
  joinedMsg,
  type Player,
  type SeatOf,
  type ShellGameData,
} from '../../../shared/ui/shell.ts';
import { difficultyById, profileFor } from './bots/registry.ts';
import { decodeState } from './codec.ts';
import {
  HOST,
  MIN_PLAYERS,
  apply,
  bySeat,
  keepsScore,
  newGame,
  seat as engineSeat,
  stampLog,
} from './domain/game.ts';
import { makeBot, makeHuman, renameBot, seatPlayer, setConnected } from './domain/lobby.ts';
import { redactFor } from './domain/publicState.ts';
import {
  NAME_RULE,
  type Actor,
  type PublicState,
  type Seat as EngineSeat,
  type State,
  type Viewer,
} from './domain/types.ts';
import { MAX_BOTS, SEAT_COUNTS, action, lobby, state, toast, type SeatCount } from './protocol.ts';
import {
  DEFAULT_HOME_TAB,
  DEFAULT_OPTS,
  DEFAULT_PLAY_MODE,
  HOME_TABS,
  SHELL_STORE,
  readOpts,
  readP3Name,
  readP4Name,
  readP5Name,
  readP6Name,
  type Opts,
} from './storage.ts';
import { INITIAL_CUES } from './ui/sound.ts';
import type { Fidice, Raw } from './ui/state.ts';

export { DEFAULT_OPTS, type Opts };

export const DEFAULT_NAME = 'Ari';
/**
 * The pass-the-phone seats when nothing is remembered or typed: the shell's two proper names
 * (web/shared/ui/shell.ts `DEFAULT_LOCAL_NAMES`), `Player N` beyond (`localNameFor`); the first is
 * `#nameInput`'s markup value (DEFAULT_NAME) too, since the shell's `fillName` reaches that input.
 */
export const LOCAL_NAMES: ReadonlyArray<string> = ['Ari', 'Lavi'];
/** The host's name at a table nobody plays from this device (Watch, plan §7 D6): the legacy `menu.watchBots`'s. */
export const WATCH_HOST_NAME = 'Host';
/** Watch seats this many computers when the card names none (the legacy `menu.watchBots`: four); Solo two (its `menu.solo`). */
export const WATCH_BOTS = 4;
export const SOLO_BOTS = 2;
export const LEAVE_LOCAL_MSG = 'End this game? The table will be cleared.';
export const LEAVE_ONLINE_MSG =
  'Leave this game? If you are the host, the table closes for everyone.';

// ---- the N-seat copy (n-seat-sessions.md §7; the two-seat string at a table of two) ------------

/** "Seat 3": a seat nobody has named yet, numbered as the waiting room lists it (the host is Seat 1). */
export const emptySeatName = (seat: number): string => `Seat ${String(seat + 1)}`;
/** `#guestWaitStatus` once the host's welcome or lobby frame names the room; past two seats the count rides in front. */
export const hostRoomMsg = (hostName: string, seated = 2, capacity = 2): string =>
  capacity === 2
    ? `Connected — waiting for ${hostName} to start`
    : `Connected — ${String(seated)} of ${String(capacity)} seated · waiting for ${hostName} to start`;
/** `#hostWaitStatus` while the room waits with nobody dealt in (`HostOptions.waiting`): the session's line at two, the chairs past. */
export const waitingMsg = (capacity: number): string =>
  capacity === 2 ? WAITING_MSG : `Waiting for players — ${String(capacity)} chairs at the table`;
/** `#hostWaitStatus` after a join: the shell's line once the table is full, else the count (a fidice table starts whenever the host says). */
export const joinedText = (name: string, seated: number, capacity: number): string =>
  seated === capacity
    ? joinedMsg(name)
    : `${name} joined! ${String(seated)} of ${String(capacity)} seated — start when ready.`;
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
/** The engine's own gate on Start (game.ts `startGame`; plan §6 risk 12): the shell's `notEnough` never fires at `min` 1, so the deal toasts this. */
export const NEED_PLAYERS_MSG = `Need at least ${String(MIN_PLAYERS)} players.`;
/** A spare peer at a full table; the `full` frame carries no count, so the line names none. */
export const TABLE_FULL_MSG = 'That table is full.';
/** `engine.apply` for a shell seat with no chair (a guest whose seat was empty at the deal). */
export const NOT_SEATED_MSG = 'You are not seated at this table.';

// ---- the options -------------------------------------------------------------------------------

/** A chair count from a select's raw value (`"3"`), else `fallback`. */
export const parseSeatCount = (raw: string | undefined, fallback: SeatCount): SeatCount =>
  SEAT_COUNTS.find((n) => String(n) === raw) ?? fallback;
/** A count of computers, `0`..MAX_BOTS, else `fallback`. */
export const parseBots = (raw: string | undefined, fallback: number): number => {
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= MAX_BOTS ? n : fallback;
};
/** The kayaks each (`0` keeps score), any small non-negative integer, else `fallback`. */
export const parseLives = (raw: string | undefined, fallback: number): number => {
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 99 ? n : fallback;
};
/**
 * The computers' strategy off the raw inputs: an exact choice (`#btnConfigSolo`'s screen) wins,
 * else the difficulty select maps to its strategy (bots/registry.ts `DIFFICULTIES`), else the
 * current choice.
 */
export const parseBotChoice = (raw: Raw, fallback: string): string =>
  raw.botChoice !== undefined && raw.botChoice !== ''
    ? raw.botChoice
    : raw.difficulty !== undefined
      ? difficultyById(raw.difficulty).strategy.id
      : fallback;

/**
 * The room's terms off the raw inputs (`Raw`): each select's value, falling back to the shell's
 * current term for one the click did not carry. `watch` is a mode (the waiting room's toggle, or
 * Watch from the home card), so the card leaves it as it is.
 */
export const parseOpts = (raw: Raw, current: Opts): Opts => ({
  lives: parseLives(raw.lives, current.lives),
  seatCount: parseSeatCount(raw.seats, current.seatCount),
  bots: parseBots(raw.bots, current.bots),
  botChoice: parseBotChoice(raw, current.botChoice),
  watch: current.watch,
});

/** The five terms alone off a record that carries them (a welcome frame, a save, an offer), in the literal's order. */
export const pickOpts = (from: Opts): Opts => ({
  lives: from.lives,
  seatCount: from.seatCount,
  bots: from.bots,
  botChoice: from.botChoice,
  watch: from.watch,
});

// ---- the seats: the shell's channels and the engine's chairs ------------------------------------

/** The player id a shell seat sits under: the ids the shell's deal spells (web/shared/ui/shell.ts `host/deal`). */
export const seatId = (seat: number): string =>
  seat === 0 ? 'host' : seat === 1 ? 'guest' : `guest${String(seat)}`;
/** A computer's id, by its index among the computers. */
export const botId = (index: number): string => `bot${String(index)}`;
/** The shell seat a player id names, null for a computer's or a stranger's. */
export const shellSeatOf = (id: string): SeatOf<Fidice> | null => {
  if (id === 'host') return 0;
  if (id === 'guest') return 1;
  const m = /^guest([2-5])$/.exec(id);
  return m === null ? null : (Number(m[1]) as SeatOf<Fidice>);
};
/** The chair a shell seat holds at this table, null when it holds none (a watching host, an empty seat). */
export const engineSeatOf = (game: PublicState, seat: number): EngineSeat | null => {
  const i = game.players.findIndex((p) => p.id === seatId(seat));
  return i < 0 ? null : engineSeat(i);
};
/** A chair's shell seat: the human's, or the chair itself for a computer (which holds no channel). */
export const shellSeatOfChair = (game: PublicState, chair: EngineSeat): SeatOf<Fidice> =>
  shellSeatOf(game.players[chair]?.id ?? '') ?? chair;
/** How a shell seat sees the table: its chair's redaction, or a spectator's when it holds none. */
export const viewerFor = (game: PublicState, seat: number): Viewer => {
  const chair = engineSeatOf(game, seat);
  return chair === null ? { kind: 'spectator' } : { kind: 'seat', seat: chair };
};
/** Who a shell seat acts as: its chair; the HOST for seat 0 without one (a host who watches); nobody for an empty guest seat. */
export const actorFor = (game: PublicState, seat: number): Actor | null => {
  const chair = engineSeatOf(game, seat);
  return chair !== null ? bySeat(chair) : seat === 0 ? HOST : null;
};

/** A player sat down if the engine lets it (a full table refuses; the state is kept). */
const sit = (s: State, player: Parameters<typeof seatPlayer>[1]): State => {
  const r = seatPlayer(s, player);
  return r.ok ? r.value : s;
};

/**
 * The lobby-phase table under `code` and `opts`: the humans in the order given (the first is the
 * host, who stands up when the room watches: `hostSeat` null, the legacy `watch`), then the room's
 * computers, each named from lobby.ts's pool and playing `profileFor(botChoice)` (`random` draws
 * one of the shipped three with the rng). The reducer applies `start`.
 */
export const seatTable = (
  code: string,
  players: ReadonlyArray<Player>,
  opts: Opts,
  rng: Rng,
): State => {
  const base = newGame(code, opts.lives);
  const humans = opts.watch ? players.slice(1) : players;
  const seated = humans.reduce(
    (s, p) => sit(s, makeHuman(p.id, p.name, opts.lives)),
    opts.watch ? { ...base, hostSeat: null } : base,
  );
  return Array.from({ length: opts.bots }, (_, i) => i).reduce(
    (s, i) => sit(s, makeBot(s, botId(i), profileFor(opts.botChoice, rng))),
    seated,
  );
};

/** The computers renamed as the waiting room named them (lobby.ts `renameBot`: a blank keeps the pool's name). */
export const withBotNames = (s: State, names: ReadonlyArray<string | null>): State =>
  names.reduce((acc, name, i) => (name === null ? acc : renameBot(acc, botId(i), name)), s);

export const FIDICE_SHELL: ShellGameData<Fidice> = {
  id: 'fidice',
  names: { default: DEFAULT_NAME },
  localNames: LOCAL_NAMES,
  tabs: { list: HOME_TABS, default: DEFAULT_HOME_TAB },
  modes: {
    default: DEFAULT_PLAY_MODE,
    // Solo and Watch are shown, never stored (plan §7 D9; gin's Sandbox): a reload opens Online.
    parse: (raw) =>
      raw === 'local'
        ? { shown: 'local', stored: 'local' }
        : raw === 'solo' || raw === 'watch'
          ? { shown: raw, stored: null }
          : { shown: 'online', stored: 'online' },
  },
  copy: {
    leaveLocal: LEAVE_LOCAL_MSG,
    leaveOnline: LEAVE_ONLINE_MSG,
    opening: OPENING_MSG,
    connecting: connectingMsg,
    handoff: handoffMsg,
    hostRoom: (hostName, _opts, seated, capacity) => hostRoomMsg(hostName, seated, capacity),
    waiting: waitingMsg,
    joined: (name, names, remaining) =>
      joinedText(name, names.length + 1, names.length + 1 + remaining),
    seatLeft: seatLeftMsg,
    guestGone: seatGoneMsg,
    roomFull: TABLE_FULL_MSG,
    notEnough: () => NEED_PLAYERS_MSG,
  },
  /** One to six at a table (the host alone opens one; computers fill chairs), never fixed: the engine gates the start. */
  seats: { min: 1, max: 6 },
  opts: {
    initial: DEFAULT_OPTS,
    parse: parseOpts,
    // The terms a game was made under (the handoff): its kayaks, its chairs as dealt, its computers.
    ofGame: (game) => ({
      lives: game.lives,
      seatCount: parseSeatCount(String(game.players.length), DEFAULT_OPTS.seatCount),
      bots: game.players.filter((p) => p.bot !== null).length,
      botChoice: game.players.find((p) => p.bot !== null)?.bot?.strategy ?? DEFAULT_OPTS.botChoice,
      watch: game.hostSeat === null,
    }),
    pick: pickOpts,
    /** The session hosts `seatCount - 1` guest channels (plan §7 D10). */
    capacity: (opts: Opts) => opts.seatCount,
  },
  engine: {
    /** The shell's own deal (unused: ui/state.ts deals itself, dropping empty seats): the table seated, in the lobby phase. */
    create: (players, opts, rng) => seatTable('', players, opts, rng),
    /** A shell seat's action through the domain's `apply`, the log stamped with the clock (the legacy `commit`). */
    apply: (game, seat, act, rng, now) => {
      const actor = actorFor(game, seat);
      if (actor === null) return err(NOT_SEATED_MSG);
      const r = apply(game, actor, act, rng);
      return r.ok ? ok(stampLog(r.value, now())) : r;
    },
    viewFor: (game, seat) => redactFor(game, viewerFor(game, seat)),
    decodeState,
    over: (view) => view.phase === 'over',
    finished: (game) => game.phase === 'over',
    names: (game) => [game.players[0]?.name ?? '', game.players[1]?.name ?? ''],
    /** A rejoin (D5): the seat's chair marked back at the table under the name the join carried, as the legacy `greet` did. */
    renameGuest: (game, name, seat) =>
      setConnected(game, seatId(seat), true, normaliseName(name, NAME_RULE)),
  },
  // The finished game's record: its identity is the room and the deal's clock (the first log line
  // is stamped at the deal), every chair's name in chair order, the score as the table kept it
  // (kayaks left, or rounds lost when keeping score), and the winner as the shell seat of the human
  // who won, or a computer's chair (which no human's channel numbers at a table with the host
  // seated and no chair left empty; the view does not say whose it is).
  result: {
    keyOf: (view) => `${view.code}@${String(view.log[0]?.at ?? 0)}`,
    playersOf: (view) => view.players.map((p) => p.name),
    scoreOf: (view) =>
      view.players.map((p) => String(keepsScore(view) ? p.losses : p.lives)).join('–'),
    winnerOf: (view) => (view.winner === null ? null : shellSeatOfChair(view, view.winner)),
  },
  frames: { lobby, state, toast, action },
  cues: { initial: INITIAL_CUES },
  home: {
    // This page's own keys: the host card's last terms (the defaults when unreadable) and the third to sixth names.
    read: (store) => {
      const p3 = readP3Name(store);
      const p4 = readP4Name(store);
      const p5 = readP5Name(store);
      const p6 = readP6Name(store);
      return {
        opts: readOpts(store),
        extraNames: {
          2: p3.ok ? p3.value : null,
          3: p4.ok ? p4.value : null,
          4: p5.ok ? p5.value : null,
          5: p6.ok ? p6.value : null,
        },
      };
    },
  },
  prefs: SHELL_STORE,
};
