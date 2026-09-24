// The words that mean each rule (docs/design/glossary-links.md §2), per ruleset: what the About
// panel and the rule bodies link through web/shared/ui/glossary.ts `linkJargon`. Whole words, any
// case; phrases beat the words inside them ("doubling cube" before "cube"). Words with a second,
// everyday sense stay out ("point" is also a score, "double" also "counts double", "pass" also
// "pass the phone"), so a link never lands a reader on the wrong rule.
import type { Glossary } from '../../../../shared/ui/glossary.ts';
import type { ShippedVariant } from '../engine/index.ts';

/** The rules both rulesets share, by the words the copy uses for them. */
const COMMON: Glossary = [
  { rule: 'direction', terms: ['home board'] },
  { rule: 'rolling', terms: ['doubles'] },
  { rule: 'blocks', terms: ['closed point', 'blot', 'blots', 'hit', 'the bar'] },
  {
    rule: 'bearing-off',
    terms: ['bear them off', 'bearing off', 'borne off', 'bears off', 'bear off'],
  },
  { rule: 'opening', terms: ['opening roll', 'opening'] },
  { rule: 'match', terms: ['match length'] },
  { rule: 'online', terms: ['online'] },
];

/**
 * Portes has no cube and no Crawford game: "doubling cube" points at its scoring rule, which says
 * so, and "Crawford rule" stays plain text; "Portes" itself lands on that scoring rule, the one
 * rule that names it. Under Western no rule says Portes, so the word stays plain there.
 */
const PORTES: Glossary = [
  ...COMMON,
  { rule: 'scoring', terms: ['doubling cube', 'gammon', 'gammons', 'diplo', 'portes', 'triple'] },
];

const WESTERN: Glossary = [
  ...COMMON,
  { rule: 'scoring', terms: ['gammon', 'gammons', 'diplo', 'triple'] },
  { rule: 'cube', terms: ['doubling cube', 'own the cube', 'doubling', 'cube'] },
  { rule: 'crawford', terms: ['crawford rule', 'crawford'] },
];

export const GLOSSARY: Readonly<Record<ShippedVariant, Glossary>> = {
  portes: PORTES,
  backgammon: WESTERN,
};
