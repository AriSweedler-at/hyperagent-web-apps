// The stored shape of `Progress` (docs/design/rps-island.md D4, §2 "Persists", §10 "Stored shape"):
// one JSON object under the page's `rps_progress` key, versioned so a later shape migrates the old
// one instead of dropping it. Every field is bounded by the rules: a value outside them (a
// hand-edited counter of 9, a window under the floor) is refused whole and the page starts over,
// never plays a state the engine could not have reached. Version 1 is the 1000 ms base's shape
// (before 2026-09-30): it is read by rescaling its window to the 2500 ms base, the ladder being
// multiplicative, so a player at 750 lands at 1875, the same rung down. Pure: the reader over a
// Store is storage.ts's.
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
  MIN_WINDOW_MS,
  RECENT_WINS,
  type Progress,
} from './engine.ts';

/** The shape's version; bumped with a migration when a field changes meaning. */
export const PROGRESS_VERSION = 2;
/** Version 1's base window, the game's until 2026-09-30; a v1 window is scaled by the bases' ratio. */
export const V1_BASE_WINDOW_MS = 1000;

/** What the store holds: `Progress` with its version in front. */
export type StoredProgress = Readonly<{ v: typeof PROGRESS_VERSION }> & Progress;

const reactionMs: Decoder<number> = integer(0, 1_000_000);

/** The fields every version has, each bounded by the rules, under the given version tag. */
const fields = (version: number): Decoder<Progress> =>
  map(
    object({
      v: literal(version),
      counter: integer(COUNTER_MIN, COUNTER_MAX),
      windowMs: integer(MIN_WINDOW_MS, BASE_WINDOW_MS),
      prestige: integer(0, 1_000),
      recentWins: refine(
        arrayOf(reactionMs),
        (wins) => wins.length <= RECENT_WINS,
        `at most ${String(RECENT_WINS)} recent wins`,
      ),
      best: nullable(reactionMs),
    }),
    ({ counter, windowMs, prestige, recentWins, best }): Progress => ({
      counter,
      windowMs,
      prestige,
      recentWins,
      best,
    }),
  );

/**
 * A v1 window on the current base: × 2.5 (the bases' ratio), schoolbook rounding, never above the
 * base: 1000 → 2500, 750 → 1875, 563 → 1408.
 */
export const rescaleV1Window = (windowMs: number): number =>
  Math.min(BASE_WINDOW_MS, Math.round((windowMs * BASE_WINDOW_MS) / V1_BASE_WINDOW_MS));

/**
 * The current shape as it is; a v1 save with its window rescaled, the rest kept; anything else (no
 * `v`, another version, a field out of bounds) refused, so the page starts over.
 */
export const decodeProgress: Decoder<Progress> = oneOf(
  fields(PROGRESS_VERSION),
  map(fields(1), (progress) => ({ ...progress, windowMs: rescaleV1Window(progress.windowMs) })),
);

export const encodeProgress = (progress: Progress): StoredProgress => ({
  v: PROGRESS_VERSION,
  ...progress,
});
