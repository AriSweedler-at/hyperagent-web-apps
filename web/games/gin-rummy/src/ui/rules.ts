// The rules list (docs/MIGRATION.md step 11), once. The legacy page carries it twice, verbatim
// (`#rulesPanel` on the home tab and `#rulesOverlay` over the table: the named "duplicated rules
// markup" defect), so this is the deduplicated source; step 12 renders both places from it.
// test/parity/gin.ui.test.ts checks `RULES_LIST_HTML` against both legacy copies (pinned in
// test/fixtures/legacy/gin-ui.cjs) item for item, ignoring only the page's indentation and what
// the glossary added (docs/design/glossary-links.md): each item carries an id, the anchor a jargon
// link lands on, and the jargon inside a body is linked to the rule it names (ui/glossary.ts).
import { rulesListHtml, type RuleItem } from '../../../../shared/ui/glossary.ts';
import { GLOSSARY } from './glossary.ts';

/** The ids of the two `<ul class="rules-list">` slots: the home tab's and the in-game overlay's. */
export const RULES_SLOT_IDS = ['rulesList', 'rulesOverlayList'] as const;
export type RulesSlot = (typeof RULES_SLOT_IDS)[number];

/** The eleven items, in the legacy order; heading and body as the legacy `<li>` had them. */
export const RULES_ITEMS: ReadonlyArray<RuleItem> = [
  {
    id: 'melds',
    heading: 'Goal',
    body: 'Arrange your 10 cards into melds — sets (3–4 of a kind) or runs (3+ in a row, same suit; Ace is low only).',
  },
  {
    id: 'deadwood',
    heading: 'Deadwood',
    body: 'Unmelded cards. Ace = 1, face cards = 10, others face value. The app arranges your melds for you and shows your deadwood live.',
  },
  {
    id: 'choosing-melds',
    heading: 'Choosing melds',
    body: "When a card could serve two melds (5♠5♥5♦ vs 4♠5♠6♠), tap the deadwood readout above your hand to pick which melds you declare. It won't change your score, but it changes what your opponent can lay off if you knock.",
  },
  {
    id: 'deal',
    heading: 'First turn',
    body: 'The non-dealer may take the face-up card or pass; then the dealer may. If both pass, the non-dealer draws from the stock.',
  },
  {
    id: 'draw',
    heading: 'Each turn',
    body: 'Draw one card (stock or discard pile), then discard one. You may not discard the card you just took from the discard pile.',
  },
  {
    id: 'knock',
    heading: 'Knock',
    body: 'After drawing, pick a discard — if your remaining deadwood is 10 or less, the Knock button lights up.',
  },
  {
    id: 'gin',
    heading: 'Gin',
    body: "Knock with 0 deadwood: +25 bonus plus all of your opponent's deadwood. No lay-offs against gin.",
  },
  {
    id: 'layoff',
    heading: 'Lay off',
    body: "Against a normal knock, the opponent's deadwood cards that fit your melds are laid off automatically.",
  },
  {
    id: 'undercut',
    heading: 'Undercut',
    body: "If the opponent's deadwood is equal to or less than the knocker's, the opponent scores the difference + 25.",
  },
  {
    id: 'void-hand',
    heading: 'Void hand',
    body: 'If only two cards remain in the stock and nobody has knocked, the hand is void and is redealt.',
  },
  {
    id: 'match',
    heading: 'Winning',
    body: 'Points accumulate each hand; the loser of a hand deals the next. First to the target score (default 100) wins.',
  },
];

/** The eleven `<li>`s, one per line as the legacy page had them between its tags, keyed and linked. */
export const rulesItemsHtml = (): string => rulesListHtml(RULES_ITEMS, GLOSSARY);

/** The list as the page has it, one line per tag, without the page's indentation. */
export const RULES_LIST_HTML: string = ['<ul class="rules-list">', rulesItemsHtml(), '</ul>'].join(
  '\n',
);

/** The heading over the in-game overlay's copy. */
export const RULES_TITLE = 'Gin Rummy — Quick Rules';
