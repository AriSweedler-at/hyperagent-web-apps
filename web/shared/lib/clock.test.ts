import { describe, expectTypeOf, test } from 'vitest';

import type { Clock, Timer } from './clock.ts';

// clock.ts is types only; this pins the contract's shape so an edge implementation and the fake
// (web/shared/edge/clock.ts, clock.fake.ts) are checked against the same three members.
describe('Clock', () => {
  test('has now, setTimeout and clearTimeout with the documented signatures', () => {
    expectTypeOf<Clock['now']>().toEqualTypeOf<() => number>();
    expectTypeOf<Clock['setTimeout']>().toEqualTypeOf<(fn: () => void, ms: number) => Timer>();
    expectTypeOf<Clock['clearTimeout']>().toEqualTypeOf<(timer: Timer) => void>();
    expectTypeOf<keyof Clock>().toEqualTypeOf<'now' | 'setTimeout' | 'clearTimeout'>();
  });

  test('Timer is opaque: a bare number or object is not one', () => {
    expectTypeOf<number>().not.toExtend<Timer>();
    expectTypeOf<object>().not.toExtend<Timer>();
  });
});
