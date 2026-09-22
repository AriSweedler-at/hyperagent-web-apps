// Meld-level parity for the gin engine (docs/MIGRATION.md step 10): the legacy fixture and the
// TypeScript engine over 2000 seeded 10/11-card hands, drawn from three pools (the full deck, two
// suits, ranks ace to seven) so sets, runs, four-of-a-kinds and chained layoffs are dense. Every
// helper's result is compared as JSON text: values, keys and order, tie-breaking included, with
// one relaxation: where a card of the hand fits two knocker melds (`multiFit`, gin.layoffs.ts) the
// current engine may lay off more and leave less deadwood than the legacy, never less or more
// (docs/design/gin-arrangement-and-discards.md §7); every other hand's layoffs match exactly.
import { describe, expect, test } from 'vitest';

import * as current from '../../web/games/gin-rummy/src/engine/index.ts';
import type { Card as EngineCard, Meld } from '../../web/games/gin-rummy/src/engine/index.ts';
import { mulberry32 } from '../../web/shared/lib/rng.ts';
import { loadLegacyGin, type Card } from './gin.api.ts';
import { multiFit } from './gin.layoffs.ts';

const legacy = loadLegacyGin();
const HANDS = 2000;

const deck = legacy.makeDeck();
const pools: ReadonlyArray<Card[]> = [
  deck,
  deck.filter((c) => c.s === 'S' || c.s === 'H'),
  deck.filter((c) => c.r <= 7),
];

const same = (label: string, got: unknown, want: unknown): void => {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a !== b) {
    expect(got, label).toEqual(want);
    expect(a, `${label}: same values but different key order`).toBe(b);
  }
};

const asEngine = (cards: Card[]): EngineCard[] => cards as EngineCard[];
const asEngineMelds = (melds: Card[][]): Meld[] => melds as Meld[];

/** Whether the hand of `seed` fits two knocker melds, so the layoff helpers were compared loosely. */
const compareHand = (seed: number): boolean => {
  const pool = pools[seed % pools.length] ?? deck;
  const shuffled = legacy.shuffle(pool, mulberry32(seed));
  same(`shuffle ${String(seed)}`, current.shuffle(asEngine(pool), mulberry32(seed)), shuffled);
  const size = 10 + (seed % 2);
  const hand = shuffled.slice(0, size);
  const opponent = shuffled.slice(size, size + 10);
  const label = `seed ${String(seed)} hand ${hand.map((c) => c.id).join(' ')}`;

  same(`${label}: sortCards`, current.sortCards(asEngine(hand)), legacy.sortCards(hand));
  same(`${label}: allMelds`, current.allMelds(asEngine(hand)), legacy.allMelds(hand));
  const best = legacy.bestMelding(hand);
  same(`${label}: bestMelding`, current.bestMelding(asEngine(hand)), best);
  same(`${label}: meldSig`, current.meldSig(asEngineMelds(best.melds)), legacy.meldSig(best.melds));
  same(
    `${label}: allOptimalMeldings(12)`,
    current.allOptimalMeldings(asEngine(hand), 12),
    legacy.allOptimalMeldings(hand, 12),
  );
  same(
    `${label}: allOptimalMeldings()`,
    current.allOptimalMeldings(asEngine(hand)),
    legacy.allOptimalMeldings(hand),
  );
  // The knocker's melds are the seeded opponent's best melding; the hand lays off onto them.
  const knockerMelds = legacy.bestMelding(opponent).melds;
  const loose = multiFit(hand, knockerMelds);
  const layoff = current.maximalLayoff(asEngine(hand), asEngineMelds(knockerMelds));
  const withLayoffs = current.bestMeldingWithLayoffs(asEngine(hand), asEngineMelds(knockerMelds));
  const legacyLayoff = legacy.maximalLayoff(hand, knockerMelds);
  const legacyWithLayoffs = legacy.bestMeldingWithLayoffs(hand, knockerMelds);
  if (loose) {
    // A card fits two knocker melds: the current engine follows both and may do better.
    expect(layoff.laidOff.length, `${label}: maximalLayoff`).toBeGreaterThanOrEqual(
      legacyLayoff.laidOff.length,
    );
    expect(withLayoffs.value, `${label}: bestMeldingWithLayoffs`).toBeLessThanOrEqual(
      legacyWithLayoffs.value,
    );
  } else {
    same(`${label}: maximalLayoff`, layoff, legacyLayoff);
    same(`${label}: bestMeldingWithLayoffs`, withLayoffs, legacyWithLayoffs);
  }
  // Declared arrangements: each optimal arrangement's groups round-trip; a group with a card
  // from the other hand, an overlapping group and a non-meld are refused on both legs.
  const groupsOf = (melds: Card[][]): string[][] => melds.map((m) => m.map((c) => c.id));
  legacy.allOptimalMeldings(hand, 12).forEach((o, i) => {
    same(
      `${label}: meldingFromGroups(option ${String(i)})`,
      current.meldingFromGroups(asEngine(hand), groupsOf(o.melds)),
      legacy.meldingFromGroups(hand, groupsOf(o.melds)),
    );
  });
  const first = best.melds[0];
  const bad: unknown[] = [
    [opponent.slice(0, 3).map((c) => c.id)],
    first === undefined ? [] : [first.map((c) => c.id), first.map((c) => c.id)],
    [hand.slice(0, 3).map((c) => c.id)],
    [[hand[0]?.id ?? '', 7]],
    'not groups',
  ];
  bad.forEach((groups, i) => {
    same(
      `${label}: meldingFromGroups(bad ${String(i)})`,
      current.meldingFromGroups(asEngine(hand), groups),
      legacy.meldingFromGroups(hand, groups),
    );
  });
  return loose;
};

describe('gin engine parity: legacy vs current, meld helpers', () => {
  test(`${String(HANDS)} seeded hands agree on every meld helper, in order; the layoff helpers loosely where a card fits two knocker melds`, () => {
    const loose = Array.from({ length: HANDS }, (_, i) => i + 1).filter(compareHand);
    // The relaxation is exercised (14 hands at the time of writing) and stays the exception.
    expect(loose.length).toBeGreaterThan(0);
    expect(loose.length).toBeLessThan(HANDS / 50);
  }, 120_000);

  test('the constants and the card helpers', () => {
    expect(current.SUITS).toEqual(legacy.SUITS);
    expect(current.SUIT_SYMBOL).toEqual(legacy.SUIT_SYMBOL);
    expect([current.KNOCK_LIMIT, current.GIN_BONUS, current.UNDERCUT_BONUS]).toEqual([
      legacy.KNOCK_LIMIT,
      legacy.GIN_BONUS,
      legacy.UNDERCUT_BONUS,
    ]);
    same('makeDeck', current.makeDeck(), legacy.makeDeck());
    deck.forEach((c) => {
      const e = c as EngineCard;
      expect(current.makeCard(e.r, e.s)).toEqual(legacy.makeCard(c.r, c.s));
      expect(current.cardValue(e)).toBe(legacy.cardValue(c));
      expect(current.rankLabel(e.r)).toBe(legacy.rankLabel(c.r));
      expect(current.pretty(e)).toBe(legacy.pretty(c));
    });
    expect(current.sumValue(asEngine(deck))).toBe(legacy.sumValue(deck));
    legacy.allMelds(deck.filter((c) => c.r <= 4)).forEach((m) => {
      expect(current.isSet(asEngineMelds([m])[0] ?? [])).toBe(legacy.isSet(m));
    });
  });

  test('the DFS node cap truncates the same way on both legs', () => {
    // Ranks ace to six in every suit plus the queen and king of spades: 20 deadwood at best and
    // enough overlapping melds that the search passes 300000 nodes before it is done.
    const many = [...deck.filter((c) => c.r <= 6), ...deck.filter((c) => c.s === 'S' && c.r >= 12)];
    const want = legacy.allOptimalMeldings(many, 1e9);
    expect(want.length).toBeGreaterThan(100);
    same('node cap', current.allOptimalMeldings(asEngine(many), 1e9), want);
  });
});
