import { describe, expect, test } from 'vitest';

import { DRAG_THRESHOLD, inside, startedDrag, type Rect } from './drag.ts';

describe('the gesture', () => {
  test('a press is a drag once the pointer has moved the threshold, in any direction', () => {
    expect(startedDrag({ x: 10, y: 10 }, { x: 10 + DRAG_THRESHOLD - 1, y: 10 })).toBe(false);
    expect(startedDrag({ x: 10, y: 10 }, { x: 10 + DRAG_THRESHOLD, y: 10 })).toBe(true);
    expect(startedDrag({ x: 10, y: 10 }, { x: 10, y: 10 - DRAG_THRESHOLD })).toBe(true);
    expect(startedDrag({ x: 10, y: 10 }, { x: 15, y: 15 })).toBe(false);
  });

  test('inside: the edges count, each side excludes, a rect with no size holds nothing', () => {
    const r: Rect = { left: 10, top: 20, width: 30, height: 40 };
    expect(inside(r, { x: 10, y: 20 })).toBe(true);
    expect(inside(r, { x: 40, y: 60 })).toBe(true);
    expect(inside(r, { x: 9, y: 30 })).toBe(false);
    expect(inside(r, { x: 41, y: 30 })).toBe(false);
    expect(inside(r, { x: 20, y: 19 })).toBe(false);
    expect(inside(r, { x: 20, y: 61 })).toBe(false);
    // Zero in one measure still holds its line; zero in both holds nothing.
    expect(inside({ left: 0, top: 0, width: 0, height: 10 }, { x: 0, y: 5 })).toBe(true);
    expect(inside({ left: 0, top: 0, width: 0, height: 0 }, { x: 0, y: 0 })).toBe(false);
  });
});
