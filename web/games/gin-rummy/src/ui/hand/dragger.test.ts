// The drag's wiring over the page fake (web/shared/edge/page.fake.ts): the pointer events reach
// the reducer as intents in the right order, the ghost gets its place and its landing, and a
// press that never moves stays a tap. Rects are all zero on a fake, so the drop index counts every
// other loose cell; the geometry itself is drag.test.ts's, the real motion e2e/gin-arrange.spec.ts's.
import { afterEach, describe, expect, test, vi } from 'vitest';

import { fakeEl, fakePage, fakeTarget, type FakeEl } from '../../../../../shared/edge/page.fake.ts';
import { LAND_MS, bindDrag, type DragIntent } from './dragger.ts';

type Table = Readonly<{
  hand: FakeEl;
  loose: ReadonlyArray<FakeEl>;
  slots: ReadonlyArray<FakeEl>;
  meldCard: FakeEl;
  meldSlot: FakeEl;
  ghost: FakeEl;
  intents: DragIntent[];
}>;

/** Three loose cards (the first one's cell already marked `dragging`, as the paint marks it) and a meld card. */
const table = (cloneable: boolean): Table => {
  const cardOf = (id: string): FakeEl =>
    fakeEl(`card-${id}`, { classes: ['card'], attrs: { 'data-card': id } });
  const loose = ['7H', '9D', 'KC'].map(cardOf);
  const slots = loose.map((c, i) =>
    fakeEl(`slot-${String(i)}`, {
      classes: ['slot', 'dead', ...(i === 0 ? ['dragging'] : [])],
      children: [c],
    }),
  );
  const meldCard = cardOf('AS');
  const meldSlot = fakeEl('slot-m', { classes: ['slot', 'm0'], children: [meldCard] });
  const ghost = fakeEl('ghost', { classes: ['card', 'selected'] });
  const first = loose[0];
  if (first === undefined) throw new Error('no cards');
  if (cloneable) Object.assign(first.el, { cloneNode: () => ghost.el });
  const hand = fakeEl('hand', {
    queries: {
      ':scope > .slot.dead': slots,
      '.card[data-card="7H"]': [first],
      '.card[data-card="AS"]': [meldCard],
    },
  });
  const page = fakePage([hand]);
  const intents: DragIntent[] = [];
  bindDrag(page.doc, (i) => {
    intents.push(i);
  });
  return { hand, loose, slots, meldCard, meldSlot, ghost, intents };
};

/** A pointer event's init: where it is, on which card in which slot. */
const on = (card: FakeEl, slot: FakeEl, x: number, y: number) => ({
  clientX: x,
  clientY: y,
  pointerId: 1,
  target: fakeTarget({ closest: { '.card': card, '.slot': slot } }),
});

afterEach(() => {
  vi.useRealTimers();
});

describe('bindDrag', () => {
  test('a press that moves less than the threshold is a tap: nothing is dispatched', () => {
    const t = table(true);
    const [card] = t.loose;
    const [slot] = t.slots;
    if (card === undefined || slot === undefined) throw new Error('no card');
    t.hand.fire('pointerdown', on(card, slot, 100, 100));
    t.hand.fire('pointermove', on(card, slot, 104, 103));
    t.hand.fire('pointerup', on(card, slot, 104, 103));
    expect(t.intents).toEqual([]);
    // The session is over: a press on a meld card starts none, a far move dispatches nothing.
    t.hand.fire('pointerdown', on(t.meldCard, t.meldSlot, 100, 100));
    t.hand.fire('pointermove', on(t.meldCard, t.meldSlot, 200, 100));
    t.hand.fire('pointerup', on(t.meldCard, t.meldSlot, 200, 100));
    expect(t.intents).toEqual([]);
  });

  test('past the threshold the drag begins, the drop index goes out once per change, and the release lands the ghost', () => {
    const t = table(true);
    const [card] = t.loose;
    const [slot] = t.slots;
    if (card === undefined || slot === undefined) throw new Error('no card');
    t.hand.fire('pointerdown', on(card, slot, 100, 100));
    t.hand.fire('pointermove', on(card, slot, 120, 100));
    // The two other loose cells precede a pointer at (120, 100) when every rect is zero.
    expect(t.intents).toEqual([
      { type: 'card/release' },
      { type: 'card/dragStart', cardId: '7H' },
      { type: 'card/dragOver', index: 2 },
    ]);
    // The ghost: the card's clone, fixed at its rect (zeros here), the selection lift removed.
    expect(t.ghost.hasClass('drag-ghost')).toBe(true);
    expect(t.ghost.hasClass('selected')).toBe(false);
    expect(t.ghost.style('left')).toBe('0px');
    expect(t.ghost.style('width')).toBe('0px');
    // The same index again: silent.
    t.hand.fire('pointermove', on(card, slot, 130, 100));
    expect(t.intents).toHaveLength(3);
    // Released: the ghost glides to the cell; the card shows once the transition ends.
    t.hand.fire('pointerup', on(card, slot, 130, 100));
    expect(t.ghost.hasClass('landing')).toBe(true);
    expect(t.ghost.style('transform')).toBe('translate(0px, 0px) rotate(0deg)');
    expect(t.intents).toHaveLength(3);
    // A move during the landing changes nothing.
    t.hand.fire('pointermove', on(card, slot, 10, 10));
    expect(t.intents).toHaveLength(3);
    t.ghost.fire('transitionend');
    expect(t.intents.at(-1)).toEqual({ type: 'card/dragEnd' });
    // Once: the fallback timer finds the latch set.
    t.ghost.fire('transitionend');
    expect(t.intents).toHaveLength(4);
  });

  test('a transition that never ends: the fallback timer lands the ghost', () => {
    vi.useFakeTimers();
    const t = table(true);
    const [card] = t.loose;
    const [slot] = t.slots;
    if (card === undefined || slot === undefined) throw new Error('no card');
    t.hand.fire('pointerdown', on(card, slot, 100, 100));
    t.hand.fire('pointermove', on(card, slot, 120, 100));
    t.hand.fire('pointercancel', on(card, slot, 120, 100));
    expect(t.intents.at(-1)).toEqual({ type: 'card/dragOver', index: 2 });
    vi.advanceTimersByTime(LAND_MS + 60);
    expect(t.intents.at(-1)).toEqual({ type: 'card/dragEnd' });
  });

  test('an element that cannot clone has no ghost: the drag still moves the card and ends at once on release', () => {
    const t = table(false);
    const [card] = t.loose;
    const [slot] = t.slots;
    if (card === undefined || slot === undefined) throw new Error('no card');
    t.hand.fire('pointerdown', on(card, slot, 100, 100));
    // A second press while a session stands is ignored.
    t.hand.fire('pointerdown', on(t.loose[1] ?? card, t.slots[1] ?? slot, 300, 100));
    t.hand.fire('pointermove', on(card, slot, 100, 130));
    expect(t.intents).toEqual([
      { type: 'card/release' },
      { type: 'card/dragStart', cardId: '7H' },
      { type: 'card/dragOver', index: 2 },
    ]);
    expect(t.ghost.hasClass('drag-ghost')).toBe(false);
    t.hand.fire('pointerup', on(card, slot, 100, 130));
    expect(t.intents.at(-1)).toEqual({ type: 'card/dragEnd' });
    // The session is over: a new press works as before.
    t.hand.fire('pointerdown', on(card, slot, 100, 100));
    t.hand.fire('pointerup', on(card, slot, 100, 100));
    expect(t.intents).toHaveLength(4);
  });
});
