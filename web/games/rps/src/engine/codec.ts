// The stored shape of `Progress` (docs/design/rps-island.md D4, §2 "Persists", §10 "Stored shape"):
// one JSON object under the page's `rps_progress` key, versioned so a later shape migrates the old
// one instead of dropping it. Every field is bounded by the rules: a value outside them (a
// hand-edited counter of 9, a window under the floor, a prestige past the ladder) is refused whole
// and the page starts over, never plays a state the engine could not have reached. The window is
// the level's (`windowFor(prestige)`, §2), so a save's `windowMs` is read as a bounded field and
// then snapped to its level: a v2 save slowed under the rule before 2026-10-01 (2063 at prestige 1)
// reads as 1875, and a version 1 save (the 1000 ms base, before 2026-09-30) lands on the same rung
// of the new ladder (prestige 1 at 750 → 1875), no rescaling needed. Pure: the reader over a Store
// is storage.ts's.
import {
  arrayOf,
  integer,
  literal,
  map,
  nullable,
  object,
  oneOf,
  refine,
  type Decoder,
} from '../../../../shared/lib/json.ts';
import {
  BASE_WINDOW_MS,
  COUNTER_MAX,
  COUNTER_MIN,
  MAX_PRESTIGE,
  MIN_WINDOW_MS,
  RECENT_WINS,
  windowFor,
  type Progress,
} from './engine.ts';

/** The shape's version; bumped with a migration when a field changes meaning. */
export const PROGRESS_VERSION = 2;

/** What the store holds: `Progress` with its version in front. */
export type StoredProgress = Readonly<{ v: typeof PROGRESS_VERSION }> & Progress;

const reactionMs: Decoder<number> = integer(0, 1_000_000);

/**
 * The fields every version has, each bounded by the rules, under the given version tag; the window
 * is read within its bounds, then snapped to the level's.
 */
const fields = (version: number): Decoder<Progress> =>
  map(
    object({
      v: literal(version),
      counter: integer(COUNTER_MIN, COUNTER_MAX),
      windowMs: integer(MIN_WINDOW_MS, BASE_WINDOW_MS),
      prestige: integer(0, MAX_PRESTIGE),
      recentWins: refine(
        arrayOf(reactionMs),
        (wins) => wins.length <= RECENT_WINS,
        `at most ${String(RECENT_WINS)} recent wins`,
      ),
      best: nullable(reactionMs),
    }),
    ({ counter, prestige, recentWins, best }): Progress => ({
      counter,
      windowMs: windowFor(prestige),
      prestige,
      recentWins,
      best,
    }),
  );

/**
 * The current shape with its window snapped to its level; a v1 save the same way (its window was
 * on the 1000 ms base, and the level says which rung that was); anything else (no `v`, another
 * version, a field out of bounds) refused, so the page starts over.
 */
export const decodeProgress: Decoder<Progress> = oneOf(fields(PROGRESS_VERSION), fields(1));

export const encodeProgress = (progress: Progress): StoredProgress => ({
  v: PROGRESS_VERSION,
  ...progress,
});
