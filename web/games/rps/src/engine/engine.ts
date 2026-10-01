// The reaction game's rules (docs/design/rps-island.md §2, the vectors §6): the hands and who beats
// whom, the verdict of one round from the window, and `Progress`, the whole of what the page keeps
// between rounds (the counter, the window, the prestige, the last five winning reactions, the
// best). Pure and DOM-free: the page's reducer (../ui/state.ts) calls these with the times the edge
// read off `performance.now()`, and the Swift model (`DiceModel/RPS/`) implements the same table,
// proved against the same vectors, so the island and the page agree. The base window is the owner's
// (2026-09-30: "make the first 'level' of rps be 2.5 seconds"), as is the down prestige (2026-10-01:
// "it's not a loss that makes 10% higher but it is a -5 'down prestige'"); every number he did not
// say (the 25% step, the 200 ms floor, five wins, the median) is the design's assumption (§2),
// spelled once here.

/** The three hands, in the order the computer's scroll cycles them (§3 step 2). */
export type Hand = 'rock' | 'paper' | 'scissors';
export const HANDS: ReadonlyArray<Hand> = ['rock', 'paper', 'scissors'];

/** The glyph each hand shows, the owner's emoji. */
export const HAND_GLYPH: Readonly<Record<Hand, string>> = {
  rock: '✊',
  paper: '✋',
  scissors: '✌️',
};

/** What one round came to; `timeout` is a loss for the counter (§2). */
export type Outcome = 'win' | 'tie' | 'loss' | 'timeout';

/** The five bands, as the wire spells them (`Mood`'s raw values; §8 `band`). */
export type Mood = 'verySad' | 'sad' | 'neutral' | 'happy' | 'veryHappy';

export const COUNTER_MIN = -5;
export const COUNTER_MAX = 5;
/** The window the game starts at, and never exceeds: the owner's first level, 2.5 seconds. */
export const BASE_WINDOW_MS = 2500;
/** Under this the next Tech up is never offered: "eventually it will become too fast". */
export const MIN_WINDOW_MS = 200;
/** A Tech up speeds the game by this factor (the owner's 25%). */
export const FAST_FACTOR = 0.75;
/** How many winning reactions Tech up's "fast enough" is read over. */
export const RECENT_WINS = 5;

/** `beats(a, b)`: rock beats scissors, scissors beats paper, paper beats rock. */
export const beats = (a: Hand, b: Hand): boolean =>
  (a === 'rock' && b === 'scissors') ||
  (a === 'scissors' && b === 'paper') ||
  (a === 'paper' && b === 'rock');

/**
 * The verdict of a round (§2): no tap, or a tap later than the window, is a timeout; a tap at
 * exactly the window counts. `player` and `reactionMs` are null when no tap came.
 */
export const verdict = (
  player: Hand | null,
  computer: Hand,
  reactionMs: number | null,
  windowMs: number,
): Outcome => {
  if (player === null || reactionMs === null || reactionMs > windowMs) return 'timeout';
  if (player === computer) return 'tie';
  return beats(player, computer) ? 'win' : 'loss';
};

/** The next level's window: 25% faster, schoolbook rounding. */
export const nextWindow = (windowMs: number): number => Math.round(windowMs * FAST_FACTOR);

const ladderFrom = (windowMs: number): ReadonlyArray<number> =>
  nextWindow(windowMs) < MIN_WINDOW_MS
    ? [windowMs]
    : [windowMs, ...ladderFrom(nextWindow(windowMs))];

/**
 * The window of every level, prestige 0 upward: the base stepped by 25% until the next step would
 * be under the floor (§2): 2500, 1875, 1406, 1055, 791, 593, 445, 334, 251.
 */
export const LADDER: ReadonlyArray<number> = ladderFrom(BASE_WINDOW_MS);
/** The top of the ladder: at this prestige Tech up is never offered. */
export const MAX_PRESTIGE = LADDER.length - 1;

/**
 * The window a level plays to (§2): the window is a function of the prestige alone, so a level
 * lost recovers exactly the level's window. Out of the ladder reads as its nearer end.
 */
export const windowFor = (prestige: number): number =>
  LADDER[Math.max(0, Math.min(MAX_PRESTIGE, prestige))] ?? BASE_WINDOW_MS;

/** Everything the page keeps between rounds (§2 "Persists"); the codec beside it stores it. */
export type Progress = Readonly<{
  counter: number;
  /** Always `windowFor(prestige)`; kept so the island and the saves read it without the ladder. */
  windowMs: number;
  prestige: number;
  /** The reaction ms of the last five wins, oldest first. */
  recentWins: ReadonlyArray<number>;
  /** The fastest winning reaction ever, or null before the first win. */
  best: number | null;
}>;

export const INITIAL_PROGRESS: Progress = {
  counter: 0,
  windowMs: windowFor(0),
  prestige: 0,
  recentWins: [],
  best: null,
};

/** Reset progress (§2): everything back to the start, the best included. */
export const reset = (): Progress => INITIAL_PROGRESS;

const clampCounter = (n: number): number => Math.max(COUNTER_MIN, Math.min(COUNTER_MAX, n));

/** The progress at `prestige` with the counter and the wins fresh: a level entered, up or down; the best kept. */
const atLevel = (progress: Progress, prestige: number): Progress => ({
  ...progress,
  prestige,
  windowMs: windowFor(prestige),
  counter: 0,
  recentWins: [],
});

/**
 * The down prestige (§2, the owner's "-5 'down prestige'"): a level is lost when a loss or a timeout
 * takes the counter to −5 with a level to lose. Nobody chooses it, so unlike Tech up it is not
 * offered: it is the round's result. Prestige −1, the previous level's exact window, counter 0,
 * the wins cleared; the best kept. At prestige 0 nothing lower exists and the counter stays at −5.
 */
export const dropsLevel = (progress: Progress): boolean =>
  progress.counter <= COUNTER_MIN && progress.prestige > 0;

/**
 * `apply(progress, outcome, reactionMs)` (§2, §6): a win is +1 and records the reaction (the best
 * too); a tie leaves everything; a loss or a timeout is −1 and never touches the window, except
 * that reaching −5 with a level to lose drops the level. The counter is clamped, and at the clamp
 * the side effects still happen (a win at +5 still records).
 */
export const apply = (
  progress: Progress,
  outcome: Outcome,
  reactionMs: number | null,
): Progress => {
  switch (outcome) {
    case 'win': {
      const ms = reactionMs ?? 0;
      return {
        ...progress,
        counter: clampCounter(progress.counter + 1),
        recentWins: [...progress.recentWins, ms].slice(-RECENT_WINS),
        best: progress.best === null ? ms : Math.min(progress.best, ms),
      };
    }
    case 'tie':
      return progress;
    case 'loss':
    case 'timeout': {
      const down: Progress = { ...progress, counter: clampCounter(progress.counter - 1) };
      return dropsLevel(down) ? atLevel(down, down.prestige - 1) : down;
    }
    default: {
      const never: never = outcome;
      return never;
    }
  }
};

/** One round end to end: the verdict, the progress it leaves, and whether it cost a level. */
export const applyRound = (
  progress: Progress,
  player: Hand | null,
  computer: Hand,
  reactionMs: number | null,
): Readonly<{ outcome: Outcome; progress: Progress; dropped: boolean }> => {
  const outcome = verdict(player, computer, reactionMs, progress.windowMs);
  const after = apply(progress, outcome, reactionMs);
  return { outcome, progress: after, dropped: after.prestige < progress.prestige };
};

/** The median of five sorted values is the third; fewer than five is never fast enough. */
export const medianRecent = (recentWins: ReadonlyArray<number>): number | null => {
  if (recentWins.length < RECENT_WINS) return null;
  const sorted = [...recentWins].sort((a, b) => a - b);
  return sorted[Math.floor(RECENT_WINS / 2)] ?? null;
};

/** Fast enough for a Tech up (§2): the median of five recorded wins within 75% of the window. */
export const fastEnough = (progress: Progress): boolean => {
  const median = medianRecent(progress.recentWins);
  return median !== null && median <= FAST_FACTOR * progress.windowMs;
};

/** "Too fast" (§2 the floor): the next window would be under 200 ms, so Tech up is never offered. */
export const atFloor = (progress: Progress): boolean =>
  nextWindow(progress.windowMs) < MIN_WINDOW_MS;

/** Tech up is offered (§2): counter at +5, fast enough, and the next window at or over the floor. */
export const canTechUp = (progress: Progress): boolean =>
  progress.counter === COUNTER_MAX && fastEnough(progress) && !atFloor(progress);

/** Take the Tech up (§2): the next level's window, the counter back to 0, prestige +1, the wins cleared; the best kept. Refused, it is a no-op. */
export const techUp = (progress: Progress): Progress =>
  canTechUp(progress) ? atLevel(progress, progress.prestige + 1) : progress;

/** The band a counter sits in (§4, §6 "Moods by counter"); the counter is clamped first. */
export const moodOf = (counter: number): Mood => {
  const c = clampCounter(Math.round(counter));
  if (c <= -5) return 'verySad';
  if (c <= -2) return 'sad';
  if (c <= 1) return 'neutral';
  if (c <= 4) return 'happy';
  return 'veryHappy';
};
