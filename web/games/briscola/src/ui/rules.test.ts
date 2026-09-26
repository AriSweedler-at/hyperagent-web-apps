// The rules list and the About copy (ui/rules.ts, ui/glossary.ts, ui/about.ts): one anchor per
// rule, every glossary rule an item, the jargon linked the way the shell's glossary spec taps it
// (e2e/fixtures/online-games.ts SHELL_DRIVERS.briscola.glossary: "briscola" in the About copy
// lands on the briscola rule, the trick rule names the draw, the draw rule names the trick, the
// goal is the deep link), the ranks' table of points left unlinked, and no rule linking to itself.
import { describe, expect, test } from 'vitest';

import { ruleAnchor } from '../../../../shared/ui/glossary.ts';
import { ABOUT_PARAGRAPHS, aboutHtml } from './about.ts';
import { GLOSSARY } from './glossary.ts';
import {
  RANK_POINTS,
  RULES_ITEMS,
  RULES_SLOT_IDS,
  rankTableHtml,
  rulesItemsHtml,
} from './rules.ts';

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
  test('six short rules with distinct kebab-case ids, one or two sentences each; every glossary rule is one of them; no "carichi" anywhere', () => {
    const ids = RULES_ITEMS.map((r) => r.id);
    expect(ids).toEqual(['goal', 'deal', 'briscola', 'ranks', 'trick', 'draw']);
    ids.forEach((id) => {
      expect(id).toMatch(/^[a-z][a-z-]*$/);
    });
    RULES_ITEMS.forEach((r) => {
      const prose = r.body.replace(/<table.*<\/table>/s, '');
      expect(prose.split(/(?<=[.!?])\s+(?=[A-Z])/).length).toBeLessThanOrEqual(2);
      expect(prose).not.toMatch(/carich|house rule|best of|match|online/i);
    });
    GLOSSARY.forEach(({ rule, terms }) => {
      expect(ids).toContain(rule);
      expect(terms.length).toBeGreaterThan(0);
    });
    expect(RULES_SLOT_IDS).toEqual(['rulesList', 'rulesOverlayList']);
  });

  test('the ranks run low to high and carry their points as a table the linker leaves alone', () => {
    const ranks = RULES_ITEMS.find((r) => r.id === 'ranks');
    expect(
      ranks?.body.startsWith('Low to high: 2, 4, 5, 6, 7, fante, cavallo, re, tre, asso.'),
    ).toBe(true);
    expect(RANK_POINTS).toEqual([
      ['2, 4, 5, 6, 7', 0],
      ['fante', 2],
      ['cavallo', 3],
      ['re', 4],
      ['tre', 10],
      ['asso', 11],
    ]);
    const table = rankTableHtml();
    expect(
      table.startsWith(
        '<table class="rank-table"><thead><tr><th>Card</th><th>Points</th></tr></thead><tbody>',
      ),
    ).toBe(true);
    expect(table.match(/<tr>/g)).toHaveLength(7);
    expect(table).toContain('<tr><td>asso</td><td>11</td></tr>');
    expect(table).toContain('<tr><td>2, 4, 5, 6, 7</td><td>0</td></tr>');
    // Rendered in the list, the table's cells carry no link ("Points" is the goal's term outside it).
    const item = itemOf(rulesItemsHtml(), 'ranks');
    const rendered = /<table.*<\/table>/s.exec(item)?.[0] ?? '';
    expect(rendered).toBe(table);
    expect(linkedRules(item)).toEqual([]);
  });

  test('the rendered items carry their anchors; the trick and the draw link each other, the goal names the trick, no rule links to itself', () => {
    const html = rulesItemsHtml();
    RULES_ITEMS.forEach((r) => {
      expect(html).toContain(`<li id="${ruleAnchor(r.id)}"><strong>${r.heading}:</strong>`);
      expect(linkedRules(itemOf(html, r.id))).not.toContain(r.id);
    });
    expect(linkedRules(itemOf(html, 'trick'))).toContain('draw');
    expect(linkedRules(itemOf(html, 'draw'))).toContain('trick');
    expect(linkedRules(itemOf(html, 'goal'))).toContain('trick');
    expect(linkedRules(itemOf(html, 'deal'))).toContain('briscola');
    expect(itemOf(html, 'goal')).toContain('the highest total wins the game');
    expect(itemOf(html, 'deal')).toContain('the deal passes to the next seat when you play again');
  });
});

describe('the About copy', () => {
  test('two paragraphs without "carichi"; the word "briscola" itself is a link on the briscola rule (the shell glossary spec taps it)', () => {
    expect(ABOUT_PARAGRAPHS).toHaveLength(2);
    ABOUT_PARAGRAPHS.forEach((p) => {
      expect(p).not.toMatch(/carich/i);
    });
    const html = aboutHtml();
    expect(html.match(/<p>/g)).toHaveLength(2);
    const links = [
      ...html.matchAll(/<a class="jargon"[^>]*data-rule="([a-z-]+)"[^>]*>([^<]+)<\/a>/g),
    ];
    // Once across the copy (the shell glossary spec locates the one link with that text).
    expect(links.filter((m) => m[2] === 'briscola').map((m) => m[1])).toEqual(['briscola']);
    expect(linkedRules(html)).toEqual(expect.arrayContaining(['briscola', 'trick', 'ranks']));
  });
});
