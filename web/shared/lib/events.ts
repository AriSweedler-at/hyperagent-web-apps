// Game events (docs/design/briscola-sound-history.md §3.5): the structured stream an engine keeps
// in place of a text log, so sound and history read the SAME thing: an event happens, its phrase
// plays (`EventSound`), its row appears (`EventCopy`). `id` is the event's index in the game, so
// the stream is append-only and monotonic: `newEvents` is a slice, and a cue memory keys on the
// last id played. The kinds, seats and data are the game's (`K`, `D`); nothing here names one.
import type { Phrase } from './sound/phrase.ts';

export type GameEvent<K extends string, D> = Readonly<{
  /** The event's index in the game: 0 for the first, one more for each after. */
  id: number;
  kind: K;
  /** The seat that acted, or null for the table (a deal, a result). */
  seat: number | null;
  /** When it happened (the engine's clock). */
  at: number;
  data: D;
}>;

/**
 * How a game spells an event for the history panel: one short `summary` line, and the
 * `detail` rows (label, value) shown when the row is opened. `ctx` is the game's (names, me).
 */
export type EventCopy<E, C = unknown> = Readonly<{
  summary: (e: E, ctx: C) => string;
  detail: (e: E, ctx: C) => ReadonlyArray<readonly [label: string, value: string]>;
}>;

/**
 * A game's sound binding: the phrase an event plays for the player `me` in `role` (the shell's
 * `'host' | 'guest' | 'local'`, typed open so this leaf names no ui type), or null for silence.
 */
export type EventSound<E, R extends string = string> = (
  e: E,
  me: number | null,
  role: R,
) => Phrase | null;

/** The last id in the stream, or null when it is empty: what a cue memory records. */
export const lastEventId = (events: ReadonlyArray<Readonly<{ id: number }>>): number | null =>
  events.reduce<number | null>((last, e) => Math.max(last ?? e.id, e.id), null);

/**
 * The events `next` carries beyond `prev`, by id. `prev` null is a first paint (a reload, a
 * resume, a fresh join): nothing is new, so history is never replayed as sound. Ids after the
 * last of `prev` count; a re-sent frame (the same ids) yields none, so the cue memory is the
 * stream itself. That makes the numbering a precondition ACROSS games one view shows: a game that
 * starts a new stream while the view stays mounted (a rematch) either continues the ids from the
 * old game or hands `prev` as null for that paint, else it is silent until its ids pass the old
 * game's last.
 */
export const newEvents = <E extends Readonly<{ id: number }>>(
  prev: ReadonlyArray<E> | null,
  next: ReadonlyArray<E>,
): ReadonlyArray<E> => {
  if (prev === null) return [];
  const last = lastEventId(prev);
  return next.filter((e) => last === null || e.id > last);
};
