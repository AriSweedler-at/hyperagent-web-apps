// The history rows (docs/design/briscola-sound-history.md §6): one native `<details>` per event of
// the stream, a one-line `<summary>` from the engine's `summaryOf` and the expanded label/value
// pairs of `detailOf` as a `<dl>`, newest last. The shared panel the plan names
// (web/shared/ui/history.ts, PR S3) has not landed, so the §6 markup is spelled here with its ids
// and classes (`history-row history-detail who`, `data-kind`, `data-seat`, `data-value`), and its
// adoption is a rename of `historyHtml`'s import. The list is keyed by the last event's id
// (`paintHistory` through the shared keyed slot), so a repaint of the same list leaves the open
// rows open; `<details>` carries its own keyboard and screen-reader behaviour, so no TS state.
// Strings from the engine and the players' names; the names are escaped, as everywhere.
import { escapeHtml, type Element } from '../../../../shared/edge/dom.ts';
import { ensureKeyed } from '../../../../shared/ui/keyed.ts';
import {
  detailOf,
  nameOf,
  summaryOf,
  type GameEvent,
  type Player,
  type SeatCount,
} from '../engine/index.ts';

export const EMPTY_HISTORY_MSG = 'Nothing has happened yet.';

/** `#historyList`'s key: the last event's id (`events[i].id === i`, match-wide, so no reset at a game boundary). */
export const historyKey = (events: ReadonlyArray<GameEvent>): string => {
  const last = events.at(-1);
  return last === undefined ? 'none' : `e${String(last.id)}`;
};

/** The summary with its actor as a `.who` chip: the engine writes the name into the line; the row shows it once, as the label. */
const summaryHtml = (event: GameEvent, players: ReadonlyArray<Player>, n: SeatCount): string => {
  const text = summaryOf(event, players, n);
  const who = event.seat === null ? '' : nameOf(players, event.seat);
  return who !== '' && text.startsWith(`${who} `)
    ? `<span class="who">${escapeHtml(who)}</span> ${escapeHtml(text.slice(who.length + 1))}`
    : escapeHtml(text);
};

const detailHtml = (event: GameEvent, players: ReadonlyArray<Player>, n: SeatCount): string => {
  const pairs = detailOf(event, players, n);
  return pairs.length === 0
    ? ''
    : `<dl class="history-detail">${pairs
        .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`)
        .join('')}</dl>`;
};

/** A trick row's `data-value` (the theme colours the row by value class); nothing for the other kinds. */
const valueAttr = (event: GameEvent): string =>
  event.kind === 'trick' ? ` data-value="${event.data.valueClass}"` : '';

/** One `<details class="history-row">` with `data-kind`, `data-id`, `data-seat` (where the event has an actor) and `data-value` (a trick). */
export const historyRowHtml = (
  event: GameEvent,
  players: ReadonlyArray<Player>,
  n: SeatCount,
): string =>
  `<details class="history-row" data-kind="${event.kind}" data-id="${String(event.id)}"${
    event.seat === null ? '' : ` data-seat="${String(event.seat)}"`
  }${valueAttr(event)}><summary>${summaryHtml(event, players, n)}</summary>${detailHtml(
    event,
    players,
    n,
  )}</details>`;

/** Every event's row, oldest first so the newest is last; the empty note before anything has happened. */
export const historyHtml = (
  events: ReadonlyArray<GameEvent>,
  players: ReadonlyArray<Player>,
  n: SeatCount,
): string =>
  events.length === 0
    ? `<div class="empty-note">${EMPTY_HISTORY_MSG}</div>`
    : events.map((e) => historyRowHtml(e, players, n)).join('');

/** Rebuild `#historyList` only when a new event arrived (the shared keyed slot), so open rows survive a repaint. */
export const paintHistory = (
  list: Element,
  events: ReadonlyArray<GameEvent>,
  players: ReadonlyArray<Player>,
  n: SeatCount,
): void => {
  ensureKeyed(list, historyKey(events), () => historyHtml(events, players, n));
};
