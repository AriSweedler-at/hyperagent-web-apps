// The Sheshbesh app as a reducer over intents (docs/design/backgammon-board.md §4 "The interaction
// model", §5 "The shell"; docs/ARCHITECTURE.md "Module boundaries": imported only by main.ts, the
// painters and tests). `App` is gin's shape split in two so the shell can be lifted into a shared
// reducer later (design §5.3): `shell` is the home screen, the waiting rooms, the session
// (role, code, names, the engine `State` for the host and pass-and-play, my `View` for every role)
// and the resume offer, field for field as gin names them; `table` is the board's interaction
// memory (the tapped source, the forced die, the die-chip tray, a drag, the overlays, the curtain
// and the R14 beat), which no other game has. `Intent` is every handler and every network event,
// and `reduce` returns the next App with a list of `Effect`s: what to persist, toast, send, play
// or arm, as data. main.ts runs the effects through the real adapters (`runEffect`) and paints the
// App (ui/render.ts); the tests run the reducer alone.
//
// Turn authority is gin's (design §5.3): the host applies `applyAction` for both seats and
// broadcasts `viewFor(game, 1)` as a `state` frame, a refusal to the guest is a `toast` frame; the
// guest sends `action` frames (its `roll` asks the host to roll, Q9); pass-and-play keeps the
// `State` here with no Peer. Online is the default mode (storage.ts `DEFAULT_PLAY_MODE`, as gin's);
// an invite link (`join/link`) shows the online panel with the code filled in.
//
// Tap-to-move (design §4.2): a tap names a source or a destination; the sole legal source is
// derived, never stored (`effectiveSelection`); a destination reached by chains that differ in
// consequence opens the die-chip tray (`pending`) instead of committing. The helpers that decide
// this (`sourcesOf`, `effectiveSelection`, `targetsOf`) live in ui/board.ts, so the discs on the
// board and the reducer's commits come from one computation.
import { formatError } from '../../../../shared/lib/json.ts';
import { ok, type Result } from '../../../../shared/lib/result.ts';
import { randomCode, sanitiseCode, validateCode } from '../../../../shared/lib/roomCode.ts';
import type { Rng } from '../../../../shared/lib/rng.ts';
import { DEFAULT_SOUND_FONT, type SoundFontName } from '../../../../shared/lib/sound/fonts.ts';
import {
  actorOf,
  applyAction,
  createGame,
  decodeState,
  isShippedVariant,
  MATCH_LENGTHS,
  DEFAULT_MATCH_LENGTH,
  DEFAULT_VARIANT,
  matchOver,
  moveTo,
  otherSeat,
  rulesOf,
  viewFor,
} from '../engine/index.ts';
import type {
  Action,
  Die,
  LogEntry,
  Move,
  Now,
  Pair,
  PlayedMove,
  Player,
  PointIndex,
  Seat,
  ShippedVariant,
  State,
  To,
  View,
} from '../engine/types.ts';
import type { GuestContext } from '../net/guest.ts';
import { connectingMsg } from '../net/guest.ts';
import type { HostContext } from '../net/host.ts';
import { OPENING_MSG, handoffMsg } from '../net/host.ts';
import {
  action as actionFrame,
  guestNameFor,
  lobby as lobbyFrame,
  state as stateFrame,
  toast as toastFrame,
  type GuestFrame,
  type HostFrame,
} from '../protocol.ts';
import {
  DEFAULT_PLAY_MODE,
  HOME_TABS,
  clearSave,
  readCurtainMode,
  readHomeTab,
  readMatchLength,
  readName,
  readP2Name,
  readPlayMode,
  readSave,
  readSoundFont,
  readVariant,
  writeCurtainMode,
  writeHomeTab,
  writeMatchLength,
  writeName,
  writeP2Name,
  writePlayMode,
  writeSave,
  writeSoundFont,
  writeVariant,
  type CurtainMode,
  type HomeTab,
  type PlayMode,
  type Save,
  type Store,
} from '../storage.ts';
import {
  deadDice,
  effectiveSelection,
  hitsAgainst,
  sourcesOf,
  targetsOf,
  type Chain,
  type Pending,
  type Place,
  type Target,
} from './board.ts';
import type { Cue } from './sound.ts';
import type { RulesSlot } from './rules.ts';

// ---- the state ---------------------------------------------------------------------------------

// ui/home.ts paints the tabs and modes from the lists storage.ts decodes; ui/ may not import storage.ts.
export { DEFAULT_PLAY_MODE, HOME_TABS, type CurtainMode, type HomeTab, type PlayMode };
// The reducer resolves taps with the same helpers the board paints from (ui/board.ts); re-exported for main.ts.
export {
  sourcesOf,
  effectiveSelection,
  targetsOf,
  type Chain,
  type Pending,
  type Place,
  type Target,
};

export type Role = 'host' | 'guest' | 'local';

/** The five top-level screens `showScreen` toggles between (design §4 `SCREENS`). */
export const SCREENS = [
  'homeScreen',
  'hostWaitScreen',
  'guestWaitScreen',
  'tableScreen',
  'endgameScreen',
] as const;
export type ScreenId = (typeof SCREENS)[number];

/** `#hostWaitStatus` / `#guestWaitStatus`: the text and whether it still pulses. */
export type WaitStatus = Readonly<{ text: string; pulse: boolean }>;

/** What the home screen's resume box offers (`resumeFor`), one per save role. */
export type Resume =
  | Readonly<{ kind: 'local'; game: State }>
  | Readonly<{
      kind: 'host';
      code: string;
      myName: string;
      matchLength: number;
      variant: ShippedVariant;
      game: State;
      oppName: string | null;
      /** The save's `handoff` mark: the offer reads as the handoff, and the room resumes as one. */
      handoff: boolean;
    }>
  | Readonly<{ kind: 'guest'; code: string; myName: string }>;

/** `nextCue`'s memory: the view the last cues were played for, so a re-sent frame plays none. */
export type CueState = Readonly<{ key: string | null }>;
export const INITIAL_CUES: CueState = { key: null };

/**
 * Everything but the board's own interaction: gin's `App` fields under gin's names (design §4),
 * with `matchLength` and `variant` where gin has `target`. `game` and `view` sit here too: the
 * shell owns the session (who plays, from which device), the table only remembers taps.
 */
export type Shell = Readonly<{
  role: Role | null;
  code: string | null;
  myName: string;
  /** Points to win, from `#matchLengthSel`/`#localMatchLengthSel` (`backgammon_matchLength`). */
  matchLength: number;
  /** The rules of the next match, from `#variantSel`/`#localVariantSel` (`backgammon_variant`). */
  variant: ShippedVariant;
  /** The engine state: host and pass-and-play only. */
  game: State | null;
  /** My view: every role (the guest's arrives in `state` frames). */
  view: View | null;
  oppName: string | null;
  oppConnected: boolean;
  nameTouched: boolean;
  /** Pass-and-play: the seat that lifted the curtain this turn (Q4). */
  revealed: Seat | null;
  homeTab: HomeTab;
  playMode: PlayMode;
  /** The first player's name as last read from `backgammon_name` or typed into any of its inputs. */
  p1Name: string;
  /** The second player's name as last read from `backgammon_p2Name` or typed. */
  p2Name: string;
  screen: ScreenId;
  /** The `netAttempt` ticket: bumped by every start, cancel and leave. */
  netAttempt: number;
  hostStatus: WaitStatus;
  guestStatus: WaitStatus;
  /** `#startGameBtn` shown (a guest is in the lobby). */
  startGameVisible: boolean;
  /**
   * The hosted game came from pass-and-play (`#handoffBtn` / `#curtainHandoffBtn`) and its remote
   * seat has not joined yet: saved with the host save, cleared by the guest's join and by every
   * leave and cancel (gin's flow).
   */
  handoff: boolean;
  /** `backgammon_name`, as `initHome` put it in the inputs. */
  savedName: string | null;
  resume: Resume | null;
  /** `#rulesOverlay` open (the in-game rules sheet; the home tab is `homeTab`). */
  rulesOpen: boolean;
  cues: CueState;
  /** `#playSubmenu` held open by a long press on the Play tab. */
  submenuOpen: boolean;
  /** A long press just opened the submenu, so the click that follows must not switch tabs. */
  longPressed: boolean;
  /** `#codeInput` as last sanitised. */
  codeDraft: string;
  /** The font every cue plays in (`backgammon_soundFont`, docs/design/sound-fonts.md §6). */
  soundFont: SoundFontName;
}>;

/** The board's interaction memory (design §4.1 `Table`). Session only: never saved, never on the wire. */
export type Table = Readonly<{
  /** A tapped source only; the sole legal source is derived, never stored (`effectiveSelection`). */
  selected: Place | null;
  /** A die forced by tapping it (`die/pick`); cleared after a commit. */
  picked: Die | null;
  pending: Pending | null;
  /** A checker dragged by hand (ui/board/dragger.ts): its source and the target it is over. */
  drag: Readonly<{ from: Place; over: To | null }> | null;
  /** A tapped point that is neither source nor target, for `SHAKE_MS`. */
  shake: PointIndex | null;
  /** `#resultOverlay` shown (put away with "Look at the table"). */
  resultOpen: boolean;
  menuOpen: boolean;
  historyOpen: boolean;
  /** Pass-and-play: the seat the phone is handed to, or null when the curtain is down. */
  curtain: Seat | null;
  /** `backgammon_curtain`: `never` skips the overlay (nothing is hidden either way, Q4). */
  curtainMode: CurtainMode;
  /** R14 beat: the forfeited roll stays visible until this clock time; the curtain waits for it. */
  noMoveUntil: number | null;
  /** The view the previous paint showed (main.ts paints after every intent): `flightsBetween`'s `prev`. */
  lastPainted: View | null;
  /**
   * The dice are tumbling (design §4.7): from a roll (mine as it is asked for, anyone's as it
   * arrives) until the `tumble` timer fires. The roll modal stays up through my own, the board
   * takes no tap, the painter cycles the faces.
   */
  rolling: boolean;
}>;

export type App = Readonly<{ shell: Shell; table: Table }>;

export const DEFAULT_NAME = 'Ari';
export const DEFAULT_GUEST_NAME = 'Jeff';
export const DEFAULT_HOME_TAB: HomeTab = 'play';
export const DEFAULT_CURTAIN_MODE: CurtainMode = 'always';
export const NAME_MAX = 20;

export const initialShell: Shell = {
  role: null,
  code: null,
  myName: DEFAULT_NAME,
  matchLength: DEFAULT_MATCH_LENGTH,
  variant: DEFAULT_VARIANT,
  game: null,
  view: null,
  oppName: null,
  oppConnected: false,
  nameTouched: false,
  revealed: null,
  homeTab: DEFAULT_HOME_TAB,
  playMode: DEFAULT_PLAY_MODE,
  p1Name: '',
  p2Name: '',
  screen: 'homeScreen',
  netAttempt: 0,
  hostStatus: { text: OPENING_MSG, pulse: true },
  guestStatus: { text: 'Connecting…', pulse: true },
  startGameVisible: false,
  handoff: false,
  savedName: null,
  resume: null,
  rulesOpen: false,
  cues: INITIAL_CUES,
  submenuOpen: false,
  longPressed: false,
  codeDraft: '',
  soundFont: DEFAULT_SOUND_FONT,
};

export const initialTable: Table = {
  selected: null,
  picked: null,
  pending: null,
  drag: null,
  shake: null,
  resultOpen: false,
  menuOpen: false,
  historyOpen: false,
  curtain: null,
  curtainMode: DEFAULT_CURTAIN_MODE,
  noMoveUntil: null,
  lastPainted: null,
  rolling: false,
};

export const initialApp: App = { shell: initialShell, table: initialTable };

// ---- the strings the app (not the sessions) writes ---------------------------------------------

/** The Play tab opens its submenu after this long a press. */
export const LONG_PRESS_MS = 450;
/** A tapped point that is neither source nor target shakes for this long (design §4.2 rule 1). */
export const SHAKE_MS = 120;
/** R14: a forfeited roll stays on the table this long before the curtain rises (design §4.5). */
export const NO_MOVE_MS = 1200;
/**
 * The dice tumble this long after a roll (design §4.7): the painter's face cycle (theme.css
 * `tumble-faces`, 560ms of cycling) fits inside it with the settled faces showing for the rest,
 * then the roll modal goes and the board answers taps. A cosmetic beat: the engine rolled at once.
 */
export const TUMBLE_MS = 700;
/** `onGuestGone`'s toast lasts this long, as does `LOST_HOST_MSG`. */
export const GONE_TOAST_MS = 4000;
export const NOT_CONNECTED_MSG = 'Not connected to the host.';
export const WAITING_FOR_GUEST_MSG = 'Waiting for your opponent to join.';
export const OPPONENT_LEFT_MSG = 'Opponent left. Waiting for someone to join…';
export const ROOM_FULL_MSG = 'That room already has two players.';
export const LOST_HOST_MSG = 'Lost connection to the host — reconnecting…';
export const DISCONNECTED_MSG = 'Disconnected from the host — reconnecting…';
export const LEAVE_LOCAL_MSG = 'End this match? The score will be cleared.';
export const LEAVE_ONLINE_MSG = 'Leave this match? The room will close.';
/** `sandbox/load` outside pass-and-play, and a position the decoder refuses. */
export const SANDBOX_LOCAL_ONLY_MSG = 'Positions can only be set up in pass-and-play.';
export const badPositionMsg = (error: string): string => `That position is not valid: ${error}`;
export const joinedMsg = (name: string): string => `${name} joined! Ready when you are.`;
export const hostRoomMsg = (hostName: string): string =>
  `Connected — waiting for ${hostName} to start`;
/** `guest/lost` once the match is over: the host closed the room, there is nothing to rejoin. */
export const hostLeftMsg = (hostName: string): string => `${hostName} left the table.`;
export const guestGoneMsg = (oppName: string | null, code: string | null): string =>
  `${oppName ?? 'Opponent'} disconnected — they can rejoin with code ${String(code)}.`;
/**
 * The hit toast, for the player hit, in their own numbering, from the moves and never from log
 * text: `Kapará. Ari hit you on your 20-point.`; two hits in one turn share the toast (there is
 * one `#toast`, its timer restarts): `… on your 20-point and your 5-point.`
 */
export const hitMsg = (byName: string, ownPoints: ReadonlyArray<number>): string => {
  const named = ownPoints.map((p) => `your ${String(p)}-point`);
  const where =
    named.length <= 1
      ? (named[0] ?? '')
      : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1] ?? ''}`;
  return `Kapará. ${byName} hit you on ${where}.`;
};

// ---- intents -----------------------------------------------------------------------------------

/** What `initHome` reads from storage, in one snapshot (`readHome`). */
export type HomeSnapshot = Readonly<{
  name: string | null;
  p2Name: string | null;
  homeTab: HomeTab;
  playMode: PlayMode;
  variant: ShippedVariant;
  matchLength: number;
  curtainMode: CurtainMode;
  /** A bad value read as the default (main.ts logs it). */
  soundFont: SoundFontName;
  save: Save | null;
}>;

export type Intent =
  // ---- home (gin's names) ----
  | Readonly<{ type: 'home/init'; home: HomeSnapshot }>
  | Readonly<{ type: 'name/typed'; value: string }>
  | Readonly<{ type: 'p1name/typed'; value: string }>
  | Readonly<{ type: 'p2name/typed'; value: string }>
  /** `setHomeTab(tab, { persist })`: an unknown tab is `play`. */
  | Readonly<{ type: 'tab/set'; tab: string; persist?: boolean }>
  /**
   * A glossary link (docs/design/glossary-links.md) or a `#rule-<id>` deep link at boot: the Rules
   * tab on the home screen, the rules overlay anywhere else, then the rule scrolled to and flashed.
   */
  | Readonly<{ type: 'rules/show'; rule: string }>
  /** `setPlayMode(mode)`: `local`, else `online`. */
  | Readonly<{ type: 'mode/set'; mode: string }>
  /** `#variantSel` / `#localVariantSel`: a shipped variant is remembered; anything else is ignored. */
  | Readonly<{ type: 'variant/set'; variant: string }>
  /** `#matchLengthSel` / `#localMatchLengthSel`: one of MATCH_LENGTHS is remembered; anything else is ignored. */
  | Readonly<{ type: 'matchLength/set'; length: number | string }>
  /**
   * `#hostBtn`: the raw name; the match length and variant are the shell's (set by the selects'
   * `variant/set`/`matchLength/set`), unless the binder passes the raw select values along.
   */
  | Readonly<{ type: 'host/click'; name: string; matchLength?: string; variant?: string }>
  /** `#joinBtn`: the raw input values. */
  | Readonly<{ type: 'join/click'; name: string; code: string }>
  /** `#localBtn`: the raw names; the options as for `host/click`. */
  | Readonly<{
      type: 'local/click';
      p1: string;
      p2: string;
      matchLength?: string;
      variant?: string;
    }>
  /** `#resumeBtn`: whatever `shell.resume` offers. */
  | Readonly<{ type: 'resume/click' }>
  /** `#handoffBtn` / `#curtainHandoffBtn` (pass-and-play alone): the game goes on as a hosted room. */
  | Readonly<{ type: 'handoff/click' }>
  /** `#cancelHostBtn` / `#cancelGuestBtn`. */
  | Readonly<{ type: 'cancel' }>
  | Readonly<{ type: 'cancel/finish' }>
  /** The hook's `showScreen(id)`. */
  | Readonly<{ type: 'screen/show'; screen: ScreenId }>
  /** `#tabPlayBtn` pointerdown: the long-press timer starts. */
  | Readonly<{ type: 'submenu/press' }>
  | Readonly<{ type: 'submenu/release' }>
  | Readonly<{ type: 'submenu/longPress' }>
  /** `#tabPlayBtn` click: the Play tab, unless a long press just opened the submenu. */
  | Readonly<{ type: 'tab/playClick' }>
  | Readonly<{ type: 'submenu/pick'; mode: string }>
  | Readonly<{ type: 'submenu/dismiss' }>
  /** `#codeInput` input: the raw value and the InputEvent's type. */
  | Readonly<{ type: 'code/typed'; value: string; inputType: string }>
  /** `?join=<code>` at boot (an invite link): the code into `#codeInput`, the Play tab, online mode. */
  | Readonly<{ type: 'join/link'; code: string }>
  /** `#soundBtn`. */
  | Readonly<{ type: 'sound/toggle' }>
  /** `__backgammon.soundFont(name)` (the console, for now): a valid font plays from now on and is remembered. */
  | Readonly<{ type: 'soundFont/set'; font: SoundFontName }>
  /** `#shareCodeBtn`. */
  | Readonly<{ type: 'share/click' }>
  // ---- net: host ----
  /** `startHost(resumeCode)`: null draws a fresh code. */
  | Readonly<{ type: 'host/start'; code: string | null }>
  | Readonly<{ type: 'host/status'; text: string; stopPulse: boolean }>
  | Readonly<{ type: 'host/frame'; frame: GuestFrame }>
  | Readonly<{ type: 'host/guestGone'; iceFailed: string | null }>
  /** `#startGameBtn` "Start the match" (gin's name, so the shell extraction stays mechanical). */
  | Readonly<{ type: 'host/deal' }>
  // ---- net: guest ----
  | Readonly<{ type: 'guest/start'; code: string }>
  | Readonly<{ type: 'guest/status'; text: string; stopPulse: boolean }>
  | Readonly<{ type: 'guest/connected' }>
  | Readonly<{ type: 'guest/frame'; frame: HostFrame }>
  | Readonly<{ type: 'guest/lost' }>
  // ---- the table (design §4.1) ----
  /** `act(action)`: every role (the hook, and the buttons below resolve to it). */
  | Readonly<{ type: 'act'; action: Action }>
  /** A `.point` tapped: its absolute index. */
  | Readonly<{ type: 'point/tap'; point: PointIndex }>
  /** `#barTop` / `#barBottom` tapped: the reducer knows which bar is mine. */
  | Readonly<{ type: 'bar/tap' }>
  /** `#offLight` / `#offDark` tapped: the reducer knows which tray is mine. */
  | Readonly<{ type: 'off/tap' }>
  /** A `.die` tapped while moving: force that die (again: release it). */
  | Readonly<{ type: 'die/pick'; die: Die }>
  /** A `.chip` in the die-chip tray: commit that chain. */
  | Readonly<{ type: 'chip/tap'; index: number }>
  /** `#chipCancelBtn`, Escape, or a source tap: the tray closes. */
  | Readonly<{ type: 'chip/cancel' }>
  /** A tap on the board's own surface (the felt between the places): the tray closes and the tapped source is let go (design §4.2 rule 2b). */
  | Readonly<{ type: 'board/tap' }>
  /** `#rollBtn`, `#dice` before the roll, and the curtain button when it promised a roll. */
  | Readonly<{ type: 'roll/click' }>
  | Readonly<{ type: 'undo/click' }>
  /** `#doneBtn` is reserved (R13: the turn ends by itself); the intent is accepted and ignored. */
  | Readonly<{ type: 'done/click' }>
  | Readonly<{ type: 'double/click' }>
  | Readonly<{ type: 'take/click' }>
  | Readonly<{ type: 'pass/click' }>
  /** `#rsNextBtn` "Next game", and `#nextGameBtn` "Rematch" once the match is over. */
  | Readonly<{ type: 'next/click' }>
  /** `#rsPeekBtn` "Look at the table" / `#resultChipBtn` "Result". */
  | Readonly<{ type: 'result/peek' }>
  | Readonly<{ type: 'result/open' }>
  | Readonly<{ type: 'checker/dragStart'; from: Place }>
  | Readonly<{ type: 'checker/dragOver'; over: To | null }>
  | Readonly<{ type: 'checker/dragEnd' }>
  | Readonly<{ type: 'menu/toggle' }>
  | Readonly<{ type: 'history/toggle' }>
  | Readonly<{ type: 'rules/toggle' }>
  /** `#menuCurtainToggle`: remembered under `backgammon_curtain`. */
  | Readonly<{ type: 'curtain/mode'; mode: CurtainMode }>
  /** `#curtainBtn`. */
  | Readonly<{ type: 'curtain/reveal' }>
  /** The `noMove` timer fired: the forfeited roll has been seen. */
  | Readonly<{ type: 'noMove/elapsed' }>
  /** The `shake` timer fired. */
  | Readonly<{ type: 'shake/elapsed' }>
  /** The `tumble` timer fired: the dice have settled (design §4.7). */
  | Readonly<{ type: 'tumble/elapsed' }>
  /**
   * `window.__backgammon.setup(state)` (e2e and stories): the pass-and-play game's engine state is
   * replaced by `state` (decoded, so a hand-made object is checked); refused outside a local game.
   */
  | Readonly<{ type: 'sandbox/load'; state: unknown }>
  | Readonly<{ type: 'leave/request' }>
  | Readonly<{ type: 'leave/confirmed' }>
  | Readonly<{ type: 'leave/finish' }>
  /** The page became visible: the wake lock is taken again while in a game. */
  | Readonly<{ type: 'visible' }>
  /** The hook's `render()`. */
  | Readonly<{ type: 'render' }>
  /** A session asked the app to persist. */
  | Readonly<{ type: 'persist' }>;

/**
 * The shell's half of `Intent` (design §4): what a shared shell reducer would own once both games
 * are green (design §5.3). Everything else is the table's.
 */
export const SHELL_INTENT_TYPES = [
  'home/init',
  'name/typed',
  'p1name/typed',
  'p2name/typed',
  'tab/set',
  'rules/show',
  'mode/set',
  'variant/set',
  'matchLength/set',
  'host/click',
  'join/click',
  'local/click',
  'resume/click',
  'handoff/click',
  'cancel',
  'cancel/finish',
  'screen/show',
  'submenu/press',
  'submenu/release',
  'submenu/longPress',
  'tab/playClick',
  'submenu/pick',
  'submenu/dismiss',
  'code/typed',
  'join/link',
  'sound/toggle',
  'soundFont/set',
  'share/click',
  'host/start',
  'host/status',
  'host/frame',
  'host/guestGone',
  'host/deal',
  'guest/start',
  'guest/status',
  'guest/connected',
  'guest/frame',
  'guest/lost',
] as const satisfies ReadonlyArray<Intent['type']>;
export type ShellIntent = Extract<Intent, { type: (typeof SHELL_INTENT_TYPES)[number] }>;
export type TableIntent = Exclude<Intent, ShellIntent>;
const isShellIntent = (intent: Intent): intent is ShellIntent =>
  (SHELL_INTENT_TYPES as ReadonlyArray<string>).includes(intent.type);

// ---- effects -----------------------------------------------------------------------------------

export type TimerId = 'longPress' | 'shake' | 'noMove' | 'tumble';

export type Effect =
  | Readonly<{ type: 'persist' }>
  | Readonly<{ type: 'clearSave' }>
  /** A handed-off game given back to pass-and-play: the room was cancelled before anyone joined. */
  | Readonly<{ type: 'saveLocal'; game: State }>
  | Readonly<{ type: 'rememberName'; name: string }>
  | Readonly<{ type: 'rememberP2Name'; name: string }>
  | Readonly<{ type: 'writeHomeTab'; tab: HomeTab }>
  | Readonly<{ type: 'writePlayMode'; mode: PlayMode }>
  | Readonly<{ type: 'writeVariant'; variant: ShippedVariant }>
  | Readonly<{ type: 'writeMatchLength'; length: number }>
  | Readonly<{ type: 'writeCurtainMode'; mode: CurtainMode }>
  | Readonly<{ type: 'writeSoundFont'; font: SoundFontName }>
  /** Scroll `rule` into view inside the rules `slot` that is on screen and flash it (web/shared/edge/glossary.ts). */
  | Readonly<{ type: 'revealRule'; slot: RulesSlot; rule: string }>
  /** `ms` null is the default duration. */
  | Readonly<{ type: 'toast'; message: string; ms: number | null }>
  /** To the current session's channel, if open. */
  | Readonly<{ type: 'send'; frame: HostFrame | GuestFrame }>
  | Readonly<{ type: 'fx'; cue: Cue | 'tap' }>
  | Readonly<{ type: 'wakeLock'; hold: boolean }>
  | Readonly<{ type: 'startHost'; code: string; attempt: number; resume: boolean }>
  | Readonly<{ type: 'startGuest'; code: string; attempt: number }>
  /** Close the current session's channel and destroy its Peer. */
  | Readonly<{ type: 'closeNet' }>
  /** `confirm(message)`: dispatch `then` when the player agrees. */
  | Readonly<{ type: 'confirm'; message: string; then: Intent }>
  /** Dispatch `intent` next, after the effects before it ran. */
  | Readonly<{ type: 'then'; intent: Intent }>
  /** Re-read storage and dispatch `home/init`. */
  | Readonly<{ type: 'initHome' }>
  /** `showScreen`'s `window.scrollTo(0, 0)`. */
  | Readonly<{ type: 'scrollTop' }>
  /** Arm a named timer that dispatches `then` after `ms`; arming again restarts it. */
  | Readonly<{ type: 'startTimer'; id: TimerId; ms: number; then: Intent }>
  | Readonly<{ type: 'cancelTimer'; id: TimerId }>
  /** `fx.toggle()`. */
  | Readonly<{ type: 'toggleSound' }>
  /** The invite for `code` (its link) through the share sheet or the clipboard. */
  | Readonly<{ type: 'share'; code: string }>
  /** The first player's name into every input that shows it (`initHome`, and after a keystroke). */
  | Readonly<{ type: 'fillName'; name: string }>
  | Readonly<{ type: 'fillP2Name'; name: string }>
  /** `#codeInput`'s value after sanitising. */
  | Readonly<{ type: 'setCode'; value: string }>;

export type Step = Readonly<{ app: App; effects: ReadonlyArray<Effect> }>;

export type Context = Readonly<{ rng: Rng; now: Now }>;

const pure = (app: App): Step => ({ app, effects: [] });
const step = (app: App, ...effects: ReadonlyArray<Effect>): Step => ({ app, effects });
/** Run `f` after `s`, keeping `s`'s effects first. */
const then = (s: Step, f: (app: App) => Step): Step => {
  const next = f(s.app);
  return { app: next.app, effects: [...s.effects, ...next.effects] };
};
const toast = (message: string, ms: number | null = null): Effect => ({
  type: 'toast',
  message,
  ms,
});
const withShell = (app: App, over: Partial<Shell>): App => ({
  ...app,
  shell: { ...app.shell, ...over },
});
const withTable = (app: App, over: Partial<Table>): App => ({
  ...app,
  table: { ...app.table, ...over },
});
/** A refused action: the toast; the tray, the tapped source and a tumble are dropped so the board matches the state. */
const refuse = (app: App, message: string): Step =>
  step(
    withTable(app, { selected: null, picked: null, pending: null, rolling: false }),
    toast(message),
  );

// ---- the table against a new view -------------------------------------------------------------

/** The table's memory against a new view: a source that can still move, a forced die still in hand; the tray never survives a change. */
const settled = (table: Table, v: View): Table => ({
  ...table,
  selected:
    table.selected !== null && sourcesOf(v).includes(table.selected) ? table.selected : null,
  picked:
    table.picked !== null &&
    v.movesLeft.includes(table.picked) &&
    !deadDice(v).includes(table.picked)
      ? table.picked
      : null,
  pending: null,
});

// ---- what changed between two views: cues, the hit toast, the R14 beat ------------------------

const sameEntry = (a: LogEntry | null, b: LogEntry | null): boolean =>
  a !== null &&
  b !== null &&
  a.kind === b.kind &&
  a.at === b.at &&
  a.text === b.text &&
  a.seat === b.seat;

const sameMove = (a: PlayedMove, b: PlayedMove | undefined): boolean =>
  b?.from === a.from && b.to === a.to && b.die === a.die && b.hit === a.hit;
const extendsPlay = (prefix: ReadonlyArray<PlayedMove>, play: ReadonlyArray<PlayedMove>): boolean =>
  play.length > prefix.length && prefix.every((m, i) => sameMove(m, play[i]));
const samePlay = (a: ReadonlyArray<PlayedMove>, b: ReadonlyArray<PlayedMove>): boolean =>
  a.length === b.length && a.every((m, i) => sameMove(m, b[i]));

/**
 * The moves `next` shows that `prev` did not (design §3.9 `flightsBetween`'s rule): this turn's
 * new moves, or, once the turn flipped or the game ended, the finished turn's tail beyond what
 * `prev` saw. The mover is `prev.turn` either way. Nothing across games or after an undo.
 */
export const newMovesBetween = (prev: View | null, next: View): ReadonlyArray<PlayedMove> => {
  if (prev?.gameNo !== next.gameNo) return [];
  if (prev.turn === next.turn && prev.phase === 'moving' && next.phase === 'moving')
    return extendsPlay(prev.played, next.played) ? next.played.slice(prev.played.length) : [];
  const flipped = prev.turn !== next.turn || (next.phase === 'over' && prev.phase !== 'over');
  // A pass ends the game without a play: `lastPlay` is then still the one `prev` already showed.
  const finished = prev.lastPlay !== next.lastPlay && !samePlay(prev.lastPlay, next.lastPlay);
  return flipped &&
    finished &&
    (prev.played.length === 0 || extendsPlay(prev.played, next.lastPlay))
    ? next.lastPlay.slice(prev.played.length)
    : [];
};

/** R14: `next` carries a forfeited roll `prev` had not seen. */
const freshNoMove = (prev: View | null, next: View): boolean =>
  next.lastAction !== null &&
  next.lastAction.kind === 'noMove' &&
  (prev === null || !sameEntry(prev.lastAction, next.lastAction));

/** `next` carries a roll (played or forfeited, R14) that `prev` had not seen: the roll cue, the tumble. */
export const rolledBetween = (prev: View, next: View): boolean =>
  next.lastAction !== null &&
  (next.lastAction.kind === 'roll' || next.lastAction.kind === 'noMove') &&
  !sameEntry(prev.lastAction, next.lastAction);

/** The sounds the change from `prev` to `next` earns (ui/sound.ts names); pass-and-play chimes turns with the curtain instead. */
export const cuesBetween = (prev: View, next: View, role: Role | null): ReadonlyArray<Cue> => {
  const rolled = rolledBetween(prev, next);
  const moved = newMovesBetween(prev, next).map((m): Cue =>
    m.hit ? 'hit' : m.to === 'off' ? 'bearOff' : 'place',
  );
  const doubled = next.phase === 'cubeOffered' && prev.phase !== 'cubeOffered';
  const ended = next.phase === 'over' && prev.phase !== 'over';
  const won = role === 'local' || next.result?.winner === next.me.idx;
  const myTurn = role !== 'local' && next.isMyTurn && !prev.isMyTurn && next.phase !== 'over';
  return [
    ...(rolled ? (['roll'] as const) : []),
    ...moved,
    ...(doubled ? (['double'] as const) : []),
    ...(ended ? ([won ? 'win' : 'lose'] as const) : []),
    ...(myTurn ? (['yourTurn'] as const) : []),
  ];
};

/** Online: "Kapará." on the hit player's device as the opponent's hit moves arrive, in my numbering. */
const hitToastsBetween = (prev: View, next: View): ReadonlyArray<Effect> => {
  const mover = prev.turn;
  if (mover === next.me.idx) return [];
  const rules = rulesOf(next.variant);
  const points = newMovesBetween(prev, next).flatMap((m) =>
    m.hit && m.to !== 'off' ? [rules.ownOf(next.me.idx, m.to)] : [],
  );
  return points.length === 0 ? [] : [toast(hitMsg(next.players[mover].name, points))];
};

/**
 * Pass-and-play: the same toast for the seat now taking the phone, from the turn just finished
 * against them. At the turn's end the hitter still holds the phone, so the flip is the wrong
 * moment (and the hitter's own view had already shown the moves, so a diff finds none): the
 * reveal fires it, or the flip itself when the curtain is off.
 */
const handedHits = (game: State, seat: Seat): ReadonlyArray<Effect> => {
  const v = viewFor(game, seat);
  const points = hitsAgainst(v, seat);
  return points.length === 0 ? [] : [toast(hitMsg(v.players[otherSeat(seat)].name, points))];
};

/** The view a cue memory keys on: the same game position paints the same for either seat. */
const viewKey = (v: View): string =>
  `${String(v.gameNo)}:${v.phase}:${String(v.turn)}:${String(v.log.length)}:${String(v.played.length)}`;

// ---- flows -------------------------------------------------------------------------------------

/** `nameOr`: `(value.trim() || fallback).slice(0, 20)`. */
const nameOr = (raw: string, fallback: string): string => {
  const trimmed = raw.trim();
  return (trimmed === '' ? fallback : trimmed).slice(0, NAME_MAX);
};

/** A match length from a select's raw value: one of MATCH_LENGTHS, else `fallback`. */
export const parseMatchLength = (raw: string | number | undefined, fallback: number): number => {
  const n = typeof raw === 'number' ? raw : parseInt(raw ?? '', 10);
  return MATCH_LENGTHS.includes(n) ? n : fallback;
};

/** A variant from a select's raw value: a shipped one, else `fallback` (plakoto and fevga are typed, not playable). */
export const parseVariant = (raw: string | undefined, fallback: ShippedVariant): ShippedVariant =>
  raw !== undefined && isShippedVariant(raw) ? raw : fallback;

const showScreen = (app: App, screen: ScreenId): Step =>
  step(withShell(app, { screen }), { type: 'scrollTop' });

/** What a game leaves behind when it is left, lost or handed off: the table's taps and overlays; the curtain setting stays. */
const tableCleared = (table: Table): Table => ({ ...initialTable, curtainMode: table.curtainMode });

/**
 * The state side of a paint: nothing without a view; else the screen is the table or, once the
 * match is over, the end screen; the tapped source and the forced die are kept only while they
 * still apply; the cues, the hit toast and the R14 beat come from the change since `prev` (the
 * view this one replaces), once per position (`cues.key`), so a re-sent frame plays nothing.
 * The paint itself is main.ts's after every intent.
 */
const TUMBLE_TIMER: Effect = {
  type: 'startTimer',
  id: 'tumble',
  ms: TUMBLE_MS,
  then: { type: 'tumble/elapsed' },
};

const rendered = (app: App, prev: View | null, now: number): Step => {
  const view = app.shell.view;
  if (view === null) return pure(app);
  const key = viewKey(view);
  const fresh = key !== app.shell.cues.key && prev !== null;
  const cues = fresh ? cuesBetween(prev, view, app.shell.role) : [];
  // A roll that just arrived (mine, or the other seat's) tumbles for TUMBLE_MS (design §4.7); a
  // tumble already running (the guest's, started at the click) restarts with the faces.
  const rolled = fresh && rolledBetween(prev, view);
  // Pass-and-play toasts the player hit when the phone reaches them (`handedHits`), not here.
  const hitToasts = fresh && app.shell.role !== 'local' ? hitToastsBetween(prev, view) : [];
  const beat = key !== app.shell.cues.key && freshNoMove(prev, view);
  const screen: ScreenId = view.matchOver ? 'endgameScreen' : 'tableScreen';
  const resultOpen = view.phase === 'over' ? prev?.phase !== 'over' || app.table.resultOpen : false;
  return step(
    {
      shell: { ...app.shell, cues: { key }, screen },
      table: {
        ...settled(app.table, view),
        resultOpen,
        lastPainted: prev,
        noMoveUntil: beat ? now + NO_MOVE_MS : app.table.noMoveUntil,
        rolling: rolled || app.table.rolling,
      },
    },
    ...cues.map((cue): Effect => ({ type: 'fx', cue })),
    ...hitToasts,
    ...(rolled ? [TUMBLE_TIMER] : []),
    ...(beat
      ? [
          {
            type: 'startTimer',
            id: 'noMove',
            ms: NO_MOVE_MS,
            then: { type: 'noMove/elapsed' },
          } as const,
        ]
      : []),
    { type: 'scrollTop' },
  );
};

/** `broadcast()`: my view, the guest's view on the wire, the taps cleared, saved, rendered. */
const broadcast = (app: App, now: number): Step => {
  const game = app.shell.game;
  if (game === null) return pure(app);
  return then(
    step(
      withTable(withShell(app, { view: viewFor(game, 0) }), {
        selected: null,
        picked: null,
        pending: null,
      }),
      { type: 'send', frame: stateFrame(viewFor(game, 1)) },
      { type: 'persist' },
    ),
    (a) => rendered(a, app.shell.view, now),
  );
};

/** `dispatch(seat, action)`, host only: apply, or refuse to the mover (a toast frame to the guest); then broadcast. */
const hostDispatch = (app: App, seat: Seat, action: Action, ctx: Context): Step => {
  const game = app.shell.game;
  if (game === null) return pure(app);
  const res = applyAction(game, seat, action, ctx.rng, ctx.now);
  if (!res.ok)
    return seat === 0
      ? refuse(app, res.error)
      : step(app, { type: 'send', frame: toastFrame(res.error) });
  return broadcast(withShell(app, { game: res.value }), ctx.now());
};

/**
 * `localBroadcast(initial)` (design §4.9): the actor's view (the mover, or the seat answering a
 * double) while the game is on, the revealed seat's (or seat 0's) once it is over; the curtain
 * comes up when the phone must change hands, chiming unless this is the start or a reveal. R14:
 * a forfeited roll keeps the roller's view and the curtain down until `noMove/elapsed`.
 */
const localBroadcast = (app: App, initial: boolean, now: number): Step => {
  const game = app.shell.game;
  if (game === null) return pure(app);
  const prev = app.shell.view;
  const actor = actorOf(game);
  const holding = freshNoMove(prev, viewFor(game, game.turn)) && app.table.noMoveUntil === null;
  const viewIdx: Seat = holding ? otherSeat(game.turn) : (actor ?? app.shell.revealed ?? 0);
  const curtain =
    actor !== null &&
    !holding &&
    app.table.curtainMode === 'always' &&
    app.shell.revealed !== viewIdx
      ? viewIdx
      : null;
  // With the curtain off the phone changes hands unannounced: the seat now looking is told of
  // the hits against them here; with it on, `curtain/reveal` tells them once they have it.
  const handed =
    curtain === null && prev !== null && prev.me.idx !== viewIdx ? handedHits(game, viewIdx) : [];
  return then(
    step(
      withTable(withShell(app, { view: viewFor(game, viewIdx) }), {
        selected: null,
        picked: null,
        pending: null,
        curtain,
      }),
      { type: 'persist' },
      ...(curtain !== null && !initial ? [{ type: 'fx', cue: 'yourTurn' } as const] : []),
      ...handed,
    ),
    (a) => rendered(a, prev, now),
  );
};

/** Apply `actions` in order for `seat`, stopping at the first refusal. */
const applyAll = (
  game: State,
  seat: Seat,
  actions: ReadonlyArray<Action>,
  ctx: Context,
): Result<State, string> =>
  actions.reduce<Result<State, string>>(
    (r, a) => (r.ok ? applyAction(r.value, seat, a, ctx.rng, ctx.now) : r),
    ok(game),
  );

/** `localAct(action)`: applied for the actor (`next` for whoever taps it). */
const localAct = (app: App, actions: ReadonlyArray<Action>, ctx: Context): Step => {
  const game = app.shell.game;
  if (game === null) return pure(app);
  const res = applyAll(game, actorOf(game) ?? game.turn, actions, ctx);
  if (!res.ok) return refuse(app, res.error);
  // A new game of the match: whoever tapped "Next game" may not be its starter, so the curtain names them.
  const fresh = res.value.gameNo !== game.gameNo;
  return localBroadcast(
    withShell(app, { game: res.value, revealed: fresh ? null : app.shell.revealed }),
    false,
    ctx.now(),
  );
};

/**
 * `act(action)` by role (design §4.2 "Commit"): pass-and-play and the host apply the actions in
 * order and broadcast once; the guest sends one `action` frame per action, in order (the host
 * applies them one by one and broadcasts after each).
 */
const act = (app: App, actions: ReadonlyArray<Action>, ctx: Context): Step => {
  switch (app.shell.role) {
    case 'local':
      return localAct(app, actions, ctx);
    case 'host': {
      const game = app.shell.game;
      if (game === null) return pure(app);
      const res = applyAll(game, 0, actions, ctx);
      if (!res.ok) return refuse(app, res.error);
      return broadcast(withShell(app, { game: res.value }), ctx.now());
    }
    case 'guest':
    case null:
      // A guest's channel is open exactly while the host counts as connected; no role has no channel.
      return app.shell.role === 'guest' && app.shell.oppConnected
        ? step(app, ...actions.map((a): Effect => ({ type: 'send', frame: actionFrame(a) })))
        : refuse(app, NOT_CONNECTED_MSG);
  }
};

/** A chain committed from a tap, a chip or a drop: the tray, the source and the forced die are dropped first. */
const commit = (app: App, moves: ReadonlyArray<Move>, ctx: Context): Step =>
  act(
    withTable(app, { selected: null, picked: null, pending: null, drag: null }),
    moves.map((m): Action => ({ type: 'move', from: m.from, to: m.to, die: m.die })),
    ctx,
  );

/** `startLocal(game)`: pass-and-play, no Peer; the wake lock is held; the curtain names the starter. */
const startLocal = (app: App, game: State, now: number): Step =>
  then(
    step(
      {
        shell: {
          ...app.shell,
          role: 'local',
          code: null,
          oppConnected: true,
          game,
          revealed: null,
        },
        table: tableCleared(app.table),
      },
      { type: 'wakeLock', hold: true },
    ),
    (a) => localBroadcast(a, true, now),
  );

const withHostStatus = (app: App, text: string, stopPulse = false): App =>
  withShell(app, { hostStatus: { text, pulse: stopPulse ? false : app.shell.hostStatus.pulse } });
const withGuestStatus = (app: App, text: string, stopPulse = false): App =>
  withShell(app, {
    guestStatus: { text, pulse: stopPulse ? false : app.shell.guestStatus.pulse },
  });

/** `startHost(resumeCode)` up to the network: the session is the `startHost` effect. */
const startHost = (app: App, resumeCode: string | null, ctx: Context): Step => {
  const code = resumeCode ?? randomCode('backgammon', ctx.rng);
  const attempt = app.shell.netAttempt + 1;
  return then(
    showScreen(
      withHostStatus(
        withShell(app, { role: 'host', code, netAttempt: attempt, startGameVisible: false }),
        OPENING_MSG,
      ),
      'hostWaitScreen',
    ),
    (a) => step(a, { type: 'startHost', code, attempt, resume: resumeCode !== null }),
  );
};

/** `startGuest(code)` up to the network: the session is the `startGuest` effect. */
const startGuest = (app: App, code: string): Step => {
  const attempt = app.shell.netAttempt + 1;
  return then(
    showScreen(
      withGuestStatus(
        withShell(app, { role: 'guest', code, netAttempt: attempt }),
        connectingMsg(code),
      ),
      'guestWaitScreen',
    ),
    (a) => step(a, { type: 'startGuest', code, attempt }),
  );
};

/** `game.players[1].name = name` on a rejoin. */
const renameGuest = (game: State, name: string): State => ({
  ...game,
  players: [game.players[0], { ...game.players[1], name }],
});

/**
 * `onGuestGone()` after `oppConnected` was cleared. During a handoff nobody has joined yet, so a
 * channel that closed before its join leaves the wait screen saying to send the invite, no toast.
 */
const guestGone = (app: App, now: number): Step => {
  const s = app.shell;
  if (s.handoff) return pure(withHostStatus(app, handoffMsg(s.code ?? '', s.oppName)));
  if (s.game !== null && s.view !== null && !s.view.matchOver)
    return then(rendered(app, s.view, now), (a) =>
      step(a, toast(guestGoneMsg(a.shell.oppName, a.shell.code), GONE_TOAST_MS)),
    );
  if (s.game === null)
    return pure(withShell(withHostStatus(app, OPPONENT_LEFT_MSG), { startGameVisible: false }));
  return pure(app);
};

/** `onGuestMsg(conn, msg)` for a decoded frame. */
const hostFrame = (app: App, frame: GuestFrame, ctx: Context): Step => {
  switch (frame.t) {
    case 'join': {
      const name = guestNameFor(frame.name, app.shell.myName);
      const connected = withShell(app, { oppConnected: true, oppName: name, handoff: false });
      if (app.shell.game !== null) {
        // Rejoin: keep the seat, refresh the name.
        return broadcast(
          withShell(connected, { game: renameGuest(app.shell.game, name) }),
          ctx.now(),
        );
      }
      return step(
        withShell(withHostStatus(connected, joinedMsg(name)), { startGameVisible: true }),
        {
          type: 'send',
          frame: lobbyFrame(app.shell.myName, {
            matchLength: app.shell.matchLength,
            variant: app.shell.variant,
          }),
        },
      );
    }
    case 'action':
      return app.shell.game === null ? pure(app) : hostDispatch(app, 1, frame.action, ctx);
  }
};

/** `onHostMsg(msg)` for a decoded frame. */
const guestFrame = (app: App, frame: HostFrame, now: number): Step => {
  switch (frame.t) {
    case 'welcome':
    case 'lobby':
      return pure(
        withGuestStatus(
          withShell(app, {
            oppName: frame.hostName,
            matchLength: frame.matchLength,
            variant: frame.variant,
          }),
          hostRoomMsg(frame.hostName),
        ),
      );
    case 'full':
      return pure(withGuestStatus(app, ROOM_FULL_MSG));
    case 'toast':
      return refuse(app, frame.msg);
    case 'state':
      return rendered(
        withShell(app, { view: frame.view, oppConnected: true }),
        app.shell.view,
        now,
      );
  }
};

/** A new match with the same players and options (`#nextGameBtn` "Rematch"); the guest waits for the host's. */
const rematch = (app: App, game: State, ctx: Context): Step => {
  const fresh = createGame(
    game.players,
    { matchLength: game.options.matchLength, rotation: game.options.rotation },
    ctx.rng,
    ctx.now,
  );
  switch (app.shell.role) {
    case 'local':
      return localBroadcast(withShell(app, { game: fresh, revealed: null }), false, ctx.now());
    case 'host':
      return broadcast(withShell(app, { game: fresh }), ctx.now());
    case 'guest':
    case null:
      return pure(app);
  }
};

// ---- home, resume, leave ---------------------------------------------------------------------

/** The resume box `initHome` shows, or null (a finished match is not offered). */
export const resumeFor = (save: Save | null): Resume | null => {
  if (save === null) return null;
  switch (save.role) {
    case 'local':
      return matchOver(save.game.match) ? null : { kind: 'local', game: save.game };
    case 'host':
      return save.game !== null && !matchOver(save.game.match)
        ? {
            kind: 'host',
            code: save.code,
            myName: save.myName,
            matchLength: save.matchLength,
            variant: save.variant,
            game: save.game,
            oppName: save.oppName,
            handoff: save.handoff === true,
          }
        : null;
    case 'guest':
      return { kind: 'guest', code: save.code, myName: save.myName };
  }
};

/** `#resumeBtn`'s label for a resume offer (design §4 "Resume labels"). */
export const resumeLabel = (resume: Resume): string => {
  switch (resume.kind) {
    case 'local':
      return `Resume pass & play: ${resume.game.players.map((p) => p.name).join(' vs ')}`;
    case 'host':
      return resume.handoff ? handoffLabel(resume.game) : `Resume hosting room ${resume.code}`;
    case 'guest':
      return `Rejoin room ${resume.code}`;
  }
};

/** `#handoffBtn`'s tooltip, and a handed-off room's resume offer: seat 0 keeps this device and hosts; seat 1 joins through the invite. */
export const handoffLabel = (game: State): string =>
  `Continue online: ${game.players[0].name} hosts, ${game.players[1].name} joins by invite`;

/** `setHomeTab(tab, opts)`. */
const setHomeTab = (app: App, tab: string, persist: boolean): Step => {
  const known = HOME_TABS.find((t) => t === tab) ?? DEFAULT_HOME_TAB;
  return step(
    withShell(app, { homeTab: known }),
    ...(persist ? [{ type: 'writeHomeTab', tab: known } as const] : []),
  );
};

/** `initHome()` over a storage snapshot: the saved names go into the name inputs, the options into the shell. */
const initHome = (app: App, home: HomeSnapshot): Step =>
  then(showScreen(app, 'homeScreen'), (a) =>
    then(
      step(
        {
          shell: {
            ...a.shell,
            savedName: home.name,
            p1Name: home.name ?? '',
            p2Name: home.p2Name ?? '',
            nameTouched: home.name !== null ? true : a.shell.nameTouched,
            homeTab: home.homeTab,
            playMode: home.playMode,
            variant: home.variant,
            matchLength: home.matchLength,
            soundFont: home.soundFont,
            resume: resumeFor(home.save),
          },
          table: { ...a.table, curtainMode: home.curtainMode },
        },
        ...(home.name === null ? [] : [{ type: 'fillName', name: home.name } as const]),
        ...(home.p2Name === null ? [] : [{ type: 'fillP2Name', name: home.p2Name } as const]),
      ),
      (b) => setHomeTab(b, home.homeTab, false),
    ),
  );

/** `#resumeBtn` for each offer. */
const resume = (app: App, offer: Resume, ctx: Context): Step => {
  switch (offer.kind) {
    case 'local':
      return startLocal(app, offer.game, ctx.now());
    case 'host':
      return startHost(
        withShell(app, {
          myName: offer.myName,
          matchLength: offer.matchLength,
          variant: offer.variant,
          game: offer.game,
          oppName: offer.oppName,
          view: viewFor(offer.game, 0),
          // A handoff nobody joined resumes as one, under the code the invite already carries.
          handoff: offer.handoff,
        }),
        offer.code,
        ctx,
      );
    case 'guest':
      return startGuest(withShell(app, { myName: offer.myName }), offer.code);
  }
};

/**
 * `#handoffBtn` / `#curtainHandoffBtn`: the pass-and-play game goes on as a hosted room with a
 * fresh code. Seat 0 keeps this device as the host; seat 1 joins from its own through the
 * invite, and the host's join handler takes it as a rejoin. The pass-and-play marks (the curtain,
 * the revealed seat, the taps) are cleared as a leave clears them.
 */
const handoff = (app: App, game: State, ctx: Context): Step =>
  startHost(
    {
      shell: {
        ...app.shell,
        myName: game.players[0].name,
        matchLength: game.options.matchLength,
        variant: game.variant,
        game,
        oppName: game.players[1].name,
        oppConnected: false,
        view: viewFor(game, 0),
        revealed: null,
        handoff: true,
      },
      table: tableCleared(app.table),
    },
    null,
    ctx,
  );

/** `leaveGame()` after the confirm and the network close: the reset, then home. */
const leaveFinish = (app: App): Step =>
  step(
    {
      shell: {
        ...app.shell,
        netAttempt: app.shell.netAttempt + 1,
        role: null,
        game: null,
        view: null,
        oppConnected: false,
        code: null,
        revealed: null,
        handoff: false,
        cues: INITIAL_CUES,
      },
      table: tableCleared(app.table),
    },
    { type: 'clearSave' },
    { type: 'initHome' },
  );

/** `#cancelHostBtn` / `#cancelGuestBtn` after the Peer is destroyed. A handed-off game nobody joined goes back to pass-and-play. */
const cancelFinish = (app: App): Step =>
  step(
    withShell(app, { role: null, netAttempt: app.shell.netAttempt + 1, handoff: false }),
    app.shell.handoff && app.shell.game !== null
      ? { type: 'saveLocal', game: app.shell.game }
      : { type: 'clearSave' },
    { type: 'initHome' },
  );

// ---- the table: taps, the tray, the dice, a drag (design §4.2-§4.4) -----------------------

/** My view while I may act and the board is live; null under the curtain, while the dice tumble, or on the other seat's turn. */
const liveView = (app: App): View | null => {
  const v = app.shell.view;
  return v?.isMyTurn === true && app.table.curtain === null && !app.table.rolling ? v : null;
};

/**
 * Design §4.7: the roll modal (`#rollOverlay`) is up while it is my turn to roll and the curtain
 * is down, and stays through my own roll's tumble (a forfeited roll's too, R14) so the dice settle
 * in it; nothing else opens or closes it. The other seat's tumble shows on the board alone.
 */
export const rollModalOpen = (app: App): boolean => {
  const v = app.shell.view;
  if (v === null || v.matchOver || app.table.curtain !== null) return false;
  if (v.phase === 'toRoll' && v.isMyTurn) return true;
  const last = v.lastAction;
  return (
    app.table.rolling &&
    last !== null &&
    (last.kind === 'roll' || last.kind === 'noMove') &&
    last.seat === v.me.idx
  );
};

/** `liveView` while I am moving; null when a tap must be dropped (`#board.inert`). */
const movingView = (app: App): View | null => {
  const v = liveView(app);
  return v?.phase === 'moving' ? v : null;
};

const tap: Effect = { type: 'fx', cue: 'tap' };

/** The tapped destination resolved against `sel`: a commit, the tray, or nothing when `to` is no target. */
const tapTarget = (app: App, v: View, sel: Place, to: To, ctx: Context): Step | null => {
  const target = targetsOf(v, sel, app.table.picked).find((t) => t.to === to);
  if (target === undefined) return null;
  return target.opens
    ? step(withTable(app, { pending: { from: sel, to, chains: target.chains } }), tap)
    : commit(app, target.chains[0]?.moves ?? [], ctx);
};

/** Design §4.2 rules 1-5 for a `.point`. */
const pointTap = (app: App, point: PointIndex, ctx: Context): Step => {
  // The click a drag's release fires reaches a point: a drag selects nothing.
  if (app.table.drag !== null) return pure(app);
  const v = movingView(app);
  if (v === null) return pure(app);
  // A tap anywhere on the board closes the tray (design §4.3).
  if (app.table.pending !== null) return pure(withTable(app, { pending: null }));
  const sel = effectiveSelection(app.table.selected, v);
  const committed = sel === null ? null : tapTarget(app, v, sel, point, ctx);
  if (committed !== null) return committed;
  if (point === sel) return step(withTable(app, { selected: null }), tap);
  if (sourcesOf(v).includes(point)) return step(withTable(app, { selected: point }), tap);
  return step(withTable(app, { shake: point }), {
    type: 'startTimer',
    id: 'shake',
    ms: SHAKE_MS,
    then: { type: 'shake/elapsed' },
  });
};

/** Rule 6: my bar with a checker on it is a source (the derived sole source too, so this is often a visual no-op). */
const barTap = (app: App): Step => {
  const v = movingView(app);
  if (v === null || app.table.drag !== null) return pure(app);
  if (app.table.pending !== null) return pure(withTable(app, { pending: null }));
  return sourcesOf(v).includes('bar') ? step(withTable(app, { selected: 'bar' }), tap) : pure(app);
};

/** Rule 7: my tray as a destination; two sufficing dice open the tray of chips. */
const offTap = (app: App, ctx: Context): Step => {
  const v = movingView(app);
  if (v === null || app.table.drag !== null) return pure(app);
  if (app.table.pending !== null) return pure(withTable(app, { pending: null }));
  const sel = effectiveSelection(app.table.selected, v);
  return (sel === null ? null : tapTarget(app, v, sel, 'off', ctx)) ?? pure(app);
};

/** Rule 8: a die in hand and not dead is forced (again: released); targets recompute for it alone. */
const diePick = (app: App, die: Die): Step => {
  const v = movingView(app);
  if (v === null || !v.movesLeft.includes(die) || deadDice(v).includes(die)) return pure(app);
  return step(
    withTable(app, { picked: app.table.picked === die ? null : die, pending: null }),
    tap,
  );
};

/** Design §4.12: a press past the threshold on a source lights its targets; the drop commits the default chain. */
const dragStart = (app: App, from: Place): Step => {
  const v = movingView(app);
  if (v === null || !sourcesOf(v).includes(from)) return pure(app);
  return pure(withTable(app, { drag: { from, over: null }, selected: from, pending: null }));
};

const dragOver = (app: App, over: To | null): Step => {
  const d = app.table.drag;
  const v = movingView(app);
  if (d === null || v === null) return pure(app);
  const lit =
    over !== null && targetsOf(v, d.from, app.table.picked).some((t) => t.to === over)
      ? over
      : null;
  return lit === d.over ? pure(app) : pure(withTable(app, { drag: { ...d, over: lit } }));
};

/** The default chain for a drop: `moveTo` (exact, else the largest die) for the tray, the first chip otherwise. */
const dragEnd = (app: App, ctx: Context): Step => {
  const d = app.table.drag;
  if (d === null) return pure(app);
  const v = movingView(app);
  const dropped = withTable(app, { drag: null, selected: null });
  if (v === null || d.over === null) return pure(dropped);
  if (d.over === 'off') {
    const m = moveTo(v.legal, d.from, 'off', v.me.idx, rulesOf(v.variant));
    return m === null ? pure(dropped) : commit(dropped, [m], ctx);
  }
  const target = targetsOf(v, d.from, app.table.picked).find((t) => t.to === d.over);
  return target === undefined ? pure(dropped) : commit(dropped, target.chains[0]?.moves ?? [], ctx);
};

/** `window.__backgammon.setup(state)`: the pass-and-play game's position, curtain down for the actor. */
const sandboxLoad = (app: App, raw: unknown, ctx: Context): Step => {
  if (app.shell.role !== 'local' || app.shell.game === null)
    return step(app, toast(SANDBOX_LOCAL_ONLY_MSG));
  const decoded = decodeState(raw);
  if (!decoded.ok) return step(app, toast(badPositionMsg(formatError(decoded.error))));
  const game = decoded.value;
  return localBroadcast(
    withTable(withShell(app, { game, revealed: actorOf(game) ?? game.turn }), {
      ...tableCleared(app.table),
    }),
    true,
    ctx.now(),
  );
};

// ---- the reducer -------------------------------------------------------------------------------

/** Two players from the pass-and-play inputs: defaults, and " 2" on a clash (gin's rule). */
const localPlayers = (p1raw: string, p2raw: string): Pair<Player> => {
  const p1 = nameOr(p1raw, 'Player 1');
  const p2 = nameOr(p2raw, 'Player 2');
  return [
    { id: 'p1', name: p1 },
    { id: 'p2', name: p2.toLowerCase() === p1.toLowerCase() ? `${p2} 2` : p2 },
  ];
};

const shellIntent = (app: App, intent: ShellIntent, ctx: Context): Step => {
  const s = app.shell;
  switch (intent.type) {
    case 'home/init':
      return initHome(app, intent.home);
    // A name typed into any of its inputs is remembered trimmed and shown, as typed, in the
    // others; the fill writes only inputs whose value differs, so the one being typed in is left alone.
    case 'name/typed':
      return step(
        withShell(app, { nameTouched: true, p1Name: intent.value }),
        { type: 'rememberName', name: intent.value.trim() },
        { type: 'fillName', name: intent.value },
      );
    case 'p1name/typed':
      return step(
        withShell(app, { p1Name: intent.value }),
        { type: 'rememberName', name: intent.value.trim() },
        { type: 'fillName', name: intent.value },
      );
    case 'p2name/typed':
      return step(
        withShell(app, { p2Name: intent.value }),
        { type: 'rememberP2Name', name: intent.value.trim() },
        { type: 'fillP2Name', name: intent.value },
      );
    case 'tab/set':
      return setHomeTab(app, intent.tab, intent.persist !== false);
    case 'rules/show': {
      // On the home screen the Rules tab is the rules; anywhere else (the table, a waiting room,
      // the end screen) the overlay is, and its own copy of the list is the one to scroll.
      const home = app.shell.screen === 'homeScreen';
      const shown = home
        ? setHomeTab(app, 'rules', true)
        : pure(withShell(app, { rulesOpen: true }));
      return then(shown, (a) =>
        step(a, {
          type: 'revealRule',
          slot: home ? 'rulesList' : 'rulesOverlayList',
          rule: intent.rule,
        }),
      );
    }
    case 'mode/set': {
      const mode: PlayMode = intent.mode === 'local' ? 'local' : 'online';
      return step(withShell(app, { playMode: mode }), { type: 'writePlayMode', mode });
    }
    case 'variant/set':
      return isShippedVariant(intent.variant)
        ? step(withShell(app, { variant: intent.variant }), {
            type: 'writeVariant',
            variant: intent.variant,
          })
        : pure(app);
    case 'matchLength/set': {
      const length = parseMatchLength(intent.length, 0);
      return length === 0
        ? pure(app)
        : step(withShell(app, { matchLength: length }), { type: 'writeMatchLength', length });
    }
    case 'host/click':
      return startHost(
        withShell(app, {
          myName: nameOr(intent.name, DEFAULT_NAME),
          matchLength: parseMatchLength(intent.matchLength, s.matchLength),
          variant: parseVariant(intent.variant, s.variant),
          game: null,
          view: null,
          oppName: null,
          oppConnected: false,
        }),
        null,
        ctx,
      );
    case 'join/click': {
      const code = validateCode('backgammon', intent.code);
      if (!code.ok) return step(app, toast(code.error));
      const typed = intent.name.trim();
      const myName = (
        typed !== '' && (s.nameTouched || typed !== DEFAULT_NAME) ? typed : DEFAULT_GUEST_NAME
      ).slice(0, NAME_MAX);
      return startGuest(withShell(app, { myName }), code.value);
    }
    case 'local/click': {
      const matchLength = parseMatchLength(intent.matchLength, s.matchLength);
      const variant = parseVariant(intent.variant, s.variant);
      const game = createGame(
        localPlayers(intent.p1, intent.p2),
        { matchLength, rotation: [variant] },
        ctx.rng,
        ctx.now,
      );
      return startLocal(withShell(app, { matchLength, variant }), game, ctx.now());
    }
    case 'resume/click':
      return s.resume === null ? pure(app) : resume(app, s.resume, ctx);
    case 'handoff/click':
      // The home screen's offer, or the game in play on the pass-and-play curtain.
      if (s.role === 'local' && s.game !== null) return handoff(app, s.game, ctx);
      return s.resume?.kind === 'local' ? handoff(app, s.resume.game, ctx) : pure(app);
    case 'cancel':
      return step(app, { type: 'closeNet' }, { type: 'then', intent: { type: 'cancel/finish' } });
    case 'cancel/finish':
      return cancelFinish(app);
    case 'screen/show':
      return showScreen(app, intent.screen);
    case 'submenu/press':
      return step(withShell(app, { longPressed: false }), {
        type: 'startTimer',
        id: 'longPress',
        ms: LONG_PRESS_MS,
        then: { type: 'submenu/longPress' },
      });
    case 'submenu/release':
      return step(app, { type: 'cancelTimer', id: 'longPress' });
    case 'submenu/longPress':
      return step(withShell(app, { longPressed: true, submenuOpen: true }), tap);
    case 'tab/playClick':
      // The long press already opened the submenu; the click that follows must not switch tabs.
      return s.longPressed
        ? pure(withShell(app, { longPressed: false }))
        : setHomeTab(withShell(app, { submenuOpen: false }), 'play', true);
    case 'submenu/pick':
      return then(reduce(app, { type: 'mode/set', mode: intent.mode }, ctx), (a) =>
        setHomeTab(withShell(a, { submenuOpen: false }), 'play', true),
      );
    case 'submenu/dismiss':
      return pure(withShell(app, { submenuOpen: false }));
    case 'code/typed': {
      // A keyboard suggestion that swapped earlier letters arrives as a replacement: keep the last good code.
      const value =
        intent.inputType === 'insertReplacementText'
          ? s.codeDraft
          : sanitiseCode('backgammon', intent.value);
      return step(withShell(app, { codeDraft: value }), { type: 'setCode', value });
    }
    case 'join/link': {
      // The invite link: the code is in the form; the mode is shown, not stored.
      const code = sanitiseCode('backgammon', intent.code);
      return then(
        setHomeTab(withShell(app, { playMode: 'online', codeDraft: code }), 'play', false),
        (a) => step(a, { type: 'setCode', value: code }),
      );
    }
    case 'sound/toggle':
      return step(app, { type: 'toggleSound' });
    case 'soundFont/set':
      return step(withShell(app, { soundFont: intent.font }), {
        type: 'writeSoundFont',
        font: intent.font,
      });
    case 'share/click':
      return s.code === null ? pure(app) : step(app, { type: 'share', code: s.code });
    // ---- net: host ----
    case 'host/start':
      return startHost(app, intent.code, ctx);
    case 'host/status':
      return pure(withHostStatus(app, intent.text, intent.stopPulse));
    case 'host/frame':
      return hostFrame(app, intent.frame, ctx);
    case 'host/guestGone': {
      const gone = withShell(app, { oppConnected: false });
      return intent.iceFailed === null
        ? guestGone(gone, ctx.now())
        : pure(withHostStatus(gone, intent.iceFailed));
    }
    case 'host/deal': {
      if (!s.oppConnected) return step(app, toast(WAITING_FOR_GUEST_MSG));
      const game = createGame(
        [
          { id: 'host', name: s.myName },
          // A connected opponent has a name; the fallback only satisfies the type.
          { id: 'guest', name: s.oppName ?? DEFAULT_GUEST_NAME },
        ],
        { matchLength: s.matchLength, rotation: [s.variant] },
        ctx.rng,
        ctx.now,
      );
      return broadcast(withShell(app, { game }), ctx.now());
    }
    // ---- net: guest ----
    case 'guest/start':
      return startGuest(app, intent.code);
    case 'guest/status':
      return pure(withGuestStatus(app, intent.text, intent.stopPulse));
    case 'guest/connected':
      return pure(withShell(app, { oppConnected: true }));
    case 'guest/frame':
      return guestFrame(app, intent.frame, ctx.now());
    case 'guest/lost': {
      const lost = { shell: { ...s, oppConnected: false }, table: tableCleared(app.table) };
      const v = lost.shell.view;
      if (v === null) return showScreen(withGuestStatus(lost, DISCONNECTED_MSG), 'guestWaitScreen');
      // Over: the result stays up; the session's rejoin finds a destroyed Peer and the save would
      // only offer a dead room. Mid-match the session reconnects by itself.
      if (v.matchOver)
        return then(rendered(lost, v, ctx.now()), (a) =>
          step(
            a,
            { type: 'closeNet' },
            { type: 'clearSave' },
            toast(hostLeftMsg(v.opp.name), GONE_TOAST_MS),
          ),
        );
      return then(rendered(lost, v, ctx.now()), (a) =>
        step(a, toast(LOST_HOST_MSG, GONE_TOAST_MS)),
      );
    }
  }
};

const tableIntent = (app: App, intent: TableIntent, ctx: Context): Step => {
  const v = liveView(app);
  const t = app.table;
  switch (intent.type) {
    case 'act':
      return act(app, [intent.action], ctx);
    case 'point/tap':
      return pointTap(app, intent.point, ctx);
    case 'bar/tap':
      return barTap(app);
    case 'off/tap':
      return offTap(app, ctx);
    case 'die/pick':
      return diePick(app, intent.die);
    case 'chip/tap': {
      const chain = t.pending?.chains[intent.index];
      return chain === undefined ? pure(app) : commit(app, chain.moves, ctx);
    }
    case 'chip/cancel':
      return pure(withTable(app, { pending: null }));
    case 'board/tap':
      return t.pending === null && t.selected === null
        ? pure(app)
        : pure(withTable(app, { pending: null, selected: null }));
    case 'roll/click':
      // `#rollModalBtn` (design §4.7): the engine rolls at once; the tumble starts now, so the
      // guest's modal holds its button until the host's frame brings the faces (the timer then
      // restarts with them, in `rendered`).
      return v?.phase === 'toRoll'
        ? then(step(withTable(app, { rolling: true }), TUMBLE_TIMER), (a) =>
            act(a, [{ type: 'roll' }], ctx),
          )
        : pure(app);
    case 'undo/click':
      return v?.canUndo === true ? act(app, [{ type: 'undo' }], ctx) : pure(app);
    case 'done/click':
      // Reserved (design §1 "Turn end"): the turn ends by itself; `#doneBtn` is hidden in every state.
      return pure(app);
    case 'double/click':
      return v?.canDouble === true ? act(app, [{ type: 'double' }], ctx) : pure(app);
    case 'take/click':
      return v?.phase === 'cubeOffered' ? act(app, [{ type: 'take' }], ctx) : pure(app);
    case 'pass/click':
      return v?.phase === 'cubeOffered' ? act(app, [{ type: 'pass' }], ctx) : pure(app);
    case 'next/click': {
      // Either seat may start the next game (the engine takes `next` from both), so not `liveView`.
      const over = app.shell.view;
      if (over?.phase !== 'over') return pure(app);
      if (!over.matchOver) return act(app, [{ type: 'next' }], ctx);
      const game = app.shell.game;
      return game === null ? pure(app) : rematch(app, game, ctx);
    }
    case 'result/peek':
      return pure(withTable(app, { resultOpen: false }));
    case 'result/open':
      return pure(withTable(app, { resultOpen: true }));
    case 'checker/dragStart':
      return dragStart(app, intent.from);
    case 'checker/dragOver':
      return dragOver(app, intent.over);
    case 'checker/dragEnd':
      return dragEnd(app, ctx);
    case 'menu/toggle':
      return pure(withTable(app, { menuOpen: !t.menuOpen }));
    case 'history/toggle':
      return pure(withTable(app, { historyOpen: !t.historyOpen }));
    case 'rules/toggle':
      return pure(withShell(app, { rulesOpen: !app.shell.rulesOpen }));
    case 'curtain/mode': {
      // Turning the curtain off while it is up is a reveal: the seat behind it is told of its hits.
      const dropped = intent.mode === 'never' ? t.curtain : null;
      return step(
        withTable(app, {
          curtainMode: intent.mode,
          curtain: intent.mode === 'never' ? null : t.curtain,
        }),
        { type: 'writeCurtainMode', mode: intent.mode },
        ...(dropped !== null && app.shell.game !== null ? handedHits(app.shell.game, dropped) : []),
      );
    }
    case 'curtain/reveal': {
      const game = app.shell.game;
      if (game === null) return pure(app);
      const seat = actorOf(game) ?? game.turn;
      return then(
        step(
          withTable(withShell(app, { revealed: seat }), { curtain: null }),
          tap,
          ...handedHits(game, seat),
        ),
        (a) => localBroadcast(a, true, ctx.now()),
      );
    }
    case 'noMove/elapsed': {
      const seen = withTable(app, { noMoveUntil: null });
      // Pass-and-play: the curtain now rises for the new mover; online the paint just re-reads.
      return app.shell.role === 'local' ? localBroadcast(seen, false, ctx.now()) : pure(seen);
    }
    case 'shake/elapsed':
      return pure(withTable(app, { shake: null }));
    case 'tumble/elapsed':
      return t.rolling ? pure(withTable(app, { rolling: false })) : pure(app);
    case 'sandbox/load':
      return sandboxLoad(app, intent.state, ctx);
    case 'leave/request':
      return step(app, {
        type: 'confirm',
        message: app.shell.role === 'local' ? LEAVE_LOCAL_MSG : LEAVE_ONLINE_MSG,
        then: { type: 'leave/confirmed' },
      });
    case 'leave/confirmed':
      // The network closes before the reset, so the session's own close still toasts; then `leave/finish` resets.
      return step(
        app,
        { type: 'wakeLock', hold: false },
        { type: 'closeNet' },
        { type: 'then', intent: { type: 'leave/finish' } },
      );
    case 'leave/finish':
      return leaveFinish(app);
    case 'visible':
      return app.shell.role === null ? pure(app) : step(app, { type: 'wakeLock', hold: true });
    case 'render':
      return rendered(app, app.shell.view, ctx.now());
    case 'persist':
      return step(app, { type: 'persist' });
  }
};

export const reduce = (app: App, intent: Intent, ctx: Context): Step =>
  isShellIntent(intent) ? shellIntent(app, intent, ctx) : tableIntent(app, intent, ctx);

// ---- storage: persist and resume -------------------------------------------------------------

/** `persist()`: the save for the current role, or null when there is nothing to save. */
export const saveFor = (app: App): Save | null => {
  const s = app.shell;
  switch (s.role) {
    case 'local':
      return s.game === null ? null : { role: 'local', game: s.game };
    case 'host':
      return {
        role: 'host',
        code: s.code ?? '',
        myName: s.myName,
        matchLength: s.matchLength,
        variant: s.variant,
        game: s.game,
        oppName: s.oppName,
        ...(s.handoff ? { handoff: true } : {}),
      };
    case 'guest':
      return { role: 'guest', code: s.code ?? '', myName: s.myName };
    case null:
      return null;
  }
};

/** `initHome`'s reads: the names, the tab, mode and options (defaults when unreadable), the save. */
export const readHome = (store: Store): HomeSnapshot => {
  const name = readName(store);
  const p2Name = readP2Name(store);
  const tab = readHomeTab(store);
  const mode = readPlayMode(store);
  const variant = readVariant(store);
  const length = readMatchLength(store);
  const curtain = readCurtainMode(store);
  const font = readSoundFont(store);
  const save = readSave(store);
  return {
    name: name.ok ? name.value : null,
    p2Name: p2Name.ok ? p2Name.value : null,
    homeTab: tab.ok ? tab.value : DEFAULT_HOME_TAB,
    playMode: mode.ok ? mode.value : DEFAULT_PLAY_MODE,
    variant: variant.ok ? variant.value : DEFAULT_VARIANT,
    matchLength: length.ok ? length.value : DEFAULT_MATCH_LENGTH,
    curtainMode: curtain.ok ? curtain.value : DEFAULT_CURTAIN_MODE,
    soundFont: font.ok ? font.value : DEFAULT_SOUND_FONT,
    save: save.ok ? save.value : null,
  };
};

// ---- what the sessions read back ---------------------------------------------------------------

export const hostContextOf = (app: App): HostContext => ({
  attempt: app.shell.netAttempt,
  role: app.shell.role,
  code: app.shell.code,
  myName: app.shell.myName,
  matchLength: app.shell.matchLength,
  variant: app.shell.variant,
  hasGame: app.shell.game !== null,
  handoff: app.shell.handoff,
  oppName: app.shell.oppName,
  oppConnected: app.shell.oppConnected,
});

export const guestContextOf = (app: App): GuestContext => ({
  attempt: app.shell.netAttempt,
  role: app.shell.role,
  code: app.shell.code,
  myName: app.shell.myName,
  oppConnected: app.shell.oppConnected,
});

// ---- running the effects -----------------------------------------------------------------------

/** The adapters an effect reaches; main.ts constructs the real ones, tests record. */
export type EffectDeps = Readonly<{
  store: Store;
  toast: (message: string, ms: number | null) => void;
  /** A cue in the App's font: the reducer's state is the source of truth for both. */
  fx: (cue: Cue | 'tap', font: SoundFontName) => void;
  wakeLock: (hold: boolean) => void;
  net: Readonly<{
    startHost: (code: string, attempt: number, resume: boolean) => void;
    startGuest: (code: string, attempt: number) => void;
    send: (frame: HostFrame | GuestFrame) => void;
    close: () => void;
  }>;
  confirm: (message: string) => boolean;
  scrollTop: () => void;
  timers: Readonly<{
    start: (id: TimerId, ms: number, then: Intent) => void;
    cancel: (id: TimerId) => void;
  }>;
  toggleSound: () => void;
  /** The invite for the room `code`: its link, through the share sheet or the clipboard. */
  share: (code: string) => void;
  /** `revealRule(document, slot, rule)` (web/shared/edge/glossary.ts): scroll to the rule and flash it. */
  revealRule: (slot: RulesSlot, rule: string) => void;
  /** The three input writes the paint does not own (they would fight the player's typing). */
  page: Readonly<{
    fillName: (name: string) => void;
    fillP2Name: (name: string) => void;
    setCode: (value: string) => void;
  }>;
  dispatch: (intent: Intent) => void;
}>;

/** One effect against the adapters; `app` is the state after the step that produced it. */
export const runEffect = (app: App, effect: Effect, deps: EffectDeps): void => {
  switch (effect.type) {
    case 'persist': {
      const save = saveFor(app);
      if (save !== null) writeSave(deps.store, save);
      return;
    }
    case 'clearSave':
      clearSave(deps.store);
      return;
    case 'saveLocal':
      writeSave(deps.store, { role: 'local', game: effect.game });
      return;
    case 'rememberName':
      writeName(deps.store, effect.name);
      return;
    case 'rememberP2Name':
      writeP2Name(deps.store, effect.name);
      return;
    case 'writeHomeTab':
      writeHomeTab(deps.store, effect.tab);
      return;
    case 'writePlayMode':
      writePlayMode(deps.store, effect.mode);
      return;
    case 'writeVariant':
      writeVariant(deps.store, effect.variant);
      return;
    case 'writeMatchLength':
      writeMatchLength(deps.store, effect.length);
      return;
    case 'writeCurtainMode':
      writeCurtainMode(deps.store, effect.mode);
      return;
    case 'writeSoundFont':
      writeSoundFont(deps.store, effect.font);
      return;
    case 'toast':
      deps.toast(effect.message, effect.ms);
      return;
    case 'send':
      deps.net.send(effect.frame);
      return;
    case 'fx':
      deps.fx(effect.cue, app.shell.soundFont);
      return;
    case 'wakeLock':
      deps.wakeLock(effect.hold);
      return;
    case 'startHost':
      deps.net.startHost(effect.code, effect.attempt, effect.resume);
      return;
    case 'startGuest':
      deps.net.startGuest(effect.code, effect.attempt);
      return;
    case 'closeNet':
      deps.net.close();
      return;
    case 'confirm':
      if (deps.confirm(effect.message)) deps.dispatch(effect.then);
      return;
    case 'then':
      deps.dispatch(effect.intent);
      return;
    case 'initHome':
      deps.dispatch({ type: 'home/init', home: readHome(deps.store) });
      return;
    case 'scrollTop':
      deps.scrollTop();
      return;
    case 'startTimer':
      deps.timers.start(effect.id, effect.ms, effect.then);
      return;
    case 'cancelTimer':
      deps.timers.cancel(effect.id);
      return;
    case 'toggleSound':
      deps.toggleSound();
      return;
    case 'share':
      deps.share(effect.code);
      return;
    case 'revealRule':
      deps.revealRule(effect.slot, effect.rule);
      return;
    case 'fillName':
      deps.page.fillName(effect.name);
      return;
    case 'fillP2Name':
      deps.page.fillP2Name(effect.name);
      return;
    case 'setCode':
      deps.page.setCode(effect.value);
      return;
  }
};
