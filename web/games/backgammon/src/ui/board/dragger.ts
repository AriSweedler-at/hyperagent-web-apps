// A checker dragged by hand (design §2.4.12 "Drag (optional, gin's dragger)"): gin's
// ui/hand/dragger.ts reshaped for a disc. Tap-to-move is the primary input; this is the second
// one, bound once to `#board`. A press on the top checker of a container that can move starts a
// session; once the pointer has moved DRAG_THRESHOLD the drag begins: `checker/dragStart {from}`
// (the reducer selects the source, so the target discs light), and a clone of the checker, the
// ghost, is fixed over it and follows the pointer. A disc has no lean and needs no momentum, so
// the ghost tracks the pointer directly, frame for frame with the events. Every move hit-tests
// the pointer against the lit targets (`.target`, `.target-2`, a tray with `.target`) and says
// which one it is over when that changes (`checker/dragOver`; the painter marks it `drop`). On
// release over a target `checker/dragEnd` goes out at once and the repaint places the checker; off
// every target the ghost glides back first (LAND_MS) and the end clears the selection. The click a
// release fires is the reducer's to ignore while its `drag` stands. Only the DOM edge is reached.
import {
  addClass,
  afterTransition,
  capturePointer,
  cloneInto,
  closestFrom,
  dataOf,
  hasClass,
  listen,
  pointerOf,
  queryAllIn,
  rectOf,
  releasePointer,
  removeClass,
  removeElement,
  requireId,
  setStyle,
  type Element,
  type PageLike,
  type Rect,
} from '../../../../../shared/edge/dom.ts';
import { POINT_INDICES, type PointIndex } from '../../engine/index.ts';

/** The intents the drag raises; ui/state.ts's `TableIntent` includes them. */
export type DragIntent =
  | Readonly<{ type: 'checker/dragStart'; from: PointIndex | 'bar' }>
  | Readonly<{ type: 'checker/dragOver'; over: PointIndex | 'off' | null }>
  | Readonly<{ type: 'checker/dragEnd' }>;
export type DragDispatch = (intent: DragIntent) => void;

/** Pixels the pointer moves before a press is a drag (a tap moves less). */
export const DRAG_THRESHOLD = 8;
/** The ghost's glide back to its checker on a release over no target. */
export const LAND_MS = 180;

type Point = Readonly<{ x: number; y: number }>;
type Session = Readonly<{
  from: PointIndex | 'bar';
  pointerId: number;
  /** Where the press began: the ghost's translate is from here. */
  start: Point;
  /** The checker pressed, and its rect when the ghost was made (the ghost's fixed position). */
  checker: Element;
  base: Rect;
  moving: boolean;
  landing: boolean;
  ghost: Element | null;
  over: PointIndex | 'off' | null;
}>;

const px = (n: number): string => `${String(Math.round(n * 100) / 100)}px`;
const inside = (r: Rect, p: Point): boolean =>
  (r.width > 0 || r.height > 0) &&
  p.x >= r.left &&
  p.x <= r.left + r.width &&
  p.y >= r.top &&
  p.y <= r.top + r.height;
const translate = (from: Point, to: Point): string =>
  `translate(${px(to.x - from.x)}, ${px(to.y - from.y)})`;

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
  /* eslint-disable functional/immutable-data -- one drag at a time: a cell holding the session,
     replaced whole by every pointer event, as gin's dragger keeps its own */
  const board = requireId(doc, 'board');
  const held: { s: Session | null } = { s: null };
  /** The lit target under the pointer, or null. */
  const targetAt = (p: Point): PointIndex | 'off' | null => {
    const hit = queryAllIn(board, '.target, .target-2').find((t) => inside(rectOf(t), p));
    return hit === undefined ? null : destinationOf(hit);
  };

  /** The press becomes a drag at `p`: the source is selected, the ghost is made and captured. */
  const begin = (s: Session, p: Point): Session => {
    dispatch({ type: 'checker/dragStart', from: s.from });
    const base = rectOf(s.checker);
    const ghost = cloneInto(doc.body, s.checker);
    if (ghost === null) return { ...s, moving: true, start: p, base };
    addClass(ghost, 'drag-ghost');
    removeClass(ghost, 'top', 'selected');
    // The ghost sits on the body, outside the board's `--checker-d`: it takes the checker's
    // measured size as its own, as gin's ghost takes `--card-w`.
    setStyle(ghost, '--checker-d', px(base.width));
    setStyle(ghost, 'left', px(base.left));
    setStyle(ghost, 'top', px(base.top));
    setStyle(ghost, 'width', px(base.width));
    setStyle(ghost, 'height', px(base.height));
    capturePointer(board, s.pointerId);
    return { ...s, moving: true, start: p, base, ghost };
  };

  const end = (): void => {
    const s = held.s;
    if (s === null || s.landing) return;
    if (!s.moving) {
      // A tap: the click does its work.
      held.s = null;
      return;
    }
    held.s = { ...s, landing: true };
    releasePointer(board, s.pointerId);
    const ghost = s.ghost;
    const finish = (): void => {
      if (ghost !== null) removeElement(ghost);
      held.s = null;
      dispatch({ type: 'checker/dragEnd' });
    };
    // Over a target the repaint places the checker: no glide.
    if (ghost === null || s.over !== null) {
      finish();
      return;
    }
    addClass(ghost, 'landing');
    setStyle(ghost, 'transform', 'translate(0px, 0px)');
    afterTransition(ghost, finish, LAND_MS + 60);
  };

  const press = (e: Readonly<Event>): void => {
    if (held.s !== null) return;
    const checker = closestFrom(e, '.checker.top');
    const container = closestFrom(e, '.can-move');
    if (checker === null || container === null) return;
    const from = sourceOf(container);
    if (from === null) return;
    const p = pointerOf(e);
    held.s = {
      from,
      pointerId: p.id,
      start: p,
      checker,
      base: rectOf(checker),
      moving: false,
      landing: false,
      ghost: null,
      over: null,
    };
  };

  const move = (e: Readonly<Event>): void => {
    const pressed = held.s;
    if (pressed === null || pressed.landing) return;
    const p = pointerOf(e);
    if (
      !pressed.moving &&
      Math.hypot(p.x - pressed.start.x, p.y - pressed.start.y) < DRAG_THRESHOLD
    )
      return;
    const s = pressed.moving ? pressed : begin(pressed, p);
    if (s.ghost !== null) setStyle(s.ghost, 'transform', translate(s.start, p));
    const over = targetAt(p);
    held.s = { ...s, over };
    if (over !== s.over) dispatch({ type: 'checker/dragOver', over });
  };

  listen(board, 'pointerdown', press);
  listen(board, 'pointermove', move);
  ['pointerup', 'pointercancel'].forEach((type) => {
    listen(board, type, end);
  });
  /* eslint-enable functional/immutable-data */
};
