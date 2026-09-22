// The layoff rule beside the parity oracles (docs/design/gin-arrangement-and-discards.md §7):
// gin.melds.test.ts pins the current engine to the legacy over 2000 seeded hands wherever every
// card fits one meld, and gin.legacy.test.ts pins one branching position per leg. This file names
// the rule's own cases: what fits onto a set and a run, a chain through the restart, the branch
// where a card fits a set and a run, the tie of a card fitting two runs of its suit, and the subsets
// `bestMeldingWithLayoffs` may or may not lay off.
import { describe, expect, test } from 'vitest';

import { makeCard } from './cards.ts';
import { bestMeldingWithLayoffs, fitsOnto, maximalLayoff } from './layoff.ts';
import type { Card, Cards, Meld, Rank, Suit } from './types.ts';

const RANKS: Readonly<Record<string, Rank>> = { A: 1, J: 11, Q: 12, K: 13 };
const isSuit = (s: string): s is Suit => s === 'S' || s === 'H' || s === 'D' || s === 'C';
const card = (id: string): Card => {
  const suit = id.slice(-1);
  const label = id.slice(0, -1);
  if (!isSuit(suit)) throw new Error(`bad card id ${id}`);
  return makeCard(RANKS[label] ?? (Number(label) as Rank), suit);
};
const cards = (ids: string): Cards => ids.split(' ').map(card);
const melds = (...groups: ReadonlyArray<string>): ReadonlyArray<Meld> => groups.map(cards);
const ids = (cs: Cards): string => cs.map((c) => c.id).join(' ');
const laid = (entries: ReadonlyArray<{ card: Card; onto: number }>): ReadonlyArray<string> =>
  entries.map((x) => `${x.card.id}>${String(x.onto)}`);

describe('fitsOnto', () => {
  test('a set takes a fourth card of its rank in a suit it lacks, never a fifth', () => {
    const sevens = cards('7S 7H 7D');
    expect(fitsOnto(card('7C'), sevens)).toBe(true);
    expect(fitsOnto(card('7S'), sevens)).toBe(false);
    expect(fitsOnto(card('8C'), sevens)).toBe(false);
    expect(fitsOnto(card('7C'), cards('7S 7H 7D 7C'))).toBe(false);
  });

  test('a run takes the next rank either side in its suit, nothing else', () => {
    const run = cards('4C 5C 6C');
    expect(fitsOnto(card('7C'), run)).toBe(true);
    expect(fitsOnto(card('3C'), run)).toBe(true);
    expect(fitsOnto(card('8C'), run)).toBe(false);
    expect(fitsOnto(card('7D'), run)).toBe(false);
    expect(fitsOnto(card('5C'), run)).toBe(false);
  });
});

describe('maximalLayoff', () => {
  test('a chain: 4S then 5S onto A-2-3 of spades, laid off in that order', () => {
    const r = maximalLayoff(cards('5S 4S KD'), melds('AS 2S 3S', '7D 8D 9D'));
    expect(laid(r.laidOff)).toEqual(['4S>0', '5S>0']);
    expect(ids(r.remaining)).toBe('KD');
    expect(r.extendedMelds.map(ids)).toEqual(['AS 2S 3S 4S 5S', '7D 8D 9D']);
  });

  test('the branch: a card fitting a set and a run goes where the next card can follow', () => {
    // 7C fits the sevens and 4-5-6 of clubs; only the run lets the 8C follow.
    const r = maximalLayoff(cards('7C 8C QD KD'), melds('7S 7H 7D', '4C 5C 6C'));
    expect(laid(r.laidOff)).toEqual(['7C>1', '8C>1']);
    expect(ids(r.remaining)).toBe('QD KD');
    expect(r.extendedMelds.map(ids)).toEqual(['7S 7H 7D', '4C 5C 6C 7C 8C']);
  });

  test('a tie between fits keeps the first meld (the legacy order): the set before the run', () => {
    const r = maximalLayoff(cards('7C QD KD'), melds('7S 7H 7D', '4C 5C 6C'));
    expect(laid(r.laidOff)).toEqual(['7C>0']);
    expect(r.extendedMelds.map(ids)).toEqual(['7S 7H 7D 7C', '4C 5C 6C']);
  });

  test('a card between two runs of its suit: both ways lay off the same cards, the first meld wins', () => {
    // 6C fits 3-4-5 and 7-8-9 of clubs. Its neighbours are both melded already, so nothing can
    // follow it either way: the branch is a tie and the legacy's choice (the first meld) stands.
    const r = maximalLayoff(cards('6C 10C KD'), melds('3C 4C 5C', '7C 8C 9C'));
    expect(laid(r.laidOff)).toEqual(['6C>0', '10C>1']);
    expect(r.extendedMelds.map(ids)).toEqual(['3C 4C 5C 6C', '7C 8C 9C 10C']);
  });

  test('nothing fits: the hand and the melds come back as they were, sorted for display', () => {
    const r = maximalLayoff(cards('KD QH'), melds('7H 7S 7D'));
    expect(r.laidOff).toEqual([]);
    expect(ids(r.remaining)).toBe('KD QH');
    expect(r.extendedMelds.map(ids)).toEqual(['7S 7H 7D']);
  });
});

describe('bestMeldingWithLayoffs', () => {
  test('the branch position: both clubs go onto the run and only the court cards count', () => {
    const r = bestMeldingWithLayoffs(
      cards('7C 8C 10H JH QH 4H 5H 6H QD KD'),
      melds('7S 7H 7D', '4C 5C 6C', 'AS 2S 3S'),
    );
    expect(laid(r.laidOff)).toEqual(['7C>1', '8C>1']);
    expect(r.melds.map(ids)).toEqual(['10H JH QH', '4H 5H 6H']);
    expect(ids(r.deadwood)).toBe('QD KD');
    expect(r.value).toBe(20);
    expect(r.extendedMelds.map(ids)).toEqual(['7S 7H 7D', '4C 5C 6C 7C 8C', 'AS 2S 3S']);
  });

  test('a card is kept for a meld of its own when that beats laying it off', () => {
    // 7C could go onto the sevens, but 7C 8C 9C melds and the 8C 9C would otherwise be deadwood.
    const r = bestMeldingWithLayoffs(cards('7C 8C 9C QD KD'), melds('7S 7H 7D', '4C 5C 6C'));
    expect(r.laidOff).toEqual([]);
    expect(r.melds.map(ids)).toEqual(['7C 8C 9C']);
    expect(r.value).toBe(20);
    expect(r.extendedMelds.map(ids)).toEqual(['7S 7H 7D', '4C 5C 6C']);
  });

  test('a subset no leaf lays off in full is skipped: the 9 without the 8', () => {
    // L is [8D, 9D]; {9D} alone cannot be laid off, {8D} and {8D, 9D} can; both go.
    const r = bestMeldingWithLayoffs(cards('9D 8D KD'), melds('5D 6D 7D'));
    expect(laid(r.laidOff)).toEqual(['8D>0', '9D>0']);
    expect(ids(r.deadwood)).toBe('KD');
    expect(r.value).toBe(10);
  });

  test('laying nothing off is the answer when nothing fits', () => {
    const r = bestMeldingWithLayoffs(cards('KD QH 2C'), melds('7H 7S 7D'));
    expect(r.laidOff).toEqual([]);
    expect(r.value).toBe(22);
    expect(r.extendedMelds.map(ids)).toEqual(['7S 7H 7D']);
  });
});
