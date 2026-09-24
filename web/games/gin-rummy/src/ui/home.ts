// The home screen's DOM (docs/MIGRATION.md step 12; docs/ARCHITECTURE.md "Module boundaries":
// ui/ reaches the document only through @shared/edge/dom). The legacy page (legacy/gin-rummy/
// index.html) wrote the home screen from `initHome`, `setHomeTab`, `renderPlayMode` and the
// handlers registered at DOMContentLoaded; here `paintHome` reads the App (ui/state.ts) and
// `bindHome` turns each control into an intent. The shell every game's home screen shares (the
// tabs, the mode switch and its submenu, the code field, the resume box, the start, join, share
// and cancel buttons) is web/shared/ui/home.ts since docs/design/shared-shell.md §5 B2; this file
// composes it with what is gin's alone: the sandbox editor and the Score Counter's name inputs.
// The three input writes that are not a paint (the saved names at `initHome`, the sanitised room
// code as it is typed) are effects the reducer raises and main.ts runs through `fillNameInputs` /
// `fillP2NameInput` / `setCodeInput`, so the paint never overwrites what the player is typing.
import {
  escapeHtml,
  listen,
  listenId,
  queryAllIn,
  readValue,
  requireId,
  setHtml,
  setText,
  setValue,
  targetValueOf,
  toggleClass,
  trustedHtml,
  type DocumentLike,
  type PageLike,
} from '../../../../shared/edge/dom.ts';
import {
  bindHomeShell,
  fillInputs,
  paintHomeShell,
  type HomeView,
  type ShellIntentBuilders,
} from '../../../../shared/ui/home.ts';
import { PRESETS } from '../sandbox.ts';
import {
  HOME_TABS,
  resumeLabel,
  sandboxUnlocked,
  type App,
  type HomeTab,
  type Intent,
  type PlayMode,
} from './state.ts';

/**
 * The first player's name into every input that shows it: the online name, pass-and-play's first
 * seat and the Score Counter's first player (one name, `ginRummy_name`). `setValue` leaves the
 * input being typed in alone, so the fill after a keystroke moves only the other inputs.
 */
export const fillNameInputs = (doc: DocumentLike, name: string): void => {
  fillInputs(doc, ['nameInput', 'p1NameInput', 'scP1NameInput'], name);
};

/** The second player's name into pass-and-play's second seat and the Score Counter's second player. */
export const fillP2NameInput = (doc: DocumentLike, name: string): void => {
  fillInputs(doc, ['p2NameInput', 'scP2NameInput'], name);
};

/** The shell's helpers, kept under their gin names for main.ts and the tests. */
export { blocksCodeInput, setCodeInput, tabButtonId } from '../../../../shared/ui/home.ts';

/**
 * The invite `#shareCodeBtn` shares: the page (`pageUrl` is its origin and path) with the code to
 * join, and nothing else (the owner: the link is the invite; a line of text beside it and the
 * invited seat's name were noise). main.ts reads `?join=` at boot. The builder is every game's
 * (web/shared/lib/invite.ts) and keeps its gin name here for the painters and tests that use it.
 */
export { inviteUrl } from '../../../../shared/lib/invite.ts';

/** The three mode panels the page carries (`${mode}ModeContent`): the stored two and the sandbox. */
const PLAY_MODES: ReadonlyArray<PlayMode> = ['online', 'local', 'sandbox'];

/** `#sbPreset`'s options, once at boot: every preset by its title, then a random deal. */
export const renderSandbox = (doc: DocumentLike): void => {
  const options = PRESETS.map(
    (p) => `<option value="${p.id}">${escapeHtml(p.title)}</option>`,
  ).join('');
  setHtml(
    requireId(doc, 'sbPreset'),
    trustedHtml(`${options}<option value="random">🎲 A random deal</option>`),
  );
};

/**
 * The sandbox: its two mode buttons show while the first player is named `sandbox`; the editor
 * paints the map (written only when it differs, so typing is left alone) and its error.
 */
const paintSandbox = (doc: DocumentLike, app: App): void => {
  const unlocked = sandboxUnlocked(app);
  [
    ...queryAllIn(requireId(doc, 'playModeSwitch'), '.mode-btn[data-mode="sandbox"]'),
    ...queryAllIn(requireId(doc, 'playSubmenu'), 'button[data-mode="sandbox"]'),
  ].forEach((b) => {
    toggleClass(b, 'hidden', !unlocked);
  });
  setValue(requireId(doc, 'sbPreset'), app.table.sandbox.preset);
  setValue(requireId(doc, 'sbMap'), app.table.sandbox.map);
  setText(requireId(doc, 'sbError'), app.table.sandbox.error ?? '');
};

/** What the shared shell paints, read off the App. */
const homeView = (app: App): HomeView<HomeTab> => ({
  homeTab: app.shell.homeTab,
  playMode: app.shell.playMode,
  submenuOpen: app.shell.submenuOpen,
  resumeLabel: app.shell.resume === null ? null : resumeLabel(app.shell.resume),
});

/** The tabs and panels, the play mode, the submenu's `force-open`, and the resume box; then the sandbox. */
export const paintHome = (doc: DocumentLike, app: App): void => {
  paintHomeShell(doc, homeView(app), { tabs: HOME_TABS, modes: PLAY_MODES });
  paintSandbox(doc, app);
};

/** What the two start buttons read beside the names: the target score of their panel. */
type StartOptions = Readonly<{ target: string }>;

/** The shell's intents as gin spells them (the shared binder never imports this file's Intent). */
const SHELL_INTENTS: ShellIntentBuilders<Intent, HomeTab, StartOptions> = {
  nameTyped: (value) => ({ type: 'name/typed', value }),
  p1NameTyped: (value) => ({ type: 'p1name/typed', value }),
  p2NameTyped: (value) => ({ type: 'p2name/typed', value }),
  hostClick: (name, options) => ({ type: 'host/click', name, ...options }),
  joinClick: (name, code) => ({ type: 'join/click', name, code }),
  codeTyped: (value, inputType) => ({ type: 'code/typed', value, inputType }),
  hostDeal: { type: 'host/deal' },
  localClick: (p1, p2, options) => ({ type: 'local/click', p1, p2, ...options }),
  tabSet: (tab) => ({ type: 'tab/set', tab }),
  modeSet: (mode) => ({ type: 'mode/set', mode }),
  submenuPress: { type: 'submenu/press' },
  submenuRelease: { type: 'submenu/release' },
  tabPlayClick: { type: 'tab/playClick' },
  submenuPick: (mode) => ({ type: 'submenu/pick', mode }),
  submenuDismiss: { type: 'submenu/dismiss' },
  resumeClick: { type: 'resume/click' },
  shareClick: { type: 'share/click' },
  cancel: { type: 'cancel' },
};

/** The Score Counter's two players are the pass-and-play players: the same intents, the same keys. */
const bindScorerNames = (doc: PageLike, dispatch: (intent: Intent) => void): void => {
  const scP1NameInput = requireId(doc, 'scP1NameInput');
  listen(scP1NameInput, 'input', () => {
    dispatch({ type: 'p1name/typed', value: readValue(scP1NameInput) });
  });
  const scP2NameInput = requireId(doc, 'scP2NameInput');
  listen(scP2NameInput, 'input', () => {
    dispatch({ type: 'p2name/typed', value: readValue(scP2NameInput) });
  });
};

/** The sandbox's controls; the names come from the pass-and-play inputs, as its game does. */
const bindSandbox = (doc: PageLike, dispatch: (intent: Intent) => void): void => {
  const p1NameInput = requireId(doc, 'p1NameInput');
  const p2NameInput = requireId(doc, 'p2NameInput');
  const sbMap = requireId(doc, 'sbMap');
  listenId(doc, 'sbPreset', 'change', (e) => {
    const id = targetValueOf(e);
    dispatch(id === 'random' ? { type: 'sandbox/random' } : { type: 'sandbox/preset', id });
  });
  listen(sbMap, 'input', () => {
    dispatch({ type: 'sandbox/typed', value: readValue(sbMap) });
  });
  listenId(doc, 'sbRandomBtn', 'click', () => {
    dispatch({ type: 'sandbox/random' });
  });
  listenId(doc, 'sbCopyBtn', 'click', () => {
    dispatch({ type: 'sandbox/copy' });
  });
  listenId(doc, 'sbHelpBtn', 'click', () => {
    dispatch({ type: 'sandbox/help', open: true });
  });
  listenId(doc, 'sbStartBtn', 'click', () => {
    dispatch({
      type: 'sandbox/start',
      map: readValue(sbMap),
      p1: readValue(p1NameInput),
      p2: readValue(p2NameInput),
    });
  });
};

/** Every control of the home screen and the two waiting screens, as the legacy registered them. */
export const bindHome = (doc: PageLike, dispatch: (intent: Intent) => void): void => {
  bindHomeShell(doc, dispatch, {
    tabs: HOME_TABS,
    startOptions: {
      host: (d) => ({ target: readValue(requireId(d, 'targetInput')) }),
      local: (d) => ({ target: readValue(requireId(d, 'localTargetInput')) }),
    },
    intents: SHELL_INTENTS,
  });
  bindScorerNames(doc, dispatch);
  bindSandbox(doc, dispatch);
};
