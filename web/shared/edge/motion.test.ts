// The motion kernel over the page fake (page.fake.ts) with a logging style and rect, fake timers
// and a fake matchMedia host (docs/design/dry-round-2.md §6 "Kernels on fakes", row edge/motion.ts):
// glide's four style writes with the layout read between the second and the third, the inline
// transition cleared once by the end event or the fallback; launchClone's clone on the body with
// its classes, its box, its size variable, its delay on both properties, its translate with or
// without the scale, its removal and `onDone` once by the end event or the fallback, and nothing
// at all for a source that cannot clone; reducedMotionOf asking matchMedia once. What the fakes
// cannot show (pixels, the real transition) is the games' e2e specs' business.
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { Rect } from './dom.ts';
import {
  GLIDE_SLACK_MS,
  LAUNCH_SLACK_MS,
  REDUCED_MOTION_QUERY,
  glide,
  launchClone,
  reducedMotion,
  reducedMotionOf,
  type LaunchOptions,
} from './motion.ts';
import { fakeEl, fakePage, type FakeEl } from './page.fake.ts';

const rect = (left: number, top: number, width = 40, height = 40): Rect => ({
  left,
  top,
  width,
  height,
});

/** A fake element whose inline style writes and layout reads land in one ordered log. */
const logged = (el: FakeEl, at: Rect): Readonly<{ el: FakeEl; log: string[] }> => {
  const log: string[] = [];
  Object.assign(el.el, {
    style: {
      setProperty: (name: string, value: string) => {
        log.push(`${name}=${value}`);
      },
    },
    getBoundingClientRect: () => {
      log.push('read');
      return at;
    },
  });
  return { el, log };
};

const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

afterEach(() => {
  vi.useRealTimers();
});

describe('glide', () => {
  test('the inverted translate under no transition, a layout read, the transition on, the transform cleared; the end event clears the inline transition once', () => {
    const card = logged(fakeEl('card'), rect(0, 80));
    glide(card.el.el, rect(200, 0), rect(0, 80), { ms: 200, ease: EASE });
    expect(card.log).toEqual([
      'transition=none',
      'transform=translate(200px, -80px)',
      'read',
      `transition=transform 200ms ${EASE}`,
      'transform=',
    ]);
    card.el.fire('transitionend');
    expect(card.log.at(-1)).toBe('transition=');
    card.el.fire('transitionend');
    expect(card.log).toHaveLength(6);
    // The translate is written as given, unrounded (gin's flip wrote it so).
    const fine = logged(fakeEl('fine'), rect(0, 0));
    glide(fine.el.el, rect(0.125, 0), rect(0, 0.3), { ms: 150, ease: 'linear' });
    expect(fine.log[1]).toBe('transform=translate(0.125px, -0.3px)');
    expect(fine.log[3]).toBe('transition=transform 150ms linear');
  });

  test('a transition that never ends: the fallback clears the inline transition after ms + GLIDE_SLACK_MS, and a late end event does nothing more', () => {
    vi.useFakeTimers();
    const card = logged(fakeEl('card'), rect(0, 0));
    glide(card.el.el, rect(10, 0), rect(0, 0), { ms: 200, ease: EASE });
    vi.advanceTimersByTime(200 + GLIDE_SLACK_MS - 1);
    expect(card.log).toHaveLength(5);
    vi.advanceTimersByTime(1);
    expect(card.log).toHaveLength(6);
    expect(card.log.at(-1)).toBe('transition=');
    card.el.fire('transitionend');
    expect(card.log).toHaveLength(6);
  });
});

type Table = Readonly<{
  page: ReturnType<typeof fakePage>;
  source: FakeEl;
  clone: FakeEl;
  log: string[];
  appended: unknown[];
  done: ReturnType<typeof vi.fn>;
  options: LaunchOptions;
}>;

/** A source that clones into `clone`; the body records what is appended to it. */
const table = (cloneable = true, options: Partial<LaunchOptions> = {}): Table => {
  const clone = fakeEl('clone', { classes: ['checker', 'ck-light', 'top', 'arriving'] });
  const { log } = logged(clone, rect(0, 0));
  const source = fakeEl('src', { classes: ['checker', 'ck-light', 'top'] });
  if (cloneable) Object.assign(source.el, { cloneNode: () => clone.el });
  const page = fakePage([source]);
  const appended: unknown[] = [];
  Object.assign(page.body.el, {
    appendChild: (node: unknown) => {
      appended.push(node);
    },
  });
  const done = vi.fn();
  return {
    page,
    source,
    clone,
    log,
    appended,
    done,
    options: {
      classes: ['flyer'],
      strip: ['top', 'arriving'],
      sizeVar: '--checker-d',
      ms: 200,
      delay: 0,
      scale: true,
      onDone: done,
      ...options,
    },
  };
};

describe('launchClone', () => {
  test('the clone goes on the body wearing its classes and not the stripped ones, fixed over `from` in hundredths, laid out, then sent by translate and scale; the end event removes it and calls onDone once', () => {
    const t = table();
    const clone = launchClone(
      t.page.doc,
      t.source.el,
      rect(100.004, 200.125, 40, 40),
      rect(300, 600, 7, 26),
      t.options,
    );
    expect(clone).toBe(t.clone.el);
    expect(t.appended).toEqual([t.clone.el]);
    expect(t.clone.classes()).toEqual(['checker', 'ck-light', 'flyer']);
    expect(t.log).toEqual([
      '--checker-d=40px',
      'left=100px',
      'top=200.13px',
      'width=40px',
      'height=40px',
      'transform=none',
      'read',
      'transform=translate(200px, 399.88px) scale(0.175, 0.65)',
    ]);
    expect(t.clone.removed()).toBe(false);
    expect(t.done).not.toHaveBeenCalled();
    t.clone.fire('transitionend');
    expect(t.clone.removed()).toBe(true);
    expect(t.done).toHaveBeenCalledTimes(1);
    t.clone.fire('transitionend');
    expect(t.done).toHaveBeenCalledTimes(1);
  });

  test('a delay is written to transition-delay and animation-delay both; without `scale` the transform is the translate alone; the fallback removes the clone after ms + delay + LAUNCH_SLACK_MS', () => {
    vi.useFakeTimers();
    const t = table(true, { delay: 60, scale: false, classes: ['flyer', 'flyer-slab'] });
    launchClone(t.page.doc, t.source.el, rect(100, 200), rect(300, 600, 7, 26), t.options);
    expect(t.clone.hasClass('flyer-slab')).toBe(true);
    expect(t.log.slice(5)).toEqual([
      'transform=none',
      'transition-delay=60ms',
      'animation-delay=60ms',
      'read',
      'transform=translate(200px, 400px)',
    ]);
    vi.advanceTimersByTime(200 + 60 + LAUNCH_SLACK_MS - 1);
    expect(t.clone.removed()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(t.clone.removed()).toBe(true);
    expect(t.done).toHaveBeenCalledTimes(1);
    // The late end event finds the latch set.
    t.clone.fire('transitionend');
    expect(t.done).toHaveBeenCalledTimes(1);
  });

  test('a turned source starts rotated by its degrees and rights itself with the translate and the scale', () => {
    const t = table(true, { turn: 90 });
    launchClone(t.page.doc, t.source.el, rect(100, 200), rect(300, 600, 7, 26), t.options);
    expect(t.log.slice(5)).toEqual([
      'transform=rotate(90deg)',
      'read',
      'transform=translate(200px, 400px) scale(0.175, 0.65) rotate(0)',
    ]);
  });

  test('a source of no size scales by 1 rather than dividing by zero; a source that cannot clone launches nothing', () => {
    const flat = table();
    launchClone(flat.page.doc, flat.source.el, rect(100, 200, 0, 0), rect(300, 600), flat.options);
    expect(flat.log.at(-1)).toBe('transform=translate(200px, 400px) scale(1, 1)');
    const plain = table(false);
    expect(
      launchClone(plain.page.doc, plain.source.el, rect(100, 200), rect(300, 600), plain.options),
    ).toBeNull();
    expect(plain.appended).toEqual([]);
    expect(plain.log).toEqual([]);
    expect(plain.done).not.toHaveBeenCalled();
  });
});

describe('reducedMotionOf', () => {
  test('asks matchMedia for the reduce query once and remembers the answer; a host without matchMedia never reduces', () => {
    const asked: string[] = [];
    const reduce = reducedMotionOf({
      matchMedia: (query) => {
        asked.push(query);
        return { matches: true };
      },
    });
    expect(reduce()).toBe(true);
    expect(reduce()).toBe(true);
    expect(asked).toEqual([REDUCED_MOTION_QUERY]);
    const full = reducedMotionOf({ matchMedia: () => ({ matches: false }) });
    expect(full()).toBe(false);
    expect(reducedMotionOf({})()).toBe(false);
    // The module's own reader is over globalThis, which has no matchMedia in node.
    expect(reducedMotion()).toBe(false);
  });
});
