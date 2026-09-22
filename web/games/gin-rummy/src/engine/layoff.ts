// Layoffs against a knock (docs/MIGRATION.md step 10): ported from the legacy GinEngine block
// (test/fixtures/legacy/gin-engine.cjs); behaviour, including the order cards are laid off in and
// the extended melds that result, is unchanged wherever every card fits one meld at most, and
// test/parity/gin.melds.test.ts is the oracle there. Where a card fits two of the knocker's melds
// (a set and a run, or two runs of its suit) the legacy attached it to the first and lost the other
// meld's continuation (7C onto three sevens strands the 8C that 4-5-6 of clubs would have taken);
// here every fit is followed and the layoff that takes the most cards wins
// (docs/design/gin-arrangement-and-discards.md §7). gin.legacy.test.ts pins both legs on that
// position and gin.melds.test.ts allows the current leg only to do better there.
import { isSet, sortMeld } from './cards.ts';
import { isValidMeldGroup } from './melds.ts';
import { bestMelding, meldSolver } from './melds.algorithms.ts';
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

/** The indexes of the melds `c` fits now, in declaration order. */
const fitsOf = (melds: ReadonlyArray<Meld>, c: Card): ReadonlyArray<number> =>
  melds.flatMap((m, i) => (fitsOnto(c, m) ? [i] : []));

/** `card` laid off onto meld `onto`: the meld grows, the card leaves the hand, the entry is kept. */
const laid = (p: Progress, card: Card, onto: number): Progress => ({
  melds: p.melds.map((m, i) => (i === onto ? [...m, card] : m)),
  remaining: p.remaining.filter((x) => x.id !== card.id),
  laidOff: [...p.laidOff, { card, onto }],
});

/**
 * Lay off one card at a time, always the first remaining card that fits any meld, restarting from
 * the first card after each, until nothing fits: every way of doing so, one leaf per way. A card
 * that fits one meld (the usual case) gives one branch, so the tree is a chain and its single leaf
 * is the legacy's result, laid off in the legacy's order (4S then 5S onto A-2-3 of spades falls out
 * of the restart). A card that fits two melds is laid off onto each in turn, and each way is
 * followed to its own end, because which meld takes it decides what the later cards can join.
 */
const layoffLeaves = (p: Progress): ReadonlyArray<Progress> => {
  const first = p.remaining
    .map((card): Readonly<{ card: Card; onto: ReadonlyArray<number> }> => ({
      card,
      onto: fitsOf(p.melds, card),
    }))
    .find((x) => x.onto.length > 0);
  if (first === undefined) return [p];
  return first.onto.flatMap((onto) => layoffLeaves(laid(p, first.card, onto)));
};

/** The leaf laying off the most cards; the first on a tie, so a single-fit hand is the legacy's. */
const mostLaidOff = (leaves: ReadonlyArray<Progress>): Progress =>
  leaves.reduce((best, leaf) => (leaf.laidOff.length > best.laidOff.length ? leaf : best));

/** Given the knocker's melds, lay off as many of `cards` as possible (chained). */
const maximalLayoff = (cards: Cards, knockerMelds: ReadonlyArray<Meld>): Layoff => {
  const done = mostLaidOff(layoffLeaves({ melds: knockerMelds, remaining: cards, laidOff: [] }));
  return {
    laidOff: done.laidOff,
    remaining: done.remaining,
    extendedMelds: done.melds.map(sortMeld),
  };
};

/** Every card some leaf lays off, once each, in the order the leaves lay them off. */
const laidOffByAny = (leaves: ReadonlyArray<Progress>): Cards =>
  leaves
    .flatMap((leaf) => leaf.laidOff.map((x) => x.card))
    .filter((c, i, all: Cards) => all.findIndex((x) => x.id === c.id) === i);

/**
 * Opponent's best response to a knock: choose own melds + layoffs minimising deadwood. A card laid
 * off is one the hand need not meld, so the candidates are the subsets of L, every card some leaf
 * of the layoff tree lays off; a subset S is feasible when some leaf lays off all of S (the leaf
 * with the most cards, which `maximalLayoff` picks, then has S.length). Every subset is tried in
 * bitmask order and the first to reach the minimum wins (laying nothing off is subset 0). Where
 * every card fits one meld the tree has one leaf and L is its cards in the legacy's order.
 */
const bestMeldingWithLayoffs = (cards: Cards, knockerMelds: ReadonlyArray<Meld>): LayoffMelding => {
  const L = laidOffByAny(layoffLeaves({ melds: knockerMelds, remaining: cards, laidOff: [] }));
  const solver = meldSolver(cards);
  const response = (S: Cards): LayoffMelding | null => {
    const lo = maximalLayoff(S, knockerMelds);
    // No leaf lays off all of S (the 9 without the 8, or the 8C without the 7C on the run).
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

// ---- laying off by hand (docs/design/gin-arrangement-and-discards.md §7b) ----------------------

/** The knocker's melds with the cards laid off onto each appended, each sorted as a meld. */
const extendedMelds = (
  melds: ReadonlyArray<Meld>,
  laidOff: ReadonlyArray<LayoffEntry>,
): ReadonlyArray<Meld> =>
  melds.map((m, i) => sortMeld([...m, ...laidOff.filter((e) => e.onto === i).map((e) => e.card)]));

/** Whether the card laid off as `cardId` can be taken back: its meld stays a meld with the others laid on it. */
const canTakeBack = (
  melds: ReadonlyArray<Meld>,
  laidOff: ReadonlyArray<LayoffEntry>,
  cardId: string,
): boolean => {
  const entry = laidOff.find((e) => e.card.id === cardId);
  if (entry === undefined) return false;
  const rest = laidOff.filter((e) => e.card.id !== cardId);
  const meld = extendedMelds(melds, rest)[entry.onto];
  return meld !== undefined && isValidMeldGroup(meld);
};

/** The defender's answer as laid: the best melding of the kept cards, the entries, the extended melds. */
const layoffMeldingFrom = (
  hand: Cards,
  knockerMelds: ReadonlyArray<Meld>,
  laidOff: ReadonlyArray<LayoffEntry>,
): LayoffMelding => {
  const laidIds = new Set(laidOff.map((e) => e.card.id));
  const m = bestMelding(hand.filter((c) => !laidIds.has(c.id)));
  return {
    melds: m.melds,
    laidOff,
    deadwood: m.deadwood,
    value: m.value,
    extendedMelds: extendedMelds(knockerMelds, laidOff),
  };
};

export {
  fitsOnto,
  maximalLayoff,
  bestMeldingWithLayoffs,
  extendedMelds,
  canTakeBack,
  layoffMeldingFrom,
};
