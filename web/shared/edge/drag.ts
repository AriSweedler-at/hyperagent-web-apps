// A thing dragged by hand: the pointer-drag kernel gin's ui/hand/dragger.ts and backgammon's
// ui/board/dragger.ts both were (docs/design/dry-round-2.md §3 row E1, §5 Wave E rows E0/E1; the
// two bodies were 21% textually similar and one gesture). A press on something `pick` accepts
// starts a session; once the pointer has moved DRAG_THRESHOLD the drag begins: the start intents go
// out (the reducer empties the place, lights the targets), the source is measured, a clone of it,
// the ghost, is fixed over it on the body (sized by its own `sizeVar`, so its face is the
// source's, the lift classes stripped) and the surface pressed captures the pointer. Every move
// asks `targetAt` what the pointer is over and, when that changes, dispatches the over intents;
// the ghost follows the pointer by its `motion`. On release (or a cancel) the pointer is let go
// and `land` says where the ghost glides to first (LAND_MS, `.landing`) or null for an end at once;
// the end intents go out when the ghost is gone. A press that never moves is a tap or a long
// press, left to the click and the timer. One drag at a time: a cell holding the session, replaced
// whole by every pointer event and frame. Only the DOM edge is reached (dom.ts).
//
// Where this differs from the design's sketch, the two draggers' real bodies demanded it:
// - `bindDrag(doc, dispatch, cfg)` takes the dispatch beside the config (both games' `bindDrag(doc,
//   dispatch)` wrappers pass theirs through), and the three builders return arrays: gin's start is
//   two intents (`card/release` then `card/dragStart`) and its over is two independent parts.
// - `pick(e, surface)` is told the surface: gin's press accepts loose cards on `#hand` and laid-off
//   cards on `#tableMelds`.
// - `source(s)` finds the source again after the start intents: gin's paint writes the hand and the
//   meld groups as markup, so the card pressed is a detached node by the time the ghost is made and
//   is found again by id; backgammon's checkers keep their elements, the default.
// - `sameOver` and `onOver(s, prev)`: gin's `Over` is `{onto, index}` and each part has its own
//   intent, dispatched only when that part changed.
// - `motion` is `{at, perFrame}` over a `Mover` that closes over its state (`at`, `follow` and
//   `transform` are its `at`, `step` and `transform`), so the kernel carries no type parameter for
//   the motion and the default needs no cast. `perFrame`: gin's momentum steps on animation frames
//   while the pointer only moves the target; backgammon's disc writes its transform with each
//   pointer event (its tests read it back without a frame). The default is the direct `translate`
//   from where the drag began.
// - `Point`, `Rect`, DRAG_THRESHOLD, `startedDrag` and `inside` are web/shared/lib/drag.ts's,
//   re-exported: gin's ui/hand/drag.ts needs them DOM-free (ui/state.ts imports it under
//   tsconfig.node.json).
// - The ghost's box and the landing translate are written to the hundredth of a pixel (the `px`
//   of backgammon's dragger and gin's drag.ts; gin's dragger wrote them unrounded): the one string
//   difference, on a transient element.
import { DRAG_THRESHOLD, inside, startedDrag, type Point, type Rect } from '../lib/drag.ts';
import {
  addClass,
  afterTransition,
  capturePointer,
  cloneInto,
  listen,
  nextFrame,
  pointerOf,
  rectOf,
  releasePointer,
  removeClass,
  removeElement,
  setStyle,
  type Element,
  type PageLike,
} from './dom.ts';

export { DRAG_THRESHOLD, inside, startedDrag, type Point, type Rect };

/** The ghost's glide to where it lands on release (the themes' `.drag-ghost.landing` transition). */
export const LAND_MS = 180;
/** Slack after LAND_MS before the end goes out anyway, should the transition never end. */
export const FALLBACK_MS = 60;

const px = (n: number): string => `${String(Math.round(n * 100) / 100)}px`;

/**
 * The ghost's classes, held in constants as glossary.ts holds its own: the class contract
 * (test/dist/classes.ts) reads a shared file's `addClass('…')` literals for every page, and fidice
 * has no drag, so these two are listed in web/shared/styles/CONTRACT.md as a `shell` row instead.
 */
const GHOST_CLASS = 'drag-ghost';
const LANDING_CLASS = 'landing';

/** The ghost's motion with its state closed over: the transform to write now, and one step on. */
export type Mover = Readonly<{
  /** The ghost's transform: its offset from `origin`, where the drag began, plus what the motion adds (a lean). */
  transform: (origin: Point) => string;
  /** The motion one step (a frame, or a pointer event) toward `target`. */
  step: (target: Point) => Mover;
}>;

/** How the ghost moves: at rest at a point, and whether it steps on frames or with the events. */
export type Motion = Readonly<{
  at: (p: Point) => Mover;
  /**
   * Frame by frame: a `nextFrame` loop steps the motion while the drag lasts and the pointer only
   * moves its target (momentum trails, so the ghost never snaps). Otherwise one step per pointer
   * event, written at once.
   */
  perFrame: boolean;
}>;

/** The ghost on the pointer at `p`, translated from where the drag began. */
const direct = (p: Point): Mover => ({
  transform: (origin) => `translate(${px(p.x - origin.x)}, ${px(p.y - origin.y)})`,
  step: direct,
});
/** The default motion: the ghost sits on the pointer. */
export const DIRECT: Motion = { at: direct, perFrame: false };

/** A drag as the hooks see it: what was pressed, where, and what the pointer is over. */
export type Session<Src, Over> = Readonly<{
  key: Src;
  /** The element pressed. */
  el: Element;
  /** The surface the press was on, which holds the pointer while the drag lasts. */
  surface: Element;
  pointerId: number;
  /** Where the press began, and where the drag did (the ghost's translate is from here). */
  start: Point;
  grab: Point;
  /** The source's rect when the ghost was made: the ghost's fixed position. */
  base: Rect;
  moving: boolean;
  landing: boolean;
  ghost: Element | null;
  /** Where the pointer last was. */
  target: Point;
  over: Over | null;
}>;

export type DragConfig<Src, Over, Intent> = Readonly<{
  /** The elements pressed on, each listening for the four pointer events. */
  surfaces: ReadonlyArray<Element>;
  /** What a press on `surface` picks up, or null for a press on nothing draggable. */
  pick: (e: Readonly<Event>, surface: Element) => Readonly<{ key: Src; el: Element }> | null;
  /** The source after the start intents (the paint may have rebuilt it); the element pressed by default. */
  source?: (s: Session<Src, Over>) => Element | null;
  /** What the pointer at `p` is over. */
  targetAt: (p: Point, s: Session<Src, Over>) => Over | null;
  /** When two `Over`s are the same (no over intents); `===` by default. */
  sameOver?: (a: Over | null, b: Over | null) => boolean;
  onStart: (s: Session<Src, Over>) => ReadonlyArray<Intent>;
  /** `s.over` changed from `prev`. */
  onOver: (s: Session<Src, Over>, prev: Over | null) => ReadonlyArray<Intent>;
  onEnd: (s: Session<Src, Over>) => ReadonlyArray<Intent>;
  /** Where the ghost glides to on release, or null to end at once (the repaint places the thing). */
  land: (s: Session<Src, Over>) => Rect | null;
  /** DIRECT unless given. */
  motion?: Motion;
  /** The ghost's size variable (the source's measured width, so its face is the source's) and the classes stripped from the clone. */
  ghost: Readonly<{ sizeVar: string; strip: ReadonlyArray<string> }>;
}>;

type Held<Src, Over> = Session<Src, Over> & Readonly<{ motion: Mover }>;

/** The drag over `cfg.surfaces`, bound once at boot beside the tap and the long press. */
export const bindDrag = <Src, Over, Intent>(
  doc: PageLike,
  dispatch: (intent: Intent) => void,
  cfg: DragConfig<Src, Over, Intent>,
): void => {
  const motion = cfg.motion ?? DIRECT;
  const source = cfg.source ?? ((s: Session<Src, Over>): Element | null => s.el);
  const same = cfg.sameOver ?? ((a: Over | null, b: Over | null): boolean => a === b);
  const held: { s: Held<Src, Over> | null } = { s: null };
  const emit = (intents: ReadonlyArray<Intent>): void => {
    intents.forEach((intent) => {
      dispatch(intent);
    });
  };

  const frame = (): void => {
    const s = held.s;
    if (s === null || s.landing || s.ghost === null) return;
    const m = s.motion.step(s.target);
    held.s = { ...s, motion: m };
    setStyle(s.ghost, 'transform', m.transform(s.grab));
    nextFrame(frame);
  };

  /** The press becomes a drag at `p`: the start intents go out, the ghost is made, the pointer is held. */
  const begin = (s: Held<Src, Over>, p: Point): Held<Src, Over> => {
    emit(cfg.onStart(s));
    const el = source(s);
    if (el === null) return { ...s, moving: true, grab: p };
    const base = rectOf(el);
    const ghost = cloneInto(doc.body, el);
    if (ghost === null) return { ...s, moving: true, grab: p, base };
    addClass(ghost, GHOST_CLASS);
    removeClass(ghost, ...cfg.ghost.strip);
    // The ghost sits on the body, outside the table's size variable: it takes the source's measured
    // width as its own, so every em of its face is the source's.
    setStyle(ghost, cfg.ghost.sizeVar, px(base.width));
    setStyle(ghost, 'left', px(base.left));
    setStyle(ghost, 'top', px(base.top));
    setStyle(ghost, 'width', px(base.width));
    setStyle(ghost, 'height', px(base.height));
    capturePointer(s.surface, s.pointerId);
    if (motion.perFrame) nextFrame(frame);
    return { ...s, moving: true, grab: p, base, ghost, motion: motion.at(p), target: p };
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
    releasePointer(s.surface, s.pointerId);
    const ghost = s.ghost;
    const finish = (): void => {
      if (ghost !== null) removeElement(ghost);
      held.s = null;
      emit(cfg.onEnd(s));
    };
    const cell = ghost === null ? null : cfg.land(s);
    if (ghost === null || cell === null) {
      finish();
      return;
    }
    addClass(ghost, LANDING_CLASS);
    // At rest at the cell, from the ghost's base: the direct translate, or a lean of zero.
    const rest = motion.at({ x: cell.left, y: cell.top });
    setStyle(ghost, 'transform', rest.transform({ x: s.base.left, y: s.base.top }));
    afterTransition(ghost, finish, LAND_MS + FALLBACK_MS);
  };

  const press =
    (surface: Element) =>
    (e: Readonly<Event>): void => {
      if (held.s !== null) return;
      const picked = cfg.pick(e, surface);
      if (picked === null) return;
      const p = pointerOf(e);
      held.s = {
        key: picked.key,
        el: picked.el,
        surface,
        pointerId: p.id,
        start: p,
        grab: p,
        base: rectOf(picked.el),
        moving: false,
        landing: false,
        ghost: null,
        motion: motion.at(p),
        target: p,
        over: null,
      };
    };

  const move = (e: Readonly<Event>): void => {
    const pressed = held.s;
    if (pressed === null || pressed.landing) return;
    const p = pointerOf(e);
    if (!pressed.moving && !startedDrag(pressed.start, p)) return;
    const s = pressed.moving ? pressed : begin(pressed, p);
    const m = motion.perFrame ? s.motion : s.motion.step(p);
    if (!motion.perFrame && s.ghost !== null) setStyle(s.ghost, 'transform', m.transform(s.grab));
    const over = cfg.targetAt(p, s);
    const next = { ...s, target: p, motion: m, over };
    held.s = next;
    if (!same(over, s.over)) emit(cfg.onOver(next, s.over));
  };

  cfg.surfaces.forEach((surface) => {
    listen(surface, 'pointerdown', press(surface));
    listen(surface, 'pointermove', move);
    ['pointerup', 'pointercancel'].forEach((type) => {
      listen(surface, type, end);
    });
  });
};
