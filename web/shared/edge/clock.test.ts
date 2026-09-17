import { afterEach, describe, expect, test, vi } from 'vitest';

import { realClock } from './clock.ts';

describe('realClock', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('now is Date.now', () => {
    vi.useFakeTimers({ now: 1_700_000_000_000 });
    expect(realClock.now()).toBe(1_700_000_000_000);
  });

  test('setTimeout schedules on the host and clearTimeout cancels it', () => {
    vi.useFakeTimers();
    const fired: string[] = [];
    const kept = realClock.setTimeout(() => fired.push('kept'), 10);
    const cancelled = realClock.setTimeout(() => fired.push('cancelled'), 10);
    realClock.clearTimeout(cancelled);
    vi.advanceTimersByTime(10);
    expect(fired).toEqual(['kept']);
    // Clearing a fired timer is a no-op.
    realClock.clearTimeout(kept);
    expect(fired).toEqual(['kept']);
  });
});
