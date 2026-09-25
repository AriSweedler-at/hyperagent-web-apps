// The keyed slot over a FAKE element (web/shared/edge/page.fake.ts): when the markup is asked for,
// what the element records, and that a cleared key paints again (docs/design/dry-round-2.md §6
// `ui/keyed.ts`; the first case moved here from shellPaint.test.ts in D1).
import { describe, expect, test } from 'vitest';

import { setAttr } from '../edge/dom.ts';
import { fakeEl } from '../edge/page.fake.ts';
import { ensureKeyed } from './keyed.ts';

describe('ensureKeyed', () => {
  test('rebuilds the element only when the key changes, and records the key', () => {
    const el = fakeEl('dice', { text: 'old' });
    const builds: string[] = [];
    const markup = (): string => {
      builds.push('built');
      return '<b>new</b>';
    };
    ensureKeyed(el.el, 'k1', markup);
    expect(el.attr('data-key')).toBe('k1');
    expect(el.text()).toBe('<b>new</b>');
    ensureKeyed(el.el, 'k1', markup);
    expect(builds).toHaveLength(1);
    ensureKeyed(el.el, 'k2', markup);
    expect(builds).toHaveLength(2);
    expect(el.attr('data-key')).toBe('k2');
  });

  test('the same key leaves the children as a later write left them', () => {
    const el = fakeEl('stockPile');
    ensureKeyed(el.el, 'back', () => '<div class="card"></div><div class="pile-label"></div>');
    // A painter refreshes a child after the build (gin's pile label); the next same-key paint
    // must not rebuild over it.
    setAttr(el.el, 'data-count', '30');
    ensureKeyed(el.el, 'back', () => {
      throw new Error('rebuilt under the same key');
    });
    expect(el.text()).toBe('<div class="card"></div><div class="pile-label"></div>');
    expect(el.attr('data-count')).toBe('30');
  });

  test('a slot whose key was cleared paints again under the key it once had', () => {
    const el = fakeEl('tableMelds');
    const builds: string[] = [];
    const markup = (): string => {
      builds.push('built');
      return '<div class="meld-group"></div>';
    };
    ensureKeyed(el.el, '1:0:2', markup);
    setAttr(el.el, 'data-key', null);
    expect(el.attr('data-key')).toBeNull();
    ensureKeyed(el.el, '1:0:2', markup);
    expect(builds).toHaveLength(2);
    expect(el.attr('data-key')).toBe('1:0:2');
  });
});
