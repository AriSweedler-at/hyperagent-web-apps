// The rules list (docs/design/briscola-rules.md §2, in a player's words), the one source both slots
// render from (`#rulesList` on the home tab and `#rulesOverlayList` over the table, render.ts
// `renderRules`), so the two copies cannot drift. Each item carries an id: the anchor a glossary
// link lands on (docs/design/glossary-links.md; ui/glossary.ts names the words that mean each
// rule). Plain English (D23), with the Italian words the page keeps: briscola, the card names,
// carico, mano. The list is one for every seat count: a rule that differs by seats says how.
import { rulesListHtml, type RuleItem } from '../../../../shared/ui/glossary.ts';
import { GLOSSARY } from './glossary.ts';

/** The two slots this list is rendered into, named once for every game beside the anchor. */
export { RULES_SLOT_IDS, type RulesSlot } from '../../../../shared/ui/glossary.ts';

export const RULES_ITEMS: ReadonlyArray<RuleItem> = [
  {
    id: 'goal',
    heading: 'Goal',
    body: 'Take the tricks with points in them. The asso counts 11 and the tre 10 (the two carichi, the cards worth fighting for), the re 4, the cavallo 3, the fante 2; the 7, 6, 5, 4 and 2 count nothing. The deck holds 120 points: the side with the most at the end wins the game, and 60 against 60 is a draw.',
  },
  {
    id: 'deal',
    heading: 'The deal',
    body: 'Everyone gets three cards from the 40-card Italian deck (with three players one 2 sits out, so 39 cards and 13 tricks). The next card is turned up and slid under the stock: its suit is the briscola for the whole game. The player after the dealer leads.',
  },
  {
    id: 'briscola',
    heading: 'Briscola',
    body: 'The trump suit. A briscola beats every card of the other suits; between briscole the higher rank wins. Taking an opponent’s asso or tre with a small briscola is the steal the table remembers in its history.',
  },
  {
    id: 'ranks',
    heading: 'Ranks',
    body: 'High to low: asso, tre, re, cavallo, fante, 7, 6, 5, 4, 2. The tre outranks the re; the three figures sit between the carichi and the pips.',
  },
  {
    id: 'trick',
    heading: 'A trick',
    body: 'In turn each player lays one card (a mano). You may play anything: no need to follow suit, to trump or to win. The highest briscola takes the trick; when none was played, the highest card of the suit led does, and off-suit cards never win. The winner leads the next trick, after the draw.',
  },
  {
    id: 'draw',
    heading: 'The draw',
    body: 'After each trick everyone draws one card from the stock, the winner first, so every hand stays at three. The last card drawn is the turned-up briscola itself, so the last player to draw knows what they are getting.',
  },
  {
    id: 'last-tricks',
    heading: 'The last tricks',
    body: 'Once the stock is out nobody draws: the last three tricks are played from the hand alone, and every card left is known to be somewhere. The trick just taken can be looked at again from the table.',
  },
  {
    id: 'scoring',
    heading: 'Scoring',
    body: 'Each side adds up the points in the tricks it took. With two or three players every seat is its own side; with four the players sitting opposite are partners and their tricks make one total. The highest total wins the game; a tie for the top is a draw. The running score is on the table for everyone.',
  },
  {
    id: 'match',
    heading: 'The match',
    body: 'Games are played until a side has won the number chosen on the home screen: one game, the best of three or the best of five. A drawn game counts for nobody. The deal passes to the next seat.',
  },
  {
    id: 'house-rules',
    heading: 'House rules',
    body: 'Optional, chosen before the deal. The exchange lets the player on turn swap the 7 of briscola for a turned-up asso, tre or figure (or the 2 for a turned-up 7, 6, 5 or 4) once their side has taken a trick. Scoperta, for two players, plays every hand face up. The partner peek, for four, shows you your partner’s hand once the stock is out.',
  },
  {
    id: 'online',
    heading: 'Online',
    body: 'One player opens a table and shares its code; the other sits down at it, and the one who opened it deals for both. Two seats play online for now; three and four share one phone, passed around the table.',
  },
];

/** The items, one keyed `<li>` per rule with the jargon inside each body linked to the rule it names (render.ts writes them into both slots). */
export const rulesItemsHtml = (): string => rulesListHtml(RULES_ITEMS, GLOSSARY);

/** The heading over the in-game overlay's copy. */
export const RULES_TITLE = 'Briscola — Rules';
