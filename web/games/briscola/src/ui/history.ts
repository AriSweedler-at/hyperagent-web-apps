// The history rows' copy (docs/design/briscola-sound-history.md §6): what the shared history panel
// (web/shared/ui/history.ts `paintHistory`, one native `<details>` per event of the stream) asks
// of a game, `EventCopy`: the one-line summary from the engine's `summaryOf` with the actor lifted
// out as the row's `.who` chip, the expanded label/value pairs of `detailOf`, a trick's value class
// for the theme's accent (`data-value`) and the empty note. The list itself, its keys and the
// appended rows are the panel's; render.ts hands it the match's start as the stream's name, so a
// rematch (whose ids start over) rebuilds the list. Pure: strings from the engine and the players'
// names (the panel escapes them).
import type { EventCopy } from '../../../../shared/lib/events.ts';
import {
  detailOf,
  nameOf,
  summaryOf,
  type GameEvent,
  type Player,
  type SeatCount,
} from '../engine/index.ts';

export const EMPTY_HISTORY_MSG = 'Nothing has happened yet.';

/** What the copy reads beside the event: the players (for the names) and the seat count (for the sides). */
export type HistoryCtx = Readonly<{ players: ReadonlyArray<Player>; n: SeatCount }>;

/** The actor's name when the engine's line opens with it (the chip lifts it out); null for the table's events and for a line spelled otherwise. */
export const whoOf = (event: GameEvent, ctx: HistoryCtx): string | null => {
  if (event.seat === null) return null;
  const name = nameOf(ctx.players, event.seat);
  return summaryOf(event, ctx.players, ctx.n).startsWith(`${name} `) ? name : null;
};

/** The engine's line without the actor the chip shows. */
export const summaryText = (event: GameEvent, ctx: HistoryCtx): string => {
  const text = summaryOf(event, ctx.players, ctx.n);
  const who = whoOf(event, ctx);
  return who === null ? text : text.slice(who.length + 1);
};

/** A trick row's weight (the theme colours `big` and `huge`); nothing for the other kinds. */
export const valueOf = (event: GameEvent): string | null =>
  event.kind === 'trick' ? event.data.valueClass : null;

export const HISTORY_COPY: EventCopy<GameEvent, HistoryCtx> = {
  who: whoOf,
  summary: summaryText,
  detail: (event, ctx) => detailOf(event, ctx.players, ctx.n),
  value: valueOf,
  empty: EMPTY_HISTORY_MSG,
};
