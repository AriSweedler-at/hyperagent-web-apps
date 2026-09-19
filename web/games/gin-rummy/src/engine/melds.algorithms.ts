// The meld solvers (docs/ARCHITECTURE.md "*.algorithms.ts"; docs/MIGRATION.md step 10), ported
// from the legacy GinEngine block (test/fixtures/legacy/gin-engine.cjs): the memoised bitmask DP
// that finds the minimum-deadwood melding of a hand, and the node-capped DFS that lists every
// arrangement reaching that minimum. test/parity/gin.melds.test.ts deep-equals both against the
// legacy engine over seeded hands, tie-breaking order and the node cap included.
//
// Why not the functional form: both are exhaustive searches over the 2^n subsets of an 11-card
// hand, run for every card of every view (`discardOptions` asks the DP eleven times per view). The
// DP's memo is a cell per subset written on the way back up, and which meld it records for a
// subset is the FIRST one to reach the minimum in `allMelds` order, so a rewrite that changed the
// traversal or the comparison would change the melds shown. The DFS counts every node it visits
// and stops at 300000 (a hand of overlapping melds can have thousands of arrangements), so its
// output depends on the visiting order too. Both are kept in their legacy loop-and-mutation form,
// and their results are the oracle's.
import { cardValue, sortCards, sortMeld } from './cards.ts';
import { allMelds, meldSig } from './melds.ts';
import type { Arrangement, Card, Cards, Meld, Melding } from './types.ts';

/**
 * Index into a list the algorithm has already bounded (a card index below `n`, a meld index from
 * `byCard`). The compiler cannot see the bound; this says so once instead of a dead branch per read.
 */
const at = <T>(xs: ReadonlyArray<T>, i: number): T => xs[i] as T;
/** A lookup of a card id the index was built from (every meld is made of the hand's cards). */
const found = <T>(x: T | undefined): T => x as T;

/** Lowest clear bit of `used`: the first card not yet placed. */
const firstFree = (used: number): number => {
  let i = 0;
  while (used & (1 << i)) i++;
  return i;
};

type MeldIndex = Readonly<{
  melds: ReadonlyArray<Meld>;
  meldMasks: ReadonlyArray<number>;
  /** For each card index, the melds (indices) that contain it, in `allMelds` order. */
  byCard: ReadonlyArray<ReadonlyArray<number>>;
  values: ReadonlyArray<number>;
  idx: ReadonlyMap<string, number>;
  full: number;
}>;

/** Every meld of `cards` as a bitmask over the hand's card indices. */
const indexMelds = (cards: Cards): MeldIndex => {
  const n = cards.length;
  const melds = allMelds(cards);
  const idx = new Map(cards.map((c, i): readonly [string, number] => [c.id, i]));
  const meldMasks = melds.map((m) => m.reduce((mask, c) => mask | (1 << found(idx.get(c.id))), 0));
  const byCard: number[][] = Array.from({ length: n }, () => []);
  for (const [mi, mask] of meldMasks.entries()) {
    for (let i = 0; i < n; i++) if (mask & (1 << i)) at(byCard, i).push(mi);
  }
  return { melds, meldMasks, byCard, values: cards.map(cardValue), idx, full: (1 << n) - 1 };
};

export type MeldSolver = Readonly<{
  /** The minimum-deadwood melding of the hand minus the cards in `excluded`. */
  melding: (excluded?: number) => Melding;
  /** The bitmask of these card ids. */
  maskOf: (ids: ReadonlyArray<string>) => number;
  /** The minimum deadwood of the hand minus the cards in `excluded`. */
  value: (excluded?: number) => number;
}>;

/**
 * Memoised bitmask DP over a hand. `excluded` marks cards that are not part of the hand for this
 * query (e.g. the card about to be discarded, or cards laid off). One solver answers every
 * "what if I discard X" question for an 11-card hand; the memo is shared by its queries.
 */
export const meldSolver = (cards: Cards): MeldSolver => {
  const { melds, meldMasks, byCard, values, idx, full } = indexMelds(cards);
  const memo = new Map<number, number>();
  const choice = new Map<number, number>();

  const f = (used: number): number => {
    if (used === full) return 0;
    const hit = memo.get(used);
    if (hit !== undefined) return hit;
    const i = firstFree(used);
    let best = at(values, i) + f(used | (1 << i));
    let pick = -1;
    for (const mi of at(byCard, i)) {
      if (at(meldMasks, mi) & used) continue;
      const v = f(used | at(meldMasks, mi));
      if (v < best) {
        best = v;
        pick = mi;
      }
    }
    memo.set(used, best);
    choice.set(used, pick);
    return best;
  };

  const melding = (excluded = 0): Melding => {
    const value = f(excluded);
    const chosen: Meld[] = [];
    const deadwood: Card[] = [];
    let used = excluded;
    while (used !== full) {
      const i = firstFree(used);
      const pick = choice.get(used);
      if (pick === undefined || pick === -1) {
        deadwood.push(at(cards, i));
        used |= 1 << i;
      } else {
        chosen.push(at(melds, pick));
        used |= at(meldMasks, pick);
      }
    }
    return { melds: chosen.map(sortMeld), deadwood: sortCards(deadwood), value };
  };

  const maskOf = (ids: ReadonlyArray<string>): number =>
    ids.reduce((m, id) => m | (1 << found(idx.get(id))), 0);

  return { melding, maskOf, value: (excluded = 0) => f(excluded) };
};

/** Best melding: minimise deadwood value. */
export const bestMelding = (cards: Cards): Melding =>
  cards.length === 0 ? { melds: [], deadwood: [], value: 0 } : meldSolver(cards).melding(0);

/**
 * Memo of `allOptimalMeldings`, keyed by the sorted card ids and the limit; the legacy engine kept
 * it too and emptied it past 400 entries. Exported for the tests that pin that behaviour.
 */
export const altCache = new Map<string, ReadonlyArray<Arrangement>>();
export const ALT_CACHE_LIMIT = 400;
export const DEFAULT_ARRANGEMENT_LIMIT = 12;
export const NODE_CAP = 300000;

/**
 * Every distinct arrangement that achieves the minimum deadwood value, at most `limit` of them
 * (12 when absent or 0), in DFS order: at each step the first unplaced card joins each of its melds
 * in `allMelds` order before it is tried as deadwood. The search stops after NODE_CAP nodes, so a
 * hand with very many arrangements may list fewer than exist (the view adds the solver's own pick
 * when it is missing).
 */
export const allOptimalMeldings = (cards: Cards, limit?: number): ReadonlyArray<Arrangement> => {
  const cap = limit === undefined || limit === 0 ? DEFAULT_ARRANGEMENT_LIMIT : limit;
  if (cards.length === 0) return [{ melds: [], deadwood: [], value: 0, sig: '' }];
  const key = `${[...cards.map((c) => c.id)].sort().join(',')}#${String(cap)}`;
  const hit = altCache.get(key);
  if (hit) return hit;
  const minValue = bestMelding(cards).value;
  const { melds, meldMasks, byCard, values, full } = indexMelds(cards);
  const out: Arrangement[] = [];
  const chosen: number[] = [];
  let nodes = 0;
  /** Explore from `used` with `dead` points already counted; returns how many are listed so far. */
  const rec = (used: number, dead: number): number => {
    if (out.length >= cap || nodes++ > NODE_CAP || dead > minValue) return out.length;
    if (used === full) {
      // Every arrangement reaching here has exactly `minValue` deadwood (more was pruned above,
      // less cannot exist) and a signature not yet listed (the first free card joins each meld
      // once, so no two paths pick the same melds); the legacy re-checked both, to no effect.
      const arrangement = chosen.map((mi) => sortMeld(at(melds, mi)));
      const covered = chosen.reduce((m, mi) => m | at(meldMasks, mi), 0);
      return out.push({
        melds: arrangement,
        deadwood: sortCards(cards.filter((_, k) => !(covered & (1 << k)))),
        value: dead,
        sig: meldSig(arrangement),
      });
    }
    const i = firstFree(used);
    for (const mi of at(byCard, i)) {
      if (at(meldMasks, mi) & used) continue;
      chosen.push(mi);
      rec(used | at(meldMasks, mi), dead);
      chosen.pop();
      if (out.length >= cap) return out.length;
    }
    return rec(used | (1 << i), dead + at(values, i));
  };
  rec(0, 0);
  if (altCache.size > ALT_CACHE_LIMIT) altCache.clear();
  altCache.set(key, out);
  return out;
};
