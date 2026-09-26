// The rules list on the shell path (docs/design/fidice-shell-adoption.md §7 D12): the one source
// both slots render from (`#rulesList` on the Rules tab and `#rulesOverlayList` over the table,
// render.ts `renderRules`), so the two copies cannot drift. The prose is the legacy rules tab's
// (src/view/screens/rules.ts, the bundle's words), cut into six items with the panel headings as
// their headings; the strategy list still reads the shipped computers' names and blurbs off the
// registry. Each item carries an id: the anchor a glossary link lands on
// (docs/design/glossary-links.md; `GLOSSARY` names the words that mean each rule). The old file is
// imported by nothing here and edited by nobody: M6 retires it with the vdom rules tab.
import { rulesListHtml, type Glossary, type RuleItem } from '../../../../shared/ui/glossary.ts';
import { SHIPPED } from '../bots/registry.ts';

/** The two slots this list is rendered into, named once for every game beside the anchor. */
export { RULES_SLOT_IDS, type RulesSlot } from '../../../../shared/ui/glossary.ts';

/** The words that mean a rule, linked to it wherever another rule or the About copy says them. */
export const GLOSSARY: Glossary = [
  { rule: 'ladder', terms: ['the ladder', 'ladder'] },
  { rule: 'calling', terms: ['calls liar', 'call liar', 'calling liar'] },
  { rule: 'setup', terms: ['lives', 'kayaks'] },
];

/** The shipped computers and what each does, one clause each (the registry's names and blurbs). */
export const strategiesHtml = (): string =>
  SHIPPED.map((s) => `<b>${s.name}</b>: ${s.blurb.replace(/\.$/, '')}`).join('; ');

export const RULES_ITEMS: ReadonlyArray<RuleItem> = [
  {
    id: 'goal',
    heading: 'How to play Fidice',
    body: `Fidice is <b>one-cup liar's dice</b>. Five dice live under a single cup that travels around the table. Whoever holds the cup declares a hand from <b>the ladder</b> — truthfully or not — and passes it on. The next player either <b>raises</b> the claim or <b>calls liar</b>. Lose a call, lose a life. Last one standing wins. Crowe house rules, from Kezar Lake, Maine.`,
  },
  {
    id: 'setup',
    heading: 'Setup',
    body: `<ul><li>2 to 6 players. Each starts with the same number of <b>lives</b> (default 3).</li><li>All five dice start under the cup. The app rolls them for whoever begins the round.</li><li>Only the current cup holder can see what's under the cup. Dice that have been pulled <b>out</b> from under the cup sit on the table where everyone can see them.</li></ul>`,
  },
  {
    id: 'turn',
    heading: 'Your turn',
    body: `<ol><li><b>Decide blind: call or accept.</b> If there's a bid on the table you may <b>call liar</b> right away — without looking. Or <b>accept the cup</b>, which commits you to raising the bid.</li><li><b>Peek.</b> Once you've accepted, you alone see the dice under the cup.</li><li><b>Pull dice out.</b> Slide any dice from under the cup onto the table. Once out, a die is public and stays out for the rest of the round.</li><li><b>Roll (once).</b> You may roll <b>all</b> the dice still under the cup, and/or any set of the dice on the table — none, some, or all. Rolls on the table are public; the cup roll is your secret. You may also put table dice <b>back under the cup</b> — the whole cup is then shaken, tucked dice and all, so nobody learns what came up.</li><li><b>Bid.</b> Pick any hand from the ladder that is <b>higher</b> than the current bid. Your bid does not have to be true! Then the cup passes left.</li></ol>`,
  },
  {
    id: 'calling',
    heading: 'Calling liar',
    body: `When you call, the cup is lifted and all five dice (under the cup plus the ones on the table) are read as one poker hand.<ul><li>If the real hand is <b>equal to or better than</b> the bid, the bid was honest — the <b>caller</b> loses a life.</li><li>If the real hand is <b>worse</b> than the bid, the <b>bidder</b> loses a life.</li><li>By default the table <b>keeps score</b>: nobody is ever out, the loser of a round simply gets a mark, and the host ends the game whenever the evening does — fewest rounds lost wins. Prefer stakes? Set kayaks when you create the table: lose a call, lose a kayak; at zero you're out and the last one standing wins.</li><li>Whoever lost the round starts the next one with a fresh roll under the cup.</li></ul><b>Example.</b> Andy opens with <i>Three 4s with 6, 1</i> and passes the cup. Tyler accepts, pulls a 6 out onto the table, shakes the cup, and raises to <i>Three 5s with 6, 2</i>. Stephen calls liar. The cup is lifted: 5-5-5-6-1 — the real hand is <i>Three 5s with 6, 1</i>, one rung <b>below</b> Tyler's bid, so Tyler was bluffing and Tyler loses a life. Had Stephen simply raised instead, the bluff would have travelled on to Andy.`,
  },
  {
    id: 'ladder',
    heading: 'The ladder (hand rankings)',
    body: `Five of a kind → Four of a kind → Full house → Straight → Three of a kind → Two pair → One pair → High die. Within a category, higher numbers win first, then kickers (the leftover dice) compared highest-first. There are exactly 252 distinct hands. If someone bids the very top (<i>Five 6s</i>), the next player can only call. The Ladder tab is nested: fully collapsed it's just the eight poker hands. Open a category to see each hand (<i>Four 6s</i>, <i>6s full</i>, <i>Pair of 3s</i>…), and open a hand to see its exact variants — the kickers, or for a full house the pair. The bid box is a fuzzy search: type <i>3s full</i>, <i>4s and 1s</i> or <i>four 6s</i> and pick the group to bid its top variant, or be exact with <i>3s over 2</i>, <i>three 4s with 6, 1</i>, or a rung number.`,
  },
  {
    id: 'know',
    heading: 'Good to know',
    body: `<ul><li>Pulling a die out is a promise you can't take back — and it tells the table something. Rolling it afterwards tells them something else.</li><li>Rolling the cup dice throws away the hand you know for one you don't. Sometimes that's exactly the point.</li><li><b>Computer players</b> can fill any seat: add them on the host card or in the waiting room, or pick <i>Solo</i> / <i>Watch</i> on the home screen. Each plays one of three strategies (pick one, or let it draw at random) — ${strategiesHtml()}. They see exactly what a person in their chair would see, and they read the table the way a person does: how far each raise leapt, whether the cup has been shaken since the bidder looked, who has been caught before.</li><li>The game runs in the host's browser. If the host closes their tab, the table closes with it.</li></ul>`,
  },
];

/** The items, one keyed `<li>` per rule with the jargon inside each body linked to the rule it names (render.ts writes them into both slots). */
export const rulesItemsHtml = (): string => rulesListHtml(RULES_ITEMS, GLOSSARY);
