// Card markup (docs/MIGRATION.md step 11): `cardHtml` and `backHtml` from the legacy multiplayer
// UI (legacy/gin-rummy/index.html, pinned in test/fixtures/legacy/gin-ui.cjs), character for
// character (test/parity/gin.ui.test.ts), plus the label and suit helpers the engine already
// exports. Strings only: the DOM write is render.ts's (step 12).
import { SUIT_SYMBOL, pretty, rankLabel } from '../engine/cards.ts';
import type { Card, Suit } from '../engine/types.ts';

/** The extra classes a card may carry on the table; each maps to a CSS rule of the same name. */
export type CardOptions = Readonly<{
  mini?: boolean;
  big?: boolean;
  selected?: boolean;
  dim?: boolean;
  fresh?: boolean;
  locked?: boolean;
  /** Classes of the port's own, appended after the legacy ones (`pinned`, `laid`, `dragging`: the table's melds). */
  extra?: string;
}>;

export const isRed = (suit: Suit): boolean => suit === 'H' || suit === 'D';

/** `card red|black [mini] [big] [selected] [dim] [fresh] [locked]`, in that order. */
export const cardClass = (card: Card, opts: CardOptions = {}): string =>
  [
    'card',
    isRed(card.s) ? 'red' : 'black',
    opts.mini === true ? 'mini' : '',
    opts.big === true ? 'big' : '',
    opts.selected === true ? 'selected' : '',
    opts.dim === true ? 'dim' : '',
    opts.fresh === true ? 'fresh' : '',
    opts.locked === true ? 'locked' : '',
    opts.extra ?? '',
  ]
    .filter((c) => c !== '')
    .join(' ');

/** A face-up card: rank top-left, suit, rank bottom-right; `data-card` carries its id. */
export const cardHtml = (card: Card, opts: CardOptions = {}): string =>
  `<div class="${cardClass(card, opts)}" data-card="${card.id}"><span class="rank">${rankLabel(card.r)}</span><span class="suit">${SUIT_SYMBOL[card.s]}</span><span class="rank br">${rankLabel(card.r)}</span></div>`;

/** A face-down card; `cls` is `tiny` (the opponent's strip), `big` (the stock) or nothing. */
export const backHtml = (cls = ''): string => `<div class="card back ${cls}"></div>`;

export { SUIT_SYMBOL, pretty, rankLabel };
