// The glossary edge over the page fake (no jsdom): a delegated tap on a jargon link is the rule it
// names and nothing else; `revealRule` scrolls and flashes the rule inside the slot it is told.
import { describe, expect, test } from 'vitest';

import {
  FLASH_MS,
  RULE_FLASH_CLASS,
  bindJargon,
  browserTiming,
  revealRule,
  type RevealTiming,
} from './glossary.ts';
import { fakeEl, fakePage, fakeTarget, type FakeEl } from './page.fake.ts';

/** A timing that runs the paint step at once and hands the test the flash's end. */
const timing = (): RevealTiming &
  Readonly<{ pending: () => ReadonlyArray<number>; fire: () => void }> => {
  const later: { fn: () => void; ms: number }[] = [];
  return {
    afterPaint: (fn) => {
      fn();
    },
    after: (fn, ms) => {
      later.push({ fn, ms });
    },
    pending: () => later.map((l) => l.ms),
    fire: () => {
      later.splice(0).forEach((l) => {
        l.fn();
      });
    },
  };
};

const rulesPage = (): Readonly<{
  page: ReturnType<typeof fakePage>;
  knock: FakeEl;
  gin: FakeEl;
}> => {
  const knock = fakeEl('rule-knock');
  const gin = fakeEl('rule-gin');
  const list = fakeEl('rulesList', { queries: { '#rule-knock': [knock], '#rule-gin': [gin] } });
  const overlay = fakeEl('rulesOverlayList', { queries: {} });
  return { page: fakePage([list, overlay, knock, gin]), knock, gin };
};

describe('bindJargon', () => {
  test('a tap on a jargon link is prevented and reports the rule it carries', () => {
    const page = fakePage([]);
    const seen: string[] = [];
    bindJargon(page.doc, (id) => {
      seen.push(id);
    });
    const link = fakeEl('link', { classes: ['jargon'], attrs: { 'data-rule': 'knock' } });
    const e = page.fire('click', { target: fakeTarget({ closest: { 'a.jargon': link } }) });
    expect(seen).toEqual(['knock']);
    expect(e.wasPrevented()).toBe(true);
  });

  test('a tap elsewhere, or on a link without a rule, does nothing', () => {
    const page = fakePage([]);
    const seen: string[] = [];
    bindJargon(page.doc, (id) => {
      seen.push(id);
    });
    const plain = page.fire('click', { target: fakeTarget({ id: 'tabRulesBtn' }) });
    const bare = fakeEl('bare', { classes: ['jargon'] });
    const noRule = page.fire('click', { target: fakeTarget({ closest: { 'a.jargon': bare } }) });
    expect(seen).toEqual([]);
    expect(plain.wasPrevented()).toBe(false);
    expect(noRule.wasPrevented()).toBe(false);
  });
});

describe('revealRule', () => {
  test('scrolls the rule inside the named slot into view and flashes it until the timer fires', () => {
    const { page, knock, gin } = rulesPage();
    const t = timing();
    revealRule(page.doc, 'rulesList', 'knock', t);
    expect(knock.scrolledInto()).toBe(1);
    expect(knock.hasClass(RULE_FLASH_CLASS)).toBe(true);
    expect(gin.scrolledInto()).toBe(0);
    expect(t.pending()).toEqual([FLASH_MS]);
    t.fire();
    expect(knock.hasClass(RULE_FLASH_CLASS)).toBe(false);
  });

  test('a rule the slot lacks is a no-op (the other slot is not searched)', () => {
    const { page, knock } = rulesPage();
    const t = timing();
    revealRule(page.doc, 'rulesOverlayList', 'knock', t);
    revealRule(page.doc, 'rulesList', 'crawford', t);
    expect(knock.scrolledInto()).toBe(0);
    expect(t.pending()).toEqual([]);
  });

  test('the browser timing defers to a frame and a timeout', () => {
    // Node has no requestAnimationFrame, so the paint step is a no-op here (dom.ts `nextFrame`);
    // the timeout branch is checked by firing it.
    const { page, knock } = rulesPage();
    revealRule(page.doc, 'rulesList', 'knock');
    expect(knock.scrolledInto()).toBe(0);
    return new Promise<void>((resolve) => {
      browserTiming.after(() => {
        resolve();
      }, 0);
    });
  });
});
