// The settle beat's motion (docs/design/briscola-board.md §2, §4.2): a resolved trick is held with
// the taking card lifted, then its cards fly to the newest chip of the winner's taken strip (the
// painter has laid it, hidden, for the flight to land on), then a back flies from the stock
// to each drawer in draw order (the winner first), the last one from the briscola when the trump
// card was taken, and the view is painted cold. The stages and their timers are the reducer's
// (`settle: {stage: 'hold' | 'fly' | 'draw'}`, effects as data); this module gives it the durations
// (`settleTimeline`) and the painter the flights (`trickFlights`, `drawFlights`, pure plans over
// element ids) and the one DOM step that runs them (`flyCards`): each flight is the shared motion
// kernel's `launchClone` (web/shared/edge/motion.ts, dry-round-2.md E2: the clone fixed where the
// card stood, sent by one transform, gone when its transition ends or the fallback fires), given
// the card's own box (the briscola lies across the stock, so its box is the bounding rect swapped
// and it starts `turn`ed 90°, righting itself on the way) and an arrival box of the card's shape
// scaled to fit, centred on the target, so the kernel's translate is centre to centre and its
// scale uniform; the arrival hides under `arriving` until the clone lands. Nothing measurable (the
// page fake, a hidden tab) means the repaint alone. The flight's length goes on the clone as
// `--fly-ms` (theme.css `.flyer` reads it; the clone sits on the body, outside `#tableScreen`'s
// scope), and `prefers-reduced-motion` is the shared `reducedMotion` read: `durationsFor(true)`
// makes every glide 1 ms and the hold 300 ms, and the theme's media query agrees. Only the DOM
// edge is reached (dom.ts); never ui/state.ts.
import {
  addClass,
  byId,
  queryAllIn,
  queryIn,
  rectOf,
  removeClass,
  removeElement,
  setAttr,
  setStyle,
  type Element,
  type PageLike,
  type Rect,
} from '../../../../shared/edge/dom.ts';
import { launchClone } from '../../../../shared/edge/motion.ts';
import type { Speed } from '../../../../shared/lib/speed.ts';
import type { Played, Seat, TrickRecord } from '../engine/index.ts';
import { drawSpan, stageMs } from './beat.ts';
import { seatCellId, type RelativeCell } from './table.ts';

// ---- durations (§5.3): the pure clock is ui/beat.ts's, named through this module for the painter ------

import type { Durations } from './beat.ts';

export {
  DURATIONS,
  QUICK_DURATIONS,
  REDUCED_DURATIONS,
  durationsFor,
  type Durations,
} from './beat.ts';

// ---- flights: the pure plans (§5.6 `flightsBetween`'s twin) -------------------------------------------

/** An element by id, or one inside it by selector. */
export type Target = Readonly<{ id: string; within?: string }>;

export type Flight = Readonly<{
  from: Target;
  to: Target;
  /** The glide's length. */
  ms: number;
  /** How long after the repaint it leaves. */
  delayMs: number;
  /** The source lies across (the briscola): the clone starts turned and rights itself. */
  rotated?: true;
  /** The arrival hides under `arriving` until the clone lands (a drawn card). */
  hideArrival?: true;
  /**
   * The source's box, measured BEFORE the repaint that removed it (a played card's hand slot, an
   * opponent's last back): the clone is then the ARRIVAL's, sent from this box to its own.
   */
  fromRect?: Rect;
  /** Degrees the clone lands turned by: the fan card's tilt, so the landing matches the card under it. */
  endTurn?: number;
}>;

/** The back on top of the stock. */
export const STOCK: Target = { id: 'stock', within: '.card' };
/** The trump card under the stock. */
export const BRISCOLA: Target = { id: 'briscola', within: '.card' };
/** The newest chip of my taken strip in the hand header, where my won trick lands. */
export const MY_TRICKS: Target = { id: 'myTricks', within: '.chip:last-child' };
/** A seat's card in the fan. */
export const fanCard = (seat: Seat): Target => ({
  id: 'trick',
  within: `.card[data-seat="${String(seat)}"]`,
});
/** A card of my hand by id (the one a draw brought). */
export const handCard = (id: string): Target => ({
  id: 'hand',
  within: `.card[data-card="${id}"]`,
});
/** A relative cell's newest held card (a drawn back lands on it). */
export const seatCards = (cell: RelativeCell): Target => ({
  id: seatCellId(cell),
  within: '.seat-cards .card:last-child',
});
/** The newest chip of a relative cell's taken strip (a won trick lands on it). */
export const seatTaken = (cell: RelativeCell): Target => ({
  id: seatCellId(cell),
  within: '.seat-taken .chip:last-child',
});

/**
 * Every card of the trick, in play order, to the newest chip of the winner's strip, together; the
 * chip hides (`arriving`) until they land, so the row grows as the cards reach it.
 */
export const trickFlights = (
  trick: Pick<TrickRecord, 'cards'>,
  to: Target,
  d: Durations,
): ReadonlyArray<Flight> =>
  trick.cards.map((p) => ({
    from: fanCard(p.seat),
    to,
    ms: d.flyMs,
    delayMs: 0,
    hideArrival: true as const,
  }));

/** A slice of the draw order, `start` inclusive to `end` exclusive (the seats before me, the seats after me). */
export type DrawRange = Readonly<{ start: number; end: number }>;

/**
 * One back per drawer in `drew` order (the winner first), leaving `drawGapMs` apart; the last from
 * the briscola, turned, when the last drawer took the trump card. `cellOf` says where a seat's
 * card lands (`handCard` for me, `seatCards` for the others). `range` takes a slice of the order
 * (docs/design/briscola-battle.md §3.1 DRAW: the seats before my tap, then those after it), its
 * first flight leaving at once.
 */
export const drawFlights = (
  trick: Pick<TrickRecord, 'drew' | 'trumpTaken'>,
  cellOf: (seat: Seat) => Target,
  d: Durations,
  range: DrawRange = { start: 0, end: trick.drew.length },
): ReadonlyArray<Flight> =>
  trick.drew.slice(range.start, range.end).map((seat, k) => {
    const last = trick.trumpTaken && range.start + k === trick.drew.length - 1;
    return {
      from: last ? BRISCOLA : STOCK,
      to: cellOf(seat),
      ms: d.drawMs,
      delayMs: k * d.drawGapMs,
      ...(last ? { rotated: true as const } : {}),
      hideArrival: true as const,
    };
  });

/** The seats drawing before my tap, as a range for `drawFlights`; every seat when I do not draw. */
export const drawsBefore = (drew: ReadonlyArray<Seat>, me: Seat): DrawRange => ({
  start: 0,
  end: drawSpan(drew, me).before,
});
/** The seats drawing after my card has landed; empty when I do not draw. */
export const drawsAfter = (drew: ReadonlyArray<Seat>, me: Seat): DrawRange => {
  const span = drawSpan(drew, me);
  return span.mine
    ? { start: span.before + 1, end: drew.length }
    : { start: drew.length, end: drew.length };
};

/**
 * My draw after the tap (§3.1 DRAW): one back from the stock to my slot (`to`, the drawn card,
 * hidden until it lands), or from the briscola, turned, when I am the last drawer and took the
 * trump card; the flip that follows the landing is the CSS's (`.card.flipping`). Null when I am
 * not among the drawers.
 */
export const myDrawFlight = (
  trick: Pick<TrickRecord, 'drew' | 'trumpTaken'>,
  me: Seat,
  to: Target,
  d: Durations,
): Flight | null => {
  const span = drawSpan(trick.drew, me);
  if (!span.mine) return null;
  const last = trick.trumpTaken && span.after === 0;
  return {
    from: last ? BRISCOLA : STOCK,
    to,
    ms: d.drawMs,
    delayMs: 0,
    ...(last ? { rotated: true as const } : {}),
    hideArrival: true as const,
  };
};

// ---- the play and follow flights (docs/design/briscola-battle.md §3.1 PLAY, FOLLOW; §7 PR-D) ------

/** The tilt theme.css gives the i-th of n fan cards (`.play .card`'s rotate): the fan leans out from its middle, 4° a card. */
export const fanTilt = (i: number, n: number): number => (i - (n - 1) / 2) * 4;

/**
 * The box of a card whose BOUNDING rect is `r` when it sits turned by `deg` (the fan card under
 * its tilt): the bounding box grows by the turn, so a clone scaled to it would land too big.
 */
export const unrotatedBox = (r: Rect, deg: number): Rect => {
  const t = (Math.abs(deg) * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const k = c * c - s * s;
  if (k < 1e-6) return r;
  const w = (r.width * c - r.height * s) / k;
  const h = (r.height * c - r.width * s) / k;
  if (w <= 0 || h <= 0) return r;
  return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h };
};

/**
 * One card's flight to its place in the fan from where it stood before the repaint (`fromRect`),
 * landing at its tilt: the trick's first card at PLAY's pace, a later one at FOLLOW's, the card
 * that completes the trick at FOLLOW's fastest. `i` is the card's place in the fan of `n` shown
 * cards; `completing` says the trick resolved on it; `k` staggers several plays that land in one
 * paint (a catch-up after a beat) 100 ms apart.
 */
export const playFlight = (
  play: Played,
  fromRect: Rect,
  i: number,
  n: number,
  completing: boolean,
  speed: Speed,
  reduced: boolean,
  k = 0,
): Flight => ({
  from: fanCard(play.seat),
  to: fanCard(play.seat),
  ms: stageMs(i === 0 ? 'play' : completing ? 'followLast' : 'follow', speed, reduced),
  delayMs: k * 100,
  hideArrival: true as const,
  fromRect,
  endTurn: fanTilt(i, n),
});

/** The plays `shown` has that `prev` had not (the cards new to the fan this paint), in play order. */
export const newPlays = (
  prev: ReadonlyArray<Played>,
  shown: ReadonlyArray<Played>,
): ReadonlyArray<Played> => shown.filter((p) => !prev.some((q) => q.card.id === p.card.id));

/** When the last flight has landed, in ms after the repaint; 0 for none. */
export const totalMs = (flights: ReadonlyArray<Flight>): number =>
  flights.reduce((max, f) => Math.max(max, f.delayMs + f.ms), 0);

/** The three timers of the beat, for the reducer: hold, fly, then the draws (0 once the stock is out). */
export type Timeline = Readonly<{ holdMs: number; flyMs: number; drawMs: number }>;

export const settleTimeline = (trick: Pick<TrickRecord, 'drew'>, d: Durations): Timeline => ({
  holdMs: d.holdMs,
  flyMs: d.flyMs,
  drawMs: trick.drew.length === 0 ? 0 : (trick.drew.length - 1) * d.drawGapMs + d.drawMs,
});

// ---- the DOM step -------------------------------------------------------------------------------------

/**
 * More clones than this in the air is a scripted burst (a policy playing a game through the hook,
 * a reconnect replaying frames), not play: they are culled before new ones launch.
 */
export const MAX_LIVE_FLYERS = 12;
/** The smallest a clone shrinks to (a landing on a chip), so it never vanishes mid-flight. */
const MIN_SCALE = 0.05;
/** The source's state classes, which must not fly with its clone. */
const STRIP: ReadonlyArray<string> = ['taking', 'selected', 'playable', 'arriving', 'dragging'];

const measurable = (r: Rect): boolean => r.width > 0 || r.height > 0;

const find = (doc: PageLike, t: Target): Element | null => {
  const root = byId(doc, t.id);
  return root === null || t.within === undefined ? root : queryIn(root, t.within);
};

/** A card's own box from its bounding rect: the rect's, or the swapped one for a card lying across. */
const boxOf = (r: Rect, rotated: boolean): Rect => {
  const w = rotated ? r.height : r.width;
  const h = rotated ? r.width : r.height;
  return {
    left: r.left + r.width / 2 - w / 2,
    top: r.top + r.height / 2 - h / 2,
    width: w,
    height: h,
  };
};

/** The uniform scale that fits the card inside the arrival's box, never below MIN_SCALE. */
const fit = (from: Rect, to: Rect): number =>
  Math.max(MIN_SCALE, Math.min(to.width / from.width, to.height / from.height));

/** The card's shape scaled to fit, centred on the arrival: the kernel's translate is then centre to centre and its scale uniform. */
const arrivalBox = (from: Rect, to: Rect): Rect => {
  const s = fit(from, to);
  return {
    left: to.left + to.width / 2 - from.width / 2,
    top: to.top + to.height / 2 - from.height / 2,
    width: from.width * s,
    height: from.height * s,
  };
};

/**
 * One flight: measure both ends, launch the card's clone from its own box to the arrival box
 * (`launchClone`: fixed where the card stood, sized as `--card-w`, laid out, sent by one transform,
 * removed when the transition ends or the fallback fires), its length on it as `--fly-ms`. False
 * when an end is missing, unmeasurable or the card cannot be cloned: the repaint alone has placed it.
 */
const launch = (doc: PageLike, f: Flight): boolean => {
  const target = find(doc, f.to);
  // A source the repaint removed (a play): the arrival's clone leaves from the measured box.
  const source = f.fromRect === undefined ? find(doc, f.from) : target;
  if (source === null || target === null) return false;
  const fromRect = f.fromRect ?? rectOf(source);
  const endTurn = f.endTurn ?? 0;
  const to = unrotatedBox(rectOf(target), endTurn);
  if (!measurable(fromRect) || !measurable(to)) return false;
  const rotated = f.rotated === true;
  const from = boxOf(fromRect, rotated);
  const clone = launchClone(doc, source, from, arrivalBox(from, to), {
    classes: ['flyer'],
    strip: STRIP,
    sizeVar: '--card-w',
    ms: f.ms,
    delay: f.delayMs,
    scale: true,
    ...(rotated ? { turn: 90 } : {}),
    ...(endTurn === 0 ? {} : { endTurn }),
    onDone: () => {
      removeClass(target, 'arriving');
      setAttr(target, 'data-flying', null);
    },
  });
  if (clone === null) return false;
  if (f.hideArrival === true) {
    addClass(target, 'arriving');
    // Read by the painter: a repaint mid-flight keeps the arrival hidden under its clone.
    setAttr(target, 'data-flying', '');
  }
  // Read by theme.css `.flyer`'s transition: set before the style flush that starts it.
  setStyle(clone, '--fly-ms', `${String(f.ms)}ms`);
  return true;
};

/**
 * Run every flight after the repaint that placed the arrivals (the painter paints, then calls
 * this): stale clones beyond MAX_LIVE_FLYERS are culled first. Returns how many flights left the
 * ground; the rest were placed by the repaint alone.
 */
export const flyCards = (doc: PageLike, flights: ReadonlyArray<Flight>): number => {
  if (flights.length === 0) return 0;
  const live = queryAllIn(doc.body, '.flyer');
  if (live.length > MAX_LIVE_FLYERS) live.forEach(removeElement);
  return flights.filter((f) => launch(doc, f)).length;
};

// ---- the clash's geometry (docs/design/briscola-battle.md §3.1 CHARGE, STRIKE; §7 PR-F) ------------------

/**
 * The axis between two fighters' centres and their contact point: `ux`/`uy` the unit vector from
 * `a`'s centre to `b`'s (the winner charges away along −u and strikes along +u, the loser the
 * reverse), `gap` the distance between the centres, `cx`/`cy` the midpoint where the impact frame
 * lands. Two boxes on one spot (a fake, a hidden tab) read as side by side.
 */
export type ClashGeometry = Readonly<{
  ux: number;
  uy: number;
  gap: number;
  cx: number;
  cy: number;
}>;

export const clashGeometry = (a: Rect, b: Rect): ClashGeometry => {
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  const bx = b.left + b.width / 2;
  const by = b.top + b.height / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const gap = Math.hypot(dx, dy);
  return {
    ux: gap < 1e-6 ? 1 : dx / gap,
    uy: gap < 1e-6 ? 0 : dy / gap,
    gap,
    cx: (ax + bx) / 2,
    cy: (ay + by) / 2,
  };
};
