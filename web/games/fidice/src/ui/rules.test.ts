// The rules list (ui/rules.ts): six items with unique ids, the legacy prose cut into them, the
// shipped computers named, and the jargon linked to the rule it means, never to its own.
import { describe, expect, test } from 'vitest';

import { ruleAnchor } from '../../../../shared/ui/glossary.ts';
import { SHIPPED } from '../bots/registry.ts';
import { GLOSSARY, RULES_ITEMS, RULES_SLOT_IDS, rulesItemsHtml, strategiesHtml } from './rules.ts';

describe('the rules list', () => {
  test('six items, ids unique, every glossary rule one of them, the two slots named', () => {
    expect(RULES_ITEMS.map((r) => r.id)).toEqual([
      'goal',
      'setup',
      'turn',
      'calling',
      'ladder',
      'know',
    ]);
    GLOSSARY.forEach((entry) => {
      expect(
        RULES_ITEMS.some((r) => r.id === entry.rule),
        entry.rule,
      ).toBe(true);
    });
    expect(RULES_SLOT_IDS).toEqual(['rulesList', 'rulesOverlayList']);
  });

  test('the markup: one anchored <li> per item with its heading, the legacy prose inside, the computers named', () => {
    const html = rulesItemsHtml();
    RULES_ITEMS.forEach((r) => {
      expect(html).toContain(`<li id="${ruleAnchor(r.id)}"><strong>${r.heading}:</strong>`);
    });
    expect(html).toContain("one-cup liar's dice");
    expect(html).toContain('Kezar Lake');
    expect(html).toContain('There are exactly 252 distinct hands.');
    SHIPPED.forEach((s) => {
      expect(html).toContain(`<b>${s.name}</b>`);
    });
    expect(strategiesHtml().split('; ')).toHaveLength(SHIPPED.length);
  });

  test('jargon links: "the ladder" in the goal links to the ladder rule; the ladder rule never links to itself', () => {
    const html = rulesItemsHtml();
    const goal = html.slice(html.indexOf('id="rule-goal"'), html.indexOf('id="rule-setup"'));
    expect(goal).toMatch(/<a [^>]*#rule-ladder[^>]*>the ladder<\/a>/);
    const ladder = html.slice(html.indexOf('id="rule-ladder"'), html.indexOf('id="rule-know"'));
    expect(ladder).not.toContain('#rule-ladder"');
  });
});
