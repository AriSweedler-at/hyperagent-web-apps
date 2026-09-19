// Layoffs against a knock (docs/MIGRATION.md step 10): ported from the legacy GinEngine block
// (test/fixtures/legacy/gin-engine.cjs); behaviour, including the order cards are laid off in and
// the extended melds that result, is unchanged, test/parity/gin.melds.test.ts is the oracle.
import { isSet, sortMeld } from './cards.ts';
import { meldSolver } from './melds.algorithms.ts';
import type { Card, Cards, Layoff, LayoffEntry, LayoffMelding, Meld } from './types.ts';

/** A set takes a fourth card of its rank in a new suit; a run takes the next rank either side. */
const fitsOnto = (c: Card, m: Meld): boolean => {
  if (isSet(m)) return m.length < 4 && c.r === m[0]?.r && !m.some((x) => x.s === c.s);
  const ranks = m.map((x) => x.r);
  const lo = Math.min(...ranks);
  const hi = Math.max(...ranks);
  return c.s === m[0]?.s && (c.r === lo - 1 || c.r === hi + 1);
};

type Progress = Readonly<{
  melds: ReadonlyArray<Meld>;
  remaining: Cards;
  laidOff: ReadonlyArray<LayoffEntry>;
}>;

/**
 * Lay off one card at a time, always the first remaining card that fits any meld (melds in
 * declaration order), restarting from the first card after each, until nothing fits. A chain
 * (4S then 5S onto A-2-3 of spades) falls out of the restart.
 */
const layOff = (p: Progress): Progress => {
  const fit = p.remaining
    .map((card): LayoffEntry => ({ card, onto: p.melds.findIndex((m) => fitsOnto(card, m)) }))
    .find((x) => x.onto >= 0);
  if (fit === undefined) return p;
  return layOff({
    melds: p.melds.map((m, i) => (i === fit.onto ? [...m, fit.card] : m)),
    remaining: p.remaining.filter((x) => x.id !== fit.card.id),
    laidOff: [...p.laidOff, fit],
  });
};

/** Given the knocker's melds, lay off as many of `cards` as possible (chained). */
const maximalLayoff = (cards: Cards, knockerMelds: ReadonlyArray<Meld>): Layoff => {
  const done = layOff({ melds: knockerMelds, remaining: cards, laidOff: [] });
  return {
    laidOff: done.laidOff,
    remaining: done.remaining,
    extendedMelds: done.melds.map(sortMeld),
  };
};

/**
 * Opponent's best response to a knock: choose own melds + layoffs minimising deadwood. Layoff
 * feasibility is monotone (each slot accepts exactly one specific card), so the maximal layoff set
 * L is unique and every feasible layoff set is a subset of L. Every subset is tried in bitmask
 * order and the first to reach the minimum wins (laying nothing off is subset 0).
 */
const bestMeldingWithLayoffs = (cards: Cards, knockerMelds: ReadonlyArray<Meld>): LayoffMelding => {
  const L = maximalLayoff(cards, knockerMelds).laidOff.map((x) => x.card);
  const solver = meldSolver(cards);
  const response = (S: Cards): LayoffMelding | null => {
    const lo = maximalLayoff(S, knockerMelds);
    // not feasible on its own (e.g. 9 without the 8)
    if (lo.laidOff.length !== S.length) return null;
    const m = solver.melding(solver.maskOf(S.map((c) => c.id)));
    return {
      melds: m.melds,
      laidOff: lo.laidOff,
      deadwood: m.deadwood,
      value: m.value,
      extendedMelds: lo.extendedMelds,
    };
  };
  // Subset 0 (nothing laid off) is always feasible, so it is the starting point.
  const none = solver.melding(0);
  const nothing: LayoffMelding = {
    melds: none.melds,
    laidOff: [],
    deadwood: none.deadwood,
    value: none.value,
    extendedMelds: knockerMelds.map(sortMeld),
  };
  return Array.from({ length: (1 << L.length) - 1 }, (_, k) => k + 1)
    .flatMap((sub) => {
      const r = response(L.filter((_, i) => (sub & (1 << i)) !== 0));
      return r === null ? [] : [r];
    })
    .reduce((best, m) => (m.value < best.value ? m : best), nothing);
};

export { fitsOnto, maximalLayoff, bestMeldingWithLayoffs };
