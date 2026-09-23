// The drag's wiring over the page fake (web/shared/edge/page.fake.ts): the pointer events reach
// the reducer as intents in the right order, the ghost gets its place and follows the pointer,
// the lit target under the pointer goes out once per change, a release over a target ends at
// once while a release over none glides back first, and a press that never moves stays a tap.
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { Rect } from '../../../../../shared/edge/dom.ts';
import { fakeEl, fakePage, fakeTarget, type FakeEl } from '../../../../../shared/edge/page.fake.ts';
import { DRAG_THRESHOLD, LAND_MS, bindDrag, type DragIntent } from './dragger.ts';

const rect = (left: number, top: number, width: number, height: number): Rect => ({
  left,
  top,
  width,
  height,
});

type Table = Readonly<{
  checker: FakeEl;
  ghost: FakeEl;
  point8: FakeEl;
  bar: FakeEl;
  loose: FakeEl;
  board: FakeEl;
  intents: DragIntent[];
}>;

/** My 8-point can move; the 5-point and my tray are lit; a checker on the 13-point cannot move. */
const table = (cloneable = true): Table => {
  const ghost = fakeEl('ghost', { classes: ['checker', 'ck-light', 'top', 'selected'] });
  const checker = fakeEl('ck', { classes: ['checker', 'ck-light', 'top'] });
  Object.assign(checker.el, {
    getBoundingClientRect: () => rect(100, 200, 40, 40),
    ...(cloneable ? { cloneNode: () => ghost.el } : {}),
  });
  const point8 = fakeEl('point-8', { classes: ['point', 'can-move'], attrs: { 'data-abs': '8' } });
  const bar = fakeEl('barBottom', { classes: ['bar', 'near', 'can-move'] });
  const loose = fakeEl('point-13', { classes: ['point'], attrs: { 'data-abs': '13' } });
  const target5 = fakeEl('point-5', { classes: ['point', 'target'], attrs: { 'data-abs': '5' } });
  Object.assign(target5.el, { getBoundingClientRect: () => rect(300, 600, 47, 171) });
  const tray = fakeEl('offLight', { classes: ['off', 'target'] });
  Object.assign(tray.el, { getBoundingClientRect: () => rect(0, 900, 100, 44) });
  const board = fakeEl('board', { queries: { '.target, .target-2': [target5, tray] } });
  const page = fakePage([board]);
  const intents: DragIntent[] = [];
  bindDrag(page.doc, (i) => {
    intents.push(i);
  });
  return { checker, ghost, point8, bar, loose, board, intents };
};

/** A pointer event's init: where it is, on which checker in which container. */
const on = (checker: FakeEl, container: FakeEl | null, x: number, y: number) => ({
  clientX: x,
  clientY: y,
  pointerId: 1,
  target: fakeTarget({
    closest: { '.checker.top': checker, ...(container === null ? {} : { '.can-move': container }) },
  }),
});

afterEach(() => {
  vi.useRealTimers();
});

describe('bindDrag', () => {
  test('a press that moves less than the threshold is a tap; a press off a movable place is nothing', () => {
    const t = table();
    t.board.fire('pointerdown', on(t.checker, t.point8, 100, 100));
    t.board.fire('pointermove', on(t.checker, t.point8, 104, 103));
    t.board.fire('pointerup', on(t.checker, t.point8, 104, 103));
    expect(t.intents).toEqual([]);
    t.board.fire('pointerdown', on(t.checker, null, 100, 100));
    t.board.fire('pointermove', on(t.checker, null, 300, 100));
    t.board.fire('pointerup', on(t.checker, null, 300, 100));
    expect(t.intents).toEqual([]);
    expect(t.ghost.hasClass('drag-ghost')).toBe(false);
  });

  test('past the threshold the drag begins, the ghost follows, the target under the pointer goes out once per change', () => {
    const t = table();
    t.board.fire('pointerdown', on(t.checker, t.point8, 100, 100));
    t.board.fire('pointermove', on(t.checker, t.point8, 100 + DRAG_THRESHOLD, 100));
    expect(t.intents).toEqual([{ type: 'checker/dragStart', from: 7 }]);
    // The ghost: the checker's clone, fixed at its rect, its own size as `--checker-d`, no lift.
    expect(t.ghost.hasClass('drag-ghost')).toBe(true);
    expect(t.ghost.hasClass('top')).toBe(false);
    expect(t.ghost.hasClass('selected')).toBe(false);
    expect([
      t.ghost.style('left'),
      t.ghost.style('top'),
      t.ghost.style('width'),
      t.ghost.style('height'),
      t.ghost.style('--checker-d'),
    ]).toEqual(['100px', '200px', '40px', '40px', '40px']);
    expect(t.ghost.style('transform')).toBe('translate(0px, 0px)');
    // Into the lit 5-point: one `dragOver`; staying there: silent.
    t.board.fire('pointermove', on(t.checker, t.point8, 320, 650));
    expect(t.ghost.style('transform')).toBe('translate(212px, 550px)');
    expect(t.intents.at(-1)).toEqual({ type: 'checker/dragOver', over: 4 });
    t.board.fire('pointermove', on(t.checker, t.point8, 330, 700));
    expect(t.intents).toHaveLength(2);
    // Over the tray, then over nothing.
    t.board.fire('pointermove', on(t.checker, t.point8, 50, 920));
    expect(t.intents.at(-1)).toEqual({ type: 'checker/dragOver', over: 'off' });
    t.board.fire('pointermove', on(t.checker, t.point8, 10, 10));
    expect(t.intents.at(-1)).toEqual({ type: 'checker/dragOver', over: null });
    // Released over nothing: the ghost glides back; the end waits for the transition.
    t.board.fire('pointerup', on(t.checker, t.point8, 10, 10));
    expect(t.ghost.hasClass('landing')).toBe(true);
    expect(t.ghost.style('transform')).toBe('translate(0px, 0px)');
    expect(t.intents).toHaveLength(4);
    t.board.fire('pointermove', on(t.checker, t.point8, 320, 650));
    expect(t.intents).toHaveLength(4);
    t.ghost.fire('transitionend');
    expect(t.intents.at(-1)).toEqual({ type: 'checker/dragEnd' });
    expect(t.ghost.removed()).toBe(true);
    t.ghost.fire('transitionend');
    expect(t.intents).toHaveLength(5);
    // The session is over: a new press starts afresh.
    t.board.fire('pointerdown', on(t.checker, t.point8, 100, 100));
    t.board.fire('pointermove', on(t.checker, t.point8, 200, 100));
    expect(t.intents.at(-1)).toEqual({ type: 'checker/dragStart', from: 7 });
  });

  test('released over a target: the end goes out at once and the ghost is gone, no glide', () => {
    const t = table();
    t.board.fire('pointerdown', on(t.checker, t.point8, 100, 100));
    t.board.fire('pointermove', on(t.checker, t.point8, 320, 650));
    expect(t.intents).toEqual([
      { type: 'checker/dragStart', from: 7 },
      { type: 'checker/dragOver', over: 4 },
    ]);
    t.board.fire('pointerup', on(t.checker, t.point8, 320, 650));
    expect(t.intents.at(-1)).toEqual({ type: 'checker/dragEnd' });
    expect(t.ghost.hasClass('landing')).toBe(false);
    expect(t.ghost.removed()).toBe(true);
  });

  test('a glide that never ends: the fallback timer lands it; a cancel is a release', () => {
    vi.useFakeTimers();
    const t = table();
    t.board.fire('pointerdown', on(t.checker, t.point8, 100, 100));
    t.board.fire('pointermove', on(t.checker, t.point8, 200, 100));
    t.board.fire('pointercancel', on(t.checker, t.point8, 200, 100));
    // Over nothing from the start: `over` never changed, so no `dragOver` went out.
    expect(t.intents).toEqual([{ type: 'checker/dragStart', from: 7 }]);
    vi.advanceTimersByTime(LAND_MS + 60);
    expect(t.intents.at(-1)).toEqual({ type: 'checker/dragEnd' });
  });

  test('from the bar, and a checker that cannot be cloned drags without a ghost', () => {
    const t = table();
    t.board.fire('pointerdown', on(t.checker, t.bar, 100, 100));
    t.board.fire('pointermove', on(t.checker, t.bar, 200, 100));
    expect(t.intents[0]).toEqual({ type: 'checker/dragStart', from: 'bar' });
    const plain = table(false);
    plain.board.fire('pointerdown', on(plain.checker, plain.point8, 100, 100));
    plain.board.fire('pointermove', on(plain.checker, plain.point8, 200, 100));
    plain.board.fire('pointerup', on(plain.checker, plain.point8, 200, 100));
    expect(plain.intents).toEqual([
      { type: 'checker/dragStart', from: 7 },
      { type: 'checker/dragEnd' },
    ]);
    expect(plain.ghost.hasClass('drag-ghost')).toBe(false);
  });
});
