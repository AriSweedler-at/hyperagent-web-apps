import { describe, expect, test } from 'vitest';

import {
  DEVICES,
  emulationName,
  emulationsOf,
  type Emulation,
} from '../../../../../shared/lib/devices.ts';
import type { PointIndex, Seat } from '../../engine/index.ts';
import {
  DESKTOP_TEMPLATE,
  FIXED_AREAS,
  LANDSCAPE_GEOMETRY,
  boardRoom,
  chromeHeight,
  LANDSCAPE_MAX_HEIGHT,
  PHONE_TEMPLATE,
  POINT_AREAS,
  RAIL_MIN_WIDTH,
  absOf,
  absOfId,
  areaOf,
  boardLayout,
  chromeWidth,
  edgeOf,
  layoutFor,
  ownOf,
  parseAreas,
  pathFor,
  placeOf,
  pointId,
  paddingOf,
  pointLength,
  pointWidth,
  rowOrder,
  sideOf,
  stackExtent,
  stackStep,
  templateOf,
  visibleOf,
  type Area,
  type Cell,
  type Layout,
  type Viewport,
} from './layout.ts';

const SEATS: ReadonlyArray<Seat> = [0, 1];
const ABS: ReadonlyArray<PointIndex> = Array.from({ length: 24 }, (_, i) => i as PointIndex);

describe('the seat frame', () => {
  test('own numbers count from the bearing-off edge: Light abs + 1, Dark 24 - abs', () => {
    expect(ABS.map((abs) => ownOf(0, abs))).toEqual(ABS.map((abs) => abs + 1));
    expect(ABS.map((abs) => ownOf(1, abs))).toEqual(ABS.map((abs) => 24 - abs));
    SEATS.forEach((seat) => {
      ABS.forEach((abs) => {
        expect(absOf(seat, ownOf(seat, abs))).toBe(abs);
      });
    });
  });

  test('ids are 1-based absolute; the areas are own numbers; the trays follow the seat', () => {
    expect(pointId(0)).toBe('point-1');
    expect(absOfId('point-24')).toBe(23);
    expect([absOfId('point-0'), absOfId('point-25'), absOfId('barTop')]).toEqual([
      null,
      null,
      null,
    ]);
    expect(areaOf('point-1', 0)).toBe('o1');
    expect(areaOf('point-1', 1)).toBe('o24');
    expect(areaOf('point-13', 1)).toBe('o12');
    expect([areaOf('offLight', 0), areaOf('offDark', 0)]).toEqual(['offNear', 'offFar']);
    expect([areaOf('offLight', 1), areaOf('offDark', 1)]).toEqual(['offFar', 'offNear']);
    expect([areaOf('barTop', 1), areaOf('dice', 1)]).toEqual(['barTop', 'dice']);
    expect(placeOf('o1', 1)).toBe('point-24');
    expect(placeOf('offNear', 1)).toBe('offDark');
    expect(placeOf('o25', 0)).toBeNull();
    expect(placeOf('nope', 0)).toBeNull();
  });

  test('own 1..12 are near, 13..24 far', () => {
    expect([sideOf(1), sideOf(12), sideOf(13), sideOf(24)]).toEqual(['near', 'near', 'far', 'far']);
  });

  test('pathFor walks own 24 down to 1 then off, in absolute indices', () => {
    expect(pathFor(0)).toEqual([...[...ABS].reverse(), 'off']);
    expect(pathFor(1)).toEqual([...ABS, 'off']);
  });
});

describe('the templates', () => {
  test('both parse to one rectangle per name, with the expected names', () => {
    const phone = parseAreas(PHONE_TEMPLATE);
    const desktop = parseAreas(DESKTOP_TEMPLATE);
    expect(phone.ok && desktop.ok).toBe(true);
    if (!phone.ok || !desktop.ok) return;
    expect(Object.keys(phone.value).sort()).toEqual(
      [...POINT_AREAS, ...FIXED_AREAS, 'dice'].sort(),
    );
    expect(Object.keys(desktop.value).sort()).toEqual([...POINT_AREAS, ...FIXED_AREAS].sort());
    // Phone: o13 spans the first three columns of row 1; o1 the last three of row 13.
    expect(phone.value['o13']).toEqual({ row: 1, col: 1, rowSpan: 1, colSpan: 3 });
    expect(phone.value['o1']).toEqual({ row: 13, col: 4, rowSpan: 1, colSpan: 3 });
    expect(phone.value['dice']).toEqual({ row: 7, col: 3, rowSpan: 1, colSpan: 2 });
    expect(phone.value['offNear']).toEqual({ row: 14, col: 4, rowSpan: 1, colSpan: 3 });
    // Desktop: o13 top-left, o1 bottom row beside the near tray, the bar in column 7.
    expect(desktop.value['o13']).toEqual({ row: 1, col: 1, rowSpan: 1, colSpan: 1 });
    expect(desktop.value['o1']).toEqual({ row: 2, col: 13, rowSpan: 1, colSpan: 1 });
    expect(desktop.value['barBottom']).toEqual({ row: 2, col: 7, rowSpan: 1, colSpan: 1 });
    expect(desktop.value['offFar']).toEqual({ row: 1, col: 14, rowSpan: 1, colSpan: 1 });
  });

  test('parseAreas refuses a ragged template and a torn area', () => {
    expect(parseAreas([['a', 'a'], ['a']])).toEqual({
      ok: false,
      error: 'ragged template: row widths 2, 1',
    });
    expect(parseAreas([['a', 'b', 'a']])).toEqual({ ok: false, error: 'not a rectangle: a' });
    expect(parseAreas([])).toMatchObject({ ok: false });
    expect(
      parseAreas([
        ['a', 'a'],
        ['a', 'a'],
      ]),
    ).toEqual({
      ok: true,
      value: { a: { row: 1, col: 1, rowSpan: 2, colSpan: 2 } },
    });
  });
});

const EMPTY: Cell = { row: 0, col: 0, rowSpan: 0, colSpan: 0 };
/** `Record<Area, Cell>` indexes as possibly undefined (a template-literal key); the tests want a Cell. */
const at = (cells: Readonly<Record<Area, Cell>>, a: Area): Cell => cells[a] ?? EMPTY;
const disjoint = (a: Cell, b: Cell): boolean =>
  a.row + a.rowSpan <= b.row ||
  b.row + b.rowSpan <= a.row ||
  a.col + a.colSpan <= b.col ||
  b.col + b.colSpan <= a.col;

describe('boardLayout', () => {
  test('phone, seat 0: my home column is the right one, points run down from 13 on the left', () => {
    const cells = boardLayout('phone', 0);
    expect(cells['point-13']).toEqual({ row: 1, col: 1, rowSpan: 1, colSpan: 3 });
    expect(cells['point-24']).toEqual({ row: 13, col: 1, rowSpan: 1, colSpan: 3 });
    expect(cells['point-12']).toEqual({ row: 1, col: 4, rowSpan: 1, colSpan: 3 });
    expect(cells['point-1']).toEqual({ row: 13, col: 4, rowSpan: 1, colSpan: 3 });
    expect(cells.barTop).toEqual({ row: 7, col: 1, rowSpan: 1, colSpan: 2 });
    expect(cells.dice).toEqual({ row: 7, col: 3, rowSpan: 1, colSpan: 2 });
    expect(cells.barBottom).toEqual({ row: 7, col: 5, rowSpan: 1, colSpan: 2 });
    expect(cells.offDark).toEqual({ row: 14, col: 1, rowSpan: 1, colSpan: 3 });
    expect(cells.offLight).toEqual({ row: 14, col: 4, rowSpan: 1, colSpan: 3 });
  });

  test('seat 1 sees the mirror: point-24 is its own 1, the trays swap', () => {
    const cells = boardLayout('phone', 1);
    expect(cells['point-24']).toEqual(boardLayout('phone', 0)['point-1']);
    expect(cells['point-1']).toEqual(boardLayout('phone', 0)['point-24']);
    expect(cells.offLight).toEqual(boardLayout('phone', 0).offDark);
    expect(cells.offDark).toEqual(boardLayout('phone', 0).offLight);
    const desk = boardLayout('desktop', 1);
    expect(desk['point-12']).toEqual(boardLayout('desktop', 0)['point-13']);
  });

  test('desktop: two rows of thirteen and a tray column; the dice span the bar column', () => {
    const cells = boardLayout('desktop', 0);
    expect(cells['point-13']).toEqual({ row: 1, col: 1, rowSpan: 1, colSpan: 1 });
    expect(cells['point-18']).toEqual({ row: 1, col: 6, rowSpan: 1, colSpan: 1 });
    expect(cells['point-19']).toEqual({ row: 1, col: 8, rowSpan: 1, colSpan: 1 });
    expect(cells['point-7']).toEqual({ row: 2, col: 6, rowSpan: 1, colSpan: 1 });
    expect(cells['point-6']).toEqual({ row: 2, col: 8, rowSpan: 1, colSpan: 1 });
    expect(cells.dice).toEqual({ row: 1, col: 7, rowSpan: 2, colSpan: 1 });
    expect(cells.offDark).toEqual({ row: 1, col: 14, rowSpan: 1, colSpan: 1 });
    expect(cells.offLight).toEqual({ row: 2, col: 14, rowSpan: 1, colSpan: 1 });
  });

  test('landscape: the desktop template, cell for cell, for both seats', () => {
    expect(templateOf('landscape')).toBe(DESKTOP_TEMPLATE);
    SEATS.forEach((seat) => {
      expect(boardLayout('landscape', seat)).toEqual(boardLayout('desktop', seat));
    });
  });

  test('every place has a cell and no two places overlap (the dice excepted where the board is flat)', () => {
    (['phone', 'desktop', 'landscape'] as const satisfies ReadonlyArray<Layout>).forEach(
      (layout) => {
        SEATS.forEach((seat) => {
          const cells = boardLayout(layout, seat);
          // 24 points, two bars, two trays, and the dice where they are a template area.
          const places = (Object.keys(cells) as ReadonlyArray<Area>).filter(
            (a) => layout === 'phone' || a !== 'dice',
          );
          expect(places).toHaveLength(layout === 'phone' ? 29 : 28);
          places.forEach((a) => {
            expect(at(cells, a).rowSpan * at(cells, a).colSpan, a).toBeGreaterThan(0);
          });
          places.forEach((a, i) => {
            places.slice(i + 1).forEach((b) => {
              expect(disjoint(at(cells, a), at(cells, b)), `${a} vs ${b}`).toBe(true);
            });
          });
        });
      },
    );
  });
});

describe('rowOrder', () => {
  test('phone, seat 0: far point then near point per row, the band and the trays', () => {
    const rows = rowOrder('phone', 0);
    expect(rows).toHaveLength(14);
    expect(rows[0]).toEqual(['point-13', 'point-12']);
    expect(rows[5]).toEqual(['point-18', 'point-7']);
    expect(rows[6]).toEqual(['barTop', 'dice', 'barBottom']);
    expect(rows[7]).toEqual(['point-19', 'point-6']);
    expect(rows[12]).toEqual(['point-24', 'point-1']);
    expect(rows[13]).toEqual(['offDark', 'offLight']);
  });

  test('desktop and landscape, seat 1: the mirror row by row', () => {
    const rows = rowOrder('desktop', 1);
    expect(rowOrder('landscape', 1)).toEqual(rows);
    expect(rows).toEqual([
      [
        'point-12',
        'point-11',
        'point-10',
        'point-9',
        'point-8',
        'point-7',
        'barTop',
        'point-6',
        'point-5',
        'point-4',
        'point-3',
        'point-2',
        'point-1',
        'offLight',
      ],
      [
        'point-13',
        'point-14',
        'point-15',
        'point-16',
        'point-17',
        'point-18',
        'barBottom',
        'point-19',
        'point-20',
        'point-21',
        'point-22',
        'point-23',
        'point-24',
        'offDark',
      ],
    ]);
  });
});

describe('the sizes', () => {
  test('layoutFor: a bare width switches at 900px; a coarse pointer sideways under 500px tall is the landscape', () => {
    expect([layoutFor(390), layoutFor(899), layoutFor(900), layoutFor(1280)]).toEqual([
      'phone',
      'phone',
      'desktop',
      'desktop',
    ]);
    const cases: ReadonlyArray<readonly [Parameters<typeof layoutFor>[0], Layout, string]> = [
      [{ width: 844, height: 390, coarse: true }, 'landscape', 'an iPhone 12 sideways'],
      [
        { width: 844, height: 390, coarse: false },
        'phone',
        'a narrow mouse window keeps the phone board',
      ],
      [{ width: 844, height: 390 }, 'phone', 'no pointer fact: the width rule'],
      [
        { width: 915, height: 412, coarse: true },
        'landscape',
        'a Pixel 8: coarse beats the 900px width',
      ],
      [{ width: 956, height: 440, coarse: true }, 'landscape', 'a 16 Pro Max'],
      [
        { width: 1024, height: 768, coarse: true },
        'desktop',
        'a tablet sideways is over 500px tall',
      ],
      [{ width: 390, height: 844, coarse: true }, 'phone', 'a phone upright'],
      [{ width: 844, height: LANDSCAPE_MAX_HEIGHT, coarse: true }, 'landscape', 'at the ceiling'],
      [{ width: 844, height: LANDSCAPE_MAX_HEIGHT + 1, coarse: true }, 'phone', 'over it'],
      [{ width: 500, height: 500, coarse: true }, 'phone', 'square is not wider than tall'],
      [{ width: 1280, height: 800, coarse: false }, 'desktop', 'the laptop golden'],
    ];
    cases.forEach(([vp, layout, why]) => {
      expect(layoutFor(vp), why).toBe(layout);
    });
  });

  test('landscape widths: 13 points, the tray and the frame in what the edges and the rail leave', () => {
    // Inset-free (headless): two 16px edges, the 44px rail and its 6px gap leave 702px at 844: 54px points.
    expect(chromeWidth({ width: 844, height: 390, coarse: true })).toBe(82);
    expect(pointWidth({ width: 844, height: 390, coarse: true })).toBeCloseTo(54, 5);
    // A notched iPhone: the edge is the inset (47, 59, 62), both sides, so 144 / 168 / 174 of chrome.
    const notched = (width: number, height: number, inset: number) => ({
      width,
      height,
      coarse: true,
      insets: { left: inset, right: inset, bottom: 21 },
    });
    expect(edgeOf(notched(844, 390, 47))).toBe(47);
    expect(chromeWidth(notched(844, 390, 47))).toBe(144);
    expect(pointWidth(notched(844, 390, 47))).toBeCloseTo(49.23, 2);
    expect(pointWidth(notched(852, 393, 59))).toBeCloseTo(48, 5);
    expect(pointWidth(notched(956, 440, 62))).toBeCloseTo(55.54, 2);
    // Android reports one side only: the larger inset is the edge on both sides, so the board stays centred.
    const cutout = {
      width: 844,
      height: 390,
      coarse: true,
      insets: { left: 30, right: 0, bottom: 0 },
    };
    expect(edgeOf(cutout)).toBe(30);
    expect(chromeWidth(cutout)).toBe(110);
    expect(pointWidth(cutout)).toBeCloseTo(51.85, 2);
    // A Pixel 8 sideways: 59.5px points from 915.
    expect(pointWidth({ width: 915, height: 412, coarse: true })).toBeCloseTo(59.46, 2);
    // The rows scheme under RAIL_MIN_WIDTH: the edges alone (32px): 44.2 on the SE, the 44px floor at 640.
    expect(chromeWidth({ width: 667, height: 375, coarse: true })).toBe(32);
    expect(pointWidth({ width: 667, height: 375, coarse: true })).toBeCloseTo(44.23, 2);
    expect(pointWidth({ width: 640, height: 360, coarse: true })).toBe(
      LANDSCAPE_GEOMETRY.minPointW,
    );
    // The threshold: at 714 the rail stands beside a board exactly at the floor; one under, the rows are wider.
    expect(RAIL_MIN_WIDTH).toBe(13 * 44 + 44 + 16 + 2 * 16 + 44 + 6);
    expect(pointWidth({ width: RAIL_MIN_WIDTH, height: 390, coarse: true })).toBeCloseTo(44, 5);
    expect(pointWidth({ width: RAIL_MIN_WIDTH - 1, height: 390, coarse: true })).toBeCloseTo(
      47.77,
      2,
    );
    expect(pointWidth({ width: 2000, height: 400, coarse: true })).toBe(
      LANDSCAPE_GEOMETRY.maxPointW,
    );
  });

  test('landscape lengths: two rows in what the chrome leaves, floored per scheme (104 rail, 90 rows, less half of what the bottom inset adds)', () => {
    // The rail's 50px of chrome inset-free (11 + 22 + 6 + 11): 162 at 844x390, 154 with the
    // iPhone 12's 21px home indicator (11 + 22 + 6 + 27 = 66), 145 on a Pixel 8 with its toolbar,
    // 119 at 780x304.
    expect(paddingOf({ width: 844, height: 390, coarse: true })).toEqual({ top: 11, bottom: 11 });
    expect(chromeHeight({ width: 844, height: 390, coarse: true })).toBe(50);
    expect(pointLength({ width: 844, height: 390, coarse: true })).toBe(162);
    const iphone12 = {
      width: 844,
      height: 390,
      coarse: true,
      insets: { left: 47, right: 47, bottom: 21 },
    };
    expect(paddingOf(iphone12)).toEqual({ top: 11, bottom: 27 });
    expect(chromeHeight(iphone12)).toBe(66);
    expect(pointLength(iphone12)).toBe(154);
    // A 4px home indicator: the 11px floor under the board still holds (6 + 4 < 11).
    expect(paddingOf({ ...iphone12, insets: { left: 47, right: 47, bottom: 4 } })).toEqual({
      top: 11,
      bottom: 11,
    });
    expect(pointLength({ width: 915, height: 356, coarse: true })).toBe(145);
    expect(pointLength({ width: 780, height: 304, coarse: true })).toBe(119);
    // The floor: 2 x 104 + 16 + 50 = 274 exactly; under it the floor holds and the CSS scrolls.
    expect(pointLength({ width: 780, height: 274, coarse: true })).toBe(104);
    expect(pointLength({ width: 780, height: 250, coarse: true })).toBe(
      LANDSCAPE_GEOMETRY.rail.minPointLen,
    );
    // A notched 375pt phone at the 274 floor: the floor gives up half of what the 21px home
    // indicator adds past the 11px (16 / 2 = 8), so 2 x 96 + 16 + 66 = 274 still fits, exactly
    // where the CSS fallback starts scrolling.
    expect(
      pointLength({
        width: 812,
        height: 274,
        coarse: true,
        insets: { left: 47, right: 47, bottom: 21 },
      }),
    ).toBe(96);
    expect(
      pointLength({
        width: 812,
        height: 250,
        coarse: true,
        insets: { left: 47, right: 47, bottom: 21 },
      }),
    ).toBe(96);
    // The rows' 100px of chrome (11 + 22 + 6 + 44 + 6 + 11, the same strip and a button row under
    // the board): 129.5 on an SE, 104.5 with Safari's toolbar up, 122 at 640x360; the floor is
    // 2 x 90 + 16 + 100 = 296 exactly, and 82 with a 21px home indicator (2 x 82 + 16 + 116 = 296
    // still).
    expect(chromeHeight({ width: 667, height: 375, coarse: true })).toBe(100);
    expect(pointLength({ width: 667, height: 375, coarse: true })).toBe(129.5);
    expect(pointLength({ width: 667, height: 325, coarse: true })).toBe(104.5);
    expect(pointLength({ width: 640, height: 360, coarse: true })).toBe(122);
    expect(pointLength({ width: 640, height: 296, coarse: true })).toBe(90);
    expect(pointLength({ width: 640, height: 270, coarse: true })).toBe(
      LANDSCAPE_GEOMETRY.rows.minPointLen,
    );
    expect(
      pointLength({
        width: 667,
        height: 296,
        coarse: true,
        insets: { left: 0, right: 0, bottom: 21 },
      }),
    ).toBe(82);
  });

  test('boardRoom: the board stands 39px under the top and 11 over the bottom with the rail (27 over a 21px home indicator), 39 and 61 with the rows', () => {
    expect(boardRoom({ width: 844, height: 390, coarse: true })).toEqual({ top: 39, bottom: 11 });
    expect(
      boardRoom({
        width: 852,
        height: 393,
        coarse: true,
        insets: { left: 59, right: 59, bottom: 21 },
      }),
    ).toEqual({ top: 39, bottom: 27 });
    expect(boardRoom({ width: 667, height: 375, coarse: true })).toEqual({ top: 39, bottom: 61 });
    // The room and the point length agree: two rows and the frame fill it, in both schemes.
    [
      { width: 844, height: 390, coarse: true },
      { width: 667, height: 375, coarse: true },
    ].forEach((vp) => {
      const room = boardRoom(vp);
      expect(2 * pointLength(vp) + LANDSCAPE_GEOMETRY.frame).toBe(
        vp.height - room.top - room.bottom,
      );
    });
  });

  test('pointWidth: 47px at 390x844, 53.5px at 1280x800, clamped at the floors and caps', () => {
    expect(pointWidth({ width: 390, height: 844 })).toBeCloseTo(47, 5);
    expect(pointWidth({ width: 1280, height: 800 })).toBeCloseTo(53.5, 1);
    expect(pointWidth({ width: 375, height: 667 })).toBe(44);
    expect(pointWidth({ width: 390, height: 1400 })).toBe(64);
    expect(pointWidth({ width: 1000, height: 600 })).toBe(40);
    expect(pointWidth({ width: 2000, height: 1400 })).toBe(72);
  });

  test('five drawn, the rest a badge; the coin step spares the label corner', () => {
    expect([visibleOf(0), visibleOf(3), visibleOf(5), visibleOf(7)]).toEqual([0, 3, 5, 5]);
    // Phone at 390x844: 175px points, 40.42px checkers -> 28.6px steps, five coins in 155px.
    const step = stackStep(175, 40.42);
    expect(step).toBeCloseTo(28.645, 2);
    expect(stackExtent(7, 40.42, step)).toBeLessThanOrEqual(175);
    expect(stackExtent(0, 40.42, step)).toBe(0);
    // Desktop: the run is long enough for touching coins.
    expect(stackStep(278, 46)).toBe(46);
    expect(stackExtent(5, 46, 46)).toBe(230);
    // Sideways the run spares 18px (the desktop's 15px base offset and 3px at the tip): 20.6px
    // steps at 844x390 (147px points, 46.4px coins); at the two floors 10.8 (104, the rail) and
    // 8.5 (90, the rows), five coins inside the point either way.
    const spare = LANDSCAPE_GEOMETRY.stackSpare;
    const coin = (pointW: number) => pointW * LANDSCAPE_GEOMETRY.checkerRatio;
    expect(stackStep(147, coin(54), spare)).toBeCloseTo(20.64, 2);
    expect(stackStep(104, coin(49.7), spare)).toBeCloseTo(10.8, 1);
    expect(stackExtent(5, coin(49.7), stackStep(104, coin(49.7), spare))).toBeLessThanOrEqual(
      104 - spare,
    );
    expect(stackStep(90, coin(44), spare)).toBeCloseTo(8.54, 2);
    expect(stackExtent(5, coin(44), stackStep(90, coin(44), spare))).toBeLessThanOrEqual(
      90 - spare,
    );
  });
});

/**
 * The device sweep (the owner, 2026-09-28: "add unit tests to make sure that the board fills up
 * the right amount of space"): every phone the catalogue knows (web/shared/lib/devices.ts), held
 * sideways, in a tab with the browser's bar shown and hidden (the recorded toolbar range's max and
 * min off the height), standalone and fullscreen, through the CSS's pure twin. Where the viewport
 * fits, two point rows and the frame fill the board's room to half a pixel (no parchment above or
 * below beyond the chrome's own gaps); the floor (and the scroll fallback with it) holds only
 * under the floor's own height, so a phone at its full height never scrolls; every point is at
 * least 44px wide; and the scheme is the width's (the rail from 714px, the rows below). One row
 * per device: a new phone is one line in the catalogue. The iPads stand taller than 500px sideways
 * and take the desktop template, by design (`LANDSCAPE_MAX_HEIGHT`); the SE 1st gen is catalogued
 * unsupported (iOS 15 cannot run the theme) and its width promise is not made.
 */
describe('the device sweep: the board fills its room on every phone, both bar states, every mode', () => {
  const sideways = (e: Emulation): Viewport => ({
    width: e.viewport.width,
    height: e.viewport.height,
    coarse: true,
    insets: { left: e.insets.left, right: e.insets.right, bottom: e.insets.bottom },
  });
  const cases = DEVICES.flatMap((d) =>
    emulationsOf(d).filter((e) => e.orientation === 'landscape'),
  );

  test('the sweep covers every device in every landscape case: three modes, the tab twice', () => {
    expect(cases).toHaveLength(DEVICES.length * 4);
  });

  test.each(cases.map((e) => [emulationName(e), e] as const))('%s', (_name, e) => {
    const vp = sideways(e);
    const d = e.device;
    if (d.kind === 'ipad') {
      expect(layoutFor(vp), 'an iPad sideways is over 500px tall: the desktop template').toBe(
        'desktop',
      );
      return;
    }
    expect(layoutFor(vp)).toBe('landscape');
    const scheme = vp.width >= RAIL_MIN_WIDTH ? LANDSCAPE_GEOMETRY.rail : LANDSCAPE_GEOMETRY.rows;
    const room = boardRoom(vp);
    const len = pointLength(vp);
    const chrome = chromeHeight(vp);
    const pad = paddingOf(vp);
    const floor =
      scheme.minPointLen - (pad.top + pad.bottom - scheme.padTop - scheme.padBottom) / 2;
    const floorHeight = 2 * floor + LANDSCAPE_GEOMETRY.frame + chrome;
    const scrolls = vp.height < floorHeight;
    // Never under the floor at the phone's full height (the bar hidden, standalone, fullscreen):
    // only the bar up on the shortest phones pushes the height under it.
    if (e.bar === 'hidden') expect(scrolls, `${String(vp.height)}px scrolls`).toBe(false);
    if (scrolls) {
      expect(len).toBe(floor);
    } else {
      // Fills: two rows and the frame are exactly the height less the room above and below.
      const boardHeight = vp.height - room.top - room.bottom;
      expect(Math.abs(2 * len + LANDSCAPE_GEOMETRY.frame - boardHeight)).toBeLessThanOrEqual(0.5);
      expect(len).toBeGreaterThanOrEqual(floor);
      // The room is the chrome's own: the padding and the strip above, the padding (over the home
      // indicator where there is one) and the buttons' row below.
      expect(room.top).toBe(scheme.padTop + scheme.chromeAbove);
      expect(room.bottom).toBe(
        Math.max(scheme.padBottom, scheme.padAir + e.insets.bottom) +
          scheme.chromeIn -
          scheme.chromeAbove,
      );
    }
    // Every point a tap target: 44px wide before the clamp (the SE 1st gen excepted, unsupported).
    if (d.supported) {
      const unclamped =
        (vp.width - chromeWidth(vp) - LANDSCAPE_GEOMETRY.trayW - LANDSCAPE_GEOMETRY.frame) /
        LANDSCAPE_GEOMETRY.columns;
      expect(
        unclamped,
        `${String(vp.width)}px wide: ${String(unclamped)}px points`,
      ).toBeGreaterThanOrEqual(LANDSCAPE_GEOMETRY.minPointW);
      expect(pointWidth(vp)).toBeGreaterThanOrEqual(LANDSCAPE_GEOMETRY.minPointW);
    }
  });
});
