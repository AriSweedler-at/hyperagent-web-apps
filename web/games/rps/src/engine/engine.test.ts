// The design's vectors (docs/design/rps-island.md §6) as table tests, so this engine and the Swift
// model (ios/DiceClip/DiceModel/Sources/DiceModel/RPS, `swift test`) are held to one table.
import { describe, expect, test } from 'vitest';

import { decodeProgress, encodeProgress } from './codec.ts';
import {
  INITIAL_PROGRESS,
  apply,
  applyRound,
  atFloor,
  beats,
  canTechUp,
  moodOf,
  nextWindow,
  reset,
  slowedWindow,
  techUp,
  verdict,
  type Hand,
  type Outcome,
  type Progress,
} from './engine.ts';

const at = (windowMs: number, counter = 0): Progress => ({
  ...INITIAL_PROGRESS,
  windowMs,
  counter,
});

describe('the hands', () => {
  test('rock beats scissors, scissors beats paper, paper beats rock, and nothing else', () => {
    expect(beats('rock', 'scissors')).toBe(true);
    expect(beats('scissors', 'paper')).toBe(true);
    expect(beats('paper', 'rock')).toBe(true);
    expect(beats('scissors', 'rock')).toBe(false);
    expect(beats('paper', 'scissors')).toBe(false);
    expect(beats('rock', 'paper')).toBe(false);
    expect(beats('rock', 'rock')).toBe(false);
  });
});

describe('verdicts and windows (§6, the first table)', () => {
  // window, player, computer, reaction, outcome, Δ counter, window after
  const ROWS: ReadonlyArray<
    readonly [number, Hand | null, Hand, number | null, Outcome, number, number]
  > = [
    [1000, 'rock', 'scissors', 350, 'win', 1, 1000],
    [1000, 'rock', 'paper', 350, 'loss', -1, 1000],
    [1000, 'paper', 'paper', 350, 'tie', 0, 1000],
    [1000, 'rock', 'scissors', 1000, 'win', 1, 1000],
    [1000, 'rock', 'scissors', 1001, 'timeout', -1, 1000],
    [750, 'scissors', 'paper', 700, 'win', 1, 750],
    [750, 'scissors', 'rock', 300, 'loss', -1, 825],
    [750, null, 'rock', null, 'timeout', -1, 825],
    [750, 'paper', 'rock', 751, 'timeout', -1, 825],
    [825, 'rock', 'paper', 10, 'loss', -1, 908],
    [908, 'rock', 'paper', 10, 'loss', -1, 999],
    [999, 'rock', 'paper', 100, 'loss', -1, 1000],
    [238, 'rock', 'scissors', 238, 'win', 1, 238],
    [238, 'rock', 'scissors', 239, 'timeout', -1, 262],
  ];
  test.each(ROWS)(
    'window %i, %s vs %s at %s ms: %s, counter %i, window %i',
    (windowMs, player, computer, reactionMs, outcome, delta, after) => {
      expect(verdict(player, computer, reactionMs, windowMs)).toBe(outcome);
      const round = applyRound(at(windowMs), player, computer, reactionMs);
      expect(round.outcome).toBe(outcome);
      expect(round.progress.counter).toBe(delta);
      expect(round.progress.windowMs).toBe(after);
    },
  );

  test('a win records its reaction (oldest first, five kept) and the best; a tie records nothing', () => {
    const wins = [500, 400, 300, 200, 100, 600].reduce(
      (p, ms) => apply(p, 'win', ms),
      INITIAL_PROGRESS,
    );
    expect(wins.recentWins).toEqual([400, 300, 200, 100, 600]);
    expect(wins.best).toBe(100);
    expect(wins.counter).toBe(5);
    expect(apply(wins, 'tie', 50)).toEqual(wins);
  });

  test('clamping: a win at +5 stays +5 and still records; a loss at −5 stays −5 and still slows', () => {
    const top = apply(at(1000, 5), 'win', 300);
    expect(top.counter).toBe(5);
    expect(top.recentWins).toEqual([300]);
    expect(top.best).toBe(300);
    const bottom = apply(at(750, -5), 'loss', 10);
    expect(bottom.counter).toBe(-5);
    expect(bottom.windowMs).toBe(825);
    expect(apply(at(750, -5), 'timeout', null).windowMs).toBe(825);
  });

  test('the rounding chain of §2: up by 10% to the cap, down by 25% to the floor', () => {
    expect([750, 825, 908, 999].map(slowedWindow)).toEqual([825, 908, 999, 1000]);
    expect([1000, 750, 563, 422, 317, 238].map(nextWindow)).toEqual([750, 563, 422, 317, 238, 179]);
  });
});

describe('Tech up (§6, the second table)', () => {
  const ROWS: ReadonlyArray<readonly [number, number, ReadonlyArray<number>, boolean, string]> = [
    [1000, 5, [700, 720, 740, 760, 780], true, 'median 740 ≤ 750; next 750 ≥ 200'],
    [1000, 5, [700, 720, 760, 780, 800], false, 'median 760 > 750'],
    [1000, 4, [100, 100, 100, 100, 100], false, 'counter under 5'],
    [1000, 5, [100, 100, 100, 100], false, 'fewer than five wins recorded'],
    [317, 5, [200, 210, 230, 240, 250], true, 'median 230 ≤ 237.75; next 238 ≥ 200'],
    [238, 5, [100, 100, 100, 100, 100], false, 'next 179 < 200: too fast'],
  ];
  test.each(ROWS)(
    'window %i, counter %i, wins %j: offered %s (%s)',
    (windowMs, counter, recentWins, offered) => {
      expect(canTechUp({ ...at(windowMs, counter), recentWins })).toBe(offered);
    },
  );

  test('the median is read off the sorted values, not the order they came in', () => {
    expect(canTechUp({ ...at(1000, 5), recentWins: [780, 700, 760, 720, 740] })).toBe(true);
  });

  test('taken at window 1000, counter 5, prestige 0, best 300: window 750, counter 0, prestige 1, wins empty, best 300', () => {
    const before: Progress = {
      counter: 5,
      windowMs: 1000,
      prestige: 0,
      recentWins: [700, 720, 740, 760, 780],
      best: 300,
    };
    expect(techUp(before)).toEqual({
      counter: 0,
      windowMs: 750,
      prestige: 1,
      recentWins: [],
      best: 300,
    });
  });

  test('refused, it changes nothing', () => {
    const notYet = { ...at(1000, 4), recentWins: [100, 100, 100, 100, 100] };
    expect(techUp(notYet)).toBe(notYet);
  });

  test('the floor: at 238 ms the game is as fast as it gets and prestige tops out at 5', () => {
    const ladder = [1000, 750, 563, 422, 317, 238];
    expect(ladder.map((windowMs) => atFloor(at(windowMs)))).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
    const climbed = ladder
      .slice(0, -1)
      .reduce((p) => techUp({ ...p, counter: 5, recentWins: [1, 1, 1, 1, 1] }), INITIAL_PROGRESS);
    expect(climbed.windowMs).toBe(238);
    expect(climbed.prestige).toBe(5);
    expect(canTechUp({ ...climbed, counter: 5, recentWins: [1, 1, 1, 1, 1] })).toBe(false);
  });
});

describe('reset and moods', () => {
  test('reset from any state: window 1000, counter 0, prestige 0, wins empty, best none', () => {
    expect(reset()).toEqual({
      counter: 0,
      windowMs: 1000,
      prestige: 0,
      recentWins: [],
      best: null,
    });
    expect(reset()).toEqual(INITIAL_PROGRESS);
  });

  test('moods by counter: −5 very sad; −4..−2 sad; −1..1 neutral; 2..4 happy; 5 very happy', () => {
    const moods = Array.from({ length: 11 }, (_, i) => moodOf(i - 5));
    expect(moods).toEqual([
      'verySad',
      'sad',
      'sad',
      'sad',
      'neutral',
      'neutral',
      'neutral',
      'happy',
      'happy',
      'happy',
      'veryHappy',
    ]);
    // Out of range is clamped first.
    expect(moodOf(-9)).toBe('verySad');
    expect(moodOf(9)).toBe('veryHappy');
  });
});

describe('the stored shape (D4)', () => {
  test('round-trips every field under version 1', () => {
    const progress: Progress = {
      counter: -3,
      windowMs: 563,
      prestige: 2,
      recentWins: [300, 310, 320],
      best: 210,
    };
    const stored = encodeProgress(progress);
    expect(stored).toEqual({ v: 1, ...progress });
    expect(decodeProgress(JSON.parse(JSON.stringify(stored)))).toEqual({
      ok: true,
      value: progress,
    });
    expect(decodeProgress(encodeProgress(INITIAL_PROGRESS))).toEqual({
      ok: true,
      value: INITIAL_PROGRESS,
    });
  });

  test.each([
    ['another version', { ...encodeProgress(INITIAL_PROGRESS), v: 2 }],
    ['a counter past the clamp', { ...encodeProgress(INITIAL_PROGRESS), counter: 9 }],
    ['a window under the floor', { ...encodeProgress(INITIAL_PROGRESS), windowMs: 100 }],
    ['a window over the base', { ...encodeProgress(INITIAL_PROGRESS), windowMs: 1200 }],
    ['six recent wins', { ...encodeProgress(INITIAL_PROGRESS), recentWins: [1, 2, 3, 4, 5, 6] }],
    ['a negative best', { ...encodeProgress(INITIAL_PROGRESS), best: -1 }],
    ['not an object', 'progress'],
  ])('refuses %s', (_name, stored) => {
    expect(decodeProgress(stored).ok).toBe(false);
  });
});
