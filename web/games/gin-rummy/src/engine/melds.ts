// Meld detection and declared arrangements (docs/MIGRATION.md step 10): ported from the legacy
// GinEngine block (test/fixtures/legacy/gin-engine.cjs); behaviour, including the order melds are
// listed in, is unchanged, test/parity/gin.melds.test.ts is the oracle. The solvers over these
// melds (the bitmask DP behind `bestMelding` and the node-capped DFS behind `allOptimalMeldings`)
// are in melds.algorithms.ts, which imports this module; index.ts presents both as one surface.
import { arrayOf, string } from '../../../../shared/lib/json.ts';
import { sortCards, sortMeld, sumValue } from './cards.ts';
import type { Card, Cards, Meld, Melding, Suit } from './types.ts';

/** Cards grouped by `key`, groups in order of first appearance, cards in hand order within one. */
const groupBy = <K>(cards: Cards, key: (c: Card) => K): ReadonlyArray<readonly [K, Cards]> =>
  cards.reduce<ReadonlyArray<readonly [K, Cards]>>((groups, c) => {
    const k = key(c);
    return groups.some(([g]) => g === k)
      ? groups.map(([g, cs]) => (g === k ? [g, [...cs, c]] : [g, cs]))
      : [...groups, [k, [c]]];
  }, []);

/**
 * Sets, ranks ascending (the legacy iterated an object keyed by rank, which orders integer keys
 * numerically). Four of a rank lists the four first, then each three-card subset in order of the
 * card left out.
 */
const sets = (cards: Cards): ReadonlyArray<Meld> =>
  groupBy(cards, (c) => c.r)
    .filter(([, g]) => g.length >= 3)
    .sort(([a], [b]) => a - b)
    .flatMap(([, g]) =>
      g.length === 4 ? [g, ...g.map((_, skip) => g.filter((__, i) => i !== skip))] : [g],
    );

/** Maximal stretches of consecutive ranks in a suit's cards, given sorted by rank. */
const stretches = (sorted: Cards): ReadonlyArray<Cards> =>
  sorted.reduce<ReadonlyArray<Cards>>((acc, c) => {
    const current = acc.at(-1);
    const previous = current?.at(-1);
    return current !== undefined && previous !== undefined && c.r === previous.r + 1
      ? [...acc.slice(0, -1), [...current, c]]
      : [...acc, [c]];
  }, []);

/** Every sub-run of three or more cards of a stretch: by start, then by end. */
const subRuns = (stretch: Cards): ReadonlyArray<Meld> =>
  stretch.length < 3
    ? []
    : stretch.flatMap((_, a) => stretch.slice(a + 2).map((__, k) => stretch.slice(a, a + 3 + k)));

/** Runs (ace low only), suits in order of first appearance in the hand. */
const runs = (cards: Cards): ReadonlyArray<Meld> =>
  groupBy(cards, (c): Suit => c.s).flatMap(([, g]) =>
    stretches([...g].sort((a, b) => a.r - b.r)).flatMap(subRuns),
  );

/** Every meld contained in `cards`: sets first, then runs. */
const allMelds = (cards: Cards): ReadonlyArray<Meld> => [...sets(cards), ...runs(cards)];

// ---------- alternative meld arrangements ----------
// A hand can often be melded several different ways for the SAME deadwood value (e.g. 5S 5H 5D +
// 4S 6S: either the set of fives or the 4-5-6 run; the 5S can only go in one of them). Which
// melds you DECLARE matters when you knock, because the opponent lays their deadwood off onto
// your melds. These helpers let the player pick their preferred arrangement among equally
// scoring ones.

/** A canonical name for an arrangement: card ids sorted within a meld, melds sorted. */
const meldSig = (melds: ReadonlyArray<Meld>): string =>
  melds
    .map((m) =>
      m
        .map((c) => c.id)
        .sort()
        .join('+'),
    )
    .sort()
    .join('|');

const isValidMeldGroup = (cs: Cards): boolean => {
  if (cs.length < 3) return false;
  const ranks = cs.map((c) => c.r);
  const suits = cs.map((c) => c.s);
  // set: 3-4 of a rank, distinct suits
  if (ranks.every((r) => r === ranks[0]))
    return cs.length <= 4 && new Set(suits).size === cs.length;
  // run: one suit, consecutive ranks
  if (!suits.every((s) => s === suits[0])) return false;
  const sorted = [...ranks].sort((a, b) => a - b);
  return sorted.every((r, i) => i === 0 || r === (sorted[i - 1] ?? 0) + 1);
};

const groupsDecoder = arrayOf(arrayOf(string));

type Declared = Readonly<{ used: ReadonlySet<string>; melds: ReadonlyArray<Meld> }>;

/**
 * Add one declared group. `null` unless every id is a distinct card of `byId` not used by an
 * earlier group and the cards form a legal meld.
 */
const declare = (
  byId: ReadonlyMap<string, Card>,
  acc: Declared | null,
  group: ReadonlyArray<string>,
): Declared | null => {
  if (acc === null) return null;
  const cs = group.flatMap((id) => {
    const c = byId.get(id);
    return c === undefined ? [] : [c];
  });
  const distinct = new Set(group).size === group.length && !group.some((id) => acc.used.has(id));
  if (cs.length !== group.length || !distinct || !isValidMeldGroup(cs)) return null;
  return { used: new Set([...acc.used, ...group]), melds: [...acc.melds, sortMeld(cs)] };
};

/**
 * Build a melding from explicit groups of card ids. Returns null unless the groups are legal,
 * non-overlapping melds drawn from cards actually present in `cards`. `groups` is unchecked
 * input, as the legacy accepted it (the setMelds payload arrives over the wire).
 */
const meldingFromGroups = (cards: Cards, groups: unknown): Melding | null => {
  const decoded = groupsDecoder(groups);
  if (!decoded.ok) return null;
  const byId = new Map(cards.map((c): readonly [string, Card] => [c.id, c]));
  const declared = decoded.value.reduce<Declared | null>(
    (acc, group) => declare(byId, acc, group),
    { used: new Set(), melds: [] },
  );
  if (declared === null) return null;
  const dead = cards.filter((c) => !declared.used.has(c.id));
  return { melds: declared.melds, deadwood: sortCards(dead), value: sumValue(dead) };
};

export { allMelds, meldSig, isValidMeldGroup, meldingFromGroups };
