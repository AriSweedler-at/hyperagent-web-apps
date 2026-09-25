// FLIP for the hand (docs/design/gin-arrangement-and-discards.md §5d): when a repaint moves cards
// to other cells (a sort, a chooser pick, a long press, a drag over another cell) they glide there
// instead of snapping. Each card's cell (its `.slot`, which no transform ever moves) is measured
// before the repaint and again after; a card whose cell moved glides from its old rect to its new
// one through the shared motion kernel (web/shared/edge/motion.ts `glide`, dry-round-2.md E2: the
// inverted transform, the layout read and the release under FLIP_MS are its). Measuring the cell
// rather than the card keeps a lift out of it: a selected card sits 12px up by its own transform,
// and gliding that would push it below the hand for a frame (the geometry spec's "overflow at
// selected"). Cards new to the hand, cards whose cell stayed put (within half a pixel) and a hand
// with no measurable rects (the page fake) are untouched: the repaint alone places them. The glide
// is FLIP_MS whatever the page's `prefers-reduced-motion`, as it was before the kernel: gin's hand
// never consulted the query (only `#rrBody .meld-group` in theme.css does), and a behaviour-
// preserving move keeps it so; the kernel's `reducedMotion` waits for a change of its own.
import {
  closestIn,
  dataOf,
  queryAllIn,
  rectOf,
  type Element,
  type Rect,
} from '../../../../../shared/edge/dom.ts';
import { glide } from '../../../../../shared/edge/motion.ts';

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
    if (Math.abs(was.left - now.left) < 0.5 && Math.abs(was.top - now.top) < 0.5) return;
    glide(c, was, now, { ms: FLIP_MS, ease: EASE });
  });
};
