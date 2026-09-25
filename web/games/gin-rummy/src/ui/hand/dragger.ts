// A card dragged by hand (docs/design/gin-arrangement-and-discards.md §5d, §7b; the owner: "you
// can pull it left quickly and it will tilt to the left a bit. And the cards shouldn't immediately
// snap around"; "you should be able to click and drag to lay off … you can pick your cards back up
// from laying off"): what gin tells the shared pointer-drag kernel (web/shared/edge/drag.ts,
// docs/design/dry-round-2.md E1; the gesture, the ghost, the capture, the landing and the frames
// are its). A press on a loose card of the hand, or on a laid-off card on the table, starts a
// session; past DRAG_THRESHOLD the long press is cancelled and `card/dragStart` empties the card's
// place (the paint marks it `dragging`); the ghost is the card's clone sized by its own `--card-w`
// (so its face is the card's) and follows the pointer with the motion of drag.ts (momentum and
// lean). Every pointer move says which of the knocker's melds the pointer is over (`card/dragOnto`,
// lit where the card fits) and, for a hand card over none, asks `dropIndex` where it would land
// among the loose cards (`card/dragOver`, so the others glide aside). On release, `card/dragEnd`
// carries the meld the pointer is over: a hand card over a meld it fits is laid off, a table card
// released off the melds is taken back (the card then appears where it landed, dropping in), and a
// hand card over none glides into its cell first. The click a release fires is ignored by the
// reducer while the drag stands. In the discard phase the discard pile and the Discard button are
// targets too (the owner: drag a card "over the discard pile"; the pile's hitbox is its box grown
// by half in each direction, DROP_GROW, so a near miss still lands): the pointer over either says
// `card/dragOnto 'discard'` and a release there discards the card. Only the DOM edge is reached
// (docs/ARCHITECTURE.md "Module boundaries").
import {
  closestFrom,
  closestIn,
  dataOf,
  hasClass,
  queryAllIn,
  queryIn,
  rectOf,
  requireId,
  type Element,
  type PageLike,
  type Rect,
} from '../../../../../shared/edge/dom.ts';
import {
  LAND_MS,
  bindDrag as bindDragKernel,
  inside,
  type Mover,
  type Point,
} from '../../../../../shared/edge/drag.ts';
import { at, dropIndex, follow, ghostTransform, type DropTarget, type Motion } from './drag.ts';

/** The intents the drag raises; ui/state.ts's `Intent` includes them. */
export type DragIntent =
  | Readonly<{ type: 'card/release' }>
  | Readonly<{ type: 'card/dragStart'; cardId: string; from: 'hand' | 'table' }>
  | Readonly<{ type: 'card/dragOver'; index: number }>
  | Readonly<{ type: 'card/dragOnto'; onto: DropTarget | null }>
  | Readonly<{ type: 'card/dragEnd'; over: DropTarget | null }>;
export type DragDispatch = (intent: DragIntent) => void;

/** The ghost's glide to its cell on release (the kernel's). */
export { LAND_MS };
/** The discard targets' hitbox: each measure of the box grown by this share, centred (the owner: "within 50% of the discard pile"). */
export const DROP_GROW = 0.5;

/** What was pressed: a loose card of the hand or a laid-off card on the table. */
type Source = Readonly<{ cardId: string; from: 'hand' | 'table' }>;
/** What the pointer is over: the meld or discard target, and the loose index a hand card would take. */
type Over = Readonly<{ onto: DropTarget | null; index: number }>;
const ontoOf = (o: Over | null): DropTarget | null => o?.onto ?? null;
const indexOf = (o: Over | null): number => o?.index ?? -1;

/** The momentum and lean of drag.ts as the kernel's motion: each step follows the target, the transform leans with the speed. */
const momentum = (m: Motion): Mover => ({
  transform: (origin) => ghostTransform(m, origin),
  step: (target) => momentum(follow(m, target)),
});

/** `r` with every measure grown by `by`, about its centre. */
const grown = (r: Rect, by: number): Rect => ({
  left: r.left - (r.width * by) / 2,
  top: r.top - (r.height * by) / 2,
  width: r.width * (1 + by),
  height: r.height * (1 + by),
});

/** The drag over `#hand` and `#tableMelds`, bound once at boot beside the tap and the long press. */
export const bindDrag = (doc: PageLike, dispatch: DragDispatch): void => {
  const hand = requireId(doc, 'hand');
  const melds = requireId(doc, 'tableMelds');
  const pile = requireId(doc, 'discardPile');
  const actions = requireId(doc, 'actions');
  const looseCells = (): ReadonlyArray<Element> => queryAllIn(hand, ':scope > .slot.dead');
  const cardOf = (id: string): Element | null =>
    queryIn(hand, `.card[data-card="${id}"]`) ?? queryIn(melds, `.card[data-card="${id}"]`);
  /** The knocker's meld under the pointer, by index, or null. */
  const meldAt = (p: Point): number | null => {
    const i = queryAllIn(melds, '.meld-group').findIndex((g) => inside(rectOf(g), p));
    return i < 0 ? null : i;
  };
  /** The discard pile or the Discard button under the pointer, each box grown by DROP_GROW. */
  const discardAt = (p: Point): boolean => {
    const button = queryIn(actions, 'button[data-act="discard"]');
    return (
      inside(grown(rectOf(pile), DROP_GROW), p) ||
      (button !== null && inside(grown(rectOf(button), DROP_GROW), p))
    );
  };
  /** A hand card's target: a meld first (the piles hide while a knock is answered), else the discard. */
  const targetAt = (p: Point): DropTarget | null => meldAt(p) ?? (discardAt(p) ? 'discard' : null);

  bindDragKernel<Source, Over, DragIntent>(doc, dispatch, {
    surfaces: [hand, melds],
    pick: (e, surface) => {
      const card = closestFrom(e, '.card');
      if (card === null) return null;
      const from = surface === hand ? 'hand' : 'table';
      if (from === 'hand') {
        // Loose cards only: a meld's cards keep their cells.
        const slot = closestFrom(e, '.slot');
        if (slot === null || !hasClass(slot, 'dead') || closestIn(slot, '.group') !== null)
          return null;
      } else if (!hasClass(card, 'laid')) return null;
      const id = dataOf(card, 'card');
      return id === null ? null : { key: { cardId: id, from }, el: card };
    },
    // The paint writes the hand and the meld groups as markup: after `card/dragStart` the card
    // pressed is a detached node, so the ghost is cloned from the card found again by id.
    source: (s) => cardOf(s.key.cardId),
    targetAt: (p, s) => {
      // A laid-off card knows only the melds: released anywhere else it comes back to the hand.
      const onto = s.key.from === 'hand' ? targetAt(p) : meldAt(p);
      // A hand card over no meld finds its place among the loose cards.
      const cells = looseCells();
      const current = cells.findIndex((c) => hasClass(c, 'dragging'));
      const index =
        s.key.from === 'hand' && onto === null
          ? dropIndex(p, cells.map(rectOf), current)
          : indexOf(s.over);
      return { onto, index };
    },
    sameOver: (a, b) => ontoOf(a) === ontoOf(b) && indexOf(a) === indexOf(b),
    onStart: (s) => [
      { type: 'card/release' },
      { type: 'card/dragStart', cardId: s.key.cardId, from: s.key.from },
    ],
    // Each part of `Over` has its own intent, out only when that part changed.
    onOver: (s, prev) => [
      ...(ontoOf(s.over) !== ontoOf(prev)
        ? [{ type: 'card/dragOnto', onto: ontoOf(s.over) } as const]
        : []),
      ...(indexOf(s.over) !== indexOf(prev)
        ? [{ type: 'card/dragOver', index: indexOf(s.over) } as const]
        : []),
    ],
    onEnd: (s) => [{ type: 'card/dragEnd', over: ontoOf(s.over) }],
    // A layoff or a take-back moves the card to another place: it drops in there; no glide. A hand
    // card released over nothing glides into its cell, found again by id.
    land: (s) => {
      const card = cardOf(s.key.cardId);
      return card === null || s.key.from === 'table' || ontoOf(s.over) !== null
        ? null
        : rectOf(card);
    },
    motion: { at: (p) => momentum(at(p.x, p.y)), perFrame: true },
    ghost: { sizeVar: '--card-w', strip: ['selected', 'dragging'] },
  });
};
