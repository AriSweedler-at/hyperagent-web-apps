// The rules list (docs/MIGRATION.md step 11), once. The legacy page carries it twice, verbatim
// (`#rulesPanel` on the home tab and `#rulesOverlay` over the table: the named "duplicated rules
// markup" defect), so this is the deduplicated source; step 12 renders both places from it.
// test/parity/gin.ui.test.ts checks `RULES_LIST_HTML` against both legacy copies (pinned in
// test/fixtures/legacy/gin-ui.cjs) item for item, ignoring only the page's indentation.

/** The eleven `<li>` bodies, in the legacy order; each starts with its bold heading. */
export const RULES_ITEMS: ReadonlyArray<string> = [
  '<strong>Goal:</strong> Arrange your 10 cards into melds — sets (3–4 of a kind) or runs (3+ in a row, same suit; Ace is low only).',
  '<strong>Deadwood:</strong> Unmelded cards. Ace = 1, face cards = 10, others face value. The app arranges your melds for you and shows your deadwood live.',
  "<strong>Choosing melds:</strong> When a card could serve two melds (5♠5♥5♦ vs 4♠5♠6♠), tap the deadwood readout above your hand to pick which melds you declare. It won't change your score, but it changes what your opponent can lay off if you knock.",
  '<strong>First turn:</strong> The non-dealer may take the face-up card or pass; then the dealer may. If both pass, the non-dealer draws from the stock.',
  '<strong>Each turn:</strong> Draw one card (stock or discard pile), then discard one. You may not discard the card you just took from the discard pile.',
  '<strong>Knock:</strong> After drawing, pick a discard — if your remaining deadwood is 10 or less, the Knock button lights up.',
  "<strong>Gin:</strong> Knock with 0 deadwood: +25 bonus plus all of your opponent's deadwood. No lay-offs against gin.",
  "<strong>Lay off:</strong> Against a normal knock, the opponent's deadwood cards that fit your melds are laid off automatically.",
  "<strong>Undercut:</strong> If the opponent's deadwood is equal to or less than the knocker's, the opponent scores the difference + 25.",
  '<strong>Void hand:</strong> If only two cards remain in the stock and nobody has knocked, the hand is void and is redealt.',
  '<strong>Winning:</strong> Points accumulate each hand; the loser of a hand deals the next. First to the target score (default 100) wins.',
];

/** The list as the page has it, one line per tag, without the page's indentation. */
export const RULES_LIST_HTML: string = [
  '<ul class="rules-list">',
  ...RULES_ITEMS.map((item) => `<li>${item}</li>`),
  '</ul>',
].join('\n');

/** The heading over the in-game overlay's copy. */
export const RULES_TITLE = 'Gin Rummy — Quick Rules';
