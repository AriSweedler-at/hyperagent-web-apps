// The design's vectors (docs/design/rps-island.md §6) as table tests, so this engine and the Swift
// model (ios/DiceClip/DiceModel/Sources/DiceModel/RPS, `swift test`) are held to one table.
import { describe, expect, test } from 'vitest';

import { decodeProgress, encodeProgress } from './codec.ts';
import {
  INITIAL_PROGRESS,
  LADDER,
  MAX_PRESTIGE,
  apply,
  applyRound,
  atFloor,
  beats,
  canTechUp,
  moodOf,
  nextWindow,
  reset,
  techUp,
  verdict,
  windowFor,
  type Hand,
  type Outcome,
  type Progress,
} from './engine.ts';

const at = (windowMs: number, counter = 0): Progress => ({
  ...INITIAL_PROGRESS,
  windowMs,
  counter,
});

/** The progress at a level with the counter where the vectors put it. */
const level = (prestige: number, counter: number, extra: Partial<Progress> = {}): Progress => ({
  ...INITIAL_PROGRESS,
  prestige,
  windowMs: windowFor(prestige),
  counter,
  ...extra,
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
    [2500, 'rock', 'scissors', 350, 'win', 1, 2500],
    [2500, 'rock', 'paper', 350, 'loss', -1, 2500],
    [2500, 'paper', 'paper', 350, 'tie', 0, 2500],
    [2500, 'rock', 'scissors', 2500, 'win', 1, 2500],
    [2500, 'rock', 'scissors', 2501, 'timeout', -1, 2500],
    [1875, 'scissors', 'paper', 1700, 'win', 1, 1875],
    [1875, 'scissors', 'rock', 300, 'loss', -1, 1875],
    [1875, null, 'rock', null, 'timeout', -1, 1875],
    [1875, 'paper', 'rock', 1876, 'timeout', -1, 1875],
    [251, 'rock', 'scissors', 251, 'win', 1, 251],
    [251, 'rock', 'scissors', 252, 'timeout', -1, 251],
  ];
  test.each(ROWS)(
    'window %i, %s vs %s at %s ms: %s, counter %i, window %i',
    (windowMs, player, computer, reactionMs, outcome, delta, after) => {
      expect(verdict(player, computer, reactionMs, windowMs)).toBe(outcome);
      const round = applyRound(at(windowMs), player, computer, reactionMs);
      expect(round.outcome).toBe(outcome);
      expect(round.dropped).toBe(false);
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

  test('clamping: a win at +5 stays +5 and still records; a loss at −5 with no level to lose stays −5, the window 2500', () => {
    const top = apply(at(2500, 5), 'win', 300);
    expect(top.counter).toBe(5);
    expect(top.recentWins).toEqual([300]);
    expect(top.best).toBe(300);
    const bottom = apply(at(2500, -5), 'loss', 10);
    expect(bottom).toEqual(at(2500, -5));
    expect(apply(at(2500, -5), 'timeout', null)).toEqual(at(2500, -5));
  });

  test("the ladder of §2: the base stepped by 25% to the floor; the window is the level's", () => {
    expect(LADDER).toEqual([2500, 1875, 1406, 1055, 791, 593, 445, 334, 251]);
    expect(MAX_PRESTIGE).toBe(8);
    expect(LADDER.map(nextWindow)).toEqual([1875, 1406, 1055, 791, 593, 445, 334, 251, 188]);
    expect([0, 1, 8].map(windowFor)).toEqual([2500, 1875, 251]);
    // Out of the ladder reads as its nearer end.
    expect(windowFor(-1)).toBe(2500);
    expect(windowFor(9)).toBe(251);
  });
});

describe('the down prestige (§2, §6 "Down a level")', () => {
  test("a loss at −4 with a level to lose: prestige −1, the previous level's window, counter 0, the wins cleared, the best kept", () => {
    const before = level(1, -4, { recentWins: [900, 950], best: 300 });
    const round = applyRound(before, 'rock', 'paper', 300);
    expect(round.outcome).toBe('loss');
    expect(round.dropped).toBe(true);
    expect(round.progress).toEqual({
      counter: 0,
      windowMs: 2500,
      prestige: 0,
      recentWins: [],
      best: 300,
    });
  });

  test('a timeout drops the same way; from prestige 2 the window is 1875, not the base', () => {
    const round = applyRound(level(2, -4, { best: 210 }), null, 'rock', null);
    expect(round.outcome).toBe('timeout');
    expect(round.dropped).toBe(true);
    expect(round.progress).toEqual({
      counter: 0,
      windowMs: 1875,
      prestige: 1,
      recentWins: [],
      best: 210,
    });
  });

  test('a loss at −3 moves the counter alone, whatever the level', () => {
    const before = level(3, -3, { recentWins: [500], best: 400 });
    expect(apply(before, 'loss', 100)).toEqual({ ...before, counter: -4 });
    expect(apply(before, 'timeout', null)).toEqual({ ...before, counter: -4 });
  });

  test('a loss already at −5 (a save from before the rule) drops when there is a level to lose', () => {
    expect(apply(level(1, -5), 'loss', 100)).toEqual(level(0, 0));
    expect(applyRound(level(1, -5), 'rock', 'paper', 100).dropped).toBe(true);
  });

  test('at prestige 0 the counter stays at −5: nothing lower exists', () => {
    const round = applyRound(level(0, -5), 'rock', 'paper', 100);
    expect(round.dropped).toBe(false);
    expect(round.progress).toEqual(level(0, -5));
  });

  test('a drop recovers exactly the level the Tech up left: up and down the ladder round-trips', () => {
    const up = techUp(level(3, 5, { recentWins: [1, 1, 1, 1, 1], best: 1 }));
    expect(up).toEqual(level(4, 0, { best: 1 }));
    const down = [1, 2, 3, 4, 5].reduce((p) => apply(p, 'loss', 10), up);
    expect(down).toEqual(level(3, 0, { best: 1 }));
  });
});

describe('Tech up (§6, the second table)', () => {
  const ROWS: ReadonlyArray<readonly [number, number, ReadonlyArray<number>, boolean, string]> = [
    [2500, 5, [1700, 1750, 1800, 1850, 1900], true, 'median 1800 ≤ 1875; next 1875 ≥ 200'],
    [2500, 5, [1700, 1750, 1900, 1950, 2000], false, 'median 1900 > 1875'],
    [2500, 4, [100, 100, 100, 100, 100], false, 'counter under 5'],
    [2500, 5, [100, 100, 100, 100], false, 'fewer than five wins recorded'],
    [334, 5, [200, 210, 240, 245, 250], true, 'median 240 ≤ 250.5; next 251 ≥ 200'],
    [251, 5, [100, 100, 100, 100, 100], false, 'next 188 < 200: too fast'],
  ];
  test.each(ROWS)(
    'window %i, counter %i, wins %j: offered %s (%s)',
    (windowMs, counter, recentWins, offered) => {
      expect(canTechUp({ ...at(windowMs, counter), recentWins })).toBe(offered);
    },
  );

  test('the median is read off the sorted values, not the order they came in', () => {
    expect(canTechUp({ ...at(2500, 5), recentWins: [1900, 1700, 1800, 1750, 1850] })).toBe(true);
  });

  test('taken at window 2500, counter 5, prestige 0, best 300: window 1875, counter 0, prestige 1, wins empty, best 300', () => {
    const before: Progress = {
      counter: 5,
      windowMs: 2500,
      prestige: 0,
      recentWins: [1700, 1750, 1800, 1850, 1900],
      best: 300,
    };
    expect(techUp(before)).toEqual({
      counter: 0,
      windowMs: 1875,
      prestige: 1,
      recentWins: [],
      best: 300,
    });
  });

  test('refused, it changes nothing', () => {
    const notYet = { ...at(2500, 4), recentWins: [100, 100, 100, 100, 100] };
    expect(techUp(notYet)).toBe(notYet);
  });

  test('the floor: at 251 ms the game is as fast as it gets and prestige tops out at 8', () => {
    expect(LADDER.map((windowMs) => atFloor(at(windowMs)))).toEqual([
      ...LADDER.slice(0, -1).map(() => false),
      true,
    ]);
    const climbed = LADDER.slice(0, -1).reduce(
      (p) => techUp({ ...p, counter: 5, recentWins: [1, 1, 1, 1, 1] }),
      INITIAL_PROGRESS,
    );
    expect(climbed.windowMs).toBe(251);
    expect(climbed.prestige).toBe(8);
    expect(canTechUp({ ...climbed, counter: 5, recentWins: [1, 1, 1, 1, 1] })).toBe(false);
  });
});

describe('reset and moods', () => {
  test('reset from any state: window 2500, counter 0, prestige 0, wins empty, best none', () => {
    expect(reset()).toEqual({
      counter: 0,
      windowMs: 2500,
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
  test('round-trips every field under version 2', () => {
    const progress: Progress = {
      counter: -3,
      windowMs: 1406,
      prestige: 2,
      recentWins: [300, 310, 320],
      best: 210,
    };
    const stored = encodeProgress(progress);
    expect(stored).toEqual({ v: 2, ...progress });
    expect(decodeProgress(JSON.parse(JSON.stringify(stored)))).toEqual({
      ok: true,
      value: progress,
    });
    expect(decodeProgress(encodeProgress(INITIAL_PROGRESS))).toEqual({
      ok: true,
      value: INITIAL_PROGRESS,
    });
  });

  test("a v2 save's window snaps to its level: 2063 at prestige 1 (slowed under the old rule) reads as 1875", () => {
    const slowed = { v: 2, counter: -1, windowMs: 2063, prestige: 1, recentWins: [], best: 300 };
    expect(decodeProgress(slowed)).toEqual({
      ok: true,
      value: { counter: -1, windowMs: 1875, prestige: 1, recentWins: [], best: 300 },
    });
    expect(decodeProgress({ ...slowed, windowMs: 2500, prestige: 0 })).toMatchObject({
      ok: true,
      value: { windowMs: 2500 },
    });
    expect(decodeProgress({ ...slowed, windowMs: 276, prestige: 8 })).toMatchObject({
      ok: true,
      value: { windowMs: 251 },
    });
  });

  test("a version-1 save (the 1000 ms base) lands on its level: the window is the prestige's rung, the rest kept", () => {
    const v1 = (windowMs: number, prestige = 2) => ({
      v: 1,
      counter: -3,
      windowMs,
      prestige,
      recentWins: [300, 310, 320],
      best: 210,
    });
    expect(decodeProgress(v1(563))).toEqual({
      ok: true,
      value: { counter: -3, windowMs: 1406, prestige: 2, recentWins: [300, 310, 320], best: 210 },
    });
    expect(decodeProgress(v1(750, 1))).toMatchObject({ ok: true, value: { windowMs: 1875 } });
    expect(decodeProgress(v1(1000, 0))).toMatchObject({ ok: true, value: { windowMs: 2500 } });
    // A v1 window past its own base still reads; v1's other bounds still hold.
    expect(decodeProgress(v1(1200))).toMatchObject({ ok: true, value: { windowMs: 1406 } });
    expect(decodeProgress({ ...v1(750), counter: 9 }).ok).toBe(false);
    // Nothing is written back as v1: a decoded v1 save re-encodes under the current version.
    const read = decodeProgress(v1(750));
    expect(read.ok && encodeProgress(read.value).v).toBe(2);
  });

  test.each([
    ['another version', { ...encodeProgress(INITIAL_PROGRESS), v: 3 }],
    ['no version', { counter: 0, windowMs: 2500, prestige: 0, recentWins: [], best: null }],
    ['a counter past the clamp', { ...encodeProgress(INITIAL_PROGRESS), counter: 9 }],
    ['a window under the floor', { ...encodeProgress(INITIAL_PROGRESS), windowMs: 100 }],
    ['a window over the base', { ...encodeProgress(INITIAL_PROGRESS), windowMs: 2600 }],
    ['a prestige past the ladder', { ...encodeProgress(INITIAL_PROGRESS), prestige: 9 }],
    ['six recent wins', { ...encodeProgress(INITIAL_PROGRESS), recentWins: [1, 2, 3, 4, 5, 6] }],
    ['a negative best', { ...encodeProgress(INITIAL_PROGRESS), best: -1 }],
    ['not an object', 'progress'],
  ])('refuses %s', (_name, stored) => {
    expect(decodeProgress(stored).ok).toBe(false);
  });
});
