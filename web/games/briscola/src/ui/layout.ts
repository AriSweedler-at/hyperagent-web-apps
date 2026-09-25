// The pure twin of the table's CSS (docs/design/briscola.md §5.3, §5.6 "Geometry oracle"; the shape
// of backgammon's ui/board/layout.ts). theme.css sizes every card from `--card-w`, a clamp() of the
// viewport, and the pack's `--aspect`; places the other seats in three relative cells; fans the
// trick by `--fan-overlap` and 4° per card; and lies the briscola across under the stock, rotated
// about its centre and slid 0.55 of a width outward. This module holds the same numbers as data and
// the same seat mapping, so the geometry e2e (e2e/fixtures/briscola-geometry.ts) and the painter
// tests have an oracle for where every box must be and how tall the column is, and a change to a
// clamp in theme.css is a change here too (the test names each constant). Pure: imports the
// engine's seat types and nothing else; no DOM.
import type { Seat, SeatCount } from '../engine/index.ts';

export type Layout = 'phone' | 'desktop';
export type Viewport = Readonly<{ width: number; height: number }>;
/** A rectangle in CSS px, as getBoundingClientRect reads it. */
export type Box = Readonly<{ x: number; y: number; w: number; h: number }>;

/** theme.css lays the score strip beside the band and widens #app from this width (`@media (min-width: 900px)`). */
export const DESKTOP_MIN_WIDTH = 900;
export const layoutFor = (width: number): Layout =>
  width >= DESKTOP_MIN_WIDTH ? 'desktop' : 'phone';

/** The deck's nominal aspect (linea, the Bergamo cut) and the range the layout is designed for (D13). */
export const DEFAULT_ASPECT = 0.518;
export const ASPECT_RANGE = { min: 0.5, max: 0.62 } as const;

/**
 * theme.css `#tableScreen` on a phone: `--card-w: clamp(72px, min((100vw - 56px) / 3, (100dvh -
 * 560px) * aspect), 124px)`. `fixedH` is everything in the column that is not a card (#app padding
 * 24, topbar 44, seats 86, the band's 30px of label and chips, score strip 44, status 22, hand header
 * 24, hand padding 14, actions 54, five 8px gaps, the hand area's 16px of padding).
 */
export const PHONE_GEOMETRY = {
  gutters: 56,
  columns: 3,
  chromeH: 560,
  minCardW: 72,
  maxCardW: 124,
  tinyW: 26,
  fixedH: 398,
  seatsH: 86,
} as const;
/** From 900px: `clamp(80px, (100dvh - 522px) * aspect, 132px)`; #app padding 32, seats 96, a 200px score column. */
export const DESKTOP_GEOMETRY = {
  chromeH: 522,
  minCardW: 80,
  maxCardW: 132,
  tinyW: 30,
  fixedH: 362,
  seatsH: 96,
  scoreW: 200,
} as const;
/** `--mid-w`: the fan, the stock and the briscola draw at this fraction of a hand card. */
export const MID_RATIO = 0.62;
/** The centre band is a mid card plus this: the stock's label beneath, the fan's chips. */
export const BAND_EXTRA = 30;
/** The rows above the hand keep these heights in every phase (theme.css; the oracle's frame). */
export const ROW_HEIGHTS = {
  topbar: 44,
  score: 44,
  status: 22,
  handHeader: 24,
  actions: 54,
} as const;

const clamp = (lo: number, x: number, hi: number): number => Math.min(hi, Math.max(lo, x));
/** `--card-w` in px for a viewport and a pack's aspect: 111.3 at 390x844, 132 at 1280x800, 72 at 375x667 (the floor). */
export const cardWidth = (viewport: Viewport, aspect: number = DEFAULT_ASPECT): number => {
  const { width, height } = viewport;
  if (layoutFor(width) === 'phone') {
    const g = PHONE_GEOMETRY;
    return clamp(
      g.minCardW,
      Math.min((width - g.gutters) / g.columns, (height - g.chromeH) * aspect),
      g.maxCardW,
    );
  }
  const g = DESKTOP_GEOMETRY;
  return clamp(g.minCardW, (height - g.chromeH) * aspect, g.maxCardW);
};
export const cardHeight = (cardW: number, aspect: number = DEFAULT_ASPECT): number =>
  cardW / aspect;
export const midWidth = (cardW: number): number => cardW * MID_RATIO;
export const tinyWidth = (layout: Layout): number =>
  layout === 'phone' ? PHONE_GEOMETRY.tinyW : DESKTOP_GEOMETRY.tinyW;
/** The centre band's height: a mid card and BAND_EXTRA. */
export const bandHeight = (cardW: number, aspect: number = DEFAULT_ASPECT): number =>
  cardHeight(midWidth(cardW), aspect) + BAND_EXTRA;
/** The table column's height for a viewport: what must fit in `height` for the page not to scroll. */
export const columnHeight = (viewport: Viewport, aspect: number = DEFAULT_ASPECT): number => {
  const w = cardWidth(viewport, aspect);
  const fixed =
    layoutFor(viewport.width) === 'phone' ? PHONE_GEOMETRY.fixedH : DESKTOP_GEOMETRY.fixedH;
  return fixed + cardHeight(w, aspect) + cardHeight(midWidth(w), aspect);
};
/** No scroll: the column fits the viewport (theme.css's short-viewport fallbacks begin where it does not). */
export const fits = (viewport: Viewport, aspect: number = DEFAULT_ASPECT): boolean =>
  columnHeight(viewport, aspect) <= viewport.height;

// ---- the seats --------------------------------------------------------------------------------------

/** The three relative cells of #seats: R1 plays after me (right), R2 sits across (top), R3 before me (left). */
export type Cell = 'R1' | 'R2' | 'R3';
export const CELLS: ReadonlyArray<Cell> = ['R1', 'R2', 'R3'];
export type SeatPos = 'right' | 'top' | 'left';
/** Each cell's `data-pos`, the grid area the markup places it in (`"left top right"`). */
export const CELL_POS: Readonly<Record<Cell, SeatPos>> = { R1: 'right', R2: 'top', R3: 'left' };
/** The element id of a cell (`#seatR2`). */
export const cellId = (cell: Cell): string => `seat${cell}`;
/** The relative index of a seat from my perspective: 0 is me, 1 plays next. */
export const relativeOf = (n: SeatCount, me: Seat, seat: Seat): number => (seat - me + n) % n;
/**
 * Which cell a relative index `r` (1..n-1) takes: at two the one opponent sits across; at three the
 * next player is at the right and the other at the left; at four the partner sits across.
 */
export const cellOf = (n: SeatCount, r: number): Cell | null => {
  if (r <= 0 || r >= n) return null;
  if (n === 2) return 'R2';
  if (n === 3) return r === 1 ? 'R1' : 'R3';
  return r === 1 ? 'R1' : r === 2 ? 'R2' : 'R3';
};
/** The absolute seat behind each cell, null for a cell the count leaves empty (design §5.2 `seatCells`). */
export const seatCells = (n: SeatCount, me: Seat): Readonly<Record<Cell, Seat | null>> =>
  Object.fromEntries(
    CELLS.map((cell) => {
      const r = Array.from({ length: n - 1 }, (_, i) => i + 1).find((k) => cellOf(n, k) === cell);
      return [cell, r === undefined ? null : (((me + r) % n) as Seat)];
    }),
  ) as Record<Cell, Seat | null>;

// ---- the trick fan ----------------------------------------------------------------------------------

/**
 * `--fan-overlap` by seat count (`#trick[data-players]`): none at two, .35 of a card at three, .45
 * at four (the design's .6 left a 28px strip per card, too narrow for its `.who` chip).
 */
export const FAN_OVERLAP: Readonly<Record<SeatCount, number>> = { 2: 0, 3: 0.35, 4: 0.45 };
/** The visible strip of an overlapped card, where its chip centres: `midW * (1 - overlap)`. */
export const fanStep = (n: SeatCount, midW: number): number => midW * (1 - FAN_OVERLAP[n]);
/** Each card tilts this much more than the one before, about the fan's middle. */
export const FAN_STEP_DEG = 4;
/** Card i of n: `(i - (n - 1) / 2) * 4deg`, so two cards tilt ±2° and the middle of an odd fan is upright. */
export const fanAngle = (i: number, n: number): number => (i - (n - 1) / 2) * FAN_STEP_DEG;
/** The fan's width once every seat has played: a mid card plus the visible strip of each later one. */
export const fanWidth = (n: SeatCount, midW: number): number => midW + (n - 1) * fanStep(n, midW);

// ---- the stock and the briscola ---------------------------------------------------------------------

/** How far the briscola's centre slides outward from the stock's, in widths of a mid card. */
export const BRISCOLA_SHIFT = 0.55;
/**
 * `.stock-area`'s width, from the stock's left edge to the briscola's far edge: half the stock, the
 * slide, and half the card's height (theme.css: `1.05 * --mid-w + --mid-w / --aspect / 2`).
 */
export const stockAreaWidth = (midW: number, aspect: number = DEFAULT_ASPECT): number =>
  midW * (0.5 + BRISCOLA_SHIFT) + cardHeight(midW, aspect) / 2;
/**
 * The briscola's box from the stock card's: rotated 90° about the same centre (width and height
 * swap) and slid BRISCOLA_SHIFT widths to the right, as theme.css's transform draws it.
 */
export const briscolaBox = (stock: Box): Box => ({
  x: stock.x + stock.w / 2 + BRISCOLA_SHIFT * stock.w - stock.h / 2,
  y: stock.y + stock.h / 2 - stock.w / 2,
  w: stock.h,
  h: stock.w,
});
/** The share of `b`'s area that `a` covers: the oracle's "the stock hides 40-60% of the briscola". */
export const coveredFraction = (a: Box, b: Box): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w <= 0 || h <= 0 || b.w * b.h === 0 ? 0 : (w * h) / (b.w * b.h);
};
/** Two boxes' aspect ratios within `tol` of each other (the oracle's 2% on every unrotated card). */
export const sameAspect = (box: Box, aspect: number, tol = 0.02): boolean =>
  Math.abs(box.w / box.h - aspect) <= aspect * tol;

// ---- the grid ---------------------------------------------------------------------------------------

/** The table's grid areas, top to bottom (`#tableScreen`'s `grid-template-areas`). */
export type Area = 'top' | 'seats' | 'center' | 'score' | 'status' | 'hand';
export const AREAS: ReadonlyArray<Area> = ['top', 'seats', 'center', 'score', 'status', 'hand'];
/** The phone's one column, and the desktop's two where the score strip stands beside the band. */
export const PHONE_TEMPLATE: ReadonlyArray<ReadonlyArray<Area>> = AREAS.map((a) => [a]);
export const DESKTOP_TEMPLATE: ReadonlyArray<ReadonlyArray<Area>> = [
  ['top', 'top'],
  ['seats', 'seats'],
  ['center', 'score'],
  ['status', 'status'],
  ['hand', 'hand'],
];
export const templateFor = (layout: Layout): ReadonlyArray<ReadonlyArray<Area>> =>
  layout === 'phone' ? PHONE_TEMPLATE : DESKTOP_TEMPLATE;
/** The areas in visual order, top to bottom, left to right, each once: the oracle's frame order. */
export const areaOrder = (layout: Layout): ReadonlyArray<Area> =>
  templateFor(layout)
    .flat()
    .filter((a, i, all: ReadonlyArray<Area>) => all.indexOf(a) === i);
