// FLIP for the hand (docs/design/gin-arrangement-and-discards.md §5d): when a repaint moves cards
// to other cells (a sort, a chooser pick, a long press, a drag over another cell) they glide there
// instead of snapping. The cells' rects are read before the repaint and again after; each card
// that moved is first put back where it was with an inverted transform (a layout read lands it),
// then released to its cell under a short transition. Cards new to the hand and cards that
// stayed put are untouched, and a hand with no measurable rects (the page fake) repaints as is.
import {
  afterTransition,
  dataOf,
  queryAllIn,
  rectOf,
  setStyle,
  type Element,
  type Rect,
} from '../../../../../shared/edge/dom.ts';

export const FLIP_MS = 200;
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

const measurable = (r: Rect): boolean => r.width > 0 || r.height > 0;

/** Repaint `hand` through `repaint`, gliding every card that changed cells from its old rect to its new one. */
export const flipCards = (hand: Element, repaint: () => void): void => {
  const before = new Map(
    queryAllIn(hand, '.card[data-card]').map((c) => [dataOf(c, 'card') ?? '', rectOf(c)] as const),
  );
  repaint();
  queryAllIn(hand, '.card[data-card]').forEach((c) => {
    const was = before.get(dataOf(c, 'card') ?? '');
    if (was === undefined || !measurable(was)) return;
    const now = rectOf(c);
    const dx = was.left - now.left;
    const dy = was.top - now.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    setStyle(c, 'transition', 'none');
    setStyle(c, 'transform', `translate(${String(dx)}px, ${String(dy)}px)`);
    // A layout read: the inverted transform is laid out before the release below transitions.
    rectOf(c);
    setStyle(c, 'transition', `transform ${String(FLIP_MS)}ms ${EASE}`);
    setStyle(c, 'transform', '');
    afterTransition(
      c,
      () => {
        setStyle(c, 'transition', '');
      },
      FLIP_MS + 50,
    );
  });
};
