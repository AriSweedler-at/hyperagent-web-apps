// Where the gin page's DOM writes live (docs/ARCHITECTURE.md "Module boundaries": ui/ reaches the
// document only through @shared/edge/dom). Phase 1 of docs/MIGRATION.md step 12 paints what the
// reducer (ui/state.ts) models so far: the screen `showScreen` toggled, the two waiting statuses,
// the room code, the deal button, and the two rules slots filled from ui/rules.ts (the page's
// markup carries the `<ul class="rules-list">` twice, empty; the legacy carried the eleven items
// twice, the named "duplicated rules markup" defect). `paint` is idempotent and runs after every
// intent; the table, the home screen's inputs and the overlays follow in phase 2, so the DOM ids the
// e2e specs rely on (legacy/gin-rummy/index.html) keep their meaning.
import {
  requireId,
  setText,
  setHtml,
  toggleClass,
  trustedHtml,
  type DocumentLike,
  type Element,
} from '../../../../shared/edge/dom.ts';
import { RULES_ITEMS } from './rules.ts';
import { SCREENS, type App } from './state.ts';

/** The page as `paint` sees it: `getElementById` and the body (for `fixed-screen`). */
export type PageLike = DocumentLike & Readonly<{ body: Element }>;

/** The ids of the two `<ul class="rules-list">` slots: the home tab's and the in-game overlay's. */
export const RULES_SLOT_IDS = ['rulesList', 'rulesOverlayList'] as const;

/** The eleven `<li>`s, one per line as the legacy page had them between its tags. */
export const rulesItemsHtml = (): string =>
  RULES_ITEMS.map((item) => `<li>${item}</li>`).join('\n');

/** Fill both rules slots from ui/rules.ts (once, at boot). */
export const renderRules = (doc: DocumentLike): void => {
  const markup = trustedHtml(rulesItemsHtml());
  RULES_SLOT_IDS.forEach((id) => {
    setHtml(requireId(doc, id), markup);
  });
};

/** `showScreen(id)`: every screen but `id` gets `hidden`; the table locks the body to the viewport. */
export const paintScreen = (doc: PageLike, app: App): void => {
  SCREENS.forEach((id) => {
    toggleClass(requireId(doc, id), 'hidden', id !== app.screen);
  });
  toggleClass(doc.body, 'fixed-screen', app.screen === 'tableScreen');
};

/** `#roomCode`, `#hostWaitStatus` (+ its pulse), `#startGameBtn`, `#guestWaitStatus` (+ its pulse). */
export const paintWaiting = (doc: DocumentLike, app: App): void => {
  setText(requireId(doc, 'roomCode'), app.code ?? '----');
  const hostStatus = requireId(doc, 'hostWaitStatus');
  setText(hostStatus, app.hostStatus.text);
  toggleClass(hostStatus, 'pulse', app.hostStatus.pulse);
  toggleClass(requireId(doc, 'startGameBtn'), 'hidden', !app.startGameVisible);
  const guestStatus = requireId(doc, 'guestWaitStatus');
  setText(guestStatus, app.guestStatus.text);
  toggleClass(guestStatus, 'pulse', app.guestStatus.pulse);
};

/** `toast(msg)`'s DOM half: the text and the `show` class; main.ts keeps the hide timer. */
export const showToast = (doc: DocumentLike, message: string): void => {
  const el = requireId(doc, 'toast');
  setText(el, message);
  toggleClass(el, 'show', true);
};

export const hideToast = (doc: DocumentLike): void => {
  toggleClass(requireId(doc, 'toast'), 'show', false);
};

/** Everything phase 1 paints, from the App alone. */
export const paint = (doc: PageLike, app: App): void => {
  paintScreen(doc, app);
  paintWaiting(doc, app);
};
