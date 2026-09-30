// The screen frame's edge (screen.ts; docs/design/screen-frame.md §4 and §6): what the boot reads
// off a page and writes back, over a table of phones the catalogue knows and the two it does not,
// through fakes of the window and the document. The rule itself is web/shared/lib/devices.ts
// (`reachOf`, `cornersOf`, tested there); this file pins the reading: the insets off shell.css's
// `--frame-inset-*`, the mode off `matchMedia` and `fullscreenElement`, the orientation off the
// viewport, the four `--frame-corner-*` written, the watcher's four listeners, and the opt-in.
import { describe, expect, test } from 'vitest';

import { deviceLabel, type Insets } from '../lib/devices.ts';
import {
  FRAME_INSETS,
  applyFrame,
  applyLayout,
  frameCornerProp,
  framed,
  notchOf,
  probeAsked,
  readFrame,
  readInsets,
  readLayout,
  readMode,
  watchFrame,
  watchLayout,
  type ScreenDocumentLike,
  type ScreenWindowLike,
} from './screen.ts';

type Fake = Readonly<{
  doc: ScreenDocumentLike;
  win: ScreenWindowLike;
  /** Every `--property` written on the root, in order. */
  written: (readonly [string, string])[];
  /** Every listener added: `win:<type>`, `vv:<type>`, `doc:<type>`. */
  listeners: string[];
  fire: (name: string) => void;
}>;

type Options = Readonly<{
  screen?: Readonly<{ width: number; height: number }>;
  dpr?: number;
  viewport?: Readonly<{ width: number; height: number }>;
  insets?: Insets;
  /** `matchMedia` answers these `(display-mode: X)` queries true. */
  modes?: ReadonlyArray<string>;
  fullscreen?: boolean;
  /** No `getComputedStyle` at all (a fake page). */
  blind?: boolean;
  /** The body carries `data-frame`. */
  frame?: boolean;
  /** No `visualViewport`, no `addEventListener` (a bare window). */
  bare?: boolean;
  /** No `matchMedia` (the boot test's window). */
  noMedia?: boolean;
  /** `matchMedia` answers these pointer queries true (`(any-pointer: fine)`, `(hover: hover)`); none, a phone. */
  pointer?: ReadonlyArray<string>;
}>;

const fake = (o: Options = {}): Fake => {
  const written: (readonly [string, string])[] = [];
  const listeners: string[] = [];
  const handlers = new Map<string, () => void>();
  const insets = o.insets ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const byProp: Readonly<Record<string, number>> = {
    [FRAME_INSETS.top]: insets.top,
    [FRAME_INSETS.right]: insets.right,
    [FRAME_INSETS.bottom]: insets.bottom,
    [FRAME_INSETS.left]: insets.left,
  };
  const on =
    (scope: string) =>
    (type: string, fn: (e: Readonly<Event>) => void): void => {
      listeners.push(`${scope}:${type}`);
      handlers.set(`${scope}:${type}`, () => {
        fn(new Event(type));
      });
    };
  const attrs = new Map<string, string>(o.frame === true ? [['data-frame', '']] : []);
  const body = {
    hasAttribute: (name: string) => attrs.has(name),
    getAttribute: (name: string) => attrs.get(name) ?? null,
    setAttribute: (name: string, value: string) => {
      attrs.set(name, value);
    },
    removeAttribute: (name: string) => {
      attrs.delete(name);
    },
  } as unknown as HTMLElement;
  const doc: ScreenDocumentLike = {
    documentElement: {
      style: {
        setProperty: (prop: string, value: string) => {
          written.push([prop, value]);
        },
      },
    },
    body,
    getElementById: () => null,
    addEventListener: on('doc'),
    fullscreenElement: o.fullscreen === true ? body : null,
  };
  const win: ScreenWindowLike = {
    ...(o.screen === undefined ? {} : { screen: o.screen }),
    ...(o.dpr === undefined ? {} : { devicePixelRatio: o.dpr }),
    ...(o.viewport === undefined
      ? {}
      : { innerWidth: o.viewport.width, innerHeight: o.viewport.height }),
    ...(o.noMedia === true
      ? {}
      : {
          matchMedia: (query: string) => ({
            matches:
              (o.modes ?? []).some((m) => query === `(display-mode: ${m})`) ||
              (o.pointer ?? []).includes(query),
          }),
        }),
    ...(o.blind === true
      ? {}
      : {
          getComputedStyle: () => ({
            getPropertyValue: (name: string) => (name in byProp ? `${String(byProp[name])}px` : ''),
          }),
        }),
    ...(o.bare === true
      ? {}
      : { addEventListener: on('win'), visualViewport: { addEventListener: on('vv') } }),
  };
  return {
    doc,
    win,
    written,
    listeners,
    fire: (name) => {
      handlers.get(name)?.();
    },
  };
};

const IPHONE_15 = { width: 393, height: 852 };
const corners = (tl: number, tr: number, br: number, bl: number) => ({ tl, tr, br, bl });

describe('the reading', () => {
  test('notchOf: the largest px in a computed value, null for none', () => {
    expect(notchOf('47px')).toBe(47);
    expect(notchOf('max(0px, 59px, 59px)')).toBe(59);
    expect(notchOf('')).toBeNull();
    expect(notchOf(null)).toBeNull();
  });

  test('readInsets: the four off the root, null on a page that cannot say', () => {
    const insets = { top: 59, right: 0, bottom: 34, left: 0 };
    const f = fake({ insets });
    expect(readInsets(f.doc, f.win)).toEqual(insets);
    const blind = fake({ blind: true });
    expect(readInsets(blind.doc, blind.win)).toBeNull();
  });

  test('readMode: fullscreen with an element in fullscreen or under the media query, standalone under its query, else a tab (minimal-ui included)', () => {
    const fs = fake({ fullscreen: true });
    expect(readMode(fs.doc, fs.win)).toBe('fullscreen');
    const manifest = fake({ modes: ['fullscreen'] });
    expect(readMode(manifest.doc, manifest.win)).toBe('fullscreen');
    const installed = fake({ modes: ['standalone'] });
    expect(readMode(installed.doc, installed.win)).toBe('standalone');
    const minimal = fake({ modes: ['minimal-ui'] });
    expect(readMode(minimal.doc, minimal.win)).toBe('browser');
    const noMedia = fake({ noMedia: true });
    expect(readMode(noMedia.doc, noMedia.win)).toBe('browser');
  });

  test('framed: the body opts in with data-frame', () => {
    expect(framed(fake({ frame: true }).doc)).toBe(true);
    expect(framed(fake().doc)).toBe(false);
  });

  test('probeAsked: ?probe=1 anywhere in the query', () => {
    expect(probeAsked('?probe=1')).toBe(true);
    expect(probeAsked('?join=ABCD&probe=1')).toBe(true);
    expect(probeAsked('?probe=10')).toBe(false);
    expect(probeAsked('')).toBe(false);
  });
});

describe('the table (docs/design/screen-frame.md §6)', () => {
  const cases: ReadonlyArray<
    Readonly<{
      name: string;
      o: Options;
      corners: ReturnType<typeof corners>;
      device: string | null;
    }>
  > = [
    {
      name: 'iPhone 15, a Safari tab upright: no side inset, every corner the browser`s',
      o: {
        screen: IPHONE_15,
        dpr: 3,
        viewport: { width: 393, height: 672 },
        insets: { top: 0, right: 0, bottom: 34, left: 0 },
      },
      corners: corners(0, 0, 0, 0),
      device: 'iphone-393x852',
    },
    {
      name: 'iPhone 15, a Safari tab sideways with the bar up: the top pair square, the bottom pair 55',
      o: {
        screen: IPHONE_15,
        dpr: 3,
        viewport: { width: 852, height: 343 },
        insets: { top: 0, right: 59, bottom: 21, left: 59 },
      },
      corners: corners(0, 0, 55, 55),
      device: 'iphone-393x852',
    },
    {
      name: 'iPhone 15, a Safari tab sideways with the bar hidden: the viewport is the screen, all four 55',
      o: {
        screen: IPHONE_15,
        dpr: 3,
        viewport: { width: 852, height: 393 },
        insets: { top: 0, right: 59, bottom: 21, left: 59 },
      },
      corners: corners(55, 55, 55, 55),
      device: 'iphone-393x852',
    },
    {
      name: 'iPhone 15 installed (standalone) upright: all four 55',
      o: {
        screen: IPHONE_15,
        dpr: 3,
        viewport: IPHONE_15,
        insets: { top: 59, right: 0, bottom: 34, left: 0 },
        modes: ['standalone'],
      },
      corners: corners(55, 55, 55, 55),
      device: 'iphone-393x852',
    },
    {
      name: 'a Pixel under the Android lock (an element in fullscreen) sideways: the cutout on the left, all four 32',
      o: {
        screen: { width: 915, height: 412 },
        dpr: 2.625,
        viewport: { width: 915, height: 412 },
        insets: { top: 0, right: 0, bottom: 0, left: 28 },
        fullscreen: true,
      },
      corners: corners(32, 32, 32, 32),
      device: 'android-412x915-pixel',
    },
    {
      name: 'an SE installed: a squared screen, four zeros',
      o: {
        screen: { width: 375, height: 667 },
        dpr: 2,
        viewport: { width: 375, height: 667 },
        modes: ['standalone'],
      },
      corners: corners(0, 0, 0, 0),
      device: 'iphone-375x667-se',
    },
    {
      name: 'a desktop window: no row, no inset, four zeros',
      o: { screen: { width: 1440, height: 900 }, dpr: 2, viewport: { width: 1280, height: 800 } },
      corners: corners(0, 0, 0, 0),
      device: null,
    },
    {
      name: 'a phone the catalogue does not know, installed, with a 40px notch: the notch stands in for the radius',
      o: {
        screen: { width: 400, height: 900 },
        dpr: 3,
        viewport: { width: 400, height: 900 },
        insets: { top: 40, right: 0, bottom: 30, left: 0 },
        modes: ['standalone'],
      },
      corners: corners(40, 40, 40, 40),
      device: null,
    },
  ];

  test.each(cases)('$name', ({ o, corners: want, device }) => {
    const f = fake({ ...o, frame: true });
    const r = readFrame(f.doc, f.win);
    expect(r.corners).toEqual(want);
    // The probe's label agrees with the table.
    expect(deviceLabel(r.inputs)).toBe(device ?? 'unknown (heuristic)');
    expect(applyFrame(f.doc, f.win).corners).toEqual(want);
    expect(f.written).toEqual(
      (['tl', 'tr', 'br', 'bl'] as const).map((k) => [frameCornerProp(k), `${String(want[k])}px`]),
    );
  });

  test('the orientation is the viewport`s where there is one, else the screen`s; the full screen is turned to match', () => {
    const sideways = fake({
      screen: IPHONE_15,
      dpr: 3,
      viewport: { width: 852, height: 343 },
      insets: { top: 0, right: 59, bottom: 21, left: 59 },
    });
    const r = readFrame(sideways.doc, sideways.win);
    expect(r.orientation).toBe('landscape');
    expect(r.full).toEqual({ width: 852, height: 393 });
    expect(r.mode).toBe('browser');
    expect(r.radius).toBe(55);
    const noViewport = fake({ screen: { width: 852, height: 393 }, dpr: 3 });
    expect(readFrame(noViewport.doc, noViewport.win).orientation).toBe('landscape');
    const nothing = fake();
    const bare = readFrame(nothing.doc, nothing.win);
    expect(bare.orientation).toBe('portrait');
    expect(bare.full).toBeNull();
    expect(bare.inputs).toBeNull();
    expect(bare.radius).toBe(0);
  });

  test('without a screen nothing is written (shell.css`s env() fallback stands); a blind page reads no insets and a null notch', () => {
    const nothing = fake({ frame: true });
    applyFrame(nothing.doc, nothing.win);
    expect(nothing.written).toEqual([]);
    const blind = fake({ screen: IPHONE_15, dpr: 3, blind: true, frame: true });
    const r = applyFrame(blind.doc, blind.win);
    expect(r.inputs?.notch).toBeNull();
    expect(r.insets).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(blind.written).toEqual([
      ['--frame-corner-tl', '0px'],
      ['--frame-corner-tr', '0px'],
      ['--frame-corner-br', '0px'],
      ['--frame-corner-bl', '0px'],
    ]);
  });
});

describe('the watcher', () => {
  test('listens on the window`s resize and orientationchange, the visual viewport`s resize and the document`s fullscreenchange, and calls back a frame later; a bare window gets the document`s alone', () => {
    const f = fake({ frame: true });
    const calls: number[] = [];
    const frames: (() => void)[] = [];
    const g = globalThis as { requestAnimationFrame?: (fn: () => void) => number };
    const real = g.requestAnimationFrame;
    g.requestAnimationFrame = (fn) => {
      frames.push(fn);
      return frames.length;
    };
    try {
      watchFrame(f.doc, f.win, () => {
        calls.push(1);
      });
      expect(f.listeners).toEqual([
        'win:resize',
        'win:orientationchange',
        'vv:resize',
        'doc:fullscreenchange',
      ]);
      f.fire('vv:resize');
      expect(calls).toEqual([]);
      frames.forEach((fn) => {
        fn();
      });
      expect(calls).toEqual([1]);
      const bare = fake({ bare: true });
      watchFrame(bare.doc, bare.win, () => {
        calls.push(2);
      });
      expect(bare.listeners).toEqual(['doc:fullscreenchange']);
    } finally {
      if (real === undefined) delete g.requestAnimationFrame;
      else g.requestAnimationFrame = real;
    }
  });
});

describe('the layout bucket (docs/design/layout-buckets.md)', () => {
  test('readLayout: the viewport and the two pointer facts; null without a viewport; a window without matchMedia answers both false', () => {
    const phone = fake({ viewport: { width: 844, height: 390 } });
    expect(readLayout(phone.win)).toEqual({ width: 844, height: 390, fine: false, hover: false });
    const laptop = fake({
      viewport: { width: 1280, height: 800 },
      pointer: ['(any-pointer: fine)', '(hover: hover)'],
    });
    expect(readLayout(laptop.win)).toEqual({ width: 1280, height: 800, fine: true, hover: true });
    const touchLaptop = fake({
      viewport: { width: 1280, height: 800 },
      pointer: ['(hover: hover)'],
    });
    expect(readLayout(touchLaptop.win)?.hover).toBe(true);
    expect(readLayout(fake().win)).toBeNull();
    const noMedia = fake({ viewport: { width: 390, height: 844 }, noMedia: true });
    expect(readLayout(noMedia.win)).toEqual({ width: 390, height: 844, fine: false, hover: false });
  });

  test('applyLayout: the bucket on <body data-layout>, re-read as the viewport changes; nothing written without a viewport', () => {
    const f = fake({ viewport: { width: 844, height: 390 } });
    expect(applyLayout(f.doc, f.win)).toBe('phone-sideways');
    expect(f.doc.body.getAttribute('data-layout')).toBe('phone-sideways');
    const turned = fake({ viewport: { width: 390, height: 844 } });
    expect(applyLayout(turned.doc, turned.win)).toBe('phone-upright');
    const wide = fake({
      viewport: { width: 1920, height: 1080 },
      pointer: ['(any-pointer: fine)', '(hover: hover)'],
    });
    expect(applyLayout(wide.doc, wide.win)).toBe('desktop-wide');
    const bare = fake();
    expect(applyLayout(bare.doc, bare.win)).toBeNull();
    expect(bare.doc.body.hasAttribute('data-layout')).toBe(false);
  });

  test('watchLayout: resize and orientationchange, a frame later; nothing on a bare window', () => {
    const f = fake({ viewport: { width: 844, height: 390 } });
    const calls: number[] = [];
    const frames: (() => void)[] = [];
    const g = globalThis as { requestAnimationFrame?: (fn: () => void) => number };
    const real = g.requestAnimationFrame;
    g.requestAnimationFrame = (fn) => {
      frames.push(fn);
      return frames.length;
    };
    try {
      watchLayout(f.win, () => {
        calls.push(1);
      });
      expect(f.listeners).toEqual(['win:resize', 'win:orientationchange']);
      f.fire('win:orientationchange');
      expect(calls).toEqual([]);
      frames.forEach((fn) => {
        fn();
      });
      expect(calls).toEqual([1]);
      const bare = fake({ bare: true });
      watchLayout(bare.win, () => {
        calls.push(2);
      });
      expect(bare.listeners).toEqual([]);
    } finally {
      if (real === undefined) delete g.requestAnimationFrame;
      else g.requestAnimationFrame = real;
    }
  });
});
