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
// longer fits). The lines themselves are templates of literal text and capped blocks (ui/copy.ts):
// `templatesOverBudget` holds each template's worst case to its slot with no runtime input at all.
import { shape, worstCase, type Template } from './copy.ts';

/**
 * Px per character of the theme's fonts, measured with canvas `measureText` on the served page
 * (Cardo loaded, root 16px; Chromium 153, 2026-09-28) over the real copy lines: the status line's
 * 0.95rem regular ran 5.7-7.1 px per character ("Dice used — End turn, or Undo" the widest at
 * 7.06; digits 7.8, a name's capitals more), so 7.1 is the ceiling a lowercase line reaches, not
 * the mean (6.5). The badge's bold 0.8rem ran 5.9-6.0 with its tabular figures. A name's bold
 * 0.95rem (2026-09-30, the same page) ran 8.0-8.6 over 20-character names with a capital a word
 * ("Konstantinopoulos XX" 8.0, "Mohammed Abdullah Al" 8.6; a clipped "Konstanti…" 8.6, the
 * ellipsis wide), so 9.0 is the ceiling a name budget uses; a name of wide letters alone
 * ("Mohammed…" runs 11.4) can still meet the slot's own ellipsis.
 */
export const PX_PER_CHAR = { body: 7.1, badge: 6.0, name: 9.0 } as const;

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
 * The narrowest catalogued phone each way (tools/shell-emulate.ts `list`). Sideways the rail
 * scheme's floor is not the 780px viewport but the 12/13 mini: 812 wide with a 50px notch inset a
 * side, which theme.css's `--edge` takes for both gutters (the audit's second run, 2026-09-30: the
 * status line lost 7px there with the table's 16px edges). Upright the 375px classes (the X, the
 * mini, the SE) with #app's 12px gutters.
 */
export const MINI_SIDEWAYS = { width: 812, edge: 50 } as const;
export const PHONE_UPRIGHT = { width: 375, gutter: 12 } as const;
/**
 * The strip's boxes sideways (theme.css, the landscape block): the rail and its gap, `--name-w`,
 * `--slot-w`, `--gap`, the 10px seat disc, the 9px connection dot (online only) and the pips at
 * `min-width: 3ch` (23.4px at 0.95rem Cardo).
 */
export const STRIP = {
  rail: 44 + 6,
  nameW: 142,
  slotW: 72,
  gap: 6,
  seatDot: 10,
  connDot: 9,
  pips: 24,
} as const;
/**
 * The upright rows (theme.css, the upright grid block): the 44px icon buttons (the menu and
 * handoff buttons 6px apart, the sound button), the grid's 8px gaps, the strips' 12px seat disc,
 * 8px gaps and 24px pips; the controls row's 10px gaps, Undo (62px) and the roll slot's 120px.
 */
export const UPRIGHT = {
  iconBtn: 44,
  tightGap: 6,
  gap: 8,
  seatDot: 12,
  stripGap: 8,
  connDot: 9,
  pips: 24,
  controlsGap: 10,
  undo: 62,
  slotW: 120,
  statusPad: 6,
} as const;

/** The strip's width sideways on the mini: the viewport less the two edges and the rail. */
const stripWidth = MINI_SIDEWAYS.width - 2 * MINI_SIDEWAYS.edge - STRIP.rail;
/** The row's width upright at 375: the viewport less #app's gutters. */
const rowWidth = PHONE_UPRIGHT.width - 2 * PHONE_UPRIGHT.gutter;

/**
 * The one-line slots (`white-space: nowrap; text-overflow: ellipsis`) and their narrowest widths,
 * each derived from the theme's boxes above. The status line sideways is what the two name
 * columns, the roll slot, the four gaps and the badge at its widest leave the strip on the mini;
 * upright, what the badge beside it on its row and the 8px gap leave, less its 12px of padding.
 * The name slots: sideways a name column less the disc, the connection dot (the opponent's,
 * online), the pips and the gaps between them; upright the opponent's strip is the topbar row less
 * the badge's column (the badge at its widest stands under the menu row) and the sound button's,
 * my strip the controls row less Undo, the roll slot and the gaps. The
 * rows scheme (the SE's 667, a 640x360 Android) keeps its 132px columns and 109px of status: the
 * design's documented limit (§2.4), where a line or an online opponent's name past it ellipsizes.
 */
export const SLOTS = {
  stripStatus: {
    id: '#statusLine',
    widthPx: stripWidth - 2 * STRIP.nameW - STRIP.slotW - 4 * STRIP.gap - BADGE_MAX_WIDTH,
    pxPerChar: PX_PER_CHAR.body,
    where: `sideways, the rail on the mini (812x375, 50px insets) with the badge at its widest (${String(BADGE_MAX_WIDTH)}px)`,
  },
  portraitStatus: {
    id: '#statusLine',
    widthPx: rowWidth - BADGE_MAX_WIDTH - UPRIGHT.gap - 2 * UPRIGHT.statusPad,
    pxPerChar: PX_PER_CHAR.body,
    where: 'the 375px phone upright, the badge at its widest beside it',
  },
  stripOppName: {
    id: '#oppName',
    widthPx: STRIP.nameW - STRIP.seatDot - STRIP.connDot - STRIP.pips - 3 * STRIP.gap,
    pxPerChar: PX_PER_CHAR.name,
    where: "sideways, the rail's 142px name column with the connection dot",
  },
  stripMyName: {
    id: '#myName',
    widthPx: STRIP.nameW - STRIP.seatDot - STRIP.pips - 2 * STRIP.gap,
    pxPerChar: PX_PER_CHAR.name,
    where: "sideways, the rail's 142px name column",
  },
  uprightOppName: {
    id: '#oppName',
    // The first column is the badge's (140px at its widest; the menu and handoff buttons under it
    // are 94), the third the sound button's.
    widthPx:
      rowWidth -
      BADGE_MAX_WIDTH -
      UPRIGHT.iconBtn -
      2 * UPRIGHT.gap -
      (UPRIGHT.seatDot + UPRIGHT.connDot + UPRIGHT.pips + 3 * UPRIGHT.stripGap),
    pxPerChar: PX_PER_CHAR.name,
    where:
      "the 375px phone upright, the topbar row beside the badge's column and the sound button, with the connection dot",
  },
  uprightMyName: {
    id: '#myName',
    widthPx:
      rowWidth -
      UPRIGHT.undo -
      UPRIGHT.slotW -
      2 * UPRIGHT.controlsGap -
      (UPRIGHT.seatDot + UPRIGHT.pips + 2 * UPRIGHT.stripGap),
    pxPerChar: PX_PER_CHAR.name,
    where: 'the 375px phone upright, the controls row with Undo and the roll slot',
  },
} as const satisfies Readonly<Record<string, Slot>>;
export type SlotName = keyof typeof SLOTS;

/** How many characters a slot holds at its narrowest. */
export const budget = (slot: Slot): number => Math.floor(slot.widthPx / slot.pxPerChar);

/** The name slots: `#oppName` and `#myName`, sideways and upright. */
export const NAME_SLOTS: ReadonlyArray<Slot> = [
  SLOTS.stripOppName,
  SLOTS.stripMyName,
  SLOTS.uprightOppName,
  SLOTS.uprightMyName,
];
/**
 * The characters a name slot shows (render.ts `paintName` passes it to copy.ts `name`): the
 * narrowest name slot's budget, so a name at the shell's NAME_MAX never overflows any of them;
 * the whole name stays in the element's `title`.
 */
export const NAME_CAP = Math.min(...NAME_SLOTS.map(budget));

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

/**
 * The failure message when a template can overflow its slot: the template's name and shape (its
 * literals, `{kind:cap}` for each block), its worst case, the budget with its derivation, and
 * what to do (fewer words or a smaller cap in the template, or widen the slot).
 */
export const templateOverBudgetMessage = (slot: Slot, templateName: string, t: Template): string =>
  `${slot.id} template "${templateName}" (${shape(t)}) can reach ${String(worstCase(t))} characters; the slot holds ${String(budget(slot))} at its narrowest (${slot.where}: ${String(slot.widthPx)}px at ${String(slot.pxPerChar)}px per character). Shorten its words or a block's cap in src/ui/board.ts (STATUS_TEMPLATES), or widen the slot in theme.css and the budget table (src/ui/copy-budget.ts).`;

/** The templates whose worst case overflows `slot`, each with its message; empty when every one fits. */
export const templatesOverBudget = (
  slot: Slot,
  templates: Readonly<Record<string, Template>>,
): ReadonlyArray<Readonly<{ name: string; message: string }>> =>
  Object.entries(templates)
    .filter((entry: readonly [string, Template]) => worstCase(entry[1]) > budget(slot))
    .map((entry: readonly [string, Template]) => ({
      name: entry[0],
      message: templateOverBudgetMessage(slot, entry[0], entry[1]),
    }));
