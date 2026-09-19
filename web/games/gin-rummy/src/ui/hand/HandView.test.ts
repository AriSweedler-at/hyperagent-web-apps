import { describe, expect, test } from 'vitest';

import { makeCard } from '../../engine/cards.ts';
import { cardHtml } from '../cards.ts';
import { RULES_ITEMS, RULES_LIST_HTML, RULES_TITLE } from '../rules.ts';
import { defaultHandView, type HandModel } from './HandView.ts';
import { meldGroupClass, meldGroupsHtml } from './meldGroups.ts';

const [as, ah, ad, s5, s6, s7, k, q] = [
  makeCard(1, 'S'),
  makeCard(1, 'H'),
  makeCard(1, 'D'),
  makeCard(5, 'S'),
  makeCard(6, 'S'),
  makeCard(7, 'S'),
  makeCard(13, 'C'),
  makeCard(12, 'H'),
];
const set = [as, ah, ad];
const run = [s5, s6, s7];

const model = (over: Partial<HandModel> = {}): HandModel => ({
  me: {
    idx: 0,
    id: 'p1',
    name: 'Ann',
    total: 0,
    hand: [...set, ...run, k, q],
    melds: [set, run],
    deadwood: [k, q],
    deadwoodValue: 20,
  },
  phase: 'discard',
  isMyTurn: true,
  lastDrawnId: null,
  drawnFromDiscard: null,
  ...over,
});

describe('defaultHandView.render', () => {
  test('one coloured group per meld, then the deadwood group; no deadwood group for a gin hand', () => {
    expect(defaultHandView.render(model(), null)).toBe(
      `<div class="meld-group m0">${set.map((c) => cardHtml(c)).join('')}</div>` +
        `<div class="meld-group m1">${run.map((c) => cardHtml(c)).join('')}</div>` +
        `<div class="meld-group dead">${cardHtml(k)}${cardHtml(q)}</div>`,
    );
    const gin = model({ me: { ...model().me, deadwood: [], deadwoodValue: 0 } });
    expect(defaultHandView.render(gin, null)).not.toContain('dead');
  });

  test('selected, fresh and locked marks; locked only while discarding on my turn', () => {
    const html = defaultHandView.render(model({ lastDrawnId: 'KC', drawnFromDiscard: 'QH' }), 'AS');
    expect(html).toContain('class="card black selected" data-card="AS"');
    expect(html).toContain('class="card black fresh" data-card="KC"');
    expect(html).toContain('class="card red locked" data-card="QH"');
    const theirTurn = defaultHandView.render(
      model({ drawnFromDiscard: 'QH', isMyTurn: false }),
      null,
    );
    expect(theirTurn).not.toContain('locked');
    const drawing = defaultHandView.render(model({ drawnFromDiscard: 'QH', phase: 'draw' }), null);
    expect(drawing).not.toContain('locked');
  });

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
