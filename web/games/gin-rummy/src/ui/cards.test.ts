import { describe, expect, test } from 'vitest';

import { makeCard } from '../engine/cards.ts';
import { backHtml, cardClass, cardHtml, isRed, pretty, rankLabel } from './cards.ts';

describe('cardHtml', () => {
  test('rank, suit symbol and the bottom-right rank, with the id on data-card', () => {
    expect(cardHtml(makeCard(1, 'S'))).toBe(
      '<div class="card black" data-card="AS"><span class="rank">A</span><span class="suit">♠</span><span class="rank br">A</span></div>',
    );
    expect(cardHtml(makeCard(10, 'H'), { big: true })).toBe(
      '<div class="card red big" data-card="10H"><span class="rank">10</span><span class="suit">♥</span><span class="rank br">10</span></div>',
    );
  });

  test('the class list keeps the legacy order and drops false flags', () => {
    expect(cardClass(makeCard(13, 'D'), { locked: true, mini: true, selected: true })).toBe(
      'card red mini selected locked',
    );
    expect(cardClass(makeCard(2, 'C'), { dim: true, fresh: true, big: false })).toBe(
      'card black dim fresh',
    );
    expect(cardClass(makeCard(2, 'C'))).toBe('card black');
  });

  test('backs, colours and the label helpers', () => {
    expect(backHtml()).toBe('<div class="card back "></div>');
    expect(backHtml('tiny')).toBe('<div class="card back tiny"></div>');
    expect([isRed('H'), isRed('D'), isRed('S'), isRed('C')]).toEqual([true, true, false, false]);
    expect([1, 11, 12, 13, 7].map((r) => rankLabel(r as 1))).toEqual(['A', 'J', 'Q', 'K', '7']);
    expect(pretty(makeCard(12, 'H'))).toBe('Q♥');
  });
});
