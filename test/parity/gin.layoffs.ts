// Where the two gin engines may disagree on a layoff (docs/design/gin-arrangement-and-discards.md
// §7). The legacy attaches a card to the FIRST knocker meld it fits; the current engine follows
// every fit and keeps the layoff that takes the most cards. The legs can only differ when some card
// of the hand fits two melds at some point of the chain, and this predicate names that from the
// hand and the melds alone, over-approximating on purpose: a card fits a set whenever the set
// has room for its suit (a set never gains reach), and it fits a run whenever every rank between
// the run's end and the card is in the hand too (the chain the restart would lay off first). Both
// gin.melds.test.ts and gin.replay.ts relax exact equality to `current <= legacy` only here.
import type { Card } from './gin.api.ts';

const isSet = (m: ReadonlyArray<Card>): boolean => m.length >= 3 && m.every((c) => c.r === m[0]?.r);

const range = (from: number, to: number): ReadonlyArray<number> =>
  Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);

/** Whether `c` could join `m` now or after the hand's own cards have extended it that far. */
const reaches = (hand: ReadonlyArray<Card>, c: Card, m: ReadonlyArray<Card>): boolean => {
  const first = m[0];
  if (first === undefined) return false;
  if (isSet(m)) return m.length < 4 && c.r === first.r && !m.some((x) => x.s === c.s);
  if (c.s !== first.s) return false;
  const ranks = m.map((x) => x.r);
  const lo = Math.min(...ranks);
  const hi = Math.max(...ranks);
  const between = c.r > hi ? range(hi + 1, c.r) : c.r < lo ? range(c.r + 1, lo) : null;
  return between?.every((r) => hand.some((x) => x.r === r && x.s === c.s)) === true;
};

/** Some card of `hand` could be laid off onto two of `knockerMelds`: the legs may differ. */
export const multiFit = (
  hand: ReadonlyArray<Card>,
  knockerMelds: ReadonlyArray<ReadonlyArray<Card>>,
): boolean => hand.some((c) => knockerMelds.filter((m) => reaches(hand, c, m)).length >= 2);
