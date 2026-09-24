// A checker's flight between two containers (design §3.9 "Flights", §3.8 "Motion"):
// gin's ghost joined to a FLIP. A move changes the key of two containers (three with a hit), so
// the painter rebuilds them and the moved checker would simply appear at its destination. Before
// the repaint the top checker (or newest slab) of every departure container is measured; after it
// the arrival (the destination's top checker or newest slab) is hidden under `arriving`, a clone
// of the departed checker is fixed over where it stood, laid out, then sent to the arrival's rect
// by one transform (translate plus the scale that turns a checker into a slab, whichever way the
// tray lies) over FLY_MS with a small lift on the way (`fly-lift`: a rise of a few pixels and a
// deeper shadow at mid-flight, a keyframe animation beside the transition, so the glide's own
// end event still ends the flight), and the clone goes when its transition ends or the fallback
// timer fires. Several flights in one repaint leave STAGGER_MS apart (`flightDelays`). A stack
// already five tall keeps its top coin through the repaint (render.ts `ensureStack`: the sixth
// is hidden under it and only the count badge changes), so that coin is not hidden: the clone
// lands on it, and a badge the landing brings waits under `settling` until it does. A hit blot
// waits `HIT_DELAY_MS` before it leaves for the bar, so the mover lands on it first. The
// transition itself is `.flyer`'s in theme.css, so `prefers-reduced-motion` can shorten it; only
// the delay is written inline. Nothing measurable (the page fake) means the repaint alone. The
// module takes ids and rects only: never ui/state.ts, the DOM only through the shared edge.
import {
  addClass,
  afterTransition,
  cloneInto,
  dataOf,
  queryAllIn,
  queryIn,
  rectOf,
  removeClass,
  removeElement,
  requireId,
  setStyle,
  type Element,
  type PageLike,
  type Rect,
} from '../../../../../shared/edge/dom.ts';
import type { Flight } from '../board.ts';

/** The flight's duration (theme.css `.flyer { transition: transform 200ms … }` and its `fly-lift`). */
export const FLY_MS = 200;
/** A hit blot leaves for the bar this long after the mover lands on it. */
export const HIT_DELAY_MS = 80;
/** The movers of one play leave this far apart, in order (design §3.8: "zippy", staggered). */
export const STAGGER_MS = 60;
/** Slack past the transition before the fallback timer clears a flight that never ended. */
const FALLBACK_SLACK_MS = 60;

const measurable = (r: Rect): boolean => r.width > 0 || r.height > 0;
const px = (n: number): string => `${String(Math.round(n * 100) / 100)}px`;
const ratio = (to: number, from: number): string =>
  String(from === 0 ? 1 : Math.round((to / from) * 1000) / 1000);

/** What leaves a container: its top checker, else its newest slab (a bear-off undone). */
const departure = (container: Element): Element | null =>
  queryIn(container, '.checker.top') ?? queryAllIn(container, '.slab').at(-1) ?? null;
/** What arrives: the destination's newest slab for a bear-off, else its top checker. */
const arrival = (container: Element, slab: boolean): Element | null =>
  slab ? (queryAllIn(container, '.slab').at(-1) ?? null) : queryIn(container, '.checker.top');

type Departed = Readonly<{
  flight: Flight;
  source: Element;
  from: Rect;
  /** The destination's top coin before the repaint, and whether it already wore a count badge. */
  before: Element | null;
  badged: boolean;
  /** How long after the repaint this flight leaves (`flightDelays`). */
  delay: number;
}>;

type DelayFold = Readonly<{ out: ReadonlyArray<number>; movers: number; last: number }>;

/**
 * When each flight leaves, in ms after the repaint: the movers `STAGGER_MS` apart in order (one
 * tap commits one move, so this is the opponent's play or a combined move arriving whole); a hit
 * blot `HIT_DELAY_MS` after the mover that landed on it, so it is seen to be hit.
 */
export const flightDelays = (flights: ReadonlyArray<Flight>): ReadonlyArray<number> =>
  flights.reduce<DelayFold>(
    (acc, f) =>
      f.hit === true
        ? { ...acc, out: [...acc.out, acc.last + HIT_DELAY_MS] }
        : {
            out: [...acc.out, acc.movers * STAGGER_MS],
            movers: acc.movers + 1,
            last: acc.movers * STAGGER_MS,
          },
    { out: [], movers: 0, last: 0 },
  ).out;

const measure = (doc: PageLike, flight: Flight, delay: number): Departed | null => {
  const source = departure(requireId(doc, flight.fromContainer));
  if (source === null) return null;
  const from = rectOf(source);
  if (!measurable(from)) return null;
  const before = arrival(requireId(doc, flight.toContainer), flight.slab === true);
  return {
    flight,
    source,
    from,
    before,
    badged: before !== null && dataOf(before, 'count') !== null,
    delay,
  };
};

/**
 * After the repaint: hide the arrival (unless it is the coin that was already on top: then only
 * a badge the landing brings hides, under `settling`), fix the clone where the checker stood, send it over.
 */
const launch = (doc: PageLike, { flight, source, from, before, badged, delay }: Departed): void => {
  const target = arrival(requireId(doc, flight.toContainer), flight.slab === true);
  if (target === null) return;
  const to = rectOf(target);
  if (!measurable(to)) return;
  const flyer = cloneInto(doc.body, source);
  if (flyer === null) return;
  if (target !== before) addClass(target, 'arriving');
  else if (!badged && dataOf(target, 'count') !== null) addClass(target, 'settling');
  addClass(flyer, 'flyer');
  if (flight.slab === true) addClass(flyer, 'flyer-slab');
  removeClass(flyer, 'top', 'arriving');
  // The clone sits on the body, where the board's `--checker-d` is out of scope: its own size is
  // the measured one (gin's ghost does the same with `--card-w`).
  setStyle(flyer, '--checker-d', px(from.width));
  setStyle(flyer, 'left', px(from.left));
  setStyle(flyer, 'top', px(from.top));
  setStyle(flyer, 'width', px(from.width));
  setStyle(flyer, 'height', px(from.height));
  setStyle(flyer, 'transform', 'none');
  // The glide and its lift (theme.css `fly-lift`, a keyframe animation beside the transition)
  // wait the same delay, so a staggered flight neither moves nor rises before its turn.
  if (delay > 0) {
    setStyle(flyer, 'transition-delay', `${String(delay)}ms`);
    setStyle(flyer, 'animation-delay', `${String(delay)}ms`);
  }
  // A layout read: the clone is laid out at its start before the transform below transitions.
  rectOf(flyer);
  setStyle(
    flyer,
    'transform',
    `translate(${px(to.left - from.left)}, ${px(to.top - from.top)}) scale(${ratio(to.width, from.width)}, ${ratio(to.height, from.height)})`,
  );
  afterTransition(
    flyer,
    () => {
      removeElement(flyer);
      removeClass(target, 'arriving', 'settling');
    },
    FLY_MS + delay + FALLBACK_SLACK_MS,
  );
};

/**
 * Repaint through `repaint`, then fly every checker `flights` names from where it stood to where
 * the repaint put it. A flight whose departure or arrival cannot be measured is skipped: the
 * repaint has already placed its checker.
 */
export const flyMoves = (
  doc: PageLike,
  flights: ReadonlyArray<Flight>,
  repaint: () => void,
): void => {
  const delays = flightDelays(flights);
  const departed = flights.flatMap((flight, i) => {
    const d = measure(doc, flight, delays[i] ?? 0);
    return d === null ? [] : [d];
  });
  repaint();
  departed.forEach((d) => {
    launch(doc, d);
  });
};
