import { describe, expect, test } from 'vitest';

import { makeCard } from '../../engine/cards.ts';
import { cardHtml } from '../cards.ts';
import { RULES_ITEMS, RULES_LIST_HTML, RULES_TITLE } from '../rules.ts';
import { meldGroupClass, meldGroupsHtml } from './meldGroups.ts';

const [as, ah, ad, s5, s6, s7] = [
  makeCard(1, 'S'),
  makeCard(1, 'H'),
  makeCard(1, 'D'),
  makeCard(5, 'S'),
  makeCard(6, 'S'),
  makeCard(7, 'S'),
];
const set = [as, ah, ad];
const run = [s5, s6, s7];

describe('meldGroupClass', () => {
  test('the sixth meld wraps back to the first colour', () => {
    expect([0, 1, 4, 5, 6].map(meldGroupClass)).toEqual([
      'meld-group m0',
      'meld-group m1',
      'meld-group m4',
      'meld-group m0',
      'meld-group m1',
    ]);
  });
});

describe('meldGroupsHtml', () => {
  test('mini cards when asked, extra markup appended, nothing for no melds', () => {
    expect(meldGroupsHtml([set], '', true)).toBe(
      `<div class="meld-group m0">${set.map((c) => cardHtml(c, { mini: true })).join('')}</div>`,
    );
    expect(meldGroupsHtml([set, run], '<hr>')).toBe(
      `<div class="meld-group m0">${set.map((c) => cardHtml(c)).join('')}</div>` +
        `<div class="meld-group m1">${run.map((c) => cardHtml(c)).join('')}</div><hr>`,
    );
    expect(meldGroupsHtml([])).toBe('');
  });
});

describe('rules', () => {
  test('eleven items, each headed in bold, wrapped once in the legacy list', () => {
    expect(RULES_ITEMS).toHaveLength(11);
    RULES_ITEMS.forEach((item) => {
      expect(item).toMatch(/^<strong>[^<]+:<\/strong> /);
    });
    expect(RULES_LIST_HTML.startsWith('<ul class="rules-list">\n<li>')).toBe(true);
    expect(RULES_LIST_HTML.endsWith('</li>\n</ul>')).toBe(true);
    expect(RULES_LIST_HTML.match(/<li>/g)).toHaveLength(11);
    expect(RULES_TITLE).toBe('Gin Rummy — Quick Rules');
  });
});
