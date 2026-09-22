// A loose card dragged by hand (docs/design/gin-arrangement-and-discards.md §5d; the owner: "you
// can pull it left quickly and it will tilt to the left a bit. And the cards shouldn't immediately
// snap around"): the pointer events on `#hand`, the ghost that follows the pointer, and the
// landing. A press on a loose card starts a session; once the pointer has moved DRAG_THRESHOLD the
// drag begins: the long press is cancelled, `card/dragStart` empties the card's cell (the paint
// marks it `dragging`), and a clone of the card, the ghost, is fixed over it and follows the
// pointer frame by frame with the motion of drag.ts (momentum and lean). Every pointer move asks
// `dropIndex` where the card would land and dispatches `card/dragOver` when that changed, so the
// other loose cards glide aside (flip.ts) as it passes. On release the ghost glides to the card's
// cell and, landed, is removed as `card/dragEnd` shows the card again; the click that a release
// fires is ignored by the reducer while the drag stands. A press that never moves is a tap or a
// long press, as before. Only the DOM edge is reached (docs/ARCHITECTURE.md "Module boundaries").
import {
  addClass,
  afterTransition,
  capturePointer,
  cloneInto,
  closestFrom,
  closestIn,
  dataOf,
  hasClass,
  listen,
  nextFrame,
  pointerOf,
  queryAllIn,
  queryIn,
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
import {
  at,
  dropIndex,
  follow,
  ghostTransform,
  startedDrag,
  type Motion,
  type Point,
} from './drag.ts';

/** The intents the drag raises; ui/state.ts's `Intent` includes them. */
export type DragIntent =
  | Readonly<{ type: 'card/release' }>
  | Readonly<{ type: 'card/dragStart'; cardId: string }>
  | Readonly<{ type: 'card/dragOver'; index: number }>
  | Readonly<{ type: 'card/dragEnd' }>;
export type DragDispatch = (intent: DragIntent) => void;

/** The ghost's glide to its cell on release. */
export const LAND_MS = 180;

type Session = Readonly<{
  cardId: string;
  pointerId: number;
  /** Where the press began, and where the drag did (the ghost's translate is from here). */
  start: Point;
  grab: Point;
  /** The card's rect when the ghost was made: the ghost's fixed position. */
  base: Rect;
  moving: boolean;
  landing: boolean;
  ghost: Element | null;
  motion: Motion;
  target: Point;
  index: number;
}>;

const px = (n: number): string => `${String(n)}px`;

/** The drag over `#hand`, bound once at boot beside the tap and the long press. */
export const bindDrag = (doc: PageLike, dispatch: DragDispatch): void => {
  /* eslint-disable functional/immutable-data -- one drag at a time: a cell holding the session,
     replaced whole by every pointer event and frame, as boot.ts keeps its cells */
  const hand = requireId(doc, 'hand');
  const held: { s: Session | null } = { s: null };
  const looseCells = (): ReadonlyArray<Element> => queryAllIn(hand, ':scope > .slot.dead');
  const cardOf = (id: string): Element | null => queryIn(hand, `.card[data-card="${id}"]`);

  const frame = (): void => {
    const s = held.s;
    if (s === null) return;
    if (s.landing || s.ghost === null) return;
    const motion = follow(s.motion, s.target);
    held.s = { ...s, motion };
    setStyle(s.ghost, 'transform', ghostTransform(motion, s.grab));
    nextFrame(frame);
  };

  /** The press becomes a drag at `p`: the cell empties, the ghost is made, the frames start. */
  const begin = (s: Session, p: Point): Session => {
    dispatch({ type: 'card/release' });
    dispatch({ type: 'card/dragStart', cardId: s.cardId });
    const card = cardOf(s.cardId);
    if (card === null) return { ...s, moving: true, grab: p };
    const base = rectOf(card);
    const ghost = cloneInto(doc.body, card);
    addClass(ghost, 'drag-ghost');
    removeClass(ghost, 'selected');
    setStyle(ghost, 'left', px(base.left));
    setStyle(ghost, 'top', px(base.top));
    setStyle(ghost, 'width', px(base.width));
    setStyle(ghost, 'height', px(base.height));
    capturePointer(hand, s.pointerId);
    nextFrame(frame);
    return { ...s, moving: true, grab: p, base, ghost, motion: at(p.x, p.y), target: p };
  };

  const end = (): void => {
    const s = held.s;
    if (s === null || s.landing) return;
    if (!s.moving) {
      // A tap or a long press: the click or the timer does its work.
      held.s = null;
      return;
    }
    held.s = { ...s, landing: true };
    releasePointer(hand, s.pointerId);
    const ghost = s.ghost;
    const card = cardOf(s.cardId);
    const finish = (): void => {
      if (ghost !== null) removeElement(ghost);
      held.s = null;
      dispatch({ type: 'card/dragEnd' });
    };
    if (ghost === null || card === null) {
      finish();
      return;
    }
    const cell = rectOf(card);
    addClass(ghost, 'landing');
    setStyle(
      ghost,
      'transform',
      `translate(${px(cell.left - s.base.left)}, ${px(cell.top - s.base.top)}) rotate(0deg)`,
    );
    afterTransition(ghost, finish, LAND_MS + 60);
  };

  listen(hand, 'pointerdown', (e) => {
    if (held.s !== null) return;
    const card = closestFrom(e, '.card');
    const slot = closestFrom(e, '.slot');
    if (card === null || slot === null) return;
    // Loose cards only: a meld's cards keep their cells.
    if (!hasClass(slot, 'dead') || closestIn(slot, '.group') !== null) return;
    const id = dataOf(card, 'card');
    if (id === null) return;
    const p = pointerOf(e);
    held.s = {
      cardId: id,
      pointerId: p.id,
      start: p,
      grab: p,
      base: rectOf(card),
      moving: false,
      landing: false,
      ghost: null,
      motion: at(p.x, p.y),
      target: p,
      index: -1,
    };
  });
  listen(hand, 'pointermove', (e) => {
    const pressed = held.s;
    if (pressed === null || pressed.landing) return;
    const p = pointerOf(e);
    if (!pressed.moving && !startedDrag(pressed.start, p)) return;
    const s = pressed.moving ? pressed : begin(pressed, p);
    const cells = looseCells();
    const current = cells.findIndex((c) => hasClass(c, 'dragging'));
    const index = dropIndex(p, cells.map(rectOf), current);
    held.s = { ...s, target: p, index };
    if (index !== s.index) dispatch({ type: 'card/dragOver', index });
  });
  ['pointerup', 'pointercancel'].forEach((ev) => {
    listen(hand, ev, end);
  });
  /* eslint-enable functional/immutable-data */
};
