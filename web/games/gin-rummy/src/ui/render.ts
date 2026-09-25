// Where the gin page's DOM writes for the game screens live (docs/ARCHITECTURE.md "Module
// boundaries": ui/ reaches the document only through @shared/edge/dom; `HandView.render` is the
// only way a hand is drawn; the table's geometry is theme.css's alone). `paint(doc, app, handView)` is
// idempotent and runs after every intent: it composes the screen switch and the waiting statuses
// (phase 1), the home screen (ui/home.ts), the curtain (ui/local.ts), the table, the endgame and
// the overlays, each written from the App (ui/state.ts) alone, so the same App always paints the
// same DOM. Every id, class, text and tooltip is the legacy `render()`'s
// (legacy/gin-rummy/index.html), and the DOM-snapshot oracle (tools/parity/gin-dom-parity.ts) plays
// both pages through the same sequence and compares them; the one region that diverges by design
// is `#tableScreen` since the ghost draw slot (docs/design/gin-draw-ghost-slot.md: slots, the
// undo button in the actions row, one pile size, shorter button labels), which the oracle no
// longer snapshots.
//
// Where the legacy wrote a region only on some path, this paints it only under the same condition,
// so stale content stays stale on both: the table is written only while a view exists and the hand
// is not over; the round-result sheet only at `roundOver`, and it is left as it is at `gameOver`
// (the legacy `render()` returned before hiding it, so the sheet stays over the endgame screen
// until "Look at the table"); the endgame screen only at `gameOver`; the meld chooser and the
// history list only while open. `bindTable` turns the table's and the overlays' controls into
// intents; the input wiring of the home screen and the curtain is beside their paints.
import {
  closestFrom,
  dataOf,
  isDisabled,
  listenId,
  queryIn,
  requireId,
  safeHtml,
  queryAllIn,
  setAttr,
  setChecked,
  setDisabled,
  setHtml,
  setText,
  toggleClass,
  trustedHtml,
  type DocumentLike,
  type PageLike,
  type SafeHtml,
} from '../../../../shared/edge/dom.ts';
import {
  GIN_BONUS,
  UNDERCUT_BONUS,
  type LayoffMelding,
  type Melding,
  type View,
} from '../engine/types.ts';
import { SUITS, idsOf, inPlay, makeCard, type Rank } from '../engine/index.ts';
import { SUIT_SYMBOL, backHtml, cardHtml, isRed, pretty, rankLabel } from './cards.ts';
import { deadwoodText, fmtDuration, statusWith, type Selection } from './cues.ts';
import type { HandView } from './hand/HandView.ts';
import { meldGroupClass, meldGroupsHtml } from './hand/meldGroups.ts';
import { arrangedOf } from './hand/arrange.ts';
import { bindDrag } from './hand/dragger.ts';
import { flipCards } from './hand/flip.ts';
import { phoneRows, samePicture } from './hand/picture.ts';
import { SORT_MODES, type SortMode } from '../sort.ts';
import {
  bindButtons,
  bindLongPress,
  bindSheets as bindShellSheets,
  connDotClass as shellConnDotClass,
  connDotView,
  paintConnDot,
  paintHandoff as paintShellHandoff,
  paintScreen as paintShellScreen,
  paintSheet,
  paintWaiting as paintShellWaiting,
  type Sheet,
} from '../../../../shared/ui/shellPaint.ts';
import { ensureKeyed } from '../../../../shared/ui/keyed.ts';
import { paintRecentGames } from '../../../../shared/ui/recentGames.ts';
import { bindHome, paintHome } from './home.ts';
import { bindLocal, paintCurtain } from './local.ts';
import { aboutHtml } from './about.ts';
import { RULES_SLOT_IDS, rulesItemsHtml } from './rules.ts';
import { canDropDiscard, handoffLabel, SCREENS, type App, type Intent } from './state.ts';

export type { PageLike };
export type Dispatch = (intent: Intent) => void;

export { RULES_SLOT_IDS, rulesItemsHtml } from './rules.ts';
// The shell painters both games share (docs/design/shared-shell.md §4.4, moved in B1) under the
// names main.ts, stories/boot.ts and the tests always imported them by.
export { hideToast, paintSound, showToast } from '../../../../shared/ui/shellPaint.ts';

/** Fill both rules slots from ui/rules.ts (once, at boot). */
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

// ---- the shell (web/shared/ui/shellPaint.ts, each over the App's slice it reads) ------------------

// A sheet is an overlay a flag shows; the same flag's close intent answers its button and a tap
// on its backdrop (the overlay element itself, never its children). The list is this game's.
const SHEETS: ReadonlyArray<Sheet<Intent>> = [
  { overlay: 'rulesOverlay', close: 'closeRulesBtn', intent: { type: 'rules/close' } },
  { overlay: 'historyOverlay', close: 'closeHistoryBtn', intent: { type: 'history/close' } },
  { overlay: 'meldOverlay', close: 'closeMeldBtn', intent: { type: 'meld/close' } },
  { overlay: 'arrangeOverlay', close: 'closeArrangeBtn', intent: { type: 'arrange/close' } },
  { overlay: 'discardsOverlay', close: 'closeDiscardsBtn', intent: { type: 'discards/close' } },
  {
    overlay: 'sandboxHelpOverlay',
    close: 'closeSandboxHelpBtn',
    intent: { type: 'sandbox/help', open: false },
  },
];

const bindSheets = (doc: PageLike, dispatch: Dispatch): void => {
  bindShellSheets(doc, SHEETS, dispatch);
};

/** `showScreen(id)`: every screen but `id` gets `hidden`; the table locks the body to the viewport. */
export const paintScreen = (doc: PageLike, app: App): void => {
  paintShellScreen(doc, SCREENS, app.shell.screen, 'tableScreen');
  // The card back: theme.css draws every `.card.back` from `body[data-card-back]` (src/cardBack.ts).
  setAttr(doc.body, 'data-card-back', app.table.cardBack);
};

/** `#roomCode`, `#hostWaitStatus` (+ its pulse), `#startGameBtn`, `#guestWaitStatus` (+ its pulse). */
export const paintWaiting = (doc: DocumentLike, app: App): void => {
  paintShellWaiting(doc, app.shell);
};

/**
 * `#handoffBtn` (the 🌐 beside the leave button): a pass-and-play game can go on as a hosted room,
 * the other seat joining from its own device (ui/state.ts `handoff`); the tooltip names who hosts
 * and who joins. A room is online already and the scorer has no table, so it shows for
 * pass-and-play alone.
 */
export const paintHandoff = (doc: DocumentLike, app: App): void => {
  const game = app.shell.role === 'local' ? app.shell.game : null;
  paintShellHandoff(doc, game === null ? null : handoffLabel(game));
};

// ---- the table -----------------------------------------------------------------------------------

/** The opponent's strip: at most eleven card backs and the count. */
export const oppCardsHtml = (cardCount: number): string =>
  Array.from({ length: Math.min(cardCount, 11) }, () => backHtml('tiny')).join('') +
  `<span class="opp-count">${String(cardCount)}</span>`;

/** `#connDot`'s whole class attribute; pass-and-play hides it (the shell's, dry-round-2.md E6, over the App's shell slice). */
export const connDotClass = (app: App): string => shellConnDotClass(connDotView(app.shell));

const paintOpponent = (doc: DocumentLike, app: App, v: View): void => {
  setText(requireId(doc, 'oppName'), v.opp.name);
  setText(requireId(doc, 'oppScore'), `${String(v.opp.total)} pts`);
  setHtml(requireId(doc, 'oppCards'), trustedHtml(oppCardsHtml(v.opp.cardCount)));
  paintConnDot(doc, 'connDot', connDotView(app.shell));
  setText(requireId(doc, 'roundBadge'), `Hand ${String(v.handNumber)}`);
  setText(requireId(doc, 'targetBadge'), `to ${String(v.target)}`);
};

/**
 * Rebuild a pile only when the card it shows changes (the shared keyed slot, `data-key`; it was
 * `data-pile-key` before docs/design/dry-round-2.md D1), so the element survives re-renders and
 * its CSS size transition can animate; the label is refreshed every time.
 */
const ensurePile = (
  el: ReturnType<typeof requireId>,
  cardMarkup: string,
  label: string,
  key: string,
): void => {
  ensureKeyed(el, key, () => `${cardMarkup}<div class="pile-label"></div>`);
  const lab = queryIn(el, '.pile-label');
  if (lab !== null) setText(lab, label);
};

// ---- the discarded cards --------------------------------------------------------------------------

const RANKS: ReadonlyArray<Rank> = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

/**
 * The 52 cards in four suit rows (docs/design/gin-arrangement-and-discards.md §8): a chip per card,
 * `seen` when it was discarded this hand, `top` for the top of the pile (what a draw would take),
 * `held` when `withHand` and it is in my hand. Empty when the view carries no `discardIds` (a
 * legacy host).
 */
export const discardsHtml = (v: View, withHand: boolean): SafeHtml => {
  const seen = new Set(v.discardIds ?? []);
  const held = new Set(withHand ? idsOf(v.me.hand) : []);
  const top = v.discardTop?.id ?? null;
  const chip = (id: string, label: string): string =>
    `<span class="dc${seen.has(id) ? ' seen' : ''}${held.has(id) ? ' held' : ''}${id === top ? ' top' : ''}" data-card="${id}">${label}</span>`;
  const rows = SUITS.map(
    (s) =>
      `<div class="dc-row ${isRed(s) ? 'red' : 'black'}"><span class="dc-suit">${SUIT_SYMBOL[s]}</span>${RANKS.map((r) => chip(makeCard(r, s).id, rankLabel(r))).join('')}</div>`,
  );
  return trustedHtml(rows.join(''));
};

/** `#discardsSub`: how many of the 52 are gone, and how many of mine are greyed with them. */
export const discardsSubText = (v: View, withHand: boolean): string =>
  `${String((v.discardIds ?? []).length)} of 52 discarded` +
  (withHand ? ` · ${String(v.me.hand.length)} in your hand` : '');

const paintDiscards = (doc: DocumentLike, app: App, v: View): void => {
  // Without `discardIds` (a legacy host's frames) the sheet has nothing to show.
  setDisabled(requireId(doc, 'discardsBtn'), v.discardIds === undefined);
  paintSheet(doc, 'discardsOverlay', app.table.discardsOpen);
  if (!app.table.discardsOpen) return;
  setHtml(requireId(doc, 'discardsGrid'), discardsHtml(v, app.table.discardsWithHand));
  setText(requireId(doc, 'discardsSub'), discardsSubText(v, app.table.discardsWithHand));
  setChecked(requireId(doc, 'discardsHandToggle'), app.table.discardsWithHand);
};

const paintPiles = (doc: DocumentLike, v: View): void => {
  const stock = requireId(doc, 'stockPile');
  const disc = requireId(doc, 'discardPile');
  ensurePile(stock, backHtml('big'), `Stock · ${String(v.stockCount)}`, 'back');
  ensurePile(
    disc,
    v.discardTop === null
      ? '<div class="card big empty"></div>'
      : cardHtml(v.discardTop, { big: true }),
    'Discard',
    v.discardTop?.id ?? 'empty',
  );
  // One pile size in every phase: nothing above the hand changes size on a draw.
  const canDrawStock = v.isMyTurn && v.phase === 'draw';
  const canDrawDiscard = canDrawStock && !v.forceStock && v.discardTop !== null;
  const canTakeUpcard = v.isMyTurn && v.phase === 'upcard';
  toggleClass(stock, 'tappable', canDrawStock);
  toggleClass(disc, 'tappable', canDrawDiscard || canTakeUpcard);
  toggleClass(disc, 'blocked', canDrawStock && v.forceStock);
};

/**
 * The knocker's melds on the table while the defender lays off (docs/design/gin-arrangement-and-
 * discards.md §7b): the piles keep their boxes, unseen, and `#tableMelds` lays over them, one
 * `.meld-group.locked` per meld (built once per knock, so the groups drop in once), each rebuilt
 * only when its cards changed (so a card laid off drops onto it and the others hold still). The
 * knocker's cards are `pinned`, the laid-off ones `laid` (the one being dragged `dragging`), and
 * the group a dragged card fits carries `drop` while the card is over it.
 */
const paintTableMelds = (doc: DocumentLike, app: App, v: View): void => {
  const lo = v.layoff;
  const laying = v.phase === 'layoff' && lo !== undefined;
  const melds = requireId(doc, 'tableMelds');
  toggleClass(requireId(doc, 'tableCenter'), 'laying', laying);
  toggleClass(melds, 'hidden', !laying);
  if (!laying) {
    setAttr(melds, 'data-key', null);
    return;
  }
  const shell = `${String(v.handNumber)}:${String(lo.knocker)}:${String(lo.melds.length)}`;
  ensureKeyed(melds, shell, () =>
    lo.melds
      .map((_, i) => `<div class="${meldGroupClass(i)} locked" data-onto="${String(i)}"></div>`)
      .join(''),
  );
  const laid = new Set(lo.laidOff.map((e) => e.card.id));
  const dragging = app.table.drag?.from === 'table' ? app.table.drag.cardId : null;
  queryAllIn(melds, '.meld-group').forEach((group, i) => {
    const cards = lo.extended[i] ?? [];
    const key = `${idsOf(cards).join(' ')}:${dragging ?? ''}`;
    ensureKeyed(group, key, () =>
      cards
        .map((c) =>
          cardHtml(c, {
            mini: true,
            extra: laid.has(c.id) ? (c.id === dragging ? 'laid dragging' : 'laid') : 'pinned',
          }),
        )
        .join(''),
    );
    toggleClass(group, 'drop', app.table.drag?.onto === i);
  });
};

const paintStatus = (doc: DocumentLike, app: App, v: View): void => {
  const status = statusWith(v, app.table.selectedCard, app.table.draw);
  setText(requireId(doc, 'statusMain'), status.main);
  setText(requireId(doc, 'statusSub'), status.sub);
  toggleClass(requireId(doc, 'statusBanner'), 'mine', v.isMyTurn && v.phase !== 'roundOver');
  setText(requireId(doc, 'lastAction'), v.lastAction?.text ?? '');
};

/** The deadwood readout, doubling as the meld-arrangement control when the hand melds two ways. */
export const deadwoodHtml = (v: View, selection: Selection): SafeHtml => {
  const altCount = v.meldOptions.length;
  const badge =
    altCount > 1
      ? trustedHtml(`<span class="alt-badge">⇄ ${String(altCount)} ways</span>`)
      : trustedHtml('');
  return safeHtml`${deadwoodText(v, selection)}${badge}`;
};

/**
 * The action buttons under the hand, by phase. While discarding, the undo button leads the row
 * whenever the draw can still be taken back, and the labels are the short ones (`Discard`,
 * `Knock` / `GIN!`) so three buttons never wrap in the fixed 54px row on a phone
 * (docs/design/gin-draw-ghost-slot.md §4: an owner-visible copy change).
 */
export const actionsHtml = (v: View, selection: Selection): SafeHtml => {
  if (v.phase === 'upcard' && v.isMyTurn) {
    const take = v.discardTop === null ? 'upcard' : pretty(v.discardTop);
    return trustedHtml(
      `<button class="btn btn-secondary grow" data-act="passUpcard">Pass</button><button class="btn btn-primary grow" data-act="takeUpcard">Take ${take}</button>`,
    );
  }
  if (v.phase === 'discard' && v.isMyTurn) {
    const sel = selection === null ? undefined : v.discardOptions?.[selection];
    const scored = sel !== undefined && !('locked' in sel) ? sel : null;
    const canKnock = scored?.canKnock === true;
    const knockLabel = scored?.isGin === true ? 'GIN!' : 'Knock';
    const count = scored === null ? '' : ` <small>(${String(scored.deadwood)})</small>`;
    const undo = v.canUndo
      ? '<button class="btn btn-ghost" data-act="undoDraw" title="Undo draw">↩</button>'
      : '';
    return trustedHtml(
      `${undo}<button class="btn btn-secondary grow" data-act="discard" ${scored === null ? 'disabled' : ''}>Discard</button><button class="btn btn-gold grow" data-act="knock" ${canKnock ? '' : 'disabled'}>${knockLabel}${count}</button>`,
    );
  }
  if (v.phase === 'roundOver')
    return trustedHtml(
      `<button class="btn btn-primary grow" data-act="showResult">Show results</button>`,
    );
  // The answer to a knock (§7b): the defender finishes when their layoffs are laid.
  if (v.phase === 'layoff')
    return v.isMyTurn
      ? trustedHtml(
          `<button class="btn btn-primary grow" data-act="finishLayoff">Done laying off</button>`,
        )
      : safeHtml`<div class="waiting-note">Waiting for ${v.opp.name} to lay off…</div>`;
  const waiting = v.isMyTurn ? trustedHtml('') : safeHtml`Waiting for ${v.opp.name}…`;
  return safeHtml`<div class="waiting-note">${waiting}</div>`;
};

const paintHand = (doc: DocumentLike, app: App, v: View, handView: HandView): void => {
  setText(requireId(doc, 'myName'), `${v.me.name} · ${String(v.me.total)} pts`);
  const altCount = v.meldOptions.length;
  const dw = requireId(doc, 'deadwoodInfo');
  setHtml(dw, deadwoodHtml(v, app.table.selectedCard));
  toggleClass(dw, 'tappable-dw', altCount > 1);
  setAttr(dw, 'title', altCount > 1 ? 'Tap to choose which melds you declare' : '');
  const hand = requireId(doc, 'hand');
  const arranged = arrangedOf(
    v,
    app.table.draw,
    app.table.human,
    app.table.sort,
    app.table.picture,
  );
  const picture = app.table.picture ?? arranged;
  // The cards glide to their new cells (flip.ts) rather than snap; the dragged card's cell is emptied.
  flipCards(hand, () => {
    setHtml(
      hand,
      trustedHtml(
        handView.render(
          v,
          app.table.selectedCard,
          app.table.draw,
          picture,
          app.table.drag?.cardId ?? null,
        ),
      ),
    );
  });
  toggleClass(hand, 'active', v.isMyTurn && v.phase === 'discard');
  // The phone's row count (docs/design/gin-arrangement-and-discards.md §6): theme.css lets the page
  // scroll for a third row where the viewport is too short for one.
  setAttr(hand, 'data-rows', String(phoneRows(picture)));
  // Arrange opens its sheet in play, never while the drawn card waits in the ghost cell; `due`
  // is the cue that the kept picture differs from the arrangement the player asked for.
  const arrange = requireId(doc, 'arrangeBtn');
  const arrangeable = inPlay(v.phase) && app.table.draw === null;
  setDisabled(arrange, !arrangeable);
  toggleClass(arrange, 'due', arrangeable && !samePicture(picture, arranged));
  setHtml(requireId(doc, 'actions'), actionsHtml(v, app.table.selectedCard));
  paintDropTargets(doc, app, v);
};

/**
 * While a hand card that may be discarded is dragged (§5d), the discard pile and the Discard button
 * say they take it: `drop-ready` lights them (the pile amber, the button's text wiggling), `drop`
 * turns the one under the pointer green, where a release discards the card (dragger.ts).
 */
const paintDropTargets = (doc: DocumentLike, app: App, v: View): void => {
  const d = app.table.drag;
  const ready = d !== null && d.from === 'hand' && canDropDiscard(app, v, d.cardId);
  const over = ready && d.onto === 'discard';
  const pile = requireId(doc, 'discardPile');
  toggleClass(pile, 'drop-ready', ready);
  toggleClass(pile, 'drop', over);
  const button = queryIn(requireId(doc, 'actions'), 'button[data-act="discard"]');
  if (button === null) return;
  toggleClass(button, 'drop-ready', ready);
  toggleClass(button, 'drop', over);
};

const paintArrange = (doc: DocumentLike, app: App): void => {
  paintSheet(doc, 'arrangeOverlay', app.table.arrangeOpen);
  queryAllIn(requireId(doc, 'arrangeModes'), 'button[data-sort]').forEach((b) => {
    toggleClass(b, 'active', dataOf(b, 'sort') === app.table.sort);
  });
};

// ---- the round result --------------------------------------------------------------------------

const miniCards = (cards: ReadonlyArray<Parameters<typeof cardHtml>[0]>): string =>
  cards.map((c) => cardHtml(c, { mini: true })).join('');

/** One side of the result sheet: melds, lay-offs (the opponent's), deadwood, points. */
const resultPanel = (
  name: string,
  knockerName: string,
  side: Melding | LayoffMelding,
  pts: number,
  isKnocker: boolean,
): SafeHtml => {
  const laid =
    'laidOff' in side && side.laidOff.length > 0
      ? safeHtml`<div class="rr-label">Laid off onto ${knockerName}'s melds</div><div class="meld-group laid">${trustedHtml(miniCards(side.laidOff.map((x) => x.card)))}</div>`
      : trustedHtml('');
  const dead =
    side.deadwood.length > 0
      ? trustedHtml(
          `<div class="rr-label">Deadwood · ${String(side.value)}</div><div class="meld-group dead">${miniCards(side.deadwood)}</div>`,
        )
      : trustedHtml(`<div class="rr-label">No deadwood</div>`);
  const melds =
    side.melds.length > 0
      ? trustedHtml(
          `<div class="rr-label">Melds</div><div class="rr-melds">${meldGroupsHtml(side.melds, '', true)}</div>`,
        )
      : trustedHtml('');
  const knocked = trustedHtml(isKnocker ? ' <small>(knocked)</small>' : '');
  const points = pts > 0 ? `+${String(pts)}` : '0';
  return safeHtml`<div class="rr-panel ${pts > 0 ? 'scored' : ''}"><div class="rr-head"><span>${name}${knocked}</span><span class="rr-pts">${points}</span></div>${melds}${laid}${dead}</div>`;
};

export type RoundResultText = Readonly<{ title: string; sub: string; body: SafeHtml }>;

/** What `renderRoundResult` wrote for a hand's result, or null when the view carries none. */
export const roundResultText = (v: View): RoundResultText | null => {
  const r = v.result;
  if (r === null) return null;
  const idx = v.rounds.length - 1;
  const prevTs = idx > 0 ? (v.rounds[idx - 1]?.ts ?? v.startedAt) : v.startedAt;
  const roundDur = fmtDuration((v.rounds[idx]?.ts ?? r.ts) - prevTs);
  if (r.void) {
    return {
      title: 'Hand void',
      sub: `Only two cards were left in the stock. No points — same dealer redeals. · ⏱ ${roundDur}`,
      body: trustedHtml(''),
    };
  }
  const k = r.knockerIdx;
  const o = k === 0 ? 1 : 0;
  const kn = v.players[k].name;
  const on = v.players[o].name;
  const title =
    r.outcome === 'gin'
      ? `${kn} went Gin!`
      : r.outcome === 'undercut'
        ? `${on} undercut ${kn}!`
        : `${kn} knocked`;
  const sub =
    r.outcome === 'gin'
      ? `+${String(GIN_BONUS)} bonus + ${on}'s ${String(r.opponent.value)} deadwood`
      : r.outcome === 'undercut'
        ? `${on} had ${String(r.opponent.value)} deadwood vs ${kn}'s ${String(r.knocker.value)} → difference + ${String(UNDERCUT_BONUS)} bonus`
        : `${kn} ${String(r.knocker.value)} deadwood vs ${on} ${String(r.opponent.value)}`;
  const totals = v.players.map((p) => safeHtml`<span>${p.name} <strong>${p.total}</strong></span>`);
  return {
    title,
    sub: `${sub} · ⏱ ${roundDur}`,
    body: safeHtml`${resultPanel(kn, kn, r.knocker, r.scores[k], true)}${resultPanel(on, kn, r.opponent, r.scores[o], false)}<div class="rr-totals">${totals}</div>`,
  };
};

/** `#rrContinueBtn`'s label: waiting once I am ready, else the next hand or the final result. */
export const continueLabel = (v: View): string =>
  v.ready[v.me.idx]
    ? `Waiting for ${v.opp.name}…`
    : v.players.some((p) => p.total >= v.target)
      ? 'See final result'
      : 'Next hand';

const paintRoundResult = (doc: DocumentLike, app: App, v: View): void => {
  const overlay = requireId(doc, 'roundResultOverlay');
  if (v.phase !== 'roundOver') {
    // The legacy hid it on every other phase but gameOver, where render() had already returned:
    // there only rrHideBtn wrote the class, so a Rematch (resultDismissed back to false) never
    // brings a put-away sheet back over the endgame.
    if (v.phase !== 'gameOver') toggleClass(overlay, 'hidden', true);
    else if (app.table.resultDismissed) toggleClass(overlay, 'hidden', true);
    return;
  }
  const text = roundResultText(v);
  if (text === null) return;
  setText(requireId(doc, 'rrTitle'), text.title);
  setText(requireId(doc, 'rrSub'), text.sub);
  // The body is built once per result: its melds lay themselves out when they first appear
  // (theme.css `layOut`), and a repaint (a toast, a tap, a frame) must not replay that. The key
  // sits in `data-key` (the shared keyed slot; `data-result-key` before dry-round-2.md D1), which
  // the DOM-snapshot oracle strips before comparing the sheet with the legacy page's.
  const body = requireId(doc, 'rrBody');
  const key = `${String(v.handNumber)}:${String(v.result?.ts ?? 0)}:${String(v.me.idx)}`;
  ensureKeyed(body, key, () => text.body.markup);
  const btn = requireId(doc, 'rrContinueBtn');
  setDisabled(btn, v.ready[v.me.idx]);
  setText(btn, continueLabel(v));
  toggleClass(overlay, 'hidden', app.table.resultDismissed);
};

// ---- the meld chooser ----------------------------------------------------------------------------

/** One arrangement in the chooser, the legacy template line for line (its whitespace included). */
export const meldOptionHtml = (
  o: View['meldOptions'][number],
  i: number,
  active: boolean,
): string => {
  const deadHtml =
    o.deadwood.length > 0
      ? `<div class="meld-group dead">${miniCards(o.deadwood)}</div>`
      : '<div class="empty-note" style="text-align:left;">No deadwood — that\'s gin!</div>';
  const use = active
    ? ''
    : `<button class="btn btn-primary btn-block btn-sm" data-meld-opt="${String(i)}" style="margin-top:8px;">Use this arrangement</button>`;
  return `<div class="rr-panel ${active ? 'scored' : ''}">
        <div class="rr-head"><span>Option ${String(i + 1)}${active ? ' <small>(in use)</small>' : ''}</span><span class="rr-pts">${String(o.value)}</span></div>
        <div class="rr-label">Melds</div><div class="rr-melds">${meldGroupsHtml(o.melds, '', true)}</div>
        <div class="rr-label">Deadwood · ${String(o.value)}</div><div class="rr-melds">${deadHtml}</div>
        ${use}
      </div>`;
};

export const meldChooserSub = (v: View): string =>
  `${String(v.meldOptions.length)} ways to meld for the same ${String(v.me.deadwoodValue)} deadwood. Your score is identical either way — but the melds you declare decide what ${v.opp.name} can lay off if you knock.`;

const paintMeldChooser = (doc: DocumentLike, app: App, v: View): void => {
  paintSheet(doc, 'meldOverlay', app.table.meldChooser);
  if (!app.table.meldChooser) return;
  setText(requireId(doc, 'meldSub'), meldChooserSub(v));
  setHtml(
    requireId(doc, 'meldOptionList'),
    trustedHtml(
      v.meldOptions.map((o, i) => meldOptionHtml(o, i, o.sig === v.activeMeldSig)).join(''),
    ),
  );
};

// ---- the endgame -------------------------------------------------------------------------------

type Ranked = Readonly<{ p: View['players'][number]; i: number }>;

/** `#finalStandings`: players by total, the winner crowned. */
export const standingsHtml = (v: View): SafeHtml => {
  const ranked = [...v.players.map((p, i): Ranked => ({ p, i }))].sort(
    (a: Ranked, b: Ranked) => b.p.total - a.p.total,
  );
  return safeHtml`${ranked.map(
    (x: Ranked, n) =>
      safeHtml`<div class="standing-row ${x.i === v.winner ? 'winner' : ''}"><div class="standing-rank">#${n + 1}</div><div class="standing-name">${x.i === v.winner ? '👑 ' : ''}${x.p.name}</div><div class="standing-total">${x.p.total}</div></div>`,
  )}`;
};

/** `#gameDuration`: the time to the last hand and the hand count, or a dash. */
export const gameDurationText = (v: View): string => {
  const last = v.rounds.at(-1);
  return last === undefined
    ? '—'
    : `${fmtDuration(last.ts - v.startedAt)} · ${String(v.rounds.length)} hands`;
};

const paintEndgame = (doc: DocumentLike, v: View): void => {
  const w = v.players[v.winner ?? 0];
  setText(requireId(doc, 'endgameTitle'), `${w.name} wins! 🎉`);
  setText(
    requireId(doc, 'endgameSub'),
    `Reached ${String(w.total)} points (target ${String(v.target)})`,
  );
  setHtml(requireId(doc, 'finalStandings'), standingsHtml(v));
  setText(requireId(doc, 'gameDuration'), gameDurationText(v));
  const meReady = v.ready[v.me.idx];
  const rematch = requireId(doc, 'rematchBtn');
  setDisabled(rematch, meReady);
  setText(rematch, meReady ? `Waiting for ${v.opp.name}…` : 'Rematch');
};

// ---- the history -------------------------------------------------------------------------------

/** `new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })`. */
export const fmtTime = (ts: number): string =>
  new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** `#historyList` for the game: one row per finished hand and the time played, or a note. */
export const historyHtml = (v: View | null): SafeHtml => {
  if (v === null || v.rounds.length === 0)
    return trustedHtml('<div class="empty-note">No hands finished yet.</div>');
  const rows = v.rounds.map((r, i) => {
    const when = fmtTime(r.ts);
    const prevTs = i > 0 ? (v.rounds[i - 1]?.ts ?? v.startedAt) : v.startedAt;
    const dur = fmtDuration(r.ts - prevTs);
    if ('void' in r)
      return safeHtml`<div class="history-round"><div class="history-meta"><div class="history-scores"><strong>H${r.handNumber}</strong> — void (stock ran out)</div><div class="history-time">${when} · took ${dur}</div></div></div>`;
    const k = v.players[r.knockerIdx];
    const o = v.players[r.knockerIdx === 0 ? 1 : 0];
    const dw = (id: string): number => r.deadwood[id] ?? 0;
    const desc =
      r.outcome === 'gin'
        ? safeHtml`${k.name} went Gin`
        : r.outcome === 'undercut'
          ? safeHtml`${o.name} undercut ${k.name} (${dw(o.id)} vs ${dw(k.id)})`
          : safeHtml`${k.name} knocked (${dw(k.id)} vs ${dw(o.id)})`;
    const pts = v.players.map((p, n) => {
      const score = r.scores[p.id] ?? 0;
      return safeHtml`${n > 0 ? ' · ' : ''}${p.name}: ${score > 0 ? '+' : ''}${score}`;
    });
    return safeHtml`<div class="history-round"><div class="history-meta"><div class="history-scores"><strong>H${r.handNumber}</strong> — ${desc}</div><div class="history-scores">${pts}</div><div class="history-time">${when} · took ${dur}</div></div></div>`;
  });
  const last = v.rounds[v.rounds.length - 1];
  const total =
    last === undefined
      ? trustedHtml('')
      : safeHtml`<div id="historyTotalTime">⏱ Time played: ${fmtDuration(last.ts - v.startedAt)}</div>`;
  return safeHtml`${rows}${total}`;
};

const paintOverlays = (doc: DocumentLike, app: App): void => {
  paintSheet(doc, 'rulesOverlay', app.shell.rulesOpen);
  paintSheet(doc, 'sandboxHelpOverlay', app.table.sandbox.helpOpen);
  paintSheet(doc, 'historyOverlay', app.table.history !== null);
  if (app.table.history === 'game')
    setHtml(requireId(doc, 'historyList'), historyHtml(app.shell.view));
  // The finished games under the game's hands (web/shared/ui/recentGames.ts); the Score Counter's
  // sheet lists its own rounds alone.
  paintRecentGames(doc, app.table.history === 'game' ? app.shell.recentGames : []);
};

// ---- the whole paint -----------------------------------------------------------------------------

/** The game screens from a view: the endgame at `gameOver`, else the table and its sheets. */
const paintGame = (doc: DocumentLike, app: App, handView: HandView): void => {
  const v = app.shell.view;
  if (v === null) {
    // `leaveGame()` hid the result sheet; nothing else of the table is touched without a view.
    paintSheet(doc, 'roundResultOverlay', false);
    return;
  }
  if (v.phase === 'gameOver') {
    paintEndgame(doc, v);
    paintRoundResult(doc, app, v);
    return;
  }
  paintOpponent(doc, app, v);
  paintPiles(doc, v);
  paintTableMelds(doc, app, v);
  paintStatus(doc, app, v);
  paintHand(doc, app, v, handView);
  paintArrange(doc, app);
  paintDiscards(doc, app, v);
  paintRoundResult(doc, app, v);
  paintMeldChooser(doc, app, v);
};

/**
 * Everything, from the App alone; `handView` is main.ts's choice (docs/ARCHITECTURE.md "Seams":
 * `slotHandView`; no default here, so the legacy `defaultHandView` tree-shakes out of the page).
 */
export const paint = (doc: PageLike, app: App, handView: HandView): void => {
  paintScreen(doc, app);
  paintWaiting(doc, app);
  paintHome(doc, app);
  paintCurtain(doc, app);
  paintHandoff(doc, app);
  paintGame(doc, app, handView);
  paintOverlays(doc, app);
};

// ---- input wiring --------------------------------------------------------------------------------

const isSortMode = (mode: string | null): mode is SortMode => SORT_MODES.some((s) => s === mode);

/** The card an event landed on, by its `data-card` id; null between the cards. */
const cardIdFrom = (e: Readonly<Event>): string | null => {
  const card = closestFrom(e, '.card');
  return card === null ? null : dataOf(card, 'card');
};

/** The table's, the sheets' and the endgame's controls, each an intent (the legacy click handlers). */
export const bindTable = (doc: PageLike, dispatch: Dispatch): void => {
  // The controls whose click is one constant (docs/design/dry-round-2.md D2, item E4); the rest
  // read the event.
  bindButtons(doc, dispatch, [
    ['stockPile', { type: 'stock/tap' }],
    ['discardPile', { type: 'discard/tap' }],
    ['soundBtn', { type: 'sound/toggle' }],
    ['deadwoodInfo', { type: 'meld/open' }],
    ['discardsBtn', { type: 'discards/open' }],
    ['arrangeBtn', { type: 'arrange/open' }],
    ['rrContinueBtn', { type: 'act', action: { type: 'ready' } }],
    ['rrHideBtn', { type: 'result/hide' }],
    ['rematchBtn', { type: 'act', action: { type: 'ready' } }],
    ['leaveBtn', { type: 'leave/request' }],
    ['leaveBtnEnd', { type: 'leave/request' }],
    ['handoffBtn', { type: 'handoff/click' }],
    ['rulesBtnGame', { type: 'rules/open' }],
    ['historyBtn', { type: 'history/open', who: 'game' }],
    ['historyBtnEnd', { type: 'history/open', who: 'game' }],
  ]);
  listenId(doc, 'hand', 'click', (e) => {
    const id = cardIdFrom(e);
    if (id !== null) dispatch({ type: 'card/tap', cardId: id });
  });
  listenId(doc, 'discardsHandToggle', 'change', () => {
    dispatch({ type: 'discards/toggleHand' });
  });
  listenId(doc, 'arrangeModes', 'click', (e) => {
    const btn = closestFrom(e, 'button[data-sort]');
    const mode = btn === null ? null : dataOf(btn, 'sort');
    if (isSortMode(mode)) dispatch({ type: 'hand/arrange', mode });
  });
  // A long press on a card (the pointer held for the reducer's timer) makes or breaks a meld by
  // hand (docs/design/dry-round-2.md D2, item E5); bound before the dragger so its pointerdown
  // and release listeners on #hand run first, as they did.
  bindLongPress(requireId(doc, 'hand'), dispatch, {
    press: (e): Intent | null => {
      const id = cardIdFrom(e);
      return id === null ? null : { type: 'card/press', cardId: id };
    },
    release: { type: 'card/release' },
  });
  // A loose card dragged by hand: the ghost, the glide of the others, the landing (dragger.ts).
  bindDrag(doc, dispatch);
  listenId(doc, 'meldOptionList', 'click', (e) => {
    const btn = closestFrom(e, '[data-meld-opt]');
    const index = btn === null ? null : dataOf(btn, 'meld-opt');
    if (index !== null) dispatch({ type: 'meld/choose', index: Number(index) });
  });
  listenId(doc, 'actions', 'click', (e) => {
    const btn = closestFrom(e, 'button[data-act]');
    if (btn === null || isDisabled(btn)) return;
    const act = dataOf(btn, 'act');
    if (act !== null) dispatch({ type: 'action/click', act });
  });
};

/** Every control of the page (home, curtain, table, sheets), once, at boot. */
export const bindAll = (doc: PageLike, dispatch: Dispatch): void => {
  bindHome(doc, dispatch);
  bindLocal(doc, dispatch);
  bindTable(doc, dispatch);
  bindSheets(doc, dispatch);
};
