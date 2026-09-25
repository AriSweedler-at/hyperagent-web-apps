// The shell's painters and binders both game pages carried under the same names
// (docs/design/shared-shell.md §4.4 "Painters and binders"; §5 B1 moved them here): the screen
// switch, the waiting rooms, the toast, the sound and handoff buttons and the sheets (the keyed
// slot moved on to keyed.ts in docs/design/dry-round-2.md D1). Each is gin's `ui/render.ts` body
// (backgammon copied it word for word, docs/design/backgammon-board.md §4) over
// web/shared/edge/dom.ts, with the App replaced by the small view it
// read: `paint(doc, app)` in a game composes these with its own table painters, so the same App
// paints the same DOM as before the move (the DOM-snapshot oracle tools/parity/gin-dom-parity.ts
// and both render.test.ts suites hold it). What a game adds on top (gin's `data-card-back`,
// backgammon's `aria-pressed` and its `hit` toast) stays in that game's wrapper.
//
// Not lint-pure: these write the document, so the folder's pure profile (eslint.config.js `PURE`,
// tsconfig.pure.json) carves them out the way scorer/main.ts is, and tsconfig.web.json alone
// compiles them (they need the DOM lib through dom.ts).
import {
  hasClass,
  isDisabled,
  keyOf,
  listen,
  listenId,
  requireId,
  setAttr,
  setText,
  targetIdOf,
  toggleClass,
  type DocumentLike,
  type Element,
  type PageLike,
} from '../edge/dom.ts';
import type { ShellState, ShellTypes } from './shell.ts';

export type Dispatch<I> = (intent: I) => void;

/**
 * `showScreen(id)`: every screen but `current` gets `hidden`; the body locks to the viewport
 * (`fixed-screen`) at `fixedOn`, the table in both games.
 */
export const paintScreen = (
  doc: PageLike,
  screens: ReadonlyArray<string>,
  current: string,
  fixedOn: string,
): void => {
  screens.forEach((id) => {
    toggleClass(requireId(doc, id), 'hidden', id !== current);
  });
  toggleClass(doc.body, 'fixed-screen', current === fixedOn);
};

/** A waiting room's status line and whether it pulses (`app.hostStatus`, `app.guestStatus`). */
export type WaitStatus = Readonly<{ text: string; pulse: boolean }>;

/** What `paintWaiting` reads: gin's App carries these fields, backgammon's `app.shell` does. */
export type WaitingView = Readonly<{
  code: string | null;
  hostStatus: WaitStatus;
  guestStatus: WaitStatus;
  startGameVisible: boolean;
}>;

/** `#roomCode`, `#hostWaitStatus` (+ its pulse), `#startGameBtn`, `#guestWaitStatus` (+ its pulse). */
export const paintWaiting = (doc: DocumentLike, w: WaitingView): void => {
  setText(requireId(doc, 'roomCode'), w.code ?? '----');
  const hostStatus = requireId(doc, 'hostWaitStatus');
  setText(hostStatus, w.hostStatus.text);
  toggleClass(hostStatus, 'pulse', w.hostStatus.pulse);
  toggleClass(requireId(doc, 'startGameBtn'), 'hidden', !w.startGameVisible);
  const guestStatus = requireId(doc, 'guestWaitStatus');
  setText(guestStatus, w.guestStatus.text);
  toggleClass(guestStatus, 'pulse', w.guestStatus.pulse);
};

/**
 * The classes a game marks its toast with beside `show`, each on or off for this message
 * (backgammon's `hit` for the Kapará toast, web/shared/styles/CONTRACT.md's backgammon row); a
 * mark that is off is removed, so the next message never inherits it.
 */
export type ToastMarks = Readonly<Record<string, boolean>>;

/** `toast(msg)`'s DOM half: the text, the marks and the `show` class; toast.ts keeps the hide timer. */
export const showToast = (doc: DocumentLike, message: string, marks: ToastMarks = {}): void => {
  const el = requireId(doc, 'toast');
  setText(el, message);
  Object.entries(marks).forEach((mark: readonly [string, boolean]) => {
    toggleClass(el, mark[0], mark[1]);
  });
  toggleClass(el, 'show', true);
};

export const hideToast = (doc: DocumentLike): void => {
  toggleClass(requireId(doc, 'toast'), 'show', false);
};

/** `fx.renderToggle()`: `#soundBtn`'s glyph and tooltip (backgammon adds `aria-pressed` in its wrapper). */
export const paintSound = (doc: DocumentLike, enabled: boolean): void => {
  const btn = requireId(doc, 'soundBtn');
  setText(btn, enabled ? '🔊' : '🔇');
  setAttr(btn, 'title', enabled ? 'Sound & vibration on' : 'Sound & vibration off');
};

/**
 * `#handoffBtn` (the 🌐 on the table): a pass-and-play game can go on as a hosted room, the other
 * seat joining from its own device; `label` is the tooltip naming who hosts and who joins, null
 * when the button has no business showing (a room is online already, a scorer has no table).
 */
export const paintHandoff = (doc: DocumentLike, label: string | null): void => {
  const btn = requireId(doc, 'handoffBtn');
  toggleClass(btn, 'hidden', label === null);
  if (label !== null) setAttr(btn, 'title', label);
};

/**
 * The opponent's connection dot on the table (gin `#connDot`, backgammon `#oppDot`;
 * docs/design/dry-round-2.md E6): lit while the other seat's channel is open, hidden in
 * pass-and-play, where there is no channel. Both `paintOpponent`s spelled the class string and
 * the tooltip word for word over the two shell fields; the reader is shared too, now that
 * `ShellState` (shell.ts, C2) is the one type both games read it from.
 */
export type ConnDotView = Readonly<{ connected: boolean; hidden: boolean }>;

export const connDotView = (
  shell: Pick<ShellState<ShellTypes>, 'oppConnected' | 'role'>,
): ConnDotView => ({ connected: shell.oppConnected, hidden: shell.role === 'local' });

/** The dot's whole class attribute: `conn-dot on|off`, plus `hidden` in pass-and-play. */
export const connDotClass = (v: ConnDotView): string =>
  `conn-dot ${v.connected ? 'on' : 'off'}${v.hidden ? ' hidden' : ''}`;

export const paintConnDot = (doc: DocumentLike, id: string, v: ConnDotView): void => {
  const dot = requireId(doc, id);
  setAttr(dot, 'class', connDotClass(v));
  setAttr(dot, 'title', v.connected ? 'Connected' : 'Disconnected');
};

/** A sheet's overlay follows its flag. */
export const paintSheet = (doc: DocumentLike, overlay: string, open: boolean): void => {
  toggleClass(requireId(doc, overlay), 'hidden', !open);
};

/**
 * A sheet is an overlay a flag shows; the same flag's intent answers its close button and a tap
 * on its backdrop (the overlay element itself, never its children). Each game lists its own.
 */
export type Sheet<I> = Readonly<{ overlay: string; close: string; intent: I }>;

/**
 * Wire every sheet's close button and backdrop. With `escapeFallback`, Escape closes the open
 * sheet and, when none is open, dispatches the fallback (backgammon: the die-chip tray,
 * docs/design/backgammon-board.md §6); without it no key is listened to (gin).
 */
export const bindSheets = <I>(
  doc: PageLike,
  sheets: ReadonlyArray<Sheet<I>>,
  dispatch: Dispatch<I>,
  opts?: Readonly<{ escapeFallback: I }>,
): void => {
  sheets.forEach(({ overlay, close, intent }) => {
    listenId(doc, close, 'click', () => {
      dispatch(intent);
    });
    listenId(doc, overlay, 'click', (e) => {
      if (targetIdOf(e) === overlay) dispatch(intent);
    });
  });
  if (opts === undefined) return;
  listen(doc, 'keydown', (e) => {
    if (keyOf(e) !== 'Escape') return;
    const open = sheets.find((s) => !hasClass(requireId(doc, s.overlay), 'hidden'));
    dispatch(open === undefined ? opts.escapeFallback : open.intent);
  });
};

/**
 * A table of controls that each dispatch one constant intent on click, bound in one call
 * (docs/design/dry-round-2.md D2, item E4): the eleven `listenId(doc, id, 'click', () =>
 * dispatch({ ... }))` blocks gin's `bindTable` spelled and the sixteen `button(...)` lines
 * backgammon's did, which differed only in the id and the literal. A missing id throws at bind
 * time, as `listenId` does. `skipDisabled` is backgammon's `button()`: a click on a control that
 * carries `disabled` dispatches nothing (gin's constant controls never carry it and leave it off;
 * its `#actions` row is delegated and checks the attribute itself).
 */
export type ButtonIntents<I> = ReadonlyArray<readonly [id: string, intent: I]>;

export const bindButtons = <I>(
  doc: DocumentLike,
  dispatch: Dispatch<I>,
  entries: ButtonIntents<I>,
  opts?: Readonly<{ skipDisabled: boolean }>,
): void => {
  entries.forEach(([id, intent]) => {
    const el = requireId(doc, id);
    listen(el, 'click', () => {
      if (opts?.skipDisabled === true && isDisabled(el)) return;
      dispatch(intent);
    });
  });
};

/**
 * What a long press dispatches: `press` at pointerdown, one intent or a function of the event
 * that names the intent, or null for a pointer that landed on nothing pressable (gin's hand: a
 * card's id, or the felt between the cards); `release` when the pointer lifts, leaves or is
 * cancelled. The timer that turns a press into a long press is the reducer's, not this binder's.
 */
export type LongPressIntents<I> = Readonly<{
  press: I | ((e: Readonly<Event>) => I | null);
  release: I;
}>;

const isPressOf = <I>(
  press: LongPressIntents<I>['press'],
): press is (e: Readonly<Event>) => I | null => typeof press === 'function';

/**
 * home.ts's `bindLongPress` (the Play tab's submenu) with `press` widened to a function for gin's
 * card press (docs/design/dry-round-2.md D2, item E5); the home shell adopts this one when C2 has
 * landed (Wave G: its `press` is the constant form, so the call reads the same).
 */
export const bindLongPress = <I>(
  el: Element,
  dispatch: Dispatch<I>,
  intents: LongPressIntents<I>,
): void => {
  listen(el, 'pointerdown', (e) => {
    const intent = isPressOf(intents.press) ? intents.press(e) : intents.press;
    if (intent !== null) dispatch(intent);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => {
    listen(el, ev, () => {
      dispatch(intents.release);
    });
  });
};
