// The gin app as a reducer over intents (docs/MIGRATION.md step 12; docs/ARCHITECTURE.md "Module
// boundaries": imported only by main.ts and tests). The legacy multiplayer UI
// (legacy/gin-rummy/index.html) kept one mutable `app` object, wrote the DOM from a hundred
// places and called the network from its handlers. Here `App` is that object as an immutable
// record, plus what the legacy kept in the DOM or in closures (the screen shown, the two waiting
// statuses, the netAttempt ticket, the curtain, the cue machine's memory), split in two as
// backgammon splits it (docs/design/shared-shell.md §4.1, C1): `shell` is the home screen, the
// waiting rooms and the session, the record the shared shell reducer owns since C2
// (web/shared/ui/shell.ts `reduceShell`, over the config `GIN` below: gin's shellConfig.ts half,
// the id, names, tabs, copy, option codec, engine adapters, frames and store, completed here with
// the table hooks the shared flows call: `reset` per site, `rendered`, `refuse`, pass-and-play's
// `viewer`/`revealer`, and the home snapshot's own part); `table` is the hand's own state (the
// tapped card, the ghost slot, the picture, a drag, the sheets, the curtain, the sandbox editor),
// which stays gin's. `Intent` is every handler and every network event, partitioned the same way
// (`SHELL_INTENT_TYPES`), and `reduce` returns the next App with a list of `Effect`s: what to
// persist, toast, send, play or open, as data. main.ts runs the effects through the real adapters
// (`runEffect`: gin's four, then the shared runner) and paints the App (ui/render.ts); the tests
// run the reducer alone. `persist`/`saveFor` and `readHome` are the legacy
// `persist()`/`loadSaved()`/`initHome` reads, through storage.ts, producing the same
// `ginRummyMP_v1` bytes as the captured fixtures (test/parity/gin.state.test.ts).
//
// Gin's residue on the shell (§4.3): the sandbox mode (shown while the first player is named
// `sandbox`, never stored: `GIN_SHELL.modes.parse`, and the fallback to pass-and-play when a
// typed name no longer unlocks it, `withP1Name` after the shell's own step in `reduce`), the
// Score Counter's resume offer (`Resume`'s `scorer` kind, `GIN.home.resume`/`resumeExtra`), and
// the `scorer`/`copy`/`writeSort`/`writeCardBack` effects `runEffect` handles before delegating.
//
// Two legacy traits kept on purpose: the reducer runs `render()`'s state effects wherever the
// legacy called `render()` (the cue machine steps, the screen flips to the table, a selection no
// longer in hand is dropped), and a leave closes the network before the state is reset, so the
// session's own close still raises the "disconnected" toast the legacy raised.
import {
  LONG_PRESS_MS,
  NOT_CONNECTED_MSG,
  guestContextOf as shellGuestContextOf,
  hostContextOf as shellHostContextOf,
  hostDispatch,
  initialShell as shellInitial,
  isShellEffect,
  isShellIntent,
  localBroadcast,
  localPlayers,
  localSeated,
  pure,
  readHome as shellReadHome,
  reduceShell,
  resumeFor as shellResumeFor,
  saveFor as shellSaveFor,
  step,
  andThen as then,
  toast,
  withShell,
  withTable,
  type Ctx,
  type Effect as SharedEffect,
  type HomeSnapshot as SharedHomeSnapshot,
  type Intent as SharedIntent,
  type Resume as SharedResume,
  type ShellApp,
  type ShellConfig,
  type ShellIntent as SharedShellIntent,
  type ShellState,
  type Step as SharedStep,
  type TableReset,
  type TimerId as SharedTimerId,
} from '../../../../shared/ui/shell.ts';
import { runShellEffect, type ShellEffectDeps } from '../../../../shared/ui/shellEffects.ts';
import { applyAction, canTakeBack, fitsOnto, idsOf, inPlay } from '../engine/index.ts';
import type { Action, Seat, State, View } from '../engine/types.ts';
import type { GuestContext } from '../net/guest.ts';
import type { HostContext } from '../net/host.ts';
import { action as actionFrame } from '../protocol.ts';
import type { ScorerState } from '../scorer/scores.ts';
import { GIN_SHELL } from '../shellConfig.ts';
import {
  DEFAULT_CARD_BACK,
  DEFAULT_SORT,
  writeCardBack,
  writeSort,
  type CardBack,
  type SortMode,
  HOME_TABS,
  type HomeTab,
  type HostExtra,
  type PlayMode as StoredPlayMode,
  type Save,
  type Store,
} from '../storage.ts';
import { dealMap, formatMap, parseMap, presetById, randomMap, unlocksSandbox } from '../sandbox.ts';
import { DEFAULT_PRESET } from '../sandbox.ts';
import { nextCue, oppDrawCue, selectionIn, type Cue, type CueState } from './cues.ts';
import { drawSource, settleDraw, type DrawStage } from './hand/draw.ts';
import type { DropTarget } from './hand/drag.ts';
import { arrangedOf, declarable, toggleMeld, type HumanMelds } from './hand/arrange.ts';
import { settlePicture, type Picture, moveLoose, samePicture } from './hand/picture.ts';

// The shell's strings and helpers the tests and painters import from here, as before C2.
export {
  DISCONNECTED_MSG,
  GONE_TOAST_MS,
  LONG_PRESS_MS,
  LOST_HOST_MSG,
  NOT_CONNECTED_MSG,
  OPPONENT_LEFT_MSG,
  ROOM_FULL_MSG,
  SHELL_INTENT_TYPES,
  WAITING_FOR_GUEST_MSG,
  guestGoneMsg,
  joinedMsg,
  type Role,
  type WaitStatus,
} from '../../../../shared/ui/shell.ts';
export {
  DEFAULT_NAME,
  DEFAULT_TARGET,
  LEAVE_LOCAL_MSG,
  LEAVE_ONLINE_MSG,
  hostRoomMsg,
  parseTarget,
} from '../shellConfig.ts';
// ---- the state ---------------------------------------------------------------------------------

// ui/home.ts paints the tabs from the same list storage.ts decodes; ui/ may not import storage.ts.
export { HOME_TABS, type HomeTab };
/** The stored modes plus the sandbox (src/sandbox.ts), which is shown, never stored. */
export type PlayMode = StoredPlayMode | 'sandbox';

/** `#sandboxModeContent`: the map being edited, the preset it came from, what is wrong with it. */
export type Sandbox = Readonly<{
  /** A preset's id, `random`, or `''` once the map was edited by hand. */
  preset: string;
  map: string;
  error: string | null;
  /** `#sandboxHelpOverlay` open. */
  helpOpen: boolean;
}>;
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

/**
 * What the home screen's resume box offers (`initHome`), in the legacy's order of precedence: the
 * Score Counter's session first (gin's own, the shell's `G['Resume']`), then a live pass-and-play
 * or hosted game, then a guest room (web/shared/ui/shell.ts `ShellResume`).
 */
export type Resume = SharedResume<Gin>;

/**
 * Gin's types for the shared shell (web/shared/ui/shell.ts `ShellTypes`): the room's terms are the
 * target (the host save's own field, storage.ts `HostExtra`, and the welcome frame's `Room`), the
 * raw option off the inputs is the target as typed, the modes include the sandbox, the resume
 * offers include the Score Counter's session, `initHome` also reads the sort, the card back and
 * that session, and the table's own intents and effects are the unions below.
 */
export type Gin = Readonly<{
  Opts: HostExtra;
  Raw: Readonly<{ target: string }>;
  State: State;
  View: View;
  Action: Action;
  Table: Table;
  Tab: HomeTab;
  Mode: PlayMode;
  Screen: ScreenId;
  Timer: 'cardPress';
  Cue: Cue;
  Cues: CueState;
  Resume: Readonly<{ kind: 'scorer'; state: ScorerState }>;
  Home: Readonly<{ sort: SortMode; cardBack: CardBack; scorer: ScorerState | null }>;
  Intent: TableIntent;
  Effect: TableEffect;
  Store: Store;
}>;

/**
 * Everything but the table's own state, split from the legacy `app` object as backgammon splits
 * it (docs/design/shared-shell.md §4.1, C1): the home screen, the waiting rooms and the session
 * (role, code, names, the engine `State` for the host and pass-and-play, my `View` for every
 * role), the resume offer, the rules sheet and the Play tab's submenu, under backgammon's field
 * names, with `opts: { target }` where backgammon has `{ matchLength, variant }`. `game` and
 * `view` sit here too: the shell owns the session (who plays, from which device), the table only
 * remembers taps and sheets. Since C2 the record is the shared shell reducer's (`ShellState`).
 */
export type Shell = ShellState<Gin>;

/**
 * The table's own state (backgammon's `Table`, docs/design/shared-shell.md §4.1): the tapped
 * card, the ghost draw slot, the kept picture, the melds made by hand, a drag, the sheets, the
 * pass-and-play curtain, the sandbox editor and gin's two table preferences (`sort`, `cardBack`).
 * Never saved but for those two, never on the wire; gin's alone when C2 lifts the shell. The
 * legacy's `hostSeated` (set, never read) is gone: it stayed only so the hook's `app` kept the
 * legacy's members, and this split changes that shape anyway.
 */
export type Table = Readonly<{
  selectedCard: string | null;
  sandbox: Sandbox;
  /** The round-result sheet was put away with "Look at the table". */
  resultDismissed: boolean;
  /** `#curtainOverlay`: the seat the phone is handed to, or null when hidden. */
  curtain: Seat | null;
  /** `#meldOverlay` open. */
  meldChooser: boolean;
  /**
   * `#historyOverlay` open, and whose list it shows: the game's (painted from the view) or the
   * Score Counter's (scorer/main.ts writes the list itself).
   */
  history: 'game' | 'scorer' | null;
  /**
   * The ghost draw slot (docs/design/gin-draw-ghost-slot.md §3): whether the drawn card is
   * awaited or shown. Not saved, not on the wire.
   */
  draw: DrawStage | null;
  /**
   * The hand as the cells show it (docs/design/gin-arrangement-and-discards.md §5): kept through
   * a selection, a draw, an accept and a discard, re-melded at the start of my turn, on Arrange
   * and on a chooser pick. Null until the first paint of a view. Not saved, not on the wire.
   */
  picture: Picture | null;
  /** The melds the player made by hand this hand (arrange.ts). Not saved, not on the wire. */
  human: HumanMelds | null;
  /**
   * The card being dragged (ui/hand/dragger.ts, docs/design/gin-arrangement-and-discards.md §5d,
   * §7b): a loose card of the hand (`from: 'hand'`; its cell is emptied for the ghost) or a card
   * laid off onto the knocker's melds (`from: 'table'`); `onto` is the meld the card is over and
   * fits, lit as its drop target. A tap is ignored until the drag ends. Session only.
   */
  drag: Readonly<{ cardId: string; from: 'hand' | 'table'; onto: DropTarget | null }> | null;
  /** How the hand is arranged (`ginRummy_sort`). */
  sort: SortMode;
  /** The card back drawn on every face-down card (`ginRummy_cardBack`, src/cardBack.ts). */
  cardBack: CardBack;
  /** `#arrangeOverlay` open. */
  arrangeOpen: boolean;
  /** `#discardsOverlay` open, and whether it greys the cards in my hand too. Session only. */
  discardsOpen: boolean;
  discardsWithHand: boolean;
}>;

export type App = ShellApp<Gin>;

// What a table leaves behind when a hand is dealt, left or lost: the ghost cell's stage, the kept
// picture and the melds made by hand all belong to the hand that just ended.
const HAND_CLEARED = { draw: null, picture: null, human: null, drag: null } as const;

export const initialTable: Table = {
  selectedCard: null,
  sandbox: { preset: DEFAULT_PRESET.id, map: DEFAULT_PRESET.map, error: null, helpOpen: false },
  resultDismissed: false,
  curtain: null,
  meldChooser: false,
  history: null,
  draw: null,
  picture: null,
  human: null,
  drag: null,
  sort: DEFAULT_SORT,
  cardBack: DEFAULT_CARD_BACK,
  arrangeOpen: false,
  discardsOpen: false,
  discardsWithHand: false,
};

export const SANDBOX_COPIED_MSG = 'Copied for the console';
/** The console call that deals `map`: what `#sbCopyBtn` copies. */
export const consoleCall = (map: string): string => `__gin.sandbox(\`${map}\`)`;
/** The sandbox mode shows while the first player is named `sandbox`. */
export const sandboxUnlocked = (app: App): boolean => unlocksSandbox(app.shell.p1Name);
// ---- the strings the table (not the shell, not the sessions) writes ---------------------------

export const FORCE_STOCK_MSG = 'Both players passed — you must draw from the stock.';
export const LOCKED_CARD_MSG = "You can't discard the card you just took from the discard pile.";
export const NO_MELD_MSG = 'No meld to make with that card.';
export const ONE_WAY_MSG = 'This hand can only be melded one way.';
// ---- intents -----------------------------------------------------------------------------------

/** What the legacy `initHome` read from storage, in one snapshot (`readHome`): the shell's keys and gin's (`Gin['Home']`: the sort, the card back, the Score Counter session). */
export type HomeSnapshot = SharedHomeSnapshot<Gin>;

/** The table's half of `Intent`: gin's own, after the shell's 43 (web/shared/ui/shell.ts `ShellIntent`). */
export type TableIntent =
  // ---- a card dragged by hand (ui/hand/dragger.ts) ----
  /** The pointer moved off a pressed card: a loose card of the hand, or a laid-off card on the table (§7b). */
  | Readonly<{ type: 'card/dragStart'; cardId: string; from?: 'hand' | 'table' }>
  /** The pointer is over loose index `index`: the card moves there, the order is manual from now on. */
  | Readonly<{ type: 'card/dragOver'; index: number }>
  /** The pointer is over the knocker's meld `onto` (null: over none): lit when the card fits it. */
  | Readonly<{ type: 'card/dragOnto'; onto: DropTarget | null }>
  /**
   * The drag ended with the pointer over meld `over` (null: over none): a hand card over a meld it
   * fits is laid off, a table card released off the melds is taken back, else the card shows again.
   */
  | Readonly<{ type: 'card/dragEnd'; over?: DropTarget | null }>
  /** `__gin.cardBack(name)` (the console, for now): a valid preset is shown and remembered. */
  | Readonly<{ type: 'cardBack/set'; back: CardBack }>
  // ---- the sandbox (src/sandbox.ts), shown while the first player is named `sandbox` ----
  /** `#sbPreset`: a preset's map into the editor. */
  | Readonly<{ type: 'sandbox/preset'; id: string }>
  /** `#sbMap` input. */
  | Readonly<{ type: 'sandbox/typed'; value: string }>
  /** `#sbRandomBtn`, or `random` in `#sbPreset`: a fresh deal from the rng into the editor. */
  | Readonly<{ type: 'sandbox/random' }>
  | Readonly<{ type: 'sandbox/help'; open: boolean }>
  /** `#sbCopyBtn`: the map as a console call to the clipboard. */
  | Readonly<{ type: 'sandbox/copy' }>
  /**
   * `#sbStartBtn` (the names from the pass-and-play inputs) or the console's `__gin.sandbox(map)`
   * (no names: Player 1 and Player 2): the map dealt as a pass-and-play game, or its error shown.
   */
  | Readonly<{ type: 'sandbox/start'; map: string; p1?: string; p2?: string }>
  | Readonly<{ type: 'rules/open' }>
  | Readonly<{ type: 'rules/close' }>
  | Readonly<{ type: 'history/open'; who: 'game' | 'scorer' }>
  | Readonly<{ type: 'history/close' }>
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
  /** `#discardsBtn`, `#closeDiscardsBtn`, `#discardsHandToggle`. */
  | Readonly<{ type: 'discards/open' }>
  | Readonly<{ type: 'discards/close' }>
  | Readonly<{ type: 'discards/toggleHand' }>
  /** `#arrangeBtn`. */
  | Readonly<{ type: 'arrange/open' }>
  | Readonly<{ type: 'arrange/close' }>
  /** A sort mode in `#arrangeOverlay`: remembered, and the hand arranged by it now. */
  | Readonly<{ type: 'hand/arrange'; mode: SortMode }>
  /** A card's pointerdown: the long-press timer starts. */
  | Readonly<{ type: 'card/press'; cardId: string }>
  | Readonly<{ type: 'card/release' }>
  /** The long press fired: a meld with the card by hand, or that meld dissolved. */
  | Readonly<{ type: 'hand/mark'; cardId: string }>;

/**
 * Every handler and every network event: the shell's intents (backgammon's list under gin's
 * names, docs/design/shared-shell.md §4.2; the shared reducer's since C2) and the table's,
 * including gin's own `cardBack/set`, the sandbox editor and the rules and history sheets.
 */
export type Intent = SharedIntent<Gin>;
export type ShellIntent = SharedShellIntent<Gin>;

// ---- effects -----------------------------------------------------------------------------------

/** Gin's own effects, handled by `runEffect` before the shared runner: two table preferences, the Score Counter, the clipboard. */
export type TableEffect =
  | Readonly<{ type: 'writeSort'; sort: SortMode }>
  | Readonly<{ type: 'writeCardBack'; back: CardBack }>
  /** `window.__scorer.resume()`: the resume box's Score Counter session. */
  | Readonly<{ type: 'scorer'; call: 'resume' }>
  /** `text` to the clipboard (`#sbCopyBtn`: the sandbox map as a console call). */
  | Readonly<{ type: 'copy'; text: string }>;

export type Effect = SharedEffect<Gin>;

export type TimerId = SharedTimerId<Gin>;

export type Step = SharedStep<Gin>;

export type Context = Ctx;

/**
 * A refused move: the toast, and a draw that was awaited never leaves the ghost slot pending. A
 * `shown` stage is kept: only `__gin.act` can send a move the engine refuses while the drawn card
 * sits in the ghost cell (the undo of a stock draw, say), and the card must not collapse into the
 * hand over a toast (docs/design/gin-arrangement-and-discards.md §4).
 */
const refuse = (app: App, message: string): Step =>
  step(app.table.draw?.kind === 'waiting' ? withTable(app, { draw: null }) : app, toast(message));
// ---- helpers, as the legacy had them ------------------------------------------------------------
const withSandbox = (app: App, over: Partial<Sandbox>): App =>
  withTable(app, { sandbox: { ...app.table.sandbox, ...over } });
/**
 * After a name is typed (the shell's `name/typed`/`p1name/typed` set `p1Name`): a sandbox that the
 * name no longer unlocks falls back to pass-and-play. Gin's alone, so `reduce` runs it after the
 * shell's own step (docs/design/shared-shell.md §4.3.2).
 */
const withP1Name = (app: App): App =>
  app.shell.playMode === 'sandbox' && !unlocksSandbox(app.shell.p1Name)
    ? withShell(app, { playMode: 'local' })
    : app;
/**
 * The state side of the legacy `render()`: nothing without a view; else the cue machine steps
 * (its cue is played), the opponent's pickup chimes when `prev` (the view this one replaces, given
 * by a host broadcast and a guest's state frame; never on one phone) shows they just drew, the
 * screen is the table or, at gameOver, the end screen, a selection that left the hand is dropped,
 * and the draw stage, then the picture, settle against the view. The paint itself is main.ts's
 * after every intent.
 */
const rendered = (app: App, prev: View | null = null): Step => {
  const view = app.shell.view;
  if (view === null) return pure(app);
  const cued = nextCue(app.shell.cues, view, app.shell.role === 'local' ? 'local' : 'online');
  const drew = app.shell.role === 'local' ? null : oppDrawCue(prev, view);
  const selectedCard = selectionIn(view, app.table.selectedCard);
  const screen: ScreenId = view.phase === 'gameOver' ? 'endgameScreen' : 'tableScreen';
  const draw = settleDraw(app.table.draw, view);
  const picture = settlePicture(app.table.picture, view, draw, () =>
    arrangedOf(view, draw, app.table.human, app.table.sort, app.table.picture),
  );
  return step(
    withTable(withShell(app, { cues: cued.state, screen }), { selectedCard, draw, picture }),
    ...(cued.cue === null ? [] : [{ type: 'fx', cue: cued.cue } as const]),
    ...(drew === null ? [] : [{ type: 'fx', cue: drew } as const]),
    { type: 'scrollTop' },
  );
};
// ---- flows -------------------------------------------------------------------------------------
/** `localAct(action)`: `ready` is applied for both seats; anything else for the mover. */
const localAct = (app: App, action: Action, ctx: Context): Step => {
  const game = app.shell.game;
  if (game === null) return pure(app);
  if (action.type === 'ready') {
    const r1 = applyAction(game, 0, action, ctx.rng, ctx.now);
    const g1 = r1.ok ? r1.value : game;
    const r2 = applyAction(g1, 1, action, ctx.rng, ctx.now);
    if (!r1.ok && !r2.ok) return refuse(app, r1.error);
    return localBroadcast(
      withTable(withShell(app, { game: r2.ok ? r2.value : g1 }), { resultDismissed: false }),
      false,
      ctx,
      GIN,
    );
  }
  const res = applyAction(game, game.turn, action, ctx.rng, ctx.now);
  if (!res.ok) return refuse(app, res.error);
  return localBroadcast(
    withTable(withShell(app, { game: res.value }), { resultDismissed: false }),
    false,
    ctx,
    GIN,
  );
};
/**
 * `act(action)`: a tap, then by role. A draw (the stock, the discard pile, the upcard) first opens
 * the ghost cell for the card, so the ten cards on screen keep their places until the player
 * accepts it (docs/design/gin-draw-ghost-slot.md §3); the stage settles in `rendered` or clears in
 * `refuse`.
 * A second draw while one is `waiting` (a guest's round trip: the view stays in the draw phase
 * until the host's state frame lands) is ignored, or the host would refuse the duplicate with a
 * toast that clears the stage and collapses the ghost card without the player's accept tap.
 */
const act = (app: App, action: Action, ctx: Context): Step => {
  const from = drawSource(action);
  if (from !== null && app.table.draw?.kind === 'waiting') return pure(app);
  const held: App =
    from !== null && app.shell.view !== null
      ? withTable(app, { draw: { kind: 'waiting', from } })
      : app;
  return then(step(held, { type: 'fx', cue: 'tap' }), (a) => {
    switch (a.shell.role) {
      case 'local':
        return localAct(a, action, ctx);
      case 'host':
        return hostDispatch(a, 0, action, ctx, GIN);
      case 'guest':
      case null:
        // The legacy tested `app.conn && app.conn.open`; a guest's channel is open exactly while
        // the host counts as connected (set on open, cleared on close), and no role has no channel.
        return a.shell.role === 'guest' && a.shell.oppConnected
          ? step(a, { type: 'send', frame: actionFrame(action) })
          : refuse(a, NOT_CONNECTED_MSG);
    }
  });
};
/** The resume box `initHome` showed, in the legacy order of precedence, or null: the Score Counter's session first, then the shell's three save roles. */
export const resumeFor = (save: Save | null, scorer: ScorerState | null): Resume | null =>
  scorer !== null ? { kind: 'scorer', state: scorer } : shellResumeFor(save, GIN);
/** `#resumeBtn`'s label for a resume offer. */
export const resumeLabel = (resume: Resume): string => {
  switch (resume.kind) {
    case 'scorer':
      return `Resume scoring: ${resume.state.players.map((p) => p.name).join(' vs ')}`;
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

/** A `data-act` button. */
const actionClick = (app: App, which: string, ctx: Context): Step => {
  switch (which) {
    case 'passUpcard':
    case 'takeUpcard':
    case 'undoDraw':
      return act(app, { type: which }, ctx);
    case 'discard':
    case 'knock':
      return app.table.selectedCard === null
        ? pure(app)
        : act(app, { type: which, cardId: app.table.selectedCard }, ctx);
    case 'showResult':
      return pure(withTable(app, { resultDismissed: false }));
    case 'finishLayoff':
      return act(app, { type: 'finishLayoff' }, ctx);
    default:
      return pure(app);
  }
};

/**
 * Whether the hand card `cardId` may be dropped on the discard pile (§5d): my discard phase, no
 * drawn card waiting in the ghost cell, and not the card just taken from the pile (the legacy's lock).
 * The painter lights the pile and the Discard button with it while the card is dragged.
 */
export const canDropDiscard = (app: App, v: View, cardId: string): boolean =>
  v.isMyTurn &&
  v.phase === 'discard' &&
  app.table.draw === null &&
  v.drawnFromDiscard !== cardId &&
  v.me.hand.some((c) => c.id === cardId);

/** Whether the defender's card `cardId` fits the knocker's meld `onto` as extended so far (§7b). */
const fitsMeld = (v: View, cardId: string, onto: number | null): boolean => {
  const lo = v.layoff;
  const card = v.me.hand.find((c) => c.id === cardId);
  const meld = onto === null || lo === undefined ? undefined : lo.extended[onto];
  return v.isMyTurn && card !== undefined && meld !== undefined && fitsOnto(card, meld);
};
// ---- the table's reducer ---------------------------------------------------------------------
const tableIntent = (app: App, intent: TableIntent, ctx: Context): Step => {
  switch (intent.type) {
    case 'cardBack/set':
      return step(withTable(app, { cardBack: intent.back }), {
        type: 'writeCardBack',
        back: intent.back,
      });
    // ---- the sandbox ----
    case 'sandbox/preset': {
      const preset = presetById(intent.id);
      return preset === null
        ? pure(app)
        : pure(withSandbox(app, { preset: preset.id, map: preset.map, error: null }));
    }
    case 'sandbox/typed':
      return pure(withSandbox(app, { preset: '', map: intent.value, error: null }));
    case 'sandbox/random':
      return pure(
        withSandbox(app, { preset: 'random', map: formatMap(randomMap(ctx.rng)), error: null }),
      );
    case 'sandbox/help':
      return pure(withSandbox(app, { helpOpen: intent.open }));
    case 'sandbox/copy':
      return step(
        app,
        { type: 'copy', text: consoleCall(app.table.sandbox.map) },
        toast(SANDBOX_COPIED_MSG),
      );
    case 'sandbox/start': {
      const parsed = parseMap(intent.map);
      if (!parsed.ok) return pure(withSandbox(app, { map: intent.map, error: parsed.error }));
      const game = dealMap(parsed.value, localPlayers(intent.p1 ?? '', intent.p2 ?? ''), ctx.now);
      const human: HumanMelds | null =
        parsed.value.melds.length === 0
          ? null
          : { hand: game.handNumber, groups: parsed.value.melds.map(idsOf) };
      // `startLocal` with the map's hand-made melds seated between the table's reset and the
      // first broadcast, where the shared flow has no slot for them (shared-shell.md §4.3.2).
      const seated = withTable(
        localSeated(withSandbox(app, { map: intent.map, error: null }), game, GIN),
        { human },
      );
      return then(step(seated, { type: 'wakeLock', hold: true }), (a) =>
        localBroadcast(a, true, ctx, GIN),
      );
    }
    case 'rules/open':
      return pure(withShell(app, { rulesOpen: true }));
    case 'rules/close':
      return pure(withShell(app, { rulesOpen: false }));
    case 'history/open':
      return pure(withTable(app, { history: intent.who }));
    case 'history/close':
      return pure(withTable(app, { history: null }));
    // ---- the table ----
    case 'act':
      return act(app, intent.action, ctx);
    case 'card/tap': {
      const v = app.shell.view;
      // The click a drag's release fires reaches a card: a drag selects nothing.
      if (app.table.drag !== null) return pure(app);
      if (v === null || !v.isMyTurn || v.phase !== 'discard') return pure(app);
      if (app.table.draw?.kind === 'shown') {
        // A tap on the ghost card accepts it; a tap on a held card accepts and selects that card
        // in one go (a tap on a held card is an action by the owner's rule: cards may move now).
        const accepted: App =
          app.table.draw.cardId === intent.cardId
            ? withTable(app, { draw: null })
            : withTable(app, { draw: null, selectedCard: intent.cardId });
        return then(step(accepted, { type: 'fx', cue: 'tap' }), rendered);
      }
      if (v.drawnFromDiscard === intent.cardId) return step(app, toast(LOCKED_CARD_MSG));
      const selectedCard = app.table.selectedCard === intent.cardId ? null : intent.cardId;
      return then(step(withTable(app, { selectedCard }), { type: 'fx', cue: 'tap' }), rendered);
    }
    case 'stock/tap': {
      const v = app.shell.view;
      return v !== null && v.isMyTurn && v.phase === 'draw'
        ? act(app, { type: 'drawStock' }, ctx)
        : pure(app);
    }
    case 'discard/tap': {
      const v = app.shell.view;
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
      return pure(withTable(app, { resultDismissed: true }));
    case 'meld/open': {
      const v = app.shell.view;
      if (v === null || v.meldOptions.length < 2) return pure(app);
      return step(withTable(app, { meldChooser: true }), { type: 'fx', cue: 'tap' });
    }
    case 'meld/close':
      return pure(withTable(app, { meldChooser: false }));
    case 'meld/choose': {
      const v = app.shell.view;
      const option = v?.meldOptions[intent.index];
      if (v === null || option === undefined) return pure(app);
      // The pick becomes hand-made, so it outlives the engine's declaration (arrange.ts), and the
      // picture is dropped so the paint after the move is that arrangement.
      const groups = option.melds.map(idsOf);
      const human: HumanMelds = { hand: v.handNumber, groups };
      return act(
        withTable(app, { meldChooser: false, picture: null, human }),
        { type: 'setMelds', melds: groups },
        ctx,
      );
    }
    case 'arrange/open': {
      // Never while the drawn card waits in the ghost cell: the ten on the table have no melding
      // of their own then. Either player's turn otherwise (UI only).
      const v = app.shell.view;
      return v === null || !inPlay(v.phase) || app.table.draw !== null
        ? pure(app)
        : step(withTable(app, { arrangeOpen: true }), { type: 'fx', cue: 'tap' });
    }
    case 'arrange/close':
      return pure(withTable(app, { arrangeOpen: false }));
    case 'discards/open':
      return app.shell.view?.discardIds === undefined
        ? pure(app)
        : step(withTable(app, { discardsOpen: true }), { type: 'fx', cue: 'tap' });
    case 'discards/close':
      return pure(withTable(app, { discardsOpen: false }));
    case 'discards/toggleHand':
      return pure(withTable(app, { discardsWithHand: !app.table.discardsWithHand }));
    case 'hand/arrange': {
      const v = app.shell.view;
      const chosen: App = withTable(app, { sort: intent.mode, arrangeOpen: false });
      const remembered: Effect = { type: 'writeSort', sort: intent.mode };
      if (v === null || !inPlay(v.phase) || app.table.draw !== null)
        return step(chosen, remembered);
      return then(
        step(
          withTable(chosen, {
            picture: arrangedOf(v, null, app.table.human, intent.mode, app.table.picture),
          }),
          remembered,
          {
            type: 'fx',
            cue: 'tap',
          },
        ),
        rendered,
      );
    }
    case 'card/dragStart': {
      const v = app.shell.view;
      if (v === null || !inPlay(v.phase) || app.table.draw !== null) return pure(app);
      const from = intent.from ?? 'hand';
      if (from === 'table') {
        // A laid-off card comes back only while the defender answers and its meld stays a meld.
        const lo = v.layoff;
        const free =
          lo !== undefined && v.isMyTurn && canTakeBack(lo.melds, lo.laidOff, intent.cardId);
        return free
          ? pure(withTable(app, { drag: { cardId: intent.cardId, from, onto: null } }))
          : pure(app);
      }
      // A loose card: its cell empties and the long press is off.
      const loose = app.table.picture?.loose.some((c) => c.id === intent.cardId) === true;
      if (!loose) return pure(app);
      return step(withTable(app, { drag: { cardId: intent.cardId, from, onto: null } }), {
        type: 'cancelTimer',
        id: 'cardPress',
      });
    }
    case 'card/dragOver': {
      const d = app.table.drag;
      if (d?.from !== 'hand' || d.onto !== null || app.table.picture === null) return pure(app);
      const moved = moveLoose(app.table.picture, d.cardId, intent.index);
      if (samePicture(moved, app.table.picture)) return pure(app);
      // A card moved by hand makes the order manual, remembered once.
      return step(
        withTable(app, { picture: moved, sort: 'manual' }),
        ...(app.table.sort === 'manual' ? [] : [{ type: 'writeSort', sort: 'manual' } as const]),
      );
    }
    case 'card/dragOnto': {
      const d = app.table.drag;
      const v = app.shell.view;
      if (d === null || v === null) return pure(app);
      // Only a target the card may go to lights up: a meld it fits, or the discard pile when the
      // card may be discarded; a laid-off card back over the melds lights none.
      const onto: DropTarget | null =
        d.from !== 'hand'
          ? null
          : intent.onto === 'discard'
            ? canDropDiscard(app, v, d.cardId)
              ? 'discard'
              : null
            : fitsMeld(v, d.cardId, intent.onto)
              ? intent.onto
              : null;
      return onto === d.onto ? pure(app) : pure(withTable(app, { drag: { ...d, onto } }));
    }
    case 'card/dragEnd': {
      const d = app.table.drag;
      if (d === null) return pure(app);
      const cleared: App = withTable(app, { drag: null });
      const over = intent.over ?? null;
      // Released on the discard pile, the card is discarded as the Discard button would (§5d).
      if (
        d.from === 'hand' &&
        over === 'discard' &&
        app.shell.view !== null &&
        canDropDiscard(app, app.shell.view, d.cardId)
      )
        return act(
          withTable(cleared, { selectedCard: null }),
          { type: 'discard', cardId: d.cardId },
          ctx,
        );
      if (
        d.from === 'hand' &&
        typeof over === 'number' &&
        app.shell.view !== null &&
        fitsMeld(app.shell.view, d.cardId, over)
      )
        return act(cleared, { type: 'layOff', cardId: d.cardId, onto: over }, ctx);
      if (d.from === 'table' && over === null)
        return act(cleared, { type: 'takeBack', cardId: d.cardId }, ctx);
      return pure(cleared);
    }
    case 'card/press': {
      // The App is returned as is: main.ts skips the paint, so the pressed element survives to
      // receive its click (a plain tap) or the timer below (a long press).
      const v = app.shell.view;
      if (v === null || !inPlay(v.phase) || app.table.draw !== null) return pure(app);
      return step(app, {
        type: 'startTimer',
        id: 'cardPress',
        ms: LONG_PRESS_MS,
        then: { type: 'hand/mark', cardId: intent.cardId },
      });
    }
    case 'card/release':
      return step(app, { type: 'cancelTimer', id: 'cardPress' });
    case 'hand/mark': {
      const v = app.shell.view;
      if (v === null || !inPlay(v.phase) || app.table.draw !== null) return pure(app);
      const human = toggleMeld(app.table.human, v.handNumber, v.me.hand, intent.cardId);
      if (human === null) return step(app, toast(NO_MELD_MSG));
      // The repaint replaces the pressed card's element, so the click that ends the press never
      // reaches a card: a long press selects nothing.
      const picture = arrangedOf(v, null, human, app.table.sort, app.table.picture);
      const marked: App = withTable(app, { human, picture, selectedCard: null });
      // Declared to the engine too when it scores as well as the solver, so a knock lays off
      // against these melds; a worse arrangement stays a picture and the knock counts the best.
      const groups = declarable(v.me.hand, picture);
      return groups === null
        ? then(step(marked, { type: 'fx', cue: 'tap' }), rendered)
        : act(marked, { type: 'setMelds', melds: groups }, ctx);
    }
  }
};

// ---- the shell's hooks into the table, and the config (docs/design/shared-shell.md §4.3) ---------

/**
 * What the table drops where a shared flow resets it, site by site as the legacy did there
 * (§4.3.2): a hand's start, a deal, a leave and the host lost clear the hand (`HAND_CLEARED`), the
 * leave also the sheets left open on the table; the handoff keeps the picture, the hand-made melds
 * and a drag (the hand goes on as a hosted room) and clears only the pass-and-play marks; a new
 * view drops the selection, an applied action re-shows the result sheet, a guest's `state` frame
 * does both.
 */
const reset = (table: Table, at: TableReset): Table => {
  switch (at) {
    case 'startLocal':
    case 'deal':
      return { ...table, resultDismissed: false, ...HAND_CLEARED };
    case 'handoff':
      return { ...table, selectedCard: null, curtain: null, meldChooser: false, draw: null };
    case 'leave':
      return { ...table, curtain: null, meldChooser: false, ...HAND_CLEARED };
    case 'lost':
      return { ...table, ...HAND_CLEARED };
    case 'view':
      return { ...table, selectedCard: null };
    case 'applied':
      return { ...table, resultDismissed: false };
    case 'frame':
      return { ...table, selectedCard: null, resultDismissed: false };
  }
};

/**
 * `localBroadcast`'s seat: the mover's view while a hand is in play, the revealed player's (or
 * seat 0's) otherwise; the curtain comes up when the phone must change hands. Nothing else is
 * handed over (backgammon toasts its hits here).
 */
const viewer: ShellConfig<Gin>['local']['viewer'] = (app, game) => {
  const playing = inPlay(game.phase);
  const seat: Seat = playing ? game.turn : (app.shell.revealed ?? 0);
  return {
    seat,
    curtain: playing && app.shell.revealed !== game.turn ? game.turn : null,
    effects: [],
  };
};

/** `curtain/reveal`: the mover lifts the curtain; nothing to tell them. */
const revealer: ShellConfig<Gin>['local']['revealer'] = (game) => ({
  seat: game.turn,
  effects: [],
});

/** Gin's shell config: shellConfig.ts's half completed with the table hooks and the home snapshot's own part (the sort and the card back onto the table; the Score Counter's offer first). */
export const GIN: ShellConfig<Gin> = {
  ...GIN_SHELL,
  table: { initial: initialTable, reset, rendered, refuse },
  local: { viewer, revealer },
  home: {
    ...GIN_SHELL.home,
    apply: (app, home) => withTable(app, { sort: home.sort, cardBack: home.cardBack }),
    resume: (home) => resumeFor(home.save, home.scorer),
    resumeExtra: (app) => step(app, { type: 'scorer', call: 'resume' }),
  },
};

export const initialShell: Shell = shellInitial(GIN);

export const initialApp: App = { shell: initialShell, table: initialTable };

// ---- the reducer -------------------------------------------------------------------------------

export const reduce = (app: App, intent: Intent, ctx: Context): Step => {
  if (!isShellIntent(intent)) return tableIntent(app, intent, ctx);
  const s = reduceShell(app, intent, ctx, GIN);
  // The typed first name unlocks or locks the sandbox mode: gin's alone, after the shell's step.
  return intent.type === 'name/typed' || intent.type === 'p1name/typed'
    ? { ...s, app: withP1Name(s.app) }
    : s;
};

// ---- storage: persist and resume -------------------------------------------------------------

/** `persist()`: the save for the current role, or null when there is nothing to save. */
export const saveFor = (app: App): Save | null => shellSaveFor(app.shell);

/** `initHome`'s reads: the names, the tab and mode (defaults when unreadable), the save, the scorer session. */
export const readHome = (store: Store): HomeSnapshot => shellReadHome(store, GIN);

// ---- what the sessions read back ---------------------------------------------------------------

export const hostContextOf = (app: App): HostContext => shellHostContextOf(app.shell);

export const guestContextOf = (app: App): GuestContext => shellGuestContextOf(app.shell);

// ---- running the effects -----------------------------------------------------------------------

/** The adapters an effect reaches: the shell's (web/shared/ui/shellEffects.ts) plus gin's Score Counter and clipboard; main.ts constructs the real ones, tests record. */
export type EffectDeps = ShellEffectDeps<Gin> &
  Readonly<{
    scorer: Readonly<{ resume: () => void }>;
    /** `text` to the clipboard, silently (the reducer toasts). */
    copy: (text: string) => void;
  }>;

/** One effect against the adapters; `app` is the state after the step that produced it. Gin's four first, then the shell's runner. */
export const runEffect = (app: App, effect: Effect, deps: EffectDeps): void => {
  if (isShellEffect(effect)) {
    runShellEffect(app.shell, effect, deps, GIN);
    return;
  }
  switch (effect.type) {
    case 'writeSort':
      writeSort(deps.store, effect.sort);
      return;
    case 'writeCardBack':
      writeCardBack(deps.store, effect.back);
      return;
    case 'scorer':
      deps.scorer[effect.call]();
      return;
    case 'copy':
      deps.copy(effect.text);
      return;
  }
};
