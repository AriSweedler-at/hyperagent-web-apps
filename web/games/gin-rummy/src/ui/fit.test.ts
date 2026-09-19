import { describe, expect, test } from 'vitest';

import {
  MAX_SCALE,
  MIN_SCALE,
  fitScale,
  nextScale,
  overflows,
  stepDown,
  type Measure,
} from './fit.ts';

const fits: Measure = {
  appScrollHeight: 600,
  appClientHeight: 600,
  handScrollHeight: 120,
  handClientHeight: 120,
};

describe('overflows', () => {
  test('either element taller than its box by more than 1px', () => {
    expect(overflows(fits)).toBe(false);
    expect(overflows({ ...fits, appScrollHeight: 601 })).toBe(false);
    expect(overflows({ ...fits, appScrollHeight: 602 })).toBe(true);
    expect(overflows({ ...fits, handScrollHeight: 122 })).toBe(true);
  });
});

describe('nextScale / stepDown', () => {
  test('steps by 0.05 rounded to two decimals, stops at the floor or when the table fits', () => {
    expect(stepDown(1)).toBe(0.95);
    expect(stepDown(0.7)).toBe(0.65);
    expect(stepDown(0.55)).toBe(0.5);
    expect(nextScale(1, fits)).toBeNull();
    expect(nextScale(1, { ...fits, appScrollHeight: 900 })).toBe(0.95);
    expect(nextScale(MIN_SCALE, { ...fits, appScrollHeight: 900 })).toBeNull();
    expect(nextScale(0.51, { ...fits, appScrollHeight: 900 })).toBe(0.46);
  });
});

describe('fitScale', () => {
  test('a table that fits stays at 1; one that never fits lands on 0.5; content that shrinks lands in between', () => {
    expect(fitScale(() => fits)).toBe(MAX_SCALE);
    expect(fitScale(() => ({ ...fits, appScrollHeight: 5000 }))).toBe(MIN_SCALE);
    const shrinking = (scale: number): Measure => ({
      ...fits,
      appScrollHeight: Math.round(800 * scale),
    });
    // 800 * 0.75 = 600 fits (600 > 601 is false); 0.8 gives 640 which does not.
    expect(fitScale(shrinking)).toBe(0.75);
    const measured: number[] = [];
    fitScale((scale) => {
      measured.push(scale);
      return shrinking(scale);
    });
    expect(measured).toEqual([1, 0.95, 0.9, 0.85, 0.8, 0.75]);
  });
});
