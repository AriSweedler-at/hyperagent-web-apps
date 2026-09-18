// Bid search (docs/MIGRATION.md step 8): typed from legacy/fidice/index.html lines 2222-2337
// (bundle section "// src/domain/search.ts"); behaviour and scores are unchanged,
// test/parity/fidice.legacy.test.ts is the oracle. `suggestHands` turns what a player types
// ("three 4s", "boat 6", "#215") into the legal bids that match, whole groups first.
import { GROUPS, HANDS, groupOf, handAt, isRank } from './hands.ts';
import type { Group, Hand, Rank, Suggestion } from './types.ts';

const NUMBER_WORDS: Readonly<Record<string, string>> = {
  one: '1',
  ones: '1',
  ace: '1',
  aces: '1',
  two: '2',
  twos: '2',
  deuce: '2',
  deuces: '2',
  three: '3',
  threes: '3',
  four: '4',
  fours: '4',
  five: '5',
  fives: '5',
  six: '6',
  sixes: '6',
};
const STOP_WORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'the',
  'of',
  'with',
  'kicker',
  'kickers',
]);

const tokenize = (text: string): ReadonlyArray<string> =>
  text
    .toLowerCase()
    .replace(/,/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => NUMBER_WORDS[w] ?? w)
    .map((w) => w.replace(/^(\d)s$/, '$1'))
    .filter((w) => !STOP_WORDS.has(w));

const p = (v: number): string => String(v);

const groupAliases = (g: Group): ReadonlyArray<string> => {
  const h = g.hands[0];
  const a = p(h.primary);
  const b = h.secondary === 0 ? '' : p(h.secondary);
  switch (g.cat) {
    case 'five':
      return [`five ${a}s`, `5 ${a}s`, a.repeat(5), `yahtzee ${a}`, `five of a kind ${a}`];
    case 'quads':
      return [`four ${a}s`, `4 ${a}s`, `quad ${a}s`, `quads ${a}`, a.repeat(4), `four of a kind ${a}`];
    case 'fullhouse':
      return [`${a}s full`, `${a}s over`, `${a} over`, `full house ${a}`, `${a}s full of`, `boat ${a}`];
    case 'straight':
      return h.primary === 6
        ? ['straight 2-6', 'high straight', '23456', 'straight']
        : ['straight 1-5', 'low straight', '12345', 'straight'];
    case 'trips':
      return [
        `three ${a}s`,
        `3 ${a}s`,
        `trip ${a}s`,
        `trips ${a}`,
        `set of ${a}s`,
        a.repeat(3),
        `three of a kind ${a}`,
      ];
    case 'twopair':
      return [
        `${a}s and ${b}s`,
        `${a} and ${b}`,
        `${a}s ${b}s`,
        `two pair ${a} ${b}`,
        `${a}${a}${b}${b}`,
        `${b}s and ${a}s`,
      ];
    case 'pair':
      return [`pair of ${a}s`, `pair ${a}`, `${a}s pair`, `one pair ${a}`, a.repeat(2), `two ${a}s`];
    case 'high':
      return [`high die ${a}`, `high ${a}`, 'nothing', 'bust'];
  }
};

const handAliases = (h: Hand): ReadonlyArray<string> => {
  const base = groupAliases(groupOf(h));
  const a = p(h.primary);
  const b = h.secondary === 0 ? '' : p(h.secondary);
  const k = h.kickers.join(' ');
  const kd = h.kickers.join('');
  const specific =
    h.cat === 'fullhouse'
      ? [`${a}s over ${b}s`, `${a} over ${b}`, `${a}s full of ${b}s`, `${a} full ${b}`, `${a}${a}${a}${b}${b}`]
      : h.cat === 'high'
        ? [
            [h.primary, ...h.kickers].join(' '),
            [h.primary, ...h.kickers].join('-'),
            [h.primary, ...h.kickers].join(''),
          ]
        : h.kickers.length
          ? base.flatMap((x) => [`${x} with ${k}`, `${x} ${k}`, `${x}${kd}`])
          : [];
  return [...specific, ...base];
};

const isSubsequence = (needle: string, hay: string): boolean =>
  Array.from(needle).reduce(
    (pos, ch) => (pos < 0 ? -1 : !hay.includes(ch, pos) ? -1 : hay.indexOf(ch, pos) + 1),
    0,
  ) >= 0;

type Scan = Readonly<{ score: number; ok: boolean; last: number; ordered: boolean }>;

/** 3 per exact token (in order), 2 per prefix, 1.5 per substring, 0.5 per subsequence; 0 on a miss. */
const scoreAlias = (queryTokens: ReadonlyArray<string>, alias: string): number => {
  const tokens = tokenize(alias);
  const joined = tokens.join(' ');
  const scan = queryTokens.reduce<Scan>(
    (acc, t) => {
      if (!acc.ok) return acc;
      const exactAfter = tokens.indexOf(t, acc.last + 1);
      const exact = exactAfter >= 0 ? exactAfter : tokens.indexOf(t);
      if (exact >= 0)
        return { ...acc, score: acc.score + 3, ordered: acc.ordered && exact > acc.last, last: exact };
      const prefix = tokens.findIndex((w) => w.startsWith(t));
      if (prefix >= 0)
        return {
          ...acc,
          score: acc.score + 2,
          ordered: acc.ordered && prefix > acc.last,
          last: prefix,
        };
      if (joined.includes(t)) return { ...acc, score: acc.score + 1.5 };
      if (isSubsequence(t, joined)) return { ...acc, score: acc.score + 0.5 };
      return { ...acc, ok: false };
    },
    { score: 0, ok: true, last: -1, ordered: true },
  );
  if (!scan.ok) return 0;
  const orderBonus = scan.ordered ? 2 : 0;
  const lengthBonus = Math.max(0, 2 - Math.abs(tokens.length - queryTokens.length)) * 0.3;
  return scan.score + orderBonus + lengthBonus;
};

const bestScore = (queryTokens: ReadonlyArray<string>, aliases: ReadonlyArray<string>): number =>
  Math.max(0, ...aliases.map((a) => scoreAlias(queryTokens, a)));

const topLegal = (g: Group, legal: ReadonlySet<Rank>): Rank | null =>
  g.hands.map((h) => h.rank).find((r) => legal.has(r)) ?? null;

const groupSuggestion = (g: Group, rank: Rank, score: number): Suggestion => ({
  group: true,
  label: g.name,
  rank,
  variants: g.hands.length,
  score,
});

const handSuggestion = (h: Hand, score: number): Suggestion => ({
  group: false,
  label: h.name,
  rank: h.rank,
  variants: 1,
  score,
});

/** A group with at least one legal rung, and its highest one. */
type LegalGroup = Readonly<{ g: Group; top: Rank }>;

const byScoreThenStrength = (a: Suggestion, b: Suggestion): number =>
  b.score - a.score || (a.group === b.group ? b.rank - a.rank : a.group ? -1 : 1);

const suggestHands = (
  query: string,
  above: Rank | null,
  limit = 14,
): ReadonlyArray<Suggestion> => {
  const legal = new Set(
    HANDS.filter((h) => above === null || h.rank > above).map((h) => h.rank),
  );
  const legalGroups = GROUPS.flatMap((g): ReadonlyArray<LegalGroup> => {
    const top = topLegal(g, legal);
    return top === null ? [] : [{ g, top }];
  });
  const q = query.trim();
  if (!q)
    return legalGroups
      .map(({ g, top }) => groupSuggestion(g, top, 0))
      .reverse()
      .slice(0, 40);
  const rung = /^#?\s*(\d{1,3})$/.exec(q);
  const rungRank = rung ? Number(rung[1]) - 1 : NaN;
  const byRung =
    isRank(rungRank) && legal.has(rungRank) ? [handSuggestion(handAt(rungRank), 100)] : [];
  const tokens = tokenize(q);
  if (tokens.length === 0) return byRung;
  const groups = legalGroups.flatMap(({ g, top }) => {
    const sc = bestScore(tokens, groupAliases(g));
    return sc > 0 ? [groupSuggestion(g, top, sc + 0.2)] : [];
  });
  const hands = HANDS.filter((h) => legal.has(h.rank) && groupOf(h).collapsible).flatMap((h) => {
    const sc = bestScore(tokens, handAliases(h));
    return sc > 0 ? [handSuggestion(h, sc)] : [];
  });
  return [...byRung, ...groups, ...hands].sort(byScoreThenStrength).slice(0, limit);
};

export {
  NUMBER_WORDS,
  STOP_WORDS,
  tokenize,
  p,
  groupAliases,
  handAliases,
  isSubsequence,
  scoreAlias,
  bestScore,
  topLegal,
  groupSuggestion,
  handSuggestion,
  byScoreThenStrength,
  suggestHands,
};
