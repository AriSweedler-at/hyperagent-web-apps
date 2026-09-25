// A card dragged from the hand to the trick (docs/design/briscola-board.md §4 "Drag"): what
// briscola tells the shared pointer-drag kernel (web/shared/edge/drag.ts, docs/design/dry-round-2.md
// E1; the gesture, the ghost, the capture and the landing are its). Tap-to-play is the primary
// input; this is the second one, bound once to `#hand`. A press on a playable card starts a
// session; past DRAG_THRESHOLD `card/dragStart {cardId}` goes out (the reducer lifts the card, so
// the trick shows `drop-ready`) and the ghost, the card's clone, follows the pointer directly.
// Every move hit-tests the pointer against `#trick` and says when it enters or leaves
// (`card/dragOver {over}`; the painter marks the trick `drop`). On release over the trick
// `card/dragEnd` goes out at once and the reducer plays the card (the repaint places it); off the
// trick the ghost glides back first (LAND_MS) and the end drops the lift. The click a release fires
// is the reducer's to ignore while its `drag` stands. Only the DOM edge is reached.
import {
  closestFrom,
  dataOf,
  hasClass,
  rectOf,
  requireId,
  type PageLike,
} from '../../../../shared/edge/dom.ts';
import {
  DRAG_THRESHOLD,
  LAND_MS,
  bindDrag as bindDragKernel,
  inside,
  type Point,
} from '../../../../shared/edge/drag.ts';

/** The intents the drag raises; ui/state.ts's `TableIntent` includes them. */
export type DragIntent =
  | Readonly<{ type: 'card/dragStart'; cardId: string }>
  | Readonly<{ type: 'card/dragOver'; over: boolean }>
  | Readonly<{ type: 'card/dragEnd' }>;
export type DragDispatch = (intent: DragIntent) => void;

/** The kernel's: pixels before a press is a drag, and the ghost's glide back on a release off the trick. */
export { DRAG_THRESHOLD, LAND_MS };

/** The one place a card can be dropped. */
export type DropTarget = 'trick';

/** The drag over `#hand`, bound once at boot beside the tap. */
export const bindDrag = (doc: PageLike, dispatch: DragDispatch): void => {
  const hand = requireId(doc, 'hand');
  const trick = requireId(doc, 'trick');
  const targetAt = (p: Point): DropTarget | null => (inside(rectOf(trick), p) ? 'trick' : null);
  bindDragKernel<string, DropTarget, DragIntent>(doc, dispatch, {
    surfaces: [hand],
    // A playable card alone (the painter's `playable`: my turn, the card in `legal`).
    pick: (e) => {
      const card = closestFrom(e, '.card[data-card]');
      if (card === null || !hasClass(card, 'playable')) return null;
      const id = dataOf(card, 'card');
      return id === null ? null : { key: id, el: card };
    },
    targetAt,
    onStart: (s) => [{ type: 'card/dragStart', cardId: s.key }],
    onOver: (s) => [{ type: 'card/dragOver', over: s.over === 'trick' }],
    onEnd: () => [{ type: 'card/dragEnd' }],
    // Over the trick the repaint places the card: no glide; off it the ghost glides back to the slot.
    land: (s) => (s.over === null ? s.base : null),
    // The ghost sits on the body, outside `#tableScreen`'s `--card-w`: it takes the card's measured
    // width as its own, so its face is the source's.
    ghost: { sizeVar: '--card-w', strip: ['selected', 'playable', 'arriving', 'dragging'] },
  });
};
