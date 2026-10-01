// The round as the reducer runs it (docs/design/rps-island.md §3): scripted intents with fixed
// draws and clock readings, the effects the edge would run, and the progress each round leaves.
import { describe, expect, test } from 'vitest';

import { INITIAL_PROGRESS, type Hand, type Progress } from '../engine/engine.ts';
import {
  NEXT_ROUND_MS,
  SCROLL_TICK_MS,
  autoNext,
  drawHand,
  drawScrollMs,
  initialApp,
  nextShown,
  reduce,
  type App,
  type Effect,
  type Intent,
} from './state.ts';

const play = (app: App, intents: ReadonlyArray<Intent>): App =>
  intents.reduce((a, intent) => reduce(a, intent).app, app);

const effectsOf = (app: App, intent: Intent): ReadonlyArray<Effect> => reduce(app, intent).effects;

/** Go, three ticks, the resolve at t=1000 with the given hand: the armed table. */
const armed = (app: App, computer: Hand): App =>
  play(app, [
    { type: 'go', scrollMs: 1000 },
    { type: 'scroll/tick' },
    { type: 'scroll/tick' },
    { type: 'scroll/tick' },
    { type: 'resolve', computer, at: 1000 },
  ]);

describe('the round', () => {
  const start = initialApp(INITIAL_PROGRESS);

  test('Go: the scroll begins on ✊ with its tick and the resolve timer for the drawn length', () => {
    const step = reduce(start, { type: 'go', scrollMs: 1234 });
    expect(step.app.phase).toEqual({ kind: 'scrolling', shown: 'rock' });
    expect(step.effects).toEqual([
      { kind: 'cancel', id: 'next' },
      { kind: 'timer', id: 'scroll', ms: SCROLL_TICK_MS },
      { kind: 'timer', id: 'resolve', ms: 1234 },
    ]);
  });

  test('the scroll cycles ✊ → ✋ → ✌️ → ✊ every tick, and taps do nothing', () => {
    const scrolling = reduce(start, { type: 'go', scrollMs: 1000 }).app;
    const shown = [1, 2, 3, 4].reduce<ReadonlyArray<string>>(
      (acc) => {
        const last = acc.at(-1) ?? 'rock';
        return [...acc, nextShown(last as Hand)];
      },
      ['rock'],
    );
    expect(shown).toEqual(['rock', 'paper', 'scissors', 'rock', 'paper']);
    const ticked = play(scrolling, [{ type: 'scroll/tick' }, { type: 'scroll/tick' }]);
    expect(ticked.phase).toEqual({ kind: 'scrolling', shown: 'scissors' });
    expect(reduce(ticked, { type: 'tap', hand: 'rock', at: 500 })).toEqual({
      app: ticked,
      effects: [],
    });
    expect(reduce(ticked, { type: 'timeout' }).app).toBe(ticked);
    expect(reduce(ticked, { type: 'go', scrollMs: 1 }).app).toBe(ticked);
  });

  test('the resolve arms the table: the beep, the window timer, the scroll stopped', () => {
    const scrolling = reduce(start, { type: 'go', scrollMs: 1000 }).app;
    const step = reduce(scrolling, { type: 'resolve', computer: 'scissors', at: 1000 });
    expect(step.app.phase).toEqual({ kind: 'armed', computer: 'scissors', resolvedAt: 1000 });
    expect(step.effects).toEqual([
      { kind: 'cancel', id: 'scroll' },
      { kind: 'cue', cue: 'resolve' },
      { kind: 'timer', id: 'window', ms: 2500 },
    ]);
    // A resolve that is not preceded by a scroll is ignored.
    expect(reduce(start, { type: 'resolve', computer: 'rock', at: 1 }).app).toBe(start);
  });

  test('a win: the reaction in whole ms, +1, the cue, the save, the next round in 1.4 s', () => {
    const step = reduce(armed(start, 'scissors'), { type: 'tap', hand: 'rock', at: 1350.4 });
    expect(step.app.phase).toEqual({
      kind: 'verdict',
      computer: 'scissors',
      player: 'rock',
      outcome: 'win',
      reactionMs: 350,
      windowMs: 2500,
      dropped: false,
    });
    expect(step.app.progress).toEqual({
      ...INITIAL_PROGRESS,
      counter: 1,
      recentWins: [350],
      best: 350,
    });
    expect(step.app.rounds).toBe(1);
    expect(step.effects).toEqual([
      { kind: 'cancel', id: 'window' },
      { kind: 'cue', cue: 'win' },
      { kind: 'save' },
      { kind: 'timer', id: 'next', ms: NEXT_ROUND_MS },
    ]);
  });

  test('a tie leaves the progress; a loss is −1 and leaves the window', () => {
    const tie = reduce(armed(start, 'paper'), { type: 'tap', hand: 'paper', at: 1200 }).app;
    expect(tie.phase).toMatchObject({ outcome: 'tie', reactionMs: 200 });
    expect(tie.progress).toEqual(INITIAL_PROGRESS);
    const fast = initialApp({ ...INITIAL_PROGRESS, windowMs: 1875, prestige: 1 });
    const loss = reduce(armed(fast, 'paper'), { type: 'tap', hand: 'rock', at: 1300 }).app;
    expect(loss.phase).toMatchObject({ outcome: 'loss', dropped: false });
    expect(loss.progress).toEqual({
      ...INITIAL_PROGRESS,
      counter: -1,
      windowMs: 1875,
      prestige: 1,
    });
  });

  test('the fifth point down with a level to lose drops it: the verdict says so, the window is the level below, the next round still comes', () => {
    const edge = initialApp({
      ...INITIAL_PROGRESS,
      counter: -4,
      windowMs: 1406,
      prestige: 2,
      best: 300,
    });
    const step = reduce(armed(edge, 'paper'), { type: 'tap', hand: 'rock', at: 1300 });
    expect(step.app.phase).toEqual({
      kind: 'verdict',
      computer: 'paper',
      player: 'rock',
      outcome: 'loss',
      reactionMs: 300,
      windowMs: 1406,
      dropped: true,
    });
    expect(step.app.progress).toEqual({
      counter: 0,
      windowMs: 1875,
      prestige: 1,
      recentWins: [],
      best: 300,
    });
    expect(step.effects).toEqual([
      { kind: 'cancel', id: 'window' },
      { kind: 'cue', cue: 'loss' },
      { kind: 'save' },
      { kind: 'timer', id: 'next', ms: NEXT_ROUND_MS },
    ]);
    // A timeout drops the same way; at the base level −5 is simply −5.
    const out = reduce(armed(edge, 'paper'), { type: 'timeout' }).app;
    expect(out.phase).toMatchObject({ outcome: 'timeout', dropped: true });
    expect(out.progress).toMatchObject({ counter: 0, prestige: 1, windowMs: 1875 });
    const floor = initialApp({ ...INITIAL_PROGRESS, counter: -4 });
    const stuck = reduce(armed(floor, 'paper'), { type: 'timeout' }).app;
    expect(stuck.phase).toMatchObject({ dropped: false });
    expect(stuck.progress).toEqual({ ...INITIAL_PROGRESS, counter: -5 });
  });

  test('a late tap is a timeout (the boundary counts), and so is the window timer', () => {
    const late = reduce(armed(start, 'scissors'), { type: 'tap', hand: 'rock', at: 3501 }).app;
    expect(late.phase).toMatchObject({ outcome: 'timeout', player: 'rock', reactionMs: 2501 });
    expect(late.progress.counter).toBe(-1);
    const boundary = reduce(armed(start, 'scissors'), { type: 'tap', hand: 'rock', at: 3500 }).app;
    expect(boundary.phase).toMatchObject({ outcome: 'win', reactionMs: 2500 });
    const step = reduce(armed(start, 'scissors'), { type: 'timeout' });
    expect(step.app.phase).toEqual({
      kind: 'verdict',
      computer: 'scissors',
      player: null,
      outcome: 'timeout',
      reactionMs: null,
      windowMs: 2500,
      dropped: false,
    });
    expect(step.effects).toContainEqual({ kind: 'cue', cue: 'timeout' });
    expect(step.app.progress.counter).toBe(-1);
    // A tap before the resolve instant (a clock oddity) reads as 0 ms, never negative.
    const early = reduce(armed(start, 'scissors'), { type: 'tap', hand: 'rock', at: 999 }).app;
    expect(early.phase).toMatchObject({ reactionMs: 0 });
  });

  test('Stop holds the next round; Go resumes; Stop does nothing mid-round', () => {
    const won = reduce(armed(start, 'scissors'), { type: 'tap', hand: 'rock', at: 1300 }).app;
    expect(autoNext(won)).toBe(true);
    const stopped = reduce(won, { type: 'stop' });
    expect(stopped.app.paused).toBe(true);
    expect(autoNext(stopped.app)).toBe(false);
    expect(stopped.effects).toEqual([{ kind: 'cancel', id: 'next' }]);
    expect(reduce(stopped.app, { type: 'go', scrollMs: 900 }).app.paused).toBe(false);
    const mid = armed(start, 'rock');
    expect(reduce(mid, { type: 'stop' }).app).toBe(mid);
  });
});

describe('Tech up and Reset', () => {
  const eligible: Progress = {
    counter: 4,
    windowMs: 2500,
    prestige: 0,
    recentWins: [300, 300, 300, 300],
    best: 300,
  };

  test('the fifth fast win at +4 offers Tech up: no auto next, the game waits', () => {
    const step = reduce(armed(initialApp(eligible), 'scissors'), {
      type: 'tap',
      hand: 'rock',
      at: 1300,
    });
    expect(step.app.progress.counter).toBe(5);
    expect(autoNext(step.app)).toBe(false);
    expect(step.effects).toEqual([
      { kind: 'cancel', id: 'window' },
      { kind: 'cue', cue: 'win' },
      { kind: 'save' },
      { kind: 'cancel', id: 'next' },
    ]);
    const taken = reduce(step.app, { type: 'techUp' });
    expect(taken.app.progress).toEqual({
      counter: 0,
      windowMs: 1875,
      prestige: 1,
      recentWins: [],
      best: 300,
    });
    expect(taken.app.phase).toEqual({ kind: 'idle' });
    expect(taken.effects).toEqual([
      { kind: 'cancel', id: 'next' },
      { kind: 'cue', cue: 'techUp' },
      { kind: 'save' },
    ]);
  });

  test('Tech up when not offered is a no-op', () => {
    const app = initialApp(INITIAL_PROGRESS);
    expect(reduce(app, { type: 'techUp' })).toEqual({ app, effects: [] });
  });

  test('Reset: the start, every timer cancelled, the cue and the save', () => {
    const deep = initialApp({ ...eligible, counter: -5, windowMs: 251, prestige: 3 });
    const step = reduce(armed(deep, 'rock'), { type: 'reset' });
    expect(step.app.progress).toEqual(INITIAL_PROGRESS);
    expect(step.app.phase).toEqual({ kind: 'idle' });
    expect(step.effects).toEqual([
      { kind: 'cancel', id: 'scroll' },
      { kind: 'cancel', id: 'resolve' },
      { kind: 'cancel', id: 'window' },
      { kind: 'cancel', id: 'next' },
      { kind: 'cue', cue: 'reset' },
      { kind: 'save' },
    ]);
  });
});

describe('the draws', () => {
  test('the scroll length is uniform in 0.65 … 1.6 s, the hand uniform over the three', () => {
    expect(drawScrollMs(() => 0)).toBe(650);
    expect(drawScrollMs(() => 0.5)).toBe(1125);
    expect(drawScrollMs(() => 0.999999)).toBe(1600);
    expect(drawHand(() => 0)).toBe('rock');
    expect(drawHand(() => 0.34)).toBe('paper');
    expect(drawHand(() => 0.67)).toBe('scissors');
    expect(drawHand(() => 0.999999)).toBe('scissors');
  });

  test('effects are read off the step, not the app', () => {
    expect(effectsOf(initialApp(INITIAL_PROGRESS), { type: 'scroll/tick' })).toEqual([]);
  });
});
