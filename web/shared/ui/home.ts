// The home screen's shell (docs/design/shared-shell.md §4.4 "home.ts", moved in §5 B2): the tabs
// and their panels, the play-mode switch and its submenu, the room-code field, the resume box and
// the host, join, deal, start, share and cancel buttons that gin's ui/home.ts and backgammon's
// spelled twice, word for word. The DOM is reached only through web/shared/edge/dom.ts. Each
// painter takes a small view record, not an App: the two reducers are still separate (§4.2 lands in
// Wave C), so a game builds the `HomeView` from its own state. The binder takes the game's intent
// constructors (`ShellIntentBuilders`) and its `startOptions` readers, so this module never imports
// a game's Intent type (eslint.config.js: shared code never imports a game). What stays with each
// game: gin's sandbox editor and Score Counter name inputs, backgammon's two selects, and the tab
// list each storage.ts decodes (`HOME_TABS`), which the game passes in.
//
// One legacy trait both games kept, kept here: `renderPlayMode` ran only when the Play tab was
// shown or the mode was set, so the mode buttons' `active` marks (the submenu's are visible on
// every tab) are painted only while the Play tab is the current one and are otherwise left as
// they were.
import {
  dataOf,
  inputDataOf,
  inputTypeOf,
  isWithin,
  keyOf,
  listen,
  listenId,
  preventDefault,
  queryAllIn,
  readValue,
  requireId,
  setText,
  setValue,
  stopPropagation,
  targetValueOf,
  toggleClass,
  type DocumentLike,
  type Element,
  type PageLike,
} from '../edge/dom.ts';
import { tabButtonId } from './ids.ts';

// The tab ids moved to ids.ts (pure) for the computed-style oracle; the import path holds.
export { tabButtonId };

/** What the shell paints from: the game's tab, mode, submenu flag and the resume button's label (null: nothing to resume). */
export type HomeView<Tab extends string> = Readonly<{
  homeTab: Tab;
  playMode: string;
  submenuOpen: boolean;
  resumeLabel: string | null;
}>;

/** The page's tabs (the first is Play) and its play modes: a `${mode}ModeContent` panel each. */
export type HomeShellShape<Tab extends string> = Readonly<{
  tabs: ReadonlyArray<Tab>;
  modes: ReadonlyArray<string>;
}>;

/**
 * A value into every input that shows it (the saved names at `initHome`: the online name, the
 * pass-and-play seats, gin's Score Counter players). `setValue` leaves the input being typed in
 * alone, so the fill after a keystroke moves only the other inputs.
 */
export const fillInputs = (doc: DocumentLike, ids: ReadonlyArray<string>, value: string): void => {
  ids.forEach((id) => {
    setValue(requireId(doc, id), value);
  });
};

/** `#codeInput` after the reducer sanitised what was typed. */
export const setCodeInput = (doc: DocumentLike, value: string): void => {
  setValue(requireId(doc, 'codeInput'), value);
};

/**
 * The code input's `beforeinput` guard: keyboard suggestions arrive as replacement text or as a
 * multi-character insert, and are refused so the field keeps exactly what was typed.
 */
export const blocksCodeInput = (inputType: string, data: string | null): boolean =>
  inputType === 'insertReplacementText' ||
  (inputType === 'insertText' && data !== null && data.length > 1);

/** The tab buttons' `active` marks and their `${tab}Panel`s. */
export const paintTabs = <Tab extends string>(
  doc: DocumentLike,
  tabs: ReadonlyArray<Tab>,
  current: Tab,
): void => {
  tabs.forEach((t) => {
    toggleClass(requireId(doc, tabButtonId(t)), 'active', t === current);
    toggleClass(requireId(doc, `${t}Panel`), 'hidden', t !== current);
  });
};

/** `renderPlayMode()`: the mode panels and the `active` marks on both sets of mode buttons. */
export const paintPlayMode = (
  doc: DocumentLike,
  modes: ReadonlyArray<string>,
  current: string,
): void => {
  modes.forEach((mode) => {
    toggleClass(requireId(doc, `${mode}ModeContent`), 'hidden', current !== mode);
  });
  [
    ...queryAllIn(requireId(doc, 'playModeSwitch'), '.mode-btn'),
    ...queryAllIn(requireId(doc, 'playSubmenu'), 'button'),
  ].forEach((b) => {
    toggleClass(b, 'active', dataOf(b, 'mode') === current);
  });
};

/** The Play tab's submenu, held open (`force-open`) while a long press or a tap keeps it so. */
export const paintSubmenu = (doc: DocumentLike, open: boolean): void => {
  toggleClass(requireId(doc, 'playSubmenu'), 'force-open', open);
};

/** The resume box: hidden without a label; the button's text is the label. */
export const paintResume = (doc: DocumentLike, label: string | null): void => {
  toggleClass(requireId(doc, 'resumeBox'), 'hidden', label === null);
  if (label !== null) setText(requireId(doc, 'resumeBtn'), label);
};

/** The tabs and panels, the play mode (Play tab only, see the header), the submenu's `force-open`, and the resume box. */
export const paintHomeShell = <Tab extends string>(
  doc: DocumentLike,
  v: HomeView<Tab>,
  shape: HomeShellShape<Tab>,
): void => {
  paintTabs(doc, shape.tabs, v.homeTab);
  if (v.homeTab === 'play') paintPlayMode(doc, shape.modes, v.playMode);
  paintSubmenu(doc, v.submenuOpen);
  paintResume(doc, v.resumeLabel);
};

/**
 * The game's constructors for the shell's intents (§4.4: the binder never imports a game's
 * Intent). An intent with a payload is a builder over the raw values the controls carry; one
 * without is the intent itself. `Start` is what the host and local start buttons read beside the
 * names (gin: the target score; backgammon: the match length and the rules), via `startOptions`.
 */
export type ShellIntentBuilders<I, Tab extends string, Start> = Readonly<{
  nameTyped: (value: string) => I;
  p1NameTyped: (value: string) => I;
  p2NameTyped: (value: string) => I;
  hostClick: (name: string, options: Start) => I;
  joinClick: (name: string, code: string) => I;
  codeTyped: (value: string, inputType: string) => I;
  hostDeal: I;
  localClick: (p1: string, p2: string, options: Start) => I;
  tabSet: (tab: Tab) => I;
  modeSet: (mode: string) => I;
  submenuPress: I;
  submenuRelease: I;
  tabPlayClick: I;
  submenuPick: (mode: string) => I;
  submenuDismiss: I;
  resumeClick: I;
  shareClick: I;
  cancel: I;
}>;

/** What `bindHomeShell` needs from a game: its tabs, its start-option readers and its intents. */
export type HomeShellBindings<I, Tab extends string, Start> = Readonly<{
  tabs: ReadonlyArray<Tab>;
  /** Read at the click, one for each start button, from the inputs the game's page carries. */
  startOptions: Readonly<{
    host: (doc: DocumentLike) => Start;
    local: (doc: DocumentLike) => Start;
  }>;
  intents: ShellIntentBuilders<I, Tab, Start>;
}>;

/** A long press: `press` on pointerdown, `release` when the pointer lifts, leaves or is cancelled. */
export const bindLongPress = <I>(
  el: Element,
  dispatch: (intent: I) => void,
  intents: Readonly<{ press: I; release: I }>,
): void => {
  listen(el, 'pointerdown', () => {
    dispatch(intents.press);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => {
    listen(el, ev, () => {
      dispatch(intents.release);
    });
  });
};

/** Every shell control of the home screen and the two waiting screens, as the legacy registered them. */
export const bindHomeShell = <I, Tab extends string, Start>(
  doc: PageLike,
  dispatch: (intent: I) => void,
  cfg: HomeShellBindings<I, Tab, Start>,
): void => {
  const { intents } = cfg;
  const nameInput = requireId(doc, 'nameInput');
  listen(nameInput, 'input', () => {
    dispatch(intents.nameTyped(readValue(nameInput)));
  });
  const p1NameInput = requireId(doc, 'p1NameInput');
  listen(p1NameInput, 'input', () => {
    dispatch(intents.p1NameTyped(readValue(p1NameInput)));
  });
  const p2NameInput = requireId(doc, 'p2NameInput');
  listen(p2NameInput, 'input', () => {
    dispatch(intents.p2NameTyped(readValue(p2NameInput)));
  });
  listenId(doc, 'hostBtn', 'click', () => {
    dispatch(intents.hostClick(readValue(nameInput), cfg.startOptions.host(doc)));
  });
  const codeInput = requireId(doc, 'codeInput');
  const join = (): void => {
    dispatch(intents.joinClick(readValue(nameInput), readValue(codeInput)));
  };
  listenId(doc, 'joinBtn', 'click', join);
  listen(codeInput, 'beforeinput', (e) => {
    if (blocksCodeInput(inputTypeOf(e), inputDataOf(e))) preventDefault(e);
  });
  listen(codeInput, 'input', (e) => {
    dispatch(intents.codeTyped(targetValueOf(e), inputTypeOf(e)));
  });
  listen(codeInput, 'keydown', (e) => {
    if (keyOf(e) === 'Enter') join();
  });
  listenId(doc, 'startGameBtn', 'click', () => {
    dispatch(intents.hostDeal);
  });
  listenId(doc, 'localBtn', 'click', () => {
    dispatch(
      intents.localClick(
        readValue(p1NameInput),
        readValue(p2NameInput),
        cfg.startOptions.local(doc),
      ),
    );
  });
  // The other tabs select themselves; the Play tab below is a tap, a hover (desktop, CSS) or a
  // long press (touch) that opens its submenu.
  cfg.tabs
    .filter((t) => t !== 'play')
    .forEach((t) => {
      listenId(doc, tabButtonId(t), 'click', () => {
        dispatch(intents.tabSet(t));
      });
    });
  queryAllIn(requireId(doc, 'playModeSwitch'), '.mode-btn').forEach((b) => {
    listen(b, 'click', () => {
      dispatch(intents.modeSet(dataOf(b, 'mode') ?? ''));
    });
  });
  const tabPlayBtn = requireId(doc, 'tabPlayBtn');
  bindLongPress(tabPlayBtn, dispatch, {
    press: intents.submenuPress,
    release: intents.submenuRelease,
  });
  listen(tabPlayBtn, 'click', () => {
    dispatch(intents.tabPlayClick);
  });
  queryAllIn(requireId(doc, 'playSubmenu'), 'button[data-mode]').forEach((b) => {
    listen(b, 'click', (e) => {
      stopPropagation(e);
      dispatch(intents.submenuPick(dataOf(b, 'mode') ?? ''));
    });
  });
  const tabPlayWrap = requireId(doc, 'tabPlayWrap');
  listen(doc, 'click', (e) => {
    if (!isWithin(tabPlayWrap, e)) dispatch(intents.submenuDismiss);
  });
  listenId(doc, 'resumeBtn', 'click', () => {
    dispatch(intents.resumeClick);
  });
  listenId(doc, 'shareCodeBtn', 'click', () => {
    dispatch(intents.shareClick);
  });
  ['cancelHostBtn', 'cancelGuestBtn'].forEach((id) => {
    listenId(doc, id, 'click', () => {
      dispatch(intents.cancel);
    });
  });
};
