// Cards and the deck (docs/MIGRATION.md step 10): ported from the legacy GinEngine block
// (test/fixtures/legacy/gin-engine.cjs); behaviour is unchanged, test/parity/gin.legacy.test.ts
// and gin.melds.test.ts are the oracle. Randomness is injected: `shuffle` takes the seeded `Rng` of
// web/shared/lib and draws from it exactly as the legacy Fisher-Yates did, so the same stream deals
// the same hands on both engines.
import type { Rng } from '../../../../shared/lib/rng.ts';
import type { Card, Cards, Meld, Rank, Suit } from './types.ts';

const SUITS: ReadonlyArray<Suit> = ['S', 'H', 'D', 'C'];
const SUIT_SYMBOL: Readonly<Record<Suit, string>> = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RANKS: ReadonlyArray<Rank> = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
const RANK_LABEL: Readonly<Partial<Record<Rank, string>>> = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };

const rankLabel = (r: Rank): string => RANK_LABEL[r] ?? String(r);
const makeCard = (r: Rank, s: Suit): Card => ({ id: rankLabel(r) + s, r, s });
/** Face cards count 10; every other card its rank (the ace 1). */
const cardValue = (c: Card): number => Math.min(c.r, 10);
const sumValue = (cards: Cards): number => cards.reduce((a, c) => a + cardValue(c), 0);
const pretty = (c: Card): string => rankLabel(c.r) + SUIT_SYMBOL[c.s];

/** The 52 cards, suit-major in SUITS order, ace to king within a suit. */
const makeDeck = (): Cards => SUITS.flatMap((s) => RANKS.map((r) => makeCard(r, s)));

const swapped = (cards: Cards, i: number, j: number): Cards =>
  cards.map((c, k) => (k === i ? (cards[j] ?? c) : k === j ? (cards[i] ?? c) : c));

/**
 * Fisher-Yates from the top: for i = n-1 down to 1, swap `i` with a draw in [0, i]. One rng call
 * per step, in this order, so a seeded stream reproduces the legacy permutation exactly.
 */
const shuffle = (cards: Cards, rng: Rng): Cards =>
  Array.from({ length: cards.length - 1 }, (_, k) => cards.length - 1 - k).reduce<Cards>(
    (a, i) => swapped(a, i, Math.floor(rng() * (i + 1))),
    cards,
  );

const suitIndex = (s: Suit): number => SUITS.indexOf(s);

/** Stable sort by suit (SUITS order) then rank; the legacy comparator. */
const sortCards = (cards: Cards): Cards =>
  [...cards].sort((a, b) => suitIndex(a.s) - suitIndex(b.s) || a.r - b.r);

/** A set: three or more cards of one rank. Anything else that is a meld is a run. */
const isSet = (meld: Meld): boolean => meld.length >= 3 && meld.every((c) => c.r === meld[0]?.r);

/** Sets sort by suit, runs by rank: how the legacy engine displays a meld. */
const sortMeld = (m: Meld): Meld =>
  isSet(m)
    ? [...m].sort((a, b) => suitIndex(a.s) - suitIndex(b.s))
    : [...m].sort((a, b) => a.r - b.r);

export {
  SUITS,
  SUIT_SYMBOL,
  RANKS,
  rankLabel,
  makeCard,
  cardValue,
  sumValue,
  pretty,
  makeDeck,
  shuffle,
  sortCards,
  isSet,
  sortMeld,
};
