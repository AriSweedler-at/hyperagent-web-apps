// The words that mean each rule (docs/design/glossary-links.md §2): what the About panel and the
// rule bodies link through web/shared/ui/glossary.ts `linkJargon`. Whole words, any case; phrases
// beat the words inside them. Words the page uses in another sense stay out ("set" alone would
// catch "set the target"; "gin" is listed, so the About copy never spells the game's name).
import type { Glossary } from '../../../../shared/ui/glossary.ts';

export const GLOSSARY: Glossary = [
  { rule: 'deal', terms: ['non-dealer', 'dealer', 'deals', 'dealt', 'deal'] },
  { rule: 'draw', terms: ['discard pile', 'upcard', 'drawing', 'draws', 'draw', 'stock'] },
  { rule: 'melds', terms: ['melds', 'meld', 'sets', 'runs'] },
  { rule: 'deadwood', terms: ['deadwood'] },
  { rule: 'knock', terms: ['knocker', 'knocking', 'knocked', 'knocks', 'knock'] },
  { rule: 'gin', terms: ['goes gin', 'go gin', 'gin', 'bonus'] },
  { rule: 'layoff', terms: ['laid off', 'lays off', 'lay-offs', 'lay-off', 'lay off', 'layoff'] },
  { rule: 'undercut', terms: ['undercuts', 'undercut'] },
  { rule: 'void-hand', terms: ['void hand', 'redealt', 'void'] },
  { rule: 'match', terms: ['target score', 'target', 'match'] },
];
