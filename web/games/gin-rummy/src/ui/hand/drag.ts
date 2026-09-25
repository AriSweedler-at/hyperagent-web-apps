// A card dragged by hand (docs/design/gin-arrangement-and-discards.md §5d): the numbers of the
// ghost's motion, pure, plugged into the shared pointer-drag kernel (web/shared/edge/drag.ts
// `motion`, docs/design/dry-round-2.md E1; the gesture's threshold, `Point` and `Rect` are
// web/shared/lib/drag.ts's now, re-exported here for the callers that named them; this module
// stays DOM-free because ui/state.ts imports it). The ghost closes FOLLOW of
// the gap to the pointer every frame, so it trails with a little momentum, and it tilts with its
// horizontal speed (pull it left fast and it leans left), never past MAX_TILT. `dropIndex` says
// where among the loose cells the pointer would put the card: the cells are read row by row, left
// to right, as the dense grid lays them.
import {
  DRAG_THRESHOLD,
  startedDrag,
  type Point,
  type Rect,
} from '../../../../../shared/lib/drag.ts';

export { DRAG_THRESHOLD, startedDrag, type Point, type Rect };
/** The ghost's place and its speed per frame. */
export type Motion = Readonly<{ x: number; y: number; vx: number; vy: number }>;

/** The share of the gap to the pointer the ghost closes each frame. */
export const FOLLOW = 0.35;
/** Degrees of tilt per pixel of horizontal speed per frame, and the most it tilts. */
export const TILT_PER_PX = 1.2;
export const MAX_TILT = 14;

export const at = (x: number, y: number): Motion => ({ x, y, vx: 0, vy: 0 });

/** One frame: the ghost moves `share` of the way to `target`; its speed is that step. */
export const follow = (m: Motion, target: Point, share = FOLLOW): Motion => {
  const x = m.x + (target.x - m.x) * share;
  const y = m.y + (target.y - m.y) * share;
  return { x, y, vx: x - m.x, vy: y - m.y };
};

export const tiltOf = (vx: number): number =>
  Math.max(-MAX_TILT, Math.min(MAX_TILT, vx * TILT_PER_PX));

/** The ghost has caught up: within half a pixel and all but still. */
export const settled = (m: Motion, target: Point): boolean =>
  Math.abs(m.x - target.x) < 0.5 &&
  Math.abs(m.y - target.y) < 0.5 &&
  Math.abs(m.vx) < 0.05 &&
  Math.abs(m.vy) < 0.05;

const px = (n: number): string => `${String(Math.round(n * 100) / 100)}px`;
const deg = (n: number): string => `${String(Math.round(n * 100) / 100)}deg`;

/** The ghost's transform: its offset from where the drag began, and its lean. */
export const ghostTransform = (m: Motion, origin: Point, tilt = tiltOf(m.vx)): string =>
  `translate(${px(m.x - origin.x)}, ${px(m.y - origin.y)}) rotate(${deg(tilt)})`;

/** Reading order: a cell whose row lies above the pointer, or on its row with its centre at or left of it. */
const precedes = (r: Rect, p: Point): boolean =>
  r.top + r.height <= p.y || (r.top <= p.y && r.left + r.width / 2 <= p.x);

/**
 * The loose index the pointer drops the dragged card at: the count of the other loose cells
 * (`cells` in DOM order, the dragged card's own at `current`) that precede it in reading order.
 */
export const dropIndex = (p: Point, cells: ReadonlyArray<Rect>, current: number): number =>
  cells.filter((r, i) => i !== current && precedes(r, p)).length;

/**
 * Where a dragged hand card may be released to leave the hand (§5d, §7b): one of the knocker's melds
 * by index while a knock is answered, or the discard pile (the Discard button counts as the pile)
 * in the discard phase. The dragger names the target under the pointer; the reducer decides
 * whether the card may go there.
 */
export type DropTarget = number | 'discard';
