// The home screen's DOM (docs/MIGRATION.md step 12; docs/ARCHITECTURE.md "Module boundaries":
// ui/ reaches the document only through @shared/edge/dom). The legacy page (legacy/gin-rummy/
// index.html) wrote the home screen from `initHome`, `setHomeTab`, `renderPlayMode` and the
// handlers registered at DOMContentLoaded; here `paintHome` reads the App (ui/state.ts) and
// `bindHome` turns each control into an intent. The three input writes that are not a paint (the
// saved names at `initHome`, the sanitised room code as it is typed) are effects the reducer
// raises and main.ts runs through `fillNameInputs` / `fillP2NameInput` / `setCodeInput`, so the
// paint never overwrites what the player is typing.
//
// One legacy trait kept: `renderPlayMode` ran only when the Play tab was shown or the mode was
// set, so the mode buttons' `active` marks (the submenu's are visible on every tab) are painted
// only while the Play tab is the current one and are otherwise left as they were.
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
import {
  HOME_TABS,
  handoffLabel,
  resumeLabel,
  type App,
  type HomeTab,
  type Intent,
} from './state.ts';

/** `initHome`: the saved name into `#nameInput` and `#p1NameInput`. */
export const fillNameInputs = (doc: DocumentLike, name: string): void => {
  setValue(requireId(doc, 'nameInput'), name);
  setValue(requireId(doc, 'p1NameInput'), name);
};

/** `initHome`: the saved pass-and-play second name into `#p2NameInput`. */
export const fillP2NameInput = (doc: DocumentLike, name: string): void => {
  setValue(requireId(doc, 'p2NameInput'), name);
};

/** `#codeInput` after the reducer sanitised what was typed. */
export const setCodeInput = (doc: DocumentLike, value: string): void => {
  setValue(requireId(doc, 'codeInput'), value);
};

/** The invite `#shareCodeBtn` shares, beside the link. */
export const inviteText = (code: string): string => `Join my Gin Rummy game — room code ${code}.`;

/** The invite's link: the page (`pageUrl` is its URL without a query) with the code main.ts reads at boot. */
export const inviteUrl = (code: string, pageUrl: string): string => `${pageUrl}?join=${code}`;

/** `tabPlayBtn`, `tabRulesBtn`, `tabScoreBtn`. */
export const tabButtonId = (tab: HomeTab): string =>
  `tab${tab.charAt(0).toUpperCase()}${tab.slice(1)}Btn`;

/**
 * The code input's `beforeinput` guard: keyboard suggestions arrive as replacement text or as a
 * multi-character insert, and are refused so the field keeps exactly what was typed.
 */
export const blocksCodeInput = (inputType: string, data: string | null): boolean =>
  inputType === 'insertReplacementText' ||
  (inputType === 'insertText' && data !== null && data.length > 1);

/** `renderPlayMode()`: the two mode panels and the `active` marks on both sets of mode buttons. */
const paintPlayMode = (doc: DocumentLike, app: App): void => {
  toggleClass(requireId(doc, 'onlineModeContent'), 'hidden', app.playMode !== 'online');
  toggleClass(requireId(doc, 'localModeContent'), 'hidden', app.playMode !== 'local');
  [
    ...queryAllIn(requireId(doc, 'playModeSwitch'), '.mode-btn'),
    ...queryAllIn(requireId(doc, 'playSubmenu'), 'button'),
  ].forEach((b) => {
    toggleClass(b, 'active', dataOf(b, 'mode') === app.playMode);
  });
};

/** The tabs and panels, the play mode, the submenu's `force-open`, and the resume box. */
export const paintHome = (doc: DocumentLike, app: App): void => {
  HOME_TABS.forEach((t) => {
    toggleClass(requireId(doc, tabButtonId(t)), 'active', t === app.homeTab);
    toggleClass(requireId(doc, `${t}Panel`), 'hidden', t !== app.homeTab);
  });
  if (app.homeTab === 'play') paintPlayMode(doc, app);
  toggleClass(requireId(doc, 'playSubmenu'), 'force-open', app.submenuOpen);
  toggleClass(requireId(doc, 'resumeBox'), 'hidden', app.resume === null);
  if (app.resume !== null) setText(requireId(doc, 'resumeBtn'), resumeLabel(app.resume));
  // Only a pass-and-play game can go online: a room is already one, the scorer has no table.
  const handoffBtn = requireId(doc, 'handoffBtn');
  toggleClass(handoffBtn, 'hidden', app.resume?.kind !== 'local');
  if (app.resume?.kind === 'local') setText(handoffBtn, handoffLabel(app.resume.game));
};

/** Every control of the home screen and the two waiting screens, as the legacy registered them. */
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
  listenId(doc, 'hostBtn', 'click', () => {
    dispatch({
      type: 'host/click',
      name: readValue(nameInput),
      target: readValue(requireId(doc, 'targetInput')),
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
      target: readValue(requireId(doc, 'localTargetInput')),
    });
  });
  listenId(doc, 'tabRulesBtn', 'click', () => {
    dispatch({ type: 'tab/set', tab: 'rules' });
  });
  listenId(doc, 'tabScoreBtn', 'click', () => {
    dispatch({ type: 'tab/set', tab: 'score' });
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
  listenId(doc, 'handoffBtn', 'click', () => {
    dispatch({ type: 'handoff/click' });
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
