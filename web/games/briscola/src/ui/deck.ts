// The deck sheet's pure half (the owner, 2026-09-25: "similar to the gin rummy deck viewer, add a
// view deck button with the 'include hand' toggle that lets you see what's left in the deck.
// Arrange it the same way"; gin's sheet is docs/design/gin-arrangement-and-discards.md §8). What my
// seat can tell of the forty from its view alone, laid out as gin lays the fifty-two: one row per
// suit in SUITS order, the ten ranks in RANKS order, a chip per card, the chip a face of the current
// pack. A card is `gone` once I have seen it this game: the tricks taken (the `trick` events since
// this game's deal, since the view carries no piles), the cards on the table now, the briscola
// (lying under the stock, or drawn into a hand I can name), the card an exchange took into a hand
// and a hand shown to me (scoperta, the partner peek). A card of mine is `mine`, never gone, and
// the toggle says whether the sheet greys it too (`held`, gin's gold-ringed chip); off, my cards
// read as gin's do, plain among the unseen. What is neither seen nor mine is in the stock or in a
// hand I cannot see, and the count line says how many, with the stock's size beside it, so
// "36 unseen · 34 in the stock" tells that two are in the other hand. No DOM: the painter
// (ui/render.ts `paintDeck`) keys `#deckList` on `deckKey` and writes `deckHtml`.
import type { CardPack } from '../../../../shared/lib/cards/packs.ts';
import { suitSymbolId } from '../../../../shared/lib/cards/suits.ts';
import {
  RANKS,
  SUITS,
  SUIT_NAME,
  deckFor,
  idsOf,
  makeCard,
  type Suit,
  type View,
} from '../engine/index.ts';
import { cardHtml } from './table.ts';

/** One card of the deck as the sheet shows it: seen this game, or mine (never both). */
export type Chip = Readonly<{ id: string; gone: boolean; mine: boolean }>;

/** One suit's row: a chip per rank in RANKS order, null where this table's deck has no such card (the removed two at three players). */
export type DeckRow = Readonly<{ suit: Suit; chips: ReadonlyArray<Chip | null> }>;

export type Deck = Readonly<{
  rows: ReadonlyArray<DeckRow>;
  /** Cards neither seen nor mine: in the stock or in a hand I cannot see. */
  unseen: number;
  /** `view.stockCount`, the briscola included while it lies on the table. */
  stock: number;
  inHand: number;
  /** `#deckIncludeHand`: my cards greyed (`held`) as well. */
  withHand: boolean;
}>;

/**
 * The ids my seat has seen this game: the cards of every trick taken since this game's `deal`
 * event (a later game of the match opens with its own deal, so the earlier games' tricks fall
 * before it), the trick on the table, the briscola (public on the table, and once drawn it is in
 * the last drawer's hand), what an exchange took off the table into a hand, and every hand the
 * rules show me. Not filtered by my hand: `deckOf` gives a card of mine precedence.
 */
export const seenIds = (v: View): ReadonlySet<string> => {
  const dealAt = v.events.reduce<number>((at, e, i) => (e.kind === 'deal' ? i : at), -1);
  const taken = v.events
    .slice(dealAt + 1)
    .flatMap((e) => (e.kind === 'trick' ? e.data.cards.map((p) => p.card.id) : []));
  const table = v.trick.map((p) => p.card.id);
  const shown = v.others.flatMap((o) => idsOf(o.hand ?? []));
  const exchanged = v.exchanges.map((x) => x.took.id);
  return new Set([...taken, ...table, ...shown, ...exchanged, v.trumpCard.id]);
};

/** The sheet's model from my view: the rows, the count of the unseen, the stock, my hand and the toggle. */
export const deckOf = (v: View, withHand: boolean): Deck => {
  const seen = seenIds(v);
  const mine = new Set(idsOf(v.me.hand));
  const inDeck = new Set(idsOf(deckFor(v.options)));
  const chipOf = (id: string): Chip | null =>
    inDeck.has(id) ? { id, mine: mine.has(id), gone: !mine.has(id) && seen.has(id) } : null;
  const rows: ReadonlyArray<DeckRow> = SUITS.map((suit) => ({
    suit,
    chips: RANKS.map((r) => chipOf(makeCard(r, suit).id)),
  }));
  const chips = rows.flatMap((row) => row.chips.filter((c) => c !== null));
  return {
    rows,
    unseen: chips.filter((c) => !c.gone && !c.mine).length,
    stock: v.stockCount,
    inHand: v.me.hand.length,
    withHand,
  };
};

/** `#deckList`'s key: the toggle and one mark per card in row order (`x` gone, `m` mine, `.` unseen, `-` not in this deck). */
export const deckKey = (deck: Deck): string =>
  `${deck.withHand ? 'hand' : 'deck'}|${deck.rows
    .map((row) =>
      row.chips.map((c) => (c === null ? '-' : c.gone ? 'x' : c.mine ? 'm' : '.')).join(''),
    )
    .join(',')}`;

/** `#deckSub`: "36 unseen · 34 in the stock", and "· 3 in your hand" when the toggle greys them. */
export const deckSubText = (deck: Deck): string =>
  `${String(deck.unseen)} unseen · ${String(deck.stock)} in the stock` +
  (deck.withHand ? ` · ${String(deck.inHand)} in your hand` : '');

const chipClasses = (chip: Chip, withHand: boolean): string =>
  ['chip', chip.gone ? 'gone' : '', chip.mine && withHand ? 'held' : '']
    .filter((c) => c !== '')
    .join(' ');

const chipHtml = (pack: CardPack, chip: Chip | null, withHand: boolean): string =>
  chip === null
    ? '<span class="dk-out"></span>'
    : cardHtml(pack, chip.id, chipClasses(chip, withHand));

/**
 * The grid: a `.dk-row` per suit in SUITS order, led by the suit's sprite symbol (as the trump
 * badge shows it), then the ten ranks as `chip` faces of the pack (`gone` greyed, `held` greyed
 * with the ring), an empty cell where the deck has no such card so the ranks stay in their columns.
 */
export const deckHtml = (pack: CardPack, deck: Deck): string =>
  deck.rows
    .map(
      (row) =>
        `<div class="dk-row" role="group" aria-label="${SUIT_NAME[row.suit]}"><svg class="suit dk-suit" aria-hidden="true"><use href="#${suitSymbolId(row.suit)}"/></svg>${row.chips
          .map((chip) => chipHtml(pack, chip, deck.withHand))
          .join('')}</div>`,
    )
    .join('');
