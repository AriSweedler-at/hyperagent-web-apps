// The words that mean each rule (docs/design/glossary-links.md §2): what the About panel and the
// rule bodies link through web/shared/ui/glossary.ts `linkJargon`. Whole words, any case; phrases
// beat the words inside them ("last three tricks" before "tricks"). The Italian words the page
// keeps (docs/design/briscola.md "Words") are here too: briscola, carico, mano. Words with a
// second, everyday sense stay out ("game" is also the match's unit, "turn" also "turned up",
// "pass" also "pass the phone", "code" also the room's), so a link never lands a reader on the
// wrong rule.
import type { Glossary } from '../../../../shared/ui/glossary.ts';

export const GLOSSARY: Glossary = [
  { rule: 'briscola', terms: ['briscola', 'briscole', 'trump', 'trumps'] },
  { rule: 'ranks', terms: ['asso', 'tre', 're', 'cavallo', 'fante', 'figure', 'figures'] },
  { rule: 'goal', terms: ['carico', 'carichi', 'points'] },
  { rule: 'deal', terms: ['deal', 'deals', 'dealt', 'dealer', 'deck'] },
  { rule: 'trick', terms: ['trick', 'tricks', 'mano', 'leads', 'led'] },
  { rule: 'draw', terms: ['draws', 'draw', 'drawn', 'stock'] },
  { rule: 'last-tricks', terms: ['last three tricks', 'last tricks'] },
  { rule: 'scoring', terms: ['side', 'sides', 'partners', 'partner'] },
  { rule: 'match', terms: ['match', 'best of three', 'best of five'] },
  { rule: 'house-rules', terms: ['house rules', 'exchange', 'scoperta', 'partner peek'] },
  { rule: 'online', terms: ['online'] },
];
