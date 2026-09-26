// The briscola app as a reducer over intents (docs/design/briscola.md §5.4 "Interaction";
// docs/ARCHITECTURE.md "Module boundaries": imported only by main.ts, the painters and tests).
// `App = { shell, table }`: `shell` is the home screen, the waiting rooms, the session (role, code,
// names, the engine `State` for the host and pass-and-play, my `View` for every role) and the
// resume offer, the record the shared shell reducer owns (web/shared/ui/shell.ts `reduceShell`,
// docs/design/shared-shell.md §4.2) over the config `BRISCOLA` below (shellConfig.ts's half
// completed here with the table hooks: `reset` per site, `rendered`, `refuse`, pass-and-play's
// `viewer`/`revealer`, and the home snapshot's own part); `table` is the table's interaction
// memory (the hand's kept slots, a lifted card, a drag, the settle beat, the sheets, the curtain,
// the card pack, the third and fourth names), which no other game has. `Intent` is every handler
// and every network event, and `reduce` returns the next App with a list of `Effect`s: what to
// persist, toast, send, play or arm, as data. main.ts runs the effects through the real adapters
// (`runEffect`: briscola's three, then the shared runner) and paints the App (ui/render.ts); the
// tests run the reducer alone. The first game booted through the shared shell (D18).
//
// Briscola's residue on the shell: pass-and-play seats two, three or four (D1, D17), so `reduce`
// takes `local/click` itself (the shell's case seats a pair) and creates the N-seat game before
// handing it to the shared `startLocal`, drops the handoff at three and four seats (offered at two
// only), and persists the room's options after a start; the guest whose game is over when the
// host drops (`hostLeft`, backgammon's) is taken before the shell's `guest/lost` too. One game per
// sitting (the owner, 2026-09-25): every game ends on the result sheet over the table, whose Play
// again (`replay/click`) deals anew for the same players with the deal passed to the next seat; the
// engine's match (a save may still hold one) runs on underneath with `gamesToWin` fixed at 1, so
// the shell's fifth screen (`endgameScreen`) is never shown.
//
// Turn authority is gin's: the host applies `applyAction` for both seats and broadcasts
// `viewFor(game, 1)` as a `state` frame, a refusal to the guest is a `toast` frame; the guest sends
// `action` frames; pass-and-play keeps the `State` here with no Peer (D20: no undo, a played card
// is public the instant it is played).
//
// The settle beat (§5.4): a resolved trick is `settle 'hold'` (the trick painted from the record,
// the taker's card lifted), then `'fly'` (the cards to the winner), then `'draw'` (a back to each
// seat in `drew` order), each a `settle` timer; the view is painted cold when the beat ends. The
// beat is paint-driven, so it plays the same on every device from one `state` frame, and in
// pass-and-play the curtain waits for it (`viewer` keeps the phone holder's view while a trick
// settles). Sounds are event-driven (docs/design/briscola-sound-history.md §3.5, §5): `rendered`
// finds the events new since the view it replaces (`continuedEvents` says which stream that view
// continues) and hands them to the shared `eventEffects` (web/shared/ui/eventEffects.ts), which
// gathers their phrases (`phraseOf`, ui/sound.ts) into ONE `phrases` effect the shell plays back to
// back in the App's font, once per view (`cues.key`), so a re-sent frame plays nothing; the card
// laid and the turn chime stay `fx` rows of the table.
import {
  GONE_TOAST_MS,
  NOT_CONNECTED_MSG,
  SANDBOX_LOCAL_ONLY_MSG,
  andThen as then,
  badPositionMsg,
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
  type Role,
  type ShellApp,
  type ShellConfig,
  type ShellIntent as SharedShellIntent,
  type ShellState,
  type Step as SharedStep,
  type TableReset,
  type TimerId as SharedTimerId,
} from '../../../../shared/ui/shell.ts';
import { runShellEffect, type ShellEffectDeps } from '../../../../shared/ui/shellEffects.ts';
import { eventEffects } from '../../../../shared/ui/eventEffects.ts';
import { isCardPackFor } from '../../../../shared/lib/cards/packs.ts';
import { isLanguagePack, type LanguagePackName } from '../../../../shared/lib/lang/packs.ts';
import {
  HAND_SIZE,
  actorOf,
  applyAction,
  cardById,
  createGame,
  nameOf,
  replayGame,
  viewFor,
} from '../engine/index.ts';
import type {
  Action,
  Cards,
  GameEvent,
  GameOptions,
  Played,
  Players,
  Seat,
  SeatCount,
  State,
  TrickRecord,
  View,
} from '../engine/index.ts';
import {
  action as actionFrame,
  intent as intentFrame,
  type IntentFrame,
  type IntentMode,
  type IntentSlot,
} from '../protocol.ts';
import { BRISCOLA_SHELL, parseOpts } from '../shellConfig.ts';
import { DURATIONS, durationsFor, type Durations } from './beat.ts';
import {
  DECK_KIND,
  DEFAULT_CARD_PACK,
  DEFAULT_LANG,
  DEFAULT_PLAY_MODE,
  DEFAULT_SPEED,
  EXTRA_NAME_PREFS,
  HOME_TABS,
  isSpeed,
  writeCardPack,
  writeLang,
  writeOpts,
  writeSpeed,
  type CardPack,
  type Speed,
  type HomeTab,
  type HostExtra,
  type PlayMode,
  type Save,
  type Store,
} from '../storage.ts';
import { INITIAL_CUES, phraseOf, type Cue, type CueState } from './sound.ts';

// The shell's strings and helpers the tests and painters import from here, as the other games do.
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
  DEFAULT_OPTS,
  LEAVE_LOCAL_MSG,
  LEAVE_ONLINE_MSG,
  ONE_GAME,
  TABLE_TERMS,
  hostRoomMsg,
  parseOpts,
  parseSeatCount,
  pickOpts,
} from '../shellConfig.ts';
// ui/home.ts paints the tabs and modes from the lists storage.ts decodes; ui/ may not import storage.ts.
export {
  DEFAULT_PLAY_MODE,
  HOME_TABS,
  type CardPack,
  type HomeTab,
  type LanguagePackName,
  type PlayMode,
};
export { INITIAL_CUES, type CueState };

// ---- the state ---------------------------------------------------------------------------------

/** The five top-level screens `showScreen` toggles between. */
export const SCREENS = [
  'homeScreen',
  'hostWaitScreen',
  'guestWaitScreen',
  'tableScreen',
  'endgameScreen',
] as const;
export type ScreenId = (typeof SCREENS)[number];

/** What the home screen's resume box offers, one per save role (the shared `ShellResume`; briscola adds none). */
export type Resume = SharedResume<Briscola>;

/**
 * The raw option values `host/click` and `local/click` carry off the inputs (design §5.8
 * `startOptions`): the Online seat count select, its pass-and-play twin, and the third and fourth
 * pass-and-play names (the shared binder reads the first two). A key the click did not carry keeps
 * the shell's current value; the rest of the room's terms are fixed (`TABLE_TERMS`).
 */
export type Raw = Readonly<{
  players?: string;
  localPlayers?: string;
  p3?: string;
  p4?: string;
}>;

/** The seats beyond the shell's two: the third and fourth players (D1). */
export type ExtraSeat = 2 | 3;

/** What `initHome` reads beyond the shell's keys: the room options, the card pack, the language pack, the third and fourth names. */
export type Home = Readonly<{
  opts: GameOptions;
  cardPack: CardPack;
  lang: LanguagePackName;
  /** `briscola_speed`: the battle beat's speed. */
  speed: Speed;
  p3Name: string | null;
  p4Name: string | null;
}>;

/**
 * Briscola's types for the shared shell (web/shared/ui/shell.ts `ShellTypes`): the room's terms
 * are the engine's six options (the host save's own fields and the welcome frame's room), the raw
 * options are `Raw`, the seats are the shell's two plus the third and fourth, the modes are the
 * two stored ones, no resume offer beyond the three roles, one timer (the settle beat), and the
 * table's own intents and effects are the unions below.
 */
export type Briscola = Readonly<{
  Opts: GameOptions;
  Raw: Raw;
  State: State;
  View: View;
  Action: Action;
  Table: Table;
  Tab: HomeTab;
  Mode: PlayMode;
  Screen: ScreenId;
  Timer: 'settle' | 'tip' | 'intent';
  Cue: Cue;
  Cues: CueState;
  Resume: never;
  Home: Home;
  Intent: TableIntent;
  Effect: TableEffect;
  Store: Store;
  Seat: ExtraSeat;
  /** The live intent mirror's frame over the shared ephemeral lane (docs/design/briscola-battle.md §4). */
  Ephemeral: IntentFrame;
}>;

export type Shell = ShellState<Briscola>;

export type SettleStage = 'hold' | 'fly' | 'draw';
/** A trick settling on the table (§5.4): the stage the beat is at and the record it paints from. */
export type Settle = Readonly<{ stage: SettleStage; trick: TrickRecord }>;
/** A card dragged from the hand (ui/table/dragger.ts): its id and whether it is over the trick. */
export type Drag = Readonly<{ card: string; over: boolean }>;
/**
 * The card-name tip over a hand card (docs/design/language-packs.md §5): armed by a hover or a
 * touch press (`shown` false while the `tip` timer runs), shown when the timer fires.
 */
export type Tip = Readonly<{ card: string; shown: boolean }>;
/** What a peer shows of its hand right now (§4.4): the engine-order slot and whether it is hovered or lifted. */
export type Mirror = Readonly<{ slot: IntentSlot; mode: IntentMode }>;
/** The host's per-seat count of intent frames in the current window (§4.3). */
export type IntentBudget = Readonly<{ at: number; n: number }>;

/** The table's interaction memory (§5.4 `Table`). Session only: never saved, never on the wire. */
export type Table = Readonly<{
  /** The hand's kept picture: three slots, a card's id or null where one went (`settleSlots`). */
  slots: ReadonlyArray<string | null>;
  /** The lifted card's id (gin's gesture: lift, then play). */
  selected: string | null;
  settle: Settle | null;
  drag: Drag | null;
  /** `#resultOverlay` put away with "Look at the table" (`resultOpen` derives the sheet from this and the view). */
  resultDismissed: boolean;
  /** `#historyOverlay` shown. */
  historyOpen: boolean;
  /** `#deckOverlay` (ui/deck.ts) shown, and whether it greys the cards in my hand too. Session only. */
  deckOpen: boolean;
  deckWithHand: boolean;
  /** Pass-and-play: the seat the phone is handed to, or null when the curtain is down. */
  curtain: Seat | null;
  /** The view the previous paint showed (main.ts paints after every intent): the flights' `prev`. */
  lastPainted: View | null;
  /** `briscola_cardPack`: the pack the faces and backs are drawn from (`body[data-card-pack]`, `--aspect`). */
  cardPack: CardPack;
  /** `briscola_lang`: the language pack the cards are named in (the captions, the tip, the aria labels). */
  lang: LanguagePackName;
  /** `briscola_speed` (docs/design/briscola-battle.md §3.7): the beat's clock, `normal` | `quick` | `off`; `#tableScreen[data-speed]` and the timers read it. */
  speed: Speed;
  /** The card-name tip over a hand card, armed or shown; null when none. */
  tip: Tip | null;
  /** A touch long-press showed the tip: the click its release fires must not lift this card (cleared by that tap). */
  swallowTap: string | null;
  /** `#cardViewOverlay`: the card shown large with its name (the briscola tapped), or none. */
  cardView: string | null;
  /**
   * The third and fourth pass-and-play names as last read from their keys or typed into their
   * inputs; null when neither (the input shows the seat's default, shellConfig.ts LOCAL_NAMES,
   * marked for the first-tap clear, and the seat starts as it).
   */
  extraNames: Readonly<Record<ExtraSeat, string | null>>;
  /** The hand slot (an index into `slots`) under a fine pointer or holding focus (§4.2); null when none. */
  hover: IntentSlot | null;
  /** The last intent frame this device put on the lane; equality stops repeats; null after a rejoin so a held lift is re-sent. */
  sent: IntentFrame | null;
  /** The `intent` timer is armed: the next change waits for it (a 60 ms trailing throttle). */
  intentArmed: boolean;
  /** By engine seat, what that seat has hovered or lifted, as the lane last said; null where nothing. */
  mirror: ReadonlyArray<Mirror | null>;
  /** The host's per-seat frame budget window (§4.3); the guest never reads it. */
  budget: ReadonlyArray<IntentBudget | null>;
}>;

export type App = ShellApp<Briscola>;

export const EMPTY_SLOTS: ReadonlyArray<string | null> = Array.from(
  { length: HAND_SIZE },
  () => null,
);

export const initialTable: Table = {
  slots: EMPTY_SLOTS,
  selected: null,
  settle: null,
  drag: null,
  resultDismissed: false,
  historyOpen: false,
  deckOpen: false,
  deckWithHand: false,
  curtain: null,
  lastPainted: null,
  cardPack: DEFAULT_CARD_PACK,
  lang: DEFAULT_LANG,
  speed: DEFAULT_SPEED,
  tip: null,
  swallowTap: null,
  cardView: null,
  extraNames: { 2: null, 3: null },
  hover: null,
  sent: null,
  intentArmed: false,
  mirror: [null, null, null, null],
  budget: [null, null, null, null],
};
// ---- the strings and beats the app (not the sessions) writes ---------------------------------

/** The settle beat (§5.3 "Motion") at `normal`: the resolved trick shown, the cards' flight to the winner, one draw and the gap to the next (ui/beat.ts holds the quick and reduced tables). */
export const HOLD_MS = DURATIONS.holdMs;
export const FLY_MS = DURATIONS.flyMs;
export const DRAW_MS = DURATIONS.drawMs;
export const DRAW_GAP_MS = DURATIONS.drawGapMs;
/** The card-name tip (docs/design/language-packs.md §5): a hover shows it after this long, a touch press after a little longer. */
export const TIP_HOVER_MS = 400;
export const TIP_PRESS_MS = 450;
/** The live intent mirror (docs/design/briscola-battle.md §4.2, §4.3): the trailing throttle, and the host's per-seat budget per window. */
export const INTENT_MS = 60;
export const INTENT_BUDGET = 30;
export const INTENT_WINDOW_MS = 1000;
/** `position/load` (`window.__briscola.setup`) outside pass-and-play, and a position the decoder refuses: the shell's strings. */
export { SANDBOX_LOCAL_ONLY_MSG, badPositionMsg };
/** `guest/lost` once the game is over: the host closed the table, there is nothing to rejoin. */
export const hostLeftMsg = (hostName: string): string => `${hostName} left the table.`;
/** A guest's Play again: the host deals (D20). */
export const waitingToDealMsg = (hostName: string): string => `Waiting for ${hostName} to deal`;

// ---- intents -----------------------------------------------------------------------------------

/** What `initHome` reads from storage, in one snapshot (`readHome`): the shell's keys and briscola's (`Home`). */
export type HomeSnapshot = SharedHomeSnapshot<Briscola>;

/** The table's half of `Intent` (§5.4), briscola's own after the shell's 43 (web/shared/ui/shell.ts `ShellIntent`). */
export type TableIntent =
  /** `act(action)`: every role (the hook, and the controls below resolve to it). */
  | Readonly<{ type: 'act'; action: Action }>
  /** A hand card tapped: lifts it, moves the lift, or plays the lifted card (gin's gesture). */
  | Readonly<{ type: 'card/tap'; cardId: string }>
  /** `#playBtn`: the lifted card is played. */
  | Readonly<{ type: 'play/click' }>
  /** A tap on the table (`#trick`): the lifted card is played. */
  | Readonly<{ type: 'table/tap' }>
  | Readonly<{ type: 'card/dragStart'; cardId: string }>
  /** The drag is over the trick (`over`) or not. */
  | Readonly<{ type: 'card/dragOver'; over: boolean }>
  /** Released: over the trick it plays, elsewhere it drops the lift. */
  | Readonly<{ type: 'card/dragEnd' }>
  /** `#briscola.tappable` (D24): the 7 (or the 2) of trumps for the trump card. */
  | Readonly<{ type: 'exchange/click' }>
  /** `#rsReplayBtn` "Play again": a new deal for the same players and terms, the deal passed on. */
  | Readonly<{ type: 'replay/click' }>
  /** `#rsPeekBtn` "Look at the table" / `#resultChipBtn` "Result". */
  | Readonly<{ type: 'result/peek' }>
  | Readonly<{ type: 'result/open' }>
  | Readonly<{ type: 'history/open' }>
  | Readonly<{ type: 'history/close' }>
  /** `#deckBtn` (the deck sheet, ui/deck.ts), `#closeDeckBtn` and `#deckIncludeHand`. */
  | Readonly<{ type: 'deck/open' }>
  | Readonly<{ type: 'deck/close' }>
  | Readonly<{ type: 'deck/toggleHand' }>
  | Readonly<{ type: 'rules/open' }>
  | Readonly<{ type: 'rules/close' }>
  /** Escape (§5.5): cancels a drag, drops a lift, closes a sheet, in that order of what is up. */
  | Readonly<{ type: 'escape' }>
  /** The `settle` timer fired: the beat moves to its next stage or ends. */
  | Readonly<{ type: 'settle/elapsed' }>
  /** The seat count changed on the home screen: the raw values, parsed against the current room and remembered. */
  | Readonly<{ type: 'opts/set'; raw: Raw }>
  /** `#p3NameInput` / `#p4NameInput` typed: remembered under its key. */
  | Readonly<{ type: 'pname/typed'; seat: ExtraSeat; value: string }>
  /** The hook's `cardPack(name)`: a pack that draws the Italian deck is shown from now on and remembered; anything else is ignored. */
  | Readonly<{ type: 'cardPack/set'; pack: string }>
  /** The hook's `lang(name)`: a language pack names the cards from now on and is remembered; anything else is ignored. */
  | Readonly<{ type: 'lang/set'; name: string }>
  /** The home screen's "Battle animations" switch (and the hook's `speed(name)`): `normal` | `quick` | `off`, remembered; anything else is ignored. */
  | Readonly<{ type: 'speed/set'; speed: string }>
  /** A pointer over a hand card (a hover) or a touch pressing one: the tip's timer starts for that card. */
  | Readonly<{ type: 'tip/arm'; card: string; press: boolean }>
  /** The `tip` timer fired: the name shows. */
  | Readonly<{ type: 'tip/show' }>
  /** The pointer left, pressed, or lifted: the tip goes; `swallow` (a touch lift) keeps the click it fires from lifting the card. */
  | Readonly<{ type: 'tip/hide'; swallow?: boolean }>
  /** A face-up card tapped for a closer look (the briscola, D24 aside): `#cardViewOverlay` shows it large with its name. */
  | Readonly<{ type: 'cardView/open'; card: string }>
  | Readonly<{ type: 'cardView/close' }>
  /** A fine pointer over, or focus on, the slot-th hand slot (`render.ts bindHover`); null when it left. */
  | Readonly<{ type: 'hover/set'; slot: IntentSlot | null }>
  /** The `intent` timer fired: what my hand shows now goes on the lane if it changed. */
  | Readonly<{ type: 'intent/flush' }>;

/** Every handler and every network event: the shell's intents and the table's. */
export type Intent = SharedIntent<Briscola>;
export type ShellIntent = SharedShellIntent<Briscola>;

// ---- effects -----------------------------------------------------------------------------------

export type TimerId = SharedTimerId<Briscola>;

/** Briscola's own effects, handled by `runEffect` before the shared runner: the four preferences this page alone keeps. */
export type TableEffect =
  | Readonly<{ type: 'writeOpts'; opts: GameOptions }>
  | Readonly<{ type: 'rememberPName'; seat: ExtraSeat; name: string }>
  | Readonly<{ type: 'writeCardPack'; pack: CardPack }>
  | Readonly<{ type: 'writeLang'; name: LanguagePackName }>
  | Readonly<{ type: 'writeSpeed'; speed: Speed }>;

export type Effect = SharedEffect<Briscola>;

export type Step = SharedStep<Briscola>;

export type Context = Ctx;

const tap: Effect = { type: 'fx', cue: 'tap' };
const fx = (cue: Cue): Effect => ({ type: 'fx', cue });
const settleTimer = (ms: number): Effect => ({
  type: 'startTimer',
  id: 'settle',
  ms,
  then: { type: 'settle/elapsed' },
});

/** A refused action: the toast and the font's `bad`; the lift and a drag are dropped so the hand matches the state. */
const refuse = (app: App, message: string): Step =>
  step(withTable(app, { selected: null, drag: null }), toast(message), fx('bad.refused'));
// ---- the hand's slots -------------------------------------------------------------------------

/**
 * The hand's kept picture against a new hand (§5.4 `settleSlots`): a card stays in its slot, a
 * slot whose card went is null, and each new card takes the first free slot in hand order, so a
 * played card's neighbours never move and a deal or a resume fills left to right. Always
 * `HAND_SIZE` long: more cards than slots (a hand-made position) spill into the last slots.
 */
export const settleSlots = (
  prev: ReadonlyArray<string | null>,
  hand: Cards,
): ReadonlyArray<string | null> => {
  const ids = hand.map((c) => c.id);
  const kept = Array.from({ length: HAND_SIZE }, (_, i) => {
    const id = prev[i] ?? null;
    return id !== null && ids.includes(id) ? id : null;
  });
  const fresh = ids.filter((id) => !kept.includes(id));
  return kept.reduce<
    Readonly<{ slots: ReadonlyArray<string | null>; left: ReadonlyArray<string> }>
  >(
    (acc, id) =>
      id !== null
        ? { slots: [...acc.slots, id], left: acc.left }
        : { slots: [...acc.slots, acc.left[0] ?? null], left: acc.left.slice(1) },
    { slots: [], left: fresh },
  ).slots;
};

// ---- what changed between two views: the card laid, the trick resolved, the events ------------

const sameGame = (prev: View, next: View): boolean =>
  prev.gameNo === next.gameNo && prev.startedAt === next.startedAt;

/** The trick `next` resolved that `prev` had not seen (the one the settle beat paints), else null. */
export const trickResolvedBetween = (prev: View, next: View): TrickRecord | null =>
  sameGame(prev, next) && next.trickNo === prev.trickNo + 1 && next.lastTrick !== null
    ? next.lastTrick
    : null;

/**
 * The card laid since `prev` (for the `move` cue and the flight from a seat): the trick's newest
 * card, or the card that completed the trick `next` resolved, when `prev` saw everything before it.
 * Null across a deal, a skipped trick (a resume, a reconnect) or nothing new.
 */
export const playedBetween = (prev: View, next: View): Played | null => {
  if (!sameGame(prev, next)) return null;
  if (next.trickNo === prev.trickNo && next.trick.length > prev.trick.length)
    return next.trick.at(-1) ?? null;
  const resolved = trickResolvedBetween(prev, next);
  return resolved !== null && prev.trick.length === resolved.cards.length - 1
    ? (resolved.cards.at(-1) ?? null)
    : null;
};

/**
 * The events of `prev` that `next` continues, for the shared `eventEffects` (web/shared/lib/
 * events.ts: an event is new when its id passes the last one seen, so a stream must run on): a
 * stream that carries `prev`'s last event at its index continues it (one match, its ids running on
 * across games), so `prev`'s events; a replay opens a new stream after a decided game, so none
 * (its deal chimes); a stream `prev` never saw while no game was decided (a hand-made position,
 * `position/load`) is null: painted cold, nothing chimes.
 */
export const continuedEvents = (prev: View, next: View): ReadonlyArray<GameEvent> | null => {
  const last = prev.events.at(-1);
  const same = last === undefined ? undefined : next.events[last.id];
  const continues =
    last !== undefined &&
    same?.kind === last.kind &&
    same.at === last.at &&
    same.seat === last.seat;
  return continues ? prev.events : prev.matchOver ? [] : null;
};

/** The view a cue memory keys on: the game and its last event, so a re-sent frame plays nothing. */
export const cueKey = (v: View): string =>
  `${String(v.startedAt)}:${String(v.gameNo)}:${String(v.events.at(-1)?.id ?? -1)}:${String(v.trick.length)}`;

/**
 * The rows the change from `prev` to `next` earns (ui/sound.ts `fx` rows): the card laid (mine or
 * theirs) and the turn chime online. Pass-and-play chimes turns with the curtain instead; the
 * events' phrases are `phrasesBetween`.
 */
export const cuesBetween = (prev: View, next: View, role: Role | null): ReadonlyArray<Cue> => {
  const played = playedBetween(prev, next);
  // On a shared phone whoever laid the card holds it: every play is the player's own.
  const laid: ReadonlyArray<Cue> =
    played === null
      ? []
      : [role === 'local' || played.seat === next.me.idx ? 'move.play' : 'move.opp'];
  const myTurn = role !== 'local' && next.isMyTurn && !prev.isMyTurn && next.phase !== 'over';
  return [...laid, ...(myTurn ? (['yourTurn'] as const) : [])];
};

/**
 * The one `phrases` effect of the events new since `prev` (`eventEffects`, docs/design/
 * briscola-sound-history.md §3.5), each event's phrase for this device (`phraseOf`: the winner's
 * or the loser's cell of a trick, the deal, the result), in event order; none for a cold paint.
 */
export const phrasesBetween = (
  prev: View,
  next: View,
  role: Role | null,
): ReadonlyArray<Effect> => {
  const continued = continuedEvents(prev, next);
  return continued === null
    ? []
    : eventEffects<GameEvent, Briscola>(continued, next.events, (e) => phraseOf(e, next.me, role));
};

// ---- the settle beat ----------------------------------------------------------------------------

/** How long a stage holds the table at these durations (the device's speed and motion preference, ui/beat.ts): the hold, the flight, then one draw per seat with the gaps between. */
export const settleMs = (settle: Settle, d: Durations = DURATIONS): number => {
  switch (settle.stage) {
    case 'hold':
      return d.holdMs;
    case 'fly':
      return d.flyMs;
    case 'draw':
      return d.drawMs + d.drawGapMs * Math.max(0, settle.trick.drew.length - 1);
  }
};

/** The durations this device's table runs at: its speed switch, and `prefers-reduced-motion` when the context carries it. */
const beatDurations = (app: App, ctx: Context): Durations =>
  durationsFor(app.table.speed, ctx.reducedMotion === true);

/** The stage after this one, or null when the beat is done (no draw once the stock is out). */
export const nextStage = (settle: Settle): Settle | null => {
  switch (settle.stage) {
    case 'hold':
      return { ...settle, stage: 'fly' };
    case 'fly':
      return settle.trick.drew.length === 0 ? null : { ...settle, stage: 'draw' };
    case 'draw':
      return null;
  }
};

// ---- the table against a new view -------------------------------------------------------------

/** The table's memory against a new view: the slots settle, a lift survives only while its card is still playable, a drag only while its card is held. */
const settled = (table: Table, v: View): Table => {
  const drag = table.drag;
  return {
    ...table,
    slots: settleSlots(table.slots, v.me.hand),
    selected: table.selected !== null && v.legal.includes(table.selected) ? table.selected : null,
    drag: drag !== null && v.me.hand.some((c) => c.id === drag.card) ? drag : null,
    resultDismissed: v.phase === 'over' ? table.resultDismissed : false,
  };
};

/** `#resultOverlay` is up: the game is over, the last trick has settled and nobody has put it away. */
export const resultOpen = (app: App): boolean =>
  app.shell.view?.phase === 'over' && app.table.settle === null && !app.table.resultDismissed;

/** My view while I may play and the hand is live; null under the curtain, while a trick settles, or on another seat's turn (`#hand.inert`). */
export const liveView = (app: App): View | null => {
  const v = app.shell.view;
  return v?.isMyTurn === true &&
    v.phase === 'trick' &&
    app.table.curtain === null &&
    app.table.settle === null
    ? v
    : null;
};

/**
 * The state side of a paint: nothing without a view; else the screen is the table (a game's end is
 * the result sheet over it, never the shell's end screen); the slots settle; a trick `prev` had not
 * seen enters the settle beat (`hold`, its timer armed) and the cues come from the change since
 * `prev` (the view this one replaces), once per position (`cues.key`), so a re-sent frame plays
 * nothing. A view with no `prev` (a resume, a reconnect, `setup`) paints cold: no beat, no sound,
 * the memory primed. The paint itself is main.ts's after every intent.
 */
const rendered = (app: App, prev: View | null, ctx: Context): Step => {
  const view = app.shell.view;
  if (view === null) return pure(app);
  const key = cueKey(view);
  const fresh = prev !== null && key !== app.shell.cues.key;
  const cues = fresh ? cuesBetween(prev, view, app.shell.role) : [];
  const phrases = fresh ? phrasesBetween(prev, view, app.shell.role) : [];
  const resolved = prev === null ? null : trickResolvedBetween(prev, view);
  const running = app.table.settle;
  // A trick already settling is not restarted by a re-sent frame; a newer one takes its place.
  const starts = resolved !== null && running?.trick.no !== resolved.no;
  const settle: Settle | null = starts ? { stage: 'hold', trick: resolved } : running;
  return step(
    {
      shell: { ...app.shell, cues: { key }, screen: 'tableScreen' },
      table: {
        ...settled(app.table, view),
        settle,
        lastPainted: prev,
        mirror: mirrorAfter(app.table.mirror, prev, view),
      },
    },
    ...cues.map(fx),
    ...phrases,
    ...(settle !== null && starts ? [settleTimer(settleMs(settle, beatDurations(app, ctx)))] : []),
    { type: 'scrollTop' },
  );
};

/** `settle/elapsed`: the beat's next stage with its timer (the draw chimes), or, done, the view painted cold and pass-and-play's phone handed on. */
const settleElapsed = (app: App, ctx: Context): Step => {
  const running = app.table.settle;
  if (running === null) return pure(app);
  const next = nextStage(running);
  if (next !== null)
    return step(
      withTable(app, { settle: next }),
      ...(next.stage === 'draw' ? [fx('draw.stock')] : []),
      settleTimer(settleMs(next, beatDurations(app, ctx))),
    );
  const done = withTable(app, { settle: null });
  return app.shell.role === 'local'
    ? localBroadcast(done, false, ctx, BRISCOLA)
    : rendered(done, done.shell.view, ctx);
};

// ---- acting -----------------------------------------------------------------------------------

/** `localAct(action)`: applied for the actor (`next` for whoever taps it); a new game clears the reveal so the curtain names its leader. */
const localAct = (app: App, action: Action, ctx: Context): Step => {
  const game = app.shell.game;
  if (game === null) return pure(app);
  const res = applyAction(game, actorOf(game) ?? game.turn, action, ctx.rng, ctx.now);
  if (!res.ok) return refuse(app, res.error);
  const fresh = res.value.gameNo !== game.gameNo;
  return localBroadcast(
    withShell(app, { game: res.value, revealed: fresh ? null : app.shell.revealed }),
    false,
    ctx,
    BRISCOLA,
  );
};

/** `act(action)` by role: pass-and-play and the host apply and broadcast; the guest sends one `action` frame. */
const act = (app: App, action: Action, ctx: Context): Step => {
  switch (app.shell.role) {
    case 'local':
      return localAct(app, action, ctx);
    case 'host': {
      const game = app.shell.game;
      if (game === null) return pure(app);
      const res = applyAction(game, 0, action, ctx.rng, ctx.now);
      if (!res.ok) return refuse(app, res.error);
      return broadcast(withShell(app, { game: res.value }), ctx, BRISCOLA);
    }
    case 'guest':
    case null:
      return app.shell.role === 'guest' && app.shell.oppConnected
        ? step(app, { type: 'send', frame: actionFrame(action) })
        : refuse(app, NOT_CONNECTED_MSG);
  }
};

/** A card committed from a tap, the button or a drop: the lift and the drag are dropped first. */
const commit = (app: App, cardId: string, ctx: Context): Step =>
  act(withTable(app, { selected: null, drag: null }), { type: 'play', cardId }, ctx);

/** Play again after a decided game: a fresh deal for the same players and terms, the deal passed to the next seat (`replayGame`); the guest waits for the host's. */
const replayDecided = (app: App, game: State, ctx: Context): Step => {
  const fresh = replayGame(game, ctx.rng, ctx.now);
  const reset = withShell(app, { cues: INITIAL_CUES });
  switch (app.shell.role) {
    case 'local':
      return localBroadcast(
        withShell(reset, { game: fresh, revealed: null }),
        false,
        ctx,
        BRISCOLA,
      );
    case 'host':
      return broadcast(withShell(reset, { game: fresh }), ctx, BRISCOLA);
    case 'guest':
    case null:
      return pure(app);
  }
};

// ---- seats, names and labels -------------------------------------------------------------------

/** The engine's `Players` tuple for `n` seats from a list (a missing seat is `Player N`, which `localSeats` never leaves). */
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

/** "Ann vs Bob" for two (the shared shell specs' shape), "Ann, Bob and Cara" for more. */
export const seatNames = (names: ReadonlyArray<string>): string =>
  names.length <= 2
    ? names.join(' vs ')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;

/** `#resumeBtn`'s label for a resume offer. */
export const resumeLabel = (resume: Resume): string => {
  switch (resume.kind) {
    case 'local':
      return `Resume pass & play: ${seatNames(resume.game.players.map((p) => p.name))}`;
    case 'host':
      // A room still waiting for its first guest has no game to hand off (lobby-resume.md D3).
      return resume.handoff && resume.game !== null
        ? handoffLabel(resume.game)
        : `Resume hosting room ${resume.code}`;
    case 'guest':
      return `Rejoin room ${resume.code}`;
  }
};

/** `#handoffBtn`'s tooltip and a handed-off room's resume offer (two seats only, D17): seat 0 hosts, seat 1 joins by invite. */
export const handoffLabel = (game: State): string =>
  `Continue online: ${nameOf(game.players, 0)} hosts, ${nameOf(game.players, 1)} joins by invite`;

/** The seats at the table of the game in play or on offer; two when there is none (the handoff's gate). */
const seatCountOf = (app: App): SeatCount => {
  const s = app.shell;
  if (s.role === 'local' && s.game !== null) return s.game.options.seatCount;
  return s.resume?.kind === 'local' ? s.resume.game.options.seatCount : 2;
};

// ---- pass-and-play: whose view, and when the curtain rises (D17) --------------------------------

/**
 * `localBroadcast`'s seat: the actor's view while the game is on, the phone holder's while the
 * trick just taken settles (the beat plays for whoever laid the last card, then the curtain rises
 * for the winner) and once the game is over (the result is everyone's; whoever holds the phone
 * taps Next); the curtain comes up when the phone must change hands and the incoming seat has not
 * lifted it this turn.
 */
const viewer: ShellConfig<Briscola>['local']['viewer'] = (app, game) => {
  const prev = app.shell.view;
  const holder: Seat = prev?.me.idx ?? app.shell.revealed ?? game.turn;
  const actor = actorOf(game);
  const settling = prev !== null && trickResolvedBetween(prev, viewFor(game, holder)) !== null;
  const seat: Seat = actor === null || settling ? holder : actor;
  const curtain = actor !== null && !settling && app.shell.revealed !== seat ? seat : null;
  return { seat, curtain, effects: [] };
};

/** `curtain/reveal`: whoever must act lifts the curtain. */
const revealer: ShellConfig<Briscola>['local']['revealer'] = (game) => ({
  seat: actorOf(game) ?? game.turn,
  effects: [],
});

/** What a game leaves behind when it is left, lost or handed off: the table's memory; the card pack, the language and the names stay. */
const tableCleared = (table: Table): Table => ({
  ...initialTable,
  cardPack: table.cardPack,
  lang: table.lang,
  speed: table.speed,
  extraNames: table.extraNames,
});

/** Escape (§5.5): what is up goes, one thing per press: the card view, a drag, a lift, the deck, the history, the rules. */
const escape = (app: App): Step => {
  const t = app.table;
  if (t.cardView !== null) return pure(withTable(app, { cardView: null }));
  if (t.drag !== null) return pure(withTable(app, { drag: null, selected: null }));
  if (t.selected !== null) return pure(withTable(app, { selected: null }));
  if (t.deckOpen) return pure(withTable(app, { deckOpen: false }));
  if (t.historyOpen) return pure(withTable(app, { historyOpen: false }));
  if (app.shell.rulesOpen) return pure(withShell(app, { rulesOpen: false }));
  return pure(app);
};

/**
 * `replay/click` (Play again) from the host or the phone: after a draw the engine's next game of
 * the same match (`next`: the deal rotates, the tally carries), after a decided game a fresh deal
 * with the deal rotated too (`replayDecided`), so either way the next seat deals; a guest waits
 * for the host to deal (D20). Nothing while a game is on.
 */
const replay = (app: App, ctx: Context): Step => {
  const over = app.shell.view;
  if (over?.phase !== 'over') return pure(app);
  if (app.shell.role === 'guest') return refuse(app, waitingToDealMsg(nameOf(over.players, 0)));
  if (!over.matchOver) return act(app, { type: 'next' }, ctx);
  const game = app.shell.game;
  return game === null ? pure(app) : replayDecided(app, game, ctx);
};

// ---- the table's reducer ---------------------------------------------------------------------

/** A lifted card played by a second tap, the button or the table; a tap while not live or a drag's release is dropped (no toast: the status line says whose turn). */
const playSelected = (app: App, ctx: Context): Step => {
  const v = liveView(app);
  const id = app.table.selected;
  return v === null || id === null || app.table.drag !== null || !v.legal.includes(id)
    ? pure(app)
    : commit(app, id, ctx);
};

const cardTap = (app: App, cardId: string, ctx: Context): Step => {
  // The click a drag's release fires reaches a card: a drag lifts nothing.
  if (app.table.drag !== null) return pure(app);
  // The click a touch long-press's lift fires: the player was reading the card's name, not playing it.
  if (app.table.swallowTap === cardId) return pure(withTable(app, { swallowTap: null }));
  const v = liveView(app);
  if (v?.legal.includes(cardId) !== true) return pure(app);
  if (app.table.selected === cardId) return commit(app, cardId, ctx);
  return step(withTable(app, { selected: cardId }), tap);
};

const tableIntent = (app: App, intent: TableIntent, ctx: Context): Step => {
  const t = app.table;
  const v = liveView(app);
  switch (intent.type) {
    case 'act':
      return act(app, intent.action, ctx);
    case 'card/tap':
      return cardTap(app, intent.cardId, ctx);
    case 'play/click':
    case 'table/tap':
      return playSelected(app, ctx);
    case 'card/dragStart':
      return v?.legal.includes(intent.cardId) !== true
        ? pure(app)
        : pure(
            withTable(app, {
              drag: { card: intent.cardId, over: false },
              selected: intent.cardId,
              tip: null,
            }),
          );
    case 'card/dragOver':
      return t.drag === null || t.drag.over === intent.over
        ? pure(app)
        : pure(withTable(app, { drag: { ...t.drag, over: intent.over } }));
    case 'card/dragEnd': {
      if (t.drag === null) return pure(app);
      const dropped = withTable(app, { drag: null, selected: null });
      return t.drag.over && v?.legal.includes(t.drag.card) === true
        ? commit(dropped, t.drag.card, ctx)
        : pure(dropped);
    }
    case 'exchange/click': {
      // The trump card tapped: the exchange while it is offered (D24); otherwise a closer look at it.
      if (v?.canExchange === true) return act(app, { type: 'exchange' }, ctx);
      const shown = app.shell.view;
      return shown?.trumpOnTable !== true
        ? pure(app)
        : pure(withTable(app, { cardView: shown.trumpCard.id }));
    }
    case 'replay/click':
      return replay(app, ctx);
    case 'result/peek':
      return pure(withTable(app, { resultDismissed: true }));
    case 'result/open':
      return pure(withTable(app, { resultDismissed: false }));
    case 'history/open':
      return pure(withTable(app, { historyOpen: true }));
    case 'history/close':
      return pure(withTable(app, { historyOpen: false }));
    case 'deck/open':
      return app.shell.view === null ? pure(app) : step(withTable(app, { deckOpen: true }), tap);
    case 'deck/close':
      return pure(withTable(app, { deckOpen: false }));
    case 'deck/toggleHand':
      return pure(withTable(app, { deckWithHand: !t.deckWithHand }));
    case 'rules/open':
      return pure(withShell(app, { rulesOpen: true }));
    case 'rules/close':
      return pure(withShell(app, { rulesOpen: false }));
    case 'escape':
      return escape(app);
    case 'settle/elapsed':
      return settleElapsed(app, ctx);
    case 'opts/set': {
      const opts = parseOpts(intent.raw, app.shell.opts);
      return step(withShell(app, { opts }), { type: 'writeOpts', opts });
    }
    case 'pname/typed':
      return step(
        withTable(app, { extraNames: { ...t.extraNames, [intent.seat]: intent.value } }),
        { type: 'rememberPName', seat: intent.seat, name: intent.value.trim() },
      );
    case 'cardPack/set':
      return isCardPackFor(DECK_KIND, intent.pack)
        ? step(withTable(app, { cardPack: intent.pack }), {
            type: 'writeCardPack',
            pack: intent.pack,
          })
        : pure(app);
    case 'lang/set':
      return isLanguagePack(intent.name)
        ? step(withTable(app, { lang: intent.name }), { type: 'writeLang', name: intent.name })
        : pure(app);
    case 'speed/set':
      return isSpeed(intent.speed)
        ? step(withTable(app, { speed: intent.speed }), { type: 'writeSpeed', speed: intent.speed })
        : pure(app);
    case 'tip/arm': {
      // A hand card of mine, face up: under the curtain and over a stranger nothing arms.
      const held = app.shell.view?.me.hand.some((c) => c.id === intent.card) === true;
      if (!held || t.curtain !== null) return pure(app);
      if (t.tip?.card === intent.card && t.tip.shown) return pure(app);
      return step(withTable(app, { tip: { card: intent.card, shown: false }, swallowTap: null }), {
        type: 'startTimer',
        id: 'tip',
        ms: intent.press ? TIP_PRESS_MS : TIP_HOVER_MS,
        then: { type: 'tip/show' },
      });
    }
    case 'tip/show':
      return t.tip === null ? pure(app) : pure(withTable(app, { tip: { ...t.tip, shown: true } }));
    case 'tip/hide':
      return t.tip === null
        ? pure(app)
        : step(
            withTable(app, {
              tip: null,
              swallowTap: intent.swallow === true && t.tip.shown ? t.tip.card : t.swallowTap,
            }),
            { type: 'cancelTimer', id: 'tip' },
          );
    case 'cardView/open':
      return cardById(intent.card) === null
        ? pure(app)
        : pure(withTable(app, { cardView: intent.card }));
    case 'cardView/close':
      return pure(withTable(app, { cardView: null }));
    case 'hover/set':
      return t.hover === intent.slot ? pure(app) : pure(withTable(app, { hover: intent.slot }));
    case 'intent/flush':
      return flushIntent(app);
  }
};

// ---- the live intent mirror (docs/design/briscola-battle.md §4) ---------------------------------

const online = (app: App): boolean => app.shell.role === 'host' || app.shell.role === 'guest';

/** The engine-order slot of a card in my hand, or null when it is not there. */
const engineSlotOf = (v: View, cardId: string | null): IntentSlot | null => {
  const i = cardId === null ? -1 : v.me.hand.findIndex((c) => c.id === cardId);
  return i === 0 || i === 1 || i === 2 ? i : null;
};

/**
 * What my hand shows a peer right now (§4.2): `raised` for the lifted or dragged card, else `hover`
 * for the hovered slot while my hand is live and the card is legal, else a clear (`slot: null`).
 * Null offline or before a view: nothing to say.
 */
export const intentOf = (app: App): IntentFrame | null => {
  const v = app.shell.view;
  if (v === null || !online(app)) return null;
  const seat = v.me.idx;
  const lifted = engineSlotOf(v, app.table.drag?.card ?? app.table.selected);
  if (lifted !== null) return intentFrame(seat, lifted, 'raised');
  const live = liveView(app);
  const hoveredId = app.table.hover === null ? null : (app.table.slots[app.table.hover] ?? null);
  const hovered = live === null ? null : engineSlotOf(live, hoveredId);
  return hovered !== null && hoveredId !== null && live?.legal.includes(hoveredId) === true
    ? intentFrame(seat, hovered, 'hover')
    : intentFrame(seat, null, 'hover');
};

const sameIntent = (a: IntentFrame | null, b: IntentFrame | null): boolean =>
  a?.seat === b?.seat && a?.slot === b?.slot && (a?.slot === null || a?.mode === b?.mode);

/** A frame worth sending: it differs from the last one, and a clear is not sent before anything was. */
const intentDue = (app: App): IntentFrame | null => {
  const wire = intentOf(app);
  if (wire === null || sameIntent(wire, app.table.sent)) return null;
  return app.table.sent === null && wire.slot === null ? null : wire;
};

/** After every step: a changed intent arms the throttle once; the flush sends what is current then. */
const withIntent = (s: Step): Step => {
  const a = s.app;
  if (a.table.intentArmed || intentDue(a) === null) return s;
  return step(withTable(a, { intentArmed: true }), ...s.effects, {
    type: 'startTimer',
    id: 'intent',
    ms: INTENT_MS,
    then: { type: 'intent/flush' },
  });
};

const flushIntent = (app: App): Step => {
  const disarmed = withTable(app, { intentArmed: false });
  const wire = intentDue(app);
  return wire === null
    ? pure(disarmed)
    : step(withTable(disarmed, { sent: wire }), { type: 'send', frame: wire });
};

const setMirror = (
  mirror: ReadonlyArray<Mirror | null>,
  frame: IntentFrame,
): ReadonlyArray<Mirror | null> =>
  mirror.map((m, i) =>
    i === frame.seat ? (frame.slot === null ? null : { slot: frame.slot, mode: frame.mode }) : m,
  );

/** One frame against the seat's window (§4.3): the count in the current second, or null once it is spent. */
const spendBudget = (
  budget: ReadonlyArray<IntentBudget | null>,
  seat: number,
  now: number,
): ReadonlyArray<IntentBudget | null> | null => {
  const was = budget[seat] ?? null;
  const window = was !== null && now - was.at < INTENT_WINDOW_MS ? was : { at: now, n: 0 };
  if (window.n >= INTENT_BUDGET) return null;
  return budget.map((b, i) => (i === seat ? { at: window.at, n: window.n + 1 } : b));
};

/**
 * A frame off the lane (`cfg.table.ephemeral`, §4.3, §4.4). The host is authoritative: a frame
 * whose seat is not its channel's is dropped, one over the seat's budget is dropped in silence, the
 * rest replaces that seat's mirror (last write wins; the relay to other seats is PR-5's, at two
 * seats there is no one to relay to). A guest takes the host's frame (and, after PR-5, a relayed
 * one) for any seat but its own.
 */
const ephemeral: NonNullable<ShellConfig<Briscola>['table']['ephemeral']> = (
  app,
  frame,
  seat,
  ctx,
) => {
  if (app.shell.role === 'host') {
    if (frame.seat !== seat) return pure(app);
    const budget = spendBudget(app.table.budget, seat, ctx.now());
    if (budget === null) return pure(app);
    return pure(withTable(app, { mirror: setMirror(app.table.mirror, frame), budget }));
  }
  if (frame.seat === app.shell.view?.me.idx) return pure(app);
  return pure(withTable(app, { mirror: setMirror(app.table.mirror, frame) }));
};

/** What a seat shows the table of its hand and its play: a change clears its mirror (§4.4). */
const seatShown = (v: View, seat: number): string => {
  const other = v.others.find((o) => o.idx === seat);
  const played = v.trick.filter((p) => p.seat === seat).map((p) => p.card.id);
  return `${String(other?.handCount ?? -1)}|${(other?.hand ?? []).map((c) => c.id).join(',')}|${played.join(',')}`;
};

/** The mirrors a new view keeps: every seat whose hand or play is as `prev` showed it; a cold paint keeps none. */
const mirrorAfter = (
  mirror: ReadonlyArray<Mirror | null>,
  prev: View | null,
  view: View,
): ReadonlyArray<Mirror | null> =>
  mirror.map((m, seat) =>
    m !== null && prev !== null && seatShown(prev, seat) === seatShown(view, seat) ? m : null,
  );

// ---- the shell's hooks into the table, and the config (docs/design/shared-shell.md §4.3) ---------

/**
 * What the table drops where a shared flow resets it: a pass-and-play start, the handoff, a leave
 * and the host lost clear the table's memory (`tableCleared`: the card pack and the names stay); a
 * new view (`broadcast`, `localBroadcast`) drops the lift and the drag; a deal, an applied action
 * and a guest's `state` frame touch nothing (`settled` runs in `rendered`).
 */
const reset = (table: Table, at: TableReset): Table => {
  switch (at) {
    case 'startLocal':
    case 'handoff':
    case 'leave':
    case 'lost':
      return tableCleared(table);
    case 'view':
      return { ...table, selected: null, drag: null };
    case 'deal':
      return { ...table, mirror: initialTable.mirror, sent: null };
    case 'applied':
    case 'frame':
      return table;
  }
};

/** Briscola's shell config: shellConfig.ts's half completed with the table hooks and the home snapshot's own part. */
export const BRISCOLA: ShellConfig<Briscola> = {
  ...BRISCOLA_SHELL,
  table: { initial: initialTable, reset, rendered, refuse, ephemeral },
  local: { viewer, revealer },
  home: {
    ...BRISCOLA_SHELL.home,
    apply: (app, home) => ({
      shell: { ...app.shell, opts: home.opts },
      table: {
        ...app.table,
        cardPack: home.cardPack,
        lang: home.lang,
        speed: home.speed,
        extraNames: { 2: home.p3Name, 3: home.p4Name },
      },
    }),
    resume: (home) => resumeFor(home.save),
    resumeExtra: pure,
  },
};

export const initialShell: Shell = shellInitial(BRISCOLA);

export const initialApp: App = { shell: initialShell, table: initialTable };

/**
 * `guest/lost` once the game is over (decided or drawn): the result stays up; the session's rejoin
 * finds a destroyed Peer and the save would only offer a dead table, so both go. Taken in `reduce`
 * before the shell's case, which knows the table mid-game and the wait screen only.
 */
const hostLeft = (app: App, v: View, ctx: Context): Step => {
  const lost = { shell: { ...app.shell, oppConnected: false }, table: tableCleared(app.table) };
  return then(rendered(lost, v, ctx), (a) =>
    step(
      a,
      { type: 'closeNet' },
      { type: 'clearSave' },
      toast(hostLeftMsg(nameOf(v.players, 0)), GONE_TOAST_MS),
    ),
  );
};

/**
 * `local/click` for two, three or four seats (D1, D17): the room's options off the raw inputs,
 * the names off the first `seatCount` inputs (the third and fourth carried in `Raw`, else as last
 * remembered, else empty) through the shared `localSeats` rule with this game's defaults
 * (shellConfig.ts LOCAL_NAMES: the owner's "Ari and Lavi (with p3 Sandro and p4 Grant)"), the game
 * dealt and handed to the shared `startLocal`, then the options remembered. The shell's own case
 * seats a pair; this replaces it.
 */
const localStart = (
  app: App,
  intent: Readonly<{ p1: string; p2: string }> & Raw,
  ctx: Context,
): Step => {
  const opts = parseOpts(intent, app.shell.opts);
  const raws = [
    intent.p1,
    intent.p2,
    intent.p3 ?? app.table.extraNames[2] ?? '',
    intent.p4 ?? app.table.extraNames[3] ?? '',
  ].slice(0, opts.seatCount);
  const seats = localSeats(raws, localNamesOf(BRISCOLA_SHELL));
  const game = createGame(seatPlayers(opts.seatCount, seats), opts, ctx.rng, ctx.now);
  return then(startLocal(withShell(app, { opts }), game, ctx, BRISCOLA), (a) =>
    step(a, { type: 'writeOpts', opts }),
  );
};

/**
 * The rejoin paths (§4.2): a `join` while a game is on (the host re-broadcasts the state) and the
 * guest's `connected` reset `sent`, so a HELD lift reaches a peer that came back mid-hand; the host
 * losing its guest clears that seat's mirror (§4.4; seat 1 until PR-5 names the channel).
 */
const forIntent = (app: App, intent: Intent): App => {
  if (intent.type === 'host/guestGone')
    return withTable(app, { mirror: setMirror(app.table.mirror, intentFrame(1, null, 'hover')) });
  const rejoined =
    (intent.type === 'host/frame' && intent.frame.t === 'join' && app.shell.game !== null) ||
    intent.type === 'guest/connected';
  return rejoined ? withTable(app, { sent: null }) : app;
};

const reduceInner = (app: App, intent: Intent, ctx: Context): Step => {
  const v = app.shell.view;
  if (intent.type === 'guest/lost' && v?.phase === 'over') return hostLeft(app, v, ctx);
  if (intent.type === 'local/click') return localStart(app, intent, ctx);
  // The handoff is a two-seat room (D17): offered at two players only.
  if (intent.type === 'handoff/click' && seatCountOf(app) !== 2) return pure(app);
  if (!isShellIntent(intent)) return tableIntent(app, intent, ctx);
  const shell = reduceShell(app, intent, ctx, BRISCOLA);
  // The room's options are remembered as the table opens.
  return intent.type === 'host/click'
    ? then(shell, (a) => step(a, { type: 'writeOpts', opts: a.shell.opts }))
    : shell;
};

/** Every intent, then the live intent mirror's sender over the result (§4.2). */
export const reduce = (app: App, intent: Intent, ctx: Context): Step =>
  withIntent(reduceInner(forIntent(app, intent), intent, ctx));

// ---- storage: persist and resume -------------------------------------------------------------

/** The resume box `initHome` shows, or null (a decided game is not offered). */
export const resumeFor = (save: Save | null): Resume | null => shellResumeFor(save, BRISCOLA);

/** `persist()`: the save for the current role, or null when there is nothing to save. */
export const saveFor = (app: App): Save | null => shellSaveFor(app.shell);

/** `initHome`'s reads: the names, the tab, mode and options (defaults when unreadable), the card pack, the save. */
export const readHome = (store: Store): HomeSnapshot => shellReadHome(store, BRISCOLA);

// ---- what the sessions read back ---------------------------------------------------------------

/** The host session's context: the shell's fields and the room's six options (web/shared/net/host.ts `HostContext<Room>`). */
export type HostContext = HostContextOf<Briscola> & HostExtra;
export type GuestContext = GuestContextOf;

export const hostContextOf = (app: App): HostContext => shellHostContextOf(app.shell);

export const guestContextOf = (app: App): GuestContext => shellGuestContextOf(app.shell);

// ---- running the effects -----------------------------------------------------------------------

/** The adapters an effect reaches: the shell's (web/shared/ui/shellEffects.ts); briscola adds none. main.ts constructs the real ones, tests record. */
export type EffectDeps = ShellEffectDeps<Briscola>;

/** One effect against the adapters; `app` is the state after the step that produced it. Briscola's four first, then the shell's runner. */
export const runEffect = (app: App, effect: Effect, deps: EffectDeps): void => {
  if (isShellEffect(effect)) {
    runShellEffect(app.shell, effect, deps, BRISCOLA);
    return;
  }
  switch (effect.type) {
    case 'writeOpts':
      writeOpts(deps.store, effect.opts);
      return;
    case 'rememberPName':
      EXTRA_NAME_PREFS[effect.seat].write(deps.store, effect.name);
      return;
    case 'writeCardPack':
      writeCardPack(deps.store, effect.pack);
      return;
    case 'writeSpeed':
      writeSpeed(deps.store, effect.speed);
      return;
    case 'writeLang':
      writeLang(deps.store, effect.name);
      return;
  }
};
