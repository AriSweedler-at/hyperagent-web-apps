// The real Clock (docs/ARCHITECTURE.md "Module boundaries"): the one place `Date.now` and the
// global `setTimeout` are constructed for injection. Everything that waits or expires takes a
// `Clock` and gets this one from main.ts or web/shared/edge/clock.fake.ts from a test.
import type { Clock, Timer } from '../lib/clock.ts';

// `Timer` is opaque by design (see lib/clock.ts); the host's handle is a number in browsers and
// an object in node, and it only ever travels back into `clearTimeout`, so the casts below are the
// whole extent of the lie.
export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms) as unknown as Timer,
  clearTimeout: (timer) => {
    globalThis.clearTimeout(timer as unknown as number);
  },
};
