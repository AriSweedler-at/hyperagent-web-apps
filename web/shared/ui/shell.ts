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
  NAME_MAX,
  guestNameFor,
  type GuestFrame,
  type HostFrame,
} from '../lib/protocol.ts';
import { formatError, type Decoder } from '../lib/json.ts';
import type { Result } from '../lib/result.ts';
import type { Rng } from '../lib/rng.ts';
import { randomCode, sanitiseCode, validateCode, type Game } from '../lib/roomCode.ts';
import { DEFAULT_SOUND_FONT, type SoundFontName } from '../lib/sound/fonts.ts';
import type { Phrase } from '../lib/sound/phrase.ts';
import type { RulesSlot } from './glossary.ts';

// ---- the game's types, in one bag --------------------------------------------------------------

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
  /** The table slice; the shell reads and writes only its pass-and-play `curtain` (agreed in C1). */
  Table: Readonly<{ curtain: Seat | null }>;
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
}>;

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
export type HostFrameOf<G extends ShellTypes> = HostFrame<G['View'], G['Opts']>;
export type GuestFrameOf<G extends ShellTypes> = GuestFrame<G['Action']>;

/** `#hostWaitStatus` / `#guestWaitStatus`: the text and whether it still pulses. */
export type WaitStatus = Readonly<{ text: string; pulse: boolean }>;

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
    /** Written only when true (the shell's `handoff`), so every other host save keeps the legacy literal. */
    handoff?: true;
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
    game: G['State'];
    oppName: string | null;
    /** The save's `handoff` mark: the offer reads as the handoff, and the room resumes as one. */
    handoff: boolean;
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
  nameTouched: boolean;
  /** Pass-and-play: the seat that lifted the curtain this turn. */
  revealed: Seat | null;
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
  /** `?join=<code>` at boot (an invite link): the code into `#codeInput`, the Play tab, online mode. */
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
  | Readonly<{ type: 'host/frame'; frame: GuestFrameOf<G> }>
  | Readonly<{ type: 'host/guestGone'; iceFailed: string | null }>
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
 * The shell's half of a game's `Intent` union: 44 types, backgammon's 38 less its two option
 * selects (`variant/set`, `matchLength/set`, its own) plus the seven both games kept on the table
 * side after C1 (the curtain reveal, the leave flow, `visible`, `render`, `persist`), plus
 * `position/load`, backgammon's `sandbox/load` generalised (dry-round-2.md F5).
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
  /** Scroll `rule` into view inside the rules `slot` that is on screen and flash it (web/shared/edge/glossary.ts). */
  | Readonly<{ type: 'revealRule'; slot: RulesSlot; rule: string }>
  /** `ms` null is the default duration. */
  | Readonly<{ type: 'toast'; message: string; ms: number | null }>
  /** To the current session's channel, if open. */
  | Readonly<{ type: 'send'; frame: HostFrameOf<G> | GuestFrameOf<G> }>
  | Readonly<{ type: 'fx'; cue: Cue<G> }>
  /**
   * Phrases the game's event binding chose (web/shared/ui/eventEffects.ts, sound-history.md
   * §3.5): played back to back in the App's font with one buzz, so a trick and the result it
   * ends the game with never sound under each other.
   */
  | Readonly<{ type: 'phrases'; phrases: ReadonlyArray<Phrase> }>
  | Readonly<{ type: 'wakeLock'; hold: boolean }>
  | Readonly<{ type: 'startHost'; code: string; attempt: number; resume: boolean }>
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
  /** The first player's name into every input that shows it (`initHome`, and after a keystroke). */
  | Readonly<{ type: 'fillName'; name: string }>
  /** The second player's name into every input that shows it. */
  | Readonly<{ type: 'fillP2Name'; name: string }>
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
export type Ctx = Readonly<{ rng: Rng; now: () => number }>;

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

/** The shell's readers and writers the game builds over its keys (prefs.ts `shellStore`). */
export type ShellPrefs<G extends ShellTypes> = Readonly<{
  name: Pref<G['Store'], string>;
  p2Name: Pref<G['Store'], string>;
  homeTab: Pref<G['Store'], Tab<G>>;
  playMode: Pref<G['Store'], PlayMode>;
  soundFont: Pref<G['Store'], SoundFontName>;
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
    /** The guest's status once the host's welcome or lobby frame names the room (gin names the target). */
    hostRoom: (hostName: string, opts: G['Opts']) => string;
  }>;
  opts: Readonly<{
    initial: G['Opts'];
    /** The raw select/input values off `host/click`/`local/click`; `current` is the shell's for a missing value. */
    parse: (raw: G['Raw'], current: G['Opts']) => G['Opts'];
    /** The terms a game was made under, for the handoff. */
    ofGame: (game: G['State']) => G['Opts'];
    /** The option fields alone off a record that carries them (a welcome frame, a resume offer), in the literal's order. */
    pick: (from: G['Opts']) => G['Opts'];
  }>;
  engine: Readonly<{
    create: (
      players: Readonly<[Player, Player]>,
      opts: G['Opts'],
      rng: Rng,
      now: () => number,
    ) => G['State'];
    apply: (
      game: G['State'],
      seat: Seat,
      action: G['Action'],
      rng: Rng,
      now: () => number,
    ) => Result<G['State'], string>;
    viewFor: (game: G['State'], seat: Seat) => G['View'];
    /** The view shows the game over: nothing to rejoin, nobody to toast for. */
    over: (view: G['View']) => boolean;
    /** The saved game is over: not offered to resume. */
    finished: (game: G['State']) => boolean;
    /** The two seats' names, for the handoff (seat 0 hosts, seat 1 joins). */
    names: (game: G['State']) => Readonly<[string, string]>;
    /** `game.players[1].name = name` on a rejoin. */
    renameGuest: (game: G['State'], name: string) => G['State'];
    /** The engine state off `position/load`'s hand-made object (the save's decoder); its error names the path. */
    decodeState: Decoder<G['State']>;
  }>;
  /** The game's protocol.ts builders the shell sends. */
  frames: Readonly<{
    lobby: (hostName: string, opts: G['Opts']) => HostFrameOf<G>;
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
    ) => Readonly<{ seat: Seat; curtain: Seat | null; effects: ReadonlyArray<Effect<G>> }>;
    /** `curtain/reveal`: the seat that lifts the curtain and what it is told (backgammon's hits against it). */
    revealer: (game: G['State']) => Readonly<{ seat: Seat; effects: ReadonlyArray<Effect<G>> }>;
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
 * spelled as the proper names). The first is also the online name input's markup default (each
 * game's shellConfig.ts DEFAULT_NAME, pinned there), since `fillName` reaches that input too and
 * must find the name it already shows. A game with more seats keeps `Player N` from the third on.
 */
export const DEFAULT_LOCAL_NAMES: readonly [string, string] = ['Ari', 'Lavi'];

/** Two players from the pass-and-play inputs: the defaults, and " 2" on a clash (gin's sandbox deals them too). */
export const localPlayers = (p1raw: string, p2raw: string): Readonly<[Player, Player]> => {
  const p1 = nameOr(p1raw, DEFAULT_LOCAL_NAMES[0]);
  const p2 = nameOr(p2raw, DEFAULT_LOCAL_NAMES[1]);
  return [
    { id: 'p1', name: p1 },
    { id: 'p2', name: p2.toLowerCase() === p1.toLowerCase() ? `${p2} 2` : p2 },
  ];
};

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

// ---- flows -------------------------------------------------------------------------------------

/** `broadcast()`: my view, the guest's view on the wire, the table's per-view reset, saved, rendered. */
export const broadcast = <G extends ShellTypes>(
  app: ShellApp<G>,
  ctx: Ctx,
  cfg: ShellConfig<G>,
): Step<G> => {
  const game = app.shell.game;
  if (game === null) return pure(app);
  return andThen(
    step(
      {
        shell: { ...app.shell, view: cfg.engine.viewFor(game, 0) },
        table: cfg.table.reset(app.table, 'view'),
      },
      { type: 'send', frame: cfg.frames.state(cfg.engine.viewFor(game, 1)) },
      { type: 'persist' },
    ),
    (a) => cfg.table.rendered(a, app.shell.view, ctx),
  );
};

/** `dispatch(seat, action)`, host only: apply, or refuse to the mover (a toast frame to the guest); then broadcast. */
export const hostDispatch = <G extends ShellTypes>(
  app: ShellApp<G>,
  seat: Seat,
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
      : step(app, { type: 'send', frame: cfg.frames.toast(res.error) });
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
    (a) => cfg.table.rendered(a, prev, ctx),
  );
};

/** The shell seated for pass-and-play with `game` and the table reset for it: what `startLocal` broadcasts (gin's sandbox seats its hand-made melds in between). */
export const localSeated = <G extends ShellTypes>(
  app: ShellApp<G>,
  game: G['State'],
  cfg: ShellConfig<G>,
): ShellApp<G> => ({
  shell: { ...app.shell, role: 'local', code: null, oppConnected: true, game, revealed: null },
  table: cfg.table.reset(app.table, 'startLocal'),
});

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
  return andThen(
    showScreen(
      withHostStatus(
        withShell(app, { role: 'host', code, netAttempt: attempt, startGameVisible: false }),
        cfg.copy.opening,
      ),
      'hostWaitScreen',
    ),
    (a) => step(a, { type: 'startHost', code, attempt, resume: resumeCode !== null }),
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
        withShell(app, { role: 'guest', code, netAttempt: attempt }),
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
  ctx: Ctx,
  cfg: ShellConfig<G>,
): Step<G> => {
  const s = app.shell;
  if (s.handoff) return pure(withHostStatus(app, cfg.copy.handoff(s.code ?? '', s.oppName)));
  if (s.game !== null && s.view !== null && !cfg.engine.over(s.view))
    return andThen(cfg.table.rendered(app, s.view, ctx), (a) =>
      step(a, toast(guestGoneMsg(a.shell.oppName, a.shell.code), GONE_TOAST_MS)),
    );
  if (s.game === null)
    return pure(withShell(withHostStatus(app, OPPONENT_LEFT_MSG), { startGameVisible: false }));
  return pure(app);
};

/** `onGuestMsg(conn, msg)` for a decoded frame. */
const hostFrame = <G extends ShellTypes>(
  app: ShellApp<G>,
  frame: GuestFrameOf<G>,
  ctx: Ctx,
  cfg: ShellConfig<G>,
): Step<G> => {
  const s = app.shell;
  switch (frame.t) {
    case 'join': {
      const name = guestNameFor(frame.name, s.myName);
      const connected = withShell(app, { oppConnected: true, oppName: name, handoff: false });
      if (s.game !== null) {
        // Rejoin: keep the seat, refresh the name.
        return broadcast(
          withShell(connected, { game: cfg.engine.renameGuest(s.game, name) }),
          ctx,
          cfg,
        );
      }
      return step(
        withShell(withHostStatus(connected, joinedMsg(name)), { startGameVisible: true }),
        { type: 'send', frame: cfg.frames.lobby(s.myName, s.opts) },
      );
    }
    case 'action':
      return s.game === null ? pure(app) : hostDispatch(app, 1, frame.action, ctx, cfg);
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
      return pure(
        withGuestStatus(
          withShell(app, { oppName: frame.hostName, opts }),
          cfg.copy.hostRoom(frame.hostName, opts),
        ),
      );
    }
    case 'full':
      return pure(withGuestStatus(app, ROOM_FULL_MSG));
    case 'toast':
      // The host refused the guest's move.
      return cfg.table.refuse(app, frame.msg);
    case 'state':
      return cfg.table.rendered(
        {
          shell: { ...app.shell, view: frame.view, oppConnected: true },
          table: cfg.table.reset(app.table, 'frame'),
        },
        app.shell.view,
        ctx,
      );
  }
};

// ---- home, resume, leave ---------------------------------------------------------------------

/** The resume box `initHome` shows for a save, or null (a finished game is not offered); the game's own offers come first through `cfg.home.resume`. */
export const resumeFor = <G extends ShellTypes>(
  save: Save<G> | null,
  cfg: ShellConfig<G>,
): ShellResume<G> | null => {
  if (save === null) return null;
  switch (save.role) {
    case 'local':
      return cfg.engine.finished(save.game) ? null : { kind: 'local', game: save.game };
    case 'host':
      return save.game !== null && !cfg.engine.finished(save.game)
        ? {
            kind: 'host',
            code: save.code,
            myName: save.myName,
            ...cfg.opts.pick(save),
            game: save.game,
            oppName: save.oppName,
            handoff: save.handoff === true,
          }
        : null;
    case 'guest':
      return { kind: 'guest', code: save.code, myName: save.myName };
  }
};

const SHELL_RESUME_KINDS: ReadonlySet<string> = new Set(['local', 'host', 'guest']);
const isShellResume = <G extends ShellTypes>(offer: Resume<G>): offer is ShellResume<G> =>
  SHELL_RESUME_KINDS.has(offer.kind);

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
 * `initHome()` over a storage snapshot: the saved names, or the defaults where none is saved, go
 * into the name inputs (effects, so the paint never fights the player's typing; the shell's state
 * keeps only what was saved or typed), the game's own part into the App (`cfg.home.apply`), the
 * tab applied without persisting, then the resume offer.
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
            }),
            home,
          ),
          { type: 'fillName', name: home.name ?? DEFAULT_LOCAL_NAMES[0] },
          { type: 'fillP2Name', name: home.p2Name ?? DEFAULT_LOCAL_NAMES[1] },
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
        withShell(app, {
          myName: offer.myName,
          opts: cfg.opts.pick(offer),
          game: offer.game,
          oppName: offer.oppName,
          view: cfg.engine.viewFor(offer.game, 0),
          // A handoff nobody joined resumes as one, under the code the invite already carries.
          handoff: offer.handoff,
        }),
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
    {
      shell: {
        ...app.shell,
        myName: host,
        opts: cfg.opts.ofGame(game),
        game,
        oppName: guest,
        oppConnected: false,
        view: cfg.engine.viewFor(game, 0),
        revealed: null,
        handoff: true,
      },
      table: cfg.table.reset(app.table, 'handoff'),
    },
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
    withShell(app, { role: null, netAttempt: app.shell.netAttempt + 1, handoff: false }),
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
        withShell(app, {
          myName: nameOr(intent.name, cfg.names.default),
          opts: cfg.opts.parse(intent, s.opts),
          game: null,
          view: null,
          oppName: null,
          oppConnected: false,
        }),
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
      const game = cfg.engine.create(localPlayers(intent.p1, intent.p2), opts, ctx.rng, ctx.now);
      return startLocal(withShell(app, { opts }), game, ctx, cfg);
    }
    case 'resume/click':
      return s.resume === null ? pure(app) : resume(app, s.resume, ctx, cfg);
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
      // The invite link: the code is in the form; the mode is shown, not stored.
      const code = sanitiseCode(cfg.id, intent.code);
      return andThen(
        setHomeTab(withShell(app, { playMode: 'online', codeDraft: code }), 'play', false, cfg),
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
      return startHost(app, intent.code, ctx, cfg);
    case 'host/status':
      return pure(withHostStatus(app, intent.text, intent.stopPulse));
    case 'host/frame':
      return hostFrame(app, intent.frame, ctx, cfg);
    case 'host/guestGone': {
      const gone = withShell(app, { oppConnected: false });
      return intent.iceFailed === null
        ? guestGone(gone, ctx, cfg)
        : pure(withHostStatus(gone, intent.iceFailed));
    }
    case 'host/deal': {
      if (!s.oppConnected) return step(app, toast(WAITING_FOR_GUEST_MSG));
      const game = cfg.engine.create(
        [
          { id: 'host', name: s.myName },
          // A connected opponent has a name; the fallback only satisfies the type.
          { id: 'guest', name: s.oppName ?? DEFAULT_GUEST_NAME },
        ],
        s.opts,
        ctx.rng,
        ctx.now,
      );
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
        return andThen(cfg.table.rendered(lost, v, ctx), (a) =>
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
      return cfg.table.rendered(app, s.view, ctx);
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
  rulesOpen: false,
  cues: cfg.cues.initial,
  submenuOpen: false,
  longPressed: false,
  codeDraft: '',
  soundFont: DEFAULT_SOUND_FONT,
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
        ...(s.handoff ? { handoff: true } : {}),
      };
    case 'guest':
      return { role: 'guest', code: s.code ?? '', myName: s.myName };
    case null:
      return null;
  }
};

/** `initHome`'s reads: the names, the tab and mode (defaults when unreadable), the font, the save, and the game's own keys. */
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
