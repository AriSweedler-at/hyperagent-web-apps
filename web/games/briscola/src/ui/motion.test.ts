// The settle beat's plans and its one DOM step (docs/design/briscola.md §5.3, §5.4): the durations
// and their reduced-motion twins, the trick's cards to the newest chip of the winner's strip
// together (the chip hidden until they land), the draws
// winner-first `DRAW_GAP_MS` apart with the briscola last and turned, the reducer's timeline; and,
// over the page fake, the shared kernel's clone (web/shared/edge/motion.ts `launchClone`) fixed
// where the card stood and sent to the arrival's centre at the scale that fits, the briscola
// starting across and righting itself, the arrival hidden until the clone lands or the fallback
// fires, nothing flying where nothing can be measured or cloned.
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { Rect } from '../../../../shared/edge/dom.ts';
import { fakeEl, fakePage, type FakeEl } from '../../../../shared/edge/page.fake.ts';
import type { Played, Seat } from '../engine/index.ts';
import {
  BRISCOLA,
  DURATIONS,
  MAX_LIVE_FLYERS,
  MY_TRICKS,
  REDUCED_DURATIONS,
  STOCK,
  drawFlights,
  durationsFor,
  fanCard,
  fanTilt,
  flyCards,
  handCard,
  newPlays,
  playFlight,
  drawsAfter,
  drawsBefore,
  myDrawFlight,
  seatCards,
  seatTaken,
  settleTimeline,
  totalMs,
  trickFlights,
  unrotatedBox,
  type Flight,
  clashGeometry,
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
    expect(DURATIONS).toEqual({
      holdMs: 900,
      flyMs: 320,
      drawMs: 260,
      drawGapMs: 160,
      flipMs: 220,
    });
    expect(REDUCED_DURATIONS).toEqual({
      holdMs: 300,
      flyMs: 1,
      drawMs: 1,
      drawGapMs: 1,
      flipMs: 1,
    });
    expect(durationsFor('normal', false)).toBe(DURATIONS);
    expect(durationsFor('normal', true)).toBe(REDUCED_DURATIONS);
    expect(durationsFor('off', false)).toBe(REDUCED_DURATIONS);
    expect(durationsFor('quick', true)).toBe(REDUCED_DURATIONS);
    expect(durationsFor('quick', false)).toEqual({
      holdMs: 540,
      flyMs: 200,
      drawMs: 160,
      drawGapMs: 100,
      flipMs: 140,
    });
  });
});

describe('the plans', () => {
  const cellOf = (seat: number) => (seat === 0 ? handCard('3S') : seatCards('R2'));

  test('targets by id and selector', () => {
    expect(STOCK).toEqual({ id: 'stock', within: '.card' });
    expect(BRISCOLA).toEqual({ id: 'briscola', within: '.card' });
    expect(MY_TRICKS).toEqual({ id: 'myTricks', within: '.chip:last-child' });
    expect(fanCard(2)).toEqual({ id: 'trick', within: '.card[data-seat="2"]' });
    expect(handCard('AC')).toEqual({ id: 'hand', within: '.card[data-card="AC"]' });
    expect(seatCards('R1')).toEqual({ id: 'seatR1', within: '.seat-cards .card:last-child' });
    expect(seatTaken('R3')).toEqual({ id: 'seatR3', within: '.seat-taken .chip:last-child' });
  });

  test('the trick: every fan card to the newest chip of the winner, together, over FLY_MS, the chip hidden till they land', () => {
    const cards = [
      { seat: 1 as const, card: { id: 'AC', r: 1 as const, s: 'C' as const } },
      { seat: 0 as const, card: { id: '2B', r: 2 as const, s: 'B' as const } },
    ];
    expect(trickFlights({ cards }, seatTaken('R2'), DURATIONS)).toEqual([
      { from: fanCard(1), to: seatTaken('R2'), ms: 320, delayMs: 0, hideArrival: true },
      { from: fanCard(0), to: seatTaken('R2'), ms: 320, delayMs: 0, hideArrival: true },
    ]);
    expect(trickFlights({ cards }, MY_TRICKS, DURATIONS).map((f) => f.to)).toEqual([
      MY_TRICKS,
      MY_TRICKS,
    ]);
    expect(trickFlights({ cards: [] }, MY_TRICKS, DURATIONS)).toEqual([]);
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

  test('the draws round my tap (docs/design/briscola-battle.md §3.1): a range slices the order with its first flight leaving at once; the seats before me, the seats after me; my own from the stock, or the briscola when I took it last', () => {
    const four = { drew: [2, 3, 0, 1] as const, trumpTaken: true };
    // Me = seat 0: seats 2 and 3 draw before my tap, seat 1 after; the last (seat 1) took the briscola.
    expect(drawsBefore(four.drew, 0)).toEqual({ start: 0, end: 2 });
    expect(drawsAfter(four.drew, 0)).toEqual({ start: 3, end: 4 });
    expect(drawFlights(four, cellOf, DURATIONS, drawsBefore(four.drew, 0))).toEqual([
      { from: STOCK, to: seatCards('R2'), ms: 260, delayMs: 0, hideArrival: true },
      { from: STOCK, to: seatCards('R2'), ms: 260, delayMs: 160, hideArrival: true },
    ]);
    expect(drawFlights(four, cellOf, DURATIONS, drawsAfter(four.drew, 0))).toEqual([
      {
        from: BRISCOLA,
        to: seatCards('R2'),
        ms: 260,
        delayMs: 0,
        rotated: true,
        hideArrival: true,
      },
    ]);
    expect(myDrawFlight(four, 0, handCard('3S'), DURATIONS)).toEqual({
      from: STOCK,
      to: handCard('3S'),
      ms: 260,
      delayMs: 0,
      hideArrival: true,
    });
    // Me = seat 1, the last drawer, the briscola taken: mine comes turned from the briscola; nobody after.
    expect(myDrawFlight(four, 1, handCard('3S'), DURATIONS)).toEqual({
      from: BRISCOLA,
      to: handCard('3S'),
      ms: 260,
      delayMs: 0,
      rotated: true,
      hideArrival: true,
    });
    expect(drawsAfter(four.drew, 1)).toEqual({ start: 4, end: 4 });
    expect(drawFlights(four, cellOf, DURATIONS, drawsAfter(four.drew, 1))).toEqual([]);
    // Not drawing (a seat not at the table): every seat before, none after, no flight of mine.
    expect(drawsBefore([1, 0], 2)).toEqual({ start: 0, end: 2 });
    expect(drawsAfter([1, 0], 2)).toEqual({ start: 2, end: 2 });
    expect(
      myDrawFlight({ drew: [1, 0], trumpTaken: false }, 2, handCard('3S'), DURATIONS),
    ).toBeNull();
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

/** A fan card in `#trick` and the newest chip of `#seatR2`'s taken strip; a stock back and a hand card for the draws. */
const table = (o: Options = {}) => {
  const clone = fakeEl('clone', { classes: ['card', 'face', 'mid', 'taking'] });
  const source = piece(
    'src',
    ['card', 'face', 'mid', 'taking'],
    o.fromAt ?? rect(100, 200, 69, 133),
    o.cloneable === false ? null : clone,
  );
  const landed = piece('dst', ['card', 'back', 'chip'], o.toAt ?? rect(300, 600, 40, 20), null);
  const trick = fakeEl('trick', {
    queries: { '.card[data-seat="1"]': [source], '.card': [source] },
  });
  const seat = fakeEl('seatR2', {
    queries: { '.seat-taken .chip:last-child': o.noTarget === true ? [] : [landed] },
  });
  const page = fakePage([trick, seat]);
  const flight: Flight = { from: fanCard(1), to: seatTaken('R2'), ms: 320, delayMs: 0 };
  return { page, clone, source, landed, flight };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('the play and follow flights (docs/design/briscola-battle.md §3.1, PR-D)', () => {
  const played = (seat: Seat, id: string): Played => ({ seat, card: { id, r: 1, s: 'C' } });
  const at = rect(10, 500, 69, 133);

  test('fanTilt is theme.css`s rotate: the fan leans out from its middle, 4° a card', () => {
    expect(fanTilt(0, 1)).toBe(0);
    expect([fanTilt(0, 2), fanTilt(1, 2)]).toEqual([-2, 2]);
    expect([fanTilt(0, 4), fanTilt(3, 4)]).toEqual([-6, 6]);
  });

  test('unrotatedBox undoes the tilt`s growth of the bounding rect, and leaves a box alone at 0° or when the sums do not close', () => {
    const box = rect(100, 200, 60, 100);
    expect(unrotatedBox(box, 0)).toEqual(box);
    // A 60 × 100 card at 6°: bounding 60cos + 100sin by 100cos + 60sin; undone to the hundredth.
    const t = (6 * Math.PI) / 180;
    const bounding = rect(
      100,
      200,
      60 * Math.cos(t) + 100 * Math.sin(t),
      100 * Math.cos(t) + 60 * Math.sin(t),
    );
    const back = unrotatedBox(bounding, -6);
    expect(back.width).toBeCloseTo(60, 6);
    expect(back.height).toBeCloseTo(100, 6);
    expect(back.left + back.width / 2).toBeCloseTo(bounding.left + bounding.width / 2, 6);
    expect(back.top + back.height / 2).toBeCloseTo(bounding.top + bounding.height / 2, 6);
    // 45°: the equations degenerate; a flat rect at a steep turn would go negative: both return the rect.
    expect(unrotatedBox(box, 45)).toEqual(box);
    expect(unrotatedBox(rect(0, 0, 1, 100), 40)).toEqual(rect(0, 0, 1, 100));
  });

  test('playFlight: the first card at PLAY`s pace, a follower at FOLLOW`s, the completing card fastest, each to its fan place at its tilt; the speed and a stagger apply', () => {
    const first = playFlight(played(0, 'AC'), at, 0, 1, false, 'normal', false);
    expect(first).toEqual({
      from: fanCard(0),
      to: fanCard(0),
      ms: 320,
      delayMs: 0,
      hideArrival: true,
      fromRect: at,
      endTurn: 0,
    });
    expect(playFlight(played(1, '3C'), at, 1, 3, false, 'normal', false).ms).toBe(240);
    const last = playFlight(played(1, '3C'), at, 1, 2, true, 'normal', false);
    expect([last.ms, last.endTurn]).toEqual([200, 2]);
    expect(playFlight(played(1, '3C'), at, 1, 2, true, 'quick', false).ms).toBe(120);
    expect(playFlight(played(1, '3C'), at, 1, 2, true, 'normal', true).ms).toBe(1);
    expect(playFlight(played(1, '3C'), at, 1, 2, false, 'normal', false, 2).delayMs).toBe(200);
  });

  test('newPlays: the cards the fan gains, in play order; nothing for the same fan or a fan that only shrank', () => {
    const a = played(0, 'AC');
    const b = played(1, '3C');
    expect(newPlays([], [a])).toEqual([a]);
    expect(newPlays([a], [a, b])).toEqual([b]);
    expect(newPlays([], [a, b])).toEqual([a, b]);
    expect(newPlays([a, b], [a, b])).toEqual([]);
    expect(newPlays([a, b], [])).toEqual([]);
  });
});

describe('flyCards', () => {
  test('a play: the arrival`s own clone leaves from the box measured before the repaint, lands turned at the fan`s tilt, and the card stays hidden (`data-flying`) until it does', () => {
    const t = table({ toAt: rect(300, 600, 69, 133) });
    // The target is the fan card itself; it clones (the source has gone with the repaint).
    Object.assign(t.landed.el, { cloneNode: () => t.clone.el });
    const flight: Flight = {
      from: fanCard(1),
      to: seatTaken('R2'),
      ms: 200,
      delayMs: 0,
      hideArrival: true,
      fromRect: rect(100, 200, 69, 133),
      endTurn: 2,
    };
    expect(flyCards(t.page.doc, [flight])).toBe(1);
    expect(t.landed.hasClass('arriving')).toBe(true);
    expect(t.landed.attr('data-flying')).toBe('');
    expect(t.clone.style('left')).toBe('100px');
    expect(t.clone.style('--fly-ms')).toBe('200ms');
    expect(t.clone.style('transform')).toMatch(
      /^translate\(200px, 400px\) scale\(0\.9\d\d?, 0\.9\d\d?\) rotate\(2deg\)$/,
    );
    t.clone.fire('transitionend');
    expect(t.landed.hasClass('arriving')).toBe(false);
    expect(t.landed.attr('data-flying')).toBeNull();
    // A measured box of no size flies nothing: the repaint alone placed the card.
    expect(flyCards(t.page.doc, [{ ...flight, fromRect: ZERO }])).toBe(0);
  });

  test('a card flies from where it stood to the arrival centre at the scale that fits, then the clone goes', () => {
    const t = table();
    expect(flyCards(t.page.doc, [t.flight])).toBe(1);
    expect(t.clone.hasClass('flyer')).toBe(true);
    expect(t.clone.hasClass('taking')).toBe(false);
    expect(t.landed.hasClass('arriving')).toBe(false);
    // The trick's flights hide the chip they land on until they do.
    const chip = table();
    flyCards(
      chip.page.doc,
      trickFlights(
        { cards: [{ seat: 1, card: { id: 'AC', r: 1, s: 'C' } }] },
        seatTaken('R2'),
        DURATIONS,
      ),
    );
    expect(chip.landed.hasClass('arriving')).toBe(true);
    chip.clone.fire('transitionend');
    expect(chip.landed.hasClass('arriving')).toBe(false);
    expect([
      t.clone.style('left'),
      t.clone.style('top'),
      t.clone.style('width'),
      t.clone.style('height'),
    ]).toEqual(['100px', '200px', '69px', '133px']);
    expect(t.clone.style('--card-w')).toBe('69px');
    expect(t.clone.style('--fly-ms')).toBe('320ms');
    expect(t.clone.style('transition-delay')).toBeNull();
    // Centres: (134.5, 266.5) to (320, 610); the 40 × 20 stack fits the card at 20 / 133.
    expect(t.clone.style('transform')).toBe('translate(185.5px, 343.5px) scale(0.15, 0.15)');
    expect(t.clone.removed()).toBe(false);
    t.clone.fire('transitionend');
    expect(t.clone.removed()).toBe(true);
  });

  test('a draw: the arrival hides until the clone lands; a later flight waits its delay on the glide and the lift', () => {
    const t = table();
    const draw: Flight = { ...t.flight, ms: 260, delayMs: 160, hideArrival: true };
    expect(flyCards(t.page.doc, [draw])).toBe(1);
    expect(t.landed.hasClass('arriving')).toBe(true);
    expect(t.clone.style('--fly-ms')).toBe('260ms');
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
    // Centres: (166.5, 234.5) to (320, 610); the clone started at rotate(90deg) (the kernel's own test).
    expect(t.clone.style('transform')).toBe(
      'translate(153.5px, 375.5px) scale(0.15, 0.15) rotate(0)',
    );
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
    expect(flyCards(missing.page.doc, [{ ...missing.flight, to: MY_TRICKS }])).toBe(0);
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
    expect(tiny.clone.style('transform')).toContain('scale(0.05, 0.05)');
    const grown = table({ toAt: rect(300, 600, 138, 266) });
    flyCards(grown.page.doc, [grown.flight]);
    expect(grown.clone.style('transform')).toContain('scale(2, 2)');
  });
});

describe('the clash geometry (docs/design/briscola-battle.md §3.1 CHARGE, STRIKE)', () => {
  const box = (left: number, top: number, width = 40, height = 60): Rect => ({
    left,
    top,
    width,
    height,
  });

  test('side by side: the axis runs left to right, the contact point between the centres', () => {
    const g = clashGeometry(box(0, 0), box(60, 0));
    expect(g.ux).toBeCloseTo(1);
    expect(g.uy).toBeCloseTo(0);
    expect(g.gap).toBeCloseTo(60);
    expect(g.cx).toBeCloseTo(50);
    expect(g.cy).toBeCloseTo(30);
  });

  test('one above the other, and a diagonal pair: a unit axis in that direction', () => {
    const down = clashGeometry(box(0, 0), box(0, 100));
    expect(down.ux).toBeCloseTo(0);
    expect(down.uy).toBeCloseTo(1);
    expect(down.gap).toBeCloseTo(100);
    const diag = clashGeometry(box(0, 0), box(30, 30));
    expect(Math.hypot(diag.ux, diag.uy)).toBeCloseTo(1);
    expect(diag.ux).toBeCloseTo(diag.uy);
  });

  test('two boxes on one spot (a fake, a hidden tab) read as side by side with no gap', () => {
    const g = clashGeometry(box(10, 10), box(10, 10));
    expect(g).toEqual({ ux: 1, uy: 0, gap: 0, cx: 30, cy: 40 });
  });
});
