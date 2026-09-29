// The toast timer and the reducer's named timers, the two blocks every shell main.ts spelled
// (docs/design/shared-shell.md §4.4 `toast.ts`; §5 B1 moved them out of gin's main.ts 142-159 and
// backgammon's 89-106). `createToaster` is gin's toast (fidice keeps its own queue), each on a
// timer of its own: a long toast cut short by a shorter one waits and comes back for its remainder.
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

/** A toast still within its time; its own timer, armed once when it was called, ends it. */
type Live = Readonly<{ message: string }>;

/**
 * Show `message` and hide it after `ms ?? defaultMs`; a toast while one is up replaces the text.
 * Each toast keeps a timer of its own to its own deadline, so one due to hide before the one it
 * replaced (the 2.6 s path toast, "Connected via relay", 1.5 s after the channel opens, over the
 * 8 s rotation hint) interrupts it, never loses it: the interrupted toasts wait under the one up,
 * and when it hides the one interrupted last comes back for what is left of its time; one whose
 * time runs out while another is up is forgotten. The clock is never read: the legacy toast only
 * ever set its timer, and the gin DOM-parity oracle (tools/parity/gin-dom-parity.ts) steps its
 * `Date.now` on every read, so a read here would show as a clock the legacy page does not have.
 * `marks` names the classes a game puts on the toast for a message (backgammon's `hit`), off for
 * every other message, the one brought back included.
 */
export const createToaster = (
  doc: DocumentLike,
  clock: Clock,
  defaultMs: number = TOAST_MS,
  marks?: (message: string) => ToastMarks,
): Toast => {
  let up: Live | null = null;
  /** The toasts interrupted while still within their time, the one interrupted last at the end. */
  let held: ReadonlyArray<Live> = [];
  const paint = (live: Live): void => {
    showToast(doc, live.message, marks?.(live.message));
  };
  const due = (live: Live): void => {
    if (live !== up) {
      // Its time ran out under another toast: forgotten, the screen was never its to give back.
      held = held.filter((other) => other !== live);
      return;
    }
    up = held.at(-1) ?? null;
    held = held.slice(0, -1);
    if (up === null) hideToast(doc);
    else paint(up);
  };
  return (message, ms = null) => {
    const live: Live = { message };
    clock.setTimeout(() => {
      due(live);
    }, ms ?? defaultMs);
    if (up !== null) held = [...held, up];
    up = live;
    paint(live);
  };
};
