// The drag kernel over the page fake (page.fake.ts) with fake rects, a queued requestAnimationFrame
// and fake timers (docs/design/dry-round-2.md §6 "Kernels on fakes", row edge/drag.ts): the
// intents in order, the ghost's making, the target changes, the two motions, the landing glide
// with its transitionend and its fallback, and the cancel. The pure gesture (the threshold, the
// hit-test) is web/shared/lib/drag.test.ts's. What the fakes cannot show (pixels, real capture,
// the real transition) is the games' e2e specs' business.
import { afterEach, describe, expect, test, vi } from 'vitest';

import { closestFrom } from './dom.ts';
import {
  DIRECT,
  DRAG_THRESHOLD,
  FALLBACK_MS,
  LAND_MS,
  bindDrag,
  inside,
  type Motion,
  type Mover,
  type Point,
  type Rect,
} from './drag.ts';
import { fakeEl, fakePage, fakeTarget, type FakeEl } from './page.fake.ts';

type Intent =
  | Readonly<{ type: 'start'; key: string }>
  | Readonly<{ type: 'over'; over: string | null; prev: string | null }>
  | Readonly<{ type: 'end'; over: string | null }>;

const rect = (left: number, top: number, width: number, height: number): Rect => ({
  left,
  top,
  width,
  height,
});
const measured = (el: FakeEl, r: Rect): FakeEl => {
  Object.assign(el.el, { getBoundingClientRect: () => r });
  return el;
};

type Options = Readonly<{
  cloneable?: boolean;
  /** What `source` finds after the start intents; 'pressed' is the default (the element pressed). */
  source?: 'pressed' | 'missing';
  /** Where the ghost glides to on release over nothing; null ends at once. */
  land?: Rect | null;
  motion?: Motion;
  releaseThrows?: boolean;
}>;

type Table = Readonly<{
  a: FakeEl;
  b: FakeEl;
  coin: FakeEl;
  ghost: FakeEl;
  intents: Intent[];
  captured: ReadonlyArray<readonly [string, number]>;
  released: ReadonlyArray<readonly [string, number]>;
  frames: (() => void)[];
  /** `targetAt` calls, the session's `over` at each. */
  asked: ReadonlyArray<string | null>;
}>;

/** Two surfaces; the coin (40px at 100,200) on `a`; two targets, X at 300..400 x 300..400 and Y at 500..600 x 300..400. */
const table = (options: Options = {}): Table => {
  const ghost = fakeEl('ghost', { classes: ['coin', 'top', 'selected'] });
  const coin = measured(fakeEl('coin', { classes: ['coin', 'top'] }), rect(100, 200, 40, 40));
  if (options.cloneable ?? true) Object.assign(coin.el, { cloneNode: () => ghost.el });
  const captured: (readonly [string, number])[] = [];
  const released: (readonly [string, number])[] = [];
  const surface = (id: string): FakeEl => {
    const el = fakeEl(id);
    Object.assign(el.el, {
      setPointerCapture: (n: number) => captured.push([id, n]),
      releasePointerCapture: (n: number) => {
        released.push([id, n]);
        if (options.releaseThrows ?? false) throw new Error('not captured');
      },
    });
    return el;
  };
  const a = surface('a');
  const b = surface('b');
  const targets: ReadonlyArray<readonly [string, Rect]> = [
    ['X', rect(300, 300, 100, 100)],
    ['Y', rect(500, 300, 100, 100)],
  ];
  const page = fakePage([a, b]);
  const intents: Intent[] = [];
  const frames: (() => void)[] = [];
  const asked: (string | null)[] = [];
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => frames.push(cb));
  bindDrag<string, string, Intent>(
    page.doc,
    (i) => {
      intents.push(i);
    },
    {
      surfaces: [a.el, b.el],
      pick: (e, s) => {
        const el = closestFrom(e, '.coin');
        return el === null ? null : { key: `${s.id}:${el.id}`, el };
      },
      ...(options.source === 'missing' ? { source: () => null } : {}),
      targetAt: (p, s) => {
        asked.push(s.over);
        return targets.find(([, r]) => inside(r, p))?.[0] ?? null;
      },
      onStart: (s) => [
        { type: 'start', key: s.key },
        { type: 'start', key: `${s.key} again` },
      ],
      onOver: (s, prev) => [{ type: 'over', over: s.over, prev }],
      onEnd: (s) => [{ type: 'end', over: s.over }],
      land: (s) => (s.over !== null ? null : options.land === undefined ? s.base : options.land),
      ...(options.motion === undefined ? {} : { motion: options.motion }),
      ghost: { sizeVar: '--coin-d', strip: ['top', 'selected'] },
    },
  );
  return { a, b, coin, ghost, intents, captured, released, frames, asked };
};

const on = (coin: FakeEl | null, x: number, y: number, pointerId = 1) => ({
  clientX: x,
  clientY: y,
  pointerId,
  target: fakeTarget({ closest: coin === null ? {} : { '.coin': coin } }),
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('bindDrag', () => {
  test('under the threshold a press is a tap: no intent, no ghost, and the session is over on release', () => {
    const t = table();
    t.a.fire('pointerdown', on(t.coin, 100, 100));
    t.a.fire('pointermove', on(t.coin, 104, 103));
    t.a.fire('pointerup', on(t.coin, 104, 103));
    expect(t.intents).toEqual([]);
    expect(t.ghost.hasClass('drag-ghost')).toBe(false);
    // Over: a far move without a press does nothing; a press on nothing draggable starts none.
    t.a.fire('pointermove', on(t.coin, 300, 300));
    t.a.fire('pointerdown', on(null, 100, 100));
    t.a.fire('pointermove', on(null, 300, 300));
    expect(t.intents).toEqual([]);
    expect(t.captured).toEqual([]);
  });

  test('past the threshold: the start intents once, in order, then the ghost is made on the source rect, stripped, sized by its variable, and the surface pressed holds the pointer', () => {
    const t = table();
    t.b.fire('pointerdown', on(t.coin, 100, 100, 7));
    // A second press while a session stands is ignored.
    t.a.fire('pointerdown', on(t.coin, 500, 500, 8));
    t.b.fire('pointermove', on(t.coin, 100 + DRAG_THRESHOLD, 100, 7));
    expect(t.intents).toEqual([
      { type: 'start', key: 'b:coin' },
      { type: 'start', key: 'b:coin again' },
    ]);
    expect(t.ghost.hasClass('drag-ghost')).toBe(true);
    expect(t.ghost.hasClass('top')).toBe(false);
    expect(t.ghost.hasClass('selected')).toBe(false);
    expect(t.ghost.hasClass('coin')).toBe(true);
    expect(
      ['--coin-d', 'left', 'top', 'width', 'height'].map((prop) => t.ghost.style(prop)),
    ).toEqual(['40px', '100px', '200px', '40px', '40px']);
    expect(t.captured).toEqual([['b', 7]]);
    // The target was asked with the fresh session (`over` null), and nothing was over: no intent.
    expect(t.asked).toEqual([null]);
    expect(t.intents).toHaveLength(2);
  });

  test('the default motion writes the translate from where the drag began with every move, no frames', () => {
    const t = table();
    t.a.fire('pointerdown', on(t.coin, 100, 100));
    t.a.fire('pointermove', on(t.coin, 108, 100));
    expect(t.ghost.style('transform')).toBe('translate(0px, 0px)');
    t.a.fire('pointermove', on(t.coin, 120.5, 90.126));
    expect(t.ghost.style('transform')).toBe('translate(12.5px, -9.87px)');
    expect(t.frames).toEqual([]);
    expect(DIRECT.perFrame).toBe(false);
  });

  test('a per-frame motion: the pointer moves the target, each frame follows it and writes the transform, the loop re-arms until the landing', () => {
    const log: string[] = [];
    /** Halfway to the target each step; the transform is the plain offset. */
    const halfway = (m: Point): Mover => ({
      transform: (origin) => `t(${String(m.x - origin.x)},${String(m.y - origin.y)})`,
      step: (target) => {
        log.push(`step ${String(m.x)}->${String(target.x)}`);
        return halfway({ x: (m.x + target.x) / 2, y: (m.y + target.y) / 2 });
      },
    });
    const motion: Motion = {
      at: (p) => {
        log.push(`at ${String(p.x)},${String(p.y)}`);
        return halfway(p);
      },
      perFrame: true,
    };
    const t = table({ motion });
    t.a.fire('pointerdown', on(t.coin, 100, 100));
    t.a.fire('pointermove', on(t.coin, 108, 100));
    // At rest at the press, then at the grab; one frame armed; nothing written yet.
    expect(log).toEqual(['at 100,100', 'at 108,100']);
    expect(t.frames).toHaveLength(1);
    expect(t.ghost.style('transform')).toBeNull();
    t.a.fire('pointermove', on(t.coin, 208, 100));
    expect(t.ghost.style('transform')).toBeNull();
    t.frames[0]?.();
    expect(log.at(-1)).toBe('step 108->208');
    expect(t.ghost.style('transform')).toBe('t(50,0)');
    expect(t.frames).toHaveLength(2);
    t.frames[1]?.();
    expect(t.ghost.style('transform')).toBe('t(75,0)');
    // Released over nothing: the landing transform is the motion at rest at the cell; the next
    // frame finds the landing and stops the loop.
    t.a.fire('pointerup', on(t.coin, 208, 100));
    expect(t.ghost.style('transform')).toBe('t(0,0)');
    const armed = t.frames.length;
    t.frames[armed - 1]?.();
    expect(t.frames).toHaveLength(armed);
  });

  test('the target under the pointer: `onOver` with the previous one only when it changes; released over a target the end is at once', () => {
    const t = table();
    t.a.fire('pointerdown', on(t.coin, 100, 100));
    t.a.fire('pointermove', on(t.coin, 350, 350));
    expect(t.intents.slice(2)).toEqual([{ type: 'over', over: 'X', prev: null }]);
    t.a.fire('pointermove', on(t.coin, 360, 360));
    expect(t.intents).toHaveLength(3);
    t.a.fire('pointermove', on(t.coin, 550, 350));
    expect(t.intents.at(-1)).toEqual({ type: 'over', over: 'Y', prev: 'X' });
    t.a.fire('pointermove', on(t.coin, 10, 10));
    expect(t.intents.at(-1)).toEqual({ type: 'over', over: null, prev: 'Y' });
    t.a.fire('pointermove', on(t.coin, 550, 350));
    t.a.fire('pointerup', on(t.coin, 550, 350));
    expect(t.intents.at(-1)).toEqual({ type: 'end', over: 'Y' });
    expect(t.ghost.hasClass('landing')).toBe(false);
    expect(t.ghost.removed()).toBe(true);
    expect(t.released).toEqual([['a', 1]]);
  });

  test('released over nothing: the ghost glides to the landing rect, moves and presses are ignored meanwhile, and the end follows the transition once', () => {
    const t = table({ land: rect(160, 230, 40, 40) });
    t.a.fire('pointerdown', on(t.coin, 100, 100));
    t.a.fire('pointermove', on(t.coin, 200, 100));
    t.a.fire('pointerup', on(t.coin, 200, 100));
    expect(t.ghost.hasClass('landing')).toBe(true);
    // From the ghost's base (100, 200) to the cell (160, 230).
    expect(t.ghost.style('transform')).toBe('translate(60px, 30px)');
    expect(t.intents).toHaveLength(2);
    t.a.fire('pointermove', on(t.coin, 350, 350));
    t.a.fire('pointerdown', on(t.coin, 350, 350, 2));
    t.a.fire('pointermove', on(t.coin, 550, 350, 2));
    expect(t.intents).toHaveLength(2);
    t.ghost.fire('transitionend');
    expect(t.intents.at(-1)).toEqual({ type: 'end', over: null });
    expect(t.ghost.removed()).toBe(true);
    t.ghost.fire('transitionend');
    expect(t.intents).toHaveLength(3);
    // The session is over: a new press starts afresh.
    t.a.fire('pointerdown', on(t.coin, 100, 100));
    t.a.fire('pointermove', on(t.coin, 200, 100));
    expect(t.intents.at(-1)).toEqual({ type: 'start', key: 'a:coin again' });
  });

  test('a transition that never ends: the fallback lands it after LAND_MS + FALLBACK_MS; a cancel is a release with the over it had', () => {
    vi.useFakeTimers();
    const t = table();
    t.a.fire('pointerdown', on(t.coin, 100, 100));
    t.a.fire('pointermove', on(t.coin, 200, 100));
    t.a.fire('pointercancel', on(t.coin, 200, 100));
    expect(t.ghost.hasClass('landing')).toBe(true);
    expect(t.ghost.style('transform')).toBe('translate(0px, 0px)');
    vi.advanceTimersByTime(LAND_MS + FALLBACK_MS - 1);
    expect(t.intents).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(t.intents.at(-1)).toEqual({ type: 'end', over: null });
    expect(t.ghost.removed()).toBe(true);
  });

  test('no source after the start, or one that cannot clone: the drag goes on without a ghost or a capture and ends at once; a release that throws is swallowed', () => {
    const missing = table({ source: 'missing', releaseThrows: true });
    missing.a.fire('pointerdown', on(missing.coin, 100, 100));
    missing.a.fire('pointermove', on(missing.coin, 350, 350));
    expect(missing.intents).toHaveLength(3);
    expect(missing.ghost.hasClass('drag-ghost')).toBe(false);
    expect(missing.captured).toEqual([]);
    missing.a.fire('pointerup', on(missing.coin, 350, 350));
    expect(missing.intents.at(-1)).toEqual({ type: 'end', over: 'X' });
    expect(missing.released).toEqual([['a', 1]]);
    const plain = table({ cloneable: false });
    plain.a.fire('pointerdown', on(plain.coin, 100, 100));
    plain.a.fire('pointermove', on(plain.coin, 200, 100));
    plain.a.fire('pointerup', on(plain.coin, 200, 100));
    expect(plain.intents.map((i) => i.type)).toEqual(['start', 'start', 'end']);
    expect(plain.captured).toEqual([]);
  });
});
