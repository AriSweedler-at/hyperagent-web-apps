// The gin app as a reducer over intents (docs/MIGRATION.md step 12; docs/ARCHITECTURE.md "Module
// boundaries": imported only by main.ts and tests). The legacy multiplayer UI
// (legacy/gin-rummy/index.html) kept one mutable `app` object, wrote the DOM from a hundred
// places and called the network from its handlers. Here `App` is that object as an immutable
// record, plus what the legacy kept in the DOM or in closures (the screen shown, the two waiting
// statuses, the netAttempt ticket, the curtain, the cue machine's memory), `Intent` is every
// handler and every network event, and `reduce` returns the next App with a list of `Effect`s:
// what to persist, toast, send, play or open, as data. main.ts runs the effects through the real
// adapters (`runEffect`) and paints the App (ui/render.ts); the tests run the reducer alone.
// `persist`/`saveFor` and `readHome` are the legacy `persist()`/`loadSaved()`/`initHome` reads,
// through storage.ts, producing the same `ginRummyMP_v1` bytes as the captured fixtures
// (test/parity/gin.state.test.ts).
//
// Phase 2 adds what the legacy kept in the DOM or in handler closures for the paint and the
// wiring: the rules and history overlays, the Play tab's long-press submenu (its timer is an
// effect main.ts arms), the code input's last good value, and the two input writes `initHome`
// and the code handler made (effects, so the paint never fights the player's typing).
//
// Two legacy traits kept on purpose: the reducer runs `render()`'s state effects wherever the
// legacy called `render()` (the cue machine steps, the screen flips to the table, a selection no
// longer in hand is dropped), and a leave closes the network before the state is reset, so the
// session's own close still raises the "disconnected" toast the legacy raised.
import { randomCode, sanitiseCode, validateCode } from '../../../../shared/lib/roomCode.ts';
import type { Rng } from '../../../../shared/lib/rng.ts';
import { applyAction, createGame, viewFor } from '../engine/index.ts';
import type { Action, Now, Seat, State, View } from '../engine/types.ts';
import type { GuestContext } from '../net/guest.ts';
import { connectingMsg } from '../net/guest.ts';
import type { HostContext } from '../net/host.ts';
import { OPENING_MSG } from '../net/host.ts';
import {
  DEFAULT_GUEST_NAME,
  action as actionFrame,
  guestNameFor,
  lobby as lobbyFrame,
  state as stateFrame,
  toast as toastFrame,
  type GuestFrame,
  type HostFrame,
} from '../protocol.ts';
import type { ScorerState } from '../scorer/scores.ts';
import {
  DEFAULT_HOME_TAB,
  DEFAULT_PLAY_MODE,
  HOME_TABS,
  NAME_MAX,
  clearSave,
  readHomeTab,
  readName,
  readP2Name,
  readPlayMode,
  readSave,
  readScorerState,
  writeHomeTab,
  writeName,
  writeP2Name,
  writePlayMode,
  writeSave,
  type HomeTab,
  type PlayMode,
  type Save,
  type Store,
} from '../storage.ts';
import { INITIAL_CUES, nextCue, selectionIn, type Cue, type CueState } from './cues.ts';
import { drawSource, holdOf, settleDraw, type DrawStage } from './hand/draw.ts';

// ---- the state ---------------------------------------------------------------------------------

// ui/home.ts paints the tabs from the same list storage.ts decodes; ui/ may not import storage.ts.
export { HOME_TABS, type HomeTab };

export type Role = 'host' | 'guest' | 'local';

/** The seven top-level screens `showScreen` toggled between. */
export const SCREENS = [
  'homeScreen',
  'hostWaitScreen',
  'guestWaitScreen',
  'tableScreen',
  'endgameScreen',
  'scGameScreen',
  'scEndScreen',
] as const;
export type ScreenId = (typeof SCREENS)[number];

/** `#hostWaitStatus` / `#guestWaitStatus`: the text and whether it still pulses. */
export type WaitStatus = Readonly<{ text: string; pulse: boolean }>;

/** What the home screen's resume box offers (`initHome`), in the legacy's order of precedence. */
export type Resume =
  | Readonly<{ kind: 'scorer'; state: ScorerState }>
  | Readonly<{ kind: 'local'; game: State }>
  | Readonly<{
      kind: 'host';
      code: string;
      myName: string;
      target: number;
      game: State;
      oppName: string | null;
    }>
  | Readonly<{ kind: 'guest'; code: string; myName: string }>;

export type App = Readonly<{
  // ---- the legacy `app` object, field for field ----
  role: Role | null;
  code: string | null;
  myName: string;
  target: number;
  /** The engine state: host and pass-and-play only. */
  game: State | null;
  /** My redacted view: every role. */
  view: View | null;
  oppName: string | null;
  oppConnected: boolean;
  selectedCard: string | null;
  /** Set by the legacy, never read; kept so the hook's `app` has the same members. */
  hostSeated: boolean;
  nameTouched: boolean;
  /** Pass-and-play: the seat that tapped "show my cards" this turn. */
  revealed: Seat | null;
  homeTab: HomeTab;
  playMode: PlayMode;
  /** The round-result sheet was put away with "Look at the table". */
  resultDismissed: boolean;
  // ---- what the legacy kept in the DOM or in closures ----
  screen: ScreenId;
  /** The `netAttempt` ticket: bumped by every start, cancel and leave. */
  netAttempt: number;
  hostStatus: WaitStatus;
  guestStatus: WaitStatus;
  /** `#startGameBtn` shown (a guest is in the lobby). */
  startGameVisible: boolean;
  /** `#curtainOverlay`: the seat the phone is handed to, or null when hidden. */
  curtain: Seat | null;
  /** `#meldOverlay` open. */
  meldChooser: boolean;
  /** `playCuesFor`'s memory. */
  cues: CueState;
  /** `ginRummy_name`, as `initHome` put it in the inputs. */
  savedName: string | null;
  resume: Resume | null;
  /** `#rulesOverlay` open. */
  rulesOpen: boolean;
  /**
   * `#historyOverlay` open, and whose list it shows: the game's (painted from the view) or the
   * Score Counter's (scorer/main.ts writes the list itself).
   */
  history: 'game' | 'scorer' | null;
  /** `#playSubmenu` held open by a long press on the Play tab (`force-open`). */
  submenuOpen: boolean;
  /** A long press just opened the submenu, so the click that follows must not switch tabs. */
  longPressed: boolean;
  /** `#codeInput` as last sanitised (the legacy `lastGoodCode`). */
  codeDraft: string;
  /**
   * The ghost draw slot (docs/design/gin-draw-ghost-slot.md §3): the held ten-card picture and
   * whether the drawn card is awaited or shown. Not saved, not on the wire.
   */
  draw: DrawStage | null;
}>;

export const DEFAULT_NAME = 'Ari';
export const DEFAULT_TARGET = 100;

export const initialApp: App = {
  role: null,
  code: null,
  myName: DEFAULT_NAME,
  target: DEFAULT_TARGET,
  game: null,
  view: null,
  oppName: null,
  oppConnected: false,
  selectedCard: null,
  hostSeated: false,
  nameTouched: false,
  revealed: null,
  homeTab: DEFAULT_HOME_TAB,
  playMode: DEFAULT_PLAY_MODE,
  resultDismissed: false,
  screen: 'homeScreen',
  netAttempt: 0,
  hostStatus: { text: OPENING_MSG, pulse: true },
  guestStatus: { text: 'Connecting…', pulse: true },
  startGameVisible: false,
  curtain: null,
  meldChooser: false,
  cues: INITIAL_CUES,
  savedName: null,
  resume: null,
  rulesOpen: false,
  history: null,
  submenuOpen: false,
  longPressed: false,
  codeDraft: '',
  draw: null,
};

/** The Play tab opens its submenu after this long a press. */
export const LONG_PRESS_MS = 450;
export const INVITE_COPIED_MSG = 'Invite copied to clipboard';
export const roomCodeMsg = (code: string): string => `Room code: ${code}`;
/** `shareCodeBtn`'s fallback toast lasts this long. */
export const SHARE_FALLBACK_MS = 4000;

// ---- the strings the app (not the sessions) wrote --------------------------------------------

export const NOT_CONNECTED_MSG = 'Not connected to the host.';
export const WAITING_FOR_GUEST_MSG = 'Waiting for your opponent to join.';
export const OPPONENT_LEFT_MSG = 'Opponent left. Waiting for someone to join…';
export const ROOM_FULL_MSG = 'That room already has two players.';
export const LOST_HOST_MSG = 'Lost connection to the host — reconnecting…';
export const DISCONNECTED_MSG = 'Disconnected from the host — reconnecting…';
export const FORCE_STOCK_MSG = 'Both players passed — you must draw from the stock.';
export const LOCKED_CARD_MSG = "You can't discard the card you just took from the discard pile.";
export const ONE_WAY_MSG = 'This hand can only be melded one way.';
export const LEAVE_LOCAL_MSG = 'End this game? Scores will be cleared.';
export const LEAVE_ONLINE_MSG = 'Leave this game? The room will close.';
export const joinedMsg = (name: string): string => `${name} joined! Ready when you are.`;
export const hostRoomMsg = (hostName: string, target: number): string =>
  `Connected to ${hostName}'s room (playing to ${String(target)}). Waiting for the host to start…`;
export const guestGoneMsg = (oppName: string | null, code: string | null): string =>
  `${oppName ?? 'Opponent'} disconnected — they can rejoin with code ${String(code)}.`;
/** `onGuestGone`'s toast lasts this long, as does `LOST_HOST_MSG`. */
export const GONE_TOAST_MS = 4000;

// ---- intents -----------------------------------------------------------------------------------

/** What the legacy `initHome` read from storage, in one snapshot (`readHome`). */
export type HomeSnapshot = Readonly<{
  name: string | null;
  /** The pass-and-play second name: this page's own key, so a legacy session has none. */
  p2Name: string | null;
  homeTab: HomeTab;
  playMode: PlayMode;
  save: Save | null;
  scorer: ScorerState | null;
}>;

export type Intent =
  // ---- home ----
  | Readonly<{ type: 'home/init'; home: HomeSnapshot }>
  | Readonly<{ type: 'name/typed'; value: string }>
  | Readonly<{ type: 'p1name/typed'; value: string }>
  | Readonly<{ type: 'p2name/typed'; value: string }>
  /** `setHomeTab(tab, { persist })`: an unknown tab is `play`. */
  | Readonly<{ type: 'tab/set'; tab: string; persist?: boolean }>
  /** `setPlayMode(mode)`: anything but `local` is `online`. */
  | Readonly<{ type: 'mode/set'; mode: string }>
  /** `#hostBtn`: the raw input values. */
  | Readonly<{ type: 'host/click'; name: string; target: string }>
  /** `#joinBtn`: the raw input values. */
  | Readonly<{ type: 'join/click'; name: string; code: string }>
  /** `#localBtn`: the raw input values. */
  | Readonly<{ type: 'local/click'; p1: string; p2: string; target: string }>
  /** `#resumeBtn`: whatever `app.resume` offers. */
  | Readonly<{ type: 'resume/click' }>
  /** `#cancelHostBtn` / `#cancelGuestBtn`. */
  | Readonly<{ type: 'cancel' }>
  | Readonly<{ type: 'cancel/finish' }>
  /** The hook's `showScreen(id)` (the scorer screens use it). */
  | Readonly<{ type: 'screen/show'; screen: ScreenId }>
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
  /** `#soundBtn`. */
  | Readonly<{ type: 'sound/toggle' }>
  /** `#shareCodeBtn`. */
  | Readonly<{ type: 'share/click' }>
  | Readonly<{ type: 'rules/open' }>
  | Readonly<{ type: 'rules/close' }>
  | Readonly<{ type: 'history/open'; who: 'game' | 'scorer' }>
  | Readonly<{ type: 'history/close' }>
  // ---- net: host ----
  /** `startHost(resumeCode)`: null draws a fresh code. */
  | Readonly<{ type: 'host/start'; code: string | null }>
  | Readonly<{ type: 'host/status'; text: string; stopPulse: boolean }>
  | Readonly<{ type: 'host/frame'; frame: GuestFrame }>
  | Readonly<{ type: 'host/guestGone'; iceFailed: string | null }>
  /** `#startGameBtn`. */
  | Readonly<{ type: 'host/deal' }>
  // ---- net: guest ----
  | Readonly<{ type: 'guest/start'; code: string }>
  | Readonly<{ type: 'guest/status'; text: string; stopPulse: boolean }>
  | Readonly<{ type: 'guest/connected' }>
  | Readonly<{ type: 'guest/frame'; frame: HostFrame }>
  | Readonly<{ type: 'guest/lost' }>
  // ---- the table ----
  /** `act(action)`: every role. */
  | Readonly<{ type: 'act'; action: Action }>
  | Readonly<{ type: 'card/tap'; cardId: string }>
  | Readonly<{ type: 'stock/tap' }>
  | Readonly<{ type: 'discard/tap' }>
  /** A `data-act` button: `discard` and `knock` use the selection. */
  | Readonly<{ type: 'action/click'; act: string }>
  | Readonly<{ type: 'result/hide' }>
  /** `#deadwoodInfo` tapped. */
  | Readonly<{ type: 'meld/open' }>
  | Readonly<{ type: 'meld/close' }>
  | Readonly<{ type: 'meld/choose'; index: number }>
  /** `#curtainBtn`. */
  | Readonly<{ type: 'curtain/reveal' }>
  | Readonly<{ type: 'leave/request' }>
  | Readonly<{ type: 'leave/confirmed' }>
  | Readonly<{ type: 'leave/finish' }>
  /** The page became visible: the wake lock is taken again while in a game. */
  | Readonly<{ type: 'visible' }>
  /** The hook's `render()`. */
  | Readonly<{ type: 'render' }>
  /** A session asked the app to persist. */
  | Readonly<{ type: 'persist' }>;

// ---- effects -----------------------------------------------------------------------------------

export type Effect =
  | Readonly<{ type: 'persist' }>
  | Readonly<{ type: 'clearSave' }>
  | Readonly<{ type: 'rememberName'; name: string }>
  | Readonly<{ type: 'rememberP2Name'; name: string }>
  | Readonly<{ type: 'writeHomeTab'; tab: HomeTab }>
  | Readonly<{ type: 'writePlayMode'; mode: PlayMode }>
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
  /** `window.__scorer.onShown()` / `.resume()`. */
  | Readonly<{ type: 'scorer'; call: 'shown' | 'resume' }>
  /** Arm a named timer that dispatches `then` after `ms`; arming again restarts it. */
  | Readonly<{ type: 'startTimer'; id: TimerId; ms: number; then: Intent }>
  | Readonly<{ type: 'cancelTimer'; id: TimerId }>
  /** `fx.toggle()`. */
  | Readonly<{ type: 'toggleSound' }>
  /** The invite for `code` through the share sheet or the clipboard. */
  | Readonly<{ type: 'share'; code: string }>
  /** `initHome`: the saved name into `#nameInput` and `#p1NameInput`. */
  | Readonly<{ type: 'fillName'; name: string }>
  /** `initHome`: the saved pass-and-play second name into `#p2NameInput`. */
  | Readonly<{ type: 'fillP2Name'; name: string }>
  /** `#codeInput`'s value after sanitising. */
  | Readonly<{ type: 'setCode'; value: string }>;

export type TimerId = 'longPress';

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
/**
 * A refused move: the toast, and a draw that was awaited never leaves the ghost slot pending. A
 * `shown` stage is kept: only `__gin.act` can send a move the engine refuses while the drawn card
 * sits in the ghost cell (the undo of a stock draw, say), and the card must not collapse into the
 * hand over a toast (docs/design/gin-arrangement-and-discards.md §4).
 */
const refuse = (app: App, message: string): Step =>
  step(app.draw?.kind === 'waiting' ? { ...app, draw: null } : app, toast(message));

// ---- helpers, as the legacy had them ------------------------------------------------------------

/** `parseInt(v, 10)`, falling back to 100 unless a positive integer. */
export const parseTarget = (raw: string): number => {
  const t = parseInt(raw, 10);
  return !Number.isNaN(t) && t > 0 ? t : DEFAULT_TARGET;
};

/** `(value.trim() || fallback).slice(0, 20)`. */
const nameOr = (raw: string, fallback: string): string => {
  const trimmed = raw.trim();
  return (trimmed === '' ? fallback : trimmed).slice(0, NAME_MAX);
};

const showScreen = (app: App, screen: ScreenId): Step =>
  step({ ...app, screen }, { type: 'scrollTop' });

/**
 * The state side of the legacy `render()`: nothing without a view; else the cue machine steps
 * (its cue is played), the screen is the table or, at gameOver, the end screen, a selection
 * that left the hand is dropped, and the draw stage settles against the view. The paint itself
 * is main.ts's after every intent.
 */
const rendered = (app: App): Step => {
  const view = app.view;
  if (view === null) return pure(app);
  const cued = nextCue(app.cues, view, app.role === 'local' ? 'local' : 'online');
  const selectedCard = selectionIn(view, app.selectedCard);
  const screen: ScreenId = view.phase === 'gameOver' ? 'endgameScreen' : 'tableScreen';
  return step(
    { ...app, cues: cued.state, selectedCard, screen, draw: settleDraw(app.draw, view) },
    ...(cued.cue === null ? [] : [{ type: 'fx', cue: cued.cue } as const]),
    { type: 'scrollTop' },
  );
};

const withHostStatus = (app: App, text: string, stopPulse = false): App => ({
  ...app,
  hostStatus: { text, pulse: stopPulse ? false : app.hostStatus.pulse },
});
const withGuestStatus = (app: App, text: string, stopPulse = false): App => ({
  ...app,
  guestStatus: { text, pulse: stopPulse ? false : app.guestStatus.pulse },
});

/** `app.game.players[1].name = name` on a rejoin. */
const renameGuest = (game: State, name: string): State => ({
  ...game,
  players: [game.players[0], { ...game.players[1], name }],
});

// ---- flows -------------------------------------------------------------------------------------

/** `broadcast()`: my view, the guest's view on the wire, selection cleared, saved, rendered. */
const broadcast = (app: App): Step => {
  const game = app.game;
  if (game === null) return pure(app);
  return then(
    step(
      { ...app, view: viewFor(game, 0), selectedCard: null },
      { type: 'send', frame: stateFrame(viewFor(game, 1)) },
      { type: 'persist' },
    ),
    rendered,
  );
};

/** `dispatch(pIdx, action)`, host only: apply, or refuse to the mover; then broadcast. */
const hostDispatch = (app: App, seat: Seat, action: Action, ctx: Context): Step => {
  if (app.game === null) return pure(app);
  const res = applyAction(app.game, seat, action, ctx.rng, ctx.now);
  if (!res.ok) {
    return seat === 0
      ? refuse(app, res.error)
      : step(app, { type: 'send', frame: toastFrame(res.error) });
  }
  return broadcast({ ...app, game: res.value, resultDismissed: false });
};

/**
 * `localBroadcast(initial)`: the mover's view while a hand is in play, the revealed player's (or
 * seat 0's) otherwise; the curtain comes up when the phone must change hands, chiming unless this
 * is the start or a reveal.
 */
const localBroadcast = (app: App, initial: boolean): Step => {
  const game = app.game;
  if (game === null) return pure(app);
  const inPlay = game.phase !== 'roundOver' && game.phase !== 'gameOver';
  const viewIdx: Seat = inPlay ? game.turn : (app.revealed ?? 0);
  const curtain = inPlay && app.revealed !== game.turn ? game.turn : null;
  return then(
    step(
      { ...app, view: viewFor(game, viewIdx), selectedCard: null, curtain },
      { type: 'persist' },
      ...(curtain !== null && !initial ? [{ type: 'fx', cue: 'yourTurn' } as const] : []),
    ),
    rendered,
  );
};

/** `localAct(action)`: `ready` is applied for both seats; anything else for the mover. */
const localAct = (app: App, action: Action, ctx: Context): Step => {
  const game = app.game;
  if (game === null) return pure(app);
  if (action.type === 'ready') {
    const r1 = applyAction(game, 0, action, ctx.rng, ctx.now);
    const g1 = r1.ok ? r1.value : game;
    const r2 = applyAction(g1, 1, action, ctx.rng, ctx.now);
    if (!r1.ok && !r2.ok) return refuse(app, r1.error);
    return localBroadcast({ ...app, game: r2.ok ? r2.value : g1, resultDismissed: false }, false);
  }
  const res = applyAction(game, game.turn, action, ctx.rng, ctx.now);
  if (!res.ok) return refuse(app, res.error);
  return localBroadcast({ ...app, game: res.value, resultDismissed: false }, false);
};

/** `startLocal(p1, p2, target, savedGame)` with the game already made. */
const startLocal = (app: App, game: State): Step =>
  then(
    step(
      {
        ...app,
        role: 'local',
        code: null,
        oppConnected: true,
        game,
        revealed: null,
        resultDismissed: false,
        draw: null,
      },
      { type: 'wakeLock', hold: true },
    ),
    (a) => localBroadcast(a, true),
  );

/** `startHost(resumeCode)` up to the network: the session is the `startHost` effect. */
const startHost = (app: App, resumeCode: string | null, ctx: Context): Step => {
  const code = resumeCode ?? randomCode('gin-rummy', ctx.rng);
  const attempt = app.netAttempt + 1;
  return then(
    showScreen(
      withHostStatus(
        { ...app, role: 'host', code, netAttempt: attempt, startGameVisible: false },
        OPENING_MSG,
      ),
      'hostWaitScreen',
    ),
    (a) => step(a, { type: 'startHost', code, attempt, resume: resumeCode !== null }),
  );
};

/** `startGuest(code)` up to the network: the session is the `startGuest` effect. */
const startGuest = (app: App, code: string): Step => {
  const attempt = app.netAttempt + 1;
  return then(
    showScreen(
      withGuestStatus({ ...app, role: 'guest', code, netAttempt: attempt }, connectingMsg(code)),
      'guestWaitScreen',
    ),
    (a) => step(a, { type: 'startGuest', code, attempt }),
  );
};

/**
 * `act(action)`: a tap, then by role. A draw (the stock, the discard pile, the upcard) first holds
 * the ten-card picture on screen, so the slot view keeps it until the player accepts the card
 * (docs/design/gin-draw-ghost-slot.md §3); the stage settles in `rendered` or clears in `refuse`.
 * A second draw while one is `waiting` (a guest's round trip: the view stays in the draw phase
 * until the host's state frame lands) is ignored, or the host would refuse the duplicate with a
 * toast that clears the stage and collapses the ghost card without the player's accept tap.
 */
const act = (app: App, action: Action, ctx: Context): Step => {
  const from = drawSource(action);
  if (from !== null && app.draw?.kind === 'waiting') return pure(app);
  const held: App =
    from !== null && app.view !== null
      ? { ...app, draw: { kind: 'waiting', from, hold: holdOf(app.view.me) } }
      : app;
  return then(step(held, { type: 'fx', cue: 'tap' }), (a) => {
    switch (a.role) {
      case 'local':
        return localAct(a, action, ctx);
      case 'host':
        return hostDispatch(a, 0, action, ctx);
      case 'guest':
      case null:
        // The legacy tested `app.conn && app.conn.open`; a guest's channel is open exactly while
        // the host counts as connected (set on open, cleared on close), and no role has no channel.
        return a.role === 'guest' && a.oppConnected
          ? step(a, { type: 'send', frame: actionFrame(action) })
          : refuse(a, NOT_CONNECTED_MSG);
    }
  });
};

/** `onGuestGone()` after `oppConnected` was cleared. */
const guestGone = (app: App): Step => {
  if (app.game !== null && app.view !== null && app.view.phase !== 'gameOver')
    return then(rendered(app), (a) =>
      step(a, toast(guestGoneMsg(a.oppName, a.code), GONE_TOAST_MS)),
    );
  if (app.game === null)
    return pure({ ...withHostStatus(app, OPPONENT_LEFT_MSG), startGameVisible: false });
  return pure(app);
};

/** `onGuestMsg(conn, msg)` for a decoded frame. */
const hostFrame = (app: App, frame: GuestFrame, ctx: Context): Step => {
  switch (frame.t) {
    case 'join': {
      const name = guestNameFor(frame.name, app.myName);
      const connected = { ...app, oppConnected: true, oppName: name };
      if (app.game !== null) {
        // Rejoin: keep the seat, refresh the name.
        return broadcast({ ...connected, game: renameGuest(app.game, name) });
      }
      return step(
        { ...withHostStatus(connected, joinedMsg(name)), startGameVisible: true },
        { type: 'send', frame: lobbyFrame(app.myName, app.target) },
      );
    }
    case 'action':
      return app.game === null ? pure(app) : hostDispatch(app, 1, frame.action, ctx);
  }
};

/** `onHostMsg(msg)` for a decoded frame. */
const guestFrame = (app: App, frame: HostFrame): Step => {
  switch (frame.t) {
    case 'welcome':
    case 'lobby':
      return pure(
        withGuestStatus(
          { ...app, oppName: frame.hostName, target: frame.target },
          hostRoomMsg(frame.hostName, frame.target),
        ),
      );
    case 'full':
      return pure(withGuestStatus(app, ROOM_FULL_MSG));
    case 'toast':
      // The host refused the guest's move: a draw that was awaited is over.
      return refuse(app, frame.msg);
    case 'state':
      return rendered({
        ...app,
        view: frame.view,
        oppConnected: true,
        selectedCard: null,
        resultDismissed: false,
      });
  }
};

/** The resume box `initHome` showed, in the legacy order of precedence, or null. */
export const resumeFor = (save: Save | null, scorer: ScorerState | null): Resume | null => {
  if (scorer !== null) return { kind: 'scorer', state: scorer };
  if (save === null) return null;
  switch (save.role) {
    case 'local':
      return save.game.phase !== 'gameOver' ? { kind: 'local', game: save.game } : null;
    case 'host':
      return save.game !== null && save.game.phase !== 'gameOver'
        ? {
            kind: 'host',
            code: save.code,
            myName: save.myName,
            target: save.target,
            game: save.game,
            oppName: save.oppName,
          }
        : null;
    case 'guest':
      return { kind: 'guest', code: save.code, myName: save.myName };
  }
};

/** `#resumeBtn`'s label for a resume offer. */
export const resumeLabel = (resume: Resume): string => {
  switch (resume.kind) {
    case 'scorer':
      return `Resume scoring: ${resume.state.players.map((p) => p.name).join(' vs ')}`;
    case 'local':
      return `Resume pass & play: ${resume.game.players.map((p) => p.name).join(' vs ')}`;
    case 'host':
      return `Resume hosting room ${resume.code}`;
    case 'guest':
      return `Rejoin room ${resume.code}`;
  }
};

/** `setHomeTab(tab, opts)`. */
const setHomeTab = (app: App, tab: string, persist: boolean): Step => {
  const known = HOME_TABS.find((t) => t === tab) ?? DEFAULT_HOME_TAB;
  return step(
    { ...app, homeTab: known },
    ...(persist ? [{ type: 'writeHomeTab', tab: known } as const] : []),
    ...(known === 'score' ? [{ type: 'scorer', call: 'shown' } as const] : []),
  );
};

/** `initHome()` over a storage snapshot: the saved names go into the three name inputs. */
const initHome = (app: App, home: HomeSnapshot): Step =>
  then(showScreen(app, 'homeScreen'), (a) =>
    then(
      then(
        step(
          {
            ...a,
            savedName: home.name,
            nameTouched: home.name !== null ? true : a.nameTouched,
            homeTab: home.homeTab,
            playMode: home.playMode,
          },
          ...(home.name === null ? [] : [{ type: 'fillName', name: home.name } as const]),
          ...(home.p2Name === null ? [] : [{ type: 'fillP2Name', name: home.p2Name } as const]),
        ),
        (b) => setHomeTab(b, home.homeTab, false),
      ),
      (b) => pure({ ...b, resume: resumeFor(home.save, home.scorer) }),
    ),
  );

/** `#resumeBtn` for each offer. */
const resume = (app: App, offer: Resume, ctx: Context): Step => {
  switch (offer.kind) {
    case 'scorer':
      return step(app, { type: 'scorer', call: 'resume' });
    case 'local':
      return startLocal(app, offer.game);
    case 'host':
      return startHost(
        {
          ...app,
          myName: offer.myName,
          target: offer.target,
          game: offer.game,
          oppName: offer.oppName,
          view: viewFor(offer.game, 0),
        },
        offer.code,
        ctx,
      );
    case 'guest':
      return startGuest({ ...app, myName: offer.myName }, offer.code);
  }
};

/** `leaveGame()` after the confirm and the network close: the reset, then home. */
const leaveFinish = (app: App): Step =>
  step(
    {
      ...app,
      netAttempt: app.netAttempt + 1,
      role: null,
      game: null,
      view: null,
      oppConnected: false,
      code: null,
      revealed: null,
      curtain: null,
      meldChooser: false,
      draw: null,
    },
    { type: 'clearSave' },
    { type: 'initHome' },
  );

/** `#cancelHostBtn` / `#cancelGuestBtn` after the Peer is destroyed. */
const cancelFinish = (app: App): Step =>
  step(
    { ...app, role: null, netAttempt: app.netAttempt + 1 },
    { type: 'clearSave' },
    { type: 'initHome' },
  );

/** A `data-act` button. */
const actionClick = (app: App, which: string, ctx: Context): Step => {
  switch (which) {
    case 'passUpcard':
    case 'takeUpcard':
    case 'undoDraw':
      return act(app, { type: which }, ctx);
    case 'discard':
    case 'knock':
      return app.selectedCard === null
        ? pure(app)
        : act(app, { type: which, cardId: app.selectedCard }, ctx);
    case 'showResult':
      return pure({ ...app, resultDismissed: false });
    default:
      return pure(app);
  }
};

// ---- the reducer -------------------------------------------------------------------------------

export const reduce = (app: App, intent: Intent, ctx: Context): Step => {
  switch (intent.type) {
    // ---- home ----
    case 'home/init':
      return initHome(app, intent.home);
    case 'name/typed':
      return step(
        { ...app, nameTouched: true },
        { type: 'rememberName', name: intent.value.trim() },
      );
    case 'p1name/typed':
      return step(app, { type: 'rememberName', name: intent.value.trim() });
    case 'p2name/typed':
      return step(app, { type: 'rememberP2Name', name: intent.value.trim() });
    case 'tab/set':
      return setHomeTab(app, intent.tab, intent.persist !== false);
    case 'mode/set': {
      const mode: PlayMode = intent.mode === 'local' ? 'local' : 'online';
      return step({ ...app, playMode: mode }, { type: 'writePlayMode', mode });
    }
    case 'host/click':
      return startHost(
        {
          ...app,
          myName: nameOr(intent.name, DEFAULT_NAME),
          target: parseTarget(intent.target),
          game: null,
          oppName: null,
          oppConnected: false,
        },
        null,
        ctx,
      );
    case 'join/click': {
      const code = validateCode('gin-rummy', intent.code);
      if (!code.ok) return step(app, toast(code.error));
      const typed = intent.name.trim();
      const myName = (
        typed !== '' && (app.nameTouched || typed !== DEFAULT_NAME) ? typed : DEFAULT_GUEST_NAME
      ).slice(0, NAME_MAX);
      return startGuest({ ...app, myName }, code.value);
    }
    case 'local/click': {
      const p1 = nameOr(intent.p1, 'Player 1');
      const p2raw = nameOr(intent.p2, 'Player 2');
      const p2 = p2raw.toLowerCase() === p1.toLowerCase() ? `${p2raw} 2` : p2raw;
      const game = createGame(
        {
          players: [
            { id: 'p1', name: p1 },
            { id: 'p2', name: p2 },
          ],
          target: parseTarget(intent.target),
        },
        ctx.rng,
        ctx.now,
      );
      return startLocal(app, game);
    }
    case 'resume/click':
      return app.resume === null ? pure(app) : resume(app, app.resume, ctx);
    case 'cancel':
      return step(app, { type: 'closeNet' }, { type: 'then', intent: { type: 'cancel/finish' } });
    case 'cancel/finish':
      return cancelFinish(app);
    case 'screen/show':
      return showScreen(app, intent.screen);
    case 'submenu/press':
      return step(
        { ...app, longPressed: false },
        {
          type: 'startTimer',
          id: 'longPress',
          ms: LONG_PRESS_MS,
          then: { type: 'submenu/longPress' },
        },
      );
    case 'submenu/release':
      return step(app, { type: 'cancelTimer', id: 'longPress' });
    case 'submenu/longPress':
      return step({ ...app, longPressed: true, submenuOpen: true }, { type: 'fx', cue: 'tap' });
    case 'tab/playClick':
      // The long press already opened the submenu; the click that follows must not switch tabs.
      return app.longPressed
        ? pure({ ...app, longPressed: false })
        : setHomeTab({ ...app, submenuOpen: false }, 'play', true);
    case 'submenu/pick':
      return then(reduce(app, { type: 'mode/set', mode: intent.mode }, ctx), (a) =>
        setHomeTab({ ...a, submenuOpen: false }, 'play', true),
      );
    case 'submenu/dismiss':
      return pure({ ...app, submenuOpen: false });
    case 'code/typed': {
      // A keyboard suggestion that swapped earlier letters arrives as a replacement: keep the last good code.
      const value =
        intent.inputType === 'insertReplacementText'
          ? app.codeDraft
          : sanitiseCode('gin-rummy', intent.value);
      return step({ ...app, codeDraft: value }, { type: 'setCode', value });
    }
    case 'sound/toggle':
      return step(app, { type: 'toggleSound' });
    case 'share/click':
      return app.code === null ? pure(app) : step(app, { type: 'share', code: app.code });
    case 'rules/open':
      return pure({ ...app, rulesOpen: true });
    case 'rules/close':
      return pure({ ...app, rulesOpen: false });
    case 'history/open':
      return pure({ ...app, history: intent.who });
    case 'history/close':
      return pure({ ...app, history: null });
    // ---- net: host ----
    case 'host/start':
      return startHost(app, intent.code, ctx);
    case 'host/status':
      return pure(withHostStatus(app, intent.text, intent.stopPulse));
    case 'host/frame':
      return hostFrame(app, intent.frame, ctx);
    case 'host/guestGone': {
      const gone = { ...app, oppConnected: false };
      return intent.iceFailed === null
        ? guestGone(gone)
        : pure(withHostStatus(gone, intent.iceFailed));
    }
    case 'host/deal': {
      if (!app.oppConnected) return step(app, toast(WAITING_FOR_GUEST_MSG));
      const game = createGame(
        {
          players: [
            { id: 'host', name: app.myName },
            // A connected opponent has a name; the fallback only satisfies the type.
            { id: 'guest', name: app.oppName ?? DEFAULT_GUEST_NAME },
          ],
          target: app.target,
        },
        ctx.rng,
        ctx.now,
      );
      return broadcast({ ...app, game, resultDismissed: false, draw: null });
    }
    // ---- net: guest ----
    case 'guest/start':
      return startGuest(app, intent.code);
    case 'guest/status':
      return pure(withGuestStatus(app, intent.text, intent.stopPulse));
    case 'guest/connected':
      return pure({ ...app, oppConnected: true });
    case 'guest/frame':
      return guestFrame(app, intent.frame);
    case 'guest/lost': {
      const lost = { ...app, oppConnected: false, draw: null };
      if (lost.view !== null && lost.view.phase !== 'gameOver')
        return then(rendered(lost), (a) => step(a, toast(LOST_HOST_MSG, GONE_TOAST_MS)));
      return showScreen(withGuestStatus(lost, DISCONNECTED_MSG), 'guestWaitScreen');
    }
    // ---- the table ----
    case 'act':
      return act(app, intent.action, ctx);
    case 'card/tap': {
      const v = app.view;
      if (v === null || !v.isMyTurn || v.phase !== 'discard') return pure(app);
      if (app.draw?.kind === 'shown') {
        // A tap on the ghost card accepts it; a tap on a held card accepts and selects that card
        // in one go (a tap on a held card is an action by the owner's rule: cards may move now).
        const accepted: App =
          app.draw.cardId === intent.cardId
            ? { ...app, draw: null }
            : { ...app, draw: null, selectedCard: intent.cardId };
        return then(step(accepted, { type: 'fx', cue: 'tap' }), rendered);
      }
      if (v.drawnFromDiscard === intent.cardId) return step(app, toast(LOCKED_CARD_MSG));
      const selectedCard = app.selectedCard === intent.cardId ? null : intent.cardId;
      return then(step({ ...app, selectedCard }, { type: 'fx', cue: 'tap' }), rendered);
    }
    case 'stock/tap': {
      const v = app.view;
      return v !== null && v.isMyTurn && v.phase === 'draw'
        ? act(app, { type: 'drawStock' }, ctx)
        : pure(app);
    }
    case 'discard/tap': {
      const v = app.view;
      if (v?.isMyTurn !== true) return pure(app);
      if (v.phase === 'upcard') return act(app, { type: 'takeUpcard' }, ctx);
      if (v.phase !== 'draw') return pure(app);
      return v.forceStock
        ? step(app, toast(FORCE_STOCK_MSG))
        : act(app, { type: 'drawDiscard' }, ctx);
    }
    case 'action/click':
      return actionClick(app, intent.act, ctx);
    case 'result/hide':
      return pure({ ...app, resultDismissed: true });
    case 'meld/open': {
      const v = app.view;
      if (v === null || v.meldOptions.length < 2) return pure(app);
      return step({ ...app, meldChooser: true }, { type: 'fx', cue: 'tap' });
    }
    case 'meld/close':
      return pure({ ...app, meldChooser: false });
    case 'meld/choose': {
      const option = app.view?.meldOptions[intent.index];
      if (option === undefined) return pure(app);
      return act(
        { ...app, meldChooser: false },
        { type: 'setMelds', melds: option.melds.map((m) => m.map((c) => c.id)) },
        ctx,
      );
    }
    case 'curtain/reveal': {
      if (app.game === null) return pure(app);
      return then(
        step({ ...app, revealed: app.game.turn, curtain: null }, { type: 'fx', cue: 'tap' }),
        (a) => localBroadcast(a, true),
      );
    }
    case 'leave/request':
      return step(app, {
        type: 'confirm',
        message: app.role === 'local' ? LEAVE_LOCAL_MSG : LEAVE_ONLINE_MSG,
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
      return leaveFinish(app);
    case 'visible':
      return app.role === null ? pure(app) : step(app, { type: 'wakeLock', hold: true });
    case 'render':
      return rendered(app);
    case 'persist':
      return step(app, { type: 'persist' });
  }
};

// ---- storage: persist and resume -------------------------------------------------------------

/** `persist()`: the save for the current role, or null when there is nothing to save. */
export const saveFor = (app: App): Save | null => {
  switch (app.role) {
    case 'local':
      return app.game === null ? null : { role: 'local', game: app.game };
    case 'host':
      return {
        role: 'host',
        code: app.code ?? '',
        myName: app.myName,
        target: app.target,
        game: app.game,
        oppName: app.oppName,
      };
    case 'guest':
      return { role: 'guest', code: app.code ?? '', myName: app.myName };
    case null:
      return null;
  }
};

/** `initHome`'s reads: the names, the tab and mode (defaults when unreadable), the save, the scorer session. */
export const readHome = (store: Store): HomeSnapshot => {
  const name = readName(store);
  const p2Name = readP2Name(store);
  const tab = readHomeTab(store);
  const mode = readPlayMode(store);
  const save = readSave(store);
  const scorer = readScorerState(store);
  return {
    name: name.ok ? name.value : null,
    p2Name: p2Name.ok ? p2Name.value : null,
    homeTab: tab.ok ? tab.value : DEFAULT_HOME_TAB,
    playMode: mode.ok ? mode.value : DEFAULT_PLAY_MODE,
    save: save.ok ? save.value : null,
    scorer: scorer.ok ? scorer.value : null,
  };
};

// ---- what the sessions read back ---------------------------------------------------------------

export const hostContextOf = (app: App): HostContext => ({
  attempt: app.netAttempt,
  role: app.role,
  code: app.code,
  myName: app.myName,
  target: app.target,
  hasGame: app.game !== null,
  oppName: app.oppName,
  oppConnected: app.oppConnected,
});

export const guestContextOf = (app: App): GuestContext => ({
  attempt: app.netAttempt,
  role: app.role,
  code: app.code,
  myName: app.myName,
  oppConnected: app.oppConnected,
});

// ---- running the effects -----------------------------------------------------------------------

/** The adapters an effect reaches; main.ts constructs the real ones, tests record. */
export type EffectDeps = Readonly<{
  store: Store;
  toast: (message: string, ms: number | null) => void;
  fx: (cue: Cue | 'tap') => void;
  wakeLock: (hold: boolean) => void;
  net: Readonly<{
    startHost: (code: string, attempt: number, resume: boolean) => void;
    startGuest: (code: string, attempt: number) => void;
    send: (frame: HostFrame | GuestFrame) => void;
    close: () => void;
  }>;
  confirm: (message: string) => boolean;
  scrollTop: () => void;
  scorer: Readonly<{ shown: () => void; resume: () => void }>;
  timers: Readonly<{
    start: (id: TimerId, ms: number, then: Intent) => void;
    cancel: (id: TimerId) => void;
  }>;
  toggleSound: () => void;
  share: (code: string) => void;
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
    case 'toast':
      deps.toast(effect.message, effect.ms);
      return;
    case 'send':
      deps.net.send(effect.frame);
      return;
    case 'fx':
      deps.fx(effect.cue);
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
    case 'scorer':
      deps.scorer[effect.call]();
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
