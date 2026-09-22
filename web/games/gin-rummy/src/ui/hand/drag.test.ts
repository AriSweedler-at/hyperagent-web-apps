import { describe, expect, test } from 'vitest';

import {
  DRAG_THRESHOLD,
  MAX_TILT,
  at,
  dropIndex,
  follow,
  ghostTransform,
  settled,
  startedDrag,
  tiltOf,
  type Rect,
} from './drag.ts';

const cell = (left: number, top: number): Rect => ({ left, top, width: 50, height: 70 });

describe('the gesture', () => {
  test('a press is a drag once the pointer has moved the threshold, in any direction', () => {
    expect(startedDrag({ x: 10, y: 10 }, { x: 10 + DRAG_THRESHOLD - 1, y: 10 })).toBe(false);
    expect(startedDrag({ x: 10, y: 10 }, { x: 10 + DRAG_THRESHOLD, y: 10 })).toBe(true);
    expect(startedDrag({ x: 10, y: 10 }, { x: 10, y: 10 - DRAG_THRESHOLD })).toBe(true);
    expect(startedDrag({ x: 10, y: 10 }, { x: 15, y: 15 })).toBe(false);
  });
});

describe('the motion', () => {
  test('the ghost trails the pointer, closing the gap frame by frame, and comes to rest on it', () => {
    const target = { x: 100, y: 0 };
    const one = follow(at(0, 0), target);
    expect(one).toEqual({ x: 35, y: 0, vx: 35, vy: 0 });
    const two = follow(one, target);
    expect(two.x).toBeCloseTo(57.75);
    expect(two.vx).toBeCloseTo(22.75);
    const rested = Array.from({ length: 40 }).reduce<typeof one>((m) => follow(m, target), two);
    expect(settled(rested, target)).toBe(true);
    expect(settled(one, target)).toBe(false);
  });

  test('the tilt follows the horizontal speed, leaning the way it moves, and is capped', () => {
    expect(tiltOf(0)).toBe(0);
    expect(tiltOf(5)).toBeCloseTo(6);
    expect(tiltOf(-5)).toBeCloseTo(-6);
    expect(tiltOf(100)).toBe(MAX_TILT);
    expect(tiltOf(-100)).toBe(-MAX_TILT);
  });

  test('the transform is the offset from the grab point and the lean, to the hundredth', () => {
    const origin = { x: 10, y: 20 };
    expect(ghostTransform(at(10, 20), origin)).toBe('translate(0px, 0px) rotate(0deg)');
    expect(ghostTransform({ x: 30.126, y: 15, vx: -4, vy: 0 }, origin)).toBe(
      'translate(20.13px, -5px) rotate(-4.8deg)',
    );
    expect(ghostTransform(at(0, 0), origin, 3)).toBe('translate(-10px, -20px) rotate(3deg)');
  });
});

describe('dropIndex', () => {
  // Two rows of three loose cells, 54 apart, rows 80 apart; the dragged card is the fourth (index 3).
  const cells = [cell(0, 0), cell(54, 0), cell(108, 0), cell(0, 80), cell(54, 80), cell(108, 80)];

  test('before every cell, between cells on a row, after the last', () => {
    expect(dropIndex({ x: 5, y: 30 }, cells, 3)).toBe(0);
    // Past the first cell's centre (25): after it.
    expect(dropIndex({ x: 30, y: 30 }, cells, 3)).toBe(1);
    expect(dropIndex({ x: 90, y: 30 }, cells, 3)).toBe(2);
    // The second row: the three cells above precede; the dragged card's own cell never counts.
    expect(dropIndex({ x: 5, y: 110 }, cells, 3)).toBe(3);
    expect(dropIndex({ x: 60, y: 110 }, cells, 3)).toBe(3);
    expect(dropIndex({ x: 85, y: 110 }, cells, 3)).toBe(4);
    expect(dropIndex({ x: 200, y: 110 }, cells, 3)).toBe(5);
    // Below every row: after all the others.
    expect(dropIndex({ x: 0, y: 300 }, cells, 3)).toBe(5);
  });

  test('the dragged card at the front: the others shift down by one', () => {
    expect(dropIndex({ x: 30, y: 30 }, cells, 0)).toBe(0);
    expect(dropIndex({ x: 85, y: 30 }, cells, 0)).toBe(1);
    expect(dropIndex({ x: 200, y: 110 }, cells, 0)).toBe(5);
  });
});
