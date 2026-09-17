import { describe, expect, test } from 'vitest';

import { fakeClock } from './clock.fake.ts';

describe('fakeClock', () => {
  test('starts where told and only advance moves it', () => {
    const clock = fakeClock(1000);
    expect(clock.now()).toBe(1000);
    clock.advance(250);
    expect(clock.now()).toBe(1250);
    clock.advance(0);
    expect(clock.now()).toBe(1250);
  });

  test('fires timers in due order, ties in scheduling order', () => {
    const clock = fakeClock();
    const log: string[] = [];
    clock.setTimeout(() => log.push('b@20'), 20);
    clock.setTimeout(() => log.push('a@10'), 10);
    clock.setTimeout(() => log.push('c@20'), 20);
    clock.advance(15);
    expect(log).toEqual(['a@10']);
    expect(clock.pending()).toBe(2);
    clock.advance(5);
    expect(log).toEqual(['a@10', 'b@20', 'c@20']);
    expect(clock.pending()).toBe(0);
  });

  test('a callback sees now() at its due time, not at the end of the advance', () => {
    const clock = fakeClock();
    const seen: number[] = [];
    clock.setTimeout(() => seen.push(clock.now()), 10);
    clock.advance(100);
    expect(seen).toEqual([10]);
    expect(clock.now()).toBe(100);
  });

  test('a timer scheduled by a firing callback fires in the same advance when due', () => {
    const clock = fakeClock();
    const log: string[] = [];
    clock.setTimeout(() => {
      log.push('first');
      clock.setTimeout(() => log.push('chained'), 5);
    }, 10);
    clock.advance(20);
    expect(log).toEqual(['first', 'chained']);
    expect(clock.now()).toBe(20);
  });

  test('a chained timer beyond the window waits for the next advance', () => {
    const clock = fakeClock();
    const log: string[] = [];
    clock.setTimeout(() => {
      log.push('first');
      clock.setTimeout(() => log.push('later'), 50);
    }, 10);
    clock.advance(20);
    expect(log).toEqual(['first']);
    clock.advance(40);
    expect(log).toEqual(['first', 'later']);
  });

  test('clearTimeout removes a pending timer; unknown and fired handles are no-ops', () => {
    const clock = fakeClock();
    const log: string[] = [];
    const t = clock.setTimeout(() => log.push('never'), 10);
    const u = clock.setTimeout(() => log.push('once'), 10);
    clock.clearTimeout(t);
    clock.advance(10);
    clock.clearTimeout(u);
    clock.clearTimeout({ kind: 'timer' });
    clock.advance(10);
    expect(log).toEqual(['once']);
  });

  test('negative delays fire as zero, at the next advance', () => {
    const clock = fakeClock();
    const log: string[] = [];
    clock.setTimeout(() => log.push('zero'), -5);
    expect(log).toEqual([]);
    clock.advance(0);
    expect(log).toEqual(['zero']);
  });

  test('runAll drains every timer, jumping time to each, and reports the count', () => {
    const clock = fakeClock();
    const log: number[] = [];
    clock.setTimeout(() => log.push(clock.now()), 1000);
    clock.setTimeout(() => {
      log.push(clock.now());
      clock.setTimeout(() => log.push(clock.now()), 1);
    }, 5);
    expect(clock.runAll()).toBe(3);
    expect(log).toEqual([5, 6, 1000]);
    expect(clock.now()).toBe(1000);
    expect(clock.runAll()).toBe(0);
  });

  test('handles are distinct per call', () => {
    const clock = fakeClock();
    const a = clock.setTimeout(() => undefined, 1);
    const b = clock.setTimeout(() => undefined, 1);
    expect(a).not.toEqual(b);
  });
});
