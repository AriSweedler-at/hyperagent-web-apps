// The card back (docs/design/gin-card-backs.md): one image scaled to whatever size a card is drawn
// at, so the stock, the opponent's strip and the piles show the same picture, and a preference
// among a few presets. At the src/ root, like sort.ts, because storage.ts (the `ginRummy_cardBack`
// key) and ui/ (the paint) share it and the lint zones let neither import the other.
export const CARD_BACKS = ['default', 'blue-stripe', 'yu-gi-oh', 'empty'] as const;
/** `default`: a navy lattice with a spade; `blue-stripe`: the diagonal stripes the page opened with; `yu-gi-oh`: the card back the owner supplied (assets/yu-gi-oh-back.jpg, drawn at three sizes by tools/card-backs.ts); `empty`: a plain navy back. */
export type CardBack = (typeof CARD_BACKS)[number];
export const DEFAULT_CARD_BACK: CardBack = 'default';
export const isCardBack = (value: string): value is CardBack => CARD_BACKS.some((b) => b === value);
/** The line a bad value logs: what was refused and what would have been accepted. */
export const badCardBackMsg = (value: string): string =>
  `ginRummy_cardBack: "${value}" is not a card back; kept the current one. One of: ${CARD_BACKS.join(', ')}.`;
