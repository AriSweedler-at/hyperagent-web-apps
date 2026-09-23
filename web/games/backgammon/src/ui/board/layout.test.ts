import { describe, expect, test } from 'vitest';

import type { PointIndex, Seat } from '../../engine/index.ts';
import {
  DESKTOP_TEMPLATE,
  FIXED_AREAS,
  PHONE_TEMPLATE,
  POINT_AREAS,
  absOf,
  absOfId,
  areaOf,
  boardLayout,
  layoutFor,
  ownOf,
  parseAreas,
  pathFor,
  placeOf,
  pointId,
  pointWidth,
  rowOrder,
  sideOf,
  stackExtent,
  stackStep,
  visibleOf,
  type Area,
  type Cell,
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

  test('every place has a cell and no two places overlap (the dice excepted on the desktop)', () => {
    (['phone', 'desktop'] as const).forEach((layout) => {
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
    });
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

  test('desktop, seat 1: the mirror row by row', () => {
    const rows = rowOrder('desktop', 1);
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
  test('layoutFor switches at 900px', () => {
    expect([layoutFor(390), layoutFor(899), layoutFor(900), layoutFor(1280)]).toEqual([
      'phone',
      'phone',
      'desktop',
      'desktop',
    ]);
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
  });
});
