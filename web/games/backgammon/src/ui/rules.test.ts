// The rules items, the glossary and the About copy agree (docs/design/glossary-links.md §2, §4):
// every id is unique, every word in the glossary names a rule the ruleset has, every link in the
// About copy and in a rule body lands on a rule of that ruleset, and a rule never links to itself.
import { describe, expect, test } from 'vitest';

import { SHIPPED_VARIANTS } from '../engine/index.ts';
import { ABOUT_PARAGRAPHS, aboutHtml } from './about.ts';
import { GLOSSARY } from './glossary.ts';
import { RULES_ITEMS, RULES_SLOT_IDS, RULES_TITLE, rulesItemsHtml } from './rules.ts';

/** The `data-rule` targets of every link in `html`. */
const targets = (html: string): ReadonlyArray<string> =>
  [...html.matchAll(/data-rule="([^"]+)"/g)].map((m) => m[1] ?? '');

describe('the rules items', () => {
  test('nine Portes items, eleven Western, unique ids, every id also an anchor in the rendered list', () => {
    expect(RULES_ITEMS.portes.map((r) => r.id)).toEqual([
      'goal',
      'direction',
      'rolling',
      'blocks',
      'bearing-off',
      'opening',
      'scoring',
      'match',
      'online',
    ]);
    expect(RULES_ITEMS.backgammon.map((r) => r.id)).toEqual([
      'goal',
      'direction',
      'rolling',
      'blocks',
      'bearing-off',
      'opening',
      'scoring',
      'cube',
      'crawford',
      'match',
      'online',
    ]);
    SHIPPED_VARIANTS.forEach((variant) => {
      const html = rulesItemsHtml(variant);
      expect(html.split('\n')).toHaveLength(RULES_ITEMS[variant].length);
      RULES_ITEMS[variant].forEach((item) => {
        expect(html).toContain(`<li id="rule-${item.id}"><strong>${item.heading}:</strong> `);
      });
    });
    expect(RULES_SLOT_IDS).toEqual(['rulesList', 'rulesOverlayList']);
    expect(RULES_TITLE).toBe('Sheshbesh — Rules');
  });

  test('every glossary rule and every link target is a rule of that ruleset; no rule links to itself', () => {
    SHIPPED_VARIANTS.forEach((variant) => {
      const ids = RULES_ITEMS[variant].map((r) => r.id);
      GLOSSARY[variant].forEach((entry) => {
        expect(ids, `${variant}: ${entry.rule}`).toContain(entry.rule);
      });
      rulesItemsHtml(variant)
        .split('\n')
        .forEach((line, i) => {
          const own = RULES_ITEMS[variant][i]?.id ?? '';
          targets(line).forEach((target) => {
            expect(ids).toContain(target);
            expect(target).not.toBe(own);
          });
        });
      targets(aboutHtml(variant)).forEach((target) => {
        expect(ids, `${variant}: About links ${target}`).toContain(target);
      });
    });
  });

  test('a rule that names another rule links it (Goal -> direction and bearing off; Crawford -> cube)', () => {
    const western = rulesItemsHtml('backgammon').split('\n');
    expect(western[0]).toContain('data-rule="direction">home board</a>');
    expect(western[0]).toContain('data-rule="bearing-off">bear them off</a>');
    expect(western[8]).toContain('data-rule="cube">cube</a>');
    // Western scoring names the bar, Portes scoring the cube it lacks: both point somewhere true.
    expect(western[6]).toContain('data-rule="blocks">the bar</a>');
    expect(rulesItemsHtml('portes').split('\n')[6]).not.toContain('data-rule="cube"');
  });
});

describe('the About copy', () => {
  test('two paragraphs: the Sephardic one and the rulesets, with the jargon the owner named linked', () => {
    expect(ABOUT_PARAGRAPHS).toHaveLength(2);
    expect(ABOUT_PARAGRAPHS[0]).toContain('Sephardic');
    const western = aboutHtml('backgammon');
    expect(western.split('\n')).toHaveLength(2);
    ['gammon', 'doubling cube', 'Crawford rule', 'Bear off', 'opening roll'].forEach((word) => {
      expect(western).toMatch(
        new RegExp(`<a class="jargon" href="#rule-[\\w-]+" data-rule="[\\w-]+">${word}</a>`),
      );
    });
    // "counts double" and "backgammon" the game keep their everyday sense: no link.
    expect(western).not.toMatch(/data-rule="[^"]+">double</);
    expect(western).not.toMatch(/data-rule="[^"]+">backgammon</);
    // "Portes" links only where a rule names it: Portes's Scoring does, no Western rule does.
    expect(western).not.toMatch(/data-rule="[^"]+">Portes</);
    expect(aboutHtml('portes')).toContain('data-rule="scoring">Portes</a>');
    expect(aboutHtml('portes')).toContain('data-rule="scoring">doubling cube</a>');
  });
});
