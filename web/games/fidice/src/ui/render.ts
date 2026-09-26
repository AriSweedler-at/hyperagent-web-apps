// Where the fidice page's DOM writes live on the shell path (docs/design/fidice-shell-adoption.md
// §3 "Painters and binders", §4 M4; docs/ARCHITECTURE.md "Module boundaries": ui/ reaches the
// document only through the shared DOM edge). `paint(doc, app)` is idempotent and runs after every
// intent: the screen switch, the waiting rooms (ui/waiting.ts), the home screen (ui/home.ts), the
// curtain (ui/local.ts), the handoff button, the connection dot, the sheets, then the table. The
// table is the legacy vdom's, byte for byte (§4 M4: `mount(doc, #fidiceTable,
// gameScreen|spectatorScreen(uiOf(app)))`, `#ladderList` `ladderTab`, `#ladderSheet` `ladderView`,
// `#configScreen` `configScreen`): `uiOf` spells the App as the view/types.ts `Ui` the four
// builders read, and `intentOf` turns the intents they dispatch (view/types.ts) into the reducer's
// (ui/state.ts), so src/view/** is imported and never edited. M7 replaces the four mounts with
// painters over the DOM edge and deletes `uiOf`, `intentOf` and the vdom.
//
// The vdom needs the document's constructors (view/vdom.ts `create`) and the dispatch the boot
// built, which the paint's signature carries neither of: `bindAll` keeps the dispatch beside the
// document (`DISPATCHES`), and a document without constructors (a page fake) paints everything but
// the mounts. `bindAll` turns the table's shell controls and the sheets into intents; the input
// wiring of the home screen, the waiting room and the curtain is beside their paints.
import {
  clear,
  requireId,
  setAttr,
  setHtml,
  setText,
  trustedHtml,
  type DocumentLike,
  type PageLike,
} from '../../../../shared/edge/dom.ts';
import { paintRecentGames } from '../../../../shared/ui/recentGames.ts';
import {
  bindButtons,
  bindSheets as bindShellSheets,
  connDotView,
  paintConnDot,
  paintHandoff as paintShellHandoff,
  paintScreen as paintShellScreen,
  paintSheet,
  paintSound as paintShellSound,
  type Sheet,
} from '../../../../shared/ui/shellPaint.ts';
import type { PublicState, Seat as EngineSeat } from '../domain/types.ts';
import { configScreen } from '../view/screens/botConfig.ts';
import { catKey, ladderTab, ladderView, mainMarks } from '../view/screens/ladder.ts';
import { spectatorScreen } from '../view/screens/spectator.ts';
import { gameScreen } from '../view/screens/table.ts';
import type {
  ConfigTarget as OldConfigTarget,
  Dispatch as OldDispatch,
  Intent as OldIntent,
  Ladder as OldLadder,
  Ui,
} from '../view/types.ts';
import { mount } from '../view/vdom.ts';
import { aboutHtml } from './about.ts';
import { bindHome, handoffLabel, paintHome } from './home.ts';
import { bindLocal, paintCurtain } from './local.ts';
import { RULES_SLOT_IDS, rulesItemsHtml } from './rules.ts';
import {
  SCREENS,
  handoffable,
  viewedChair,
  type App,
  type ConfigTarget,
  type Intent,
  type Ladder,
} from './state.ts';
import { bindWaiting, paintWaiting as paintRoom } from './waiting.ts';

export type { PageLike };
export type Dispatch = (intent: Intent) => void;

export { RULES_SLOT_IDS } from './rules.ts';

/** Fill both rules slots from ui/rules.ts (once, at boot), the jargon in each body linked to its rule. */
export const renderRules = (doc: DocumentLike): void => {
  const markup = trustedHtml(rulesItemsHtml());
  RULES_SLOT_IDS.forEach((id) => {
    setHtml(requireId(doc, id), markup);
  });
};

/** Fill `#aboutCopy` from ui/about.ts (once, at boot), its jargon linked to the rules. */
export const renderAbout = (doc: DocumentLike): void => {
  setHtml(requireId(doc, 'aboutCopy'), trustedHtml(aboutHtml()));
};

// ---- the shell (web/shared/ui/shellPaint.ts, each over the App's shell slice) ---------------------

export { hideToast, showToast } from '../../../../shared/ui/shellPaint.ts';

/** `showScreen(id)`: every screen but `id` gets `hidden`; the table locks the body to the viewport. */
export const paintScreen = (doc: PageLike, app: App): void => {
  paintShellScreen(doc, SCREENS, app.shell.screen, 'tableScreen');
};

/** `#roomCode`, the two statuses, `#startGameBtn`, the seat lists with the computers under the humans, the watch box (ui/waiting.ts). */
export const paintWaiting = (doc: DocumentLike, app: App): void => {
  paintRoom(doc, {
    ...app.shell,
    bots: app.shell.opts.bots,
    botNames: app.table.botNames,
    botChoice: app.shell.opts.botChoice,
    watch: app.shell.opts.watch,
    host: app.shell.role === 'host',
  });
};

/** `fx.renderToggle()`: `#soundBtn`'s glyph, tooltip and pressed state (it is a toggle). */
export const paintSound = (doc: DocumentLike, enabled: boolean): void => {
  paintShellSound(doc, enabled);
  setAttr(requireId(doc, 'soundBtn'), 'aria-pressed', enabled ? 'true' : 'false');
};

/** `#handoffBtn` (the 🌐 on the table): a pass-the-phone game of two humans can go on as a hosted room (plan §7 D8); the tooltip names who hosts and who joins. */
export const paintHandoff = (doc: DocumentLike, app: App): void => {
  const game = app.shell.role === 'local' ? app.shell.game : null;
  paintShellHandoff(doc, game !== null && handoffable(app) ? handoffLabel(game) : null);
};

/**
 * The table's names strip (page.ts `table`; M5): `#myName` the chair this page plays (the cup
 * holder's under pass the phone, `viewedChair`; "Watching" for a page with no chair), `#oppName`
 * the other seats in chair order, so the two-seat shell specs read the opponent's name there as
 * on every shell table. Empty off the table.
 */
export const paintNames = (doc: DocumentLike, app: App): void => {
  const v = app.shell.view;
  const chair = viewedChair(app);
  const names = v === null ? [] : v.players.map((p) => p.name);
  const mine = chair === null ? (v === null ? '' : 'Watching') : (names[chair] ?? '');
  setText(requireId(doc, 'myName'), mine);
  setText(requireId(doc, 'oppName'), names.filter((_, i) => i !== chair).join(' · '));
};

/** The rules and history sheets (the shell's), the finished games under the history, the ladder sheet's flag (its ladder is a mount, `paintTable`). */
const paintOverlays = (doc: DocumentLike, app: App): void => {
  paintSheet(doc, 'rulesOverlay', app.shell.rulesOpen);
  paintSheet(doc, 'historyOverlay', app.table.historyOpen);
  if (app.table.historyOpen) paintRecentGames(doc, app.shell.recentGames);
  paintSheet(doc, 'ladderOverlay', app.table.ladderOpen);
};

// ---- the table: the legacy vdom builders over the App (§4 M4; M7 deletes this section) -------------

/** A ladder's open and closed rows as the builders read them (sets), from the reducer's lists. */
const ladderOf = (l: Ladder): OldLadder => ({
  open: new Set(l.open),
  closed: new Set(l.closed),
  allOpen: l.allOpen,
});

/**
 * The App as the four vdom builders read it (view/types.ts `Ui`): the view and the chair it is
 * painted for (ui/state.ts `viewedChair`: pass the phone shows the cup holder's), the role the
 * builders gate on (`isHostUi`: the device that runs the engine, so pass the phone's host controls
 * show; a guest is a player), the table's interaction memory, and the room's terms as the strategy
 * screen's form. What the shell owns is inert here: no legacy screen, tab, toast, error or handoff
 * (the shell curtain, D8), no share base (the shell's invite), and one strategy for every computer
 * (D7), so a config target is always the card's. `now` is the clock the reveal's countdown reads.
 */
export const uiOf = (app: App, now: number): Ui => {
  const s = app.shell;
  const t = app.table;
  const chair = viewedChair(app);
  return {
    screen: chair === null ? 'spec' : 'game',
    tab: 'play',
    role: s.role === null ? null : s.role === 'guest' ? 'player' : 'host',
    mySeat: chair,
    game: s.view,
    pending: null,
    nameForm: { name: s.myName, lives: s.opts.lives, botChoice: s.opts.botChoice, locals: [] },
    configTarget: t.configTarget === null ? null : { kind: 'solo' },
    joinCode: '',
    localTable: s.role === 'local',
    handoff: null,
    shownSeat: null,
    busy: null,
    error: null,
    toast: null,
    ladders: { main: ladderOf(t.ladders.main), spec: ladderOf(t.ladders.spec) },
    picker: t.picker,
    rollSelection: new Set(t.rollSelection),
    rollCup: t.rollCup,
    rollHidden: t.rollHidden,
    showTruth: t.showTruth,
    shareBase: '',
    now,
  };
};

/** The index among the computers of the chair a legacy seat target names (`bot<i>`), 0 for a chair no computer holds. */
const botIndexOf = (view: PublicState | null, chair: EngineSeat): number => {
  const m = /^bot(\d+)$/.exec(view?.players.at(chair)?.id ?? '');
  return m === null ? 0 : Number(m[1]);
};

const targetOf = (app: App, target: OldConfigTarget): ConfigTarget =>
  target.kind === 'solo'
    ? { kind: 'solo' }
    : { kind: 'bot', index: botIndexOf(app.shell.view, target.seat) };

/**
 * The reducer's intent for one the legacy builders dispatch (view/types.ts `Intent`), against the
 * App they were painted from: a play is an `act`; the roll ticks, the bid picker and the ladder
 * rows keep their names; the picker's focus reopens its list on the query it holds; `place` bids
 * the picked rank; expand-all flips the ladder; a category jump opens it (a toggle when closed);
 * "See on ladder" opens the ladder sheet over the table (D12); the truth switch toggles when it
 * would change; the strategy screen's target is the card's (D7); the legacy lobby's start and bot
 * controls are the waiting room's (never reached on this path: the table is dealt before it
 * shows); leave asks the shell; a legacy handoff tap is the curtain's one tap (D8). Null for the
 * menu and name-form intents the shell owns.
 */
export const intentOf = (app: App, old: OldIntent): Intent | null => {
  const t = app.table;
  switch (old.type) {
    case 'play':
      return { type: 'act', action: old.action };
    case 'roll.toggleDie':
      return { type: 'roll/toggleDie', die: old.die };
    case 'roll.cup':
      return { type: 'roll/cup', on: old.on };
    case 'roll.hidden':
      return { type: 'roll/hidden', on: old.on };
    case 'roll.go':
      return { type: 'roll/go' };
    case 'picker.query':
      return { type: 'picker/query', value: old.value };
    case 'picker.focus':
      return { type: 'picker/query', value: t.picker.query };
    case 'picker.move':
      return { type: 'picker/move', delta: old.delta };
    case 'picker.choose':
      return { type: 'picker/choose', rank: old.rank };
    case 'picker.close':
      return { type: 'picker/close' };
    case 'picker.enter':
      return { type: 'picker/enter' };
    case 'picker.place':
      return { type: 'bid/place' };
    case 'ladder.toggle':
      return { type: 'ladder/toggle', id: old.ladder, key: old.key };
    case 'ladder.expandAll':
      return { type: 'ladder/all', id: old.ladder, open: !t.ladders[old.ladder].allOpen };
    case 'ladder.jump': {
      const key = catKey(old.cat);
      return t.ladders.main.allOpen || t.ladders.main.open.includes(key)
        ? null
        : { type: 'ladder/toggle', id: 'main', key };
    }
    case 'ladder.showBid':
      return { type: 'ladder/open' };
    case 'spec.truth':
      return old.on === t.showTruth ? null : { type: 'truth/toggle' };
    case 'config.open':
      return { type: 'config/open', target: targetOf(app, old.target) };
    case 'config.close':
      return { type: 'config/close' };
    case 'config.pick':
      return { type: 'config/pick', choice: old.choice };
    case 'lobby.start':
      return { type: 'host/deal' };
    case 'lobby.addBot':
      return { type: 'bots/add' };
    case 'lobby.removeBot':
      return { type: 'bots/remove', index: botIndexOf(app.shell.view, old.seat) };
    case 'lobby.renameBot':
      return { type: 'bots/rename', index: botIndexOf(app.shell.view, old.seat), name: old.name };
    case 'lobby.setBot':
      return { type: 'bots/config', choice: old.choice };
    case 'lobby.watch':
      return { type: 'watch/toggle', on: old.watching };
    case 'leave':
      return { type: 'leave/request' };
    case 'handoff.tap':
    case 'handoff.confirm':
      return { type: 'curtain/reveal' };
    case 'nav':
    case 'menu.create':
    case 'menu.solo':
    case 'menu.local':
    case 'menu.watchBots':
    case 'menu.join':
    case 'form.name':
    case 'form.lives':
    case 'form.difficulty':
    case 'form.code':
    case 'form.local.set':
    case 'form.local.add':
    case 'form.local.remove':
    case 'form.submit':
    case 'form.back':
    case 'copy':
      return null;
  }
};

/** The document the vdom mounts through (view/vdom.ts `mount`): the page's, which has the constructors; a page fake has not, and mounts nothing. */
type MountDoc = Parameters<typeof mount>[0];
const mountDocOf = (doc: DocumentLike): MountDoc | null =>
  'createElement' in doc && 'createTextNode' in doc ? (doc as unknown as MountDoc) : null;

/** The dispatch `bindAll` was handed, beside its document, for the builders' handlers. */
const DISPATCHES = new WeakMap<DocumentLike, Dispatch>();

/** The four mount roots (page.ts): the table, the Ladder tab's list, the ladder sheet's list, the strategy screen. */
export const MOUNT_IDS = {
  table: 'fidiceTable',
  ladder: 'ladderList',
  sheet: 'ladderSheet',
  config: 'configScreen',
} as const;

/**
 * The legacy builders mounted where the App shows them, each root cleared otherwise: the table
 * (the game screen for a chair, the spectator screen for a watching host or an unseated guest)
 * while the table screen shows a view; the Ladder tab's ladder while the home screen shows that
 * tab; the ladder sheet's while it is open over the table; the strategy screen while it has a
 * target. One ladder is in the DOM at a time, so its ids (`mainLadder`, the rows') stay unique.
 */
export const paintTable = (doc: DocumentLike, app: App, now: number): void => {
  const real = mountDocOf(doc);
  const dispatch = DISPATCHES.get(doc);
  const roots = {
    table: requireId(doc, MOUNT_IDS.table),
    ladder: requireId(doc, MOUNT_IDS.ladder),
    sheet: requireId(doc, MOUNT_IDS.sheet),
    config: requireId(doc, MOUNT_IDS.config),
  };
  if (real === null || dispatch === undefined) return;
  const ui = uiOf(app, now);
  const d: OldDispatch = (old) => {
    const intent = intentOf(app, old);
    if (intent !== null) dispatch(intent);
  };
  const s = app.shell;
  const v = s.view;
  const onTable = s.screen === 'tableScreen' && v !== null;
  if (onTable)
    mount(real, roots.table, ui.mySeat === null ? spectatorScreen(ui, v, d) : gameScreen(ui, v, d));
  else clear(roots.table);
  if (s.screen === 'homeScreen' && s.homeTab === 'ladder')
    mount(real, roots.ladder, ladderTab(ui, d));
  else clear(roots.ladder);
  if (onTable && app.table.ladderOpen)
    mount(real, roots.sheet, ladderView('main', ui.ladders.main, mainMarks(ui), d));
  else clear(roots.sheet);
  if (app.table.configTarget !== null)
    mount(real, roots.config, configScreen(ui, { kind: 'solo' }, d));
  else clear(roots.config);
};

/** Every write from the App, in the order the sections above describe; the clock is read once per paint for the reveal's countdown (M7 paints it live). */
export const paint = (doc: PageLike, app: App): void => {
  paintScreen(doc, app);
  paintWaiting(doc, app);
  paintHome(doc, app);
  paintCurtain(doc, app);
  paintHandoff(doc, app);
  paintNames(doc, app);
  paintConnDot(doc, 'connDot', connDotView(app.shell));
  paintOverlays(doc, app);
  paintTable(doc, app, Date.now());
};

// ---- input wiring -----------------------------------------------------------------------------------

/** A sheet is an overlay a flag shows; the same flag's intent answers its close button and a tap on its backdrop. */
const SHEETS: ReadonlyArray<Sheet<Intent>> = [
  { overlay: 'rulesOverlay', close: 'closeRulesBtn', intent: { type: 'rules/close' } },
  { overlay: 'historyOverlay', close: 'closeHistoryBtn', intent: { type: 'history/close' } },
  { overlay: 'ladderOverlay', close: 'closeLadderBtn', intent: { type: 'ladder/close' } },
];

/** The table's shell controls (page.ts `table`): leave, sound, the handoff, the rules, the history and the ladder sheets. */
export const bindTable = (doc: PageLike, dispatch: Dispatch): void => {
  bindButtons(doc, dispatch, [
    ['leaveBtn', { type: 'leave/request' }],
    ['soundBtn', { type: 'sound/toggle' }],
    ['handoffBtn', { type: 'handoff/click' }],
    ['rulesBtnGame', { type: 'rules/open' }],
    ['historyBtn', { type: 'history/open' }],
    ['ladderBtn', { type: 'ladder/open' }],
  ]);
};

/** Every control of the page (home, waiting rooms, curtain, table, sheets), once, at boot; the builders' handlers reach `dispatch` through `paintTable`. */
export const bindAll = (doc: PageLike, dispatch: Dispatch): void => {
  DISPATCHES.set(doc, dispatch);
  bindHome(doc, dispatch);
  bindWaiting(doc, dispatch);
  bindLocal(doc, dispatch);
  bindTable(doc, dispatch);
  bindShellSheets(doc, SHEETS, dispatch);
};
