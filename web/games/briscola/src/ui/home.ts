// The home screen's DOM (docs/design/briscola.md §5.2 "Home residue", §5.8 `home`; docs/ARCHITECTURE.md
// "Module boundaries": ui/ reaches the document only through the shared DOM edge). `paintHome`
// reads the App (ui/state.ts) and `bindHome` turns each control into an intent. The shell every
// game's home screen shares (the tabs, the mode switch and its submenu, the code field, the resume
// box, the start, join, share and cancel buttons) is web/shared/ui/home.ts; this file composes it
// with what is briscola's alone: the room's terms in each mode panel (the seat count, the match,
// the house rules: a select or a switch each, the pass-and-play panel a twin of the Online one)
// and the third and fourth name inputs, shown by the seat count. The start buttons carry every raw
// value along (`Raw`, the keys the reducer's `parseOpts` reads), and a change on any control
// remembers it at once (`opts/set`), so a select changed without a `change` event (a test's fake)
// still counts. The three input writes that are not a paint (the saved names at `initHome`, the
// sanitised room code as it is typed) are effects the reducer raises and main.ts runs through
// `fillNameInputs` / `fillP2NameInput` / `setCodeInput`; the third and fourth names are painted from
// the table's memory (`extraNames`), which their own keystrokes keep current, so the paint never
// overwrites what is being typed.
import {
  dataOf,
  listen,
  listenId,
  readChecked,
  readValue,
  requireId,
  setAttr,
  setChecked,
  setValue,
  toggleClass,
  type DocumentLike,
  type PageLike,
} from '../../../../shared/edge/dom.ts';
import {
  DEFAULT_MARK,
  bindHomeShell,
  clearDefault,
  fillInputs,
  paintHomeShell,
  type HomeView,
  type ShellIntentBuilders,
} from '../../../../shared/ui/home.ts';
import { localNameFor } from '../../../../shared/ui/shell.ts';
import { LOCAL_NAMES } from '../shellConfig.ts';
import {
  HOME_TABS,
  resumeLabel,
  type App,
  type ExtraSeat,
  type HomeTab,
  type Intent,
  type PlayMode,
  type Raw,
} from './state.ts';

/**
 * The first player's name into every input that shows it: the online name and pass-and-play's
 * first seat (one name, `briscola_name`); `isDefault` marks the shell's prefill for the first-tap
 * clear (shared home.ts `fillInputs`).
 */
export const fillNameInputs = (doc: DocumentLike, name: string, isDefault = false): void => {
  fillInputs(doc, ['nameInput', 'p1NameInput'], name, isDefault);
};

/** The second player's name into pass-and-play's second seat. */
export const fillP2NameInput = (doc: DocumentLike, name: string, isDefault = false): void => {
  fillInputs(doc, ['p2NameInput'], name, isDefault);
};

/** The shell's helpers, kept under their gin names for main.ts and the tests. */
export { blocksCodeInput, setCodeInput, tabButtonId } from '../../../../shared/ui/home.ts';
export { inviteUrl } from '../../../../shared/lib/invite.ts';

/** The two mode panels the page carries (`${mode}ModeContent`): Online · Pass the phone. */
const PLAY_MODES: ReadonlyArray<PlayMode> = ['online', 'local'];

/** The room's six controls in each panel, the same option values (design §5.8). */
const ONLINE = {
  players: 'playersSel',
  match: 'matchSel',
  removedTwo: 'removedTwoSel',
  exchange: 'exchangeChk',
  scoperta: 'scopertaChk',
  partnerPeek: 'partnerPeekChk',
} as const;
const LOCAL = {
  players: 'localPlayersSel',
  match: 'localMatchSel',
  removedTwo: 'localRemovedTwoSel',
  exchange: 'localExchangeChk',
  scoperta: 'localScopertaChk',
  partnerPeek: 'localPartnerPeekChk',
} as const;
type Control = keyof typeof ONLINE;
const CONTROLS: ReadonlyArray<Control> = [
  'players',
  'match',
  'removedTwo',
  'exchange',
  'scoperta',
  'partnerPeek',
];
/** The third and fourth pass-and-play seats' inputs (`#moreNames` shows them from three players). */
export const EXTRA_NAME_INPUTS: Readonly<Record<ExtraSeat, string>> = {
  2: 'p3NameInput',
  3: 'p4NameInput',
};

/** A switch as `Raw` spells it: `on` or `off` (its `value` is `on` whether ticked or not). */
const flag = (doc: DocumentLike, id: string): string =>
  readChecked(requireId(doc, id)) ? 'on' : 'off';

/** The Online panel's raw values, the keys `host/click` carries (`Raw`). */
export const readHostOptions = (doc: DocumentLike): Raw => ({
  players: readValue(requireId(doc, ONLINE.players)),
  match: readValue(requireId(doc, ONLINE.match)),
  removedTwo: readValue(requireId(doc, ONLINE.removedTwo)),
  exchange: flag(doc, ONLINE.exchange),
  scoperta: flag(doc, ONLINE.scoperta),
  partnerPeek: flag(doc, ONLINE.partnerPeek),
});

/** The pass-and-play panel's six terms under their `local*` keys. */
export const readLocalRules = (doc: DocumentLike): Raw => ({
  localPlayers: readValue(requireId(doc, LOCAL.players)),
  localMatch: readValue(requireId(doc, LOCAL.match)),
  localRemovedTwo: readValue(requireId(doc, LOCAL.removedTwo)),
  localExchange: flag(doc, LOCAL.exchange),
  localScoperta: flag(doc, LOCAL.scoperta),
  localPartnerPeek: flag(doc, LOCAL.partnerPeek),
});

/** What `#localBtn` carries beside the first two names: the rules and the third and fourth names (the reducer seats the first `seatCount`). */
export const readLocalOptions = (doc: DocumentLike): Raw => ({
  ...readLocalRules(doc),
  p3: readValue(requireId(doc, EXTRA_NAME_INPUTS[2])),
  p4: readValue(requireId(doc, EXTRA_NAME_INPUTS[3])),
});

/**
 * The room's terms into both panels' controls (written only when they differ, so an open select is
 * left alone). The Online seat count stays as the page ships it: three and four are disabled there
 * until the N-seat lobby lands (D16), and the shell's count may be a pass-and-play choice.
 */
const paintOptions = (doc: DocumentLike, app: App): void => {
  const o = app.shell.opts;
  setValue(requireId(doc, LOCAL.players), String(o.seatCount));
  [ONLINE.match, LOCAL.match].forEach((id) => {
    setValue(requireId(doc, id), String(o.gamesToWin));
  });
  [ONLINE.removedTwo, LOCAL.removedTwo].forEach((id) => {
    setValue(requireId(doc, id), o.removedTwo);
  });
  (
    [
      ['exchange', o.exchange],
      ['scoperta', o.scoperta],
      ['partnerPeek', o.partnerPeek],
    ] as const
  ).forEach(([control, on]) => {
    setChecked(requireId(doc, ONLINE[control]), on);
    setChecked(requireId(doc, LOCAL[control]), on);
  });
  // The third and fourth seats' inputs show with the count, holding the names as last read or
  // typed, or the seat's default marked for the first-tap clear (shellConfig.ts LOCAL_NAMES: the
  // owner's Sandro and Grant), as the shared fill marks the first two seats.
  toggleClass(requireId(doc, 'moreNames'), 'hidden', o.seatCount < 3);
  toggleClass(requireId(doc, EXTRA_NAME_INPUTS[3]), 'hidden', o.seatCount < 4);
  ([2, 3] as const).forEach((seat) => {
    const input = requireId(doc, EXTRA_NAME_INPUTS[seat]);
    const name = app.table.extraNames[seat];
    setValue(input, name ?? localNameFor(LOCAL_NAMES, seat));
    setAttr(input, DEFAULT_MARK, name === null ? '1' : null);
  });
};

/** What the shared shell paints, read off the App's shell slice. */
const homeView = (app: App): HomeView<HomeTab> => ({
  homeTab: app.shell.homeTab,
  playMode: app.shell.playMode,
  submenuOpen: app.shell.submenuOpen,
  resumeLabel: app.shell.resume === null ? null : resumeLabel(app.shell.resume),
});

/** The tabs and panels, the play mode, the submenu's `force-open`, and the resume box; then the room's controls. */
export const paintHome = (doc: DocumentLike, app: App): void => {
  paintHomeShell(doc, homeView(app), { tabs: HOME_TABS, modes: PLAY_MODES });
  paintOptions(doc, app);
};

/** The shell's intents as briscola spells them (the shared binder never imports this file's Intent). */
const SHELL_INTENTS: ShellIntentBuilders<Intent, HomeTab, Raw> = {
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

/** Every control of a panel remembers the panel's terms as it changes; the third and fourth names are remembered as typed. */
const bindOptions = (doc: PageLike, dispatch: (intent: Intent) => void): void => {
  CONTROLS.forEach((control) => {
    listenId(doc, ONLINE[control], 'change', () => {
      dispatch({ type: 'opts/set', raw: readHostOptions(doc) });
    });
    listenId(doc, LOCAL[control], 'change', () => {
      dispatch({ type: 'opts/set', raw: readLocalRules(doc) });
    });
  });
  ([2, 3] as const).forEach((seat) => {
    const input = requireId(doc, EXTRA_NAME_INPUTS[seat]);
    listenId(doc, EXTRA_NAME_INPUTS[seat], 'input', () => {
      dispatch({ type: 'pname/typed', seat, value: readValue(input) });
    });
    // A prefilled default clears on its first tap (the owner, 2026-09-25), as the shared binder
    // clears the first two seats; these two are painted from the table's memory, so the reducer
    // is told the seat is now empty (its key is dropped) and the paint follows instead of refilling.
    ['focus', 'pointerdown'].forEach((type) => {
      listen(input, type, () => {
        if (dataOf(input, 'default') === null) return;
        clearDefault(input);
        dispatch({ type: 'pname/typed', seat, value: '' });
      });
    });
  });
};

/** Every control of the home screen and the two waiting screens. */
export const bindHome = (doc: PageLike, dispatch: (intent: Intent) => void): void => {
  bindHomeShell(doc, dispatch, {
    tabs: HOME_TABS,
    startOptions: { host: readHostOptions, local: readLocalOptions },
    intents: SHELL_INTENTS,
  });
  bindOptions(doc, dispatch);
};
