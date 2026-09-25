// The card back (docs/design/gin-card-backs.md): one image scaled to whatever size a card is drawn
// at, so the stock, the opponent's strip and the piles show the same picture, and a preference
// among a few presets. Since docs/design/card-packs.md §2.2 the presets are the shared card packs
// that draw `french52` (web/shared/lib/cards/packs.ts): gin's four backs became back-only packs
// under gin's four names, so this module is a view over them and nothing else in gin learns the
// word "pack": `body[data-card-back]`, its four values, theme.css's selectors and every golden are
// what they were. At the src/ root, like sort.ts, because storage.ts (the `ginRummy_cardPack` key)
// and ui/ (the paint) share it and the lint zones let neither import the other.
import {
  badCardPackMsg,
  defaultPackFor,
  isCardPackFor,
  packsFor,
  type CardPackFor,
} from '../../../shared/lib/cards/packs.ts';

/** `default`: a navy lattice with a spade; `blue-stripe`: the diagonal stripes the page opened with; `yu-gi-oh`: the card back the owner supplied (assets/yu-gi-oh-back.jpg, drawn at three sizes by tools/card-backs.ts); `empty`: a plain navy back. */
export type CardBack = CardPackFor<'french52'>;
/** The shared packs that draw a French deck: the legacy literal `['default', 'blue-stripe', 'yu-gi-oh', 'empty']` in order (cardBack.test.ts pins it). */
export const CARD_BACKS: ReadonlyArray<CardBack> = packsFor('french52');
export const DEFAULT_CARD_BACK: CardBack = defaultPackFor('french52');
export const isCardBack = (value: string): value is CardBack => isCardPackFor('french52', value);
/** The line a bad value logs, under the page's key (storage.ts `STORAGE_KEYS.cardPack`): what was refused and what would have been accepted. */
export const badCardBackMsg = (value: string): string =>
  badCardPackMsg('ginRummy_cardPack', 'french52', value);
