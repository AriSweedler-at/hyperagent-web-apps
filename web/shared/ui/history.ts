// The shared history panel (docs/design/briscola-sound-history.md §6): one `<details>` row per
// event of a game's stream (web/shared/lib/events.ts), the short `<summary>` line the game's
// `EventCopy` spells, and the structured detail that unfolds on a click, keyed through the keyed
// slot so a row the player opened survives every repaint until a new event arrives. The panel
// reads the SAME event the sound played (§3.5): the engine appends it, `rendered` finds it new,
// its phrase plays, and this row appears. No kind, seat or word of a game is known here:
// `data-kind`, `data-seat` and `data-value` carry the game's words for its theme, and `<details>`
// is native (keyboard, screen reader, no JS state). Briscola adopts it first; gin's and
// backgammon's `historyHtml` stay until a later PR turns their rows into `<details>` (§8
// "later"). Not lint-pure: `paintHistory` and `scrollHistoryToEnd` write the document through
// dom.ts, carved out of the pure profile like keyed.ts (eslint.config.js `PURE`).
import {
  queryIn,
  requireId,
  safeHtml,
  scrollIntoView,
  trustedHtml,
  type DocumentLike,
  type SafeHtml,
} from '../edge/dom.ts';
import { lastEventId, type EventCopy, type GameEvent } from '../lib/events.ts';
import { ensureKeyed } from './keyed.ts';

/** Any event the panel renders: the stream's shape, the kind and data left to the game. */
export type HistoryEvent = GameEvent<string, unknown>;

const NONE = trustedHtml('');

/** The actor's span before the summary, or nothing for the table (a deal, a result). */
const whoHtml = (who: string | null): SafeHtml =>
  who === null ? NONE : safeHtml`<span class="who">${who}</span> `;

/** The expanded pairs as a definition list, or nothing when the copy knows no rows (§6). */
const detailHtml = (pairs: ReadonlyArray<readonly [label: string, value: string]>): SafeHtml =>
  pairs.length === 0
    ? NONE
    : safeHtml`<dl class="history-detail">${pairs.map(
        ([label, value]) => safeHtml`<dt>${label}</dt><dd>${value}</dd>`,
      )}</dl>`;

/**
 * One event's row: `<details class="history-row" data-kind data-id [data-seat] [data-value]>`,
 * the summary led by the `.who` span when the copy names an actor, the detail list when it gives
 * rows. Exported so a game's tests can pin a row alone; `historyHtml` is the list.
 */
export const historyRowHtml = <E extends HistoryEvent, C>(
  e: E,
  copy: EventCopy<E, C>,
  ctx: C,
): SafeHtml => {
  const value = copy.value?.(e, ctx) ?? null;
  const seat = e.seat === null ? NONE : safeHtml` data-seat="${e.seat}"`;
  const weight = value === null ? NONE : safeHtml` data-value="${value}"`;
  return safeHtml`<details class="history-row" data-kind="${e.kind}" data-id="${e.id}"${seat}${weight}><summary>${whoHtml(copy.who?.(e, ctx) ?? null)}${copy.summary(e, ctx)}</summary>${detailHtml(copy.detail(e, ctx))}</details>`;
};

/**
 * The whole list: one row per event in the stream's order (append-only, so newest last), or the
 * copy's `empty` note for an empty stream (nothing when the copy has none).
 */
export const historyHtml = <E extends HistoryEvent, C>(
  events: ReadonlyArray<E>,
  copy: EventCopy<E, C>,
  ctx: C,
): SafeHtml => {
  if (events.length > 0) return safeHtml`${events.map((e) => historyRowHtml(e, copy, ctx))}`;
  return copy.empty === undefined ? NONE : safeHtml`<div class="empty-note">${copy.empty}</div>`;
};

/** The key a painted list is built under: the last event's id, `-` for none (`paintHistory`). */
export const historyKey = (events: ReadonlyArray<Readonly<{ id: number }>>): string => {
  const last = lastEventId(events);
  return last === null ? '-' : String(last);
};

/**
 * Paint `#<listId>` from the stream through the keyed slot (keyed.ts): the list is rebuilt only
 * when a new event arrives (the key is the last id), so a `<details>` the player opened stays
 * open through every other repaint (a sheet toggled, a re-sent frame, a name retyped), and the
 * browser keeps the panel's own state. The numbering precondition `newEvents` states (events.ts)
 * holds here too: a stream that restarts at 0 under the same last id would keep the old rows, so
 * a game continues its ids across games or clears the slot's `data-key` when a new game starts.
 */
export const paintHistory = <E extends HistoryEvent, C>(
  doc: DocumentLike,
  listId: string,
  events: ReadonlyArray<E>,
  copy: EventCopy<E, C>,
  ctx: C,
): void => {
  ensureKeyed(
    requireId(doc, listId),
    historyKey(events),
    () => historyHtml(events, copy, ctx).markup,
  );
};

/**
 * The newest row into view (`block: 'end'`): what a sheet does as it opens, so the player reads
 * the last event first and scrolls up for the past. Nothing for an empty list.
 */
export const scrollHistoryToEnd = (doc: DocumentLike, listId: string): void => {
  const last = queryIn(requireId(doc, listId), 'details.history-row:last-of-type');
  if (last !== null) scrollIntoView(last, { block: 'end' });
};
