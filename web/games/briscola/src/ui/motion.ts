// The settle beat's motion (docs/design/briscola.md §5.3 "Motion", §5.4 "The settle beat"): a
// resolved trick is held with the taking card lifted, then its cards fly to the winner's cell,
// then a back flies from the stock to each drawer in draw order (the winner first), the last one
// from the briscola when the trump card was taken, and the view is painted cold. The stages and
// their timers are the reducer's (`settle: {stage: 'hold' | 'fly' | 'draw'}`, effects as data);
// this module gives it the durations (`settleTimeline`) and the painter the flights (`trickFlights`,
// `drawFlights`, pure plans over element ids) and the one DOM step that runs them (`flyCards`,
// backgammon's ui/board/fly.ts shape): a clone of the departing card fixed over the page where it
// stood, sent to the arrival's rect by one transform, gone when its transition ends or the fallback
// timer fires. A flight is about the card's centre (the briscola lies across the stock, so its
// clone starts at `rotate(90deg)` in the swapped box and rights itself on the way, `rotate(0)`); the
// arrival hides under `arriving` until the clone lands. Nothing measurable (the page fake, a hidden
// tab) means the repaint alone; `prefers-reduced-motion` makes every duration 1 ms and the hold
// 300 ms through `durationsFor`, written inline on the clone so the timers and the glide agree.
// Only the DOM edge is reached (dom.ts); never ui/state.ts.
import {
  addClass,
  afterTransition,
  byId,
  cloneInto,
  queryAllIn,
  queryIn,
  rectOf,
  removeClass,
  removeElement,
  setStyle,
  type Element,
  type PageLike,
  type Rect,
} from '../../../../shared/edge/dom.ts';
import type { Seat, TrickRecord } from '../engine/index.ts';
import { seatCellId, type RelativeCell } from './table.ts';

// ---- durations (§5.3) ---------------------------------------------------------------------------------

export type Durations = Readonly<{
  /** The trick shown resolved, the taking card lifted, before anything flies. */
  holdMs: number;
  /** The trick's cards to the winner's cell. */
  flyMs: number;
  /** One back from the stock to a seat. */
  drawMs: number;
  /** Between one draw's start and the next. */
  drawGapMs: number;
}>;

export const DURATIONS: Durations = { holdMs: 900, flyMs: 320, drawMs: 260, drawGapMs: 160 };
/** `prefers-reduced-motion`: every glide 1 ms, the hold 300 ms (long enough to read the trick). */
export const REDUCED_DURATIONS: Durations = { holdMs: 300, flyMs: 1, drawMs: 1, drawGapMs: 1 };

export const durationsFor = (reducedMotion: boolean): Durations =>
  reducedMotion ? REDUCED_DURATIONS : DURATIONS;

/** The one member of `window` the preference is read from; absent on a fake. */
export type MediaLike = Readonly<{
  matchMedia?: (query: string) => Readonly<{ matches: boolean }>;
}>;

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export const prefersReducedMotion = (win: MediaLike): boolean =>
  win.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false;

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
}>;

/** The back on top of the stock. */
export const STOCK: Target = { id: 'stock', within: '.card' };
/** The trump card under the stock. */
export const BRISCOLA: Target = { id: 'briscola', within: '.card' };
/** My taken count in the hand header, where my won trick lands. */
export const MY_TAKEN: Target = { id: 'myTaken' };
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
/** A relative cell's taken stack (a won trick lands on it). */
export const seatTaken = (cell: RelativeCell): Target => ({
  id: seatCellId(cell),
  within: '.seat-taken',
});

/** Every card of the trick, in play order, to the winner's cell, together. */
export const trickFlights = (
  trick: Pick<TrickRecord, 'cards'>,
  to: Target,
  d: Durations,
): ReadonlyArray<Flight> =>
  trick.cards.map((p) => ({ from: fanCard(p.seat), to, ms: d.flyMs, delayMs: 0 }));

/**
 * One back per drawer in `drew` order (the winner first), leaving `drawGapMs` apart; the last from
 * the briscola, turned, when the last drawer took the trump card. `cellOf` says where a seat's
 * card lands (`handCard` for me, `seatCards` for the others).
 */
export const drawFlights = (
  trick: Pick<TrickRecord, 'drew' | 'trumpTaken'>,
  cellOf: (seat: Seat) => Target,
  d: Durations,
): ReadonlyArray<Flight> =>
  trick.drew.map((seat, i) => {
    const last = trick.trumpTaken && i === trick.drew.length - 1;
    return {
      from: last ? BRISCOLA : STOCK,
      to: cellOf(seat),
      ms: d.drawMs,
      delayMs: i * d.drawGapMs,
      ...(last ? { rotated: true as const } : {}),
      hideArrival: true as const,
    };
  });

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

/** Slack past the transition before the fallback timer clears a flight that never ended. */
const FALLBACK_SLACK_MS = 60;
/**
 * More clones than this in the air is a scripted burst (a policy playing a game through the hook,
 * a reconnect replaying frames), not play: they are culled before new ones launch.
 */
export const MAX_LIVE_FLYERS = 12;
/** The smallest a clone shrinks to (a landing on a count chip), so it never vanishes mid-flight. */
const MIN_SCALE = 0.05;

const measurable = (r: Rect): boolean => r.width > 0 || r.height > 0;
const px = (n: number): string => `${String(Math.round(n * 100) / 100)}px`;
const num = (n: number): string => String(Math.round(n * 1000) / 1000);

const find = (doc: PageLike, t: Target): Element | null => {
  const root = byId(doc, t.id);
  return root === null || t.within === undefined ? root : queryIn(root, t.within);
};

type Box = Readonly<{ cx: number; cy: number; w: number; h: number }>;

/** A card's own box from its bounding rect: the rect's, or the swapped one for a card lying across. */
const boxOf = (r: Rect, rotated: boolean): Box => ({
  cx: r.left + r.width / 2,
  cy: r.top + r.height / 2,
  w: rotated ? r.height : r.width,
  h: rotated ? r.width : r.height,
});

/** The uniform scale that fits the card inside the arrival's box, never below MIN_SCALE. */
const fit = (from: Box, to: Rect): number =>
  Math.max(MIN_SCALE, Math.min(to.width / from.w, to.height / from.h));

/**
 * One flight: measure both ends, fix a clone where the card stood (its own size as `--card-w`, since
 * the body is outside `#tableScreen`'s scope), lay it out, send it to the arrival's centre with the
 * scale that fits, and clear it when the transition ends or the fallback timer fires. False when
 * an end is missing, unmeasurable or the card cannot be cloned: the repaint alone has placed it.
 */
const launch = (doc: PageLike, f: Flight): boolean => {
  const source = find(doc, f.from);
  const target = find(doc, f.to);
  if (source === null || target === null) return false;
  const fromRect = rectOf(source);
  const to = rectOf(target);
  if (!measurable(fromRect) || !measurable(to)) return false;
  const flyer = cloneInto(doc.body, source);
  if (flyer === null) return false;
  const rotated = f.rotated === true;
  const from = boxOf(fromRect, rotated);
  if (f.hideArrival === true) addClass(target, 'arriving');
  addClass(flyer, 'flyer');
  removeClass(flyer, 'taking', 'selected', 'playable', 'arriving');
  setStyle(flyer, '--card-w', px(from.w));
  setStyle(flyer, 'left', px(from.cx - from.w / 2));
  setStyle(flyer, 'top', px(from.cy - from.h / 2));
  setStyle(flyer, 'width', px(from.w));
  setStyle(flyer, 'height', px(from.h));
  setStyle(flyer, 'transform-origin', '50% 50%');
  setStyle(flyer, 'transition-duration', `${String(f.ms)}ms`);
  if (f.delayMs > 0) {
    setStyle(flyer, 'transition-delay', `${String(f.delayMs)}ms`);
    setStyle(flyer, 'animation-delay', `${String(f.delayMs)}ms`);
  }
  setStyle(flyer, 'transform', rotated ? 'rotate(90deg)' : 'none');
  // A layout read: the clone is laid out at its start before the transform below transitions.
  rectOf(flyer);
  const dx = to.left + to.width / 2 - from.cx;
  const dy = to.top + to.height / 2 - from.cy;
  setStyle(
    flyer,
    'transform',
    `translate(${px(dx)}, ${px(dy)}) rotate(0) scale(${num(fit(from, to))})`,
  );
  afterTransition(
    flyer,
    () => {
      removeElement(flyer);
      removeClass(target, 'arriving');
    },
    f.ms + f.delayMs + FALLBACK_SLACK_MS,
  );
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
