// FLIP for the hand (docs/design/gin-arrangement-and-discards.md §5d): when a repaint moves cards
// to other cells (a sort, a chooser pick, a long press, a drag over another cell) they glide there
// instead of snapping. Each card's cell (its `.slot`, which no transform ever moves) is measured
// before the repaint and again after; a card whose cell moved is first put back where it was with
// an inverted transform (a layout read lands it), then released to its cell under a short
// transition. Measuring the cell rather than the card keeps a lift out of it: a selected card sits
// 12px up by its own transform, and gliding that would push it below the hand for a frame (the
// geometry spec's "overflow at selected"). Cards new to the hand and cards whose cell stayed put
// are untouched, and a hand with no measurable rects (the page fake) repaints as is.
import {
  afterTransition,
  closestIn,
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

/** The rect of the card's cell (its slot), the card's own where it sits in none. */
const cellRect = (card: Element): Rect => rectOf(closestIn(card, '.slot') ?? card);

/** Repaint `hand` through `repaint`, gliding every card whose cell moved from its old rect to its new one. */
export const flipCards = (hand: Element, repaint: () => void): void => {
  const before = new Map(
    queryAllIn(hand, '.card[data-card]').map(
      (c) => [dataOf(c, 'card') ?? '', cellRect(c)] as const,
    ),
  );
  repaint();
  queryAllIn(hand, '.card[data-card]').forEach((c) => {
    const was = before.get(dataOf(c, 'card') ?? '');
    if (was === undefined || !measurable(was)) return;
    const now = cellRect(c);
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
