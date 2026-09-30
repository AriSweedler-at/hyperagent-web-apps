// The reaction game's rules (docs/design/rps-island.md §2, the vectors §6): the hands and who beats
// whom, the verdict of one round from the window, and `Progress`, the whole of what the page keeps
// between rounds (the counter, the window, the prestige, the last five winning reactions, the
// best). Pure and DOM-free: the page's reducer (../ui/state.ts) calls these with the times the edge
// read off `performance.now()`, and the Swift model (`DiceModel/RPS/`) implements the same table,
// proved against the same vectors, so the island and the page agree. The base window is the owner's
// (2026-09-30: "make the first 'level' of rps be 2.5 seconds"); every number he did not say (the 10%
// and 25% steps, the 200 ms floor, five wins, the median) is the design's assumption (§2), spelled
// once here.

/** The three hands, in the order the computer's scroll cycles them (§3 step 2). */
export type Hand = 'rock' | 'paper' | 'scissors';
export const HANDS: ReadonlyArray<Hand> = ['rock', 'paper', 'scissors'];

/** The glyph each hand shows, the owner's emoji. */
export const HAND_GLYPH: Readonly<Record<Hand, string>> = {
  rock: '✊',
  paper: '✋',
  scissors: '✌️',
};

/** What one round came to; `timeout` is a loss for the counter and the window (§2). */
export type Outcome = 'win' | 'tie' | 'loss' | 'timeout';

/** The five bands, as the wire spells them (`Mood`'s raw values; §8 `band`). */
export type Mood = 'verySad' | 'sad' | 'neutral' | 'happy' | 'veryHappy';

export const COUNTER_MIN = -5;
export const COUNTER_MAX = 5;
/** The window the game starts at, and never exceeds: the owner's first level, 2.5 seconds. */
export const BASE_WINDOW_MS = 2500;
/** Under this the next Tech up is never offered: "eventually it will become too fast". */
export const MIN_WINDOW_MS = 200;
/** A loss slows the game by this factor, a Tech up speeds it by that one (the owner's 10% and 25%). */
export const SLOW_FACTOR = 1.1;
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

/** Everything the page keeps between rounds (§2 "Persists"); the codec beside it stores it. */
export type Progress = Readonly<{
  counter: number;
  windowMs: number;
  prestige: number;
  /** The reaction ms of the last five wins, oldest first. */
  recentWins: ReadonlyArray<number>;
  /** The fastest winning reaction ever, or null before the first win. */
  best: number | null;
}>;

export const INITIAL_PROGRESS: Progress = {
  counter: 0,
  windowMs: BASE_WINDOW_MS,
  prestige: 0,
  recentWins: [],
  best: null,
};

/** Reset progress (§2): everything back to the start, the best included. */
export const reset = (): Progress => INITIAL_PROGRESS;

const clampCounter = (n: number): number => Math.max(COUNTER_MIN, Math.min(COUNTER_MAX, n));

/** A loss's window: 10% slower, schoolbook rounding, never above the base. */
export const slowedWindow = (windowMs: number): number =>
  Math.min(BASE_WINDOW_MS, Math.round(windowMs * SLOW_FACTOR));

/** A Tech up's window: 25% faster, schoolbook rounding. */
export const nextWindow = (windowMs: number): number => Math.round(windowMs * FAST_FACTOR);

/**
 * `apply(progress, outcome, reactionMs)` (§2, §6): a win is +1 and records the reaction (the best
 * too); a tie leaves everything; a loss or a timeout is −1 and slows the window. The counter is
 * clamped, and at the clamp the side effects still happen (a win at +5 still records, a loss at −5
 * still slows).
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
    case 'timeout':
      return {
        ...progress,
        counter: clampCounter(progress.counter - 1),
        windowMs: slowedWindow(progress.windowMs),
      };
    default: {
      const never: never = outcome;
      return never;
    }
  }
};

/** One round end to end: the verdict, then the progress it leaves. */
export const applyRound = (
  progress: Progress,
  player: Hand | null,
  computer: Hand,
  reactionMs: number | null,
): Readonly<{ outcome: Outcome; progress: Progress }> => {
  const outcome = verdict(player, computer, reactionMs, progress.windowMs);
  return { outcome, progress: apply(progress, outcome, reactionMs) };
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

/** Take the Tech up (§2): a faster window, the counter back to 0, prestige +1, the wins cleared; the best kept. Refused, it is a no-op. */
export const techUp = (progress: Progress): Progress =>
  canTechUp(progress)
    ? {
        ...progress,
        windowMs: nextWindow(progress.windowMs),
        counter: 0,
        prestige: progress.prestige + 1,
        recentWins: [],
      }
    : progress;

/** The band a counter sits in (§4, §6 "Moods by counter"); the counter is clamped first. */
export const moodOf = (counter: number): Mood => {
  const c = clampCounter(Math.round(counter));
  if (c <= -5) return 'verySad';
  if (c <= -2) return 'sad';
  if (c <= 1) return 'neutral';
  if (c <= 4) return 'happy';
  return 'veryHappy';
};
