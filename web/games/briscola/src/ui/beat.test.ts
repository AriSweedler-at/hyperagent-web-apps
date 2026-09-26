// The beat's clock (docs/design/briscola-battle.md §3.2, §3.7): the settle durations by speed and
// reduced motion, and `stageMs` over the battle stages: reduced motion and `off` read the reduced
// column, `quick` its own, the tempo scales the anticipation, the strike and the poses alone.
import { describe, expect, test } from 'vitest';

import { SPEEDS } from '../../../../shared/lib/speed.ts';
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
  test('normal is the design, quick its ×0.6 column, off and reduced motion the reduced tables; reduced wins over every switch', () => {
    expect(durationsFor('normal', false)).toBe(DURATIONS);
    expect(durationsFor('quick', false)).toBe(QUICK_DURATIONS);
    expect(durationsFor('off', false)).toBe(REDUCED_DURATIONS);
    SPEEDS.forEach((s) => {
      expect(durationsFor(s, true)).toBe(REDUCED_DURATIONS);
    });
  });

  test('every quick glide is at least 90 ms and shorter than normal; every reduced glide is 1 ms with the hold a 300 ms still', () => {
    expect(QUICK_DURATIONS.flyMs).toBeGreaterThanOrEqual(90);
    expect(QUICK_DURATIONS.drawMs).toBeGreaterThanOrEqual(90);
    expect(QUICK_DURATIONS.holdMs).toBeLessThan(DURATIONS.holdMs);
    expect(QUICK_DURATIONS.flyMs).toBeLessThan(DURATIONS.flyMs);
    expect(REDUCED_DURATIONS).toEqual({ holdMs: 300, flyMs: 1, drawMs: 1, drawGapMs: 1 });
  });
});

describe('stageMs', () => {
  test('reads the column the device asks for: normal, quick, and the reduced column for off or reduced motion', () => {
    STAGES.forEach((stage) => {
      const row = BEAT_MS[stage];
      expect(stageMs(stage, 'normal', false)).toBe(row.normal);
      expect(stageMs(stage, 'quick', false)).toBe(row.quick);
      expect(stageMs(stage, 'off', false)).toBe(row.reduced);
      expect(stageMs(stage, 'normal', true)).toBe(row.reduced);
      expect(stageMs(stage, 'quick', true)).toBe(row.reduced);
    });
  });

  test('the tempo scales charge, strike and aftermath alone, rounded; the impact and the glides never move', () => {
    expect([...TEMPO_STAGES].sort()).toEqual(['aftermath', 'charge', 'strike']);
    expect(stageMs('charge', 'normal', false, 1.15)).toBe(138);
    expect(stageMs('strike', 'normal', false, 0.85)).toBe(68);
    expect(stageMs('aftermath', 'quick', false, 1.15)).toBe(207);
    STAGES.filter((s) => !TEMPO_STAGES.has(s)).forEach((stage) => {
      expect(stageMs(stage, 'normal', false, 1.15)).toBe(BEAT_MS[stage].normal);
    });
    // Reduced motion ignores the tempo too: the still is the still.
    expect(stageMs('charge', 'normal', true, 1.15)).toBe(0);
    expect(stageMs('impact', 'off', false, 0.85)).toBe(300);
  });

  test('the quick column floors: no impact under 80 ms, no glide under 90 ms', () => {
    expect(BEAT_MS.impact.quick).toBeGreaterThanOrEqual(80);
    (
      [
        'drawFlight',
        'drawFlip',
        'drawAuto',
        'play',
        'follow',
        'followLast',
        'packStack',
        'packGlide',
      ] as const
    ).forEach((stage) => {
      expect(BEAT_MS[stage].quick).toBeGreaterThanOrEqual(90);
    });
  });
});
