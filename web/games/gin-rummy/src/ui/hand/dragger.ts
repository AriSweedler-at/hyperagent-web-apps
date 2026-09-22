// A card dragged by hand (docs/design/gin-arrangement-and-discards.md §5d, §7b; the owner: "you
// can pull it left quickly and it will tilt to the left a bit. And the cards shouldn't immediately
// snap around"; "you should be able to click and drag to lay off … you can pick your cards back up
// from laying off"): the pointer events on `#hand` and on `#tableMelds`, the ghost that follows
// the pointer, and the landing. A press on a loose card of the hand, or on a laid-off card on the
// table, starts a session; once the pointer has moved DRAG_THRESHOLD the drag begins: the long
// press is cancelled, `card/dragStart` empties the card's place (the paint marks it `dragging`),
// and a clone of the card, the ghost, is fixed over it and follows the pointer frame by frame with
// the motion of drag.ts (momentum and lean). Every pointer move says which of the knocker's melds
// the pointer is over (`card/dragOnto`, lit where the card fits) and, for a hand card over none,
// asks `dropIndex` where it would land among the loose cards (`card/dragOver`, so the others glide
// aside). On release, `card/dragEnd` carries the meld the pointer is over: a hand card over a meld
// it fits is laid off, a table card released off the melds is taken back (the card then appears
// where it landed, dropping in), and a hand card over none glides into its cell first. The click
// a release fires is ignored by the reducer while the drag stands. A press that never moves is a
// tap or a long press, as before. Only the DOM edge is reached (docs/ARCHITECTURE.md "Module
// boundaries").
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
  | Readonly<{ type: 'card/dragStart'; cardId: string; from: 'hand' | 'table' }>
  | Readonly<{ type: 'card/dragOver'; index: number }>
  | Readonly<{ type: 'card/dragOnto'; onto: number | null }>
  | Readonly<{ type: 'card/dragEnd'; over: number | null }>;
export type DragDispatch = (intent: DragIntent) => void;

/** The ghost's glide to its cell on release. */
export const LAND_MS = 180;

type Session = Readonly<{
  cardId: string;
  from: 'hand' | 'table';
  pointerId: number;
  /** The container the press was on, which holds the pointer while the drag lasts. */
  source: Element;
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
  onto: number | null;
}>;

const px = (n: number): string => `${String(n)}px`;
const inside = (r: Rect, p: Point): boolean =>
  (r.width > 0 || r.height > 0) &&
  p.x >= r.left &&
  p.x <= r.left + r.width &&
  p.y >= r.top &&
  p.y <= r.top + r.height;

/** The drag over `#hand` and `#tableMelds`, bound once at boot beside the tap and the long press. */
export const bindDrag = (doc: PageLike, dispatch: DragDispatch): void => {
  /* eslint-disable functional/immutable-data -- one drag at a time: a cell holding the session,
     replaced whole by every pointer event and frame, as boot.ts keeps its cells */
  const hand = requireId(doc, 'hand');
  const melds = requireId(doc, 'tableMelds');
  const held: { s: Session | null } = { s: null };
  const looseCells = (): ReadonlyArray<Element> => queryAllIn(hand, ':scope > .slot.dead');
  const cardOf = (id: string): Element | null =>
    queryIn(hand, `.card[data-card="${id}"]`) ?? queryIn(melds, `.card[data-card="${id}"]`);
  /** The knocker's meld under the pointer, by index, or null. */
  const meldAt = (p: Point): number | null => {
    const i = queryAllIn(melds, '.meld-group').findIndex((g) => inside(rectOf(g), p));
    return i < 0 ? null : i;
  };

  const frame = (): void => {
    const s = held.s;
    if (s === null) return;
    if (s.landing || s.ghost === null) return;
    const motion = follow(s.motion, s.target);
    held.s = { ...s, motion };
    setStyle(s.ghost, 'transform', ghostTransform(motion, s.grab));
    nextFrame(frame);
  };

  /** The press becomes a drag at `p`: the place empties, the ghost is made, the frames start. */
  const begin = (s: Session, p: Point): Session => {
    dispatch({ type: 'card/release' });
    dispatch({ type: 'card/dragStart', cardId: s.cardId, from: s.from });
    const card = cardOf(s.cardId);
    if (card === null) return { ...s, moving: true, grab: p };
    const base = rectOf(card);
    const ghost = cloneInto(doc.body, card);
    if (ghost === null) return { ...s, moving: true, grab: p, base };
    addClass(ghost, 'drag-ghost');
    removeClass(ghost, 'selected', 'dragging');
    setStyle(ghost, 'left', px(base.left));
    setStyle(ghost, 'top', px(base.top));
    setStyle(ghost, 'width', px(base.width));
    setStyle(ghost, 'height', px(base.height));
    capturePointer(s.source, s.pointerId);
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
    releasePointer(s.source, s.pointerId);
    const ghost = s.ghost;
    const finish = (): void => {
      if (ghost !== null) removeElement(ghost);
      held.s = null;
      dispatch({ type: 'card/dragEnd', over: s.onto });
    };
    // A layoff or a take-back moves the card to another place: it drops in there; no glide.
    const card = cardOf(s.cardId);
    if (ghost === null || card === null || s.from === 'table' || s.onto !== null) {
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

  const press =
    (source: Element, from: 'hand' | 'table') =>
    (e: Readonly<Event>): void => {
      if (held.s !== null) return;
      const card = closestFrom(e, '.card');
      if (card === null) return;
      if (from === 'hand') {
        // Loose cards only: a meld's cards keep their cells.
        const slot = closestFrom(e, '.slot');
        if (slot === null || !hasClass(slot, 'dead') || closestIn(slot, '.group') !== null) return;
      } else if (!hasClass(card, 'laid')) return;
      const id = dataOf(card, 'card');
      if (id === null) return;
      const p = pointerOf(e);
      held.s = {
        cardId: id,
        from,
        pointerId: p.id,
        source,
        start: p,
        grab: p,
        base: rectOf(card),
        moving: false,
        landing: false,
        ghost: null,
        motion: at(p.x, p.y),
        target: p,
        index: -1,
        onto: null,
      };
    };
  const move = (e: Readonly<Event>): void => {
    const pressed = held.s;
    if (pressed === null || pressed.landing) return;
    const p = pointerOf(e);
    if (!pressed.moving && !startedDrag(pressed.start, p)) return;
    const s = pressed.moving ? pressed : begin(pressed, p);
    const onto = meldAt(p);
    if (onto !== s.onto) dispatch({ type: 'card/dragOnto', onto });
    // A hand card over no meld finds its place among the loose cards.
    const cells = looseCells();
    const current = cells.findIndex((c) => hasClass(c, 'dragging'));
    const index =
      s.from === 'hand' && onto === null ? dropIndex(p, cells.map(rectOf), current) : s.index;
    held.s = { ...s, target: p, onto, index };
    if (index !== s.index) dispatch({ type: 'card/dragOver', index });
  };

  listen(hand, 'pointerdown', press(hand, 'hand'));
  listen(melds, 'pointerdown', press(melds, 'table'));
  [hand, melds].forEach((source) => {
    listen(source, 'pointermove', move);
    ['pointerup', 'pointercancel'].forEach((ev) => {
      listen(source, ev, end);
    });
  });
  /* eslint-enable functional/immutable-data */
};
