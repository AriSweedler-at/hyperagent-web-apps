// How a thing on the page moves from one rect to another: the motion kernel gin's ui/hand/flip.ts
// and backgammon's ui/board/fly.ts both wrote by hand (docs/design/dry-round-2.md §3 row E2, §5
// Wave E). Two recipes, each a run of inline styles around one forced layout read, so the browser
// lays the thing out at its start before the transition carries it to its end:
// - `glide`: FLIP's release. The element already sits at `to` after a repaint; it is put back at
//   `from` with an inverted translate under no transition, laid out there, then released to `to`
//   under the transition given, and the inline transition clears when the transition ends (or the
//   fallback timer fires, `ms` + GLIDE_SLACK_MS). Gin's cards glide to their new cells this way.
// - `launchClone`: a clone of the source fixed over `from` on the body, sized by its own variable
//   (the body is outside the table's size variable, so the clone takes the measured width as its
//   own and every em of its face is the source's), laid out, then sent to `to` by one transform
//   (translate, plus the scale that turns the source's box into the target's when `scale`), and
//   removed when the transition ends or after `ms` + `delay` + LAUNCH_SLACK_MS. The transition and
//   the lift are the theme's (`.flyer` in backgammon's theme.css); a `delay` is written inline on
//   BOTH transition-delay and animation-delay so a staggered flight neither moves nor rises before
//   its turn; a `turn` starts the clone rotated by that many degrees and rights it on the way (a
//   card lying across a pile). Backgammon's checkers fly this way, and the cards of a trick.
// - `reducedMotion`: `prefers-reduced-motion: reduce`, read from matchMedia once and remembered,
//   for a caller that wants to pass `ms: 1`. Neither game reads it yet: on main gin's flip wrote
//   its 200ms transition inline without consulting the media query, and backgammon's flight takes
//   its transition from theme.css, where the query already shortens it. A behaviour-preserving move
//   keeps both as they were; wiring gin's glide to it is a change of its own (dry-round-2.md §7
//   risk 5).
// The two writers keep their own pixel formats: `glide` writes the translate as gin's flip did
// (unrounded), `launchClone` to the hundredth of a pixel as backgammon's fly did. Only the DOM edge
// is reached (dom.ts); nothing here needs layout on a fake (rects come in, styles go out).
import {
  addClass,
  afterTransition,
  cloneInto,
  rectOf,
  removeClass,
  removeElement,
  setStyle,
  type Element,
  type Rect,
} from './dom.ts';

/** Slack past a glide's transition before the fallback timer clears what its end event would have. */
export const GLIDE_SLACK_MS = 50;
/** Slack past a flight's transition and delay before the fallback timer removes a clone that never ended. */
export const LAUNCH_SLACK_MS = 60;

const px = (n: number): string => `${String(Math.round(n * 100) / 100)}px`;
const ratio = (to: number, from: number): string =>
  String(from === 0 ? 1 : Math.round((to / from) * 1000) / 1000);

export type GlideOptions = Readonly<{
  /** The transition's length; the fallback fires GLIDE_SLACK_MS after it. */
  ms: number;
  /** The transition's timing function, as CSS spells it. */
  ease: string;
}>;

/**
 * Release `el`, which the repaint has put at `to`, from `from`: an inverted translate under no
 * transition, a layout read, then the transition on and the transform cleared. The inline
 * transition clears when the transition ends or the fallback fires, so the element's own rules
 * take over again.
 */
export const glide = (el: Element, from: Rect, to: Rect, { ms, ease }: GlideOptions): void => {
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  setStyle(el, 'transition', 'none');
  setStyle(el, 'transform', `translate(${String(dx)}px, ${String(dy)}px)`);
  // A layout read: the inverted transform is laid out before the release below transitions.
  rectOf(el);
  setStyle(el, 'transition', `transform ${String(ms)}ms ${ease}`);
  setStyle(el, 'transform', '');
  afterTransition(
    el,
    () => {
      setStyle(el, 'transition', '');
    },
    ms + GLIDE_SLACK_MS,
  );
};

export type LaunchOptions = Readonly<{
  /** Added to the clone (the theme's flight rule and its variants). */
  classes: ReadonlyArray<string>;
  /** Removed from the clone (the source's own state classes, which must not fly with it). */
  strip: ReadonlyArray<string>;
  /** The clone's size variable, set to `from.width` in px (`--checker-d`, `--card-w`). */
  sizeVar: string;
  /** The theme's transition length, for the fallback timer. */
  ms: number;
  /** How long after now the flight leaves, written to transition-delay and animation-delay when > 0. */
  delay: number;
  /** Scale the clone from `from`'s box into `to`'s along the way (a checker flattening into a slab). */
  scale: boolean;
  /** Degrees the clone starts turned by (its box is `from`, the thing's own), righting itself as it flies; none when absent or 0. */
  turn?: number;
  /** Degrees the clone lands turned by (a card settling into a fan at its tilt); it ends upright when absent or 0. */
  endTurn?: number;
  /** After the clone is removed, whether by its transition's end or the fallback. */
  onDone: () => void;
}>;

/**
 * A clone of `source` on the body, fixed over `from`, sent to `to`; null where the source cannot be
 * cloned (a fake), and then nothing else happens. The clone is returned for a caller that marks it.
 */
export const launchClone = (
  doc: Readonly<{ body: Element }>,
  source: Element,
  from: Rect,
  to: Rect,
  o: LaunchOptions,
): Element | null => {
  const clone = cloneInto(doc.body, source);
  if (clone === null) return null;
  addClass(clone, ...o.classes);
  removeClass(clone, ...o.strip);
  setStyle(clone, o.sizeVar, px(from.width));
  setStyle(clone, 'left', px(from.left));
  setStyle(clone, 'top', px(from.top));
  setStyle(clone, 'width', px(from.width));
  setStyle(clone, 'height', px(from.height));
  const turn = o.turn ?? 0;
  setStyle(clone, 'transform', turn === 0 ? 'none' : `rotate(${String(turn)}deg)`);
  if (o.delay > 0) {
    setStyle(clone, 'transition-delay', `${String(o.delay)}ms`);
    setStyle(clone, 'animation-delay', `${String(o.delay)}ms`);
  }
  // A layout read: the clone is laid out at its start before the transform below transitions.
  rectOf(clone);
  const translate = `translate(${px(to.left - from.left)}, ${px(to.top - from.top)})`;
  const scale = o.scale
    ? ` scale(${ratio(to.width, from.width)}, ${ratio(to.height, from.height)})`
    : '';
  const endTurn = o.endTurn ?? 0;
  const rotate = endTurn !== 0 ? ` rotate(${String(endTurn)}deg)` : turn === 0 ? '' : ' rotate(0)';
  setStyle(clone, 'transform', `${translate}${scale}${rotate}`);
  afterTransition(
    clone,
    () => {
      removeElement(clone);
      o.onDone();
    },
    o.ms + o.delay + LAUNCH_SLACK_MS,
  );
  return clone;
};

/** The one member of `window` the reduced-motion read needs; absent in node and on the fakes. */
export type MediaHost = Partial<
  Readonly<{ matchMedia: (query: string) => Readonly<{ matches: boolean }> }>
>;

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * A reader of `host`'s `prefers-reduced-motion: reduce`: matchMedia is asked once, on the first
 * call, and the answer remembered (the preference does not change under a game); false where the
 * host has no matchMedia.
 */
export const reducedMotionOf = (host: MediaHost): (() => boolean) => {
  const cell: { read: boolean | null } = { read: null };
  return () => {
    cell.read ??= host.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false;
    return cell.read;
  };
};

/** The page's reduced-motion preference, read once. */
export const reducedMotion = reducedMotionOf(globalThis);
