// The shared history panel (docs/design/briscola-sound-history.md §6): one `<details>` row per
// event of a game's stream (web/shared/lib/events.ts), the short `<summary>` line the game's
// `EventCopy` spells, and the structured detail that unfolds on a click, keyed on the stream so a
// row the player opened survives every repaint, a new event's row appended after it. The panel
// reads the SAME event the sound played (§3.5): the engine appends it, `rendered` finds it new,
// its phrase plays, and this row appears. No kind, seat or word of a game is known here:
// `data-kind`, `data-seat` and `data-value` carry the game's words for its theme, and `<details>`
// is native (keyboard, screen reader, no JS state). Briscola adopts it first; gin's and
// backgammon's `historyHtml` stay until a later PR turns their rows into `<details>` (§8
// "later"). Not lint-pure: `paintHistory` and `scrollHistoryToEnd` write the document through
// dom.ts, carved out of the pure profile like keyed.ts (eslint.config.js `PURE`).
import {
  appendHtml,
  dataOf,
  queryIn,
  requireId,
  safeHtml,
  scrollIntoView,
  setAttr,
  setHtml,
  trustedHtml,
  type DocumentLike,
  type Element,
  type SafeHtml,
} from '../edge/dom.ts';
import { lastEventId, type EventCopy, type GameEvent } from '../lib/events.ts';

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

/** The list's `data-key`: the stream's name before the last id when the game names one (`<stream>:<id>`), the id alone otherwise. */
const listKey = (stream: string, events: ReadonlyArray<Readonly<{ id: number }>>): string =>
  stream === '' ? historyKey(events) : `${stream}:${historyKey(events)}`;

/**
 * The id the painted rows end at, when `events` carries on from them under the same stream name
 * (its last row wears that id, the stream has passed it): the rows to append are the ids after it.
 * Null when the list must be rebuilt: nothing painted, another stream, the ids restarted, or the
 * last row is not the one the key says (the list was rewritten by something else).
 */
const appendAfter = (
  list: Element,
  painted: string | null,
  stream: string,
  events: ReadonlyArray<Readonly<{ id: number }>>,
): number | null => {
  if (painted === null) return null;
  const cut = painted.lastIndexOf(':');
  const name = cut < 0 ? '' : painted.slice(0, cut);
  const id = Number(painted.slice(cut + 1));
  const last = lastEventId(events);
  if (name !== stream || !Number.isInteger(id) || last === null || last <= id) return null;
  if (!events.some((e) => e.id === id)) return null;
  const row = queryIn(list, 'details.history-row:last-of-type');
  return row !== null && dataOf(row, 'id') === String(id) ? id : null;
};

/**
 * Paint `#<listId>` from the stream: the list is keyed on the stream's name (`stream`, a match's
 * start or a game number; '' for a game whose ids never restart) and its last id, so a repaint of
 * the same stream writes nothing and a `<details>` the player opened stays open through it (a
 * sheet toggled, a re-sent frame, a name retyped); a new event of the same stream is APPENDED as
 * one row after the ones there, so the open row survives that too; a stream under another name,
 * or one whose ids restarted (a rematch that keeps the name), rebuilds the list whole. The
 * browser keeps the panel's own state throughout.
 */
export const paintHistory = <E extends HistoryEvent, C>(
  doc: DocumentLike,
  listId: string,
  events: ReadonlyArray<E>,
  copy: EventCopy<E, C>,
  ctx: C,
  stream = '',
): void => {
  const list = requireId(doc, listId);
  const key = listKey(stream, events);
  const painted = dataOf(list, 'key');
  if (painted === key) return;
  const after = appendAfter(list, painted, stream, events);
  setAttr(list, 'data-key', key);
  if (after === null) {
    setHtml(list, historyHtml(events, copy, ctx));
    return;
  }
  appendHtml(
    list,
    safeHtml`${events.filter((e) => e.id > after).map((e) => historyRowHtml(e, copy, ctx))}`,
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
