// The rules list and the About copy (ui/rules.ts, ui/glossary.ts, ui/about.ts): one anchor per
// rule, every glossary rule an item, the jargon linked the way the shell's glossary spec taps it
// (e2e/fixtures/online-games.ts SHELL_DRIVERS.briscola.glossary: "briscola" in the About copy
// lands on the briscola rule, the trick rule names the draw, the last tricks name the draw, the
// scoring rule is the deep link), and no rule linking to itself.
import { describe, expect, test } from 'vitest';

import { ruleAnchor } from '../../../../shared/ui/glossary.ts';
import { ABOUT_PARAGRAPHS, aboutHtml } from './about.ts';
import { GLOSSARY } from './glossary.ts';
import { RULES_ITEMS, RULES_SLOT_IDS, rulesItemsHtml } from './rules.ts';

/** The `<li>` of rule `id` in the rendered list. */
const itemOf = (html: string, id: string): string => {
  const m = new RegExp(`<li id="${ruleAnchor(id)}">.*?</li>`, 's').exec(html);
  if (m === null) throw new Error(`no item ${id}`);
  return m[0];
};

/** The rule ids the links in `html` point at, in order. */
const linkedRules = (html: string): ReadonlyArray<string> =>
  [...html.matchAll(/data-rule="([a-z-]+)"/g)].map((m) => m[1] ?? '');

describe('the rules list', () => {
  test('eleven rules with distinct kebab-case ids; every glossary rule is one of them', () => {
    const ids = RULES_ITEMS.map((r) => r.id);
    expect(ids).toHaveLength(11);
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id) => {
      expect(id).toMatch(/^[a-z][a-z-]*$/);
    });
    GLOSSARY.forEach(({ rule, terms }) => {
      expect(ids).toContain(rule);
      expect(terms.length).toBeGreaterThan(0);
    });
    expect(RULES_SLOT_IDS).toEqual(['rulesList', 'rulesOverlayList']);
  });

  test('the rendered items carry their anchors; the trick and the last tricks link to the draw, no rule links to itself', () => {
    const html = rulesItemsHtml();
    RULES_ITEMS.forEach((r) => {
      expect(html).toContain(`<li id="${ruleAnchor(r.id)}"><strong>${r.heading}:</strong>`);
      expect(linkedRules(itemOf(html, r.id))).not.toContain(r.id);
    });
    expect(linkedRules(itemOf(html, 'trick'))).toContain('draw');
    expect(linkedRules(itemOf(html, 'last-tricks'))).toContain('draw');
    expect(itemOf(html, 'scoring')).toContain('The highest total wins the game');
  });
});

describe('the About copy', () => {
  test('two paragraphs; the word "briscola" itself is a link on the briscola rule (the shell glossary spec taps it)', () => {
    expect(ABOUT_PARAGRAPHS).toHaveLength(2);
    const html = aboutHtml();
    expect(html.match(/<p>/g)).toHaveLength(2);
    const links = [
      ...html.matchAll(/<a class="jargon"[^>]*data-rule="([a-z-]+)"[^>]*>([^<]+)<\/a>/g),
    ];
    // Once across the copy (the shell glossary spec locates the one link with that text).
    expect(links.filter((m) => m[2] === 'briscola').map((m) => m[1])).toEqual(['briscola']);
    expect(linkedRules(html)).toEqual(expect.arrayContaining(['trick', 'goal', 'online']));
  });
});
