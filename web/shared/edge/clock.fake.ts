// A Clock driven by hand for tests: time moves only through `advance`, timers fire in due order
// (ties by scheduling order) and a callback that schedules another timer within the advanced
// window sees it fire in the same call. Lives under edge, not lib, because a usable fake has to
// keep a timer queue between calls; lib forbids that mutation.
import type { Clock, Timer } from '../lib/clock.ts';

export type FakeClock = Clock &
  Readonly<{
    /** Move time forward by `ms`, firing every timer due on the way, in order. */
    advance: (ms: number) => void;
    /** Fire every pending timer in due order, jumping time to each; returns how many fired. */
    runAll: () => number;
    /** Timers scheduled and not yet fired or cleared. */
    pending: () => number;
  }>;

type Scheduled = Readonly<{ id: number; at: number; seq: number; fn: () => void }>;

type FakeTimer = Timer & Readonly<{ id: number }>;

const asTimer = (id: number): FakeTimer => ({ kind: 'timer', id });

const isFakeTimer = (timer: Timer): timer is FakeTimer =>
  typeof (timer as Partial<FakeTimer>).id === 'number';

export const fakeClock = (start = 0): FakeClock => {
  let now = start;
  let nextId = 1;
  let queue: ReadonlyArray<Scheduled> = [];

  const earliest = (): Scheduled | undefined =>
    queue.reduce<Scheduled | undefined>(
      (best, t) =>
        best === undefined || t.at < best.at || (t.at === best.at && t.seq < best.seq) ? t : best,
      undefined,
    );

  /** Fire timers due at or before `until`, one at a time (each may schedule more), then land on it. */
  const fireUntil = (until: number, fired: number): number => {
    const next = earliest();
    if (next === undefined || next.at > until) {
      if (Number.isFinite(until)) now = Math.max(now, until);
      return fired;
    }
    queue = queue.filter((t) => t.id !== next.id);
    now = Math.max(now, next.at);
    next.fn();
    return fireUntil(until, fired + 1);
  };

  return {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = nextId;
      nextId += 1;
      queue = [...queue, { id, at: now + Math.max(0, ms), seq: id, fn }];
      return asTimer(id);
    },
    clearTimeout: (timer) => {
      if (isFakeTimer(timer)) queue = queue.filter((t) => t.id !== timer.id);
    },
    advance: (ms) => {
      fireUntil(now + Math.max(0, ms), 0);
    },
    runAll: () => fireUntil(Number.POSITIVE_INFINITY, 0),
    pending: () => queue.length,
  };
};
