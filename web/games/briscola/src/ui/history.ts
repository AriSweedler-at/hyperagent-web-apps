// The history rows' copy (docs/design/briscola-sound-history.md §6): what the shared history panel
// (web/shared/ui/history.ts `paintHistory`, one native `<details>` per event of the stream) asks
// of a game, `EventCopy`: the one-line summary from the engine's `summaryOf` with the actor lifted
// out as the row's `.who` chip, the expanded label/value pairs of `detailOf`, a trick's value class
// for the theme's accent (`data-value`) and the empty note. The list itself, its keys and the
// appended rows are the panel's; render.ts hands it the game's start as the stream's name, so a
// replay (whose ids start over) rebuilds the list. One game per sitting (the owner, 2026-09-25):
// the result row reads the game's result alone, never the engine's match clause ("… and takes the
// match 1–0") or its tally row, though the engine keeps them on the event. Pure: strings from the
// engine and the players' names (the panel escapes them).
import type { EventCopy } from '../../../../shared/lib/events.ts';
import {
  detailOf,
  nameOf,
  resultText,
  sideList,
  sideName,
  summaryOf,
  type GameEvent,
  type Player,
  type SeatCount,
} from '../engine/index.ts';

export const EMPTY_HISTORY_MSG = 'Nothing has happened yet.';

/** What the copy reads beside the event: the players (for the names) and the seat count (for the sides). */
export type HistoryCtx = Readonly<{ players: ReadonlyArray<Player>; n: SeatCount }>;

/** The engine's line for the event; a result's without the match clause (the game's own words: "Ann wins 71–49", "A draw, 60–60"). */
export const lineOf = (event: GameEvent, ctx: HistoryCtx): string =>
  event.kind === 'result'
    ? resultText(ctx.players, ctx.n, { ...event.data, decided: false })
    : summaryOf(event, ctx.players, ctx.n);

/** The actor's name when the line opens with it (the chip lifts it out); null for the table's events and for a line spelled otherwise. */
export const whoOf = (event: GameEvent, ctx: HistoryCtx): string | null => {
  if (event.seat === null) return null;
  const name = nameOf(ctx.players, event.seat);
  return lineOf(event, ctx).startsWith(`${name} `) ? name : null;
};

/** The line without the actor the chip shows. */
export const summaryText = (event: GameEvent, ctx: HistoryCtx): string => {
  const text = lineOf(event, ctx);
  const who = whoOf(event, ctx);
  return who === null ? text : text.slice(who.length + 1);
};

/** The expanded pairs: the engine's, a result's being each side's points alone (no match tally). */
export const detailText = (
  event: GameEvent,
  ctx: HistoryCtx,
): ReadonlyArray<readonly [string, string]> =>
  event.kind === 'result'
    ? sideList(ctx.n).map(
        (side) =>
          [sideName(ctx.players, ctx.n, side), String(event.data.totals[side] ?? 0)] as const,
      )
    : detailOf(event, ctx.players, ctx.n);

/** A trick row's weight (the theme colours `big` and `huge`); nothing for the other kinds. */
export const valueOf = (event: GameEvent): string | null =>
  event.kind === 'trick' ? event.data.valueClass : null;

export const HISTORY_COPY: EventCopy<GameEvent, HistoryCtx> = {
  who: whoOf,
  summary: summaryText,
  detail: detailText,
  value: valueOf,
  empty: EMPTY_HISTORY_MSG,
};
