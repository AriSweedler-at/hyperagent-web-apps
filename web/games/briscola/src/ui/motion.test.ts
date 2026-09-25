// The settle beat's plans and its one DOM step (docs/design/briscola.md §5.3, §5.4): the durations
// and their reduced-motion twins, the trick's cards to the winner's cell together, the draws
// winner-first `DRAW_GAP_MS` apart with the briscola last and turned, the reducer's timeline; and,
// over the page fake, a clone fixed where the card stood and sent to the arrival's centre at the
// scale that fits, the briscola starting across and righting itself, the arrival hidden until the
// clone lands or the fallback fires, nothing flying where nothing can be measured or cloned.
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { Rect } from '../../../../shared/edge/dom.ts';
import { fakeEl, fakePage, type FakeEl } from '../../../../shared/edge/page.fake.ts';
import {
  BRISCOLA,
  DURATIONS,
  MAX_LIVE_FLYERS,
  MY_TAKEN,
  REDUCED_DURATIONS,
  REDUCED_MOTION_QUERY,
  STOCK,
  drawFlights,
  durationsFor,
  fanCard,
  flyCards,
  handCard,
  prefersReducedMotion,
  seatCards,
  seatTaken,
  settleTimeline,
  totalMs,
  trickFlights,
  type Flight,
} from './motion.ts';

const rect = (left: number, top: number, width: number, height: number): Rect => ({
  left,
  top,
  width,
  height,
});
const ZERO = rect(0, 0, 0, 0);

describe('durations', () => {
  test('the design figures, and 1 ms glides with a 300 ms hold under reduced motion', () => {
    expect(DURATIONS).toEqual({ holdMs: 900, flyMs: 320, drawMs: 260, drawGapMs: 160 });
    expect(REDUCED_DURATIONS).toEqual({ holdMs: 300, flyMs: 1, drawMs: 1, drawGapMs: 1 });
    expect(durationsFor(false)).toBe(DURATIONS);
    expect(durationsFor(true)).toBe(REDUCED_DURATIONS);
  });

  test('the preference is read through matchMedia; a window without it prefers motion', () => {
    expect(prefersReducedMotion({})).toBe(false);
    expect(
      prefersReducedMotion({ matchMedia: (q) => ({ matches: q === REDUCED_MOTION_QUERY }) }),
    ).toBe(true);
    expect(prefersReducedMotion({ matchMedia: () => ({ matches: false }) })).toBe(false);
  });
});

describe('the plans', () => {
  const cellOf = (seat: number) => (seat === 0 ? handCard('3S') : seatCards('R2'));

  test('targets by id and selector', () => {
    expect(STOCK).toEqual({ id: 'stock', within: '.card' });
    expect(BRISCOLA).toEqual({ id: 'briscola', within: '.card' });
    expect(MY_TAKEN).toEqual({ id: 'myTaken' });
    expect(fanCard(2)).toEqual({ id: 'trick', within: '.card[data-seat="2"]' });
    expect(handCard('AC')).toEqual({ id: 'hand', within: '.card[data-card="AC"]' });
    expect(seatCards('R1')).toEqual({ id: 'seatR1', within: '.seat-cards .card:last-child' });
    expect(seatTaken('R3')).toEqual({ id: 'seatR3', within: '.seat-taken' });
  });

  test('the trick: every fan card to the winner, together, over FLY_MS', () => {
    const cards = [
      { seat: 1 as const, card: { id: 'AC', r: 1 as const, s: 'C' as const } },
      { seat: 0 as const, card: { id: '2B', r: 2 as const, s: 'B' as const } },
    ];
    expect(trickFlights({ cards }, seatTaken('R2'), DURATIONS)).toEqual([
      { from: fanCard(1), to: seatTaken('R2'), ms: 320, delayMs: 0 },
      { from: fanCard(0), to: seatTaken('R2'), ms: 320, delayMs: 0 },
    ]);
    expect(trickFlights({ cards: [] }, MY_TAKEN, DURATIONS)).toEqual([]);
  });

  test('the draws: winner first, DRAW_GAP_MS apart, arrivals hidden; the briscola last and turned when taken', () => {
    expect(drawFlights({ drew: [1, 0], trumpTaken: false }, cellOf, DURATIONS)).toEqual([
      { from: STOCK, to: seatCards('R2'), ms: 260, delayMs: 0, hideArrival: true },
      { from: STOCK, to: handCard('3S'), ms: 260, delayMs: 160, hideArrival: true },
    ]);
    expect(drawFlights({ drew: [1, 0], trumpTaken: true }, cellOf, DURATIONS)).toEqual([
      { from: STOCK, to: seatCards('R2'), ms: 260, delayMs: 0, hideArrival: true },
      {
        from: BRISCOLA,
        to: handCard('3S'),
        ms: 260,
        delayMs: 160,
        rotated: true,
        hideArrival: true,
      },
    ]);
    expect(drawFlights({ drew: [], trumpTaken: false }, cellOf, DURATIONS)).toEqual([]);
    expect(
      drawFlights({ drew: [0, 1, 2, 3], trumpTaken: true }, cellOf, REDUCED_DURATIONS).map(
        (f) => f.delayMs,
      ),
    ).toEqual([0, 1, 2, 3]);
  });

  test('totalMs and the timeline the reducer arms', () => {
    const draws = drawFlights({ drew: [1, 0, 2], trumpTaken: false }, cellOf, DURATIONS);
    expect(totalMs(draws)).toBe(2 * 160 + 260);
    expect(totalMs([])).toBe(0);
    expect(settleTimeline({ drew: [1, 0, 2] }, DURATIONS)).toEqual({
      holdMs: 900,
      flyMs: 320,
      drawMs: 580,
    });
    expect(settleTimeline({ drew: [1, 0] }, DURATIONS)).toEqual({
      holdMs: 900,
      flyMs: 320,
      drawMs: 420,
    });
    expect(settleTimeline({ drew: [] }, DURATIONS)).toEqual({ holdMs: 900, flyMs: 320, drawMs: 0 });
    expect(settleTimeline({ drew: [1, 0] }, REDUCED_DURATIONS)).toEqual({
      holdMs: 300,
      flyMs: 1,
      drawMs: 2,
    });
    expect(settleTimeline({ drew: [1, 0] }, DURATIONS).drawMs).toBe(
      totalMs(drawFlights({ drew: [1, 0], trumpTaken: true }, cellOf, DURATIONS)),
    );
  });
});

/** A card that reports `at` and, unless told not to, clones into `clone`. */
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

type Options = Readonly<{ fromAt?: Rect; toAt?: Rect; cloneable?: boolean; noTarget?: boolean }>;

/** A fan card in `#trick` and the taken stack of `#seatR2`; a stock back and a hand card for the draws. */
const table = (o: Options = {}) => {
  const clone = fakeEl('clone', { classes: ['card', 'face', 'mid', 'taking'] });
  const source = piece(
    'src',
    ['card', 'face', 'mid', 'taking'],
    o.fromAt ?? rect(100, 200, 69, 133),
    o.cloneable === false ? null : clone,
  );
  const landed = piece('dst', ['seat-taken'], o.toAt ?? rect(300, 600, 40, 20), null);
  const trick = fakeEl('trick', {
    queries: { '.card[data-seat="1"]': [source], '.card': [source] },
  });
  const seat = fakeEl('seatR2', {
    queries: { '.seat-taken': o.noTarget === true ? [] : [landed] },
  });
  const page = fakePage([trick, seat]);
  const flight: Flight = { from: fanCard(1), to: seatTaken('R2'), ms: 320, delayMs: 0 };
  return { page, clone, source, landed, flight };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('flyCards', () => {
  test('a card flies from where it stood to the arrival centre at the scale that fits, then the clone goes', () => {
    const t = table();
    expect(flyCards(t.page.doc, [t.flight])).toBe(1);
    expect(t.clone.hasClass('flyer')).toBe(true);
    expect(t.clone.hasClass('taking')).toBe(false);
    expect(t.landed.hasClass('arriving')).toBe(false);
    expect([
      t.clone.style('left'),
      t.clone.style('top'),
      t.clone.style('width'),
      t.clone.style('height'),
    ]).toEqual(['100px', '200px', '69px', '133px']);
    expect(t.clone.style('--card-w')).toBe('69px');
    expect(t.clone.style('transform-origin')).toBe('50% 50%');
    expect(t.clone.style('transition-duration')).toBe('320ms');
    expect(t.clone.style('transition-delay')).toBeNull();
    // Centres: (134.5, 266.5) to (320, 610); the 40 × 20 stack fits the card at 20 / 133.
    expect(t.clone.style('transform')).toBe('translate(185.5px, 343.5px) rotate(0) scale(0.15)');
    expect(t.clone.removed()).toBe(false);
    t.clone.fire('transitionend');
    expect(t.clone.removed()).toBe(true);
  });

  test('a draw: the arrival hides until the clone lands; a later flight waits its delay on the glide and the lift', () => {
    const t = table();
    const draw: Flight = { ...t.flight, ms: 260, delayMs: 160, hideArrival: true };
    expect(flyCards(t.page.doc, [draw])).toBe(1);
    expect(t.landed.hasClass('arriving')).toBe(true);
    expect(t.clone.style('transition-duration')).toBe('260ms');
    expect(t.clone.style('transition-delay')).toBe('160ms');
    expect(t.clone.style('animation-delay')).toBe('160ms');
    t.clone.fire('transitionend');
    expect(t.landed.hasClass('arriving')).toBe(false);
    expect(t.clone.removed()).toBe(true);
  });

  test('the briscola lies across: its box is the bounding rect swapped, it starts turned and rights itself', () => {
    const t = table({ fromAt: rect(100, 200, 133, 69) });
    flyCards(t.page.doc, [{ ...t.flight, rotated: true }]);
    expect([
      t.clone.style('left'),
      t.clone.style('top'),
      t.clone.style('width'),
      t.clone.style('height'),
    ]).toEqual(['132px', '168px', '69px', '133px']);
    expect(t.clone.style('--card-w')).toBe('69px');
    // Centres: (166.5, 234.5) to (320, 610).
    expect(t.clone.style('transform')).toBe('translate(153.5px, 375.5px) rotate(0) scale(0.15)');
  });

  test('a transition that never ends: the fallback timer clears the flight once, after ms + delay + slack', () => {
    vi.useFakeTimers();
    const t = table();
    flyCards(t.page.doc, [{ ...t.flight, delayMs: 100, hideArrival: true }]);
    vi.advanceTimersByTime(320 + 100 + 59);
    expect(t.clone.removed()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(t.clone.removed()).toBe(true);
    expect(t.landed.hasClass('arriving')).toBe(false);
    // The late transitionend finds the latch set: nothing more happens.
    t.landed.el.classList.add('arriving');
    t.clone.fire('transitionend');
    expect(t.landed.hasClass('arriving')).toBe(true);
  });

  test('nothing measurable, no arrival, nothing to clone, no flights: the repaint alone placed the cards', () => {
    expect(flyCards(table().page.doc, [])).toBe(0);
    const zero = table({ fromAt: ZERO });
    expect(flyCards(zero.page.doc, [{ ...zero.flight, hideArrival: true }])).toBe(0);
    expect(zero.landed.hasClass('arriving')).toBe(false);
    expect(zero.clone.style('left')).toBeNull();
    const unlanded = table({ toAt: ZERO });
    expect(flyCards(unlanded.page.doc, [unlanded.flight])).toBe(0);
    const gone = table({ noTarget: true });
    expect(flyCards(gone.page.doc, [gone.flight])).toBe(0);
    const uncloneable = table({ cloneable: false });
    expect(flyCards(uncloneable.page.doc, [{ ...uncloneable.flight, hideArrival: true }])).toBe(0);
    expect(uncloneable.landed.hasClass('arriving')).toBe(false);
    const missing = table();
    expect(flyCards(missing.page.doc, [{ ...missing.flight, to: MY_TAKEN }])).toBe(0);
  });

  test('a burst: more clones in the air than MAX_LIVE_FLYERS are culled before the next launch; at the cap none', () => {
    const stale = Array.from({ length: MAX_LIVE_FLYERS + 1 }, (_, i) =>
      fakeEl(`stale${String(i)}`, { classes: ['card', 'flyer'] }),
    );
    const t = table();
    Object.assign(t.page.body.el, { querySelectorAll: () => stale.map((s) => s.el) });
    expect(flyCards(t.page.doc, [t.flight])).toBe(1);
    expect(stale.every((s) => s.removed())).toBe(true);
    const few = table();
    const some = Array.from({ length: MAX_LIVE_FLYERS }, (_, i) =>
      fakeEl(`live${String(i)}`, { classes: ['card', 'flyer'] }),
    );
    Object.assign(few.page.body.el, { querySelectorAll: () => some.map((s) => s.el) });
    flyCards(few.page.doc, [few.flight]);
    expect(some.some((s) => s.removed())).toBe(false);
  });
});

describe('the landing scale', () => {
  test('a clone never shrinks below the floor on a tiny arrival, and grows onto a larger one', () => {
    const tiny = table({ toAt: rect(300, 600, 1, 1) });
    flyCards(tiny.page.doc, [tiny.flight]);
    expect(tiny.clone.style('transform')).toContain('scale(0.05)');
    const grown = table({ toAt: rect(300, 600, 138, 266) });
    flyCards(grown.page.doc, [grown.flight]);
    expect(grown.clone.style('transform')).toContain('scale(2)');
  });
});
