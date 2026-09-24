// The pure twin of the board's CSS (docs/design/backgammon-board.md §3.3, §7). theme.css
// places the 24 points, the two bar halves, the dice and the two trays with two
// `grid-template-areas` strings (the phone stands the board on end, the desktop lays it flat from
// 900px) whose area names are own numbers, and the seat perspective is `data-own` on each point.
// This module holds the same two templates as data and the same seat mapping, so the geometry
// e2e (`boardGeometry`) and the painter tests have an oracle for where every place must be, and
// test/dist/backgammon-grid.test.ts parses the strings out of the built CSS and compares them with
// `boardLayout`/`rowOrder` (design §10 risk 5: a typo in either string collapses the grid silently).
// Pure: imports the engine's frame and nothing else; no DOM.
import { err, ok, type Result } from '../../../../../shared/lib/result.ts';
import { rulesOf, type PointIndex, type Seat } from '../../engine/index.ts';

export type Layout = 'phone' | 'desktop';
/** The ids of the containers that hold checkers (`#point-N` is 1-based absolute). */
export type PlaceId = `point-${number}` | 'barTop' | 'barBottom' | 'offLight' | 'offDark';
/** Every grid area: the places plus the dice slot. */
export type Area = PlaceId | 'dice';
/** A grid rectangle in 1-based grid lines, as CSS `grid-area: row / col / row + rowSpan / col + colSpan`. */
export type Cell = Readonly<{ row: number; col: number; rowSpan: number; colSpan: number }>;
export type Viewport = Readonly<{ width: number; height: number }>;

/** theme.css lays the board flat from this width (`@media (min-width: 900px)`). */
export const DESKTOP_MIN_WIDTH = 900;
export const layoutFor = (width: number): Layout =>
  width >= DESKTOP_MIN_WIDTH ? 'desktop' : 'phone';

/** Five checkers are drawn; the sixth onward is the count badge on the top one (design §3.4). */
export const MAX_DRAWN = 5;
export const visibleOf = (count: number): number => Math.max(0, Math.min(count, MAX_DRAWN));
/** The corner the point label keeps, in px, which the coin run along a phone point spares. */
export const LABEL_CORNER = 20;
/**
 * `--stack-step`: the distance between coin centres. On a phone five coins fit along a point with
 * the label corner spared (27.6px at 390x844); on the desktop the run is longer than five
 * touching coins, so the `min` is the checker itself (touching, classic).
 */
export const stackStep = (pointLen: number, checkerD: number): number =>
  Math.min(checkerD, (pointLen - checkerD - LABEL_CORNER) / 4);
/** How far a stack of `count` reaches along its axis: the oracle's `stackExtent(n) <= pointLen`. */
export const stackExtent = (count: number, checkerD: number, step: number): number =>
  count <= 0 ? 0 : checkerD + (visibleOf(count) - 1) * step;

/** theme.css's `--point-w` clamps, by layout (design §3.1). */
export const PHONE_GEOMETRY = {
  chromeH: 172,
  barW: 48,
  offH: 44,
  frame: 16,
  rows: 12,
  minPointW: 44,
  maxPointW: 64,
  checkerRatio: 0.86,
} as const;
export const DESKTOP_GEOMETRY = {
  chromeH: 190,
  columns: 14.5,
  rows: 11.4,
  minPointW: 40,
  maxPointW: 72,
  pointLenRatio: 5.2,
  checkerRatio: 0.86,
} as const;
const clamp = (lo: number, x: number, hi: number): number => Math.min(hi, Math.max(lo, x));
/** `--point-w` in px for a viewport: 47 at 390x844, 53.5 at 1280x800. */
export const pointWidth = (viewport: Viewport): number => {
  const { width, height } = viewport;
  if (layoutFor(width) === 'phone') {
    const g = PHONE_GEOMETRY;
    return clamp(
      g.minPointW,
      (height - g.chromeH - g.barW - g.offH - g.frame) / g.rows,
      g.maxPointW,
    );
  }
  const g = DESKTOP_GEOMETRY;
  return clamp(
    g.minPointW,
    Math.min((width - 64) / g.columns, (height - g.chromeH) / g.rows),
    g.maxPointW,
  );
};

// ---- the seat frame ------------------------------------------------------------------------------

/** Both shipped variants use the mirror frame (own 1..24 from the mover's bearing-off edge). */
const FRAME = rulesOf('portes');
/** The mover's own number of an absolute point: `abs + 1` for Light, `24 - abs` for Dark. */
export const ownOf = (seat: Seat, abs: PointIndex): number => FRAME.ownOf(seat, abs);
export const absOf = (seat: Seat, own: number): PointIndex => FRAME.absOf(seat, own);
/** The element id of an absolute point (1-based, as the markup names it). */
export const pointId = (abs: PointIndex): PlaceId => `point-${String(abs + 1)}` as PlaceId;
/** `#point-N` -> abs N - 1; null for anything else. */
export const absOfId = (id: string): PointIndex | null => {
  const m = /^point-(\d+)$/.exec(id);
  const n = m === null ? NaN : Number(m[1]);
  return Number.isInteger(n) && n >= 1 && n <= 24 ? ((n - 1) as PointIndex) : null;
};
/** Own 1..12 are near (mine), 13..24 far: `pt-near`/`pt-far` on the markup. */
export const sideOf = (own: number): 'near' | 'far' => (own <= 12 ? 'near' : 'far');

/** The grid area name a place occupies for a seat: `oN` by own number, the trays by nearness. */
export const areaOf = (place: Area, seat: Seat): string => {
  if (place === 'barTop' || place === 'barBottom' || place === 'dice') return place;
  if (place === 'offLight') return seat === 0 ? 'offNear' : 'offFar';
  if (place === 'offDark') return seat === 0 ? 'offFar' : 'offNear';
  const abs = absOfId(place);
  return abs === null ? place : `o${String(ownOf(seat, abs))}`;
};
/** The inverse: the place that fills an area for a seat; null for an unknown name. */
export const placeOf = (area: string, seat: Seat): Area | null => {
  if (area === 'barTop' || area === 'barBottom' || area === 'dice') return area;
  if (area === 'offNear') return seat === 0 ? 'offLight' : 'offDark';
  if (area === 'offFar') return seat === 0 ? 'offDark' : 'offLight';
  const m = /^o(\d+)$/.exec(area);
  const own = m === null ? NaN : Number(m[1]);
  return Number.isInteger(own) && own >= 1 && own <= 24 ? pointId(absOf(seat, own)) : null;
};

// ---- the two templates ---------------------------------------------------------------------------

/** theme.css's phone `grid-template-areas`, row by row (six columns; every point spans three). */
export const PHONE_TEMPLATE: ReadonlyArray<ReadonlyArray<string>> = [
  ['o13', 'o13', 'o13', 'o12', 'o12', 'o12'],
  ['o14', 'o14', 'o14', 'o11', 'o11', 'o11'],
  ['o15', 'o15', 'o15', 'o10', 'o10', 'o10'],
  ['o16', 'o16', 'o16', 'o9', 'o9', 'o9'],
  ['o17', 'o17', 'o17', 'o8', 'o8', 'o8'],
  ['o18', 'o18', 'o18', 'o7', 'o7', 'o7'],
  ['barTop', 'barTop', 'dice', 'dice', 'barBottom', 'barBottom'],
  ['o19', 'o19', 'o19', 'o6', 'o6', 'o6'],
  ['o20', 'o20', 'o20', 'o5', 'o5', 'o5'],
  ['o21', 'o21', 'o21', 'o4', 'o4', 'o4'],
  ['o22', 'o22', 'o22', 'o3', 'o3', 'o3'],
  ['o23', 'o23', 'o23', 'o2', 'o2', 'o2'],
  ['o24', 'o24', 'o24', 'o1', 'o1', 'o1'],
  ['offFar', 'offFar', 'offFar', 'offNear', 'offNear', 'offNear'],
];
/**
 * theme.css's desktop `grid-template-areas` (fourteen columns, two rows). The dice are not an
 * area here: `#dice` overrides its area to span the bar column (`barTop / barTop / barBottom /
 * barBottom`), which `boardLayout` reports as the union of the two bar cells.
 */
export const DESKTOP_TEMPLATE: ReadonlyArray<ReadonlyArray<string>> = [
  [
    'o13',
    'o14',
    'o15',
    'o16',
    'o17',
    'o18',
    'barTop',
    'o19',
    'o20',
    'o21',
    'o22',
    'o23',
    'o24',
    'offFar',
  ],
  [
    'o12',
    'o11',
    'o10',
    'o9',
    'o8',
    'o7',
    'barBottom',
    'o6',
    'o5',
    'o4',
    'o3',
    'o2',
    'o1',
    'offNear',
  ],
];
export const templateOf = (layout: Layout): ReadonlyArray<ReadonlyArray<string>> =>
  layout === 'phone' ? PHONE_TEMPLATE : DESKTOP_TEMPLATE;
/** The area names every template must place exactly once (the dice only where they are an area). */
export const POINT_AREAS: ReadonlyArray<string> = Array.from(
  { length: 24 },
  (_, i) => `o${String(i + 1)}`,
);
export const FIXED_AREAS: ReadonlyArray<string> = ['barTop', 'barBottom', 'offFar', 'offNear'];

const unique = (names: ReadonlyArray<string>): ReadonlyArray<string> => [...new Set(names)];

/**
 * The bounding cell of every name in a template, and whether each fills its rectangle: a name
 * that appears in two separate runs, or a ragged row, is an error naming it (CSS would drop the
 * whole template silently). The result is what the dist test compares against the built CSS.
 */
export const parseAreas = (
  rows: ReadonlyArray<ReadonlyArray<string>>,
): Result<Readonly<Record<string, Cell>>, string> => {
  const widths = unique(rows.map((r) => String(r.length)));
  if (rows.length === 0 || widths.length !== 1)
    return err(`ragged template: row widths ${widths.join(', ')}`);
  const names = unique(rows.flat());
  const cells = names.map((name): readonly [string, Cell] => {
    const hits = rows.flatMap((r, ri) =>
      r.flatMap((n, ci) => (n === name ? [[ri, ci] as const] : [])),
    );
    const rs = hits.map(([ri]) => ri);
    const cs = hits.map(([, ci]) => ci);
    const [r0, r1, c0, c1] = [Math.min(...rs), Math.max(...rs), Math.min(...cs), Math.max(...cs)];
    return [name, { row: r0 + 1, col: c0 + 1, rowSpan: r1 - r0 + 1, colSpan: c1 - c0 + 1 }];
  });
  const torn = cells.filter(([name, c]) => {
    const count = rows.flat().filter((n) => n === name).length;
    return count !== c.rowSpan * c.colSpan;
  });
  if (torn.length > 0) return err(`not a rectangle: ${torn.map(([name]) => name).join(', ')}`);
  return ok(Object.fromEntries(cells));
};

const unionOf = (a: Cell, b: Cell): Cell => {
  const row = Math.min(a.row, b.row);
  const col = Math.min(a.col, b.col);
  return {
    row,
    col,
    rowSpan: Math.max(a.row + a.rowSpan, b.row + b.rowSpan) - row,
    colSpan: Math.max(a.col + a.colSpan, b.col + b.colSpan) - col,
  };
};

/** Every place's grid cell for a layout and a seat, exactly as theme.css places it. */
export const boardLayout = (layout: Layout, seat: Seat): Readonly<Record<Area, Cell>> => {
  const parsed = parseAreas(templateOf(layout));
  // The two templates above are constants this module owns; a torn one is a bug, not an input.
  const areas: Readonly<Record<string, Cell>> = parsed.ok ? parsed.value : {};
  const cellOf = (name: string): Cell => areas[name] ?? { row: 0, col: 0, rowSpan: 0, colSpan: 0 };
  const points = Object.fromEntries(
    POINT_AREAS.map((name) => [placeOf(name, seat) ?? name, cellOf(name)] as const),
  );
  const dice = layout === 'phone' ? cellOf('dice') : unionOf(cellOf('barTop'), cellOf('barBottom'));
  return {
    ...points,
    barTop: cellOf('barTop'),
    barBottom: cellOf('barBottom'),
    dice,
    offLight: cellOf(areaOf('offLight', seat)),
    offDark: cellOf(areaOf('offDark', seat)),
  };
};

/**
 * The places in visual order, row by row (the phone's fourteen rows, the desktop's two): the
 * order the geometry oracle expects along the long axis. The desktop's dice are not a row entry
 * (they float over the bar column).
 */
export const rowOrder = (layout: Layout, seat: Seat): ReadonlyArray<ReadonlyArray<Area>> =>
  templateOf(layout).map((row) =>
    unique(row).flatMap((name) => {
      const place = placeOf(name, seat);
      return place === null ? [] : [place];
    }),
  );

/** The 24 absolute points in the seat's movement order (own 24 -> 1), then off. */
export const pathFor = (seat: Seat): ReadonlyArray<PointIndex | 'off'> => [
  ...Array.from({ length: 24 }, (_, i) => absOf(seat, 24 - i)),
  'off',
];
