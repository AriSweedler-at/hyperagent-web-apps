// The ids the shell's markup carries in every shell page (docs/design/shared-shell.md §4.1
// `ids.ts`; §5 B1): what the shared painters and binders (shellPaint.ts, curtain.ts, and the home
// binder B2 brings) reach by id, and what the shell reducer's screens and waiting rooms are. Both
// pages (web/games/gin-rummy/index.html, web/games/backgammon/index.html,
// web/games/briscola/index.html) carry every one of them, under these exact ids; test/dist/shell-ids.test.ts asserts it on the built pages, so a page that
// renames one fails the site suite before a painter fails at boot. Ids a game alone has (gin's
// scorer, backgammon's board, the menu sheet) are not here. Pure: a list, importable from node.
import type { Game } from '../lib/roomCode.ts';

/** The games whose page is the shell's markup today; fidice joins with its restyle (design §4.6). */
export const SHELL_GAMES: ReadonlyArray<Game> = ['gin-rummy', 'backgammon', 'briscola'];

export const SHELL_IDS: ReadonlyArray<string> = [
  // The page root and the screens (`SCREENS` in each game's ui/state.ts names these five).
  'app',
  'homeScreen',
  'hostWaitScreen',
  'guestWaitScreen',
  'tableScreen',
  'endgameScreen',
  // The home screen: the tab bar and its three panels, the play-mode switch and its submenu, the
  // online and pass-and-play fields, the resume box (ui/home.ts, B2).
  'topTabbar',
  'tabPlayWrap',
  'tabPlayBtn',
  'tabRulesBtn',
  'tabAboutBtn',
  'playPanel',
  'rulesPanel',
  'aboutPanel',
  'playModeSwitch',
  'playSubmenu',
  'onlineModeContent',
  'localModeContent',
  'nameInput',
  'codeInput',
  'hostBtn',
  'joinBtn',
  'p1NameInput',
  'p2NameInput',
  'localBtn',
  'resumeBox',
  'resumeBtn',
  'rulesList',
  'aboutCopy',
  // The waiting rooms (shellPaint.ts `paintWaiting`; the buttons ui/home.ts binds).
  'roomCode',
  'hostWaitStatus',
  'startGameBtn',
  'shareCodeBtn',
  'cancelHostBtn',
  'guestWaitStatus',
  'cancelGuestBtn',
  // The table's shell controls (shellPaint.ts `paintSound`, `paintHandoff`; ui/render.ts binds).
  'soundBtn',
  'handoffBtn',
  'leaveBtn',
  'rulesBtnGame',
  'historyBtn',
  // The sheets both games open from the table (shellPaint.ts `paintSheet`, `bindSheets`); the
  // history sheet's five are HISTORY_IDS below (web/shared/ui/history.ts paints its list,
  // web/shared/ui/recentGames.ts the finished games under it).
  'rulesOverlay',
  'rulesOverlayList',
  'closeRulesBtn',
  'historyOverlay',
  'historyList',
  'recentGames',
  'closeHistoryBtn',
  // The pass-and-play curtain (curtain.ts).
  'curtainOverlay',
  'curtainTitle',
  'curtainSub',
  'curtainLast',
  'curtainBtn',
  // The toast (shellPaint.ts `showToast`, toast.ts).
  'toast',
];

/**
 * The history sheet (docs/design/briscola-sound-history.md §6): the table button that opens it,
 * its overlay, the list web/shared/ui/history.ts paints, the finished games under it
 * (web/shared/ui/recentGames.ts, the owner's game history of 2026-09-25) and its close button,
 * every one in SHELL_IDS above (so every shell page carries them; briscola's will). Backgammon's
 * menu entry `menuHistoryBtn` is its menu sheet's, which gin has no twin of, so it is not the
 * shell's.
 */
export const HISTORY_IDS = {
  button: 'historyBtn',
  overlay: 'historyOverlay',
  list: 'historyList',
  recent: 'recentGames',
  close: 'closeHistoryBtn',
} as const;

/**
 * The tab buttons' ids from the tab names: `tabPlayBtn`, `tabRulesBtn`, `tabScoreBtn`, `tabAboutBtn`.
 * Here rather than in home.ts (which re-exports it) because the computed-style oracle
 * (tools/parity/computed-styles.ts `driveShell`, docs/design/dry-round-2.md I2) tours the tabs by
 * it from node, where home.ts's DOM edge is out of reach.
 */
export const tabButtonId = (tab: string): string =>
  `tab${tab.charAt(0).toUpperCase()}${tab.slice(1)}Btn`;
