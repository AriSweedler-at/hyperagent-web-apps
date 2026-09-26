// The home screen's DOM on the shell path (docs/design/fidice-shell-adoption.md §3 "Painters and
// binders", §7 D7, D9; docs/ARCHITECTURE.md "Module boundaries": ui/ reaches the document only
// through the shared DOM edge). `paintHome` reads the App (ui/state.ts) and `bindHome` turns each
// control into an intent. The shell every game's home screen shares (the tabs, the mode switch and
// its submenu, the code field, the resume box, the start, join, share and cancel buttons) is
// web/shared/ui/home.ts; this file composes it with what is fidice's alone: the host card's four
// selects and its strategy button (page.ts `hostFields`; their terms apply in every mode, D7, so
// both start buttons carry them), the four modes where the shell paints two (Solo and Watch show
// the pass-the-phone panel cut down to one name or none, D9), and the third to sixth name inputs
// with their add and remove buttons (`extraNames`: a seat is shown while the table remembers a
// name for it, the empty string included; add remembers an empty one, remove forgets it). A
// change on a select remembers it at once (`opts/set`). The three input writes that are not a
// paint (the saved names at `initHome`, the sanitised room code as it is typed) are effects the
// reducer raises and main.ts runs through `fillNameInputs` / `fillP2NameInput` / `setCodeInput`.
import {
  hasClass,
  listenId,
  readValue,
  requireId,
  setAttr,
  setValue,
  toggleClass,
  type DocumentLike,
  type PageLike,
} from '../../../../shared/edge/dom.ts';
import {
  bindHomeShell,
  fillInputs,
  paintHomeShell,
  shellIntents,
  type HomeView,
} from '../../../../shared/ui/home.ts';
import { ROOM_CODE } from '../../../../shared/lib/roomCode.ts';
import { difficultyOfChoice } from '../bots/registry.ts';
import type { State } from '../domain/types.ts';
import {
  HOME_TABS,
  type App,
  type ExtraSeat,
  type Fidice,
  type HomeTab,
  type Intent,
  type Mode,
  type Raw,
  type Resume,
} from './state.ts';

/**
 * The first player's name into every input that shows it: the online name and pass the phone's
 * first seat (one name, `fidice_name`); `isDefault` marks the shell's prefill for the first-tap
 * clear (shared home.ts `fillInputs`).
 */
export const fillNameInputs = (doc: DocumentLike, name: string, isDefault = false): void => {
  fillInputs(doc, ['nameInput', 'p1NameInput'], name, isDefault);
};

/** The second player's name into pass the phone's second seat. */
export const fillP2NameInput = (doc: DocumentLike, name: string, isDefault = false): void => {
  fillInputs(doc, ['p2NameInput'], name, isDefault);
};

/** The shell's helpers, kept under their gin names for main.ts and the tests. */
export { blocksCodeInput, setCodeInput, tabButtonId } from '../../../../shared/ui/home.ts';
export { inviteUrl } from '../../../../shared/lib/invite.ts';

/**
 * A fidice code is five characters (web/shared/lib/roomCode.ts), where the shell partial's code
 * input carries gin's `maxlength="4"` (web/shared/markup/shell/home.html); the paint writes the
 * length back so a guest can type the fifth.
 * M4 gap: the partial should carry the game's code length (a ShellCopy field or the registry's
 * row) once M5 registers fidice as a shell game; a shared edit is out of M4's scope.
 */
export const CODE_LENGTH = ROOM_CODE.fidice.length;

/** The two mode panels the page carries (`${mode}ModeContent`); Solo and Watch borrow the second (D9). */
const PANEL_MODES: ReadonlyArray<string> = ['online', 'local'];
/** The modes that start from the pass-the-phone panel, and how many human names each seats there. */
const LOCAL_NAMES_SHOWN: Readonly<Record<Mode, number | null>> = {
  online: null,
  local: 2,
  solo: 1,
  watch: 0,
};

/** The host card's four selects (page.ts `hostFields`): the room's terms, read by both start buttons. */
export const HOST_SELECTS = {
  lives: 'livesSel',
  seats: 'seatsSel',
  bots: 'botsSel',
  difficulty: 'difficulty',
} as const;
/** The third to sixth pass-the-phone seats' inputs. */
export const EXTRA_NAME_INPUTS: Readonly<Record<ExtraSeat, string>> = {
  2: 'p3NameInput',
  3: 'p4NameInput',
  4: 'p5NameInput',
  5: 'p6NameInput',
};
const EXTRA_SEATS: ReadonlyArray<ExtraSeat> = [2, 3, 4, 5];

/** The host card's raw values, the keys `host/click` carries (`Raw`). */
export const readHostOptions = (doc: DocumentLike): Raw => ({
  lives: readValue(requireId(doc, HOST_SELECTS.lives)),
  seats: readValue(requireId(doc, HOST_SELECTS.seats)),
  bots: readValue(requireId(doc, HOST_SELECTS.bots)),
  difficulty: readValue(requireId(doc, HOST_SELECTS.difficulty)),
});

/** A shown extra seat's input value under its `pN` key; a hidden seat carries nothing (the reducer seats what the click carries). */
const extraName = (doc: DocumentLike, seat: ExtraSeat): Partial<Raw> => {
  const input = requireId(doc, EXTRA_NAME_INPUTS[seat]);
  if (hasClass(input, 'hidden')) return {};
  const value = readValue(input);
  switch (seat) {
    case 2:
      return { p3: value };
    case 3:
      return { p4: value };
    case 4:
      return { p5: value };
    case 5:
      return { p6: value };
  }
};

/** What `#localBtn` carries beside the first two names: the host card's terms (they apply in every mode, D7) and the names of the extra seats shown. */
export const readLocalOptions = (doc: DocumentLike): Raw => ({
  ...readHostOptions(doc),
  ...extraName(doc, 2),
  ...extraName(doc, 3),
  ...extraName(doc, 4),
  ...extraName(doc, 5),
});

/** "Ann vs Bob"; "Ann, Bob and Cara" past two. */
export const seatNames = (names: ReadonlyArray<string>): string =>
  names.length <= 2
    ? names.join(' vs ')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;

/** `#handoffBtn`'s tooltip and a handed-off room's resume offer (two humans, plan §7 D8): seat 0 hosts, seat 1 joins by invite. */
export const handoffLabel = (game: State): string =>
  `Continue online: ${game.players[0]?.name ?? ''} hosts, ${game.players[1]?.name ?? ''} joins by invite`;

/** `#resumeBtn`'s label for a resume offer (the shell fixture's three forms at two seats). */
export const resumeLabel = (resume: Resume): string => {
  switch (resume.kind) {
    case 'local':
      return `Resume pass & play: ${seatNames(resume.game.players.map((p) => p.name))}`;
    case 'host':
      return resume.handoff && resume.game !== null
        ? handoffLabel(resume.game)
        : `Resume hosting room ${resume.code}`;
    case 'guest':
      return `Rejoin room ${resume.code}`;
  }
};

/** What the shared shell paints, read off the App's shell slice. */
const homeView = (app: App): HomeView<HomeTab> => ({
  homeTab: app.shell.homeTab,
  playMode: app.shell.playMode,
  submenuOpen: app.shell.submenuOpen,
  resumeLabel: app.shell.resume === null ? null : resumeLabel(app.shell.resume),
});

/**
 * The room's terms into the host card's selects (written only when they differ, so an open select
 * is left alone); the difficulty select follows the strategy when a difficulty means it, and is
 * left where it was for an exact choice from the strategy screen.
 */
const paintOptions = (doc: DocumentLike, app: App): void => {
  const o = app.shell.opts;
  setValue(requireId(doc, HOST_SELECTS.lives), String(o.lives));
  setValue(requireId(doc, HOST_SELECTS.seats), String(o.seatCount));
  setValue(requireId(doc, HOST_SELECTS.bots), String(o.bots));
  const difficulty = difficultyOfChoice(o.botChoice);
  if (difficulty !== null) setValue(requireId(doc, HOST_SELECTS.difficulty), difficulty);
};

/**
 * The pass-the-phone panel for the mode shown (D9): Pass the phone seats two names and the extra
 * seats the table remembers, with add and remove while a seat can be; Solo the first name alone;
 * Watch none (the host stands and the card's computers play). Painted only while the Play tab
 * shows, as the shell paints its mode panels (shared home.ts, the header's legacy trait).
 */
const paintLocalPanel = (doc: DocumentLike, app: App): void => {
  if (app.shell.homeTab !== 'play') return;
  const names = LOCAL_NAMES_SHOWN[app.shell.playMode];
  toggleClass(requireId(doc, 'localModeContent'), 'hidden', names === null);
  const shown = names ?? 0;
  toggleClass(requireId(doc, 'p1NameInput'), 'hidden', shown < 1);
  toggleClass(requireId(doc, 'p2NameInput'), 'hidden', shown < 2);
  const remembered = EXTRA_SEATS.filter((seat) => app.table.extraNames[seat] !== null);
  EXTRA_SEATS.forEach((seat) => {
    const input = requireId(doc, EXTRA_NAME_INPUTS[seat]);
    const name = app.table.extraNames[seat];
    const seated = shown === 2 && name !== null;
    toggleClass(input, 'hidden', !seated);
    if (name !== null) setValue(input, name);
  });
  toggleClass(
    requireId(doc, 'addLocalBtn'),
    'hidden',
    shown < 2 || remembered.length === EXTRA_SEATS.length,
  );
  toggleClass(requireId(doc, 'removeLocalBtn'), 'hidden', shown < 2 || remembered.length === 0);
};

/** The tabs and panels, the play mode, the submenu's `force-open` and the resume box; then the host card's terms and the pass-the-phone panel. */
export const paintHome = (doc: DocumentLike, app: App): void => {
  setAttr(requireId(doc, 'codeInput'), 'maxlength', String(CODE_LENGTH));
  paintHomeShell(doc, homeView(app), { tabs: HOME_TABS, modes: PANEL_MODES });
  paintOptions(doc, app);
  paintLocalPanel(doc, app);
};

/** The first extra seat not shown, for `#addLocalBtn`; the last shown, for `#removeLocalBtn`. */
const hiddenSeat = (doc: DocumentLike, hidden: boolean): ExtraSeat | undefined => {
  const seats = hidden ? EXTRA_SEATS : [...EXTRA_SEATS].reverse();
  return seats.find(
    (seat) => hasClass(requireId(doc, EXTRA_NAME_INPUTS[seat]), 'hidden') === hidden,
  );
};

/** The host card's selects are remembered as they change; the extra names as typed; add and remove seat and unseat; the strategy button opens its screen. */
const bindOptions = (doc: PageLike, dispatch: (intent: Intent) => void): void => {
  Object.values(HOST_SELECTS).forEach((id) => {
    listenId(doc, id, 'change', () => {
      dispatch({ type: 'opts/set', raw: readHostOptions(doc) });
    });
  });
  EXTRA_SEATS.forEach((seat) => {
    const input = requireId(doc, EXTRA_NAME_INPUTS[seat]);
    listenId(doc, EXTRA_NAME_INPUTS[seat], 'input', () => {
      dispatch({ type: 'pname/typed', seat, value: readValue(input) });
    });
  });
  listenId(doc, 'addLocalBtn', 'click', () => {
    const seat = hiddenSeat(doc, true);
    if (seat !== undefined) dispatch({ type: 'pname/typed', seat, value: '' });
  });
  listenId(doc, 'removeLocalBtn', 'click', () => {
    const seat = hiddenSeat(doc, false);
    if (seat !== undefined) dispatch({ type: 'pname/drop', seat });
  });
  listenId(doc, 'btnConfigSolo', 'click', () => {
    dispatch({ type: 'config/open', target: { kind: 'solo' } });
  });
};

/** Every control of the home screen and the two waiting screens' shell buttons. */
export const bindHome = (doc: PageLike, dispatch: (intent: Intent) => void): void => {
  bindHomeShell(doc, dispatch, {
    tabs: HOME_TABS,
    startOptions: { host: readHostOptions, local: readLocalOptions },
    intents: shellIntents<Fidice>(),
  });
  bindOptions(doc, dispatch);
};
