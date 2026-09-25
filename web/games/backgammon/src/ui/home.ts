// The home screen's DOM (design §4 "Home"; docs/ARCHITECTURE.md "Module boundaries": ui/ reaches
// the document only through the shared DOM edge). `paintHome` reads the App (ui/state.ts) and
// `bindHome` turns each control into an intent. The shell every game's home screen shares (the
// tabs, the mode switch and its submenu, the code field, the resume box, the start, join, share
// and cancel buttons) is web/shared/ui/home.ts since docs/design/shared-shell.md §5 B2; this file
// composes it with what is Sheshbesh's alone: the two selects (match length, rules) each mode
// panel carries. The three input writes that are not a paint (the saved names at `initHome`, the
// sanitised room code as it is typed) are effects the reducer raises and main.ts runs through
// `fillNameInputs` / `fillP2NameInput` / `setCodeInput`, so the paint never overwrites what the
// player is typing.
import {
  listenId,
  readValue,
  requireId,
  setValue,
  targetValueOf,
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
import {
  HOME_TABS,
  resumeLabel,
  type App,
  type HomeTab,
  type Intent,
  type PlayMode,
} from './state.ts';

/**
 * The first player's name into every input that shows it: the online name and pass-and-play's
 * first seat (one name, `backgammon_name`). `setValue` leaves the input being typed in alone, so
 * the fill after a keystroke moves only the other input.
 */
export const fillNameInputs = (doc: DocumentLike, name: string): void => {
  fillInputs(doc, ['nameInput', 'p1NameInput'], name);
};

/** The second player's name into pass-and-play's second seat. */
export const fillP2NameInput = (doc: DocumentLike, name: string): void => {
  fillInputs(doc, ['p2NameInput'], name);
};

/** The shell's helpers, kept under their gin names for main.ts and the tests. */
export { blocksCodeInput, setCodeInput, tabButtonId } from '../../../../shared/ui/home.ts';

/**
 * The invite `#shareCodeBtn` shares: the page (`pageUrl` is its origin and path) with the code to
 * join, and nothing else. main.ts reads `?join=` at boot. The builder is every game's
 * (web/shared/lib/invite.ts) and keeps gin's name here for the painters and tests that use it.
 */
export { inviteUrl } from '../../../../shared/lib/invite.ts';

/** The two mode panels the page carries (`${mode}ModeContent`), design §2.4: Online · Pass the phone. */
const PLAY_MODES: ReadonlyArray<PlayMode> = ['online', 'local'];

/** The two selects of each mode panel, the same option values (design §4: 1/3/5/7, portes/backgammon). */
const MATCH_LENGTH_SELECTS = ['matchLengthSel', 'localMatchLengthSel'] as const;
const VARIANT_SELECTS = ['variantSel', 'localVariantSel'] as const;

/** The options into both panels' selects (written only when they differ, so an open select is left alone). */
const paintOptions = (doc: DocumentLike, app: App): void => {
  MATCH_LENGTH_SELECTS.forEach((id) => {
    setValue(requireId(doc, id), String(app.shell.opts.matchLength));
  });
  VARIANT_SELECTS.forEach((id) => {
    setValue(requireId(doc, id), app.shell.opts.variant);
  });
};

/** What the shared shell paints, read off the App's shell slice. */
const homeView = (app: App): HomeView<HomeTab> => ({
  homeTab: app.shell.homeTab,
  playMode: app.shell.playMode,
  submenuOpen: app.shell.submenuOpen,
  resumeLabel: app.shell.resume === null ? null : resumeLabel(app.shell.resume),
});

/** The tabs and panels, the play mode, the submenu's `force-open`, and the resume box; then the selects. */
export const paintHome = (doc: DocumentLike, app: App): void => {
  paintHomeShell(doc, homeView(app), { tabs: HOME_TABS, modes: PLAY_MODES });
  paintOptions(doc, app);
};

/** What the two start buttons read beside the names: their panel's match length and rules. */
type StartOptions = Readonly<{ matchLength: string; variant: string }>;

/** The shell's intents as Sheshbesh spells them (the shared binder never imports this file's Intent). */
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

/**
 * The selects are remembered as they change; the start buttons pass the raw values along too
 * (`startOptions` below), so a select changed without a `change` event (a test's fake) still counts.
 */
const bindOptions = (doc: PageLike, dispatch: (intent: Intent) => void): void => {
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
};

/** Every control of the home screen and the two waiting screens. */
export const bindHome = (doc: PageLike, dispatch: (intent: Intent) => void): void => {
  bindHomeShell(doc, dispatch, {
    tabs: HOME_TABS,
    startOptions: {
      host: (d) => ({
        matchLength: readValue(requireId(d, 'matchLengthSel')),
        variant: readValue(requireId(d, 'variantSel')),
      }),
      local: (d) => ({
        matchLength: readValue(requireId(d, 'localMatchLengthSel')),
        variant: readValue(requireId(d, 'localVariantSel')),
      }),
    },
    intents: SHELL_INTENTS,
  });
  bindOptions(doc, dispatch);
};
