import { describe, expect, test } from 'vitest';

import {
  JARGON_CLASS,
  linkJargon,
  ruleAnchor,
  ruleFromHash,
  rulesListHtml,
  type Glossary,
  type RuleItem,
} from './glossary.ts';

const GLOSSARY: Glossary = [
  { rule: 'knock', terms: ['knock', 'knocks'] },
  { rule: 'cube', terms: ['cube', 'doubling cube'] },
  { rule: 'bearing-off', terms: ['bear off', 'bear them off'] },
  { rule: 'melds', terms: ['meld', 'set', 'run'] },
];

const link = (rule: string, word: string): string =>
  `<a class="jargon" href="#rule-${rule}" data-rule="${rule}">${word}</a>`;

describe('ruleAnchor', () => {
  test('is rule-<id>, the anchor the list, the links and the hash share', () => {
    expect(ruleAnchor('knock')).toBe('rule-knock');
    expect(JARGON_CLASS).toBe('jargon');
  });
});

describe('linkJargon', () => {
  test('wraps the first whole-word occurrence, any case, and leaves the rest of the text alone', () => {
    expect(linkJargon('You may Knock, then knock again.', GLOSSARY)).toBe(
      `You may ${link('knock', 'Knock')}, then knock again.`,
    );
  });

  test('a term inside a longer word is not a match', () => {
    expect(linkJargon('the knocker sets up a runway', GLOSSARY)).toBe(
      'the knocker sets up a runway',
    );
    expect(linkJargon('a set.', GLOSSARY)).toBe(`a ${link('melds', 'set')}.`);
  });

  test('longest terms first: the phrase wins over the word inside it, which then stays plain', () => {
    expect(linkJargon('the doubling cube, then the cube', GLOSSARY)).toBe(
      `the ${link('cube', 'doubling cube')}, then the cube`,
    );
    // "bear off" is not a word inside "bear them off": both phrases link.
    expect(linkJargon('bear them off, then bear off', GLOSSARY)).toBe(
      `${link('bearing-off', 'bear them off')}, then ${link('bearing-off', 'bear off')}`,
    );
  });

  test('every term links once: three words for one rule are three links', () => {
    expect(linkJargon('a meld is a set or a run', GLOSSARY)).toBe(
      `a ${link('melds', 'meld')} is a ${link('melds', 'set')} or a ${link('melds', 'run')}`,
    );
  });

  test('tags are untouched and text inside an existing link is never re-wrapped', () => {
    const html = '<strong class="knock">Rules:</strong> <a href="#x">knock</a> then knock';
    expect(linkJargon(html, GLOSSARY)).toBe(
      `<strong class="knock">Rules:</strong> <a href="#x">knock</a> then ${link('knock', 'knock')}`,
    );
    expect(linkJargon('<a href="#x"><em>knock</em></a>', GLOSSARY)).toBe(
      '<a href="#x"><em>knock</em></a>',
    );
  });

  test('linking twice adds nothing: the links already there are skipped', () => {
    const once = linkJargon('knock and cube', GLOSSARY);
    expect(linkJargon(once, GLOSSARY)).toBe(once);
  });

  test('except suppresses the rule the text sits in, other rules still link', () => {
    expect(linkJargon('Knock with the cube', GLOSSARY, { except: 'knock' })).toBe(
      `Knock with the ${link('cube', 'cube')}`,
    );
  });

  test('a term with regexp characters is matched literally', () => {
    const glossary: Glossary = [{ rule: 'q', terms: ['a+b', '6.5'] }];
    expect(linkJargon('so a+b works', glossary)).toBe(`so ${link('q', 'a+b')} works`);
    expect(linkJargon('aab and 645', glossary)).toBe('aab and 645');
  });

  test('an empty glossary or a text without jargon comes back unchanged', () => {
    expect(linkJargon('plain text', [])).toBe('plain text');
    expect(linkJargon('', GLOSSARY)).toBe('');
  });
});

describe('rulesListHtml', () => {
  const ITEMS: ReadonlyArray<RuleItem> = [
    { id: 'knock', heading: 'Knock', body: 'Knock when your melds are ready.' },
    { id: 'melds', heading: 'Melds', body: 'A set or a run; a knock ends the hand.' },
  ];

  test('one keyed <li> per item, the heading bold, the body linked except to itself', () => {
    // "Knock" sits in its own rule (not linked); "melds" is not a term (only "meld" is).
    expect(rulesListHtml(ITEMS, GLOSSARY).split('\n')).toEqual([
      '<li id="rule-knock"><strong>Knock:</strong> Knock when your melds are ready.</li>',
      `<li id="rule-melds"><strong>Melds:</strong> A set or a run; a ${link('knock', 'knock')} ends the hand.</li>`,
    ]);
  });

  test('a body naming another rule links it (melds -> set)', () => {
    const items: ReadonlyArray<RuleItem> = [{ id: 'goal', heading: 'Goal', body: 'Build a set.' }];
    expect(rulesListHtml(items, GLOSSARY)).toBe(
      `<li id="rule-goal"><strong>Goal:</strong> Build a ${link('melds', 'set')}.</li>`,
    );
  });
});

describe('ruleFromHash', () => {
  test('reads #rule-<id> with or without the hash sign', () => {
    expect(ruleFromHash('#rule-knock')).toBe('knock');
    expect(ruleFromHash('rule-bearing-off')).toBe('bearing-off');
    expect(ruleFromHash('#rule-cube2')).toBe('cube2');
  });

  test('anything else is null', () => {
    [
      '',
      '#',
      '#rule-',
      '#rule-Knock',
      '#rules-knock',
      '#rule-knock extra',
      '#rule--x',
      '#join=AB',
    ].forEach((hash) => {
      expect(ruleFromHash(hash)).toBeNull();
    });
  });
});
