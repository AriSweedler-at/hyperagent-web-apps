// The deck, the points, the strength and the trick (docs/design/briscola-rules.md E1-E3, E5, E7,
// E14). `makeDeck` is the 40 cards suit-major in SUITS order; `deckFor` drops the 2 of
// `removedTwo` at three players (D5) so 39 cards still hold 120 points and thirteen tricks come
// out even. Nothing here reads a state: these are the selectors the UI, the tests and the card
// packs (rules §7) share.
import type { GameOptions, Played, Card, Cards, Rank, Seat, Suit } from './types.ts';
import { LABEL, POINTS, RANKS, STRENGTH, SUITS } from './types.ts';

export const makeCard = (r: Rank, s: Suit): Card => ({ id: LABEL[r] + s, r, s });

/** E1: the 40 cards, suit-major in SUITS order (C D S B), rank 1..10 within a suit. */
export const makeDeck = (): Cards => SUITS.flatMap((s) => RANKS.map((r) => makeCard(r, s)));

/** E1: the deck this table plays: 39 cards at three players (the 2 of `removedTwo` leaves), else 40. */
export const deckFor = (options: Pick<GameOptions, 'seatCount' | 'removedTwo'>): Cards =>
  options.seatCount === 3
    ? makeDeck().filter((c) => !(c.r === 2 && c.s === options.removedTwo))
    : makeDeck();

/** E2: the points a set of cards is worth (the deck: 120). */
export const pointsOf = (cards: Cards): number => cards.reduce((sum, c) => sum + POINTS[c.r], 0);

export const idsOf = (cards: Cards): ReadonlyArray<string> => cards.map((c) => c.id);

/** The 40 ids `makeDeck` names, for `isCardId` and the decoders (E20). */
const DECK_IDS: ReadonlySet<string> = new Set(idsOf(makeDeck()));

/** Whether `id` is `LABEL + suit`: one of the forty (the 2 of a removed suit included; legality is the engine's). */
export const isCardId = (id: string): boolean => DECK_IDS.has(id);

const RANK_OF_LABEL: Readonly<Record<string, Rank>> = Object.fromEntries(
  RANKS.map((r) => [LABEL[r], r]),
);

/** The card an id names, or null outside the `LABEL + suit` grammar. */
export const cardById = (id: string): Card | null => {
  const r = RANK_OF_LABEL[id.slice(0, -1)];
  const s = id.slice(-1);
  return r !== undefined && isCardId(id) && (SUITS as ReadonlyArray<string>).includes(s)
    ? makeCard(r, s as Suit)
    : null;
};

const RANK_NAME: Readonly<Record<Rank, string>> = {
  1: 'asso',
  2: 'due',
  3: 'tre',
  4: 'quattro',
  5: 'cinque',
  6: 'sei',
  7: 'sette',
  8: 'fante',
  9: 'cavallo',
  10: 're',
};
export const SUIT_NAME: Readonly<Record<Suit, string>> = {
  C: 'coppe',
  D: 'denari',
  S: 'spade',
  B: 'bastoni',
};

/** D23: the Italian card name the log and the alt text use: "asso di coppe", "cavallo di bastoni". */
export const cardName = (card: Card): string => `${RANK_NAME[card.r]} di ${SUIT_NAME[card.s]}`;

/**
 * E7: the winner of a complete trick. A trump outranks every non-trump; among cards of one suit
 * the higher STRENGTH wins; a card of a third suit never wins. `cards[0]` led, so its suit is the
 * suit to follow; ids are unique, so no two cards tie.
 */
export const trickWinner = (trump: Suit, cards: ReadonlyArray<Played>): Seat => {
  const led = cards.map((p) => p.card.s).find((_, i) => i === 0);
  const power = (p: Played): number =>
    p.card.s === trump ? 20 + STRENGTH[p.card.r] : p.card.s === led ? STRENGTH[p.card.r] : 0;
  return cards.reduce((best, p) => (power(p) > power(best) ? p : best)).seat;
};

/**
 * E14: the card the table's trump card can be exchanged for: the 7 of trumps when the trump card
 * outranks the 7 (asso, tre, re, cavallo, fante), the 2 when it is the 7, 6, 5 or 4, nothing when
 * it is the 2.
 */
export const exchangeCardFor = (trumpCard: Card): Card | null =>
  STRENGTH[trumpCard.r] > STRENGTH[7]
    ? makeCard(7, trumpCard.s)
    : trumpCard.r === 2
      ? null
      : makeCard(2, trumpCard.s);
