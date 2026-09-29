// The stored shape of `Progress` (docs/design/rps-island.md D4, §2 "Persists"): one JSON object
// under the page's `rps_progress` key, versioned so a later shape can migrate the old one instead
// of dropping it. Every field is bounded by the rules: a value outside them (a hand-edited counter
// of 9, a window under the floor) is refused whole and the page starts over, never plays a state
// the engine could not have reached. Pure: the reader over a Store is storage.ts's.
import {
  arrayOf,
  integer,
  literal,
  map,
  nullable,
  object,
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
export const PROGRESS_VERSION = 1;

/** What the store holds: `Progress` with its version in front. */
export type StoredProgress = Readonly<{ v: typeof PROGRESS_VERSION }> & Progress;

const reactionMs: Decoder<number> = integer(0, 1_000_000);

export const decodeProgress: Decoder<Progress> = map(
  object({
    v: literal(PROGRESS_VERSION),
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

export const encodeProgress = (progress: Progress): StoredProgress => ({
  v: PROGRESS_VERSION,
  ...progress,
});
