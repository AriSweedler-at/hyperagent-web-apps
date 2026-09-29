// The safe-area map (docs/design/ui-sandbox.md §3): the cut's edge from the orientation type and the
// insets, the ears on an island phone and their absence on an old-notch one, a browser bar shifting
// the cut and squaring the arcs, the top edge under Safari's chrome upright, the half-turn mirror,
// the custom properties and the box test the emulator's check uses.
import { describe, expect, test } from 'vitest';

import type { Corners, Insets } from './devices.ts';
import {
  ARC_MARGIN,
  CUT_MARGIN,
  EAR_MIN,
  EDGES,
  ORIENTATION_TYPES,
  cutEdgeOf,
  flipMap,
  insideSegments,
  isOrientationType,
  lengthOf,
  safeAreaMap,
  safeAreaVars,
  type SafeAreaInputs,
} from './safeArea.ts';

const all = (r: number): Corners => ({ tl: r, tr: r, br: r, bl: r });
const SIDEWAYS: Insets = { top: 0, right: 59, bottom: 21, left: 59 };
const ISLAND = { length: 126, island: true } as const;
const NOTCH = { length: 209, island: false } as const;
/** The iPhone 15 sideways, installed: 852x393, every corner 55. */
const island15: SafeAreaInputs = {
  corners: all(55),
  cut: ISLAND,
  type: 'landscape-primary',
  insets: SIDEWAYS,
  viewport: { width: 852, height: 393 },
  full: { width: 852, height: 393 },
};

describe('cutEdgeOf', () => {
  test('no cut: none; upright the top (secondary the bottom); sideways the one inset side, else primary left and secondary right', () => {
    expect(cutEdgeOf({ ...island15, cut: null })).toBe('none');
    expect(cutEdgeOf({ ...island15, type: 'portrait-primary' })).toBe('top');
    expect(cutEdgeOf({ ...island15, type: 'portrait-secondary' })).toBe('bottom');
    expect(cutEdgeOf(island15)).toBe('left');
    expect(cutEdgeOf({ ...island15, type: 'landscape-secondary' })).toBe('right');
    const pixel: Insets = { top: 0, right: 0, bottom: 0, left: 28 };
    expect(cutEdgeOf({ ...island15, type: 'landscape-secondary', insets: pixel })).toBe('left');
    expect(
      cutEdgeOf({
        ...island15,
        insets: { ...pixel, left: 0, right: 28 },
        type: 'landscape-primary',
      }),
    ).toBe('right');
  });
});

describe('safeAreaMap', () => {
  test('an island phone sideways, installed: the cut centred on the left, two ears of 68.5px, the right side one span between the arcs, the long edges the same', () => {
    const m = safeAreaMap(island15);
    expect(m.cutEdge).toBe('left');
    expect(m.island).toBe(true);
    expect(m.cut).toEqual({ from: 196.5 - 63, to: 196.5 + 63 });
    const from = 55 + ARC_MARGIN;
    expect(m.edges.left).toEqual([
      { from, to: 196.5 - 63 - CUT_MARGIN },
      { from: 196.5 + 63 + CUT_MARGIN, to: 393 - from },
    ]);
    expect(m.ear).toBeCloseTo(68.5);
    expect(m.edges.right).toEqual([{ from, to: 393 - from }]);
    expect(m.edges.top).toEqual([{ from, to: 852 - from }]);
    expect(m.edges.bottom).toEqual([{ from, to: 852 - from }]);
  });

  test('landscape-secondary puts the cut on the right and frees the left', () => {
    const m = safeAreaMap({ ...island15, type: 'landscape-secondary' });
    expect(m.cutEdge).toBe('right');
    expect(m.edges.right).toHaveLength(2);
    expect(m.edges.left).toHaveLength(1);
  });

  test('Safari sideways with the bar up: the top corners square (no arc spared), the cut shifted up by the bar, the far ear the same as installed', () => {
    const m = safeAreaMap({
      ...island15,
      corners: { tl: 0, tr: 0, br: 55, bl: 55 },
      viewport: { width: 852, height: 343 },
    });
    const centre = 196.5 - 50;
    expect(m.cut).toEqual({ from: centre - 63, to: centre + 63 });
    expect(m.edges.left).toEqual([
      { from: 0, to: centre - 63 - CUT_MARGIN },
      { from: centre + 63 + CUT_MARGIN, to: 343 - 59 },
    ]);
    expect(m.edges.top).toEqual([{ from: 0, to: 852 }]);
    expect(m.ear).toBeCloseTo(68.5);
  });

  test('an old-notch phone sideways: the ears are 33px, under a tap target, so the notch side has no span and ear is 0', () => {
    const m = safeAreaMap({
      ...island15,
      corners: all(47.33),
      cut: NOTCH,
      insets: { top: 0, right: 47, bottom: 21, left: 47 },
      viewport: { width: 844, height: 390 },
      full: { width: 844, height: 390 },
    });
    expect(m.island).toBe(false);
    expect(m.edges.left).toEqual([]);
    expect(m.ear).toBe(0);
    expect(m.edges.right).toHaveLength(1);
  });

  test('upright in a tab the top inset is 0: the cut is under the browser, the top edge one plain span, no ear', () => {
    const m = safeAreaMap({
      ...island15,
      corners: all(0),
      type: 'portrait-primary',
      insets: { top: 0, right: 0, bottom: 34, left: 0 },
      viewport: { width: 393, height: 672 },
      full: { width: 393, height: 852 },
    });
    expect(m.cutEdge).toBe('top');
    expect(m.cut).toBeNull();
    expect(m.edges.top).toEqual([{ from: 0, to: 393 }]);
    expect(m.ear).toBe(0);
  });

  test("upright installed: the cut centred on the top edge at the screen's middle, two ears left and right of it", () => {
    const m = safeAreaMap({
      ...island15,
      type: 'portrait-primary',
      insets: { top: 59, right: 0, bottom: 34, left: 0 },
      viewport: { width: 393, height: 852 },
      full: { width: 393, height: 852 },
    });
    expect(m.cut).toEqual({ from: 196.5 - 63, to: 196.5 + 63 });
    expect(m.edges.top).toHaveLength(2);
    expect(m.edges.bottom).toEqual([{ from: 59, to: 393 - 59 }]);
  });

  test('without a screen to read the cut is centred on the viewport; without a cut every edge is one span and the edge is none', () => {
    const m = safeAreaMap({ ...island15, full: null, viewport: { width: 800, height: 400 } });
    expect(m.cut).toEqual({ from: 200 - 63, to: 200 + 63 });
    const none = safeAreaMap({ ...island15, cut: null });
    expect(none.cutEdge).toBe('none');
    expect(none.cut).toBeNull();
    expect(none.island).toBe(false);
    EDGES.forEach((edge) => {
      expect(none.edges[edge]).toHaveLength(1);
    });
    expect(none.ear).toBe(0);
  });

  test('a span shorter than a tap target is dropped', () => {
    const m = safeAreaMap({ ...island15, cut: null, viewport: { width: 852, height: 100 } });
    expect(m.edges.left).toEqual([]);
    expect(m.edges.right).toEqual([]);
    expect(EAR_MIN).toBe(44);
  });
});

describe('flipMap', () => {
  test('a half turn: the cut moves to the opposite edge, every span is mirrored through the centre, the ears keep their lengths', () => {
    const m = safeAreaMap(island15);
    const f = flipMap(m, island15.viewport);
    expect(f.cutEdge).toBe('right');
    expect(f.cut).toEqual({ from: 393 - (m.cut?.to ?? 0), to: 393 - (m.cut?.from ?? 0) });
    expect(f.edges.right.map(lengthOf)).toEqual([...m.edges.left.map(lengthOf)].reverse());
    expect(f.edges.left).toEqual(m.edges.right);
    expect(f.edges.top).toEqual(
      m.edges.bottom.map((s) => ({ from: 852 - s.to, to: 852 - s.from })),
    );
    expect(f.ear).toBe(m.ear);
    // Twice is the identity.
    expect(flipMap(f, island15.viewport)).toEqual(m);
  });

  test('no cut stays no cut; a cut off the page stays null', () => {
    const none = flipMap(safeAreaMap({ ...island15, cut: null }), island15.viewport);
    expect(none.cutEdge).toBe('none');
    expect(none.cut).toBeNull();
    const under = flipMap(
      safeAreaMap({
        ...island15,
        type: 'portrait-primary',
        insets: { top: 0, right: 0, bottom: 34, left: 0 },
      }),
      island15.viewport,
    );
    expect(under.cutEdge).toBe('bottom');
    expect(under.cut).toBeNull();
  });
});

describe('safeAreaVars', () => {
  test('the island phone: the notch side, the ear, both ears on the left, the free right side, the cut', () => {
    const v = safeAreaVars(safeAreaMap(island15));
    expect(v['--notch-side']).toBe('left');
    expect(v['--ear-height']).toBe('68.5px');
    expect(v['--safe-left-count']).toBe('2');
    expect(v['--safe-left-from']).toBe('59px');
    expect(v['--safe-left-to']).toBe('127.5px');
    expect(v['--safe-left-2-from']).toBe('265.5px');
    expect(v['--safe-left-2-to']).toBe('334px');
    expect(v['--safe-left-top']).toBe('59px');
    expect(v['--safe-left-bottom']).toBe('127.5px');
    expect(v['--safe-right-top']).toBe('59px');
    expect(v['--safe-right-bottom']).toBe('334px');
    expect(v['--safe-right-2-from']).toBe('0px');
    expect(v['--safe-free-side']).toBe('right');
    expect(v['--safe-free-from']).toBe('59px');
    expect(v['--safe-free-to']).toBe('334px');
    expect(v['--safe-cut-from']).toBe('133.5px');
    expect(v['--safe-cut-to']).toBe('259.5px');
  });

  test('secondary frees the left; no cut frees nothing and writes 0 for the cut; an empty edge writes 0/0', () => {
    const right = safeAreaVars(safeAreaMap({ ...island15, type: 'landscape-secondary' }));
    expect(right['--safe-free-side']).toBe('left');
    const none = safeAreaVars(safeAreaMap({ ...island15, cut: null }));
    expect(none['--notch-side']).toBe('none');
    expect(none['--safe-free-side']).toBe('none');
    expect(none['--safe-free-from']).toBe('0px');
    expect(none['--safe-cut-from']).toBe('0px');
    const tiny = safeAreaVars(safeAreaMap({ ...island15, viewport: { width: 852, height: 100 } }));
    expect(tiny['--safe-right-count']).toBe('0');
    expect(tiny['--safe-right-from']).toBe('0px');
    expect(tiny['--safe-right-bottom']).toBe('0px');
  });
});

describe('insideSegments and the types', () => {
  test('a box inside one span passes, one over an arc or the cut fails, half a pixel is forgiven', () => {
    const { left } = safeAreaMap(island15).edges;
    expect(insideSegments(left, { from: 60, to: 104 })).toBe(true);
    expect(insideSegments(left, { from: 58.6, to: 104 })).toBe(true);
    expect(insideSegments(left, { from: 40, to: 84 })).toBe(false);
    expect(insideSegments(left, { from: 100, to: 144 })).toBe(false);
    expect(insideSegments([], { from: 0, to: 1 })).toBe(false);
  });

  test('isOrientationType names the four and nothing else', () => {
    ORIENTATION_TYPES.forEach((t) => {
      expect(isOrientationType(t)).toBe(true);
    });
    expect(isOrientationType('sideways')).toBe(false);
  });
});
