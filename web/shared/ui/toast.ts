// The toast timer and the reducer's named timers, the two blocks every shell main.ts spelled
// (docs/design/shared-shell.md §4.4 `toast.ts`; §5 B1 moved them out of gin's main.ts 142-159 and
// backgammon's 89-106). `createToaster` is gin's single restarting timer (fidice keeps its own
// queue) with one held slot: a long toast cut short by a shorter one comes back for its remainder.
// `createTimers` is the `Map<TimerId, Timer>` both boots kept for the Play tab's long press, the
// shake and the R14 beat: arming a timer again restarts it, a fired one forgets itself.
// The clock is injected (web/shared/lib/clock.ts): main.ts passes the real one, the tests a fake.
// An edge (eslint.config.js EDGES), not a painter: the timers are state a Map holds between calls,
// which the everywhere profile forbids; the folder's pure profile carves it out like shellPaint.ts.
import type { Clock, Timer } from '../lib/clock.ts';
import type { DocumentLike } from '../edge/dom.ts';

import { hideToast, showToast, type ToastMarks } from './shellPaint.ts';

/** The legacy `toast(msg, ms)` default, gin's and backgammon's alike (its design Q12). */
export const TOAST_MS = 2600;

export type Timers<Id extends string> = Readonly<{
  /** Arm `id` to `fire` after `ms`; an armed `id` is restarted. */
  start: (id: Id, ms: number, fire: () => void) => void;
  /** Disarm `id`; an unknown or fired one is a no-op. */
  cancel: (id: Id) => void;
}>;

export const createTimers = <Id extends string>(clock: Clock): Timers<Id> => {
  const armed = new Map<Id, Timer>();
  const cancel = (id: Id): void => {
    const timer = armed.get(id);
    if (timer !== undefined) clock.clearTimeout(timer);
    armed.delete(id);
  };
  const start = (id: Id, ms: number, fire: () => void): void => {
    cancel(id);
    armed.set(
      id,
      clock.setTimeout(() => {
        armed.delete(id);
        fire();
      }, ms),
    );
  };
  return { start, cancel };
};

/** `toast(msg, ms)`: `ms` null or absent means the default. */
export type Toast = (message: string, ms?: number | null) => void;

/** A toast on the clock: its text and the moment (`clock.now()`) it is due to hide. */
type Due = Readonly<{ message: string; until: number }>;

/** Of two toasts, the one due last; either may be absent. */
const later = (a: Due | null, b: Due | null): Due | null =>
  a === null ? b : b === null ? a : a.until >= b.until ? a : b;

/**
 * Show `message` and hide it after `ms ?? defaultMs`; a toast while one is up replaces the text
 * and restarts the one timer. A toast due to hide before the one it replaces was (the 2.6 s path
 * toast, "Connected via relay", 1.5 s after the channel opens, over the 8 s rotation hint) holds
 * that one and brings it back for its remainder when it hides, so a long toast is interrupted,
 * never lost: one slot, the toast due last, since a newcomer that outlasts what is held is the one
 * the player is meant to read and takes its place as it always did. `marks` names the classes a
 * game puts on the toast for a message (backgammon's `hit`), off for every other message, the one
 * brought back included.
 */
export const createToaster = (
  doc: DocumentLike,
  clock: Clock,
  defaultMs: number = TOAST_MS,
  marks?: (message: string) => ToastMarks,
): Toast => {
  const timer = createTimers<'toast'>(clock);
  let up: Due | null = null;
  let held: Due | null = null;
  const show = (next: Due): void => {
    up = next;
    showToast(doc, next.message, marks?.(next.message));
    timer.start('toast', next.until - clock.now(), () => {
      // Due: the held toast comes back for what is left of its time, or the toast goes.
      const back = held;
      held = null;
      if (back !== null && back.until > clock.now()) show(back);
      else {
        up = null;
        hideToast(doc);
      }
    });
  };
  return (message, ms = null) => {
    const next = { message, until: clock.now() + (ms ?? defaultMs) };
    const longest = later(held, up);
    held = longest !== null && longest.until > next.until ? longest : null;
    show(next);
  };
};
