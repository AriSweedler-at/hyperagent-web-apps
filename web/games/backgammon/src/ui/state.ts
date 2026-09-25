// The Sheshbesh app as a reducer over intents (docs/design/backgammon-board.md §4 "The interaction
// model", §5 "The shell"; docs/ARCHITECTURE.md "Module boundaries": imported only by main.ts, the
// painters and tests). `App` is gin's shape split in two (design §5.3): `shell` is the home screen,
// the waiting rooms, the session (role, code, names, the engine `State` for the host and
// pass-and-play, my `View` for every role) and the resume offer, the record the shared shell
// reducer owns since docs/design/shared-shell.md §5 C2 (web/shared/ui/shell.ts `reduceShell`,
// over the config `BACKGAMMON` below: shellConfig.ts's half, the id, names, tabs, copy, option
// codec, engine adapters, frames and store, completed here with the table hooks the shared flows
// call: `reset` per site, `rendered`, `refuse`, pass-and-play's `viewer`/`revealer`, and the home
// snapshot's own part); `table` is the board's interaction memory (the tapped source, the forced
// die, the die-chip tray, a drag, the overlays, the curtain and the R14 beat), which no other game
// has. `Intent` is every handler and every network event, and `reduce` returns the next App with
// a list of `Effect`s: what to persist, toast, send, play or arm, as data. main.ts runs the
// effects through the real adapters (`runEffect`: backgammon's three, then the shared runner) and
// paints the App (ui/render.ts); the tests run the reducer alone.
//
// Backgammon's residue on the shell (shared-shell.md §4.3): the two option selects
// (`variant/set`, `matchLength/set`, its own intents), `curtainMode` and its effect, and a guest
// whose match is over when the host drops (`hostLeft`, taken in `reduce` before the shell's
// `guest/lost`, which knows no ending but the wait screen).
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
import {
  GONE_TOAST_MS,
  NOT_CONNECTED_MSG,
  andThen as then,
  broadcast,
  fresh as freshKey,
  guestContextOf as shellGuestContextOf,
  hostContextOf as shellHostContextOf,
  initialShell as shellInitial,
  isShellEffect,
  isShellIntent,
  localBroadcast,
  pure,
  readHome as shellReadHome,
  reduceShell,
  resumeFor as shellResumeFor,
  saveFor as shellSaveFor,
  step,
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
  type Role,
  type ShellState,
  type Step as SharedStep,
  type TableReset,
  type TimerId as SharedTimerId,
} from '../../../../shared/ui/shell.ts';
import { runShellEffect, type ShellEffectDeps } from '../../../../shared/ui/shellEffects.ts';
import { ok, type Result } from '../../../../shared/lib/result.ts';
import {
  actorOf,
  applyAction,
  createGame,
  isShippedVariant,
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
  PlayedMove,
  PointIndex,
  Seat,
  ShippedVariant,
  State,
  To,
  View,
} from '../engine/types.ts';
import type { GuestContext } from '../net/guest.ts';
import type { HostContext } from '../net/host.ts';
import { action as actionFrame } from '../protocol.ts';
import { BACKGAMMON_SHELL, parseMatchLength } from '../shellConfig.ts';
import {
  DEFAULT_PLAY_MODE,
  HOME_TABS,
  writeCurtainMode,
  writeMatchLength,
  writeVariant,
  type CurtainMode,
  type HomeTab,
  type HostExtra,
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
import { INITIAL_CUES, type Cue, type CueState } from './sound.ts';

// The shell's strings and helpers the tests and painters import from here, as before C2.
export {
  DISCONNECTED_MSG,
  GONE_TOAST_MS,
  LONG_PRESS_MS,
  LOST_HOST_MSG,
  NOT_CONNECTED_MSG,
  OPPONENT_LEFT_MSG,
  ROOM_FULL_MSG,
  SANDBOX_LOCAL_ONLY_MSG,
  SHELL_INTENT_TYPES,
  WAITING_FOR_GUEST_MSG,
  badPositionMsg,
  guestGoneMsg,
  joinedMsg,
  type Role,
  type WaitStatus,
} from '../../../../shared/ui/shell.ts';
export {
  DEFAULT_NAME,
  LEAVE_LOCAL_MSG,
  LEAVE_ONLINE_MSG,
  hostRoomMsg,
  parseMatchLength,
  parseVariant,
} from '../shellConfig.ts';
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
/** The five top-level screens `showScreen` toggles between (design §4 `SCREENS`). */
export const SCREENS = [
  'homeScreen',
  'hostWaitScreen',
  'guestWaitScreen',
  'tableScreen',
  'endgameScreen',
] as const;
export type ScreenId = (typeof SCREENS)[number];

/** What the home screen's resume box offers (`resumeFor`), one per save role (web/shared/ui/shell.ts `ShellResume`; backgammon adds none). */
export type Resume = SharedResume<Backgammon>;

// The cue memory (`CueState`, the shared `CueMemory` since dry-round-2.md F6; `INITIAL_CUES`) lives in ui/sound.ts since C2: the shell config reads it too.
export { INITIAL_CUES, type CueState };

/**
 * Backgammon's types for the shared shell (web/shared/ui/shell.ts `ShellTypes`): the room's terms
 * are the match length and the variant (the host save's own fields, storage.ts `HostExtra`, and
 * the welcome frame's `Room`), the raw options off the inputs are the two selects' values when the
 * binder passes them, the modes are the two stored ones, no resume offer beyond the three roles,
 * `initHome` also reads the options and the curtain mode, and the table's own intents and effects
 * are the unions below.
 */
export type Backgammon = Readonly<{
  Opts: HostExtra;
  Raw: Readonly<{ matchLength?: string; variant?: string }>;
  State: State;
  View: View;
  Action: Action;
  Table: Table;
  Tab: HomeTab;
  Mode: PlayMode;
  Screen: ScreenId;
  Timer: 'shake' | 'noMove' | 'tumble';
  Cue: Cue;
  Cues: CueState;
  Resume: never;
  Home: Readonly<{ variant: ShippedVariant; matchLength: number; curtainMode: CurtainMode }>;
  Intent: TableIntent;
  Effect: TableEffect;
  Store: Store;
}>;

/**
 * Everything but the board's own interaction: gin's `App` fields under gin's names (design §4),
 * with `opts: { matchLength, variant }` where gin has `{ target }`. `game` and `view` sit here
 * too: the shell owns the session (who plays, from which device), the table only remembers taps.
 * Since C2 the record is the shared shell reducer's (`ShellState`).
 */
export type Shell = ShellState<Backgammon>;

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

export type App = ShellApp<Backgammon>;

export const DEFAULT_CURTAIN_MODE: CurtainMode = 'always';

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
// ---- the strings the app (not the sessions) writes ---------------------------------------------

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
/** `guest/lost` once the match is over: the host closed the room, there is nothing to rejoin. */
export const hostLeftMsg = (hostName: string): string => `${hostName} left the table.`;
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

/** What `initHome` reads from storage, in one snapshot (`readHome`): the shell's keys and backgammon's (`Backgammon['Home']`: the options and the curtain mode). */
export type HomeSnapshot = SharedHomeSnapshot<Backgammon>;

/**
 * The table's half of `Intent` (design §4.1), and the two option selects: backgammon's own, after
 * the shell's 44 (web/shared/ui/shell.ts `ShellIntent`; `setup(state)` is its `position/load`
 * since dry-round-2.md F5).
 */
export type TableIntent =
  /** `#variantSel` / `#localVariantSel`: a shipped variant is remembered; anything else is ignored. */
  | Readonly<{ type: 'variant/set'; variant: string }>
  /** `#matchLengthSel` / `#localMatchLengthSel`: one of MATCH_LENGTHS is remembered; anything else is ignored. */
  | Readonly<{ type: 'matchLength/set'; length: number | string }>
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
  /** `#rollModalBtn` (design §4.7) and `#dice` before the roll. */
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
  /** The `noMove` timer fired: the forfeited roll has been seen. */
  | Readonly<{ type: 'noMove/elapsed' }>
  /** The `shake` timer fired. */
  | Readonly<{ type: 'shake/elapsed' }>
  /** The `tumble` timer fired: the dice have settled (design §4.7). */
  | Readonly<{ type: 'tumble/elapsed' }>;

/** Every handler and every network event: the shell's intents (gin's names) and the table's. */
export type Intent = SharedIntent<Backgammon>;
export type ShellIntent = SharedShellIntent<Backgammon>;

// ---- effects -----------------------------------------------------------------------------------

export type TimerId = SharedTimerId<Backgammon>;

/** Backgammon's own effects, handled by `runEffect` before the shared runner: the three preferences the home screen and the menu remember. */
export type TableEffect =
  | Readonly<{ type: 'writeVariant'; variant: ShippedVariant }>
  | Readonly<{ type: 'writeMatchLength'; length: number }>
  | Readonly<{ type: 'writeCurtainMode'; mode: CurtainMode }>;

export type Effect = SharedEffect<Backgammon>;

export type Step = SharedStep<Backgammon>;

export type Context = Ctx;

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
const rendered = (app: App, prev: View | null, ctx: Context): Step => {
  const view = app.shell.view;
  if (view === null) return pure(app);
  // Once per position (the shared `fresh`, dry-round-2.md F6): a re-sent frame plays nothing.
  const { mem, fresh: changed } = freshKey(app.shell.cues, viewKey(view));
  const since = changed && prev !== null;
  const cues = since ? cuesBetween(prev, view, app.shell.role) : [];
  // A roll that just arrived (mine, or the other seat's) tumbles for TUMBLE_MS (design §4.7); a
  // tumble already running (the guest's, started at the click) restarts with the faces.
  const rolled = since && rolledBetween(prev, view);
  // Pass-and-play toasts the player hit when the phone reaches them (`handedHits`), not here.
  const hitToasts = since && app.shell.role !== 'local' ? hitToastsBetween(prev, view) : [];
  const beat = changed && freshNoMove(prev, view);
  const screen: ScreenId = view.matchOver ? 'endgameScreen' : 'tableScreen';
  const resultOpen = view.phase === 'over' ? prev?.phase !== 'over' || app.table.resultOpen : false;
  return step(
    {
      shell: { ...app.shell, cues: mem, screen },
      table: {
        ...settled(app.table, view),
        resultOpen,
        lastPainted: prev,
        noMoveUntil: beat ? ctx.now() + NO_MOVE_MS : app.table.noMoveUntil,
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
    ctx,
    BACKGAMMON,
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
      return broadcast(withShell(app, { game: res.value }), ctx, BACKGAMMON);
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
      return localBroadcast(
        withShell(app, { game: fresh, revealed: null }),
        false,
        ctx,
        BACKGAMMON,
      );
    case 'host':
      return broadcast(withShell(app, { game: fresh }), ctx, BACKGAMMON);
    case 'guest':
    case null:
      return pure(app);
  }
};
// ---- home, resume, leave ---------------------------------------------------------------------
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

// ---- the table's reducer ---------------------------------------------------------------------
const tableIntent = (app: App, intent: TableIntent, ctx: Context): Step => {
  const v = liveView(app);
  const t = app.table;
  switch (intent.type) {
    // ---- the two option selects: backgammon's own, into the shell's `opts` ----
    case 'variant/set':
      return isShippedVariant(intent.variant)
        ? step(withShell(app, { opts: { ...app.shell.opts, variant: intent.variant } }), {
            type: 'writeVariant',
            variant: intent.variant,
          })
        : pure(app);
    case 'matchLength/set': {
      const length = parseMatchLength(intent.length, 0);
      return length === 0
        ? pure(app)
        : step(withShell(app, { opts: { ...app.shell.opts, matchLength: length } }), {
            type: 'writeMatchLength',
            length,
          });
    }
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
    case 'noMove/elapsed': {
      const seen = withTable(app, { noMoveUntil: null });
      // Pass-and-play: the curtain now rises for the new mover; online the paint just re-reads.
      return app.shell.role === 'local' ? localBroadcast(seen, false, ctx, BACKGAMMON) : pure(seen);
    }
    case 'shake/elapsed':
      return pure(withTable(app, { shake: null }));
    case 'tumble/elapsed': {
      if (!t.rolling) return pure(app);
      // The dice have settled: a double earns its cue now, after the roll's (design §4.7, §5.1),
      // on both seats' tables alike (each runs the tumble the roll started).
      const view = app.shell.view;
      const last = view?.lastAction ?? null;
      const doubles =
        view?.dice !== null &&
        view?.dice !== undefined &&
        view.dice[0] === view.dice[1] &&
        last !== null &&
        (last.kind === 'roll' || last.kind === 'noMove');
      return step(
        withTable(app, { rolling: false }),
        ...(doubles ? [{ type: 'fx', cue: 'doubles' } as const] : []),
      );
    }
  }
};

// ---- the shell's hooks into the table, and the config (docs/design/shared-shell.md §4.3) ---------

/**
 * What the table drops where a shared flow resets it, site by site as before the move (§4.3.2): a
 * pass-and-play start, the handoff, a leave and the host lost clear everything but the curtain
 * setting (`tableCleared`); a new view (`broadcast`, `localBroadcast`) drops the taps and the tray;
 * a deal, an applied action and a guest's `state` frame touch nothing (`settled` runs in
 * `rendered`).
 */
const reset = (table: Table, at: TableReset): Table => {
  switch (at) {
    case 'startLocal':
    case 'handoff':
    case 'leave':
    case 'lost':
      return tableCleared(table);
    case 'view':
      return { ...table, selected: null, picked: null, pending: null };
    case 'deal':
    case 'applied':
    case 'frame':
      return table;
  }
};

/**
 * `localBroadcast`'s seat (design §4.9): the actor's view (the mover, or the seat answering a
 * double) while the game is on, the revealed seat's (or seat 0's) once it is over; the curtain
 * comes up when the phone must change hands. R14: a forfeited roll keeps the roller's view and the
 * curtain down until `noMove/elapsed`. With the curtain off the phone changes hands unannounced:
 * the seat now looking is told of the hits against them here; with it on, `curtain/reveal` tells
 * them once they have it.
 */
const viewer: ShellConfig<Backgammon>['local']['viewer'] = (app, game) => {
  const prev = app.shell.view;
  const actor = actorOf(game);
  const holding = freshNoMove(prev, viewFor(game, game.turn)) && app.table.noMoveUntil === null;
  const seat: Seat = holding ? otherSeat(game.turn) : (actor ?? app.shell.revealed ?? 0);
  const curtain =
    actor !== null && !holding && app.table.curtainMode === 'always' && app.shell.revealed !== seat
      ? seat
      : null;
  const effects =
    curtain === null && prev !== null && prev.me.idx !== seat ? handedHits(game, seat) : [];
  return { seat, curtain, effects };
};

/** `curtain/reveal`: whoever must act lifts the curtain and is told of the hits against them. */
const revealer: ShellConfig<Backgammon>['local']['revealer'] = (game) => {
  const seat = actorOf(game) ?? game.turn;
  return { seat, effects: handedHits(game, seat) };
};

/** Backgammon's shell config: shellConfig.ts's half completed with the table hooks and the home snapshot's own part (the options into the shell, the curtain mode onto the table). */
export const BACKGAMMON: ShellConfig<Backgammon> = {
  ...BACKGAMMON_SHELL,
  table: { initial: initialTable, reset, rendered, refuse },
  local: { viewer, revealer },
  home: {
    ...BACKGAMMON_SHELL.home,
    apply: (app, home) => ({
      shell: { ...app.shell, opts: { matchLength: home.matchLength, variant: home.variant } },
      table: { ...app.table, curtainMode: home.curtainMode },
    }),
    resume: (home) => resumeFor(home.save),
    resumeExtra: pure,
  },
};

export const initialShell: Shell = shellInitial(BACKGAMMON);

export const initialApp: App = { shell: initialShell, table: initialTable };

/**
 * `guest/lost` once the match is over: the result stays up; the session's rejoin finds a
 * destroyed Peer and the save would only offer a dead room, so both go. Backgammon's alone (the
 * shell's `guest/lost` knows the table mid-match and the wait screen), taken in `reduce` first.
 */
const hostLeft = (app: App, v: View, ctx: Context): Step => {
  const lost = { shell: { ...app.shell, oppConnected: false }, table: tableCleared(app.table) };
  return then(rendered(lost, v, ctx), (a) =>
    step(
      a,
      { type: 'closeNet' },
      { type: 'clearSave' },
      toast(hostLeftMsg(v.opp.name), GONE_TOAST_MS),
    ),
  );
};

export const reduce = (app: App, intent: Intent, ctx: Context): Step => {
  const v = app.shell.view;
  if (intent.type === 'guest/lost' && v?.matchOver === true) return hostLeft(app, v, ctx);
  return isShellIntent(intent)
    ? reduceShell(app, intent, ctx, BACKGAMMON)
    : tableIntent(app, intent, ctx);
};

// ---- storage: persist and resume -------------------------------------------------------------

/** The resume box `initHome` shows, or null (a finished match is not offered). */
export const resumeFor = (save: Save | null): Resume | null => shellResumeFor(save, BACKGAMMON);

/** `persist()`: the save for the current role, or null when there is nothing to save. */
export const saveFor = (app: App): Save | null => shellSaveFor(app.shell);

/** `initHome`'s reads: the names, the tab, mode and options (defaults when unreadable), the save. */
export const readHome = (store: Store): HomeSnapshot => shellReadHome(store, BACKGAMMON);

// ---- what the sessions read back ---------------------------------------------------------------

export const hostContextOf = (app: App): HostContext => shellHostContextOf(app.shell);

export const guestContextOf = (app: App): GuestContext => shellGuestContextOf(app.shell);

// ---- running the effects -----------------------------------------------------------------------

/** The adapters an effect reaches: the shell's (web/shared/ui/shellEffects.ts); backgammon adds none. main.ts constructs the real ones, tests record. */
export type EffectDeps = ShellEffectDeps<Backgammon>;

/** One effect against the adapters; `app` is the state after the step that produced it. Backgammon's three first, then the shell's runner. */
export const runEffect = (app: App, effect: Effect, deps: EffectDeps): void => {
  if (isShellEffect(effect)) {
    runShellEffect(app.shell, effect, deps, BACKGAMMON);
    return;
  }
  switch (effect.type) {
    case 'writeVariant':
      writeVariant(deps.store, effect.variant);
      return;
    case 'writeMatchLength':
      writeMatchLength(deps.store, effect.length);
      return;
    case 'writeCurtainMode':
      writeCurtainMode(deps.store, effect.mode);
      return;
  }
};
