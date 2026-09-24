// The toast timer and the reducer's named timers, the two blocks every shell main.ts spelled
// (docs/design/shared-shell.md §4.4 `toast.ts`; §5 B1 moved them out of gin's main.ts 142-159 and
// backgammon's 89-106). `createToaster` is gin's single restarting timer (fidice keeps its own
// queue); `createTimers` is the `Map<TimerId, Timer>` both boots kept for the Play tab's long
// press, the shake and the R14 beat: arming a timer again restarts it, a fired one forgets itself.
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

/**
 * Show `message` and hide it after `ms ?? defaultMs`; a toast while one is up replaces the text
 * and restarts the one timer. `marks` names the classes a game puts on the toast for a message
 * (backgammon's `hit`), off for every other message.
 */
export const createToaster = (
  doc: DocumentLike,
  clock: Clock,
  defaultMs: number = TOAST_MS,
  marks?: (message: string) => ToastMarks,
): Toast => {
  const timer = createTimers<'toast'>(clock);
  return (message, ms = null) => {
    showToast(doc, message, marks?.(message));
    timer.start('toast', ms ?? defaultMs, () => {
      hideToast(doc);
    });
  };
};
