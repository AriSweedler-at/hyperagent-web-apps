// The drag's wiring over the page fake (web/shared/edge/page.fake.ts): the pointer events reach
// the reducer as intents in the right order, the ghost gets its place and follows the pointer,
// the trick under the pointer goes out once per change, a release over the trick ends at once
// while a release off it glides back first, a press that never moves stays a tap, and a card that
// is not playable is nothing.
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { Rect } from '../../../../shared/edge/dom.ts';
import { fakeEl, fakePage, fakeTarget, type FakeEl } from '../../../../shared/edge/page.fake.ts';
import { DRAG_THRESHOLD, LAND_MS, bindDrag, type DragIntent } from './dragger.ts';

const rect = (left: number, top: number, width: number, height: number): Rect => ({
  left,
  top,
  width,
  height,
});

type Table = Readonly<{
  card: FakeEl;
  idle: FakeEl;
  ghost: FakeEl;
  hand: FakeEl;
  intents: DragIntent[];
}>;

/** The asso di coppe is playable at (100, 600); the trick sits at (100..300, 200..400). */
const table = (cloneable = true): Table => {
  const ghost = fakeEl('ghost', { classes: ['card', 'face', 'playable', 'selected'] });
  const card = fakeEl('ac', {
    classes: ['card', 'face', 'playable'],
    attrs: { 'data-card': 'AC' },
  });
  Object.assign(card.el, {
    getBoundingClientRect: () => rect(100, 600, 111, 214),
    ...(cloneable ? { cloneNode: () => ghost.el } : {}),
  });
  const idle = fakeEl('rb', { classes: ['card', 'face'], attrs: { 'data-card': 'RB' } });
  const trick = fakeEl('trick');
  Object.assign(trick.el, { getBoundingClientRect: () => rect(100, 200, 200, 200) });
  const hand = fakeEl('hand');
  const page = fakePage([hand, trick]);
  const intents: DragIntent[] = [];
  bindDrag(page.doc, (i) => {
    intents.push(i);
  });
  return { card, idle, ghost, hand, intents };
};

/** A pointer event's init: where it is and on which card. */
const on = (card: FakeEl, x: number, y: number) => ({
  clientX: x,
  clientY: y,
  pointerId: 1,
  target: fakeTarget({ closest: { '.card[data-card]': card } }),
});

afterEach(() => {
  vi.useRealTimers();
});

describe('bindDrag', () => {
  test('a press that moves less than the threshold is a tap; a press on a card that is not playable is nothing', () => {
    const t = table();
    t.hand.fire('pointerdown', on(t.card, 100, 600));
    t.hand.fire('pointermove', on(t.card, 104, 603));
    t.hand.fire('pointerup', on(t.card, 104, 603));
    expect(t.intents).toEqual([]);
    t.hand.fire('pointerdown', on(t.idle, 100, 600));
    t.hand.fire('pointermove', on(t.idle, 300, 300));
    t.hand.fire('pointerup', on(t.idle, 300, 300));
    expect(t.intents).toEqual([]);
  });

  test('past the threshold the drag begins with the card id, the ghost follows, the trick under the pointer goes out once per change; a release off the trick glides back, then ends', () => {
    vi.useFakeTimers();
    const t = table();
    t.hand.fire('pointerdown', on(t.card, 100, 600));
    t.hand.fire('pointermove', on(t.card, 100 + DRAG_THRESHOLD, 600));
    expect(t.intents).toEqual([{ type: 'card/dragStart', cardId: 'AC' }]);
    expect(t.ghost.hasClass('drag-ghost')).toBe(true);
    expect(t.ghost.classes()).not.toContain('playable');
    expect(t.ghost.classes()).not.toContain('selected');
    expect(t.ghost.style('--card-w')).toBe('111px');
    t.hand.fire('pointermove', on(t.card, 150, 300));
    t.hand.fire('pointermove', on(t.card, 160, 310));
    expect(t.intents.slice(1)).toEqual([{ type: 'card/dragOver', over: true }]);
    t.hand.fire('pointermove', on(t.card, 500, 900));
    expect(t.intents.slice(2)).toEqual([{ type: 'card/dragOver', over: false }]);
    t.hand.fire('pointerup', on(t.card, 500, 900));
    expect(t.ghost.hasClass('landing')).toBe(true);
    expect(t.intents).toHaveLength(3);
    vi.advanceTimersByTime(LAND_MS + 60);
    expect(t.intents.at(-1)).toEqual({ type: 'card/dragEnd' });
    expect(t.ghost.removed()).toBe(true);
  });

  test('released over the trick: the end goes out at once and the ghost is gone, no glide', () => {
    const t = table();
    t.hand.fire('pointerdown', on(t.card, 100, 600));
    t.hand.fire('pointermove', on(t.card, 150, 300));
    expect(t.intents).toEqual([
      { type: 'card/dragStart', cardId: 'AC' },
      { type: 'card/dragOver', over: true },
    ]);
    t.hand.fire('pointerup', on(t.card, 150, 300));
    expect(t.intents.at(-1)).toEqual({ type: 'card/dragEnd' });
    expect(t.ghost.hasClass('landing')).toBe(false);
    expect(t.ghost.removed()).toBe(true);
  });

  test('a card that cannot be cloned drags without a ghost', () => {
    const plain = table(false);
    plain.hand.fire('pointerdown', on(plain.card, 100, 600));
    plain.hand.fire('pointermove', on(plain.card, 150, 300));
    plain.hand.fire('pointerup', on(plain.card, 150, 300));
    expect(plain.intents).toEqual([
      { type: 'card/dragStart', cardId: 'AC' },
      { type: 'card/dragOver', over: true },
      { type: 'card/dragEnd' },
    ]);
    expect(plain.ghost.hasClass('drag-ghost')).toBe(false);
  });
});
