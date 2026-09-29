// The safe-area map (docs/design/ui-sandbox.md §3; the owner, 2026-09-28: "when I rotate it 180
// degrees, instead of leaving that 'notch aware' area on one side, it should expand to fill that
// space ... leave that quarter circleish area untouched. But use the space between those 2 quarter
// circles on the non-notch side. As for the notch side, you can use the space above and below it.
// But not where it is"): per screen edge, the usable segments in px along the edge, computed from
// what the page and the catalogue know. Pure over `SafeAreaInputs`; the boot writes the result as
// custom properties on the root (`safeAreaVars`), and UI Sandbox draws it.
//
// The rule. An edge's span is the viewport's side less every corner arc the frame rounds
// (`corners`: the four radii the reach rule left, docs/design/screen-frame.md §4; a square corner
// spares nothing), each arc plus ARC_MARGIN. The cut (the notch or the island, web/shared/lib/devices.ts
// `Device.cut`) sits centred on one edge: sideways the short edge `screen.orientation.type` names
// (landscape-primary is the screen turned 90° counter-clockwise from upright, so the top edge, the
// cut's, is on the LEFT; landscape-secondary on the right: w3c.github.io/screen-orientation
// "current orientation angle", read 2026-09-29, VERIFIED; that iOS follows the spec's angle table is
// UNVERIFIED on a phone), an Android fullscreen cutout inset naming its side outright; upright the
// top (portrait-secondary the bottom, Android alone). The cut splits its edge in two ears, each kept
// only when at least EAR_MIN long: a tap target's height. The cut is on the page only where the page
// reaches that edge (a non-zero inset there); under a browser bar (upright in a tab: the top inset is
// 0) the edge is the browser's and stays one plain span. The map is in screen space: a body turned by
// `data-flip` reads `flipMap`, the same map mirrored through the viewport's centre.
import type { Corners, Insets, ViewportSize } from './devices.ts';

/** `screen.orientation.type`'s four values. */
export type OrientationType =
  'portrait-primary' | 'portrait-secondary' | 'landscape-primary' | 'landscape-secondary';
export const ORIENTATION_TYPES: ReadonlyArray<OrientationType> = [
  'portrait-primary',
  'portrait-secondary',
  'landscape-primary',
  'landscape-secondary',
];
export const isOrientationType = (value: string): value is OrientationType =>
  (ORIENTATION_TYPES as ReadonlyArray<string>).includes(value);

export type Edge = 'top' | 'right' | 'bottom' | 'left';
export const EDGES: ReadonlyArray<Edge> = ['top', 'right', 'bottom', 'left'];
/** A span along an edge in px from the viewport's top (a vertical edge) or left (a horizontal one). */
export type Segment = Readonly<{ from: number; to: number }>;
export const lengthOf = (s: Segment): number => s.to - s.from;

/** The cut as the catalogue spells it: its length along the edge, island or notch. */
export type Cut = Readonly<{ length: number; island: boolean }>;

export type SafeAreaInputs = Readonly<{
  /** The frame's four radii as drawn (0 where the corner is the browser's). */
  corners: Corners;
  cut: Cut | null;
  type: OrientationType;
  insets: Insets;
  /** `innerWidth x innerHeight`. */
  viewport: ViewportSize;
  /** The whole screen turned for the orientation; null where the page has no `screen`. */
  full: ViewportSize | null;
}>;

export type SafeAreaMap = Readonly<{
  /** The edge the cut is on in screen space, `none` without a cut. */
  cutEdge: Edge | 'none';
  /** Where the cut lies along its edge, in the viewport's coordinates; null where it is off the page (under a browser bar) or there is none. */
  cut: Segment | null;
  island: boolean;
  edges: Readonly<Record<Edge, ReadonlyArray<Segment>>>;
  /** The cut side's ears: the shorter one's length, 0 where none fits or the cut is not on the page. */
  ear: number;
}>;

/** The air kept off a corner arc, and off the cut. */
export const ARC_MARGIN = 4;
export const CUT_MARGIN = 6;
/** The least an ear may be: one tap target. */
export const EAR_MIN = 44;

/** The two corners an edge runs between, in the edge's direction (top to bottom, left to right). */
const CORNERS_OF: Readonly<Record<Edge, readonly [keyof Corners, keyof Corners]>> = {
  top: ['tl', 'tr'],
  right: ['tr', 'br'],
  bottom: ['bl', 'br'],
  left: ['tl', 'bl'],
};
const VERTICAL: ReadonlyArray<Edge> = ['left', 'right'];
const isVertical = (edge: Edge): boolean => VERTICAL.includes(edge);
const OPPOSITE: Readonly<Record<Edge, Edge>> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

/**
 * The edge the cut is on: sideways, the one side whose inset alone is non-zero (an Android cutout
 * fullscreen), else the orientation type's (primary left, secondary right); upright the top
 * (secondary the bottom). `none` without a cut.
 */
export const cutEdgeOf = (
  inputs: Pick<SafeAreaInputs, 'cut' | 'type' | 'insets'>,
): Edge | 'none' => {
  if (inputs.cut === null) return 'none';
  const { insets, type } = inputs;
  if (type === 'portrait-primary') return 'top';
  if (type === 'portrait-secondary') return 'bottom';
  if (insets.left > 0 && insets.right <= 0) return 'left';
  if (insets.right > 0 && insets.left <= 0) return 'right';
  return type === 'landscape-primary' ? 'left' : 'right';
};

/** An edge's length: the viewport's height for a vertical edge, its width for a horizontal one. */
const edgeLength = (edge: Edge, viewport: ViewportSize): number =>
  isVertical(edge) ? viewport.height : viewport.width;

/** An arc's reservation: the radius plus the margin, 0 where the corner is square. */
const arc = (radius: number): number => (radius > 0 ? radius + ARC_MARGIN : 0);

/**
 * Where the cut's centre falls along its edge in the viewport's coordinates: the screen's middle,
 * shifted up by a browser bar at the top (the viewport shorter than the screen and the bottom edge
 * proven the screen's by its inset, the reach rule's own reading), else the viewport's middle.
 */
const cutCentre = (edge: Edge, inputs: SafeAreaInputs): number => {
  const { viewport, full, insets } = inputs;
  if (full === null) return edgeLength(edge, viewport) / 2;
  if (!isVertical(edge)) return full.width / 2;
  const barTop = viewport.height < full.height && insets.bottom > 0;
  return full.height / 2 - (barTop ? full.height - viewport.height : 0);
};

const kept = (s: Segment): boolean => lengthOf(s) >= EAR_MIN;

/** One value per edge. */
const byEdge = <T>(fn: (edge: Edge) => T): Readonly<Record<Edge, T>> => ({
  top: fn('top'),
  right: fn('right'),
  bottom: fn('bottom'),
  left: fn('left'),
});

/**
 * The map: every edge's span between its arcs, the cut's edge split in two ears where the page
 * reaches it, each span kept when a tap target fits.
 */
export const safeAreaMap = (inputs: SafeAreaInputs): SafeAreaMap => {
  const { corners, viewport } = inputs;
  const cutEdge = cutEdgeOf(inputs);
  const onPage = cutEdge !== 'none' && inputs.insets[cutEdge] > 0;
  const cut: Segment | null =
    inputs.cut !== null && cutEdge !== 'none' && onPage
      ? (() => {
          const centre = cutCentre(cutEdge, inputs);
          const half = inputs.cut.length / 2;
          return { from: centre - half, to: centre + half };
        })()
      : null;
  const spanOf = (edge: Edge): ReadonlyArray<Segment> => {
    const [a, b] = CORNERS_OF[edge];
    const span: Segment = {
      from: arc(corners[a]),
      to: edgeLength(edge, viewport) - arc(corners[b]),
    };
    if (edge !== cutEdge || cut === null) return [span].filter(kept);
    return [
      { from: span.from, to: cut.from - CUT_MARGIN },
      { from: cut.to + CUT_MARGIN, to: span.to },
    ].filter(kept);
  };
  const edges = byEdge(spanOf);
  const ears = cutEdge === 'none' || cut === null ? [] : edges[cutEdge];
  return {
    cutEdge,
    cut,
    island: inputs.cut?.island === true,
    edges,
    ear: ears.length === 0 ? 0 : Math.min(...ears.map(lengthOf)),
  };
};

/** The map as a body turned a half turn reads it: every edge swapped for its opposite, every span mirrored through the viewport's centre. */
export const flipMap = (map: SafeAreaMap, viewport: ViewportSize): SafeAreaMap => {
  const mirror = (edge: Edge, s: Segment): Segment => {
    const n = edgeLength(edge, viewport);
    return { from: n - s.to, to: n - s.from };
  };
  const edges = byEdge((edge) => map.edges[OPPOSITE[edge]].map((s) => mirror(edge, s)));
  const cutEdge = map.cutEdge === 'none' ? 'none' : OPPOSITE[map.cutEdge];
  return {
    ...map,
    cutEdge,
    cut: map.cut === null || cutEdge === 'none' ? null : mirror(cutEdge, map.cut),
    edges,
  };
};

const px = (n: number): string => `${String(Math.round(n * 100) / 100)}px`;
const NONE: Segment = { from: 0, to: 0 };

/**
 * The custom properties the boot writes on the root: `--notch-side` (the cut's edge or `none`),
 * `--ear-height`, per edge `--safe-<edge>-count`, `--safe-<edge>-from`/`-to` (the first span, 0/0
 * for none) and `--safe-<edge>-2-from`/`-2-to` (the second: the far ear), the owner's four names
 * for the vertical edges (`--safe-left-top`, `--safe-left-bottom`, `--safe-right-top`,
 * `--safe-right-bottom`: the first span's ends), the free side sideways (`--safe-free-side`, the
 * vertical edge without the cut, with `--safe-free-from`/`-to`) and the cut's own span
 * (`--safe-cut-from`/`-to`, 0/0 off the page).
 */
export const safeAreaVars = (map: SafeAreaMap): Readonly<Record<string, string>> => {
  const perEdge = EDGES.flatMap((edge): ReadonlyArray<readonly [string, string]> => {
    const [first = NONE, second = NONE] = map.edges[edge];
    return [
      [`--safe-${edge}-count`, String(map.edges[edge].length)],
      [`--safe-${edge}-from`, px(first.from)],
      [`--safe-${edge}-to`, px(first.to)],
      [`--safe-${edge}-2-from`, px(second.from)],
      [`--safe-${edge}-2-to`, px(second.to)],
    ];
  });
  const [left = NONE] = map.edges.left;
  const [right = NONE] = map.edges.right;
  const free: Edge | 'none' =
    map.cutEdge === 'left' ? 'right' : map.cutEdge === 'right' ? 'left' : 'none';
  const [freeSpan = NONE] = free === 'none' ? [] : map.edges[free];
  const cut = map.cut ?? NONE;
  return Object.fromEntries([
    ['--notch-side', map.cutEdge],
    ['--ear-height', px(map.ear)],
    ...perEdge,
    ['--safe-left-top', px(left.from)],
    ['--safe-left-bottom', px(left.to)],
    ['--safe-right-top', px(right.from)],
    ['--safe-right-bottom', px(right.to)],
    ['--safe-free-side', free],
    ['--safe-free-from', px(freeSpan.from)],
    ['--safe-free-to', px(freeSpan.to)],
    ['--safe-cut-from', px(cut.from)],
    ['--safe-cut-to', px(cut.to)],
  ]);
};

/** True where a box's span along an edge lies inside one of the edge's segments (a button in an ear). */
export const insideSegments = (
  segments: ReadonlyArray<Segment>,
  box: Segment,
  tol = 0.5,
): boolean => segments.some((s) => box.from >= s.from - tol && box.to <= s.to + tol);
