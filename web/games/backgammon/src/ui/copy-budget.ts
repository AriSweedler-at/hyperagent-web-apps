// The copy's room (design §2.4 "The copy", the budget table): a one-line slot cuts what does not
// fit with an ellipsis, and the narrowest slot is the strip's status column sideways, what the
// names, the badge and the roll slot leave (the owner, 2026-09-28: "the text 'Last move: the turn
// ends when...' you have to make sure that text is not too long. You don't have enough space to
// display it. This is a game-level concern, and should also be unit tested so future copywriters
// cannot make this mistake"). Vitest has no layout, so a slot's room is a character budget: its
// width over the theme font's px per character, measured once on the served page (below) and
// pinned by e2e/backgammon-table-ux.spec.ts within 10%. copy-budget.test.ts enumerates every
// producer's inputs and checks each line against its slot; this table is the one place to edit
// when a slot's width changes (theme.css moves, the table follows, the test says which line no
// longer fits).

/**
 * Px per character of the theme's fonts, measured with canvas `measureText` on the served page
 * (Cardo loaded, root 16px; Chromium 153, 2026-09-28) over the real copy lines: the status line's
 * 0.95rem regular ran 5.7-7.1 px per character ("Dice used — End turn, or Undo" the widest at
 * 7.06; digits 7.8, a name's capitals more), so 7.1 is the ceiling a lowercase line reaches, not
 * the mean (6.5). The badge's bold 0.8rem ran 5.9-6.0 with its tabular figures.
 */
export const PX_PER_CHAR = { body: 7.1, badge: 6.0 } as const;

/** The badge at its widest, `Game 13 · 6–6 · to 7` (a match to 7 lasts thirteen games at most), in px with its 10px paddings. */
export const BADGE_MAX_WIDTH = Math.ceil('Game 13 · 6–6 · to 7'.length * PX_PER_CHAR.badge) + 20;

export type Slot = Readonly<{
  /** The element, as the page names it. */
  id: string;
  /** The slot's width at the narrowest viewport the design gives it, in px. */
  widthPx: number;
  pxPerChar: number;
  /** Where the width comes from: the viewport and the arithmetic, for the failure message. */
  where: string;
}>;

/**
 * The one-line slots (`white-space: nowrap; text-overflow: ellipsis`) and their narrowest widths.
 * The strip's status column sideways (theme.css, the rail block): the 780px floor less the two
 * 16px edges, the rail and its gap, the two 160px name columns, the 72px roll slot, the four 6px
 * gaps and the badge at its widest. The rows scheme (the SE's 667, a 640x360 Android) leaves it
 * 72-100px: there the design accepts the ellipsis, the strip's contract is the rail's. Portrait,
 * the status line is the 390px phone less #app's 24px and its own 12px of padding.
 */
export const SLOTS = {
  stripStatus: {
    id: '#statusLine',
    widthPx: 780 - 2 * 16 - (44 + 6) - 2 * 160 - 72 - 4 * 6 - BADGE_MAX_WIDTH,
    pxPerChar: PX_PER_CHAR.body,
    where: `sideways, the rail at its 780x304 floor with the badge at its widest (${String(BADGE_MAX_WIDTH)}px)`,
  },
  portraitStatus: {
    id: '#statusLine',
    widthPx: 390 - 24 - 12,
    pxPerChar: PX_PER_CHAR.body,
    where: 'the 390px phone upright',
  },
} as const satisfies Readonly<Record<string, Slot>>;
export type SlotName = keyof typeof SLOTS;

/** How many characters a slot holds at its narrowest. */
export const budget = (slot: Slot): number => Math.floor(slot.widthPx / slot.pxPerChar);

/** One line of copy as a producer made it, for the check and its message. */
export type CopyLine = Readonly<{
  text: string;
  /** The module and function that produced it. */
  producer: string;
  /** The input that produced it: the phase, the dice, the name, the action. */
  input: string;
}>;

/**
 * The failure message when a line overflows its slot: the slot, the text and its length, the
 * budget with its derivation, and what to do (shorten the line in its producer, or widen the
 * slot in theme.css and the table here).
 */
export const overBudgetMessage = (slot: Slot, line: CopyLine): string =>
  `${slot.id} copy "${line.text}" is ${String(line.text.length)} characters; the slot holds ${String(budget(slot))} at its narrowest (${slot.where}: ${String(slot.widthPx)}px at ${String(slot.pxPerChar)}px per character). Shorten it in ${line.producer} (${line.input}) or widen the slot in theme.css and the budget table (src/ui/copy-budget.ts).`;

/** The lines of `lines` that overflow `slot`, each with its message; empty when every line fits. */
export const overBudget = (
  slot: Slot,
  lines: ReadonlyArray<CopyLine>,
): ReadonlyArray<Readonly<{ line: CopyLine; message: string }>> =>
  lines
    .filter((line) => line.text.length > budget(slot))
    .map((line) => ({ line, message: overBudgetMessage(slot, line) }));
