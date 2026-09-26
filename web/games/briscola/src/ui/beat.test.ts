// The beat's clock (docs/design/briscola-battle.md §3.2, §3.7): the settle's durations by speed and
// motion preference, and the battle stages' lengths with a variant's tempo on the tempo stages alone.
import { describe, expect, test } from 'vitest';

import {
  BEAT_MS,
  DURATIONS,
  QUICK_DURATIONS,
  REDUCED_DURATIONS,
  TEMPO_STAGES,
  durationsFor,
  stageMs,
  type BeatStage,
} from './beat.ts';

const STAGES = Object.keys(BEAT_MS) as ReadonlyArray<BeatStage>;

describe('durationsFor', () => {
  test('normal is the design; quick the ×0.6 column floored at 90 ms glides; off and reduced motion read the still', () => {
    expect(durationsFor('normal', false)).toBe(DURATIONS);
    expect(durationsFor('quick', false)).toBe(QUICK_DURATIONS);
    expect(durationsFor('off', false)).toBe(REDUCED_DURATIONS);
    expect(durationsFor('normal', true)).toBe(REDUCED_DURATIONS);
    expect(durationsFor('quick', true)).toBe(REDUCED_DURATIONS);
    expect(QUICK_DURATIONS.flyMs).toBeGreaterThanOrEqual(90);
    expect(REDUCED_DURATIONS).toEqual({ holdMs: 300, flyMs: 1, drawMs: 1, drawGapMs: 1 });
  });
});

describe('stageMs', () => {
  test('normal and quick read their columns; reduced motion and off read the still (the impact a 300 ms still, the clash stages 0)', () => {
    STAGES.forEach((stage) => {
      expect(stageMs(stage, 'normal', false)).toBe(BEAT_MS[stage].normal);
      expect(stageMs(stage, 'quick', false)).toBe(BEAT_MS[stage].quick);
      expect(stageMs(stage, 'off', false)).toBe(BEAT_MS[stage].reduced);
      expect(stageMs(stage, 'normal', true)).toBe(BEAT_MS[stage].reduced);
    });
    expect(stageMs('impact', 'off', false)).toBe(300);
    expect(stageMs('charge', 'normal', true)).toBe(0);
  });

  test('tempo scales charge, strike and aftermath alone, rounded; never the impact or a glide', () => {
    expect(TEMPO_STAGES).toEqual(new Set(['charge', 'strike', 'aftermath']));
    expect(stageMs('charge', 'normal', false, 1.15)).toBe(138);
    expect(stageMs('strike', 'normal', false, 0.85)).toBe(68);
    expect(stageMs('aftermath', 'quick', false, 1.15)).toBe(207);
    expect(stageMs('impact', 'normal', false, 1.15)).toBe(160);
    expect(stageMs('play', 'normal', false, 0.85)).toBe(320);
    expect(stageMs('charge', 'off', false, 1.15)).toBe(0);
  });

  test('quick never puts an impact under 80 ms nor a glide under 90 ms (§3.2 floors)', () => {
    expect(BEAT_MS.impact.quick).toBeGreaterThanOrEqual(80);
    (
      ['drawFlight', 'drawAuto', 'play', 'follow', 'followLast', 'packStack', 'packGlide'] as const
    ).forEach((stage) => {
      expect(BEAT_MS[stage].quick).toBeGreaterThanOrEqual(90);
    });
  });
});
