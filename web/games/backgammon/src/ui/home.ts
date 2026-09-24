// The home screen's DOM (design §4 "Home"; docs/ARCHITECTURE.md "Module boundaries": ui/ reaches
// the document only through the shared DOM edge). Gin's ui/home.ts minus the Score Counter and
// the sandbox, plus the two selects (match length, rules) each mode panel carries: `paintHome`
// reads the App (ui/state.ts) and `bindHome` turns each control into an intent. The three input
// writes that are not a paint (the saved names at `initHome`, the sanitised room code as it is
// typed) are effects the reducer raises and main.ts runs through `fillNameInputs` /
// `fillP2NameInput` / `setCodeInput`, so the paint never overwrites what the player is typing.
//
// One gin trait kept: the mode buttons' `active` marks are painted only while the Play tab is the
// current one and are otherwise left as they were.
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
  type PageLike,
} from '../../../../shared/edge/dom.ts';
import { HOME_TABS, resumeLabel, type App, type HomeTab, type Intent } from './state.ts';

/**
 * The first player's name into every input that shows it: the online name and pass-and-play's
 * first seat (one name, `backgammon_name`). `setValue` leaves the input being typed in alone, so
 * the fill after a keystroke moves only the other input.
 */
export const fillNameInputs = (doc: DocumentLike, name: string): void => {
  ['nameInput', 'p1NameInput'].forEach((id) => {
    setValue(requireId(doc, id), name);
  });
};

/** The second player's name into pass-and-play's second seat. */
export const fillP2NameInput = (doc: DocumentLike, name: string): void => {
  setValue(requireId(doc, 'p2NameInput'), name);
};

/** `#codeInput` after the reducer sanitised what was typed. */
export const setCodeInput = (doc: DocumentLike, value: string): void => {
  setValue(requireId(doc, 'codeInput'), value);
};

/**
 * The invite `#shareCodeBtn` shares: the page (`pageUrl` is its origin and path) with the code to
 * join, and nothing else. main.ts reads `?join=` at boot. The builder is every game's
 * (web/shared/lib/invite.ts) and keeps gin's name here for the painters and tests that use it.
 */
export { inviteUrl } from '../../../../shared/lib/invite.ts';

/** `tabPlayBtn`, `tabRulesBtn`, `tabAboutBtn`. */
export const tabButtonId = (tab: HomeTab): string =>
  `tab${tab.charAt(0).toUpperCase()}${tab.slice(1)}Btn`;

/**
 * The code input's `beforeinput` guard: keyboard suggestions arrive as replacement text or as a
 * multi-character insert, and are refused so the field keeps exactly what was typed.
 */
export const blocksCodeInput = (inputType: string, data: string | null): boolean =>
  inputType === 'insertReplacementText' ||
  (inputType === 'insertText' && data !== null && data.length > 1);

/** The two selects of each mode panel, the same option values (design §4: 1/3/5/7, portes/backgammon). */
const MATCH_LENGTH_SELECTS = ['matchLengthSel', 'localMatchLengthSel'] as const;
const VARIANT_SELECTS = ['variantSel', 'localVariantSel'] as const;

/** The options into both panels' selects (written only when they differ, so an open select is left alone). */
const paintOptions = (doc: DocumentLike, app: App): void => {
  MATCH_LENGTH_SELECTS.forEach((id) => {
    setValue(requireId(doc, id), String(app.shell.matchLength));
  });
  VARIANT_SELECTS.forEach((id) => {
    setValue(requireId(doc, id), app.shell.variant);
  });
};

/** `renderPlayMode()`: the two mode panels and the `active` marks on both sets of mode buttons. */
const paintPlayMode = (doc: DocumentLike, app: App): void => {
  toggleClass(requireId(doc, 'onlineModeContent'), 'hidden', app.shell.playMode !== 'online');
  toggleClass(requireId(doc, 'localModeContent'), 'hidden', app.shell.playMode !== 'local');
  [
    ...queryAllIn(requireId(doc, 'playModeSwitch'), '.mode-btn'),
    ...queryAllIn(requireId(doc, 'playSubmenu'), 'button'),
  ].forEach((b) => {
    toggleClass(b, 'active', dataOf(b, 'mode') === app.shell.playMode);
  });
};

/** The tabs and panels, the play mode, the selects, the submenu's `force-open`, and the resume box. */
export const paintHome = (doc: DocumentLike, app: App): void => {
  HOME_TABS.forEach((t) => {
    toggleClass(requireId(doc, tabButtonId(t)), 'active', t === app.shell.homeTab);
    toggleClass(requireId(doc, `${t}Panel`), 'hidden', t !== app.shell.homeTab);
  });
  if (app.shell.homeTab === 'play') paintPlayMode(doc, app);
  paintOptions(doc, app);
  toggleClass(requireId(doc, 'playSubmenu'), 'force-open', app.shell.submenuOpen);
  toggleClass(requireId(doc, 'resumeBox'), 'hidden', app.shell.resume === null);
  if (app.shell.resume !== null)
    setText(requireId(doc, 'resumeBtn'), resumeLabel(app.shell.resume));
};

/** Every control of the home screen and the two waiting screens. */
export const bindHome = (doc: PageLike, dispatch: (intent: Intent) => void): void => {
  const nameInput = requireId(doc, 'nameInput');
  listen(nameInput, 'input', () => {
    dispatch({ type: 'name/typed', value: readValue(nameInput) });
  });
  const p1NameInput = requireId(doc, 'p1NameInput');
  listen(p1NameInput, 'input', () => {
    dispatch({ type: 'p1name/typed', value: readValue(p1NameInput) });
  });
  const p2NameInput = requireId(doc, 'p2NameInput');
  listen(p2NameInput, 'input', () => {
    dispatch({ type: 'p2name/typed', value: readValue(p2NameInput) });
  });
  // The selects are remembered as they change; the start buttons pass the raw values along too,
  // so a select changed without a `change` event (a test's fake) still counts.
  MATCH_LENGTH_SELECTS.forEach((id) => {
    listenId(doc, id, 'change', (e) => {
      dispatch({ type: 'matchLength/set', length: targetValueOf(e) });
    });
  });
  VARIANT_SELECTS.forEach((id) => {
    listenId(doc, id, 'change', (e) => {
      dispatch({ type: 'variant/set', variant: targetValueOf(e) });
    });
  });
  listenId(doc, 'hostBtn', 'click', () => {
    dispatch({
      type: 'host/click',
      name: readValue(nameInput),
      matchLength: readValue(requireId(doc, 'matchLengthSel')),
      variant: readValue(requireId(doc, 'variantSel')),
    });
  });
  const codeInput = requireId(doc, 'codeInput');
  const join = (): void => {
    dispatch({ type: 'join/click', name: readValue(nameInput), code: readValue(codeInput) });
  };
  listenId(doc, 'joinBtn', 'click', join);
  listen(codeInput, 'beforeinput', (e) => {
    if (blocksCodeInput(inputTypeOf(e), inputDataOf(e))) preventDefault(e);
  });
  listen(codeInput, 'input', (e) => {
    dispatch({ type: 'code/typed', value: targetValueOf(e), inputType: inputTypeOf(e) });
  });
  listen(codeInput, 'keydown', (e) => {
    if (keyOf(e) === 'Enter') join();
  });
  listenId(doc, 'startGameBtn', 'click', () => {
    dispatch({ type: 'host/deal' });
  });
  listenId(doc, 'localBtn', 'click', () => {
    dispatch({
      type: 'local/click',
      p1: readValue(p1NameInput),
      p2: readValue(p2NameInput),
      matchLength: readValue(requireId(doc, 'localMatchLengthSel')),
      variant: readValue(requireId(doc, 'localVariantSel')),
    });
  });
  listenId(doc, 'tabRulesBtn', 'click', () => {
    dispatch({ type: 'tab/set', tab: 'rules' });
  });
  listenId(doc, 'tabAboutBtn', 'click', () => {
    dispatch({ type: 'tab/set', tab: 'about' });
  });
  queryAllIn(requireId(doc, 'playModeSwitch'), '.mode-btn').forEach((b) => {
    listen(b, 'click', () => {
      dispatch({ type: 'mode/set', mode: dataOf(b, 'mode') ?? '' });
    });
  });
  // The Play tab: tap, hover (desktop, CSS) and long press (touch) open its submenu.
  const tabPlayBtn = requireId(doc, 'tabPlayBtn');
  listen(tabPlayBtn, 'pointerdown', () => {
    dispatch({ type: 'submenu/press' });
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => {
    listen(tabPlayBtn, ev, () => {
      dispatch({ type: 'submenu/release' });
    });
  });
  listen(tabPlayBtn, 'click', () => {
    dispatch({ type: 'tab/playClick' });
  });
  queryAllIn(requireId(doc, 'playSubmenu'), 'button[data-mode]').forEach((b) => {
    listen(b, 'click', (e) => {
      stopPropagation(e);
      dispatch({ type: 'submenu/pick', mode: dataOf(b, 'mode') ?? '' });
    });
  });
  const tabPlayWrap = requireId(doc, 'tabPlayWrap');
  listen(doc, 'click', (e) => {
    if (!isWithin(tabPlayWrap, e)) dispatch({ type: 'submenu/dismiss' });
  });
  listenId(doc, 'resumeBtn', 'click', () => {
    dispatch({ type: 'resume/click' });
  });
  listenId(doc, 'shareCodeBtn', 'click', () => {
    dispatch({ type: 'share/click' });
  });
  ['cancelHostBtn', 'cancelGuestBtn'].forEach((id) => {
    listenId(doc, id, 'click', () => {
      dispatch({ type: 'cancel' });
    });
  });
};
