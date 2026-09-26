// The shell reducer both games ran as two copies (docs/design/shared-shell.md §4.2, moved here in
// §5 C2): the home screen, the waiting rooms, the session (who plays, from which device), the
// resume offer, the Play tab's submenu and the leave flow, over intents, returning the next App
// with a list of effects as data. Gin's cases as they stood after C1 (`App = { shell, table }`),
// with everything the two copies disagreed on injected through a `ShellConfig` (§4.3): the game's
// id, names, tabs, copy, option codec, engine, frame builders, storage and the table hooks
// (`reset`, `rendered`, `refuse`, the pass-and-play `viewer`/`revealer`). The record is generic
// over one bag of the game's types (`ShellTypes`) rather than a dozen parameters, so a signature
// reads `ShellState<G>`; every literal this file writes into a generic field (`'play'`,
// `'online'`, `'homeScreen'`, `'longPress'`, `'tap'`) belongs to the shared half of that field's
// union, and the game's own half (`G['Tab']`, `G['Mode']`, …) is added by the config. Nothing
// here names a game (eslint.config.js: shared code never imports one), touches the store (the
// `Store` type is the game's, through `G['Store']`, because this zone reaches only web/shared/lib
// and the DOM edge) or spells a session's status copy (`cfg.copy.opening`, `connecting`,
// `handoff` come from web/shared/net through the game's config for the same reason). The effect
// runner is web/shared/ui/shellEffects.ts, beside this file, because it calls the adapters
// (statements the pure profile refuses). A game's `ui/state.ts` keeps its table slice and hooks,
// spells `reduce = isShellIntent ? reduceShell : tableIntent`, and re-exports what its tests
// import, so both games' state.test.ts run unchanged but for the `opts` rename C1 agreed.
//
// Two legacy traits kept on purpose (the gin reducer's header): the shell runs `rendered`'s state
// effects wherever the legacy called `render()`, and a leave closes the network before the state
// is reset, so the session's own close still raises the "disconnected" toast the legacy raised.
import {
  DEFAULT_GUEST_NAME,
  EPHEMERAL_TAG,
  NAME_MAX,
  guestNameFor,
  type EphemeralFrame,
  type GuestFrame,
  type HostFrame,
} from '../lib/protocol.ts';
import {
  arrayOf,
  boolean,
  formatError,
  integer,
  nullable,
  object,
  string,
  type Decoder,
} from '../lib/json.ts';
import { appendCapped, outcomeFor, type RecentGame } from '../lib/recentGames.ts';
import type { Result } from '../lib/result.ts';
import type { Rng } from '../lib/rng.ts';
import { randomCode, sanitiseCode, validateCode, type Game } from '../lib/roomCode.ts';
import { DEFAULT_SOUND_FONT, type SoundFontName } from '../lib/sound/fonts.ts';
import type { Phrase } from '../lib/sound/phrase.ts';
import type { RulesSlot } from './glossary.ts';

// ---- the game's types, in one bag --------------------------------------------------------------

/** The two seats every shell flow names: the host and its guest, pass-and-play's two players. A game with more adds them through its bag (`ShellTypes.Seat`) and the flows type on `SeatOf<G>`. */
export type Seat = 0 | 1;
export type Role = 'host' | 'guest' | 'local';
/** The stored modes (web/shared/edge/prefs.ts `PLAY_MODES`); a game may show more (`G['Mode']`). */
export type PlayMode = 'online' | 'local';
/** A seat as the engines take it: gin's `PlayerInfo`, backgammon's `Player`. */
export type Player = Readonly<{ id: string; name: string }>;

/**
 * What a game plugs into the shell's types. Each member is the game's whole union where the shell
 * adds its own literals (`Tab`, `Mode`, `Screen`, `Timer`, `Cue`: the shared literals are unioned
 * in by `Tab<G>` and friends, so a game lists its full set and nothing is spelled twice), or the
 * game's own slice where the shell has none (`Table`, `Cues`, `Home`, `Intent`, `Effect`).
 */
export type ShellTypes = Readonly<{
  /** A room's terms: gin `{ target }`, backgammon `{ matchLength, variant }`. The host save's, the welcome frame's and the resume offer's own fields, in the literal's order. */
  Opts: object;
  /** The raw option values `host/click` and `local/click` carry off the inputs, parsed by `cfg.opts.parse`. */
  Raw: object;
  State: unknown;
  View: unknown;
  Action: unknown;
  /**
   * The seats beyond the shell's two, for a game whose table seats three or four (`2 | 3`); a
   * two-seat game leaves it out, and every flow types on `0 | 1` as before (`SeatOf<G>`).
   */
  Seat?: number;
  /** The table slice; the shell reads and writes only its pass-and-play `curtain` (agreed in C1), a seat of the game's (`SeatOf<G>`). */
  Table: Readonly<{ curtain: number | null }>;
  Tab: string;
  Mode: string;
  Screen: string;
  Timer: string;
  Cue: string;
  /** The cue machine's memory (`CueMemory`, or a record extending it: gin adds `turnKey`), shell state because it keys on the view. */
  Cues: unknown;
  /** Resume offers beyond the three save roles: gin's Score Counter session; `never` elsewhere. */
  Resume: Readonly<{ kind: string }>;
  /** What `initHome` reads beyond the shell's own keys: gin's sort, card back and scorer; backgammon's options and curtain mode. */
  Home: object;
  /** The game's own intents and effects, the table half of its unions. */
  Intent: Readonly<{ type: string }>;
  Effect: Readonly<{ type: string }>;
  Store: unknown;
  /**
   * The game's ephemeral frame (web/shared/lib/protocol.ts `EPHEMERAL_TAG`): what either side
   * sends over the lane and `cfg.table.ephemeral` receives (briscola's live intent mirror,
   * docs/design/briscola-battle.md §4.5); a game with none leaves it out and its frame unions are
   * the seven frames as before.
   */
  Ephemeral?: EphemeralFrame;
}>;

/** The game's seats beyond the shell's own two: what its bag's `Seat` names, `never` when it names none. */
type ExtraSeats<G extends ShellTypes> =
  G extends Readonly<{ Seat: infer S extends number }> ? S : never;
/** A seat at the game's table: the shell's two and the game's own; `0 | 1` for the two-seat games. */
export type SeatOf<G extends ShellTypes> = Seat | ExtraSeats<G>;
/**
 * What `engine.create` deals to (n-seat-sessions.md §7 `engine.create(players[])`): the pair for a
 * two-seat game, whose bag names no seat past `0 | 1` (so gin's and backgammon's engines keep their
 * tuple, type for type), and every seat in order for a game with more (`ShellTypes.Seat`).
 */
export type PlayersOf<G extends ShellTypes> = [ExtraSeats<G>] extends [never]
  ? Readonly<[Player, Player]>
  : ReadonlyArray<Player>;
export type Tab<G extends ShellTypes> = 'play' | 'rules' | G['Tab'];
export type Mode<G extends ShellTypes> = PlayMode | G['Mode'];
/** The five screens every shell page carries, and the game's own. */
export type ScreenId<G extends ShellTypes> =
  | 'homeScreen'
  | 'hostWaitScreen'
  | 'guestWaitScreen'
  | 'tableScreen'
  | 'endgameScreen'
  | G['Screen'];
export type TimerId<G extends ShellTypes> = 'longPress' | G['Timer'];
export type Cue<G extends ShellTypes> = 'tap' | 'yourTurn' | G['Cue'];
/** The game's ephemeral frame, `never` when its bag names none. */
export type EphemeralOf<G extends ShellTypes> =
  G extends Readonly<{ Ephemeral: infer E extends EphemeralFrame }> ? E : never;
/** What arrives from, and goes to, a host: its five frames and the ephemeral one (either side sends that). */
export type HostFrameOf<G extends ShellTypes> = HostFrame<G['View'], G['Opts']> | EphemeralOf<G>;
/** What arrives from, and goes to, a guest: its two frames and the ephemeral one. */
export type GuestFrameOf<G extends ShellTypes> = GuestFrame<G['Action']> | EphemeralOf<G>;

/** `#hostWaitStatus` / `#guestWaitStatus`: the text and whether it still pulses. */
export type WaitStatus = Readonly<{ text: string; pulse: boolean }>;

/**
 * A guest seat of an open room (docs/design/n-seat-sessions.md §7): who holds it (null while it
 * is empty; kept while its channel is down mid-game, for the rejoin) and whether its channel is
 * open. Seat `s` of the room is `seats[s - 1]`; the host is seat 0 and has none.
 */
export type SeatState = Readonly<{ name: string | null; connected: boolean }>;
export const EMPTY_SEAT: SeatState = { name: null, connected: false };

// ---- the save, the resume offer and the home snapshot -------------------------------------------

/** `persist()` writes one of three shapes by role, the shapes web/shared/edge/prefs.ts `shellSave` reads and writes; the host's own fields sit between `myName` and `game`. */
export type LocalSave<G extends ShellTypes> = Readonly<{ role: 'local'; game: G['State'] }>;
export type HostSave<G extends ShellTypes> = Readonly<{
  role: 'host';
  code: string;
  myName: string;
}> &
  G['Opts'] &
  Readonly<{
    game: G['State'] | null;
    oppName: string | null;
    /** Every guest seat's name in seat order (`seats`), written only for a room of more than two seats, so a two-seat save keeps the legacy literal; a resume reseats each by name (n-seat-sessions.md D6). */
    seatNames?: ReadonlyArray<string | null>;
    /** Written only when true (the shell's `handoff`), so every other host save keeps the legacy literal. */
    handoff?: true;
    /** When the room was (re)opened, written only while it waits for its first guest (`game` null; docs/design/lobby-resume.md D1). */
    at?: number;
  }>;
export type GuestSave = Readonly<{ role: 'guest'; code: string; myName: string }>;
export type Save<G extends ShellTypes> = LocalSave<G> | HostSave<G> | GuestSave;

/** What the home screen's resume box offers (`initHome`), one per save role, plus the game's own (`G['Resume']`). */
export type HostResume<G extends ShellTypes> = Readonly<{
  kind: 'host';
  code: string;
  myName: string;
}> &
  G['Opts'] &
  Readonly<{
    /** The game in play, or null for a room still waiting for its first guest (lobby-resume.md D3). */
    game: G['State'] | null;
    oppName: string | null;
    /** The save's seat names, when it carries them (a room of more than two seats): the room resumes with each seat named and disconnected. */
    seatNames?: ReadonlyArray<string | null>;
    /** The save's `handoff` mark: the offer reads as the handoff, and the room resumes as one. */
    handoff: boolean;
    /** The save's `at`: when a waiting room was (re)opened, or null (a game in play, or a save from before the stamp). */
    at: number | null;
  }>;
export type ShellResume<G extends ShellTypes> =
  | Readonly<{ kind: 'local'; game: G['State'] }>
  | HostResume<G>
  | Readonly<{ kind: 'guest'; code: string; myName: string }>;
export type Resume<G extends ShellTypes> = ShellResume<G> | G['Resume'];

/** What the legacy `initHome` read from storage, in one snapshot (`readHome`): the shell's keys and the game's (`G['Home']`). */
export type HomeSnapshot<G extends ShellTypes> = Readonly<{
  name: string | null;
  /** The pass-and-play second name: each page's own key, so a legacy session has none. */
  p2Name: string | null;
  homeTab: Tab<G>;
  playMode: PlayMode;
  /** A bad value read as the default (main.ts logs it). */
  soundFont: SoundFontName;
  save: Save<G> | null;
  /** The finished games this device remembers, newest first (web/shared/lib/recentGames.ts). */
  recentGames: ReadonlyArray<RecentGame>;
}> &
  G['Home'];

// ---- the state ---------------------------------------------------------------------------------

/**
 * Everything but the table's own state: the legacy `app` object field for field (role, code,
 * names, the engine `State` for the host and pass-and-play, my `View` for every role), then what
 * the legacy kept in the DOM or in closures (the screen shown, the two waiting statuses, the
 * netAttempt ticket, the cue machine's memory, the sheets and the Play tab's submenu).
 */
export type ShellState<G extends ShellTypes> = Readonly<{
  role: Role | null;
  code: string | null;
  myName: string;
  /** The room's terms, where gin had `target` and backgammon `matchLength`/`variant` (agreed in C1). */
  opts: G['Opts'];
  /** The engine state: host and pass-and-play only. */
  game: G['State'] | null;
  /** My view: every role (the guest's arrives in `state` frames). */
  view: G['View'] | null;
  oppName: string | null;
  oppConnected: boolean;
  /**
   * The room's guest seats 1..N−1 in order (`seats[s − 1]`, n-seat-sessions.md §7): one per
   * channel the host session holds, `capacity − 1` of them from `startHost` on (one for a two-seat
   * game), what a guest's welcome or lobby frame carries beside the options in an N-seat game
   * (`seats` and `you`, D3, read by `roomSeatingOf`), and [] at home and in pass-and-play. As
   * host, `oppName`/`oppConnected` are
   * `seats[0]`'s: every shell write sets both (`withSeats`), and a two-seat game's flows keep
   * reading the two legacy fields (`seatsOf`), so its reducer, painters and pins are what they
   * were; as guest the two name the host.
   */
  seats: ReadonlyArray<SeatState>;
  /** My seat: 0 as host and in pass-and-play; as guest the `you` of the last welcome or lobby frame, 1 when the frame carries none. */
  mySeat: SeatOf<G>;
  /** Pass-and-play: every player's name in seat order (`cfg.result.playersOf` of seat 0's view); [] otherwise. */
  localNames: ReadonlyArray<string>;
  /** Pass-and-play: the seats played from this device, every seat in v1 (the seam for a mixed table); [] otherwise. */
  localSeats: ReadonlyArray<SeatOf<G>>;
  nameTouched: boolean;
  /** Pass-and-play: the seat that lifted the curtain this turn. */
  revealed: SeatOf<G> | null;
  homeTab: Tab<G>;
  playMode: Mode<G>;
  /** The first player's name as last read from the name key or typed into any of its inputs. */
  p1Name: string;
  /** The second player's name as last read from its key or typed. */
  p2Name: string;
  screen: ScreenId<G>;
  /** The `netAttempt` ticket: bumped by every start, cancel and leave. */
  netAttempt: number;
  hostStatus: WaitStatus;
  guestStatus: WaitStatus;
  /** `#startGameBtn` shown (a guest is in the lobby). */
  startGameVisible: boolean;
  /**
   * The hosted game came from pass-and-play (`#handoffBtn`) and its remote seat has not joined
   * yet: the wait screen tells the player to send the invite, a guest that drops before its join
   * leaves the wait screen as it is, and cancelling the room gives the game back to pass-and-play.
   * Saved with the host save (`HostSave.handoff`), so a reload resumes the offer. Cleared by the
   * guest's join and by every leave and cancel.
   */
  handoff: boolean;
  /** The saved name, as `initHome` put it in the inputs. */
  savedName: string | null;
  resume: Resume<G> | null;
  /**
   * When this device opened or reopened its room (`startHost`, the clock), null otherwise: the
   * waiting-room save's `at` (lobby-resume.md D2), which decides whether a reload resumes the
   * lobby by itself (`resume/auto`) or offers it.
   */
  openedAt: number | null;
  /** `#rulesOverlay` open (the in-game rules sheet; the home tab is `homeTab`). */
  rulesOpen: boolean;
  cues: G['Cues'];
  /** `#playSubmenu` held open by a long press on the Play tab (`force-open`). */
  submenuOpen: boolean;
  /** A long press just opened the submenu, so the click that follows must not switch tabs. */
  longPressed: boolean;
  /** `#codeInput` as last sanitised (the legacy `lastGoodCode`). */
  codeDraft: string;
  /** The font every cue plays in (docs/design/sound-fonts.md §6). */
  soundFont: SoundFontName;
  /**
   * The finished games this device remembers, newest first, at most RECENT_GAMES_CAP: read at
   * `home/init`, the record of a game that just ended put first as its `recordGame` effect
   * appends the same record to storage (web/shared/lib/recentGames.ts).
   */
  recentGames: ReadonlyArray<RecentGame>;
  /**
   * The key (`cfg.result.keyOf` of its view) of the game whose result was recorded, so a re-sent
   * frame or a repaint of the same finished game records nothing; null until a game ends, and
   * again after a leave.
   */
  recorded: string | null;
}>;

export type ShellApp<G extends ShellTypes> = Readonly<{ shell: ShellState<G>; table: G['Table'] }>;

// ---- intents -----------------------------------------------------------------------------------

/** The shell's intents: every home, waiting-room, session and leave handler and every network event. */
export type ShellIntent<G extends ShellTypes> =
  // ---- home ----
  | Readonly<{ type: 'home/init'; home: HomeSnapshot<G> }>
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
  /** `setPlayMode(mode)`: decoded by `cfg.modes.parse` (`local`, else `online`; gin's `sandbox` while unlocked). */
  | Readonly<{ type: 'mode/set'; mode: string }>
  /** `#hostBtn`: the raw name and the raw option values (`G['Raw']`), parsed by `cfg.opts.parse`. */
  | (Readonly<{ type: 'host/click'; name: string }> & G['Raw'])
  /** `#joinBtn`: the raw input values. */
  | Readonly<{ type: 'join/click'; name: string; code: string }>
  /** `#localBtn`: the raw names and the raw option values. */
  | (Readonly<{ type: 'local/click'; p1: string; p2: string }> & G['Raw'])
  /** `#resumeBtn`: whatever `shell.resume` offers. */
  | Readonly<{ type: 'resume/click' }>
  /**
   * The boot, after the invite link (the owner, 2026-09-25: "When the host of a lobby refreshes,
   * it shouldn't drop the lobby"): a waiting room this device opened within WAITING_RESUME_MS
   * resumes by itself; every other offer waits for its tap. Nothing while seated.
   */
  | Readonly<{ type: 'resume/auto' }>
  /** `#handoffBtn` (pass-and-play alone): the game goes on as a hosted room. */
  | Readonly<{ type: 'handoff/click' }>
  /** `#cancelHostBtn` / `#cancelGuestBtn`. */
  | Readonly<{ type: 'cancel' }>
  | Readonly<{ type: 'cancel/finish' }>
  /** The hook's `showScreen(id)`. */
  | Readonly<{ type: 'screen/show'; screen: ScreenId<G> }>
  /** `#tabPlayBtn` pointerdown: the long-press timer starts. */
  | Readonly<{ type: 'submenu/press' }>
  /** `#tabPlayBtn` pointerup/leave/cancel: the timer is cancelled. */
  | Readonly<{ type: 'submenu/release' }>
  /** The long-press timer fired. */
  | Readonly<{ type: 'submenu/longPress' }>
  /** `#tabPlayBtn` click: the Play tab, unless a long press just opened the submenu. */
  | Readonly<{ type: 'tab/playClick' }>
  /** A `#playSubmenu` button. */
  | Readonly<{ type: 'submenu/pick'; mode: string }>
  /** A click outside `#tabPlayWrap`. */
  | Readonly<{ type: 'submenu/dismiss' }>
  /** `#codeInput` input: the raw value and the InputEvent's type. */
  | Readonly<{ type: 'code/typed'; value: string; inputType: string }>
  /**
   * `?join=<code>` at boot (an invite link): the code into `#codeInput`, the Play tab, online
   * mode, then the join `#joinBtn` would have dispatched, under the name the input shows (the
   * owner, 2026-09-25: "it shouldn't make you THEN click 'sit down'"). Nothing while seated.
   */
  | Readonly<{ type: 'join/link'; code: string }>
  /** `#soundBtn`. */
  | Readonly<{ type: 'sound/toggle' }>
  /** The hook's `soundFont(name)` (the console, for now): a valid font plays from now on and is remembered. */
  | Readonly<{ type: 'soundFont/set'; font: SoundFontName }>
  /** `#shareCodeBtn`. */
  | Readonly<{ type: 'share/click' }>
  // ---- net: host ----
  /** `startHost(resumeCode)`: null draws a fresh code. */
  | Readonly<{ type: 'host/start'; code: string | null }>
  | Readonly<{ type: 'host/status'; text: string; stopPulse: boolean }>
  /** A guest frame; `seat` is the channel it came in on, from the seated adapter (boot.ts `sessionEvents(deps, { seats: true })`), absent (seat 1) for a two-seat game. */
  | Readonly<{ type: 'host/frame'; frame: GuestFrameOf<G>; seat?: SeatOf<G> }>
  | Readonly<{ type: 'host/guestGone'; iceFailed: string | null; seat?: SeatOf<G> }>
  /** `#startGameBtn`. */
  | Readonly<{ type: 'host/deal' }>
  // ---- net: guest ----
  | Readonly<{ type: 'guest/start'; code: string }>
  | Readonly<{ type: 'guest/status'; text: string; stopPulse: boolean }>
  | Readonly<{ type: 'guest/connected' }>
  | Readonly<{ type: 'guest/frame'; frame: HostFrameOf<G> }>
  | Readonly<{ type: 'guest/lost' }>
  // ---- the table's shell half: the curtain, the leave flow, the paint (C1 left them on the table side; C2 moves them here through the hooks) ----
  /** `#curtainBtn`. */
  | Readonly<{ type: 'curtain/reveal' }>
  /**
   * The game's setup hook (e2e and stories; docs/design/dry-round-2.md F5): the pass-and-play
   * game's engine state is replaced by `state`, decoded by `cfg.engine.decodeState` so a hand-made
   * object is checked; refused with a toast outside a local game.
   */
  | Readonly<{ type: 'position/load'; state: unknown }>
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
 * The shell's half of a game's `Intent` union: 45 types, backgammon's 38 less its two option
 * selects (`variant/set`, `matchLength/set`, its own) plus the seven both games kept on the table
 * side after C1 (the curtain reveal, the leave flow, `visible`, `render`, `persist`), plus
 * `position/load`, backgammon's `sandbox/load` generalised (dry-round-2.md F5), plus
 * `resume/auto`, the boot's lobby resume (lobby-resume.md D4).
 */
export const SHELL_INTENT_TYPES = [
  'home/init',
  'name/typed',
  'p1name/typed',
  'p2name/typed',
  'tab/set',
  'rules/show',
  'mode/set',
  'host/click',
  'join/click',
  'local/click',
  'resume/click',
  'resume/auto',
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
  'curtain/reveal',
  'position/load',
  'leave/request',
  'leave/confirmed',
  'leave/finish',
  'visible',
  'render',
  'persist',
] as const satisfies ReadonlyArray<ShellIntent<ShellTypes>['type']>;

/** A game's whole intent union: the shell's and its own. */
export type Intent<G extends ShellTypes> = ShellIntent<G> | G['Intent'];

const SHELL_INTENTS: ReadonlySet<string> = new Set(SHELL_INTENT_TYPES);
export const isShellIntent = <G extends ShellTypes>(intent: Intent<G>): intent is ShellIntent<G> =>
  SHELL_INTENTS.has(intent.type);

// ---- effects -----------------------------------------------------------------------------------

/** What the shell asks main.ts to do, as data; `runShellEffect` (shellEffects.ts) runs each against the adapters. */
export type ShellEffect<G extends ShellTypes> =
  | Readonly<{ type: 'persist' }>
  | Readonly<{ type: 'clearSave' }>
  /** A handed-off game given back to pass-and-play: the room was cancelled before anyone joined. */
  | Readonly<{ type: 'saveLocal'; game: G['State'] }>
  | Readonly<{ type: 'rememberName'; name: string }>
  | Readonly<{ type: 'rememberP2Name'; name: string }>
  | Readonly<{ type: 'writeHomeTab'; tab: Tab<G> }>
  | Readonly<{ type: 'writePlayMode'; mode: PlayMode }>
  | Readonly<{ type: 'writeSoundFont'; font: SoundFontName }>
  /**
   * A game just ended on this device (the owner, 2026-09-25: "after a game is finished (either
   * online or pass-and-play) the datetime & score should be recorded, including the victor"):
   * the record, appended first to the game's `recentGames` pref; the shell state already holds it.
   */
  | Readonly<{ type: 'recordGame'; game: RecentGame }>
  /** Scroll `rule` into view inside the rules `slot` that is on screen and flash it (web/shared/edge/glossary.ts). */
  | Readonly<{ type: 'revealRule'; slot: RulesSlot; rule: string }>
  /** `ms` null is the default duration. */
  | Readonly<{ type: 'toast'; message: string; ms: number | null }>
  /** To the current session's channel, if open; `seat` names one of a host's channels (an N-seat game), absent every open one, which at capacity 2 is the one channel. */
  | Readonly<{ type: 'send'; frame: HostFrameOf<G> | GuestFrameOf<G>; seat?: SeatOf<G> }>
  | Readonly<{ type: 'fx'; cue: Cue<G> }>
  /**
   * Phrases the game's event binding chose (web/shared/ui/eventEffects.ts, sound-history.md
   * §3.5): played back to back in the App's font with one buzz, so a trick and the result it
   * ends the game with never sound under each other.
   */
  | Readonly<{ type: 'phrases'; phrases: ReadonlyArray<Phrase> }>
  | Readonly<{ type: 'wakeLock'; hold: boolean }>
  /** Open the room; `capacity` (seats, the host's included) and `waiting` (the open status) ride only for an N-seat game (`HostOptions.capacity`/`waiting`), so a two-seat effect is the literal it was. */
  | Readonly<{
      type: 'startHost';
      code: string;
      attempt: number;
      resume: boolean;
      capacity?: number;
      waiting?: string;
    }>
  | Readonly<{ type: 'startGuest'; code: string; attempt: number }>
  /** Close the current session's channel and destroy its Peer. */
  | Readonly<{ type: 'closeNet' }>
  /** `confirm(message)`: dispatch `then` when the player agrees. */
  | Readonly<{ type: 'confirm'; message: string; then: Intent<G> }>
  /** Dispatch `intent` next, after the effects before it ran. */
  | Readonly<{ type: 'then'; intent: Intent<G> }>
  /** Re-read storage and dispatch `home/init`. */
  | Readonly<{ type: 'initHome' }>
  /** `showScreen`'s `window.scrollTo(0, 0)`. */
  | Readonly<{ type: 'scrollTop' }>
  /** Arm a named timer that dispatches `then` after `ms`; arming again restarts it. */
  | Readonly<{ type: 'startTimer'; id: TimerId<G>; ms: number; then: Intent<G> }>
  | Readonly<{ type: 'cancelTimer'; id: TimerId<G> }>
  /** `fx.toggle()`. */
  | Readonly<{ type: 'toggleSound' }>
  /** The invite for `code` (its link) through the share sheet or the clipboard. */
  | Readonly<{ type: 'share'; code: string }>
  /**
   * The first player's name into every input that shows it (`initHome`, and after a keystroke).
   * `default` marks the shell's prefill (nothing remembered, `localNamesOf`): the page clears it on
   * the first tap, as the Score Counter clears its 0 (the owner, 2026-09-25: "when you click on a
   * pre-filled name for the first time it will clear it"); a remembered or typed name carries none.
   */
  | Readonly<{ type: 'fillName'; name: string; default?: true }>
  /** The second player's name into every input that shows it; `default` as `fillName`'s. */
  | Readonly<{ type: 'fillP2Name'; name: string; default?: true }>
  /** `#codeInput`'s value after sanitising. */
  | Readonly<{ type: 'setCode'; value: string }>;

export const SHELL_EFFECT_TYPES = [
  'persist',
  'clearSave',
  'saveLocal',
  'rememberName',
  'rememberP2Name',
  'writeHomeTab',
  'writePlayMode',
  'writeSoundFont',
  'recordGame',
  'revealRule',
  'toast',
  'send',
  'fx',
  'phrases',
  'wakeLock',
  'startHost',
  'startGuest',
  'closeNet',
  'confirm',
  'then',
  'initHome',
  'scrollTop',
  'startTimer',
  'cancelTimer',
  'toggleSound',
  'share',
  'fillName',
  'fillP2Name',
  'setCode',
] as const satisfies ReadonlyArray<ShellEffect<ShellTypes>['type']>;

/** A game's whole effect union: the shell's and its own. */
export type Effect<G extends ShellTypes> = ShellEffect<G> | G['Effect'];

const SHELL_EFFECTS: ReadonlySet<string> = new Set(SHELL_EFFECT_TYPES);
export const isShellEffect = <G extends ShellTypes>(effect: Effect<G>): effect is ShellEffect<G> =>
  SHELL_EFFECTS.has(effect.type);

export type Step<G extends ShellTypes> = Readonly<{
  app: ShellApp<G>;
  effects: ReadonlyArray<Effect<G>>;
}>;
export type Ctx = Readonly<{
  rng: Rng;
  now: () => number;
  /** `prefers-reduced-motion: reduce` on this device (web/shared/edge/motion.ts), so a reducer's timers and the painter's CSS agree; absent in tests and stories that do not care. */
  reducedMotion?: boolean;
}>;

// ---- the config a game supplies (docs/design/shared-shell.md §4.3) ------------------------------

/**
 * Where a shared flow resets the table, so each game spells the reset it made at that site before
 * the move (agreed in C2, replacing the design's `cleared`/`handedOff`/`newView` sketch: gin's
 * sites clear different sets, and the spread at each site moves into the game's switch as it was):
 * a pass-and-play start (a position loaded into one resets as a start does: backgammon's
 * `tableCleared` at that site, dry-round-2.md F5), a deal, the handoff, a leave, the host lost, a
 * new view (`broadcast`, `localBroadcast`), an applied action (`hostDispatch`) and a guest's
 * `state` frame.
 */
export type TableReset =
  'startLocal' | 'deal' | 'handoff' | 'leave' | 'lost' | 'view' | 'applied' | 'frame';

/** A preference over the game's store: web/shared/edge/prefs.ts `TextPref` fits, typed loosely so this zone never names the edge. */
export type Pref<St, T> = Readonly<{
  read: (store: St) => Result<T, unknown>;
  write: (store: St, value: T) => unknown;
}>;

/** The finished games over the game's store (prefs.ts `RecentGamesPref` fits): the list or [], and one record put first. */
export type RecentGamesPref<St> = Readonly<{
  read: (store: St) => ReadonlyArray<RecentGame>;
  append: (store: St, game: RecentGame) => unknown;
}>;

/** The shell's readers and writers the game builds over its keys (prefs.ts `shellStore`). */
export type ShellPrefs<G extends ShellTypes> = Readonly<{
  name: Pref<G['Store'], string>;
  p2Name: Pref<G['Store'], string>;
  homeTab: Pref<G['Store'], Tab<G>>;
  playMode: Pref<G['Store'], PlayMode>;
  soundFont: Pref<G['Store'], SoundFontName>;
  recentGames: RecentGamesPref<G['Store']>;
  save: Readonly<{
    readSave: (store: G['Store']) => Result<Save<G>, unknown>;
    writeSave: (store: G['Store'], save: Save<G>) => unknown;
    clearSave: (store: G['Store']) => unknown;
  }>;
}>;

/** Everything the shared flows call where the two reducers differed, and every literal shared code may not contain. */
export type ShellConfig<G extends ShellTypes> = Readonly<{
  /** The peer prefix and the room-code spec (web/shared/lib/roomCode.ts). */
  id: Game;
  names: Readonly<{
    /** The host name an empty input means (the wire's guest default is `DEFAULT_GUEST_NAME`). */
    default: string;
  }>;
  /**
   * The pass-and-play seats' defaults, first seat first: shown in the inputs when nothing is
   * remembered and seated when they are left empty (the owner, 2026-09-25: "backgammon is Ari and
   * Ethan", "briscola is Ari and Lavi (with p3 Sandro and p4 Grant)"). Absent, the shell's
   * `DEFAULT_LOCAL_NAMES` (gin); a seat past the list is `Player N` (`localNameFor`).
   */
  localNames?: ReadonlyArray<string>;
  tabs: Readonly<{ list: ReadonlyArray<Tab<G>>; default: Tab<G> }>;
  modes: Readonly<{
    default: PlayMode;
    /**
     * `mode/set`'s raw value: the mode shown and the one stored (null: shown only, gin's sandbox),
     * or null to ignore the intent (a sandbox the name does not unlock).
     */
    parse: (
      raw: string,
      shell: ShellState<G>,
    ) => Readonly<{ shown: Mode<G>; stored: PlayMode | null }> | null;
  }>;
  copy: Readonly<{
    leaveLocal: string;
    leaveOnline: string;
    /** The sessions' status copy (web/shared/net), which this zone may not import. */
    opening: string;
    connecting: (code: string) => string;
    handoff: (code: string, oppName: string | null) => string;
    /**
     * The guest's status once the host's welcome or lobby frame names the room (gin names the
     * target). `seated` is how many are at the table, the host included, of `capacity` seats: an
     * N-seat game says "3 of 4 seated"; a two-seat game's takes the first two and is told 2 of 2.
     */
    hostRoom: (hostName: string, opts: G['Opts'], seated: number, capacity: number) => string;
    // ---- the N-seat forms (n-seat-sessions.md §7), each with the two-seat string as its default; a two-seat game leaves them out ----
    /** The host's open status with no hand dealt (`HostOptions.waiting`); absent, the session's WAITING_MSG. */
    waiting?: (capacity: number) => string;
    /** `name` joined the lobby; `names` are every seated guest in seat order, `remaining` the empty seats; absent, `joinedMsg(name)`. */
    joined?: (name: string, names: ReadonlyArray<string>, remaining: number) => string;
    /** Seat `seat` (`name`, or null for a seat never named) left the lobby; `seated` of `capacity` remain, the host counted; absent, OPPONENT_LEFT_MSG. */
    seatLeft?: (name: string | null, seat: number, seated: number, capacity: number) => string;
    /** Seat `seat`'s channel dropped mid-game; absent, `guestGoneMsg(name, code)`. */
    guestGone?: (name: string | null, code: string | null, seat: number) => string;
    /** The guest told the table is full; absent, ROOM_FULL_MSG. */
    roomFull?: string;
    /** `host/deal` with `seated` at the table (the host counted) and `min` needed; absent, WAITING_FOR_GUEST_MSG. */
    notEnough?: (seated: number, min: number) => string;
  }>;
  /**
   * A table of more than two seats (n-seat-sessions.md §7): the players a room may hold, the
   * host counted. Absent for the two-seat games, whose every flow is then the line it was. Set,
   * the room opens at `opts.capacity(opts)` seats (2..`max`; `max` when the game supplies no
   * reader), Start enables at `min` seated, the host's `send`/`startHost` effects name seats and
   * the capacity, and a guest reads its seat and the table off the room frames (`roomSeatingOf`:
   * `you` and `seats` beside the options, D3), which the game's protocol puts there.
   */
  seats?: Readonly<{ min: number; max: number }>;
  opts: Readonly<{
    initial: G['Opts'];
    /** The raw select/input values off `host/click`/`local/click`; `current` is the shell's for a missing value. */
    parse: (raw: G['Raw'], current: G['Opts']) => G['Opts'];
    /** The terms a game was made under, for the handoff. */
    ofGame: (game: G['State']) => G['Opts'];
    /** The option fields alone off a record that carries them (a welcome frame, a resume offer), in the literal's order. */
    pick: (from: G['Opts']) => G['Opts'];
    /** An N-seat game: the seats a room under `opts` holds, the host's included (`HostOptions.capacity`; briscola its seat count). Read only with `cfg.seats`; absent then, `cfg.seats.max`. */
    capacity?: (opts: G['Opts']) => number;
  }>;
  engine: Readonly<{
    /** The deal: the host first, then every guest seat in order (`PlayersOf<G>`: the pair for a two-seat game). */
    create: (players: PlayersOf<G>, opts: G['Opts'], rng: Rng, now: () => number) => G['State'];
    apply: (
      game: G['State'],
      seat: SeatOf<G>,
      action: G['Action'],
      rng: Rng,
      now: () => number,
    ) => Result<G['State'], string>;
    viewFor: (game: G['State'], seat: SeatOf<G>) => G['View'];
    /** The view shows the game over: nothing to rejoin, nobody to toast for. */
    over: (view: G['View']) => boolean;
    /** The saved game is over: not offered to resume. */
    finished: (game: G['State']) => boolean;
    /** The two seats' names, for the handoff (seat 0 hosts, seat 1 joins). */
    names: (game: G['State']) => Readonly<[string, string]>;
    /** `game.players[seat].name = name` on a rejoin; `seat` is 1 for a two-seat game, whose builder takes the first two. */
    renameGuest: (game: G['State'], name: string, seat: SeatOf<G>) => G['State'];
    /** The engine state off `position/load`'s hand-made object (the save's decoder); its error names the path. */
    decodeState: Decoder<G['State']>;
  }>;
  /**
   * What a finished game leaves in the device's history (web/shared/lib/recentGames.ts), read off
   * the view the first time `engine.over` says so: the game's identity (`keyOf`, its start time,
   * so a re-sent frame or a repaint records nothing and a rematch records again), every seat's
   * name in seat order (`playersOf`: the view has them for every role, and a game with more than
   * two seats names them all), its final score as the game spells it (gin "104–87", backgammon
   * "5–3") and the winner, or null when nobody won: a seat, or the side seat 0 is on where a game
   * plays in sides (briscola's teams), so `outcomeFor` reads it against the user's seat either way.
   */
  result: Readonly<{
    keyOf: (view: G['View']) => string;
    playersOf: (view: G['View']) => ReadonlyArray<string>;
    scoreOf: (view: G['View']) => string;
    winnerOf: (view: G['View']) => SeatOf<G> | null;
  }>;
  /** The game's protocol.ts builders the shell sends. */
  frames: Readonly<{
    /** The lobby frame for seat `you`: an N-seat game's carries the seat list and the receiver's seat (D3); a two-seat game's takes the first two. */
    lobby: (
      hostName: string,
      opts: G['Opts'],
      seats: ReadonlyArray<SeatState>,
      you: SeatOf<G>,
    ) => HostFrameOf<G>;
    state: (view: G['View']) => HostFrameOf<G>;
    toast: (message: string) => HostFrameOf<G>;
    action: (action: G['Action']) => GuestFrameOf<G>;
  }>;
  cues: Readonly<{ initial: G['Cues'] }>;
  table: Readonly<{
    initial: G['Table'];
    reset: (table: G['Table'], at: TableReset) => G['Table'];
    /**
     * The state side of a paint against the view: `prev` is the view it replaces, `ctx` the clock
     * for backgammon's R14 beat, read by the game that needs it and never here (gin's DOM parity
     * oracle drives both pages with a counting clock, so an eager `ctx.now()` per paint shows up
     * as elapsed time).
     */
    rendered: (app: ShellApp<G>, prev: G['View'] | null, ctx: Ctx) => Step<G>;
    /** A refused action: the toast, and whatever the table drops (gin a waiting draw stage, backgammon its taps). */
    refuse: (app: ShellApp<G>, message: string) => Step<G>;
    /**
     * An ephemeral frame arrived (`host/frame` from the guest's channel, `guest/frame` from the
     * host): `seat` is the sender's channel seat as the shell knows it (1 for the host's one guest,
     * 0 for the host at a guest). Absent, the frame is dropped: nothing in the shell reads it.
     */
    ephemeral?: (app: ShellApp<G>, frame: EphemeralOf<G>, seat: SeatOf<G>, ctx: Ctx) => Step<G>;
  }>;
  /** Pass-and-play's two game-specific decisions (agreed in C2). */
  local: Readonly<{
    /**
     * `localBroadcast`: whose view is shown, whether the curtain comes up for them, and what else
     * the change hands over (backgammon's hit toast when the curtain is off).
     */
    viewer: (
      app: ShellApp<G>,
      game: G['State'],
    ) => Readonly<{
      seat: SeatOf<G>;
      curtain: SeatOf<G> | null;
      effects: ReadonlyArray<Effect<G>>;
    }>;
    /** `curtain/reveal`: the seat that lifts the curtain and what it is told (backgammon's hits against it). */
    revealer: (
      game: G['State'],
    ) => Readonly<{ seat: SeatOf<G>; effects: ReadonlyArray<Effect<G>> }>;
  }>;
  home: Readonly<{
    /** The game's own keys for the snapshot (`G['Home']`). */
    read: (store: G['Store']) => G['Home'];
    /** The snapshot's own part into the App (gin's sort and card back onto the table; backgammon's options into the shell and its curtain mode onto the table). */
    apply: (app: ShellApp<G>, home: HomeSnapshot<G>) => ShellApp<G>;
    /** The resume box for a snapshot, in the game's order of precedence (gin's scorer first). */
    resume: (home: HomeSnapshot<G>) => Resume<G> | null;
    /** `resume/click` on an offer the shell does not know (`G['Resume']`). */
    resumeExtra: (app: ShellApp<G>, offer: G['Resume'], ctx: Ctx) => Step<G>;
  }>;
  prefs: ShellPrefs<G>;
}>;

/**
 * The half of a config a game spells from its engine, protocol and storage alone
 * (`src/shellConfig.ts`); its `ui/state.ts` adds the table hooks, which use the reducer's own
 * helpers, and completes `home`.
 */
export type ShellGameData<G extends ShellTypes> = Omit<ShellConfig<G>, 'table' | 'local' | 'home'> &
  Readonly<{ home: Pick<ShellConfig<G>['home'], 'read'> }>;

// ---- the strings the shell (not the sessions) writes, the same in both games -------------------

/** The Play tab opens its submenu after this long a press. */
export const LONG_PRESS_MS = 450;
/**
 * A waiting room saved (opened or reopened) within this long resumes by itself at boot
 * (`resume/auto`; lobby-resume.md D4): long enough for a phone to discard the tab while the host
 * chats the invite around, short enough that a room left open days ago never opens itself and
 * is offered instead.
 */
export const WAITING_RESUME_MS = 30 * 60_000;
/** The guest wait screen's first status, before the session speaks. */
export const CONNECTING_MSG = 'Connecting…';
export const NOT_CONNECTED_MSG = 'Not connected to the host.';
export const WAITING_FOR_GUEST_MSG = 'Waiting for your opponent to join.';
export const OPPONENT_LEFT_MSG = 'Opponent left. Waiting for someone to join…';
export const ROOM_FULL_MSG = 'That room already has two players.';
export const LOST_HOST_MSG = 'Lost connection to the host — reconnecting…';
export const DISCONNECTED_MSG = 'Disconnected from the host — reconnecting…';
export const joinedMsg = (name: string): string => `${name} joined! Ready when you are.`;
export const guestGoneMsg = (oppName: string | null, code: string | null): string =>
  `${oppName ?? 'Opponent'} disconnected — they can rejoin with code ${String(code)}.`;
/** `onGuestGone`'s toast lasts this long, as does `LOST_HOST_MSG`. */
export const GONE_TOAST_MS = 4000;
/** `position/load` outside pass-and-play, and a position the decoder refuses (backgammon's copy before dry-round-2.md F5; gin showed none: its sandbox deals, never loads). */
export const SANDBOX_LOCAL_ONLY_MSG = 'Positions can only be set up in pass-and-play.';
export const badPositionMsg = (error: string): string => `That position is not valid: ${error}`;

// ---- steps and the small helpers every case uses; the games import them for their table cases ----

export const pure = <G extends ShellTypes>(app: ShellApp<G>): Step<G> => ({ app, effects: [] });
export const step = <G extends ShellTypes>(
  app: ShellApp<G>,
  ...effects: ReadonlyArray<Effect<G>>
): Step<G> => ({ app, effects });
/**
 * Run `f` after `s`, keeping `s`'s effects first. Named `andThen` here and imported as `then` by
 * the games: an export called `then` would make this module's namespace a thenable, which a test
 * runner's dynamic import awaits (and rejects with nothing).
 */
export const andThen = <G extends ShellTypes>(
  s: Step<G>,
  f: (app: ShellApp<G>) => Step<G>,
): Step<G> => {
  const next = f(s.app);
  return { app: next.app, effects: [...s.effects, ...next.effects] };
};
export const toast = (
  message: string,
  ms: number | null = null,
): Readonly<{ type: 'toast'; message: string; ms: number | null }> => ({
  type: 'toast',
  message,
  ms,
});
const tap = { type: 'fx', cue: 'tap' } as const;
export const withShell = <G extends ShellTypes>(
  app: ShellApp<G>,
  over: Partial<ShellState<G>>,
): ShellApp<G> => ({ ...app, shell: { ...app.shell, ...over } });
export const withTable = <G extends ShellTypes>(
  app: ShellApp<G>,
  over: Partial<G['Table']>,
): ShellApp<G> => ({ ...app, table: { ...app.table, ...over } });

/** `(value.trim() || fallback).slice(0, 20)`. */
const nameOr = (raw: string, fallback: string): string => {
  const trimmed = raw.trim();
  return (trimmed === '' ? fallback : trimmed).slice(0, NAME_MAX);
};

/**
 * The two pass-and-play seats when their inputs are empty, and what `initHome` fills the inputs
 * with when nothing is remembered (the owner, 2026-09-25: "Make the default p1 ari and p2 lavi",
 * spelled as the proper names), unless the game names its own (`ShellConfig.localNames`: the
 * owner, later that day, "backgammon is Ari and Ethan"). The first is also the online name input's
 * markup default (each game's shellConfig.ts DEFAULT_NAME, pinned there), since `fillName` reaches
 * that input too and must find the name it already shows. A seat past the list is `Player N`.
 */
export const DEFAULT_LOCAL_NAMES: readonly [string, string] = ['Ari', 'Lavi'];

/** The game's pass-and-play defaults (`localNames`), or the shell's two. */
export const localNamesOf = (
  cfg: Readonly<{ localNames?: ReadonlyArray<string> }>,
): ReadonlyArray<string> => cfg.localNames ?? DEFAULT_LOCAL_NAMES;

/** The default for seat `seat` (0-based): the list's name, else `Player N`. */
export const localNameFor = (names: ReadonlyArray<string>, seat: number): string =>
  names[seat] ?? `Player ${String(seat + 1)}`;

/** Two players from the pass-and-play inputs: the game's defaults (`localNamesOf`), and " 2" on a clash (gin's sandbox deals them too). */
export const localPlayers = (
  p1raw: string,
  p2raw: string,
  names: ReadonlyArray<string>,
): Readonly<[Player, Player]> => {
  const p1 = nameOr(p1raw, localNameFor(names, 0));
  const p2 = nameOr(p2raw, localNameFor(names, 1));
  return [
    { id: 'p1', name: p1 },
    { id: 'p2', name: p2.toLowerCase() === p1.toLowerCase() ? `${p2} 2` : p2 },
  ];
};

/**
 * The seats of a pass-and-play table with any number of players, from its name inputs in seat
 * order: `localPlayers`'s rule at every seat (the game's default for an empty seat, `localNameFor`:
 * its `localNames` as far as they go, `Player N` beyond; ` N` appended to a name an earlier seat
 * already has, case-insensitively), so a game with more than two seats names them as the two-seat
 * games do and `localSeats([p1, p2], names)` is `localPlayers(p1, p2, names)`. The game with the
 * extra seats creates its own engine state from these and hands it to `startLocal`.
 */
export const localSeats = (
  raws: ReadonlyArray<string>,
  names: ReadonlyArray<string>,
): ReadonlyArray<Player> =>
  raws.reduce<ReadonlyArray<Player>>((seated, raw, i) => {
    const n = String(i + 1);
    const name = nameOr(raw, localNameFor(names, i));
    const taken = seated.some((p) => p.name.toLowerCase() === name.toLowerCase());
    return [...seated, { id: `p${n}`, name: taken ? `${name} ${n}` : name }];
  }, []);

const showScreen = <G extends ShellTypes>(app: ShellApp<G>, screen: ScreenId<G>): Step<G> =>
  step(withShell(app, { screen }), { type: 'scrollTop' });

const withHostStatus = <G extends ShellTypes>(
  app: ShellApp<G>,
  text: string,
  stopPulse = false,
): ShellApp<G> =>
  withShell(app, { hostStatus: { text, pulse: stopPulse ? false : app.shell.hostStatus.pulse } });
const withGuestStatus = <G extends ShellTypes>(
  app: ShellApp<G>,
  text: string,
  stopPulse = false,
): ShellApp<G> =>
  withShell(app, {
    guestStatus: { text, pulse: stopPulse ? false : app.shell.guestStatus.pulse },
  });

// ---- seats (docs/design/n-seat-sessions.md §7; every helper is the two-seat line at one seat) ----

/** A room of more than two seats: the game supplies `cfg.seats`; absent, every flow below takes the two-seat line it was. */
const isNSeat = <G extends ShellTypes>(cfg: ShellConfig<G>): boolean => cfg.seats !== undefined;

/**
 * The room's seats as the host's flows read them. An N-seat game's are `shell.seats`; a two-seat
 * game's are the legacy pair `oppName`/`oppConnected` (its suites build shells from those two
 * fields alone, so they stay its source of truth and `shell.seats` is their mirror).
 */
const seatsOf = <G extends ShellTypes>(
  s: ShellState<G>,
  cfg: ShellConfig<G>,
): ReadonlyArray<SeatState> =>
  isNSeat(cfg) ? s.seats : [{ name: s.oppName, connected: s.oppConnected }];

/** The seats written, and `oppName`/`oppConnected` with them as seat 1's (the host's reading of the two). */
const withSeats = <G extends ShellTypes>(
  app: ShellApp<G>,
  seats: ReadonlyArray<SeatState>,
): ShellApp<G> =>
  withShell(app, {
    seats,
    oppName: seats[0]?.name ?? null,
    oppConnected: seats[0]?.connected ?? false,
  });

/** `seats` grown to at least `n` entries, the new ones empty. */
const seatsUpTo = (seats: ReadonlyArray<SeatState>, n: number): ReadonlyArray<SeatState> =>
  Array.from({ length: Math.max(seats.length, n) }, (_, i) => seats[i] ?? EMPTY_SEAT);

/** Seat `seat` (1-based) replaced, the list grown to reach it. */
const seatAt = (
  seats: ReadonlyArray<SeatState>,
  seat: number,
  next: SeatState,
): ReadonlyArray<SeatState> =>
  seatsUpTo(seats, seat).map((current, i) => (i === seat - 1 ? next : current));

/** The guest seat for index `i` of `seats`: the array is in seat order, so the seat is the index plus one (the game's own seats past `0 | 1` come from its bag). */
const guestSeat = <G extends ShellTypes>(i: number): SeatOf<G> => (i + 1) as SeatOf<G>;

/** How many are at the table, the host counted. */
const seatedCount = (seats: ReadonlyArray<SeatState>): number =>
  1 + seats.filter((seat) => seat.connected).length;

/** The table's seats for `opts`, the host's included: the game's `opts.capacity` (its `max` without one), floored at two as the session floors it; two for a two-seat game. */
const capacityOf = <G extends ShellTypes>(opts: G['Opts'], cfg: ShellConfig<G>): number =>
  cfg.seats === undefined
    ? 2
    : Math.max(2, cfg.opts.capacity === undefined ? cfg.seats.max : cfg.opts.capacity(opts));

/**
 * The players `engine.create` deals to, from the list the shell seated (the host, then every guest
 * seat in order). The bag fixes whether the game's engine reads the pair or the list
 * (`PlayersOf<G>`), which no call site can tell, so this is the one place the list is read as the
 * game's type: a two-seat game is only ever handed two.
 */
const playersFor = <G extends ShellTypes>(players: ReadonlyArray<Player>): PlayersOf<G> =>
  players as PlayersOf<G>;

/** The seating an N-seat game's room frames carry beside the options (D3): the receiving guest's seat and one row per guest seat 1..N−1. */
const seating = object({
  you: integer(1),
  seats: arrayOf(object({ name: nullable(string), connected: boolean })),
});

/**
 * The receiver's seat and the table off a welcome or lobby frame, when the frame carries them
 * (`you` naming one of `seats`); null for a frame without (a two-seat game's, or a seating that
 * names no seat). The game's decoder has already refused a malformed seating on the wire; this
 * reads what it let through, so the shell needs no reader from the game.
 */
export const roomSeatingOf = <G extends ShellTypes>(
  frame: HostFrameOf<G>,
): Readonly<{ you: SeatOf<G>; seats: ReadonlyArray<SeatState> }> | null => {
  const decoded = seating(frame);
  if (!decoded.ok) return null;
  const { you, seats } = decoded.value;
  return you <= seats.length ? { you: you as SeatOf<G>, seats } : null;
};

/** Players at the table before the host may deal: the game's `min`, or two. */
const minSeated = <G extends ShellTypes>(cfg: ShellConfig<G>): number => cfg.seats?.min ?? 2;

/** A `send` effect to one seat of an N-seat room; a two-seat game's is the literal it was, no `seat` key (its one channel is every open one). */
const sendTo = <G extends ShellTypes>(
  frame: HostFrameOf<G>,
  seat: SeatOf<G>,
  cfg: ShellConfig<G>,
): Effect<G> => (isNSeat(cfg) ? { type: 'send', frame, seat } : { type: 'send', frame });

/** One lobby frame per connected seat, each with its own `you` (D3). */
const lobbySends = <G extends ShellTypes>(
  s: ShellState<G>,
  cfg: ShellConfig<G>,
): ReadonlyArray<Effect<G>> => {
  const seats = seatsOf(s, cfg);
  return seats.flatMap((seat, i) =>
    seat.connected
      ? [sendTo(cfg.frames.lobby(s.myName, s.opts, seats, guestSeat<G>(i)), guestSeat<G>(i), cfg)]
      : [],
  );
};

/**
 * `guestNameFor` against every name at the table (the host's and the other seats'): the wire's
 * normalisation, then ` 2`, ` 3`, … until it clashes with nobody, case-insensitively. Against the
 * host's name alone it is `guestNameFor(raw, hostName)`, ` 2` appended once.
 */
export const guestNameAmong = (raw: string, taken: ReadonlyArray<string>): string => {
  const named = guestNameFor(raw, '');
  const clashes = (name: string): boolean =>
    taken.some((t) => t.toLowerCase() === name.toLowerCase());
  const free = (n: number): string =>
    clashes(`${named} ${String(n)}`) ? free(n + 1) : `${named} ${String(n)}`;
  return clashes(named) ? free(2) : named;
};

// ---- the cue memory (docs/design/dry-round-2.md F6) ---------------------------------------------

/**
 * What a game's cue machine remembers between paints so each event chimes once: the key of the
 * position it last played for (gin: a result's timestamp or the totals; backgammon: game, phase,
 * turn, log and play lengths). The shell's `cues` field holds the game's memory (`G['Cues']`: this
 * record, or one extending it, gin's adds `turnKey`); the cues themselves stay each game's
 * derivation (`cfg.table.rendered`, gin's `nextCue`), the two machines being 5/62 lines alike
 * (dry-round-2.md §2E) and sharing only this rule.
 */
export type CueMemory = Readonly<{ key: string | null }>;
/** `key` against the memory: `fresh` when it names a new position; the memory keyed on it either way. */
export const fresh = (
  mem: CueMemory,
  key: string,
): Readonly<{ mem: CueMemory; fresh: boolean }> => ({ mem: { key }, fresh: mem.key !== key });

// ---- the finished game's record ---------------------------------------------------------------

/**
 * The seat the device's user sits in (the owner: "p1 on the device should be considered the
 * user"): seat 0 in pass-and-play (the first name) and for the host, seat 1 for the guest; none
 * at home.
 */
export const userSeatOf = (role: Role | null): Seat | null => {
  switch (role) {
    case 'local':
    case 'host':
      return 0;
    case 'guest':
      return 1;
    case null:
      return null;
  }
};

/**
 * Once per finished game (the owner, 2026-09-25): when the view first shows the game over, its
 * record (the clock, the mode, the seats' names, the game's score and winner, the outcome from
 * the user's seat) goes first into `recentGames` and out as the `recordGame` effect, and its key
 * is kept so a re-sent frame, a repaint, a re-render or the guest's late `state` frame of the
 * same game records nothing more. Every view change ends in `painted` below, so pass-and-play,
 * the host and the guest all reach here, each reading the names off its own view.
 */
const recordResult = <G extends ShellTypes>(
  app: ShellApp<G>,
  ctx: Ctx,
  cfg: ShellConfig<G>,
): Step<G> => {
  const s = app.shell;
  const view = s.view;
  // My seat (`userSeatOf` for a two-seat game; an N-seat game's guest may sit past 1, the frame's `you`).
  const seat = s.role === null ? null : s.mySeat;
  if (view === null || seat === null || !cfg.engine.over(view)) return pure(app);
  const key = cfg.result.keyOf(view);
  if (s.recorded === key) return pure(app);
  const winner = cfg.result.winnerOf(view);
  const game: RecentGame = {
    at: ctx.now(),
    mode: s.role === 'local' ? 'local' : 'online',
    players: cfg.result.playersOf(view),
    score: cfg.result.scoreOf(view),
    winner,
    outcome: outcomeFor(seat, winner),
  };
  return step(withShell(app, { recorded: key, recentGames: appendCapped(s.recentGames, game) }), {
    type: 'recordGame',
    game,
  });
};

/** The game's `rendered` hook, then the finished game's record: every view change ends here. */
const painted = <G extends ShellTypes>(
  app: ShellApp<G>,
  prev: G['View'] | null,
  ctx: Ctx,
  cfg: ShellConfig<G>,
): Step<G> => andThen(cfg.table.rendered(app, prev, ctx), (a) => recordResult(a, ctx, cfg));

// ---- flows -------------------------------------------------------------------------------------

/**
 * `broadcast()`: my view, each connected seat's view on the wire (one `send` per seat, its own
 * redaction, D4; a two-seat game's is the one `send` it was), the table's per-view reset, saved,
 * rendered.
 */
export const broadcast = <G extends ShellTypes>(
  app: ShellApp<G>,
  ctx: Ctx,
  cfg: ShellConfig<G>,
): Step<G> => {
  const game = app.shell.game;
  if (game === null) return pure(app);
  const sends: ReadonlyArray<Effect<G>> = isNSeat(cfg)
    ? app.shell.seats.flatMap((seat, i) =>
        seat.connected
          ? [
              sendTo(
                cfg.frames.state(cfg.engine.viewFor(game, guestSeat<G>(i))),
                guestSeat<G>(i),
                cfg,
              ),
            ]
          : [],
      )
    : [{ type: 'send', frame: cfg.frames.state(cfg.engine.viewFor(game, 1)) }];
  return andThen(
    step(
      {
        shell: { ...app.shell, view: cfg.engine.viewFor(game, 0) },
        table: cfg.table.reset(app.table, 'view'),
      },
      ...sends,
      { type: 'persist' },
    ),
    (a) => painted(a, app.shell.view, ctx, cfg),
  );
};

/** `dispatch(seat, action)`, host only: apply, or refuse to the mover (a toast frame to the guest); then broadcast. */
export const hostDispatch = <G extends ShellTypes>(
  app: ShellApp<G>,
  seat: SeatOf<G>,
  action: G['Action'],
  ctx: Ctx,
  cfg: ShellConfig<G>,
): Step<G> => {
  const game = app.shell.game;
  if (game === null) return pure(app);
  const res = cfg.engine.apply(game, seat, action, ctx.rng, ctx.now);
  if (!res.ok)
    return seat === 0
      ? cfg.table.refuse(app, res.error)
      : step(app, sendTo(cfg.frames.toast(res.error), seat, cfg));
  return broadcast(
    { shell: { ...app.shell, game: res.value }, table: cfg.table.reset(app.table, 'applied') },
    ctx,
    cfg,
  );
};

/**
 * `localBroadcast(initial)`: the view of whoever the game hands the phone to (`cfg.local.viewer`),
 * the curtain up when the phone must change hands, chiming unless this is the start or a reveal.
 */
export const localBroadcast = <G extends ShellTypes>(
  app: ShellApp<G>,
  initial: boolean,
  ctx: Ctx,
  cfg: ShellConfig<G>,
): Step<G> => {
  const game = app.shell.game;
  if (game === null) return pure(app);
  const prev = app.shell.view;
  const { seat, curtain, effects } = cfg.local.viewer(app, game);
  return andThen(
    step(
      {
        shell: { ...app.shell, view: cfg.engine.viewFor(game, seat) },
        table: { ...cfg.table.reset(app.table, 'view'), curtain },
      },
      { type: 'persist' },
      ...(curtain !== null && !initial ? [{ type: 'fx', cue: 'yourTurn' } as const] : []),
      ...effects,
    ),
    (a) => painted(a, prev, ctx, cfg),
  );
};

/** The shell seated for pass-and-play with `game` and the table reset for it: what `startLocal` broadcasts (gin's sandbox seats its hand-made melds in between). */
export const localSeated = <G extends ShellTypes>(
  app: ShellApp<G>,
  game: G['State'],
  cfg: ShellConfig<G>,
): ShellApp<G> => {
  // Every seat is played from this device: the names off seat 0's view (the view has them for every role).
  const localNames = cfg.result.playersOf(cfg.engine.viewFor(game, 0));
  return {
    shell: {
      ...app.shell,
      role: 'local',
      code: null,
      oppConnected: true,
      game,
      revealed: null,
      mySeat: 0,
      localNames,
      localSeats: localNames.map((_, i) => i as SeatOf<G>),
    },
    table: cfg.table.reset(app.table, 'startLocal'),
  };
};

/** `startLocal(game)`: pass-and-play, no Peer; the wake lock is held; the curtain names the starter. */
export const startLocal = <G extends ShellTypes>(
  app: ShellApp<G>,
  game: G['State'],
  ctx: Ctx,
  cfg: ShellConfig<G>,
): Step<G> =>
  andThen(step(localSeated(app, game, cfg), { type: 'wakeLock', hold: true }), (a) =>
    localBroadcast(a, true, ctx, cfg),
  );

/**
 * `position/load` (docs/design/dry-round-2.md F5; backgammon's `sandboxLoad` as it stood, over the
 * config): the pass-and-play game's engine state replaced by the decoded one, the table reset as
 * a start resets it, and the phone left with whoever must act, the seat the curtain would lift for
 * (`cfg.local.revealer`, so no curtain comes up and no adapter is added for the one seat). Refused
 * with a toast in any other role, and for a state the decoder refuses (`formatError` names the
 * path). What sends the intent is the game's hook (`__backgammon.setup`); nothing here knows it.
 */
const loadPosition = <G extends ShellTypes>(
  app: ShellApp<G>,
  raw: unknown,
  ctx: Ctx,
  cfg: ShellConfig<G>,
): Step<G> => {
  if (app.shell.role !== 'local' || app.shell.game === null)
    return step(app, toast(SANDBOX_LOCAL_ONLY_MSG));
  const decoded = cfg.engine.decodeState(raw);
  if (!decoded.ok) return step(app, toast(badPositionMsg(formatError(decoded.error))));
  const game = decoded.value;
  return localBroadcast(
    {
      shell: { ...app.shell, game, revealed: cfg.local.revealer(game).seat },
      table: cfg.table.reset(app.table, 'startLocal'),
    },
    true,
    ctx,
    cfg,
  );
};

/** `startHost(resumeCode)` up to the network: the session is the `startHost` effect. */
const startHost = <G extends ShellTypes>(
  app: ShellApp<G>,
  resumeCode: string | null,
  ctx: Ctx,
  cfg: ShellConfig<G>,
): Step<G> => {
  const code = resumeCode ?? randomCode(cfg.id, ctx.rng);
  const attempt = app.shell.netAttempt + 1;
  // The room's seats, `capacity − 1` of them: as the caller left them (empty for a fresh room; named
  // and disconnected for a resumed or handed-off one), grown to the capacity the terms name.
  const capacity = capacityOf(app.shell.opts, cfg);
  const seats = seatsUpTo(seatsOf(app.shell, cfg), capacity - 1).slice(0, capacity - 1);
  return andThen(
    showScreen(
      withHostStatus(
        withSeats(
          withShell(app, {
            role: 'host',
            code,
            netAttempt: attempt,
            startGameVisible: false,
            openedAt: ctx.now(),
            mySeat: 0,
          }),
          seats,
        ),
        cfg.copy.opening,
      ),
      'hostWaitScreen',
    ),
    (a) =>
      step(a, {
        type: 'startHost',
        code,
        attempt,
        resume: resumeCode !== null,
        // An N-seat room tells the session its capacity and its own open status (D8); a two-seat game's effect is the literal it was.
        ...(cfg.seats === undefined
          ? {}
          : {
              capacity,
              ...(cfg.copy.waiting === undefined ? {} : { waiting: cfg.copy.waiting(capacity) }),
            }),
      }),
  );
};

/** `startGuest(code)` up to the network: the session is the `startGuest` effect. */
const startGuest = <G extends ShellTypes>(
  app: ShellApp<G>,
  code: string,
  cfg: ShellConfig<G>,
): Step<G> => {
  const attempt = app.shell.netAttempt + 1;
  return andThen(
    showScreen(
      withGuestStatus(
        // Seat 1 until the host's welcome names my seat; the seat list is the host's to send.
        withShell(app, { role: 'guest', code, netAttempt: attempt, mySeat: 1, seats: [] }),
        cfg.copy.connecting(code),
      ),
      'guestWaitScreen',
    ),
    (a) => step(a, { type: 'startGuest', code, attempt }),
  );
};

/**
 * `onGuestGone()` after `oppConnected` was cleared. During a handoff nobody has joined yet (the
 * game is there, but the room still waits for the invite to be followed), so a channel that closed
 * or failed before its join leaves the wait screen saying to send the invite, with no toast.
 */
const guestGone = <G extends ShellTypes>(
  app: ShellApp<G>,
  seat: SeatOf<G>,
  ctx: Ctx,
  cfg: ShellConfig<G>,
): Step<G> => {
  const s = app.shell;
  if (s.handoff) return pure(withHostStatus(app, cfg.copy.handoff(s.code ?? '', s.oppName)));
  if (s.game !== null && s.view !== null && !cfg.engine.over(s.view))
    return andThen(painted(app, s.view, ctx, cfg), (a) => {
      const name = seatsOf(a.shell, cfg)[seat - 1]?.name ?? null;
      const text =
        cfg.copy.guestGone === undefined
          ? guestGoneMsg(name, a.shell.code)
          : cfg.copy.guestGone(name, a.shell.code, seat);
      return step(a, toast(text, GONE_TOAST_MS));
    });
  if (s.game === null) {
    if (!isNSeat(cfg))
      return pure(withShell(withHostStatus(app, OPPONENT_LEFT_MSG), { startGameVisible: false }));
    // The seat reads empty again, Start follows the count, the others learn the new lobby.
    const name = s.seats[seat - 1]?.name ?? null;
    const left = withSeats(app, seatAt(s.seats, seat, EMPTY_SEAT));
    const seated = seatedCount(left.shell.seats);
    const capacity = left.shell.seats.length + 1;
    const text =
      cfg.copy.seatLeft === undefined
        ? OPPONENT_LEFT_MSG
        : cfg.copy.seatLeft(name, seat, seated, capacity);
    return step(
      withShell(withHostStatus(left, text), { startGameVisible: seated >= minSeated(cfg) }),
      ...lobbySends(left.shell, cfg),
    );
  }
  return pure(app);
};

/** `onGuestMsg(conn, msg)` for a decoded frame on `seat`'s channel (1 for a two-seat game). */
const hostFrame = <G extends ShellTypes>(
  app: ShellApp<G>,
  frame: GuestFrameOf<G>,
  seat: SeatOf<G>,
  ctx: Ctx,
  cfg: ShellConfig<G>,
): Step<G> => {
  const s = app.shell;
  switch (frame.t) {
    case 'join': {
      // The name against the host's and the other seats' (the seat's own last name is not a clash: a rejoin keeps it).
      const seats = seatsOf(s, cfg);
      const others = seats.flatMap((other, i) =>
        i === seat - 1 || other.name === null ? [] : [other.name],
      );
      const name = guestNameAmong(frame.name, [s.myName, ...others]);
      const connected = withShell(withSeats(app, seatAt(seats, seat, { name, connected: true })), {
        handoff: false,
      });
      if (s.game !== null) {
        // Rejoin: keep the seat, refresh the name.
        return broadcast(
          withShell(connected, { game: cfg.engine.renameGuest(s.game, name, seat) }),
          ctx,
          cfg,
        );
      }
      const seated = seatedCount(connected.shell.seats);
      const capacity = connected.shell.seats.length + 1;
      const names = connected.shell.seats.flatMap((x) =>
        x.connected && x.name !== null ? [x.name] : [],
      );
      const text =
        cfg.copy.joined === undefined
          ? joinedMsg(name)
          : cfg.copy.joined(name, names, capacity - seated);
      return step(
        withShell(withHostStatus(connected, text), {
          startGameVisible: seated >= minSeated(cfg),
        }),
        ...lobbySends(connected.shell, cfg),
      );
    }
    case 'action':
      return s.game === null ? pure(app) : hostDispatch(app, seat, frame.action, ctx, cfg);
    case EPHEMERAL_TAG:
      return cfg.table.ephemeral?.(app, frame, seat, ctx) ?? pure(app);
  }
};

/** `onHostMsg(msg)` for a decoded frame. */
const guestFrame = <G extends ShellTypes>(
  app: ShellApp<G>,
  frame: HostFrameOf<G>,
  ctx: Ctx,
  cfg: ShellConfig<G>,
): Step<G> => {
  switch (frame.t) {
    case 'welcome':
    case 'lobby': {
      const opts = cfg.opts.pick(frame);
      // An N-seat room's frame names my seat and lists the others (D3); a two-seat game's carries neither and says two of two.
      const room = cfg.seats === undefined ? null : roomSeatingOf<G>(frame);
      const seated = room === null ? 2 : seatedCount(room.seats);
      const capacity = room === null ? 2 : room.seats.length + 1;
      return pure(
        withGuestStatus(
          withShell(app, {
            oppName: frame.hostName,
            opts,
            ...(room === null ? {} : { mySeat: room.you, seats: room.seats }),
          }),
          cfg.copy.hostRoom(frame.hostName, opts, seated, capacity),
        ),
      );
    }
    case 'full':
      return pure(withGuestStatus(app, cfg.copy.roomFull ?? ROOM_FULL_MSG));
    case 'toast':
      // The host refused the guest's move.
      return cfg.table.refuse(app, frame.msg);
    case 'state':
      return painted(
        {
          shell: { ...app.shell, view: frame.view, oppConnected: true },
          table: cfg.table.reset(app.table, 'frame'),
        },
        app.shell.view,
        ctx,
        cfg,
      );
    case EPHEMERAL_TAG:
      return cfg.table.ephemeral?.(app, frame, 0, ctx) ?? pure(app);
  }
};

// ---- home, resume, leave ---------------------------------------------------------------------

/**
 * The resume box `initHome` shows for a save, or null (a finished game is not offered); the game's
 * own offers come first through `cfg.home.resume`. A host save with no game is the waiting room
 * this device opened (lobby-resume.md D3): offered under its code, with the save's stamp, so
 * `resume/auto` can tell a moment ago from last week.
 */
export const resumeFor = <G extends ShellTypes>(
  save: Save<G> | null,
  cfg: ShellConfig<G>,
): ShellResume<G> | null => {
  if (save === null) return null;
  switch (save.role) {
    case 'local':
      return cfg.engine.finished(save.game) ? null : { kind: 'local', game: save.game };
    case 'host':
      return save.game === null || !cfg.engine.finished(save.game)
        ? {
            kind: 'host',
            code: save.code,
            myName: save.myName,
            ...cfg.opts.pick(save),
            game: save.game,
            oppName: save.oppName,
            ...(save.seatNames === undefined ? {} : { seatNames: save.seatNames }),
            handoff: save.handoff === true,
            at: save.at ?? null,
          }
        : null;
    case 'guest':
      return { kind: 'guest', code: save.code, myName: save.myName };
  }
};

const SHELL_RESUME_KINDS: ReadonlySet<string> = new Set(['local', 'host', 'guest']);
const isShellResume = <G extends ShellTypes>(offer: Resume<G>): offer is ShellResume<G> =>
  SHELL_RESUME_KINDS.has(offer.kind);

/** The room this device hosts, as the home screen offers it: the host offer, or null. */
const hostOffer = <G extends ShellTypes>(s: ShellState<G>): HostResume<G> | null =>
  s.resume !== null && isShellResume(s.resume) && s.resume.kind === 'host' ? s.resume : null;

/**
 * `resume/auto`'s rule (lobby-resume.md D4): the offer is this device's waiting room (no game),
 * stamped, and opened within WAITING_RESUME_MS of now. A mid-game room, an unstamped save (from
 * before the stamp) and an old lobby wait for their tap.
 */
const resumesItself = <G extends ShellTypes>(offer: HostResume<G>, now: number): boolean =>
  offer.game === null && offer.at !== null && now - offer.at <= WAITING_RESUME_MS;

/** `setHomeTab(tab, opts)`. */
const setHomeTab = <G extends ShellTypes>(
  app: ShellApp<G>,
  tab: string,
  persist: boolean,
  cfg: ShellConfig<G>,
): Step<G> => {
  const known = cfg.tabs.list.find((t) => t === tab) ?? cfg.tabs.default;
  return step(
    withShell(app, { homeTab: known }),
    ...(persist ? [{ type: 'writeHomeTab', tab: known } as const] : []),
  );
};

/**
 * `initHome()` over a storage snapshot: the saved names, or the game's defaults where none is
 * saved (`localNamesOf`, marked `default` so the page clears them on the first tap), go into the
 * name inputs (effects, so the paint never fights the player's typing; the shell's state keeps
 * only what was saved or typed), the game's own part into the App (`cfg.home.apply`), the tab
 * applied without persisting, then the resume offer.
 */
const initHome = <G extends ShellTypes>(
  app: ShellApp<G>,
  home: HomeSnapshot<G>,
  cfg: ShellConfig<G>,
): Step<G> =>
  andThen(showScreen(app, 'homeScreen'), (a) =>
    andThen(
      andThen(
        step(
          cfg.home.apply(
            withShell(a, {
              savedName: home.name,
              p1Name: home.name ?? '',
              p2Name: home.p2Name ?? '',
              nameTouched: home.name !== null ? true : a.shell.nameTouched,
              homeTab: home.homeTab,
              playMode: home.playMode,
              soundFont: home.soundFont,
              recentGames: home.recentGames,
            }),
            home,
          ),
          home.name === null
            ? { type: 'fillName', name: localNameFor(localNamesOf(cfg), 0), default: true }
            : { type: 'fillName', name: home.name },
          home.p2Name === null
            ? { type: 'fillP2Name', name: localNameFor(localNamesOf(cfg), 1), default: true }
            : { type: 'fillP2Name', name: home.p2Name },
        ),
        (b) => setHomeTab(b, home.homeTab, false, cfg),
      ),
      (b) => pure(withShell(b, { resume: cfg.home.resume(home) })),
    ),
  );

/** `#resumeBtn` for each offer; one the shell does not know is the game's (`cfg.home.resumeExtra`). */
const resume = <G extends ShellTypes>(
  app: ShellApp<G>,
  offer: Resume<G>,
  ctx: Ctx,
  cfg: ShellConfig<G>,
): Step<G> => {
  if (!isShellResume(offer)) return cfg.home.resumeExtra(app, offer, ctx);
  switch (offer.kind) {
    case 'local':
      return startLocal(app, offer.game, ctx, cfg);
    case 'host':
      return startHost(
        withSeats(
          withShell(app, {
            myName: offer.myName,
            opts: cfg.opts.pick(offer),
            game: offer.game,
            // A waiting room has no game and no view yet: it reopens as it was, every seat free.
            view: offer.game === null ? null : cfg.engine.viewFor(offer.game, 0),
            // A handoff nobody joined resumes as one, under the code the invite already carries.
            handoff: offer.handoff,
          }),
          // Every seat named as saved and disconnected; each guest lands back in its own by name (D6).
          (offer.seatNames ?? [offer.oppName]).map((name) => ({ name, connected: false })),
        ),
        offer.code,
        ctx,
        cfg,
      );
    case 'guest':
      return startGuest(withShell(app, { myName: offer.myName }), offer.code, cfg);
  }
};

/**
 * `#handoffBtn`: the pass-and-play game goes on as a hosted room with a fresh code. Seat 0 keeps
 * this device as the host; seat 1 joins from its own through the invite, and the host's join
 * handler takes it as a rejoin (the seat is kept, the name refreshed, the game broadcast). The
 * pass-and-play marks (the curtain, the revealed seat, the table's taps) are cleared as a leave
 * clears them.
 */
const handoff = <G extends ShellTypes>(
  app: ShellApp<G>,
  game: G['State'],
  ctx: Ctx,
  cfg: ShellConfig<G>,
): Step<G> => {
  const [host, guest] = cfg.engine.names(game);
  return startHost(
    withSeats(
      {
        shell: {
          ...app.shell,
          myName: host,
          opts: cfg.opts.ofGame(game),
          game,
          view: cfg.engine.viewFor(game, 0),
          revealed: null,
          handoff: true,
          localNames: [],
          localSeats: [],
        },
        table: cfg.table.reset(app.table, 'handoff'),
      },
      [{ name: guest, connected: false }],
    ),
    null,
    ctx,
    cfg,
  );
};

/** `leaveGame()` after the confirm and the network close: the reset (the cue memory too: it belonged to the game left), then home. */
const leaveFinish = <G extends ShellTypes>(app: ShellApp<G>, cfg: ShellConfig<G>): Step<G> =>
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
        cues: cfg.cues.initial,
        recorded: null,
        // No room and no table: the legacy `oppName` lingers until the next room names one.
        seats: [],
        mySeat: 0,
        localNames: [],
        localSeats: [],
      },
      table: cfg.table.reset(app.table, 'leave'),
    },
    { type: 'clearSave' },
    { type: 'initHome' },
  );

/**
 * `#cancelHostBtn` / `#cancelGuestBtn` after the Peer is destroyed. A handed-off game nobody
 * joined goes back to pass-and-play instead of being cleared with the room.
 */
const cancelFinish = <G extends ShellTypes>(app: ShellApp<G>): Step<G> =>
  step(
    withShell(app, { role: null, netAttempt: app.shell.netAttempt + 1, handoff: false, seats: [] }),
    app.shell.handoff && app.shell.game !== null
      ? { type: 'saveLocal', game: app.shell.game }
      : { type: 'clearSave' },
    { type: 'initHome' },
  );

// ---- the reducer -------------------------------------------------------------------------------

/** One shell intent against the App; the game's `reduce` sends every `isShellIntent` here. */
export const reduceShell = <G extends ShellTypes>(
  app: ShellApp<G>,
  intent: ShellIntent<G>,
  ctx: Ctx,
  cfg: ShellConfig<G>,
): Step<G> => {
  const s = app.shell;
  switch (intent.type) {
    // ---- home ----
    case 'home/init':
      return initHome(app, intent.home, cfg);
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
      return setHomeTab(app, intent.tab, intent.persist !== false, cfg);
    case 'rules/show': {
      // On the home screen the Rules tab is the rules; anywhere else (the table, a waiting room,
      // the end screen) the overlay is, and its own copy of the list is the one to scroll.
      const home = s.screen === 'homeScreen';
      const shown = home
        ? setHomeTab(app, 'rules', true, cfg)
        : pure(withShell(app, { rulesOpen: true }));
      return andThen(shown, (a) =>
        step(a, {
          type: 'revealRule',
          slot: home ? 'rulesList' : 'rulesOverlayList',
          rule: intent.rule,
        }),
      );
    }
    case 'mode/set': {
      const parsed = cfg.modes.parse(intent.mode, s);
      if (parsed === null) return pure(app);
      return step(
        withShell(app, { playMode: parsed.shown }),
        ...(parsed.stored === null
          ? []
          : [{ type: 'writePlayMode', mode: parsed.stored } as const]),
      );
    }
    case 'host/click':
      return startHost(
        withSeats(
          withShell(app, {
            myName: nameOr(intent.name, cfg.names.default),
            opts: cfg.opts.parse(intent, s.opts),
            game: null,
            view: null,
          }),
          // A fresh room: no seat named (`startHost` opens the capacity the terms name).
          [],
        ),
        null,
        ctx,
        cfg,
      );
    case 'join/click': {
      const code = validateCode(cfg.id, intent.code);
      if (!code.ok) return step(app, toast(code.error));
      const typed = intent.name.trim();
      const myName = (
        typed !== '' && (s.nameTouched || typed !== cfg.names.default) ? typed : DEFAULT_GUEST_NAME
      ).slice(0, NAME_MAX);
      return startGuest(withShell(app, { myName }), code.value, cfg);
    }
    case 'local/click': {
      const opts = cfg.opts.parse(intent, s.opts);
      const game = cfg.engine.create(
        playersFor<G>(localPlayers(intent.p1, intent.p2, localNamesOf(cfg))),
        opts,
        ctx.rng,
        ctx.now,
      );
      return startLocal(withShell(app, { opts }), game, ctx, cfg);
    }
    case 'resume/click':
      return s.resume === null ? pure(app) : resume(app, s.resume, ctx, cfg);
    case 'resume/auto': {
      if (s.role !== null) return pure(app);
      const own = hostOffer(s);
      return own !== null && resumesItself(own, ctx.now()) ? resume(app, own, ctx, cfg) : pure(app);
    }
    case 'handoff/click': {
      // The home screen's offer, or the game in play on the pass-and-play curtain.
      if (s.role === 'local' && s.game !== null) return handoff(app, s.game, ctx, cfg);
      const offer = s.resume;
      return offer !== null && isShellResume(offer) && offer.kind === 'local'
        ? handoff(app, offer.game, ctx, cfg)
        : pure(app);
    }
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
        : setHomeTab(withShell(app, { submenuOpen: false }), 'play', true, cfg);
    case 'submenu/pick':
      return andThen(reduceShell(app, { type: 'mode/set', mode: intent.mode }, ctx, cfg), (a) =>
        setHomeTab(withShell(a, { submenuOpen: false }), 'play', true, cfg),
      );
    case 'submenu/dismiss':
      return pure(withShell(app, { submenuOpen: false }));
    case 'code/typed': {
      // A keyboard suggestion that swapped earlier letters arrives as a replacement: keep the last good code.
      const value =
        intent.inputType === 'insertReplacementText'
          ? s.codeDraft
          : sanitiseCode(cfg.id, intent.value);
      return step(withShell(app, { codeDraft: value }), { type: 'setCode', value });
    }
    case 'join/link': {
      // The invite link is the tap on `#joinBtn` (the owner, 2026-09-25: "it should immediately act
      // as if you have clicked that already"): the form is filled first, as it was, so a refusal or
      // a cancel leaves the code in the input on the Play tab in online mode (the mode is shown, not
      // stored), then `join/click` with that code and the name the input shows, the remembered one
      // or the game's first default, which the click's rule reads as untouched. A bad code is the
      // click's toast over the filled form; a link followed while seated changes nothing.
      if (s.role !== null) return pure(app);
      const code = sanitiseCode(cfg.id, intent.code);
      // The device's own invite (the owner, 2026-09-25: "when a host device clicks the JOIN code
      // it should resume hosting"): the room it hosts, waiting or mid-game, comes back as the
      // Resume tap would bring it, and nobody joins.
      const own = hostOffer(s);
      if (own !== null && own.code === code) return resume(app, own, ctx, cfg);
      const name = s.p1Name === '' ? localNameFor(localNamesOf(cfg), 0) : s.p1Name;
      return andThen(
        andThen(
          setHomeTab(withShell(app, { playMode: 'online', codeDraft: code }), 'play', false, cfg),
          (a) => step(a, { type: 'setCode', value: code }),
        ),
        (a) => reduceShell(a, { type: 'join/click', name, code }, ctx, cfg),
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
      return startHost(app, intent.code, ctx, cfg);
    case 'host/status':
      return pure(withHostStatus(app, intent.text, intent.stopPulse));
    case 'host/frame':
      return hostFrame(app, intent.frame, intent.seat ?? 1, ctx, cfg);
    case 'host/guestGone': {
      // The seat's channel is down; its name is kept for the rejoin (the lobby's leave empties it below).
      const seat = intent.seat ?? 1;
      const seats = seatsOf(s, cfg);
      const gone = withSeats(
        app,
        seatAt(seats, seat, { name: seats[seat - 1]?.name ?? null, connected: false }),
      );
      return intent.iceFailed === null
        ? guestGone(gone, seat, ctx, cfg)
        : pure(withHostStatus(gone, intent.iceFailed));
    }
    case 'host/deal': {
      const seated = seatedCount(seatsOf(s, cfg));
      if (seated < minSeated(cfg))
        return step(
          app,
          toast(
            cfg.copy.notEnough === undefined
              ? WAITING_FOR_GUEST_MSG
              : cfg.copy.notEnough(seated, minSeated(cfg)),
          ),
        );
      // The host, then every guest seat in order (`guest`, `guest2`, `guest3`: seat 1 keeps the
      // two-seat id). A connected seat has a name; the fallback only satisfies the type (a seat
      // left empty at a flexible table is dealt to under it: seats are not compacted, D2).
      const players: ReadonlyArray<Player> = [
        { id: 'host', name: s.myName },
        ...seatsOf(s, cfg).map((seat, i) => ({
          id: i === 0 ? 'guest' : `guest${String(i + 1)}`,
          name: seat.name ?? DEFAULT_GUEST_NAME,
        })),
      ];
      const game = cfg.engine.create(playersFor<G>(players), s.opts, ctx.rng, ctx.now);
      return broadcast(
        { shell: { ...s, game }, table: cfg.table.reset(app.table, 'deal') },
        ctx,
        cfg,
      );
    }
    // ---- net: guest ----
    case 'guest/start':
      return startGuest(app, intent.code, cfg);
    case 'guest/status':
      return pure(withGuestStatus(app, intent.text, intent.stopPulse));
    case 'guest/connected':
      return pure(withShell(app, { oppConnected: true }));
    case 'guest/frame':
      return guestFrame(app, intent.frame, ctx, cfg);
    case 'guest/lost': {
      const lost: ShellApp<G> = {
        shell: { ...s, oppConnected: false },
        table: cfg.table.reset(app.table, 'lost'),
      };
      const v = lost.shell.view;
      if (v !== null && !cfg.engine.over(v))
        return andThen(painted(lost, v, ctx, cfg), (a) =>
          step(a, toast(LOST_HOST_MSG, GONE_TOAST_MS)),
        );
      return showScreen(withGuestStatus(lost, DISCONNECTED_MSG), 'guestWaitScreen');
    }
    // ---- the curtain, the leave flow, the paint ----
    case 'curtain/reveal': {
      const game = s.game;
      if (game === null) return pure(app);
      const { seat, effects } = cfg.local.revealer(game);
      return andThen(
        step(
          { shell: { ...s, revealed: seat }, table: { ...app.table, curtain: null } },
          tap,
          ...effects,
        ),
        (a) => localBroadcast(a, true, ctx, cfg),
      );
    }
    case 'position/load':
      return loadPosition(app, intent.state, ctx, cfg);
    case 'leave/request':
      return step(app, {
        type: 'confirm',
        message: s.role === 'local' ? cfg.copy.leaveLocal : cfg.copy.leaveOnline,
        then: { type: 'leave/confirmed' },
      });
    case 'leave/confirmed':
      // The network closes before the reset (see the header), then `leave/finish` resets.
      return step(
        app,
        { type: 'wakeLock', hold: false },
        { type: 'closeNet' },
        { type: 'then', intent: { type: 'leave/finish' } },
      );
    case 'leave/finish':
      return leaveFinish(app, cfg);
    case 'visible':
      return s.role === null ? pure(app) : step(app, { type: 'wakeLock', hold: true });
    case 'render':
      return painted(app, s.view, ctx, cfg);
    case 'persist':
      return step(app, { type: 'persist' });
  }
};

// ---- the initial shell, storage and what the sessions read back ---------------------------------

/** The legacy `app` literal plus the DOM state, on the home screen. */
export const initialShell = <G extends ShellTypes>(cfg: ShellConfig<G>): ShellState<G> => ({
  role: null,
  code: null,
  myName: cfg.names.default,
  opts: cfg.opts.initial,
  game: null,
  view: null,
  oppName: null,
  oppConnected: false,
  seats: [],
  mySeat: 0,
  localNames: [],
  localSeats: [],
  nameTouched: false,
  revealed: null,
  homeTab: cfg.tabs.default,
  playMode: cfg.modes.default,
  p1Name: '',
  p2Name: '',
  screen: 'homeScreen',
  netAttempt: 0,
  hostStatus: { text: cfg.copy.opening, pulse: true },
  guestStatus: { text: CONNECTING_MSG, pulse: true },
  startGameVisible: false,
  handoff: false,
  savedName: null,
  resume: null,
  openedAt: null,
  rulesOpen: false,
  cues: cfg.cues.initial,
  submenuOpen: false,
  longPressed: false,
  codeDraft: '',
  soundFont: DEFAULT_SOUND_FONT,
  recentGames: [],
  recorded: null,
});

/** `persist()`: the save for the current role, or null when there is nothing to save. */
export const saveFor = <G extends ShellTypes>(s: ShellState<G>): Save<G> | null => {
  switch (s.role) {
    case 'local':
      return s.game === null ? null : { role: 'local', game: s.game };
    case 'host':
      return {
        role: 'host',
        code: s.code ?? '',
        myName: s.myName,
        ...s.opts,
        game: s.game,
        oppName: s.oppName,
        // The seat names ride only for a room of more than two seats (D6's rejoin key per seat); a two-seat save is the legacy literal.
        ...(s.seats.length > 1 ? { seatNames: s.seats.map((seat) => seat.name) } : {}),
        ...(s.handoff ? { handoff: true } : {}),
        // The stamp rides only on the waiting room (lobby-resume.md D1): a game's save is the legacy literal.
        ...(s.game === null && s.openedAt !== null ? { at: s.openedAt } : {}),
      };
    case 'guest':
      return { role: 'guest', code: s.code ?? '', myName: s.myName };
    case null:
      return null;
  }
};

/** `initHome`'s reads: the names, the tab and mode (defaults when unreadable), the font, the save, the finished games, and the game's own keys. */
export const readHome = <G extends ShellTypes>(
  store: G['Store'],
  cfg: ShellConfig<G>,
): HomeSnapshot<G> => {
  const name = cfg.prefs.name.read(store);
  const p2Name = cfg.prefs.p2Name.read(store);
  const tab = cfg.prefs.homeTab.read(store);
  const mode = cfg.prefs.playMode.read(store);
  const font = cfg.prefs.soundFont.read(store);
  const save = cfg.prefs.save.readSave(store);
  return {
    name: name.ok ? name.value : null,
    p2Name: p2Name.ok ? p2Name.value : null,
    homeTab: tab.ok ? tab.value : cfg.tabs.default,
    playMode: mode.ok ? mode.value : cfg.modes.default,
    soundFont: font.ok ? font.value : DEFAULT_SOUND_FONT,
    save: save.ok ? save.value : null,
    recentGames: cfg.prefs.recentGames.read(store),
    ...cfg.home.read(store),
  };
};

/** What the host session reads back (web/shared/net/host.ts `HostContext<X>`, `X` the room's terms). */
export type HostContextOf<G extends ShellTypes> = Readonly<{
  attempt: number;
  role: Role | null;
  code: string | null;
  myName: string;
  hasGame: boolean;
  handoff: boolean;
  oppName: string | null;
  oppConnected: boolean;
}> &
  G['Opts'];
export type GuestContextOf = Readonly<{
  attempt: number;
  role: Role | null;
  code: string | null;
  myName: string;
  oppConnected: boolean;
}>;

export const hostContextOf = <G extends ShellTypes>(s: ShellState<G>): HostContextOf<G> => ({
  attempt: s.netAttempt,
  role: s.role,
  code: s.code,
  myName: s.myName,
  ...s.opts,
  hasGame: s.game !== null,
  handoff: s.handoff,
  oppName: s.oppName,
  oppConnected: s.oppConnected,
});

export const guestContextOf = <G extends ShellTypes>(s: ShellState<G>): GuestContextOf => ({
  attempt: s.netAttempt,
  role: s.role,
  code: s.code,
  myName: s.myName,
  oppConnected: s.oppConnected,
});
