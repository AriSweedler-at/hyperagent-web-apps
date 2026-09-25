// A checker dragged by hand (design §4.12 "Drag"): what backgammon tells the shared pointer-drag
// kernel (web/shared/edge/drag.ts, docs/design/dry-round-2.md E1; the gesture, the ghost, the
// capture and the landing are its). Tap-to-move is the primary input; this is the second one,
// bound once to `#board`. A press on the top checker of a container that can move starts a
// session; past DRAG_THRESHOLD `checker/dragStart {from}` goes out (the reducer selects the
// source, so the target discs light) and the ghost, the checker's clone, follows the pointer
// directly (a disc has no lean and needs no momentum: the kernel's default motion, frame for frame
// with the events). Every move hit-tests the pointer against the lit targets (`.target`,
// `.target-2`, a tray with `.target`) and says which one it is over when that changes
// (`checker/dragOver`; the painter marks it `drop`). On release over a target `checker/dragEnd`
// goes out at once and the repaint places the checker; off every target the ghost glides back
// first (LAND_MS) and the end clears the selection. The click a release fires is the reducer's to
// ignore while its `drag` stands. Only the DOM edge is reached.
import {
  closestFrom,
  dataOf,
  hasClass,
  queryAllIn,
  rectOf,
  requireId,
  type Element,
  type PageLike,
} from '../../../../../shared/edge/dom.ts';
import {
  DRAG_THRESHOLD,
  LAND_MS,
  bindDrag as bindDragKernel,
  inside,
  type Point,
} from '../../../../../shared/edge/drag.ts';
import { POINT_INDICES, type PointIndex } from '../../engine/index.ts';

/** The intents the drag raises; ui/state.ts's `TableIntent` includes them. */
export type DragIntent =
  | Readonly<{ type: 'checker/dragStart'; from: PointIndex | 'bar' }>
  | Readonly<{ type: 'checker/dragOver'; over: PointIndex | 'off' | null }>
  | Readonly<{ type: 'checker/dragEnd' }>;
export type DragDispatch = (intent: DragIntent) => void;

/** The kernel's: pixels before a press is a drag, and the ghost's glide back on a release over no target. */
export { DRAG_THRESHOLD, LAND_MS };

/** The absolute point of a `.point` (`data-abs` is 1-based), null for anything else. */
const absOf = (el: Element): PointIndex | null => {
  const n = Number(dataOf(el, 'abs')) - 1;
  return POINT_INDICES.find((abs) => abs === n) ?? null;
};
/** What a container is as a drag source: my bar or a point. */
const sourceOf = (container: Element): PointIndex | 'bar' | null =>
  hasClass(container, 'bar') ? 'bar' : absOf(container);
/** What a lit target is as a destination: the tray or a point. */
const destinationOf = (target: Element): PointIndex | 'off' | null =>
  hasClass(target, 'off') ? 'off' : absOf(target);

/** The drag over `#board`, bound once at boot beside the tap. */
export const bindDrag = (doc: PageLike, dispatch: DragDispatch): void => {
  const board = requireId(doc, 'board');
  /** The lit target under the pointer, or null. */
  const targetAt = (p: Point): PointIndex | 'off' | null => {
    const hit = queryAllIn(board, '.target, .target-2').find((t) => inside(rectOf(t), p));
    return hit === undefined ? null : destinationOf(hit);
  };
  bindDragKernel<PointIndex | 'bar', PointIndex | 'off', DragIntent>(doc, dispatch, {
    surfaces: [board],
    pick: (e) => {
      const checker = closestFrom(e, '.checker.top');
      const container = closestFrom(e, '.can-move');
      if (checker === null || container === null) return null;
      const from = sourceOf(container);
      return from === null ? null : { key: from, el: checker };
    },
    targetAt,
    onStart: (s) => [{ type: 'checker/dragStart', from: s.key }],
    onOver: (s) => [{ type: 'checker/dragOver', over: s.over }],
    onEnd: () => [{ type: 'checker/dragEnd' }],
    // Over a target the repaint places the checker: no glide; off every one the ghost glides back
    // to where its checker stands.
    land: (s) => (s.over === null ? s.base : null),
    // The ghost sits on the body, outside the board's `--checker-d`: it takes the checker's
    // measured size as its own, as gin's ghost takes `--card-w`.
    ghost: { sizeVar: '--checker-d', strip: ['top', 'selected'] },
  });
};
