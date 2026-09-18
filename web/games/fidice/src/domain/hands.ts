// The hand ladder (docs/MIGRATION.md step 8): typed from legacy/fidice/index.html lines 394-548
// (bundle section "// src/domain/hands.ts"); behaviour and the eager tables (HANDS, GROUPS,
// CATEGORY_INFO, BY_SHAPE, GROUP_BY_KEY) are unchanged, test/parity/fidice.legacy.test.ts and
// fidice.modules.test.ts are the oracle. Every multiset of five dice is classified, sorted and
// given a rank 0..251; groups collect the hands that share a spoken name.
import { DIE_VALUES, faceCounts, sortDesc } from './dice.ts';
import {
  HAND_COUNT,
  type Category,
  type CategoryInfo,
  type DieValue,
  type Group,
  type Hand,
  type NonEmpty,
  type Rank,
  type Shape,
} from './types.ts';

/**
 * The tables below are total over their keys by construction: HANDS has a row for every Rank
 * (it enumerates every five-dice multiset, and any five dice classify into one of them), and
 * GROUPS, GROUP_BY_KEY and CATEGORY_INFO are derived from HANDS, so a Hand's groupKey and every
 * category hit. The compiler cannot see that through an index or Map lookup; this is the one place
 * the type says so. It changes nothing at runtime: a miss would still fail on the next property
 * access, exactly as the legacy bundle did.
 */
const present = <T>(row: T | undefined): T => row as T;

const CATEGORIES: ReadonlyArray<Category> = [
  'high',
  'pair',
  'twopair',
  'trips',
  'straight',
  'fullhouse',
  'quads',
  'five',
];
const CATEGORIES_STRONGEST_FIRST: ReadonlyArray<Category> = [...CATEGORIES].reverse();
const CATEGORY_LABEL: Readonly<Record<Category, string>> = {
  five: 'Five of a kind',
  quads: 'Four of a kind',
  fullhouse: 'Full house',
  straight: 'Straight',
  trips: 'Three of a kind',
  twopair: 'Two pair',
  pair: 'One pair',
  high: 'High die',
};
const CATEGORY_BLURB: Readonly<Record<Category, string>> = {
  five: 'All five dice show the same number. The best you can do.',
  quads: 'Four dice match; the fifth die is the kicker.',
  fullhouse: 'Three of one number plus a pair of another.',
  straight: 'Five in a row: 2-3-4-5-6 beats 1-2-3-4-5.',
  trips: 'Three dice match; the other two are kickers.',
  twopair: 'Two different pairs; the odd die is the kicker.',
  pair: 'One pair; the other three dice are kickers.',
  high: 'Nothing matches and no straight. Only the die values count.',
};
/** HAND_COUNT - 1, spelled as the literal so the compiler can check it is a Rank. */
const TOP_RANK: Rank = 251;
const BOTTOM_RANK: Rank = 0;

const isRank = (n: unknown): n is Rank =>
  typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < HAND_COUNT;

/**
 * The checked constructor of a Rank. It throws: the bots clamp before calling it and the parity
 * oracle pins the RangeError, so this is the domain's other throwing path next to
 * result.ts `expect` (docs/MIGRATION.md "Deviations", step 8).
 */
const asRank = (n: number): Rank => {
  // eslint-disable-next-line functional/no-throw-statements -- legacy contract pinned by test/parity (see above)
  if (!isRank(n)) throw new RangeError(`Not a rank: ${String(n)}`);
  return n;
};

const rungOf = (rank: Rank): number => rank + 1;
const plural = (v: number): string => `${String(v)}s`;
const describeKickers = (k: ReadonlyArray<DieValue>): string =>
  k.length === 1 ? `a ${String(k[0])}` : k.join(', ');
const valuesWithCount = (
  counts: ReadonlyMap<DieValue, number>,
  n: number,
): ReadonlyArray<DieValue> => [...DIE_VALUES].reverse().filter((v) => counts.get(v) === n);

const classify = (dice: ReadonlyArray<DieValue>): Shape => {
  const counts = faceCounts(dice);
  const sorted = sortDesc(dice);
  const of = (n: number): ReadonlyArray<DieValue> => valuesWithCount(counts, n);
  const [five] = of(5);
  const [four] = of(4);
  const [three] = of(3);
  const pairs = of(2);
  const singles = of(1);
  if (five) return { cat: 'five', primary: five, secondary: 0, kickers: [] };
  if (four) return { cat: 'quads', primary: four, secondary: 0, kickers: singles };
  if (three && pairs[0])
    return { cat: 'fullhouse', primary: three, secondary: pairs[0], kickers: [] };
  if (three) return { cat: 'trips', primary: three, secondary: 0, kickers: singles };
  if (pairs.length === 2 && pairs[0] && pairs[1])
    return { cat: 'twopair', primary: pairs[0], secondary: pairs[1], kickers: singles };
  if (pairs[0]) return { cat: 'pair', primary: pairs[0], secondary: 0, kickers: singles };
  const joined = sorted.join('');
  const top = sorted[0] ?? 6;
  if (joined === '65432' || joined === '54321')
    return { cat: 'straight', primary: top, secondary: 0, kickers: [] };
  return { cat: 'high', primary: top, secondary: 0, kickers: sorted.slice(1) };
};

const compareShapes = (a: Shape, b: Shape): number => {
  const byCategory = CATEGORIES.indexOf(a.cat) - CATEGORIES.indexOf(b.cat);
  if (byCategory !== 0) return byCategory;
  if (a.primary !== b.primary) return a.primary - b.primary;
  if (a.secondary !== b.secondary) return a.secondary - b.secondary;
  const width = Math.max(a.kickers.length, b.kickers.length);
  return (
    Array.from({ length: width }, (_, i) => (a.kickers[i] ?? 0) - (b.kickers[i] ?? 0)).find(
      (d) => d !== 0,
    ) ?? 0
  );
};

const groupNameOf = (h: Shape): string => {
  switch (h.cat) {
    case 'five':
      return `Five ${plural(h.primary)}`;
    case 'quads':
      return `Four ${plural(h.primary)}`;
    case 'fullhouse':
      return `${plural(h.primary)} full`;
    case 'straight':
      return h.primary === 6 ? 'Straight 2–6' : 'Straight 1–5';
    case 'trips':
      return `Three ${plural(h.primary)}`;
    case 'twopair':
      return `${plural(h.primary)} and ${plural(h.secondary)}`;
    case 'pair':
      return `Pair of ${plural(h.primary)}`;
    case 'high':
      return `High die ${String(h.primary)}`;
  }
};

const handNameOf = (h: Shape): string => {
  if (h.cat === 'fullhouse') return `${plural(h.primary)} full of ${plural(h.secondary)}`;
  if (h.kickers.length === 0) return groupNameOf(h);
  if (h.cat === 'high') return `${groupNameOf(h)} (${[h.primary, ...h.kickers].join('-')})`;
  return `${groupNameOf(h)} with ${describeKickers(h.kickers)}`;
};

const variantNameOf = (h: Shape): string => {
  if (h.cat === 'fullhouse') return `of ${plural(h.secondary)}`;
  if (h.kickers.length === 0) return groupNameOf(h);
  if (h.cat === 'high') return [h.primary, ...h.kickers].join('-');
  return `with ${describeKickers(h.kickers)}`;
};

const groupKeyOf = (h: Shape): string =>
  `${h.cat}|${String(h.primary)}|${String(h.cat === 'fullhouse' ? 0 : h.secondary)}`;
const shapeKeyOf = (h: Shape): string =>
  `${h.cat}${String(h.primary)}${String(h.secondary)}${h.kickers.join('')}`;

/** Dice showing the primary face, per category; straights and high dice have none. */
const MATCHED: Readonly<Partial<Record<Category, number>>> = {
  five: 5,
  quads: 4,
  fullhouse: 3,
  trips: 3,
  twopair: 2,
  pair: 2,
};

const canonicalDice = (h: Shape): ReadonlyArray<DieValue> => {
  if (h.cat === 'straight') return h.primary === 6 ? [6, 5, 4, 3, 2] : [5, 4, 3, 2, 1];
  if (h.cat === 'high') return [h.primary, ...h.kickers];
  const core = Array.from({ length: MATCHED[h.cat] ?? 0 }, () => h.primary);
  // classify sets `secondary` for exactly these two categories; the `!== 0` only narrows the type.
  const pair: ReadonlyArray<DieValue> =
    (h.cat === 'fullhouse' || h.cat === 'twopair') && h.secondary !== 0
      ? [h.secondary, h.secondary]
      : [];
  return [...core, ...pair, ...h.kickers];
};

/** Every non-decreasing sequence of `size` faces at least `min`: the multisets of `size` dice. */
const multisets = (size: number, min: DieValue = 1): ReadonlyArray<ReadonlyArray<DieValue>> =>
  size === 0
    ? [[]]
    : DIE_VALUES.filter((v) => v >= min).flatMap((v) =>
        multisets(size - 1, v).map((rest) => [v, ...rest]),
      );

const buildHands = (): ReadonlyArray<Hand> =>
  multisets(5)
    .map(classify)
    .sort(compareShapes)
    .map((shape, rank) => ({
      ...shape,
      rank: asRank(rank),
      name: handNameOf(shape),
      group: groupNameOf(shape),
      variant: variantNameOf(shape),
      groupKey: groupKeyOf(shape),
      dice: canonicalDice(shape),
      catLabel: CATEGORY_LABEL[shape.cat],
    }));

const HANDS = buildHands();
const BY_SHAPE: ReadonlyMap<string, Hand> = new Map(HANDS.map((h) => [shapeKeyOf(h), h]));
const handAt = (rank: Rank): Hand => present(HANDS[rank]);
const rankOf = (dice: ReadonlyArray<DieValue>): Rank =>
  present(BY_SHAPE.get(shapeKeyOf(classify(dice)))).rank;

const buildGroups = (): ReadonlyArray<Group> => {
  const strongestFirst = [...HANDS].reverse();
  const byKey = strongestFirst.reduce<ReadonlyMap<string, NonEmpty<Hand>>>((m, h) => {
    const sofar = m.get(h.groupKey);
    const hands: NonEmpty<Hand> = sofar === undefined ? [h] : [...sofar, h];
    return new Map([...m, [h.groupKey, hands]]);
  }, new Map());
  return [...byKey.entries()].map(([key, hands]: readonly [string, NonEmpty<Hand>]) => {
    const top = hands[0];
    const bottom = present(hands[hands.length - 1]);
    return {
      key,
      cat: top.cat,
      name: top.group,
      hands,
      maxRank: top.rank,
      minRank: bottom.rank,
      collapsible: hands.length > 1,
    };
  });
};

const GROUPS = buildGroups();
const GROUP_BY_KEY: ReadonlyMap<string, Group> = new Map(GROUPS.map((g) => [g.key, g]));
const groupOf = (h: Hand): Group => present(GROUP_BY_KEY.get(h.groupKey));
const groupByKey = (key: string): Group | undefined => GROUP_BY_KEY.get(key);
const groupTop = (rank: Rank): Rank => groupOf(handAt(rank)).maxRank;

/** The group name at a collapsible group's top rung, the hand name everywhere else. */
const spokenName = (rank: Rank): string => {
  const hnd = handAt(rank);
  const g = groupOf(hnd);
  return g.collapsible && g.maxRank === rank ? g.name : hnd.name;
};

const CATEGORY_INFO: ReadonlyArray<CategoryInfo> = CATEGORIES_STRONGEST_FIRST.map((cat) => {
  const hands = HANDS.filter((h) => h.cat === cat);
  const weakest = present(hands[0]);
  const best = present(hands[hands.length - 1]);
  return {
    cat,
    label: CATEGORY_LABEL[cat],
    blurb: CATEGORY_BLURB[cat],
    hands,
    groups: GROUPS.filter((g) => g.cat === cat),
    minRank: weakest.rank,
    maxRank: best.rank,
    best,
  };
});

const inRange = (rank: Rank | null | undefined, lo: Rank, hi: Rank): boolean =>
  rank != null && rank >= lo && rank <= hi;

export {
  CATEGORIES,
  CATEGORIES_STRONGEST_FIRST,
  CATEGORY_LABEL,
  CATEGORY_BLURB,
  HAND_COUNT,
  TOP_RANK,
  BOTTOM_RANK,
  isRank,
  asRank,
  rungOf,
  plural,
  describeKickers,
  valuesWithCount,
  classify,
  compareShapes,
  groupNameOf,
  handNameOf,
  variantNameOf,
  groupKeyOf,
  shapeKeyOf,
  MATCHED,
  canonicalDice,
  multisets,
  buildHands,
  HANDS,
  BY_SHAPE,
  handAt,
  rankOf,
  buildGroups,
  GROUPS,
  GROUP_BY_KEY,
  groupOf,
  groupByKey,
  groupTop,
  spokenName,
  CATEGORY_INFO,
  inRange,
};
