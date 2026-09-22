// What the player asks of the arrangement (docs/design/gin-arrangement-and-discards.md §5, the
// owner's 2026-09-21 additions): melds made by hand, and a sort order for the rest. A hand-made
// meld is a constraint the solver melds around: it stays a group while its cards are held and
// still form a meld, whatever the engine's own melding says, and the engine's `meldPref` (the
// chooser's declaration, dropped by the engine as soon as the hand changes) is mirrored here so a
// pick sticks across the moves that follow. A long press on a card asks for a meld with it:
// first a hand-made meld it can join, else the meld with it among the cards no hand-made meld
// holds that leaves the least deadwood, else nothing. A long press on a card in a hand-made meld
// dissolves that meld. Pure; imported by ui/state.ts, ui/render.ts and stories/catalogue.ts.
import { sortMeld } from '../../engine/cards.ts';
import { allMelds, isValidMeldGroup } from '../../engine/melds.ts';
import { bestMelding } from '../../engine/melds.algorithms.ts';
import { SUITS, type Card, type Cards, type Meld, type View } from '../../engine/index.ts';
import type { DrawStage } from './draw.ts';
import { engineOf, onTable, type Picture } from './picture.ts';

import type { SortMode } from '../../sort.ts';

/** The melds the player made by hand in hand number `hand`: card ids, each group a meld, no card in two. */
export type HumanMelds = Readonly<{ hand: number; groups: ReadonlyArray<ReadonlyArray<string>> }>;

const ids = (cards: Cards): ReadonlyArray<string> => cards.map((c) => c.id);
const has = (cards: Cards, id: string): boolean => cards.some((c) => c.id === id);

/**
 * The hand-made melds that still stand among `held`: a group keeps the cards still held and
 * dissolves once it is no longer a meld; another hand's melds are gone.
 */
export const standing = (
  human: HumanMelds | null,
  hand: number,
  held: Cards,
): ReadonlyArray<Meld> =>
  human?.hand !== hand
    ? []
    : human.groups
        .map((g) => held.filter((c) => g.includes(c.id)))
        .filter(isValidMeldGroup)
        .map(sortMeld);

const suitIndex = (c: Card): number => SUITS.indexOf(c.s);
const byRank = (c: Card): number => c.r * SUITS.length + suitIndex(c);
const bySuit = (c: Card): number => suitIndex(c) * 14 + c.r;
const lowest = (g: Cards, key: (c: Card) => number): number => Math.min(...g.map(key));

/** `p` in `sort` order: groups by their lowest card, the loose cards by the same key. */
export const sorted = (p: Picture, sort: SortMode): Picture => {
  if (sort === 'melds') return p;
  const key = sort === 'rank' ? byRank : bySuit;
  return {
    ...p,
    groups: [...p.groups].sort((a, b) => lowest(a, key) - lowest(b, key)),
    loose: [...p.loose].sort((a, b) => key(a) - key(b)),
  };
};

/**
 * The arrangement the player asked for over the on-table cards: the hand-made melds, then the
 * solver's melding of the other cards (the engine's own, honouring the chooser, when nothing is
 * hand-made), in `sort` order.
 */
export const arrangedOf = (
  v: View,
  stage: DrawStage | null,
  human: HumanMelds | null,
  sort: SortMode,
): Picture => {
  const table = onTable(v, stage);
  const mine = standing(human, v.handNumber, table);
  if (mine.length === 0) return sorted(engineOf(v, stage), sort);
  const taken = new Set(ids(mine.flat()));
  const rest = bestMelding(table.filter((c) => !taken.has(c.id)));
  return sorted(
    { groups: [...mine, ...rest.melds], loose: rest.deadwood, human: ids(mine.flat()) },
    sort,
  );
};

/** The deadwood `groups` leave in `hand`: what a knock would count if the engine declared them. */
const deadwoodLeft = (hand: Cards, groups: ReadonlyArray<Meld>): number => {
  const taken = new Set(ids(groups.flat()));
  return bestMelding(hand.filter((c) => !taken.has(c.id))).value;
};

/**
 * A long press on `cardId` in `hand`: the hand-made melds after it, or null when the card can
 * join no meld. In a hand-made meld: that meld dissolves. Else, a hand-made meld it extends
 * takes it. Else, among the melds with it in the cards no hand-made meld holds, the one that
 * leaves the least deadwood (the solver's order breaks ties) becomes a hand-made meld.
 */
export const toggleMeld = (
  human: HumanMelds | null,
  hand: number,
  held: Cards,
  cardId: string,
): HumanMelds | null => {
  const card = held.find((c) => c.id === cardId);
  if (card === undefined) return null;
  const mine = standing(human, hand, held);
  const own = mine.findIndex((g) => has(g, cardId));
  if (own >= 0) return { hand, groups: mine.filter((_, i) => i !== own).map(ids) };
  const extended = mine.findIndex((g) => isValidMeldGroup([...g, card]));
  if (extended >= 0)
    return {
      hand,
      groups: mine.map((g, i) => (i === extended ? ids(sortMeld([...g, card])) : ids(g))),
    };
  const taken = new Set(ids(mine.flat()));
  const free = held.filter((c) => !taken.has(c.id));
  const best = allMelds(free)
    .filter((m) => has(m, cardId))
    .reduce<Readonly<{ meld: Meld; left: number }> | null>((acc, meld) => {
      const left = deadwoodLeft(free, [meld]);
      return acc === null || left < acc.left ? { meld, left } : acc;
    }, null);
  return best === null ? null : { hand, groups: [...mine.map(ids), ids(sortMeld(best.meld))] };
};

/**
 * The groups to declare to the engine for `picture`, or null when declaring them would score
 * worse than the solver's best (the engine refuses that, and the knock counts the best anyway).
 */
export const declarable = (
  hand: Cards,
  picture: Picture,
): ReadonlyArray<ReadonlyArray<string>> | null =>
  deadwoodLeft(hand, picture.groups) === bestMelding(hand).value &&
  picture.groups.every((g) => isValidMeldGroup(g))
    ? picture.groups.map(ids)
    : null;
