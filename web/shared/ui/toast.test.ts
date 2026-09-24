import { describe, expect, test } from 'vitest';

import { fakeClock } from '../edge/clock.fake.ts';
import { fakeEl, fakePage, type FakePage } from '../edge/page.fake.ts';
import { TOAST_MS, createTimers, createToaster } from './toast.ts';

const page = (): FakePage => fakePage([fakeEl('toast')]);

describe('createTimers', () => {
  test('a timer fires once after its delay and forgets itself; arming it again restarts it', () => {
    const clock = fakeClock();
    const timers = createTimers<'press' | 'shake'>(clock);
    const fired: string[] = [];
    timers.start('press', 500, () => fired.push('press'));
    clock.advance(400);
    timers.start('press', 500, () => fired.push('press again'));
    clock.advance(400);
    expect(fired).toEqual([]);
    clock.advance(100);
    expect(fired).toEqual(['press again']);
    expect(clock.pending()).toBe(0);
    // A fired timer is forgotten: cancelling it is a no-op and a new one arms afresh.
    timers.cancel('press');
    timers.start('press', 10, () => fired.push('third'));
    clock.advance(10);
    expect(fired).toEqual(['press again', 'third']);
  });

  test('cancel disarms a pending timer and ignores an unknown one; ids are independent', () => {
    const clock = fakeClock();
    const timers = createTimers<'press' | 'shake'>(clock);
    const fired: string[] = [];
    timers.start('press', 100, () => fired.push('press'));
    timers.start('shake', 100, () => fired.push('shake'));
    timers.cancel('press');
    timers.cancel('press');
    clock.advance(100);
    expect(fired).toEqual(['shake']);
  });
});

describe('createToaster', () => {
  test('shows the message and hides it after the default; null or absent ms mean the default', () => {
    const clock = fakeClock();
    const p = page();
    const toast = createToaster(p.doc, clock);
    toast('Connected directly');
    expect(p.get('toast').text()).toBe('Connected directly');
    expect(p.get('toast').hasClass('show')).toBe(true);
    clock.advance(TOAST_MS - 1);
    expect(p.get('toast').hasClass('show')).toBe(true);
    clock.advance(1);
    expect(p.get('toast').hasClass('show')).toBe(false);
    expect(p.get('toast').text()).toBe('Connected directly');
    toast('again', null);
    clock.advance(TOAST_MS);
    expect(p.get('toast').hasClass('show')).toBe(false);
  });

  test('a custom default and a per-toast ms; a new toast restarts the one timer', () => {
    const clock = fakeClock();
    const p = page();
    const toast = createToaster(p.doc, clock, 1000);
    toast('first');
    clock.advance(900);
    toast('second', 5000);
    clock.advance(100);
    expect(p.get('toast').hasClass('show')).toBe(true);
    expect(p.get('toast').text()).toBe('second');
    clock.advance(4899);
    expect(p.get('toast').hasClass('show')).toBe(true);
    clock.advance(1);
    expect(p.get('toast').hasClass('show')).toBe(false);
    toast('third');
    clock.advance(1000);
    expect(p.get('toast').hasClass('show')).toBe(false);
  });

  test('marks classify each message: on for the one that earns them, off for the next', () => {
    const clock = fakeClock();
    const p = page();
    const toast = createToaster(p.doc, clock, TOAST_MS, (message) => ({
      hit: message.startsWith('Kapará.'),
    }));
    toast('Kapará. Bob hit you on your 5-point.');
    expect(p.get('toast').classes()).toEqual(['hit', 'show']);
    toast('Invite copied to clipboard');
    expect(p.get('toast').classes()).toEqual(['show']);
  });
});
