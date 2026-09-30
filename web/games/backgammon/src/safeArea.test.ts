// The safe-area map on the board's root (safeArea.ts): the type off `screen.orientation` (or the
// frame's orientation as the primary), the catalogue's cut for a matched screen, and one write of
// `safeAreaVars` plus the three attributes on a faked root.
import { describe, expect, test } from 'vitest';

import { deviceById } from '../../../shared/lib/devices.ts';
import { applySafeArea, mapInputsOf, orientationTypeOf, watchSafeArea } from './safeArea.ts';

const noop = (): void => undefined;

/** A root with a style map and attributes, as the writer touches it. */
const fakeRoot = () => {
  const styles = new Map<string, string>();
  const attrs = new Map<string, string>();
  return {
    styles,
    attrs,
    el: {
      style: {
        setProperty: (k: string, v: string) => {
          styles.set(k, v);
        },
      },
      setAttribute: (k: string, v: string) => {
        attrs.set(k, v);
      },
      removeAttribute: (k: string) => {
        attrs.delete(k);
      },
      hasAttribute: (k: string) => attrs.has(k),
      getAttribute: (k: string) => attrs.get(k) ?? null,
    },
  };
};

/** An iPhone 15 sideways in a Safari tab with the bar hidden: 852x393, 59px side insets, a 21px home indicator. */
const iphone15 = (
  type: string | undefined,
  insets = { top: 0, right: 59, bottom: 21, left: 59 },
) => {
  const root = fakeRoot();
  const listeners: (() => void)[] = [];
  const body = { hasAttribute: () => false } as unknown as Readonly<HTMLElement>;
  const doc = {
    documentElement: root.el,
    body,
    addEventListener: noop,
    removeEventListener: noop,
    querySelector: () => null,
    getElementById: () => null,
  } as unknown as Parameters<typeof applySafeArea>[0];
  const win = {
    screen: {
      width: 393,
      height: 852,
      orientation: {
        ...(type === undefined ? {} : { type }),
        addEventListener: (_: 'change', fn: () => void) => {
          listeners.push(fn);
        },
      },
    },
    devicePixelRatio: 3,
    innerWidth: 852,
    innerHeight: 393,
    matchMedia: () => ({ matches: false }),
    getComputedStyle: () => ({
      getPropertyValue: (name: string) => {
        const key = name.replace('--frame-inset-', '') as keyof typeof insets;
        return name.startsWith('--frame-inset-') ? `${String(insets[key])}px` : '';
      },
    }),
    addEventListener: noop,
  } as unknown as Parameters<typeof applySafeArea>[1];
  return { root, doc, win, listeners };
};

describe('the orientation type', () => {
  test('the screen`s where it is one of the four; null without one or with a stranger', () => {
    expect(orientationTypeOf({ screen: { orientation: { type: 'landscape-secondary' } } })).toBe(
      'landscape-secondary',
    );
    expect(orientationTypeOf({ screen: { orientation: { type: 'sideways' } } })).toBeNull();
    expect(orientationTypeOf({ screen: {} })).toBeNull();
    expect(orientationTypeOf({})).toBeNull();
  });
});

describe('the inputs', () => {
  const reading = {
    inputs: { screen: { width: 393, height: 852 }, dpr: 3, notch: 59 },
    insets: { top: 0, right: 59, bottom: 21, left: 59 },
    mode: 'browser' as const,
    orientation: 'landscape' as const,
    viewport: { width: 852, height: 393 },
    full: { width: 852, height: 393 },
    radius: 55,
    reach: { tl: true, tr: true, br: true, bl: true },
    corners: { tl: 55, tr: 55, br: 55, bl: 55 },
  };
  test('a matched screen carries its cut; the type is the screen`s, else the primary of the frame`s orientation', () => {
    const cut = deviceById('iphone-393x852')?.cut ?? null;
    expect(cut).not.toBeNull();
    expect(mapInputsOf(reading, 'landscape-secondary')).toEqual({
      corners: reading.corners,
      cut,
      type: 'landscape-secondary',
      insets: reading.insets,
      viewport: reading.viewport,
      full: reading.full,
    });
    expect(mapInputsOf(reading, null).type).toBe('landscape-primary');
    expect(mapInputsOf({ ...reading, orientation: 'portrait' }, null).type).toBe(
      'portrait-primary',
    );
  });
  test('an unknown screen (or none) has no cut, and a window without a viewport reads 0x0', () => {
    expect(mapInputsOf({ ...reading, inputs: null, viewport: null }, null)).toMatchObject({
      cut: null,
      viewport: { width: 0, height: 0 },
    });
    expect(
      mapInputsOf(
        { ...reading, inputs: { screen: { width: 1, height: 2 }, dpr: 1, notch: 0 } },
        null,
      ).cut,
    ).toBeNull();
  });
});

describe('the write', () => {
  test('landscape-primary: the cut on the left, the right side free, the vars and the three attributes on the root', () => {
    const { root, doc, win } = iphone15('landscape-primary');
    const map = applySafeArea(doc, win);
    expect(map.cutEdge).toBe('left');
    expect(root.attrs.get('data-notch-side')).toBe('left');
    expect(root.attrs.get('data-free-side')).toBe('right');
    expect(root.attrs.get('data-ears')).toBe('2');
    expect(root.styles.get('--safe-free-side')).toBe('right');
    // The right edge between its two 55px arcs (plus 4px each): 59 to 334 of 393.
    expect(root.styles.get('--safe-free-from')).toBe('59px');
    expect(root.styles.get('--safe-free-to')).toBe('334px');
  });
  test('landscape-secondary: the mirror; no type reads as the primary', () => {
    const turned = iphone15('landscape-secondary');
    expect(applySafeArea(turned.doc, turned.win).cutEdge).toBe('right');
    expect(turned.root.attrs.get('data-free-side')).toBe('left');
    const bare = iphone15(undefined);
    expect(applySafeArea(bare.doc, bare.win).cutEdge).toBe('left');
  });
  test('watchSafeArea writes once and again on the orientation`s change', () => {
    const { root, doc, win, listeners } = iphone15('landscape-primary');
    watchSafeArea(doc, win);
    expect(root.attrs.get('data-free-side')).toBe('right');
    expect(listeners).toHaveLength(1);
    root.attrs.clear();
    listeners[0]?.();
    expect(root.attrs.get('data-free-side')).toBe('right');
  });
  test('a document without a root gets the vars nowhere and no attributes, and does not throw', () => {
    const { doc, win } = iphone15('landscape-primary');
    const bare = { ...doc, documentElement: undefined } as unknown as typeof doc;
    expect(() => applySafeArea(bare, win)).not.toThrow();
  });
});
