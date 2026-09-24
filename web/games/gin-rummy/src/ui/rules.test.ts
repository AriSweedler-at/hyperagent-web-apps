// The rules items, the glossary and the About copy agree (docs/design/glossary-links.md §2, §4):
// every id is unique, every word in the glossary names a rule, every link in the About copy and in
// a rule body lands on a rule, and a rule never links to itself. The words themselves are pinned
// against the legacy page by test/parity/gin.ui.test.ts.
import { describe, expect, test } from 'vitest';

import { ABOUT_PARAGRAPHS, aboutHtml } from './about.ts';
import { GLOSSARY } from './glossary.ts';
import { RULES_ITEMS, RULES_SLOT_IDS, rulesItemsHtml } from './rules.ts';

/** The `data-rule` targets of every link in `html`. */
const targets = (html: string): ReadonlyArray<string> =>
  [...html.matchAll(/data-rule="([^"]+)"/g)].map((m) => m[1] ?? '');

const IDS = RULES_ITEMS.map((r) => r.id);

describe('the rules items', () => {
  test('eleven unique ids in the legacy order, each an anchor in the rendered list', () => {
    expect(IDS).toEqual([
      'melds',
      'deadwood',
      'choosing-melds',
      'deal',
      'draw',
      'knock',
      'gin',
      'layoff',
      'undercut',
      'void-hand',
      'match',
    ]);
    const html = rulesItemsHtml();
    expect(html.split('\n')).toHaveLength(11);
    RULES_ITEMS.forEach((item) => {
      expect(html).toContain(`<li id="rule-${item.id}"><strong>${item.heading}:</strong> `);
    });
    expect(RULES_SLOT_IDS).toEqual(['rulesList', 'rulesOverlayList']);
  });

  test('every glossary rule and every link target is a rule; no rule links to itself', () => {
    GLOSSARY.forEach((entry) => {
      expect(IDS, entry.rule).toContain(entry.rule);
    });
    rulesItemsHtml()
      .split('\n')
      .forEach((line, i) => {
        const own = IDS[i] ?? '';
        targets(line).forEach((target) => {
          expect(IDS).toContain(target);
          expect(target).not.toBe(own);
        });
      });
    targets(aboutHtml()).forEach((target) => {
      expect(IDS, `About links ${target}`).toContain(target);
    });
  });

  test('a rule that names another rule links it (Knock -> drawing, deadwood; Gin -> knock, lay-offs)', () => {
    const lines = rulesItemsHtml().split('\n');
    expect(lines[5]).toContain('data-rule="draw">drawing</a>');
    expect(lines[5]).toContain('data-rule="deadwood">deadwood</a>');
    expect(lines[6]).toContain('data-rule="knock">Knock</a>');
    expect(lines[6]).toContain('data-rule="layoff">lay-offs</a>');
    // Its own name stays plain: "gin" in the Gin rule, "deadwood" in Deadwood.
    expect(lines[6]).not.toContain('data-rule="gin"');
    expect(lines[1]).not.toContain('data-rule="deadwood"');
  });
});

describe('the About copy', () => {
  test('two paragraphs with the jargon linked and the game not named as a term', () => {
    expect(ABOUT_PARAGRAPHS).toHaveLength(2);
    const html = aboutHtml();
    expect(html.split('\n')).toHaveLength(2);
    [
      'draw',
      'melds',
      'knocks',
      'deadwood',
      'goes gin',
      'Knock',
      'go gin',
      'lays off',
      'undercut',
      'target score',
    ].forEach((word) => {
      expect(html).toMatch(
        new RegExp(`<a class="jargon" href="#rule-[\\w-]+" data-rule="[\\w-]+">${word}</a>`),
      );
    });
    expect(html).toContain('data-rule="knock">knocks</a>');
    expect(html).toContain('data-rule="match">target score</a>');
    // "gin" the hand is linked; the game's name never appears in the prose.
    expect(ABOUT_PARAGRAPHS.join(' ')).not.toMatch(/Gin Rummy/);
  });
});
