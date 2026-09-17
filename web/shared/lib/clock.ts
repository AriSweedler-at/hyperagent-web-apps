// Clock is the injected source of time for sessions, timers and the ICE loader
// (docs/ARCHITECTURE.md "Module boundaries"): `Date.now` and `setTimeout` are constructed only in
// web/shared/edge/clock.ts, and tests pass web/shared/edge/clock.fake.ts so every timeout is driven
// by hand. This module holds the types alone: the pure project compiles without DOM or node libs,
// so neither `setTimeout` nor its handle type is nameable here.

/**
 * Handle of a scheduled callback, opaque on purpose: browsers return a number and node an object,
 * and callers only ever hand it back to `clearTimeout`.
 */
export type Timer = Readonly<{ kind: 'timer' }>;

/* eslint-disable functional/no-return-void -- this is the contract of an effectful edge: a timer
   callback and clearTimeout have nothing to return, and `void` says so to every implementer. */
export type Clock = Readonly<{
  /** Milliseconds since the epoch, like `Date.now()`. */
  now: () => number;
  /** Run `fn` once after `ms` milliseconds; the handle cancels it. */
  setTimeout: (fn: () => void, ms: number) => Timer;
  /** Cancel a pending timer; a fired or unknown handle is a no-op. */
  clearTimeout: (timer: Timer) => void;
}>;
/* eslint-enable functional/no-return-void */
