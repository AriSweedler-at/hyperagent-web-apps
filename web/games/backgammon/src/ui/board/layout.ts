// The pure twin of the board's CSS (docs/design/backgammon-board.md §3.1, §3.3, §7). theme.css
// places the 24 points, the two bar halves, the dice and the two trays with two
// `grid-template-areas` strings (the phone stands the board on end; the desktop, from 900px, and a
// phone held sideways lay it flat: three layouts, two templates) whose area names are own
// numbers, and the seat perspective is `data-own` on each point. This module holds the same two
// templates as data, the same seat mapping, the same layout choice (`layoutFor`: the CSS's
// `(min-width: 900px)` and its landscape query, a coarse pointer wider than tall under 500px) and
// the same size arithmetic (`pointWidth`, `pointLength`), so the geometry e2e (`boardGeometry`)
// and the painter tests have an oracle for where every place must be and how big, and
// test/dist/backgammon-grid.test.ts parses the strings out of the built CSS and compares them with
// `boardLayout`/`rowOrder` (design §10 risk 5: a typo in either string collapses the grid silently).
// Pure: imports the engine's frame and nothing else; no DOM.
import { err, ok, type Result } from '../../../../../shared/lib/result.ts';
import { rulesOf, type PointIndex, type Seat } from '../../engine/index.ts';

/** The phone stands the board on end; the desktop and a phone held sideways (`landscape`) lay it flat. */
export type Layout = 'phone' | 'desktop' | 'landscape';
/** The ids of the containers that hold checkers (`#point-N` is 1-based absolute). */
export type PlaceId = `point-${number}` | 'barTop' | 'barBottom' | 'offLight' | 'offDark';
/** Every grid area: the places plus the dice slot. */
export type Area = PlaceId | 'dice';
/** A grid rectangle in 1-based grid lines, as CSS `grid-area: row / col / row + rowSpan / col + colSpan`. */
export type Cell = Readonly<{ row: number; col: number; rowSpan: number; colSpan: number }>;
/**
 * The safe-area insets a phone reports (`env(safe-area-inset-*)`), in px; 0 in headless. Sideways
 * the notch is `left` and `right` and the home indicator `bottom`; upright the notch is `top`
 * (installed; 0 in a tab, where the browser's bar owns that edge) and the indicator `bottom`.
 */
export type Insets = Readonly<{ top?: number; left: number; right: number; bottom: number }>;
/**
 * What the CSS keys on: the viewport, whether the pointer is coarse (`(any-pointer: coarse)`; a
 * finger, false in every desktop context and in headless without `hasTouch`) and the insets.
 */
export type Viewport = Readonly<{
  width: number;
  height: number;
  coarse?: boolean;
  insets?: Insets;
}>;

/** theme.css lays the board flat from this width (`@media (min-width: 900px)`). */
export const DESKTOP_MIN_WIDTH = 900;
/** theme.css's landscape query: a coarse pointer, wider than tall, at most this tall. */
export const LANDSCAPE_MAX_HEIGHT = 500;
/**
 * From this width the landscape chrome's buttons are a rail beside the board (`(min-width: 714px)`);
 * under it they are a row under the board: 13 x 44 (twelve points and the bar at the floor) + the
 * 44px tray + the 16px frame + two 16px edges + the 44px rail + its 6px gap.
 */
export const RAIL_MIN_WIDTH = 714;
/**
 * The layout a viewport gets: `landscape` for a coarse pointer wider than tall and at most 500px
 * tall (a phone sideways, whatever its width: a Pixel 8 is 915 wide), else the width rule. A bare
 * width is the width rule alone (callers with no height or pointer).
 */
export const layoutFor = (vp: Viewport | number): Layout => {
  if (typeof vp === 'number') return vp >= DESKTOP_MIN_WIDTH ? 'desktop' : 'phone';
  const landscape = vp.coarse === true && vp.width > vp.height && vp.height <= LANDSCAPE_MAX_HEIGHT;
  return landscape ? 'landscape' : layoutFor(vp.width);
};

/** Five checkers are drawn; the sixth onward is the count badge on the top one (design §3.4). */
export const MAX_DRAWN = 5;
export const visibleOf = (count: number): number => Math.max(0, Math.min(count, MAX_DRAWN));
/** The corner the point label keeps, in px, which the coin run along a phone point spares. */
export const LABEL_CORNER = 20;
/**
 * `--stack-step`: the distance between coin centres. On a phone five coins fit along a point with
 * the label corner spared (27.6px at 390x844); on the desktop the run is longer than five
 * touching coins, so the `min` is the checker itself (touching, classic). `spare` is what the run
 * leaves at the point's ends: the phone's label corner, or the landscape's 18px (the desktop's
 * 15px base offset and 3px at the tip).
 */
export const stackStep = (pointLen: number, checkerD: number, spare = LABEL_CORNER): number =>
  Math.min(checkerD, (pointLen - checkerD - spare) / 4);
/** How far a stack of `count` reaches along its axis: the oracle's `stackExtent(n) <= pointLen`. */
export const stackExtent = (count: number, checkerD: number, step: number): number =>
  count <= 0 ? 0 : checkerD + (visibleOf(count) - 1) * step;

/**
 * The phone upright (design §3.1 phone, §3.10). The shell pads #app by its clearance (the trim's
 * 6px band, the 1px hairline, 5px of air: 12) or the safe-area inset where that is more (the notch
 * above once installed, the home indicator below; docs/design/screen-frame.md §3); the chrome
 * inside the screen is the topbar, the status line, the controls and three 8px gaps (`chromeIn`,
 * 146) plus 2px of slack for rounding; the board is twelve point rows, the bar band, the off row
 * and the frame. The CSS measures the room (#app is a size container at the table, #tableScreen
 * reads `100cqh`); the twin computes it from the viewport less the paddings (`uprightRoom`). At
 * most `scrollMaxHeight` tall the document scrolls and the board takes the 44px floor (design §6;
 * the floor's board and the inset-free chrome need 806, and the media query reads the viewport,
 * so the insets do not move it); above it the room decides, capped at 64, and there is no floor: a
 * floor the room cannot hold would push the controls under the indicator's band, which was the
 * notch's defect. The four smallest notched classes installed get 39.8-43.7px rows, each still
 * 147-152px long (the tap target is the whole row).
 */
export const PHONE_GEOMETRY = {
  clearance: 12,
  chromeIn: 146,
  slack: 2,
  barW: 48,
  offH: 44,
  frame: 16,
  rows: 12,
  minPointW: 44,
  maxPointW: 64,
  scrollMaxHeight: 805,
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
/**
 * A phone held sideways (design §3.1 landscape): the width is thirteen points (twelve and the
 * bar), the tray and the frame inside what the chrome leaves beside the board; the height two
 * point rows inside what it leaves above and below. One 24px strip over the board in both schemes
 * (`stripH`, theme.css `--strip-h`) with the same air on each side of it (`air`, `--air`: between
 * the trim's hairline and the strip, and the grid's row gap between the strip and the board, so
 * the letters, centred in the row, stand as far under the hairline as over the board); #app
 * padding `trim + air` above it (11: the trim's 6px band and its hairline, then the air) and
 * `max(11px, 6px + inset-b)` below the board (`padBottom` the least, `padAir` what the home
 * indicator's band gets over it); the buttons decide the scheme, by width (`RAIL_MIN_WIDTH`): the
 * rail (a 44px rail beside the board with a 6px column gap: `chromeIn` 28 inside the screen, the
 * strip and its air, 50px of chrome above and below inset-free, 50 beside, plus the edges) and the
 * rows (a 44px button row under the board with the air over it: `chromeIn` 76, 98px above and
 * below, nothing beside but the edges). `chromeAbove` is the chrome's share over the board (the
 * strip and its air in both), the rest sits under it. The edge is one number for both sides, the
 * larger inset or 16px. The CSS measures the board's room (`#tableScreen` is a size container,
 * `#board` reads `100cqh`); the twin computes the same from the viewport's height less the chrome.
 */
const STRIP_H = 24;
const AIR = 4;
/** The trim's 6px band and its 1px hairline (theme.css spells the 7 in `--pad-t` too). */
const TRIM = 7;
/** The rows scheme's button row under the board (`--btn-h`). */
const BTN_H = 44;
export const LANDSCAPE_GEOMETRY = {
  minEdge: 16,
  stripH: STRIP_H,
  air: AIR,
  rail: {
    beside: 50,
    padTop: TRIM + AIR,
    padBottom: TRIM + AIR,
    padAir: 6,
    chromeIn: STRIP_H + AIR,
    chromeAbove: STRIP_H + AIR,
    minPointLen: 104,
  },
  rows: {
    beside: 0,
    padTop: TRIM + AIR,
    padBottom: TRIM + AIR,
    padAir: 6,
    chromeIn: STRIP_H + AIR + BTN_H + AIR,
    chromeAbove: STRIP_H + AIR,
    minPointLen: 90,
  },
  trayW: 44,
  frame: 16,
  columns: 13,
  minPointW: 44,
  maxPointW: 64,
  checkerRatio: 0.86,
  stackSpare: 18,
} as const;
const clamp = (lo: number, x: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const schemeOf = (vp: Viewport) =>
  vp.width >= RAIL_MIN_WIDTH ? LANDSCAPE_GEOMETRY.rail : LANDSCAPE_GEOMETRY.rows;
/** `--edge`: the gutter on each side sideways, `max(16px, inset-l, inset-r)`. */
export const edgeOf = (vp: Viewport): number =>
  Math.max(LANDSCAPE_GEOMETRY.minEdge, vp.insets?.left ?? 0, vp.insets?.right ?? 0);
/** `--chrome-w` sideways: both edges and, with the rail, the rail and its gap (82px inset-free; 32 with the rows). */
export const chromeWidth = (vp: Viewport): number => 2 * edgeOf(vp) + schemeOf(vp).beside;
/** #app's vertical paddings upright, the shell's rule: `max(clearance, inset)` above and below (12 and 12 in a tab or headless; 47 and 34 on an iPhone 12 installed). */
export const uprightPadding = (vp: Viewport): Readonly<{ top: number; bottom: number }> => ({
  top: Math.max(PHONE_GEOMETRY.clearance, vp.insets?.top ?? 0),
  bottom: Math.max(PHONE_GEOMETRY.clearance, vp.insets?.bottom ?? 0),
});
/** What `100cqh` reads upright: #app's content box, the viewport less its paddings (820 at 390x844 inset-free, 763 installed). */
export const uprightRoom = (vp: Viewport): number => {
  const pad = uprightPadding(vp);
  return vp.height - pad.top - pad.bottom;
};
/** The upright scroll tier (design §3.10): at most 805px tall the document scrolls and the board takes the 44px floor; the CSS's media query reads the viewport, so the insets do not move it. */
export const uprightScrolls = (vp: Viewport): boolean =>
  vp.height <= PHONE_GEOMETRY.scrollMaxHeight;
/** `--point-w` in px for a viewport: 47 at 390x844, 53.5 at 1280x800, 54 at 844x390 on a phone. */
export const pointWidth = (viewport: Viewport): number => {
  const { width, height } = viewport;
  const layout = layoutFor(viewport);
  if (layout === 'phone') {
    const g = PHONE_GEOMETRY;
    if (uprightScrolls(viewport)) return g.minPointW;
    return Math.min(
      (uprightRoom(viewport) - g.chromeIn - g.slack - g.barW - g.offH - g.frame) / g.rows,
      g.maxPointW,
    );
  }
  if (layout === 'landscape') {
    const g = LANDSCAPE_GEOMETRY;
    return clamp(
      g.minPointW,
      (width - chromeWidth(viewport) - g.trayW - g.frame) / g.columns,
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
/** The upright board's height: twelve rows, the bar band, the off row and the frame (672 at 390x844; 615 installed on an iPhone 12; 636 at the floor). */
export const uprightBoardHeight = (vp: Viewport): number => {
  const g = PHONE_GEOMETRY;
  return g.rows * pointWidth(vp) + g.barW + g.offH + g.frame;
};
/**
 * Where the controls row ends upright, from the viewport's top, unscrolled: the top padding, the
 * chrome and the board (830 at 390x844: the 12px padding and 2px of slack under it; 808 installed on an iPhone 12,
 * 2px over the indicator's band). Where the viewport fits (no scroll tier) it is at most the
 * height less the bottom padding: the devices e2e's standalone probe reads it off the page.
 */
export const uprightFoot = (vp: Viewport): number =>
  uprightPadding(vp).top + PHONE_GEOMETRY.chromeIn + uprightBoardHeight(vp);
/** `#app`'s two vertical paddings at the table sideways: 11 and `max(11, 6 + inset-b)` in both schemes. */
export const paddingOf = (vp: Viewport): Readonly<{ top: number; bottom: number }> => {
  const s = schemeOf(vp);
  return { top: s.padTop, bottom: Math.max(s.padBottom, s.padAir + (vp.insets?.bottom ?? 0)) };
};
/** `--chrome-h` sideways: the paddings and the chrome inside the screen above and below the board (50 with the rail inset-free, 66 with a 21px home indicator; 98 with the rows). */
export const chromeHeight = (vp: Viewport): number => {
  const pad = paddingOf(vp);
  return pad.top + pad.bottom + schemeOf(vp).chromeIn;
};
/**
 * The board's room sideways: how far its top edge stands from the viewport's top (the padding and
 * the chrome above) and its bottom edge from the viewport's bottom (the padding and the chrome
 * below): 39 and 11 with the rail inset-free, 39 and 27 with a 21px home indicator; 39 and 59 with
 * the rows. Where the viewport fits (no fallback scroll) the board's edges sit exactly there: the
 * geometry e2e's `expectFillsRoom`.
 */
export const boardRoom = (vp: Viewport): Readonly<{ top: number; bottom: number }> => {
  const s = schemeOf(vp);
  const pad = paddingOf(vp);
  return { top: pad.top + s.chromeAbove, bottom: pad.bottom + s.chromeIn - s.chromeAbove };
};
/**
 * `--point-len` sideways: half of what the chrome leaves (with the frame taken), floored per
 * scheme (104 with the rail, 90 with the rows, each less half of what the bottom inset adds to
 * the paddings, so the floor's viewport stays 274 / 294 at any inset and the CSS fallback, which
 * cannot read the inset, lifts exactly there; under the floor the document scrolls, design §3.10).
 * 162 at 844x390, 130.5 at 667x375, 96 at 812x274 with a 21px home indicator.
 */
export const pointLength = (vp: Viewport): number => {
  const s = schemeOf(vp);
  const pad = paddingOf(vp);
  const floor = s.minPointLen - (pad.top + pad.bottom - s.padTop - s.padBottom) / 2;
  return Math.max(floor, (vp.height - chromeHeight(vp) - LANDSCAPE_GEOMETRY.frame) / 2);
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
/** The template a layout draws: the phone's, or the flat one the desktop and the landscape share. */
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
