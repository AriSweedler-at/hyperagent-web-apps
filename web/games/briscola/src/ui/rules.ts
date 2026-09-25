// The rules list (docs/design/briscola-rules.md §2, in a player's words), the one source both slots
// render from (`#rulesList` on the home tab and `#rulesOverlayList` over the table, render.ts
// `renderRules`), so the two copies cannot drift. Each item carries an id: the anchor a glossary
// link lands on (docs/design/glossary-links.md; ui/glossary.ts names the words that mean each
// rule). Plain English (D23), with the Italian words the page keeps: briscola, the card names,
// mano. Six short items, one or two sentences each (the owner, 2026-09-25: "see if you can shorten
// the rules"); the ranks carry their points as a table (`.rank-table`, the theme's), which the
// glossary linker leaves alone. The list is one for every seat count: a rule that differs by seats
// says how. What is not here: the match (one game per sitting), the house rules (the engine keeps
// the flags at their defaults), the online how-to (the home screen says it).
import { rulesListHtml, type RuleItem } from '../../../../shared/ui/glossary.ts';
import { GLOSSARY } from './glossary.ts';

/** The two slots this list is rendered into, named once for every game beside the anchor. */
export { RULES_SLOT_IDS, type RulesSlot } from '../../../../shared/ui/glossary.ts';

/** The cards low to high with their points (the owner: "go low to high … Use a table to show how many points each one is"). */
export const RANK_POINTS: ReadonlyArray<readonly [card: string, points: number]> = [
  ['2, 4, 5, 6, 7', 0],
  ['fante', 2],
  ['cavallo', 3],
  ['re', 4],
  ['tre', 10],
  ['asso', 11],
];

/** The ranks rule's table: one row per card (or the pips together), its points beside it. */
export const rankTableHtml = (): string =>
  `<table class="rank-table"><thead><tr><th>Card</th><th>Points</th></tr></thead><tbody>${RANK_POINTS.map(
    ([card, points]) => `<tr><td>${card}</td><td>${String(points)}</td></tr>`,
  ).join('')}</tbody></table>`;

export const RULES_ITEMS: ReadonlyArray<RuleItem> = [
  {
    id: 'goal',
    heading: 'Goal',
    body: 'Take the tricks with points in them. When the cards run out each player adds up the points in the tricks they took: the highest total wins the game, a tie for the top is a draw, and 61 of the deck’s 120 points wins outright.',
  },
  {
    id: 'deal',
    heading: 'The deal',
    body: 'Three cards each from the 40-card Italian deck (with three players the 2 di coppe sits out: 39 cards, 13 tricks); the next card is turned up and slid under the stock, and its suit is the briscola for the game. The player after the dealer leads, and the deal passes to the next seat when you play again.',
  },
  {
    id: 'briscola',
    heading: 'Briscola',
    body: 'The trump suit: a briscola beats every card of the other suits, and between briscole the higher rank wins.',
  },
  {
    id: 'ranks',
    heading: 'Ranks',
    body: `Low to high: 2, 4, 5, 6, 7, fante, cavallo, re, tre, asso.${rankTableHtml()}`,
  },
  {
    id: 'trick',
    heading: 'A trick',
    body: 'In turn each player lays one card (a mano), any card: there is no need to follow suit or to trump. The highest briscola takes the trick, or the highest card of the suit led when none was played, and the winner leads the next trick after everyone draws.',
  },
  {
    id: 'draw',
    heading: 'The draw',
    body: 'After each trick everyone draws one card from the stock, the winner first, so every hand stays at three; the turned-up briscola is the last card drawn. Once the stock is out nobody draws: the last three tricks are played from the hand alone.',
  },
];

/** The items, one keyed `<li>` per rule with the jargon inside each body linked to the rule it names (render.ts writes them into both slots). */
export const rulesItemsHtml = (): string => rulesListHtml(RULES_ITEMS, GLOSSARY);

/** The heading over the in-game overlay's copy. */
export const RULES_TITLE = 'Briscola — Rules';
