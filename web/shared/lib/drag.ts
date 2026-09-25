// The pure numbers of a pointer drag (docs/design/dry-round-2.md E1): the threshold that turns a
// press into a drag and the hit-test both games' draggers had spelled. They live here, DOM-free,
// rather than in the kernel (web/shared/edge/drag.ts, which re-exports them) because gin's
// ui/hand/drag.ts (the momentum's maths) imports them and is itself imported by ui/state.ts, which
// tsconfig.node.json compiles without a DOM lib: the edge, over dom.ts, is out of its reach.
export type Point = Readonly<{ x: number; y: number }>;
export type Rect = Readonly<{ left: number; top: number; width: number; height: number }>;

/** Pixels the pointer moves before a press is a drag (a tap or a long press moves less). */
export const DRAG_THRESHOLD = 8;

export const startedDrag = (from: Point, to: Point): boolean =>
  Math.hypot(to.x - from.x, to.y - from.y) >= DRAG_THRESHOLD;

/** `p` within `r`, edges included; a rect with no size (a fake's, an unmeasured element's) holds nothing. */
export const inside = (r: Rect, p: Point): boolean =>
  (r.width > 0 || r.height > 0) &&
  p.x >= r.left &&
  p.x <= r.left + r.width &&
  p.y >= r.top &&
  p.y <= r.top + r.height;
