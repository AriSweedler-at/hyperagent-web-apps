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
  drawRunMs,
  drawSpan,
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
    expect(REDUCED_DURATIONS).toEqual({
      holdMs: 300,
      flyMs: 1,
      drawMs: 1,
      drawGapMs: 1,
      flipMs: 1,
    });
  });
});

describe('the draw order round my tap (docs/design/briscola-battle.md §3.1 DRAW)', () => {
  test('drawSpan: the seats before me, whether I draw, the seats after; every seat before and none after when I am not drawing', () => {
    expect(drawSpan([1, 0], 1)).toEqual({ before: 0, mine: true, after: 1 });
    expect(drawSpan([1, 0], 0)).toEqual({ before: 1, mine: true, after: 0 });
    expect(drawSpan([2, 3, 0, 1], 0)).toEqual({ before: 2, mine: true, after: 1 });
    expect(drawSpan([1, 0], 2)).toEqual({ before: 2, mine: false, after: 0 });
    expect(drawSpan([], 0)).toEqual({ before: 0, mine: false, after: 0 });
  });

  test('drawRunMs: one draw plus a gap per further seat; 0 for no seats', () => {
    expect(drawRunMs(0, DURATIONS)).toBe(0);
    expect(drawRunMs(1, DURATIONS)).toBe(260);
    expect(drawRunMs(3, DURATIONS)).toBe(260 + 2 * 160);
    expect(drawRunMs(2, REDUCED_DURATIONS)).toBe(2);
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
