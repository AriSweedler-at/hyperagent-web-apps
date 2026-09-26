// The words that mean each rule (docs/design/glossary-links.md §2): what the About panel and the
// rule bodies link through web/shared/ui/glossary.ts `linkJargon`. Whole words, any case; phrases
// beat the words inside them ("last three tricks" before "tricks"). The Italian words the page
// keeps (docs/design/briscola.md "Words") are here too: briscola, mano. Words with a second,
// everyday sense stay out ("game" is also the sitting's unit, "turn" also "turned up", "pass" also
// "pass the phone", "draw" also a tie), so a link never lands a reader on the wrong rule.
import type { Glossary } from '../../../../shared/ui/glossary.ts';

export const GLOSSARY: Glossary = [
  { rule: 'briscola', terms: ['briscola', 'briscole', 'trump', 'trumps'] },
  { rule: 'ranks', terms: ['asso', 'tre', 're', 'cavallo', 'fante'] },
  { rule: 'goal', terms: ['points'] },
  { rule: 'deal', terms: ['deal', 'deals', 'dealt', 'dealer', 'deck'] },
  { rule: 'trick', terms: ['trick', 'tricks', 'mano', 'leads', 'led'] },
  { rule: 'draw', terms: ['draws', 'stock', 'last three tricks'] },
];
