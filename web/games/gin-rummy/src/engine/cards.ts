// Cards and the deck (docs/MIGRATION.md step 10): ported from the legacy GinEngine block
// (test/fixtures/legacy/gin-engine.cjs); behaviour is unchanged, test/parity/gin.legacy.test.ts
// and gin.melds.test.ts are the oracle. Randomness is injected: `shuffle` takes the seeded `Rng` of
// web/shared/lib and draws from it exactly as the legacy Fisher-Yates did, so the same stream deals
// the same hands on both engines. Since briscola (docs/design/briscola-rules.md E4) the Fisher-Yates
// body lives in web/shared/lib/shuffle.ts, generic over the item; this module re-exports it at the
// legacy signature and the parity suites pin the permutation unchanged.
import type { Rng } from '../../../../shared/lib/rng.ts';
import { shuffle as shuffleItems } from '../../../../shared/lib/shuffle.ts';
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
const idsOf = (cards: Cards): ReadonlyArray<string> => cards.map((c) => c.id);
const pretty = (c: Card): string => rankLabel(c.r) + SUIT_SYMBOL[c.s];

/** The 52 cards, suit-major in SUITS order, ace to king within a suit. */
const makeDeck = (): Cards => SUITS.flatMap((s) => RANKS.map((r) => makeCard(r, s)));

/**
 * Fisher-Yates from the top: for i = n-1 down to 1, swap `i` with a draw in [0, i]. One rng call
 * per step, in this order, so a seeded stream reproduces the legacy permutation exactly
 * (web/shared/lib/shuffle.ts holds the body).
 */
const shuffle = (cards: Cards, rng: Rng): Cards => shuffleItems(cards, rng);

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
  idsOf,
  pretty,
  makeDeck,
  shuffle,
  sortCards,
  isSet,
  sortMeld,
};
