// The fidice app on the shell path as a reducer over intents (docs/design/fidice-shell-adoption.md
// §3 "ShellConfig", §4 M3; docs/ARCHITECTURE.md "Module boundaries": imported only by main.ts, the
// painters and tests; dark until M4 boots it). `App = { shell, table }`: `shell` is the home
// screen, the waiting rooms, the session (role, code, names, the engine `State` for the host and
// pass the phone, my `PublicState` for every role) and the resume offer, the record the shared
// shell reducer owns (web/shared/ui/shell.ts `reduceShell`, docs/design/shared-shell.md §4.2) over
// the config `FIDICE` below (shellConfig.ts's half completed here with the table hooks: `reset`
// per site, `rendered`, `refuse`, pass the phone's `viewer`/`revealer`, the home snapshot's own
// part); `table` is the table's interaction memory (the bid picker, the dice picked to roll, the
// ladder rows opened, the bot config screen's target, the curtain, the third to sixth names) and
// the game loop's (`pending`, `memories`, `botNames`). `Intent` is every handler and every network
// event, and `reduce` returns the next App with a list of `Effect`s: what to persist, toast, send,
// play or arm, as data. main.ts runs the effects through the real adapters (`runEffect`: fidice's
// two, then the shared runner) and paints the App (ui/render.ts, M4); the tests run the reducer
// alone.
//
// Fidice's residue on the shell. (1) The deal: pass the phone seats two to six humans (and the
// card's computers; Solo one human and computers; Watch computers alone, the host standing:
// plan §7 D6, D9), so `reduce` takes `local/click` itself and seats the table before handing it
// to the shared `startLocal`; online, `host/deal` is taken too, because the shell's own deal would
// deal `Jeff` to an empty seat where this table drops the seat (plan §4 M3, §7 D10): the host,
// every CONNECTED guest in seat order and the room's computers sit down (shellConfig.ts
// `seatTable`), then the engine's `start` is applied and its refusal ("Need at least 2 players.")
// is the toast (§6 risk 12). (2) The game loop, the legacy host session's `schedule()`
// (src/net/host.ts:339-368) as reducer timers (§6 risk 11): after every state change on the device
// that runs the engine (the host, pass the phone) the reveal arms `autoNext` once (AUTO_NEXT_MS,
// `autoNextAt` stamped into the state and broadcast, as the legacy did; a second change while it
// shows re-arms nothing) or the holder's computer decides its move (bots/brain.ts `decide`, its
// memory kept in `table.memories`) and `bot/step` is armed for the move's delay; a state change
// before it fires decides again and re-arms (`createTimers` restarts a named timer), and a `next`
// by a human cancels the reveal's timer. The replay oracle (replay.test.ts) drives the twelve
// seeded bot games of test/parity/fidice.legacy.test.ts through these timers and reaches the same
// players, records and log lines. (3) Turn authority is gin's: the host applies every action
// (`hostDispatch`, the shell seat mapped to its chair by id, shellConfig.ts) and broadcasts each
// seat's redaction; a refusal to a guest is a `toast` frame; the guest sends `action` frames;
// pass the phone keeps the `State` here with no Peer, and whoever holds the cup acts. (4) The
// waiting room keeps the legacy lobby's bot controls (plan §7 D7): add, remove, rename and
// configure rewrite `shell.opts` (the count, one strategy for every computer) and `table.botNames`
// and re-send the lobby to every connected seat; the host's watch toggle sets `opts.watch`.
import type { Rng } from '../../../../shared/lib/rng.ts';
import {
  andThen as then,
  broadcast,
  guestContextOf as shellGuestContextOf,
  hostContextOf as shellHostContextOf,
  initialShell as shellInitial,
  isShellEffect,
  isShellIntent,
  localBroadcast,
  localNamesOf,
  localSeats,
  pure,
  readHome as shellReadHome,
  reduceShell,
  resumeFor as shellResumeFor,
  saveFor as shellSaveFor,
  startLocal,
  step,
  toast,
  withShell,
  withTable,
  type Ctx,
  type Effect as SharedEffect,
  type GuestContextOf,
  type HomeSnapshot as SharedHomeSnapshot,
  type HostContextOf,
  type Intent as SharedIntent,
  type Player,
  type Resume as SharedResume,
  type SeatOf,
  type SeatState,
  type ShellApp,
  type ShellConfig,
  type ShellIntent as SharedShellIntent,
  type ShellState,
  type Step as SharedStep,
  type TableReset,
  type TimerId as SharedTimerId,
} from '../../../../shared/ui/shell.ts';
import { runShellEffect, type ShellEffectDeps } from '../../../../shared/ui/shellEffects.ts';
import { decide, emptyMemories, type Memories } from '../bots/brain.ts';
import { HOST, apply, bySeat, scheduleAutoNext, stampLog } from '../domain/game.ts';
import { cleanName } from '../domain/lobby.ts';
import { suggestHands } from '../domain/search.ts';
import type {
  Action,
  PublicState,
  Rank,
  Seat as EngineSeat,
  State,
  Suggestion,
} from '../domain/types.ts';
import { action as actionFrame, lobby as lobbyFrame, MAX_BOTS } from '../protocol.ts';
import {
  DEFAULT_NAME,
  FIDICE_SHELL,
  SOLO_BOTS,
  WATCH_BOTS,
  WATCH_HOST_NAME,
  actorFor,
  engineSeatOf,
  parseOpts,
  seatId,
  seatTable,
  shellSeatOfChair,
  withBotNames,
} from '../shellConfig.ts';
import {
  DEFAULT_PLAY_MODE,
  EXTRA_NAME_PREFS,
  HOME_TABS,
  writeOpts,
  type ExtraSeat,
  type HomeTab,
  type HostExtra,
  type Opts,
  type PlayMode,
  type Save,
  type Store,
} from '../storage.ts';
import { INITIAL_CUES, type Cue, type CueState } from './sound.ts';

// The shell's strings and helpers the tests and painters import from here, as the other games do.
export {
  DISCONNECTED_MSG,
  GONE_TOAST_MS,
  LONG_PRESS_MS,
  LOST_HOST_MSG,
  NOT_CONNECTED_MSG,
  OPPONENT_LEFT_MSG,
  ROOM_FULL_MSG,
  SHELL_EFFECT_TYPES,
  SHELL_INTENT_TYPES,
  WAITING_FOR_GUEST_MSG,
  guestGoneMsg,
  joinedMsg,
  type Role,
  type WaitStatus,
} from '../../../../shared/ui/shell.ts';
export {
  DEFAULT_NAME,
  DEFAULT_OPTS,
  LEAVE_LOCAL_MSG,
  LEAVE_ONLINE_MSG,
  LOCAL_NAMES,
  NEED_PLAYERS_MSG,
  NOT_SEATED_MSG,
  SOLO_BOTS,
  TABLE_FULL_MSG,
  WATCH_BOTS,
  WATCH_HOST_NAME,
  emptySeatName,
  hostRoomMsg,
  joinedText,
  parseOpts,
  parseSeatCount,
  pickOpts,
  seatGoneMsg,
  seatId,
  seatLeftMsg,
  seatTable,
  waitingMsg,
} from '../shellConfig.ts';
// ui/home.ts paints the tabs and modes from the lists storage.ts decodes; ui/ may not import storage.ts.
export { DEFAULT_PLAY_MODE, HOME_TABS, type ExtraSeat, type HomeTab, type PlayMode };
export { INITIAL_CUES, type CueState };

// ---- the state ---------------------------------------------------------------------------------

/** The five top-level screens `showScreen` toggles between, and the bot config screen (page.ts `extraScreens`). */
export const SCREENS = [
  'homeScreen',
  'hostWaitScreen',
  'guestWaitScreen',
  'tableScreen',
  'endgameScreen',
  'configScreen',
] as const;
export type ScreenId = (typeof SCREENS)[number];

/** What the home screen's resume box offers, one per save role (the shared `ShellResume`; fidice adds none). */
export type Resume = SharedResume<Fidice>;

/**
 * The raw option values `host/click` and `local/click` carry off the inputs (page.ts
 * `hostFields`, `localFields`): the four selects (`#livesSel`, `#seatsSel`, `#botsSel`,
 * `#difficulty`), the exact strategy `#btnConfigSolo`'s screen picked, and the third to sixth
 * pass-the-phone names (the shared binder reads the first two). A key the click did not carry
 * keeps the shell's current value.
 */
export type Raw = Readonly<{
  lives?: string;
  seats?: string;
  bots?: string;
  difficulty?: string;
  botChoice?: string;
  p3?: string;
  p4?: string;
  p5?: string;
  p6?: string;
}>;

/** The two modes shown and never stored (plan §7 D9): one human against computers, and computers alone. */
export type ExtraMode = 'solo' | 'watch';
export type Mode = PlayMode | ExtraMode;

/** What `initHome` reads beyond the shell's keys: the host card's last terms and the third to sixth names. */
export type Home = Readonly<{
  opts: Opts;
  extraNames: Readonly<Record<ExtraSeat, string | null>>;
}>;

/** The game loop's two timers (the legacy `botTimer` and `nextTimer`, src/net/host.ts). */
export type GameTimer = 'bot/step' | 'autoNext';

/**
 * Fidice's types for the shared shell (web/shared/ui/shell.ts `ShellTypes`): the room's terms are
 * the five options (the host save's own fields and the welcome frame's room), the raw options
 * are `Raw`, the seats are the shell's two plus the third to sixth (six chairs, domain/types.ts
 * `MAX_SEATS`), the modes are the two stored plus Solo and Watch, one screen beyond the shell's
 * five, no resume offer beyond the three roles, the two game-loop timers, the shell's four cues,
 * and the table's own intents and effects are the unions below. No ephemeral frame.
 */
export type Fidice = Readonly<{
  Opts: Opts;
  Raw: Raw;
  State: State;
  View: PublicState;
  Action: Action;
  Table: Table;
  Tab: HomeTab;
  Mode: Mode;
  Screen: ScreenId;
  Timer: GameTimer;
  Cue: Cue;
  Cues: CueState;
  Resume: never;
  Home: Home;
  Intent: TableIntent;
  Effect: TableEffect;
  Store: Store;
  Seat: ExtraSeat;
}>;

export type Shell = ShellState<Fidice>;
export type ShellSeat = SeatOf<Fidice>;

/**
 * Compile-time (web/shared/ui/shell.test.ts `Wide`): the bag names four seats past the shell's
 * two, so a seat at this table is any of the six chairs and the shell's flows type on them.
 */
export const ALL_SEATS: ReadonlyArray<ShellSeat> = [0, 1, 2, 3, 4, 5];

/** The bid search box (the legacy `Picker`, src/view/types.ts). */
export type Picker = Readonly<{
  query: string;
  selected: Rank | null;
  highlight: number;
  listOpen: boolean;
}>;
export const EMPTY_PICKER: Picker = { query: '', selected: null, highlight: 0, listOpen: false };

/** Which ladder rows the player opened or closed by hand; `allOpen` overrides both. */
export type Ladder = Readonly<{
  open: ReadonlyArray<string>;
  closed: ReadonlyArray<string>;
  allOpen: boolean;
}>;
export const EMPTY_LADDER: Ladder = { open: [], closed: [], allOpen: false };
/** The two ladders: the table's and the endgame's (the legacy `main` and `spec`). */
export type LadderId = 'main' | 'spec';

/** Whose strategy the bot config screen edits: the card's computers (every one), or a seated computer at the waiting room. */
export type ConfigTarget = Readonly<{ kind: 'solo' }> | Readonly<{ kind: 'bot'; index: number }>;

/** The computer's move decided at the last state change, applied when `bot/step` fires (the legacy `botTimer`'s closure). */
export type Pending = Readonly<{ holder: EngineSeat; action: Action }>;

/** The table's interaction memory and the game loop's. Session only: never saved, never on the wire. */
export type Table = Readonly<{
  /** Pass the phone: the seat the phone is handed to, or null when the curtain is down. */
  curtain: ShellSeat | null;
  /** The computer's move armed on `bot/step`; null when no computer is to move. */
  pending: Pending | null;
  /** Each computer's strategy memory by player id (bots/brain.ts), kept for the game. */
  memories: Memories;
  /** The waiting room's names for the computers, by index (plan §7 D7); null keeps the pool's name. */
  botNames: ReadonlyArray<string | null>;
  picker: Picker;
  /** The table dice picked to roll (indices into the round's dice). */
  rollSelection: ReadonlyArray<number>;
  /** "Shake the cup" ticked. */
  rollCup: boolean;
  /** "Tuck them back under the cup" ticked: the picked dice go in instead of rolling on the table. */
  rollHidden: boolean;
  /** The endgame ladder shows the cup's true rank (the legacy `showTruth`). */
  showTruth: boolean;
  ladders: Readonly<Record<LadderId, Ladder>>;
  /** `#ladderOverlay` shown over the table. */
  ladderOpen: boolean;
  /** `#historyOverlay` shown over the table: the shell's history sheet, the finished games this device remembers (plan §7 D13). */
  historyOpen: boolean;
  /** `#configScreen`'s target while it shows; null when it does not. */
  configTarget: ConfigTarget | null;
  /**
   * The third to sixth pass-the-phone names as last read from their keys or typed into their
   * inputs; null when neither (the input shows the seat's default, marked for the first-tap clear).
   */
  extraNames: Readonly<Record<ExtraSeat, string | null>>;
}>;

export type App = ShellApp<Fidice>;

export const initialTable: Table = {
  curtain: null,
  pending: null,
  memories: emptyMemories,
  botNames: [],
  picker: EMPTY_PICKER,
  rollSelection: [],
  rollCup: false,
  rollHidden: false,
  showTruth: false,
  ladders: { main: EMPTY_LADDER, spec: EMPTY_LADDER },
  ladderOpen: false,
  historyOpen: false,
  configTarget: null,
  extraNames: { 2: null, 3: null, 4: null, 5: null },
};

// ---- the strings and beats the app (not the sessions) writes ---------------------------------

/** The reveal shows this long, then the next round starts by itself (the legacy `AUTO_NEXT_MS`, src/net/host.ts). */
export const AUTO_NEXT_MS = 7000;
/** The clock the painter reads the countdown at (M7 paints `autoNextAt - now`). */
export const TICK_MS = 500;
/** `bid/place` with nothing picked (the legacy `picker.place` did nothing; the toast says why). */
export const PICK_A_BID_MSG = 'Pick a hand to bid first.';
/** `roll/go` with nothing picked and the cup unticked (the legacy toast). */
export const PICK_DICE_MSG = 'Select table dice or tick "Shake the cup" first';
/** `bots/add` at a table with no chair left. */
export const TABLE_FULL_TOAST = 'Table is full.';

// ---- intents -----------------------------------------------------------------------------------

/** What `initHome` reads from storage, in one snapshot (`readHome`): the shell's keys and fidice's (`Home`). */
export type HomeSnapshot = SharedHomeSnapshot<Fidice>;

/** The table's half of `Intent`, fidice's own after the shell's 45 (web/shared/ui/shell.ts `ShellIntent`). */
export type TableIntent =
  /** `act(action)`: every role (the hook, and the controls below resolve to it). */
  | Readonly<{ type: 'act'; action: Action }>
  /** `#btnPlaceBid`: the picker's chosen rank, or the one given. */
  | Readonly<{ type: 'bid/place'; rank?: Rank }>
  | Readonly<{ type: 'call/click' }>
  | Readonly<{ type: 'peek/click' }>
  | Readonly<{ type: 'next/click' }>
  | Readonly<{ type: 'finish/click' }>
  /** A die under the cup pulled out onto the table. */
  | Readonly<{ type: 'pull/die'; die: number }>
  | Readonly<{ type: 'roll/toggleDie'; die: number }>
  | Readonly<{ type: 'roll/cup'; on: boolean }>
  | Readonly<{ type: 'roll/hidden'; on: boolean }>
  | Readonly<{ type: 'roll/go' }>
  | Readonly<{ type: 'truth/toggle' }>
  | Readonly<{ type: 'picker/query'; value: string }>
  | Readonly<{ type: 'picker/move'; delta: number }>
  | Readonly<{ type: 'picker/choose'; rank: Rank }>
  | Readonly<{ type: 'picker/close' }>
  | Readonly<{ type: 'picker/enter' }>
  | Readonly<{ type: 'ladder/open' }>
  | Readonly<{ type: 'ladder/close' }>
  | Readonly<{ type: 'ladder/toggle'; id: LadderId; key: string }>
  | Readonly<{ type: 'ladder/all'; id: LadderId; open: boolean }>
  /** `#rulesBtnGame` and the rules sheet's close: the shell's `rulesOpen` (the in-game sheet; the home screen's Rules is a tab). */
  | Readonly<{ type: 'rules/open' }>
  | Readonly<{ type: 'rules/close' }>
  /** `#historyBtn` and the history sheet's close. */
  | Readonly<{ type: 'history/open' }>
  | Readonly<{ type: 'history/close' }>
  | Readonly<{ type: 'config/open'; target: ConfigTarget }>
  | Readonly<{ type: 'config/close' }>
  | Readonly<{ type: 'config/pick'; choice: string }>
  // ---- the waiting room's bot controls (plan §7 D7) and the host's watch toggle (D6) ----
  | Readonly<{ type: 'bots/add' }>
  | Readonly<{ type: 'bots/remove'; index: number }>
  | Readonly<{ type: 'bots/rename'; index: number; name: string }>
  | Readonly<{ type: 'bots/config'; choice: string }>
  | Readonly<{ type: 'watch/toggle'; on: boolean }>
  /** The host card's selects changed: the raw values, parsed against the current room and remembered. */
  | Readonly<{ type: 'opts/set'; raw: Raw }>
  /** `#p3NameInput`..`#p6NameInput` typed: remembered under its key. */
  | Readonly<{ type: 'pname/typed'; seat: ExtraSeat; value: string }>
  /** `#removeLocalBtn`: the seat's input goes and its key is forgotten (`#addLocalBtn` is a `pname/typed` of the empty string). */
  | Readonly<{ type: 'pname/drop'; seat: ExtraSeat }>
  // ---- the game loop's timers (the legacy host session's) ----
  | Readonly<{ type: 'bot/step' }>
  | Readonly<{ type: 'autoNext' }>;

/** Every table intent's `type`, for the disjointness proof against the shell's 45 (state.test.ts). */
export const TABLE_INTENT_TYPES = [
  'act',
  'bid/place',
  'call/click',
  'peek/click',
  'next/click',
  'finish/click',
  'pull/die',
  'roll/toggleDie',
  'roll/cup',
  'roll/hidden',
  'roll/go',
  'truth/toggle',
  'picker/query',
  'picker/move',
  'picker/choose',
  'picker/close',
  'picker/enter',
  'ladder/open',
  'ladder/close',
  'ladder/toggle',
  'ladder/all',
  'rules/open',
  'rules/close',
  'history/open',
  'history/close',
  'config/open',
  'config/close',
  'config/pick',
  'bots/add',
  'bots/remove',
  'bots/rename',
  'bots/config',
  'watch/toggle',
  'opts/set',
  'pname/typed',
  'pname/drop',
  'bot/step',
  'autoNext',
] as const satisfies ReadonlyArray<TableIntent['type']>;
/** Compile-time: the list above names every table intent (a missing one makes this `false`). */
export const TABLE_INTENTS_LISTED: [
  Exclude<TableIntent['type'], (typeof TABLE_INTENT_TYPES)[number]>,
] extends [never]
  ? true
  : false = true;

/** Every handler and every network event: the shell's intents and the table's. */
export type Intent = SharedIntent<Fidice>;
export type ShellIntent = SharedShellIntent<Fidice>;

// ---- effects -----------------------------------------------------------------------------------

export type TimerId = SharedTimerId<Fidice>;

/** Fidice's own effects, handled by `runEffect` before the shared runner: the two preferences this page alone keeps. */
export type TableEffect =
  | Readonly<{ type: 'writeOpts'; opts: Opts }>
  | Readonly<{ type: 'rememberPName'; seat: ExtraSeat; name: string }>
  | Readonly<{ type: 'forgetPName'; seat: ExtraSeat }>;
export const TABLE_EFFECT_TYPES = [
  'writeOpts',
  'rememberPName',
  'forgetPName',
] as const satisfies ReadonlyArray<TableEffect['type']>;

export type Effect = SharedEffect<Fidice>;
export type Step = SharedStep<Fidice>;
export type Context = Ctx;

const fx = (cue: Cue): Effect => ({ type: 'fx', cue });

/** A refused action: the toast; the picker's choice is dropped so the table matches the state. */
const refuse = (app: App, message: string): Step =>
  step(withTable(app, { picker: EMPTY_PICKER }), toast(message));

// ---- the view, the cues and the paint ---------------------------------------------------------

/** The chair my shell seat holds in the view, null when it holds none (a watcher, a guest whose seat was empty). */
export const myChair = (app: App): EngineSeat | null =>
  app.shell.view === null ? null : engineSeatOf(app.shell.view, app.shell.mySeat);

/** Whether the cup is mine to act on: the round's holder is my chair and no reveal shows. */
export const isMyTurn = (app: App): boolean => {
  const v = app.shell.view;
  const chair = myChair(app);
  return (
    v !== null &&
    chair !== null &&
    v.phase === 'playing' &&
    v.round !== null &&
    v.reveal === null &&
    v.round.holder === chair
  );
};

/** The position a view is at, for the cue memory: the phase, the round, the holder, the bid, the reveal and the log's length; the countdown stamp is not a position. */
export const cueKey = (v: PublicState): string =>
  [
    v.phase,
    v.roundNo,
    v.round?.holder ?? '-',
    v.round?.bid ?? '-',
    v.round?.rolled ?? '-',
    v.reveal === null ? '-' : 'r',
    v.log.length,
  ].join(':');

/**
 * The shell's four cues between two views (plan §7 D11; M9 adds fidice's): the turn chime when
 * the cup reaches my chair online (pass the phone chimes through the curtain), the win or the
 * loss when the game ends with me at a chair.
 */
export const cuesBetween = (prev: PublicState, next: PublicState, app: App): ReadonlyArray<Cue> => {
  const chair = myChair(app);
  if (chair === null) return [];
  const over = next.phase === 'over' && prev.phase !== 'over';
  if (over) return [next.winner === chair ? 'win' : 'lose'];
  const mine =
    app.shell.role !== 'local' &&
    isMyTurn(app) &&
    (prev.round?.holder !== next.round?.holder || prev.roundNo !== next.roundNo);
  return mine ? ['yourTurn'] : [];
};

/**
 * The state side of a paint against the view (`cfg.table.rendered`): the table screen shown, the
 * cue memory keyed on the position, the cues new since `prev` once per position (a re-sent frame
 * plays nothing). A view with no `prev` (a resume, a reconnect, `position/load`) paints cold. The
 * clock is not read here (docs/design/fidice-shell-adoption.md §6 lesson (b)).
 */
const rendered = (app: App, prev: PublicState | null): Step => {
  const view = app.shell.view;
  if (view === null) return pure(app);
  const key = cueKey(view);
  const fresh = prev !== null && key !== app.shell.cues.key;
  const cues = fresh ? cuesBetween(prev, view, app) : [];
  return step(
    { shell: { ...app.shell, cues: { key }, screen: 'tableScreen' }, table: app.table },
    ...cues.map(fx),
    { type: 'scrollTop' },
  );
};

// ---- pass the phone: whose view, and when the curtain rises (plan §7 D8, the legacy `handoffFor`) ----

/** The humans at the table (a chair with no computer). */
const humansAt = (game: PublicState): number => game.players.filter((p) => p.bot === null).length;

/**
 * `localBroadcast`'s seat: the cup holder's while a human holds it, the last seat shown (or the
 * host's) while a computer plays, during the reveal and once the game is over; the curtain comes
 * up when the cup reaches a human who is not the one it was last lifted for, and never at a table
 * with one human or none (Solo, Watch: the legacy covered only pass-the-phone tables).
 */
const viewer: ShellConfig<Fidice>['local']['viewer'] = (app, game) => {
  const last: ShellSeat = app.shell.revealed ?? 0;
  const r = game.round;
  if (game.phase !== 'playing' || r === null || game.reveal !== null)
    return { seat: last, curtain: null, effects: [] };
  if (game.players[r.holder]?.bot !== null) return { seat: last, curtain: null, effects: [] };
  const seat = shellSeatOfChair(game, r.holder);
  const curtain = humansAt(game) > 1 && app.shell.revealed !== seat ? seat : null;
  return { seat, curtain, effects: [] };
};

/**
 * The chair the table is painted for (ui/render.ts `uiOf`): my chair online; pass the phone, the
 * chair of the seat the view was made for (`viewer`: the cup holder's while a human holds it, the
 * last seat shown otherwise), which `shell.mySeat` (always 0 there) does not name.
 */
export const viewedChair = (app: App): EngineSeat | null => {
  const s = app.shell;
  if (s.view === null) return null;
  const seat = s.role === 'local' && s.game !== null ? viewer(app, s.game).seat : s.mySeat;
  return engineSeatOf(s.view, seat);
};

/** `curtain/reveal`: whoever holds the cup lifts the curtain. */
const revealer: ShellConfig<Fidice>['local']['revealer'] = (game) => ({
  seat: game.round === null ? 0 : shellSeatOfChair(game, game.round.holder),
  effects: [],
});

// ---- the shell's hooks into the table, and the config (docs/design/shared-shell.md §4.3) ---------

/** What a game leaves behind when it is left, lost or handed off: the table's memory; the names stay. */
const tableCleared = (table: Table): Table => ({ ...initialTable, extraNames: table.extraNames });

/**
 * What the table drops where a shared flow resets it: a pass-the-phone start, the handoff, a leave
 * and the host lost clear the table's memory; the deal starts the loop afresh (no pending move,
 * no memories, the computers' names spent); an applied action and a guest's `state` frame drop
 * the picker's choice and the dice picked (the legacy `play` did after a bid or a roll); a new
 * view touches nothing.
 */
const reset = (table: Table, at: TableReset): Table => {
  switch (at) {
    case 'startLocal':
    case 'handoff':
    case 'leave':
    case 'lost':
      return tableCleared(table);
    case 'deal':
      return { ...table, pending: null, memories: emptyMemories, botNames: [] };
    case 'applied':
    case 'frame':
      return {
        ...table,
        picker: EMPTY_PICKER,
        rollSelection: [],
        rollCup: false,
        rollHidden: false,
      };
    case 'view':
      return table;
  }
};

/** Fidice's shell config: shellConfig.ts's half completed with the table hooks and the home snapshot's own part. */
export const FIDICE: ShellConfig<Fidice> = {
  ...FIDICE_SHELL,
  table: { initial: initialTable, reset, rendered, refuse },
  local: { viewer, revealer },
  home: {
    ...FIDICE_SHELL.home,
    apply: (app, home) => ({
      shell: { ...app.shell, opts: home.opts },
      table: { ...app.table, extraNames: home.extraNames },
    }),
    resume: (home) => resumeFor(home.save),
    resumeExtra: pure,
  },
};

export const initialShell: Shell = shellInitial(FIDICE);
export const initialApp: App = { shell: initialShell, table: initialTable };

// ---- the deal (plan §4 M3, §7 D6, D9, D10) -----------------------------------------------------

/** The table started: the engine's `start` under the HOST actor, its log stamped; the refusal is the engine's sentence. */
const started = (
  table: State,
  ctx: Context,
): Readonly<{ ok: true; value: State }> | Readonly<{ ok: false; error: string }> => {
  const r = apply(table, HOST, { type: 'start' }, ctx.rng);
  return r.ok ? { ok: true, value: stampLog(r.value, ctx.now()) } : r;
};

/** `(value.trim() || fallback).slice(0, 20)`: the shell's rule for the one name of Solo. */
const nameOr = (raw: string, fallback: string): string => {
  const trimmed = raw.trim();
  return (trimmed === '' ? fallback : trimmed).slice(0, 20);
};

/** The room's terms for a start from the home card in `mode`: Solo and Watch bring their computers when the card names none. */
export const optsForMode = (opts: Opts, mode: Mode): Opts => {
  switch (mode) {
    case 'watch':
      return { ...opts, watch: true, bots: opts.bots === 0 ? WATCH_BOTS : opts.bots };
    case 'solo':
      return { ...opts, watch: false, bots: opts.bots === 0 ? SOLO_BOTS : opts.bots };
    case 'local':
    case 'online':
      return { ...opts, watch: false };
  }
};

/**
 * The humans of a start from the home card: pass the phone seats the first two names and every
 * further one the click carried or the table remembers (through the shared `localSeats` rule with
 * this game's defaults, ` N` on a clash), Solo the first name alone, Watch the standing host.
 */
export const localHumans = (
  intent: Readonly<{ p1: string; p2: string }> & Raw,
  extraNames: Table['extraNames'],
  mode: Mode,
): ReadonlyArray<Player> => {
  if (mode === 'watch') return [{ id: seatId(0), name: WATCH_HOST_NAME }];
  if (mode === 'solo') return [{ id: seatId(0), name: nameOr(intent.p1, DEFAULT_NAME) }];
  const carried = (raw: string | undefined, seat: ExtraSeat): ReadonlyArray<string> =>
    raw !== undefined ? [raw] : extraNames[seat] !== null ? [extraNames[seat]] : [];
  const raws = [
    intent.p1,
    intent.p2,
    ...carried(intent.p3, 2),
    ...carried(intent.p4, 3),
    ...carried(intent.p5, 4),
    ...carried(intent.p6, 5),
  ];
  return localSeats(raws, localNamesOf(FIDICE_SHELL)).map((p, k) => ({
    id: seatId(k),
    name: p.name,
  }));
};

/**
 * `local/click` in Pass the phone, Solo or Watch (plan §7 D9): the room's terms off the raw inputs
 * for the mode shown, the humans seated with the card's computers (shellConfig.ts `seatTable`),
 * the engine's `start` applied (its refusal the toast, §6 risk 12), the game handed to the shared
 * `startLocal`, then the terms remembered. The shell's own case seats a pair; this replaces it.
 */
const localStart = (
  app: App,
  intent: Readonly<{ p1: string; p2: string }> & Raw,
  ctx: Context,
): Step => {
  const mode = app.shell.playMode;
  const opts = optsForMode(parseOpts(intent, app.shell.opts), mode);
  const table = seatTable('', localHumans(intent, app.table.extraNames, mode), opts, ctx.rng);
  const game = started(table, ctx);
  if (!game.ok) return step(app, toast(game.error));
  return then(startLocal(withShell(app, { opts }), game.value, ctx, FIDICE), (a) =>
    step(a, { type: 'writeOpts', opts }),
  );
};

/**
 * `host/deal` (`#startGameBtn`): the host (standing when the room watches), every CONNECTED guest
 * in seat order and the room's computers sit down, the waiting room's names on the computers,
 * then `start`; a refusal ("Need at least 2 players.") is the toast and the room keeps waiting.
 * The shell's own case would deal `Jeff` to an empty seat (web/shared/ui/shell.ts `host/deal`);
 * this table drops the seat instead (plan §4 M3), so the case is taken here.
 */
const hostDeal = (app: App, ctx: Context): Step => {
  const s = app.shell;
  if (s.role !== 'host' || s.game !== null) return pure(app);
  const players: ReadonlyArray<Player> = [
    { id: seatId(0), name: s.myName },
    ...s.seats.flatMap((seat, i) =>
      seat.connected && seat.name !== null ? [{ id: seatId(i + 1), name: seat.name }] : [],
    ),
  ];
  const table = withBotNames(seatTable(s.code ?? '', players, s.opts, ctx.rng), app.table.botNames);
  const game = started(table, ctx);
  if (!game.ok) return step(app, toast(game.error));
  return broadcast(
    { shell: { ...s, game: game.value }, table: reset(app.table, 'deal') },
    ctx,
    FIDICE,
  );
};

/** The handoff (plan §7 D8) is the shell's two-seat room: offered for a pass-the-phone game of exactly two humans and no computer (ui/render.ts paints `#handoffBtn` by it). */
export const handoffable = (app: App): boolean => {
  const s = app.shell;
  const game =
    s.role === 'local' && s.game !== null
      ? s.game
      : s.resume?.kind === 'local'
        ? s.resume.game
        : null;
  return game !== null && game.players.length === 2 && humansAt(game) === 2;
};

// ---- the actions -------------------------------------------------------------------------------

/** The next state broadcast for the role: the host's wire, pass the phone's curtain. */
const commit = (app: App, game: State, ctx: Context, at: TableReset = 'applied'): Step => {
  const next: App = { shell: { ...app.shell, game }, table: reset(app.table, at) };
  switch (app.shell.role) {
    case 'host':
      return broadcast(next, ctx, FIDICE);
    case 'local':
      return localBroadcast(next, false, ctx, FIDICE);
    case 'guest':
    case null:
      return pure(app);
  }
};

/** Who acts from a pass-the-phone device: the cup's holder while a human holds it, else the host's chair (or the HOST when it stands). */
export const localActor = (game: State): ReturnType<typeof actorFor> => {
  const r = game.round;
  if (game.phase === 'playing' && r !== null && game.reveal === null) {
    if (game.players[r.holder]?.bot === null) return bySeat(r.holder);
  }
  return game.hostSeat === null ? HOST : bySeat(game.hostSeat);
};

/**
 * `act(action)`: a guest sends it to the host; the host applies it for its own chair (or as the
 * HOST when it watches) and broadcasts, refusing with a toast; pass the phone applies it for
 * whoever holds the cup.
 */
const act = (app: App, action: Action, ctx: Context): Step => {
  const s = app.shell;
  if (s.role === 'guest') return step(app, { type: 'send', frame: actionFrame(action) });
  if (s.game === null || s.role === null) return pure(app);
  const actor = s.role === 'host' ? actorFor(s.game, 0) : localActor(s.game);
  if (actor === null) return pure(app);
  const r = apply(s.game, actor, action, ctx.rng);
  if (!r.ok) return refuse(app, r.error);
  return commit(app, stampLog(r.value, ctx.now()), ctx);
};

/** `roll/go`: the legacy mapping of the ticks to a `roll` (src/app/controller.ts): the picked dice roll on the table, or tuck back under the cup, with the cup shaken when ticked. */
const rollGo = (app: App, ctx: Context): Step => {
  const { rollCup, rollHidden, rollSelection } = app.table;
  if (!rollCup && rollSelection.length === 0) return step(app, toast(PICK_DICE_MSG));
  const tucking = rollHidden && rollSelection.length > 0;
  return act(
    app,
    {
      type: 'roll',
      cup: rollCup || tucking,
      table: tucking ? [] : rollSelection,
      intoCup: tucking ? rollSelection : [],
    },
    ctx,
  );
};

// ---- the game loop: the legacy `schedule()` as timers (§6 risk 11) --------------------------------

const botStepTimer = (ms: number): Effect => ({
  type: 'startTimer',
  id: 'bot/step',
  ms,
  then: { type: 'bot/step' },
});
const autoNextTimer = (ms: number): Effect => ({
  type: 'startTimer',
  id: 'autoNext',
  ms,
  then: { type: 'autoNext' },
});
const cancel = (id: GameTimer): Effect => ({ type: 'cancelTimer', id });

/** The device that runs the engine: the host, and pass the phone (Solo and Watch included). */
const runsEngine = (app: App): boolean => app.shell.role === 'host' || app.shell.role === 'local';

/** The reveal's timer is armed while a reveal shows with its stamp (the legacy `nextTimer`). */
const revealArmed = (game: State | null): boolean =>
  game !== null && game.phase === 'playing' && game.reveal !== null && game.autoNextAt !== null;

/**
 * After every state change on the device that runs the engine, what the legacy `schedule()` did
 * (src/net/host.ts:339-368): a pending computer move is dropped (its timer restarted or cancelled
 * below); a reveal arms `autoNext` once, stamping `autoNextAt` into the state and broadcasting it
 * (a change while it shows leaves the timer alone; a resumed reveal re-arms for what is left);
 * otherwise the reveal's timer goes and the holder's computer, if any, decides its move
 * (bots/brain.ts), which `bot/step` applies after the move's delay. A change before it fires
 * decides again and re-arms, which `createTimers` takes as a restart.
 */
const scheduled = (before: App, after: App, ctx: Context): Step => {
  const game = after.shell.game;
  if (game === before.shell.game || !runsEngine(after)) return pure(after);
  const dropped = withTable(after, { pending: null });
  const cancelBot = after.table.pending === null ? [] : [cancel('bot/step')];
  const cancelNext =
    revealArmed(before.shell.game) && !revealArmed(game) ? [cancel('autoNext')] : [];
  if (game?.phase !== 'playing') return step(dropped, ...cancelBot, ...cancelNext);
  if (game.reveal !== null) {
    if (game.autoNextAt !== null)
      return before.shell.game === null
        ? step(dropped, ...cancelBot, autoNextTimer(Math.max(0, game.autoNextAt - ctx.now())))
        : step(dropped, ...cancelBot);
    const armed = scheduleAutoNext(game, ctx.now() + AUTO_NEXT_MS);
    return then(step(dropped, ...cancelBot, autoNextTimer(AUTO_NEXT_MS)), (a) =>
      commit(a, armed, ctx, 'view'),
    );
  }
  const decision = decide(game, after.table.memories, ctx.rng);
  const holder = game.round?.holder;
  if (decision === null || holder === undefined) return step(dropped, ...cancelBot, ...cancelNext);
  return step(
    withTable(after, {
      pending: { holder, action: decision.step.action },
      memories: decision.memories,
    }),
    ...cancelNext,
    botStepTimer(decision.step.delay),
  );
};

/** `bot/step` fired: the pending move applied for its holder's chair, if the cup is still there; a refused move is dropped as the legacy dropped it. */
const botStep = (app: App, ctx: Context): Step => {
  const p = app.table.pending;
  const g = app.shell.game;
  const cleared = withTable(app, { pending: null });
  if (p === null || g?.phase !== 'playing' || g.reveal !== null || g.round?.holder !== p.holder)
    return pure(cleared);
  const r = apply(g, bySeat(p.holder), p.action, ctx.rng);
  return r.ok ? commit(cleared, stampLog(r.value, ctx.now()), ctx) : pure(cleared);
};

/** `autoNext` fired: the next round, if the reveal still shows (the legacy `autoNext`). */
const autoNext = (app: App, ctx: Context): Step => {
  const g = app.shell.game;
  if (g?.reveal === null || g?.phase !== 'playing') return pure(app);
  const r = apply(g, HOST, { type: 'next' }, ctx.rng);
  return r.ok ? commit(app, stampLog(r.value, ctx.now()), ctx) : pure(app);
};

// ---- the waiting room's bot controls (plan §7 D7) --------------------------------------------------

/** One lobby frame per connected seat, each with its own `you` (n-seat-sessions.md D3), after the room's terms changed. */
const lobbySends = (s: Shell): ReadonlyArray<Effect> =>
  s.seats.flatMap((seat: SeatState, i) =>
    seat.connected
      ? [
          {
            type: 'send',
            frame: lobbyFrame(s.myName, s.opts, s.seats, i + 1),
            seat: (i + 1) as ShellSeat,
          } as const,
        ]
      : [],
  );

/** The room's terms rewritten while the host waits, the lobby re-sent, the terms remembered. */
const roomTerms = (app: App, opts: Opts, table: Partial<Table> = {}): Step => {
  const next = withTable(withShell(app, { opts }), table);
  return step(next, ...lobbySends(next.shell), { type: 'writeOpts', opts });
};

/** The host at its waiting room, with nobody dealt in: the bot controls apply here alone. */
const atWaitingRoom = (app: App): boolean => app.shell.role === 'host' && app.shell.game === null;

/** The chairs the room's humans take: the host (unless it watches) and every connected guest. */
const humansAtRoom = (s: Shell): number =>
  (s.opts.watch ? 0 : 1) + s.seats.filter((seat) => seat.connected).length;

// ---- the picker and the ladders ------------------------------------------------------------------

/** The bid search's rows for the query above the current bid (domain/search.ts). */
export const suggestionsOf = (app: App): ReadonlyArray<Suggestion> =>
  suggestHands(app.table.picker.query, app.shell.view?.round?.bid ?? null);

const withPicker = (app: App, over: Partial<Picker>): App =>
  withTable(app, { picker: { ...app.table.picker, ...over } });

const toggled = (list: ReadonlyArray<string>, key: string): ReadonlyArray<string> =>
  list.includes(key) ? list.filter((k) => k !== key) : [...list, key];

const withLadder = (app: App, id: LadderId, f: (ladder: Ladder) => Ladder): App =>
  withTable(app, { ladders: { ...app.table.ladders, [id]: f(app.table.ladders[id]) } });

// ---- the reducer -------------------------------------------------------------------------------

const tableIntent = (app: App, intent: TableIntent, ctx: Context): Step => {
  const s = app.shell;
  const t = app.table;
  switch (intent.type) {
    case 'act':
      return act(app, intent.action, ctx);
    case 'bid/place': {
      const rank = intent.rank ?? t.picker.selected;
      return rank === null
        ? step(app, toast(PICK_A_BID_MSG))
        : act(app, { type: 'bid', rank }, ctx);
    }
    case 'call/click':
      return act(app, { type: 'call' }, ctx);
    case 'peek/click':
      return act(app, { type: 'peek' }, ctx);
    case 'next/click':
      return act(app, { type: 'next' }, ctx);
    case 'finish/click':
      return act(app, { type: 'finish' }, ctx);
    case 'pull/die':
      return act(app, { type: 'pull', die: intent.die }, ctx);
    case 'roll/toggleDie':
      return pure(
        withTable(app, {
          rollSelection: t.rollSelection.includes(intent.die)
            ? t.rollSelection.filter((d) => d !== intent.die)
            : [...t.rollSelection, intent.die],
        }),
      );
    case 'roll/cup':
      return pure(withTable(app, { rollCup: intent.on }));
    case 'roll/hidden':
      return pure(withTable(app, { rollHidden: intent.on }));
    case 'roll/go':
      return rollGo(app, ctx);
    case 'truth/toggle':
      return pure(withTable(app, { showTruth: !t.showTruth }));
    case 'picker/query':
      return pure(withPicker(app, { query: intent.value, highlight: 0, listOpen: true }));
    case 'picker/move': {
      const n = suggestionsOf(app).length;
      const at = n === 0 ? 0 : (((t.picker.highlight + intent.delta) % n) + n) % n;
      return pure(withPicker(app, { highlight: at, listOpen: true }));
    }
    case 'picker/choose':
      return pure(
        withPicker(app, { selected: intent.rank, query: '', highlight: 0, listOpen: false }),
      );
    case 'picker/close':
      return pure(withPicker(app, { listOpen: false }));
    case 'picker/enter': {
      const pick = suggestionsOf(app)[t.picker.highlight];
      return pick === undefined
        ? pure(withPicker(app, { listOpen: false }))
        : tableIntent(app, { type: 'picker/choose', rank: pick.rank }, ctx);
    }
    case 'ladder/open':
      return pure(withTable(app, { ladderOpen: true }));
    case 'ladder/close':
      return pure(withTable(app, { ladderOpen: false }));
    case 'ladder/toggle':
      return pure(
        withLadder(app, intent.id, (l) =>
          l.allOpen
            ? { open: [], closed: [intent.key], allOpen: false }
            : {
                ...l,
                open: toggled(l.open, intent.key),
                closed: l.closed.filter((k) => k !== intent.key),
              },
        ),
      );
    case 'ladder/all':
      return pure(
        withLadder(app, intent.id, () => ({ open: [], closed: [], allOpen: intent.open })),
      );
    case 'rules/open':
      return pure(withShell(app, { rulesOpen: true }));
    case 'rules/close':
      return pure(withShell(app, { rulesOpen: false }));
    case 'history/open':
      return pure(withTable(app, { historyOpen: true }));
    case 'history/close':
      return pure(withTable(app, { historyOpen: false }));
    case 'config/open':
      return step(
        withShell(withTable(app, { configTarget: intent.target }), { screen: 'configScreen' }),
        { type: 'scrollTop' },
      );
    case 'config/close':
      return pure(
        withShell(withTable(app, { configTarget: null }), {
          screen: s.role === 'host' ? 'hostWaitScreen' : 'homeScreen',
        }),
      );
    case 'config/pick': {
      const opts = { ...s.opts, botChoice: intent.choice };
      return atWaitingRoom(app)
        ? roomTerms(app, opts)
        : step(withShell(app, { opts }), { type: 'writeOpts', opts });
    }
    case 'bots/add': {
      if (!atWaitingRoom(app)) return pure(app);
      const room = humansAtRoom(s) + s.opts.bots;
      return room >= s.opts.seatCount || s.opts.bots >= MAX_BOTS
        ? step(app, toast(TABLE_FULL_TOAST))
        : roomTerms(app, { ...s.opts, bots: s.opts.bots + 1 });
    }
    case 'bots/remove':
      return !atWaitingRoom(app) || s.opts.bots === 0
        ? pure(app)
        : roomTerms(
            app,
            { ...s.opts, bots: s.opts.bots - 1 },
            { botNames: t.botNames.filter((_, i) => i !== intent.index) },
          );
    case 'bots/rename': {
      if (!atWaitingRoom(app) || intent.index < 0 || intent.index >= s.opts.bots) return pure(app);
      const name = cleanName(intent.name);
      const names = Array.from({ length: s.opts.bots }, (_, i) =>
        i === intent.index ? (name === '' ? null : name) : (t.botNames[i] ?? null),
      );
      return pure(withTable(app, { botNames: names }));
    }
    case 'bots/config':
      return atWaitingRoom(app)
        ? roomTerms(app, { ...s.opts, botChoice: intent.choice })
        : pure(app);
    case 'watch/toggle':
      return atWaitingRoom(app) ? roomTerms(app, { ...s.opts, watch: intent.on }) : pure(app);
    case 'opts/set': {
      const opts = parseOpts(intent.raw, s.opts);
      return step(withShell(app, { opts }), { type: 'writeOpts', opts });
    }
    case 'pname/typed':
      return step(
        withTable(app, { extraNames: { ...t.extraNames, [intent.seat]: intent.value } }),
        { type: 'rememberPName', seat: intent.seat, name: intent.value.trim() },
      );
    case 'pname/drop':
      return step(withTable(app, { extraNames: { ...t.extraNames, [intent.seat]: null } }), {
        type: 'forgetPName',
        seat: intent.seat,
      });
    case 'bot/step':
      return botStep(app, ctx);
    case 'autoNext':
      return autoNext(app, ctx);
  }
};

const reduceInner = (app: App, intent: Intent, ctx: Context): Step => {
  if (intent.type === 'local/click') return localStart(app, intent, ctx);
  if (intent.type === 'host/deal') return hostDeal(app, ctx);
  // The handoff is a two-seat room (plan §7 D8): offered for two humans and no computer.
  if (intent.type === 'handoff/click' && !handoffable(app)) return pure(app);
  if (!isShellIntent(intent)) return tableIntent(app, intent, ctx);
  const shell = reduceShell(app, intent, ctx, FIDICE);
  // The room's terms are remembered as the table opens.
  return intent.type === 'host/click'
    ? then(shell, (a) => step(a, { type: 'writeOpts', opts: a.shell.opts }))
    : shell;
};

/** Every intent, then the game loop's timers over the result (the legacy `commit` → `schedule`). */
export const reduce = (app: App, intent: Intent, ctx: Context): Step =>
  then(reduceInner(app, intent, ctx), (a) => scheduled(app, a, ctx));

// ---- storage: persist and resume -------------------------------------------------------------

/** The resume box `initHome` shows, or null (a finished game is not offered). */
export const resumeFor = (save: Save | null): Resume | null => shellResumeFor(save, FIDICE);

/** `persist()`: the save for the current role, or null when there is nothing to save. */
export const saveFor = (app: App): Save | null => shellSaveFor(app.shell);

/** `initHome`'s reads: the names, the tab, mode and terms (defaults when unreadable), the save. */
export const readHome = (store: Store): HomeSnapshot => shellReadHome(store, FIDICE);

// ---- what the sessions read back ---------------------------------------------------------------

/** The host session's context: the shell's fields, the room's five terms and the guest seats as the shell holds them (net/host.ts `HostContext`). */
export type HostContext = HostContextOf<Fidice> &
  HostExtra &
  Readonly<{ seats: ReadonlyArray<SeatState> }>;
export type GuestContext = GuestContextOf;

export const hostContextOf = (app: App): HostContext => ({
  ...shellHostContextOf(app.shell),
  seats: app.shell.seats,
});

export const guestContextOf = (app: App): GuestContext => shellGuestContextOf(app.shell);

// ---- running the effects -----------------------------------------------------------------------

/** The adapters an effect reaches: the shell's (web/shared/ui/shellEffects.ts); fidice adds none. main.ts constructs the real ones, tests record. */
export type EffectDeps = ShellEffectDeps<Fidice>;

/** One effect against the adapters; `app` is the state after the step that produced it. Fidice's two first, then the shell's runner. */
export const runEffect = (app: App, effect: Effect, deps: EffectDeps): void => {
  if (isShellEffect(effect)) {
    runShellEffect(app.shell, effect, deps, FIDICE);
    return;
  }
  switch (effect.type) {
    case 'writeOpts':
      writeOpts(deps.store, effect.opts);
      return;
    case 'rememberPName':
      EXTRA_NAME_PREFS[effect.seat].write(deps.store, effect.name);
      return;
    case 'forgetPName':
      EXTRA_NAME_PREFS[effect.seat].write(deps.store, '');
      return;
  }
};

/** The seeded rng a driver hands the reducer (the hook's `__rng`), named here so the tests spell one type. */
export type { Rng };
