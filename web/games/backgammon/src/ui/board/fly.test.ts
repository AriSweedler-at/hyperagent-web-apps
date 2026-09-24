// Flights over the page fake (web/shared/edge/page.fake.ts): the departure is measured before
// the repaint and the arrival after it, the clone is fixed where the checker stood and sent to
// the arrival's rect (scaled into a slab for a bear-off), the arrival hides under `arriving`
// until the transition ends or the fallback timer fires, a hit blot waits before it leaves, and
// nothing that cannot be measured or cloned flies: the repaint alone places it.
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { Rect } from '../../../../../shared/edge/dom.ts';
import { fakeEl, fakePage, type FakeEl } from '../../../../../shared/edge/page.fake.ts';
import type { Flight } from '../board.ts';
import { FLY_MS, HIT_DELAY_MS, flyMoves } from './fly.ts';

const rect = (left: number, top: number, width = 40, height = 40): Rect => ({
  left,
  top,
  width,
  height,
});
const ZERO = rect(0, 0, 0, 0);

/** A checker or slab that reports `at` and, unless told not to, clones into `clone`. */
const piece = (
  id: string,
  classes: ReadonlyArray<string>,
  at: Rect,
  clone: FakeEl | null,
): FakeEl => {
  const el = fakeEl(id, { classes });
  Object.assign(el.el, {
    getBoundingClientRect: () => at,
    ...(clone === null ? {} : { cloneNode: () => clone.el }),
  });
  return el;
};

type Options = Readonly<{
  fromAt?: Rect;
  toAt?: Rect;
  slab?: boolean;
  cloneable?: boolean;
  empty?: boolean;
  /** The destination's top coin is there before the repaint too (a stack already five tall). */
  persisted?: boolean;
  /** That coin already wore a count badge before the repaint (six or more). */
  badged?: boolean;
  /** The repaint puts a count badge on the top coin (five became six). */
  badgeOnLanding?: boolean;
}>;

/**
 * Two containers: before the repaint the source holds the departing checker; after it the
 * destination holds the arrival (a checker, or a slab for a bear-off) and the source is empty.
 */
const table = (o: Options = {}) => {
  const clone = fakeEl('clone', { classes: ['checker', 'ck-light', 'top'] });
  const source = piece(
    'src',
    ['checker', 'ck-light', 'top'],
    o.fromAt ?? rect(100, 200),
    o.cloneable === false ? null : clone,
  );
  const landed = piece(
    'dst',
    o.slab === true ? ['slab'] : ['checker', 'ck-light', 'top'],
    o.toAt ?? rect(300, 600),
    null,
  );
  if (o.badged === true) landed.el.setAttribute('data-count', '6');
  const shown = { painted: false };
  const from = fakeEl('point-8', {
    queries: {
      '.checker.top': () => (shown.painted || o.empty === true ? [] : [source]),
      '.slab': [],
    },
  });
  const to = fakeEl(o.slab === true ? 'offLight' : 'point-5', {
    queries: {
      '.checker.top': () =>
        (shown.painted || o.persisted === true) && o.slab !== true ? [landed] : [],
      '.slab': () => (shown.painted && o.slab === true ? [landed] : []),
    },
  });
  const page = fakePage([from, to]);
  const repaint = vi.fn(() => {
    shown.painted = true;
    if (o.badgeOnLanding === true)
      landed.el.setAttribute('data-count', o.badged === true ? '7' : '6');
  });
  const flight: Flight =
    o.slab === true
      ? { fromContainer: 'point-8', toContainer: 'offLight', slab: true }
      : { fromContainer: 'point-8', toContainer: 'point-5' };
  return { page, clone, source, landed, repaint, flight };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('flyMoves', () => {
  test('a checker flies from where it stood to where the repaint put it, then the clone goes', () => {
    const t = table();
    flyMoves(t.page.doc, [t.flight], t.repaint);
    expect(t.repaint).toHaveBeenCalledTimes(1);
    expect(t.landed.hasClass('arriving')).toBe(true);
    expect(t.clone.hasClass('flyer')).toBe(true);
    expect(t.clone.hasClass('flyer-slab')).toBe(false);
    expect(t.clone.hasClass('top')).toBe(false);
    expect([
      t.clone.style('left'),
      t.clone.style('top'),
      t.clone.style('width'),
      t.clone.style('height'),
    ]).toEqual(['100px', '200px', '40px', '40px']);
    expect(t.clone.style('--checker-d')).toBe('40px');
    expect(t.clone.style('transform')).toBe('translate(200px, 400px) scale(1, 1)');
    expect(t.clone.style('transition-delay')).toBeNull();
    expect(t.clone.removed()).toBe(false);
    t.clone.fire('transitionend');
    expect(t.clone.removed()).toBe(true);
    expect(t.landed.hasClass('arriving')).toBe(false);
  });

  test('a stack already five tall keeps its top coin: it is not hidden, and a badge the landing brings waits under `landing`', () => {
    // Five became six: the fifth coin stayed through the repaint and gained the badge.
    const grown = table({ persisted: true, badgeOnLanding: true });
    flyMoves(grown.page.doc, [grown.flight], grown.repaint);
    expect(grown.landed.hasClass('arriving')).toBe(false);
    expect(grown.landed.hasClass('landing')).toBe(true);
    expect(grown.clone.style('transform')).toBe('translate(200px, 400px) scale(1, 1)');
    grown.clone.fire('transitionend');
    expect(grown.landed.hasClass('landing')).toBe(false);
    expect(grown.clone.removed()).toBe(true);
    // Six became seven: the badge was there and only its number changed; nothing hides.
    const taller = table({ persisted: true, badged: true, badgeOnLanding: true });
    flyMoves(taller.page.doc, [taller.flight], taller.repaint);
    expect(taller.landed.hasClass('arriving')).toBe(false);
    expect(taller.landed.hasClass('landing')).toBe(false);
    expect(taller.clone.hasClass('flyer')).toBe(true);
  });

  test('a bear-off lands on the newest slab, scaled to its shape', () => {
    const t = table({ slab: true, toAt: rect(300, 600, 7, 26) });
    flyMoves(t.page.doc, [t.flight], t.repaint);
    expect(t.landed.hasClass('arriving')).toBe(true);
    expect(t.clone.hasClass('flyer-slab')).toBe(true);
    expect(t.clone.style('transform')).toBe('translate(200px, 400px) scale(0.175, 0.65)');
  });

  test('a hit blot waits before it leaves; the fallback timer covers the wait', () => {
    vi.useFakeTimers();
    const t = table();
    flyMoves(t.page.doc, [{ ...t.flight, hit: true }], t.repaint);
    expect(t.clone.style('transition-delay')).toBe(`${String(HIT_DELAY_MS)}ms`);
    vi.advanceTimersByTime(FLY_MS + 60);
    expect(t.clone.removed()).toBe(false);
    vi.advanceTimersByTime(HIT_DELAY_MS);
    expect(t.clone.removed()).toBe(true);
    expect(t.landed.hasClass('arriving')).toBe(false);
  });

  test('a transition that never ends: the fallback timer clears the flight once', () => {
    vi.useFakeTimers();
    const t = table();
    flyMoves(t.page.doc, [t.flight], t.repaint);
    vi.advanceTimersByTime(FLY_MS + 60);
    expect(t.clone.removed()).toBe(true);
    expect(t.landed.hasClass('arriving')).toBe(false);
    // The late transitionend finds the latch set: nothing more happens.
    t.landed.el.classList.add('arriving');
    t.clone.fire('transitionend');
    expect(t.landed.hasClass('arriving')).toBe(true);
  });

  test('nothing measurable, nothing to clone, nothing to depart or arrive: the repaint alone', () => {
    const zero = table({ fromAt: ZERO });
    flyMoves(zero.page.doc, [zero.flight], zero.repaint);
    expect(zero.repaint).toHaveBeenCalledTimes(1);
    expect(zero.landed.hasClass('arriving')).toBe(false);
    expect(zero.clone.style('left')).toBeNull();
    const unlanded = table({ toAt: ZERO });
    flyMoves(unlanded.page.doc, [unlanded.flight], unlanded.repaint);
    expect(unlanded.landed.hasClass('arriving')).toBe(false);
    expect(unlanded.clone.style('left')).toBeNull();
    const uncloneable = table({ cloneable: false });
    flyMoves(uncloneable.page.doc, [uncloneable.flight], uncloneable.repaint);
    expect(uncloneable.repaint).toHaveBeenCalledTimes(1);
    expect(uncloneable.landed.hasClass('arriving')).toBe(false);
    const empty = table({ empty: true });
    flyMoves(empty.page.doc, [empty.flight], empty.repaint);
    expect(empty.repaint).toHaveBeenCalledTimes(1);
    expect(empty.landed.hasClass('arriving')).toBe(false);
    const noFlights = table();
    flyMoves(noFlights.page.doc, [], noFlights.repaint);
    expect(noFlights.repaint).toHaveBeenCalledTimes(1);
  });
});
