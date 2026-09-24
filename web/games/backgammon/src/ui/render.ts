// Where the Sheshbesh page's DOM writes for the game screens live (docs/design/backgammon-board.md §2 "The one DOM",
// §4 "The interaction model"; docs/ARCHITECTURE.md "Module boundaries": ui/ reaches the
// document only through the shared DOM edge). `paint(doc, app)` is idempotent and runs after
// every intent: the screen switch and the waiting statuses, the home screen (ui/home.ts), the
// curtain (ui/local.ts), the table, the result sheet, the endgame and the overlays, each written
// from the App (ui/state.ts) alone, so the same App always paints the same DOM. Gin's
// ui/render.ts is the shape (so a shared shell, design §5.3, stays mechanical); the
// table is this game's.
//
// The board is keyed (design §2.2): every container of `#board` carries `data-key` and is
// rebuilt from ui/board.ts's templates only when its key changes, so a selection change never
// recreates checkers and the `.selected` lift transitions; highlights, `data-die` and the aria
// labels are refreshed outside the key on every paint. A move changes the key of exactly two
// containers (three with a hit), and `flightsBetween` + ui/board/fly.ts fly the checkers between
// the two paints. `bindAll` turns the table's and the overlays' controls into intents (one
// delegated click on `#board`, design §4.2; Enter/Space on a focused place is the same tap,
// design §6); the input wiring of the home screen and the curtain is beside their paints.
import {
  closestFrom,
  dataOf,
  hasClass,
  isDisabled,
  keyOf,
  listen,
  listenId,
  preventDefault,
  queryIn,
  requireId,
  safeHtml,
  setAttr,
  setChecked,
  setDisabled,
  setHtml,
  setText,
  targetIdOf,
  toggleClass,
  trustedHtml,
  type DocumentLike,
  type Element,
  type PageLike,
  type SafeHtml,
} from '../../../../shared/edge/dom.ts';
import {
  POINT_INDICES,
  matchWinner,
  rulesOf,
  type Die,
  type GameRecord,
  type PointIndex,
  type Seat,
  type ShippedVariant,
  type View,
} from '../engine/index.ts';
import {
  absOfId,
  barHtml,
  barsOf,
  chipsFor,
  chipsHtml,
  chipsKey,
  countKey,
  cubeOwner,
  cubeText,
  diceFor,
  diceHtml,
  diceWords,
  effectiveSelection,
  flightsBetween,
  offHtml,
  offIdFor,
  ownPoint,
  pipHtml,
  placeAria,
  pointHtml,
  pointId,
  resultText,
  sideOf,
  sourcesOf,
  stackKey,
  statusText,
  targetsOf,
  type Flight,
  type Place,
  type PlaceId,
  type Target,
} from './board.ts';
import { bindDrag } from './board/dragger.ts';
import { flyMoves } from './board/fly.ts';
import { bindHome, paintHome } from './home.ts';
import { bindLocal, paintCurtain } from './local.ts';
import { rulesItemsHtml } from './rules.ts';
import { SCREENS, handoffLabel, type App, type Intent } from './state.ts';

export type { PageLike };
export type Dispatch = (intent: Intent) => void;

// ---- the shell (gin's painters under gin's names) -------------------------------------------------

/** The ids of the two `<ul class="rules-list">` slots: the home tab's and the in-game overlay's. */
export const RULES_SLOT_IDS = ['rulesList', 'rulesOverlayList'] as const;

/** Fill both rules slots for `variant` (ui/rules.ts); keyed, so a repaint rewrites nothing. */
export const renderRules = (doc: DocumentLike, variant: ShippedVariant): void => {
  RULES_SLOT_IDS.forEach((id) => {
    const slot = requireId(doc, id);
    if (dataOf(slot, 'key') === variant) return;
    setAttr(slot, 'data-key', variant);
    setHtml(slot, trustedHtml(rulesItemsHtml(variant)));
  });
};

/** The rules the player is looking at: the game in play's, else the home screen's choice. */
const paintRules = (doc: DocumentLike, app: App): void => {
  renderRules(doc, app.shell.view?.variant ?? app.shell.variant);
};

/** `showScreen(id)`: every screen but `id` gets `hidden`; the table locks the body to the viewport. */
export const paintScreen = (doc: PageLike, app: App): void => {
  SCREENS.forEach((id) => {
    toggleClass(requireId(doc, id), 'hidden', id !== app.shell.screen);
  });
  toggleClass(doc.body, 'fixed-screen', app.shell.screen === 'tableScreen');
};

/** `#roomCode`, `#hostWaitStatus` (+ its pulse), `#startGameBtn`, `#guestWaitStatus` (+ its pulse). */
export const paintWaiting = (doc: DocumentLike, app: App): void => {
  setText(requireId(doc, 'roomCode'), app.shell.code ?? '----');
  const hostStatus = requireId(doc, 'hostWaitStatus');
  setText(hostStatus, app.shell.hostStatus.text);
  toggleClass(hostStatus, 'pulse', app.shell.hostStatus.pulse);
  toggleClass(requireId(doc, 'startGameBtn'), 'hidden', !app.shell.startGameVisible);
  const guestStatus = requireId(doc, 'guestWaitStatus');
  setText(guestStatus, app.shell.guestStatus.text);
  toggleClass(guestStatus, 'pulse', app.shell.guestStatus.pulse);
};

/** The hit toast (design §4.9) wears the one warm edge (`#toast.hit`). */
export const HIT_TOAST_PREFIX = 'Kapará.';

/** `toast(msg)`'s DOM half: the text and the `show` class; main.ts keeps the hide timer. */
export const showToast = (doc: DocumentLike, message: string): void => {
  const el = requireId(doc, 'toast');
  setText(el, message);
  toggleClass(el, 'hit', message.startsWith(HIT_TOAST_PREFIX));
  toggleClass(el, 'show', true);
};

export const hideToast = (doc: DocumentLike): void => {
  toggleClass(requireId(doc, 'toast'), 'show', false);
};

/** `fx.renderToggle()`: `#soundBtn`'s glyph, tooltip and pressed state (it is a toggle). */
export const paintSound = (doc: DocumentLike, enabled: boolean): void => {
  const btn = requireId(doc, 'soundBtn');
  setText(btn, enabled ? '🔊' : '🔇');
  setAttr(btn, 'title', enabled ? 'Sound & vibration on' : 'Sound & vibration off');
  setAttr(btn, 'aria-pressed', enabled ? 'true' : 'false');
};

/**
 * `#handoffBtn` (the 🌐 beside the menu button): a pass-and-play game can go on as a hosted room
 * (ui/state.ts `handoff`); the tooltip names who hosts and who joins. Pass-and-play alone shows it.
 */
export const paintHandoff = (doc: DocumentLike, app: App): void => {
  const btn = requireId(doc, 'handoffBtn');
  const game = app.shell.role === 'local' ? app.shell.game : null;
  toggleClass(btn, 'hidden', game === null);
  if (game !== null) setAttr(btn, 'title', handoffLabel(game));
};

// A sheet is an overlay a flag shows; the same flag's intent answers its close button, a tap on
// its backdrop (the overlay element itself, never its children) and Escape.
type Sheet = Readonly<{ overlay: string; close: string; intent: Intent }>;
const SHEETS: ReadonlyArray<Sheet> = [
  { overlay: 'rulesOverlay', close: 'closeRulesBtn', intent: { type: 'rules/toggle' } },
  { overlay: 'historyOverlay', close: 'closeHistoryBtn', intent: { type: 'history/toggle' } },
  { overlay: 'menuOverlay', close: 'closeMenuBtn', intent: { type: 'menu/toggle' } },
  { overlay: 'resultOverlay', close: 'rsPeekBtn', intent: { type: 'result/peek' } },
];

const paintSheet = (doc: DocumentLike, overlay: string, open: boolean): void => {
  toggleClass(requireId(doc, overlay), 'hidden', !open);
};

// ---- the table: frame, strips, status (design §2.1) --------------------------------------------

/**
 * `paintSeat` (design §2.1): `#board[data-seat]`, each point's `data-own` and its `pt-near`/
 * `pt-far` side, written only when the seat differs from what the board shows (once per game, and
 * on a seat swap); the static markup ships seat 0's.
 */
export const paintSeat = (doc: DocumentLike, v: View): void => {
  const board = requireId(doc, 'board');
  const seat = String(v.me.idx);
  if (dataOf(board, 'seat') === seat) return;
  setAttr(board, 'data-seat', seat);
  POINT_INDICES.forEach((abs) => {
    const el = requireId(doc, pointId(abs));
    const own = ownPoint(v, abs);
    setAttr(el, 'data-own', String(own));
    toggleClass(el, 'pt-near', sideOf(own) === 'near');
    toggleClass(el, 'pt-far', sideOf(own) === 'far');
  });
};

/** `#oppDot`'s whole class attribute; pass-and-play hides it. */
export const connDotClass = (app: App): string =>
  `conn-dot ${app.shell.oppConnected ? 'on' : 'off'}${app.shell.role === 'local' ? ' hidden' : ''}`;

/** `#gameBadge`: `Game 3 · 2–1 · to 5` (design §4.11), seats in order. */
export const gameBadgeText = (v: View): string =>
  `Game ${String(v.gameNo)} · ${String(v.match.score[0])}–${String(v.match.score[1])} · to ${String(v.match.length)}`;

const paintOpponent = (doc: DocumentLike, app: App, v: View): void => {
  setText(requireId(doc, 'oppName'), v.opp.name);
  const dot = requireId(doc, 'oppDot');
  setAttr(dot, 'class', connDotClass(app));
  setAttr(dot, 'title', app.shell.oppConnected ? 'Connected' : 'Disconnected');
  setHtml(requireId(doc, 'pipsOpp'), trustedHtml(pipHtml(v.pips[v.opp.idx])));
  // The strip has no id of its own (design §2.1): the opponent's name pulses while they are to move.
  const strip = queryIn(requireId(doc, 'tableScreen'), '.opp-strip');
  if (strip !== null) toggleClass(strip, 'to-move', !v.isMyTurn && v.phase !== 'over');
  setText(requireId(doc, 'gameBadge'), gameBadgeText(v));
};

/** The R14 beat is on: the forfeited roll stays on the table and the status line (design §4.5). */
const holdingNoMove = (app: App): boolean => app.table.noMoveUntil !== null;

const paintStatus = (doc: DocumentLike, app: App, v: View): void => {
  const noMoveShown = holdingNoMove(app);
  setText(
    requireId(doc, 'statusText'),
    statusText(v, { pending: app.table.pending, noMoveShown, picked: app.table.picked }),
  );
  // The dice in words for screen readers (design §6), exactly while faces are shown.
  const shown = diceFor(v, app.table.picked, noMoveShown).faces.length > 0;
  setText(requireId(doc, 'statusDice'), shown ? diceWords(v.dice) : '');
};

// ---- the keyed places (design §2.2) -------------------------------------------------------------

/** Rebuild `el` from `markup` only when `key` differs from its `data-key`, so its children survive a paint. */
const ensureKeyed = (el: Element, key: string, markup: () => string): void => {
  if (dataOf(el, 'key') === key) return;
  setAttr(el, 'data-key', key);
  setHtml(el, trustedHtml(markup()));
};

/** A bar half's key: `${owner}${count}` as `stackKey` spells a point's (`-0` when empty). */
export const barKey = (seat: Seat, count: number): string =>
  count === 0 ? '-0' : `${seat === 0 ? 'L' : 'D'}${String(count)}`;

const paintPlaces = (doc: DocumentLike, v: View): void => {
  POINT_INDICES.forEach((abs) => {
    const stack = v.board.points[abs] ?? [];
    ensureKeyed(requireId(doc, pointId(abs)), stackKey(stack), () => pointHtml(stack));
  });
  const bars = barsOf(v);
  ensureKeyed(requireId(doc, 'barTop'), barKey(bars.top.seat, bars.top.count), () =>
    barHtml(bars.top.seat, bars.top.count),
  );
  ensureKeyed(requireId(doc, 'barBottom'), barKey(bars.bottom.seat, bars.bottom.count), () =>
    barHtml(bars.bottom.seat, bars.bottom.count),
  );
  ([0, 1] as const).forEach((seat) => {
    const off = v.board.off[seat];
    ensureKeyed(requireId(doc, offIdFor(seat)), countKey(off), () => offHtml(off));
  });
};

// ---- highlights, outside the key (design §3.7, §4.2, §4.5, §4.12) -------------------------

/** What a place wears this paint, resolved once per place from the App and the view. */
type Marks = Readonly<{
  canMove: boolean;
  selected: boolean;
  /** The selection is the derived sole source, not a tap: ring without lift. */
  auto: boolean;
  target: Target | null;
  /** One maximal play: the destinations pulse harder. */
  only: boolean;
  drop: boolean;
  shake: boolean;
  /** A blot was just hit here (from this paint's flights). */
  hit: boolean;
}>;

const NO_MARKS: Marks = {
  canMove: false,
  selected: false,
  auto: false,
  target: null,
  only: false,
  drop: false,
  shake: false,
  hit: false,
};

/** The board is live for me: my turn, moving, no curtain up (design §4.2 rule 9). */
export const isLive = (app: App, v: View): boolean =>
  v.isMyTurn && v.phase === 'moving' && app.table.curtain === null;

/** The selection and the lit targets this paint shows; nothing when the board is not mine to move. */
type Lit = Readonly<{
  sources: ReadonlyArray<Place>;
  selected: Place | null;
  auto: boolean;
  targets: ReadonlyArray<Target>;
}>;
const litOf = (app: App, v: View): Lit => {
  if (!isLive(app, v)) return { sources: [], selected: null, auto: false, targets: [] };
  const selected = effectiveSelection(app.table.selected, v);
  return {
    sources: sourcesOf(v),
    selected,
    auto: selected !== null && app.table.selected !== selected,
    targets: selected === null ? [] : targetsOf(v, selected, app.table.picked),
  };
};

const applyMarks = (el: Element, v: View, id: PlaceId, m: Marks): void => {
  toggleClass(el, 'can-move', m.canMove);
  toggleClass(el, 'selected', m.selected);
  toggleClass(el, 'auto', m.selected && m.auto);
  toggleClass(el, 'target', m.target?.kind === 'target');
  toggleClass(el, 'target-2', m.target?.kind === 'target-2');
  toggleClass(el, 'only', m.target !== null && m.only);
  toggleClass(el, 'drop', m.drop);
  toggleClass(el, 'shake', m.shake);
  toggleClass(el, 'hit', m.hit);
  setAttr(el, 'data-die', m.target?.die ?? null);
  setAttr(el, 'aria-pressed', m.selected ? 'true' : 'false');
  setAttr(
    el,
    'aria-label',
    placeAria(v, id, { canMove: m.canMove, selected: m.selected, die: m.target?.die ?? null }),
  );
};

/** Every place's classes, `data-die` and aria label (`paintHighlights` + `paintDrag` in web/shared/styles/CONTRACT.md). */
const paintHighlights = (
  doc: DocumentLike,
  app: App,
  v: View,
  hits: ReadonlySet<PointIndex>,
): void => {
  const lit = litOf(app, v);
  const only = v.playsTotal === 1;
  const over = app.table.drag?.over ?? null;
  const targetAt = (to: PointIndex | 'off'): Target | null =>
    lit.targets.find((t) => t.to === to) ?? null;
  POINT_INDICES.forEach((abs) => {
    applyMarks(requireId(doc, pointId(abs)), v, pointId(abs), {
      canMove: lit.sources.includes(abs),
      selected: lit.selected === abs,
      auto: lit.auto,
      target: targetAt(abs),
      only,
      drop: over === abs,
      shake: app.table.shake === abs,
      hit: hits.has(abs),
    });
  });
  applyMarks(requireId(doc, 'barBottom'), v, 'barBottom', {
    ...NO_MARKS,
    canMove: lit.sources.includes('bar'),
    selected: lit.selected === 'bar',
    auto: lit.auto,
  });
  applyMarks(requireId(doc, 'barTop'), v, 'barTop', NO_MARKS);
  const mine = offIdFor(v.me.idx);
  const theirs = offIdFor(v.opp.idx);
  applyMarks(requireId(doc, mine), v, mine, {
    ...NO_MARKS,
    target: targetAt('off'),
    only,
    drop: over === 'off',
  });
  applyMarks(requireId(doc, theirs), v, theirs, NO_MARKS);
};

// ---- dice, cube, controls (design §2.2 `#dice`, §4.7, §4.3) --------------------------------

const paintDice = (doc: DocumentLike, app: App, v: View): void => {
  const model = diceFor(v, app.table.picked, holdingNoMove(app));
  const dice = requireId(doc, 'dice');
  // `rolling` pulses once when the faces change (a fresh roll): it is on for the paint that brings
  // them and off again on the next one; the tumble runs its 350ms in between (design §2.2).
  const roll = model.faces.map((f) => String(f.die)).join('');
  toggleClass(dice, 'rolling', roll !== '' && dataOf(dice, 'roll') !== roll);
  setAttr(dice, 'data-roll', roll === '' ? null : roll);
  ensureKeyed(dice, model.key, () => diceHtml(model));
  setAttr(dice, 'aria-label', roll === '' ? 'Roll' : `Dice: ${diceWords(v.dice)}`);
  ensureKeyed(requireId(doc, 'diceMini'), model.key, () => diceHtml(model));
  const cube = requireId(doc, 'cube');
  toggleClass(cube, 'hidden', !rulesOf(v.variant).cube);
  setText(cube, cubeText(v.cube));
  setAttr(cube, 'data-owner', cubeOwner(v.cube, v.me.idx));
};

/**
 * `#rollBtn`'s copy (design §4.7): "Buen mazal! (roll)", or the incoming player's name before
 * it in pass-and-play without the curtain, where the button is the only cue that the phone
 * changed hands.
 */
export const rollLabel = (app: App, v: View): SafeHtml =>
  app.shell.role === 'local' && app.table.curtainMode === 'never'
    ? safeHtml`${v.me.name} — Buen mazal! <small>roll</small>`
    : trustedHtml('Buen mazal! <small>roll</small>');

/** `#waitNote` (design §4.8, §4.10): `Waiting for Jeff…`, or the cube after my double. */
export const waitNoteText = (v: View): string =>
  v.phase === 'cubeOffered'
    ? `${v.opp.name} is thinking about the cube`
    : `Waiting for ${v.opp.name}…`;

const paintControls = (doc: DocumentLike, app: App, v: View): void => {
  setText(requireId(doc, 'myName'), v.me.name);
  setHtml(requireId(doc, 'pipsMe'), trustedHtml(pipHtml(v.pips[v.me.idx])));
  const mine = v.isMyTurn && app.table.curtain === null;
  const over = v.phase === 'over';
  // Disabled, not hidden: the controls row keeps its shape (design §4.6).
  setDisabled(requireId(doc, 'undoBtn'), !(mine && v.canUndo));
  toggleClass(
    requireId(doc, 'doubleBtn'),
    'hidden',
    !(mine && v.phase === 'toRoll' && v.canDouble),
  );
  // Reserved (design §1 "Turn end"): the turn ends by itself.
  toggleClass(requireId(doc, 'doneBtn'), 'hidden', true);
  const rollBtn = requireId(doc, 'rollBtn');
  toggleClass(rollBtn, 'hidden', !(mine && v.phase === 'toRoll'));
  setHtml(rollBtn, rollLabel(app, v));
  toggleClass(requireId(doc, 'diceMini'), 'hidden', !(mine && v.phase === 'moving'));
  const wait = requireId(doc, 'waitNote');
  toggleClass(wait, 'hidden', over || v.isMyTurn || app.table.curtain !== null);
  setText(wait, waitNoteText(v));
  toggleClass(requireId(doc, 'resultChipBtn'), 'hidden', !(over && !app.table.resultOpen));
  // The die-chip tray takes the row while a choice is pending (design §4.3).
  const pending = app.table.pending;
  const chips = pending === null ? [] : chipsFor(v, pending.chains);
  toggleClass(requireId(doc, 'controls'), 'choosing', pending !== null);
  const tray = requireId(doc, 'moveChips');
  ensureKeyed(tray, chipsKey(chips), () => chipsHtml(chips));
  toggleClass(tray, 'hidden', pending === null);
  toggleClass(requireId(doc, 'chipCancelBtn'), 'hidden', pending === null);
};

// ---- the result sheet, the endgame, the cube offer (design §4.8, §4.11) ------------------------

/** `#rsNextBtn` / `#nextGameBtn`: the host or pass-and-play starts the next game; the guest waits. */
export const nextLabel = (app: App, v: View): string =>
  app.shell.role === 'guest'
    ? `Waiting for ${v.opp.name} to start the next game`
    : v.matchOver
      ? 'Rematch'
      : 'Next game';

const paintResult = (doc: DocumentLike, app: App, v: View): void => {
  paintSheet(doc, 'resultOverlay', v.phase === 'over' && !v.matchOver && app.table.resultOpen);
  if (v.phase !== 'over') return;
  const text = resultText(v);
  setText(requireId(doc, 'rsTitle'), text.title);
  setText(requireId(doc, 'rsSub'), text.sub);
  setText(requireId(doc, 'rsScore'), text.score);
  const next = requireId(doc, 'rsNextBtn');
  setText(next, nextLabel(app, v));
  setDisabled(next, app.shell.role === 'guest');
};

/** `#resultTitle`: `Ari takes the match 5–2`. */
export const matchTitle = (v: View): string => {
  const w: Seat = matchWinner(v.match) ?? (v.match.score[0] >= v.match.score[1] ? 0 : 1);
  const l: Seat = w === 0 ? 1 : 0;
  return `${v.players[w].name} takes the match ${String(v.match.score[w])}–${String(v.match.score[l])}`;
};

/** `#resultSub`: `6 games` (the match's own start is not in the view, so no duration yet). */
export const matchSubText = (v: View): string =>
  `${String(v.games.length)} game${v.games.length === 1 ? '' : 's'}`;

/** How a finished game ended, for its score row. */
export const recordKind = (g: GameRecord): string =>
  g.reason === 'passed'
    ? 'passed'
    : g.multiplier === 2
      ? 'gammon'
      : g.multiplier === 3
        ? 'backgammon'
        : 'single';

/** `#matchScore`: one row per finished game, `Game 3 · Ari · gammon · 2` (design §4.11). */
export const scoreHtml = (v: View): SafeHtml =>
  safeHtml`${v.games.map(
    (g) =>
      safeHtml`<div class="score-row"><span>Game ${g.gameNo}</span><span class="who">${v.players[g.winner].name}</span><span>${recordKind(g)}</span><span>${g.points}</span></div>`,
  )}`;

const paintEndgame = (doc: DocumentLike, app: App, v: View): void => {
  setText(requireId(doc, 'resultTitle'), matchTitle(v));
  setText(requireId(doc, 'resultSub'), matchSubText(v));
  const score = requireId(doc, 'matchScore');
  const key = `${String(v.games.length)}:${String(v.startedAt)}`;
  if (dataOf(score, 'key') !== key) {
    setAttr(score, 'data-key', key);
    setHtml(score, scoreHtml(v));
  }
  const next = requireId(doc, 'nextGameBtn');
  setText(next, nextLabel(app, v));
  setDisabled(next, app.shell.role === 'guest');
};

/** `#cubeOfferText` and `#passBtn` (design §4.8): `Ari doubles to 2. Take or pass?` · `Pass (Ari wins 1)`. */
export const cubeOfferText = (v: View): Readonly<{ offer: string; pass: string }> => ({
  offer: `${v.opp.name} doubles to ${String(v.cube.value * 2)}. Take or pass?`,
  pass: `Pass (${v.opp.name} wins ${String(v.cube.value)})`,
});

const paintCube = (doc: DocumentLike, app: App, v: View): void => {
  // The responder answers (`isMyTurn` names them); the doubler sees `#waitNote` instead.
  const open = v.phase === 'cubeOffered' && v.isMyTurn && app.table.curtain === null;
  paintSheet(doc, 'cubeOverlay', open);
  if (!open) return;
  const text = cubeOfferText(v);
  setText(requireId(doc, 'cubeOfferText'), text.offer);
  setText(requireId(doc, 'passBtn'), text.pass);
};

// ---- the history and the menu ---------------------------------------------------------------------

/** `#historyList`: one row per log line of this game, the seat's name as `.who`, or a note. */
export const historyHtml = (v: View | null): SafeHtml => {
  if (v === null || v.log.length === 0)
    return trustedHtml('<div class="empty-note">Nothing has happened yet.</div>');
  return safeHtml`${v.log.map((e) => {
    const who = e.seat === null ? '' : v.players[e.seat].name;
    // The engine writes the name into the line; the row shows it once, as the label.
    const text = who !== '' && e.text.startsWith(`${who} `) ? e.text.slice(who.length + 1) : e.text;
    return safeHtml`<div class="history-row" data-kind="${e.kind}"><span class="who">${who}</span> ${text}</div>`;
  })}`;
};

const paintOverlays = (doc: DocumentLike, app: App): void => {
  paintSheet(doc, 'rulesOverlay', app.shell.rulesOpen);
  paintSheet(doc, 'historyOverlay', app.table.historyOpen);
  if (app.table.historyOpen) {
    const list = requireId(doc, 'historyList');
    const v = app.shell.view;
    const key = v === null ? '-' : `${String(v.gameNo)}:${String(v.log.length)}`;
    if (dataOf(list, 'key') !== key) {
      setAttr(list, 'data-key', key);
      setHtml(list, historyHtml(v));
    }
  }
  paintSheet(doc, 'menuOverlay', app.table.menuOpen);
  // The binder has no App: the mode a change switches to is painted onto the checkbox.
  const toggle = requireId(doc, 'menuCurtainToggle');
  setChecked(toggle, app.table.curtainMode === 'always');
  setAttr(toggle, 'data-next', app.table.curtainMode === 'always' ? 'never' : 'always');
};

// ---- the whole paint ------------------------------------------------------------------------------

/** The position a paint is keyed on: a change flies the checkers `flightsBetween` names (design §3.9). */
export const viewKey = (v: View): string =>
  `${String(v.gameNo)}:${String(v.startedAt)}:${String(v.turn)}:${v.phase}:${String(v.played.length)}:${String(v.log.length)}`;

/** The points whose blot a hit flight lifts to the bar: they flash `hit` this paint. */
const hitPointsOf = (flights: ReadonlyArray<Flight>): ReadonlySet<PointIndex> =>
  new Set(
    flights.flatMap((f) => {
      const abs = f.hit === true ? absOfId(f.fromContainer) : null;
      return abs === null ? [] : [abs];
    }),
  );

const paintTable = (doc: DocumentLike, app: App, v: View, hits: ReadonlySet<PointIndex>): void => {
  paintSeat(doc, v);
  paintOpponent(doc, app, v);
  paintStatus(doc, app, v);
  paintPlaces(doc, v);
  paintHighlights(doc, app, v, hits);
  paintDice(doc, app, v);
  paintControls(doc, app, v);
  toggleClass(requireId(doc, 'board'), 'inert', !isLive(app, v));
  paintResult(doc, app, v);
  paintCube(doc, app, v);
};

/**
 * The game screens from a view: the endgame once the match is over, else the table and its
 * sheets. The checkers a new position moved fly from where the previous paint put them
 * (`table.lastPainted`, the view the reducer replaced) to where this one does; a paint of the same
 * position (a tap, a toast) flies nothing, which `#board[data-view]` remembers.
 */
const paintGame = (doc: PageLike, app: App): void => {
  const v = app.shell.view;
  if (v === null) {
    paintSheet(doc, 'resultOverlay', false);
    paintSheet(doc, 'cubeOverlay', false);
    return;
  }
  if (v.matchOver) {
    paintEndgame(doc, app, v);
    paintSheet(doc, 'resultOverlay', false);
    paintSheet(doc, 'cubeOverlay', false);
    return;
  }
  const board = requireId(doc, 'board');
  const key = viewKey(v);
  const prev = app.table.lastPainted;
  const flights = dataOf(board, 'view') !== key && prev !== null ? flightsBetween(prev, v) : [];
  setAttr(board, 'data-view', key);
  flyMoves(doc, flights, () => {
    paintTable(doc, app, v, hitPointsOf(flights));
  });
};

/** Everything, from the App alone. */
export const paint = (doc: PageLike, app: App): void => {
  paintScreen(doc, app);
  paintWaiting(doc, app);
  paintHome(doc, app);
  paintRules(doc, app);
  paintCurtain(doc, app);
  paintHandoff(doc, app);
  paintGame(doc, app);
  paintOverlays(doc, app);
};

// ---- input wiring (design §4.2, §6) ------------------------------------------------------------

const DICE: ReadonlyArray<Die> = [1, 2, 3, 4, 5, 6];
const dieOf = (el: Element): Die | null => {
  const n = Number(dataOf(el, 'die'));
  return DICE.find((d) => d === n) ?? null;
};
/** The absolute point of a `.point` (`data-abs` is 1-based). */
const absOfPoint = (el: Element): PointIndex | null => {
  const n = Number(dataOf(el, 'abs')) - 1;
  return POINT_INDICES.find((abs) => abs === n) ?? null;
};

/**
 * The intent a tap (or Enter/Space) on `#board` raises, from the element it landed on: a die while
 * moving forces that die, the dice otherwise roll, a point, a bar or a tray names itself; the
 * board's own surface closes the die-chip tray. No seat or viewport logic here: the reducer knows
 * which bar and tray are mine.
 */
export const boardIntentOf = (e: Readonly<Event>): Intent | null => {
  const die = closestFrom(e, '.die');
  if (die !== null) {
    const d = dieOf(die);
    return d === null ? { type: 'roll/click' } : { type: 'die/pick', die: d };
  }
  if (closestFrom(e, '.dice') !== null) return { type: 'roll/click' };
  const point = closestFrom(e, '.point');
  if (point !== null) {
    const abs = absOfPoint(point);
    return abs === null ? null : { type: 'point/tap', point: abs };
  }
  if (closestFrom(e, '.bar') !== null) return { type: 'bar/tap' };
  if (closestFrom(e, '.off') !== null) return { type: 'off/tap' };
  return targetIdOf(e) === 'board' ? { type: 'chip/cancel' } : null;
};

const bindSheets = (doc: PageLike, dispatch: Dispatch): void => {
  SHEETS.forEach(({ overlay, close, intent }) => {
    listenId(doc, close, 'click', () => {
      dispatch(intent);
    });
    listenId(doc, overlay, 'click', (e) => {
      if (targetIdOf(e) === overlay) dispatch(intent);
    });
  });
  // Escape closes the open sheet, else the die-chip tray (design §6).
  listen(doc, 'keydown', (e) => {
    if (keyOf(e) !== 'Escape') return;
    const open = SHEETS.find((s) => !hasClass(requireId(doc, s.overlay), 'hidden'));
    dispatch(open === undefined ? { type: 'chip/cancel' } : open.intent);
  });
};

/** A button's click as one intent, skipped while it is disabled. */
const button = (doc: PageLike, id: string, intent: Intent, dispatch: Dispatch): void => {
  const el = requireId(doc, id);
  listen(el, 'click', () => {
    if (!isDisabled(el)) dispatch(intent);
  });
};

/** The table's, the sheets' and the endgame's controls, each an intent. */
export const bindTable = (doc: PageLike, dispatch: Dispatch): void => {
  listenId(doc, 'board', 'click', (e) => {
    const intent = boardIntentOf(e);
    if (intent !== null) dispatch(intent);
  });
  // Enter/Space on a focused place is its tap (design §6); the page must not scroll on Space.
  listenId(doc, 'board', 'keydown', (e) => {
    const k = keyOf(e);
    if (k !== 'Enter' && k !== ' ') return;
    const intent = boardIntentOf(e);
    if (intent === null) return;
    preventDefault(e);
    dispatch(intent);
  });
  // A checker dragged by hand (ui/board/dragger.ts); its intents are the reducer's `checker/*`.
  bindDrag(doc, dispatch);
  listenId(doc, 'moveChips', 'click', (e) => {
    const chip = closestFrom(e, '.chip');
    const index = chip === null ? null : dataOf(chip, 'index');
    if (index !== null) dispatch({ type: 'chip/tap', index: Number(index) });
  });
  button(doc, 'chipCancelBtn', { type: 'chip/cancel' }, dispatch);
  button(doc, 'undoBtn', { type: 'undo/click' }, dispatch);
  button(doc, 'doubleBtn', { type: 'double/click' }, dispatch);
  button(doc, 'doneBtn', { type: 'done/click' }, dispatch);
  button(doc, 'rollBtn', { type: 'roll/click' }, dispatch);
  button(doc, 'resultChipBtn', { type: 'result/open' }, dispatch);
  button(doc, 'rsNextBtn', { type: 'next/click' }, dispatch);
  button(doc, 'nextGameBtn', { type: 'next/click' }, dispatch);
  button(doc, 'takeBtn', { type: 'take/click' }, dispatch);
  button(doc, 'passBtn', { type: 'pass/click' }, dispatch);
  button(doc, 'leaveBtn', { type: 'leave/request' }, dispatch);
  button(doc, 'menuBtn', { type: 'menu/toggle' }, dispatch);
  button(doc, 'soundBtn', { type: 'sound/toggle' }, dispatch);
  button(doc, 'handoffBtn', { type: 'handoff/click' }, dispatch);
  button(doc, 'rulesBtnGame', { type: 'rules/toggle' }, dispatch);
  button(doc, 'historyBtn', { type: 'history/toggle' }, dispatch);
  // The menu's rows close the menu and open what they name.
  listenId(doc, 'menuRulesBtn', 'click', () => {
    dispatch({ type: 'menu/toggle' });
    dispatch({ type: 'rules/toggle' });
  });
  listenId(doc, 'menuHistoryBtn', 'click', () => {
    dispatch({ type: 'menu/toggle' });
    dispatch({ type: 'history/toggle' });
  });
  listenId(doc, 'menuLeaveBtn', 'click', () => {
    dispatch({ type: 'menu/toggle' });
    dispatch({ type: 'leave/request' });
  });
  const curtainToggle = requireId(doc, 'menuCurtainToggle');
  listen(curtainToggle, 'change', () => {
    const next = dataOf(curtainToggle, 'next');
    if (next === 'always' || next === 'never') dispatch({ type: 'curtain/mode', mode: next });
  });
};

/** Every control of the page (home, curtain, table, sheets), once, at boot. */
export const bindAll = (doc: PageLike, dispatch: Dispatch): void => {
  bindHome(doc, dispatch);
  bindLocal(doc, dispatch);
  bindTable(doc, dispatch);
  bindSheets(doc, dispatch);
};
