// The deck, the points, the strength and the trick (docs/design/briscola-rules.md E1-E3, E5, E7,
// E14). `makeDeck` is the 40 cards suit-major in SUITS order; `deckFor` drops the 2 of
// `removedTwo` at three players (D5) so 39 cards still hold 120 points and thirteen tricks come
// out even. `trickWinner` names the taker and `trickFacts` reads what the trick-outcome sounds and
// the history rows need of a resolved trick (the winning card and its class, a briscola, a steal,
// an overtrump, the value class; design §4), once, in the reducer. Nothing here reads a state:
// these are the selectors the UI, the tests and the card packs (rules §7) share.
import { sideOf } from './seats.ts';
import type {
  GameOptions,
  Played,
  Card,
  Cards,
  Rank,
  Seat,
  SeatCount,
  Suit,
  TrickFacts,
  ValueClass,
  WinningClass,
} from './types.ts';
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
export const trickWinner = (trump: Suit, cards: ReadonlyArray<Played>): Seat =>
  winningPlay(trump, cards).seat;

/** The suit to follow: the first card's. */
const ledSuit = (cards: ReadonlyArray<Played>): Suit | undefined => cards[0]?.card.s;

/** E7's ordering as a number: a trump above 20, a card of the led suit by STRENGTH, a third suit 0. */
const power = (trump: Suit, cards: ReadonlyArray<Played>, p: Played): number =>
  p.card.s === trump
    ? 20 + STRENGTH[p.card.r]
    : p.card.s === ledSuit(cards)
      ? STRENGTH[p.card.r]
      : 0;

/** The play that took the trick (E7); `cards` is never empty when a trick resolves. */
const winningPlay = (trump: Suit, cards: ReadonlyArray<Played>): Played =>
  cards.reduce((best, p) => (power(trump, cards, p) > power(trump, cards, best) ? p : best));

/** A complete trick is `seatCount` cards long, so the sides of its seats are read off its length. */
const seatCountOf = (cards: ReadonlyArray<Played>): SeatCount =>
  cards.length === 2 ? 2 : cards.length === 3 ? 3 : 4;

/** Whether the two seats score together: themselves at two and three players, `seat % 2` at four. */
const sameSide = (cards: ReadonlyArray<Played>, a: Seat, b: Seat): boolean =>
  sideOf(seatCountOf(cards), a) === sideOf(seatCountOf(cards), b);

/** A carico: the asso or the tre, the two cards worth ten or more (E2). */
export const isCarico = (card: Card): boolean => POINTS[card.r] >= 10;

/** The winning card's class for the trick-outcome table (design §4): asso, tre, re, cavallo, fante or a pip. */
export const winningClassOf = (card: Card): WinningClass =>
  card.r === 1
    ? 'asso'
    : card.r === 3
      ? 'tre'
      : card.r === 10
        ? 're'
        : card.r === 9
          ? 'cavallo'
          : card.r === 8
            ? 'fante'
            : 'pip';

/** The trick's points by class (design §4): 0 pointless, 1–9 small, 10–19 big, 20 and up huge. */
export const valueClassOf = (points: number): ValueClass =>
  points === 0 ? 'pointless' : points < 10 ? 'small' : points < 20 ? 'big' : 'huge';

/**
 * The derived facts of a complete trick, read once at resolution and stored on the `trick` event
 * (design §4, §5): the card that took it and its class; `briscola` when that card is a trump;
 * `steal` when a trump took a big card (asso or tre) of the led suit from an opponent, a card that
 * would have won without the trump (a partner's card at four players is not stolen: it went to the
 * side); `overtrump` when another trump was in the trick under the winning one; the value class.
 */
export const trickFacts = (trump: Suit, cards: ReadonlyArray<Played>): TrickFacts => {
  const winning = winningPlay(trump, cards);
  const led = ledSuit(cards);
  const briscola = winning.card.s === trump;
  return {
    winningCard: winning.card,
    winningClass: winningClassOf(winning.card),
    briscola,
    steal:
      briscola &&
      led !== trump &&
      cards.some(
        (p) => p.card.s === led && isCarico(p.card) && !sameSide(cards, p.seat, winning.seat),
      ),
    overtrump: briscola && cards.filter((p) => p.card.s === trump).length > 1,
    valueClass: valueClassOf(pointsOf(cards.map((p) => p.card))),
  };
};

/** The seats on other sides than the winner's whose asso or tre went into the trick (design §4 "carico lost"), in play order. */
export const carichiLost = (winner: Seat, cards: ReadonlyArray<Played>): ReadonlyArray<Seat> =>
  cards.filter((p) => isCarico(p.card) && !sameSide(cards, p.seat, winner)).map((p) => p.seat);

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
