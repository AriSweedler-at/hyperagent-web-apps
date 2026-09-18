// The bots' shared helpers (docs/MIGRATION.md step 8): typed from legacy/fidice/index.html lines
// 906-972 (bundle section "// src/bots/toolkit.ts"); behaviour is unchanged,
// test/parity/fidice.legacy.test.ts pins every strategy's decisions. Odds on the visible dice, bid
// shaping (`say` never claims more than a group's top rung), reroll planning and the dossier
// (`readSeat`) the strategies keep on the other chairs.
import type { Rng } from '../../../../shared/lib/rng.ts';
import { faceCounts } from '../domain/dice.ts';
import { seat } from '../domain/game.ts';
import {
  BOTTOM_RANK,
  TOP_RANK,
  asRank,
  groupOf,
  groupTop,
  handAt,
  rankOf,
} from '../domain/hands.ts';
import { publicCupIndices, publicTableIndices } from '../domain/publicState.ts';
import { expectedRank, probabilityAtLeast } from '../domain/probability.ts';
import type {
  Action,
  Bid,
  DieValue,
  PublicRound,
  PublicState,
  Rank,
  Round,
  RoundRecord,
  Seat,
} from '../domain/types.ts';
import type { BotView } from './types.ts';

export type RollAction = Extract<Action, Readonly<{ type: 'roll' }>>;

/** A reroll plan: the dice indices to keep, and what rerolling the rest is worth. */
export type KeepPlan = Readonly<{
  keep: ReadonlyArray<number>;
  expected: number;
  clears: number;
}>;

/** A chair's dossier from the round records: how it bids, calls and loses. */
export type SeatRead = Readonly<{
  bluffRate: number;
  calledBids: number;
  callRate: number;
  callAccuracy: number;
  calls: number;
  avgRaise: number;
  losses: number;
}>;

type FaceCount = readonly [DieValue, number];

const tableValues = (r: PublicRound): ReadonlyArray<DieValue> =>
  r.dice.flatMap((d) => (!d.inCup && d.value !== null ? [d.value] : []));
/** Every die shows a value to this viewer, so the round reads as the host's `Round`. */
const canSeeAll = (r: PublicRound): r is Round => r.dice.every((d) => d.value !== null);
const visibleRank = (r: PublicRound): Rank | null =>
  canSeeAll(r) ? rankOf(r.dice.map((d) => d.value)) : null;
const oddsAtLeast = (r: PublicRound, rank: Rank): number =>
  probabilityAtLeast(tableValues(r), publicCupIndices(r).length, rank);
const oddsBidTrue = (r: PublicRound): number => (r.bid === null ? 1 : oddsAtLeast(r, r.bid));
/** The lowest rank a bid may now name. */
const floorBid = (r: PublicRound): Rank =>
  r.bid === null ? BOTTOM_RANK : asRank(Math.min(TOP_RANK, r.bid + 1));
const clampRank = (n: number, floor: Rank): Rank =>
  asRank(Math.max(floor, Math.min(TOP_RANK, Math.round(n))));
/** The top rung of `real`'s group, or of the group below when `real` is not its group's top. */
const truthfulTop = (real: Rank): Rank | null => {
  const top = groupTop(real);
  if (top === real) return top;
  const below = groupOf(handAt(real)).minRank - 1;
  return below < BOTTOM_RANK ? null : groupTop(asRank(below));
};
/** Turn a wished-for rank into a sayable bid at or above `floor`, honest when the hand allows. */
const say = (raw: number, real: Rank, floor: Rank): Rank => {
  const wanted = clampRank(raw, floor);
  const honest = wanted <= real ? truthfulTop(wanted) : null;
  return honest !== null && honest >= floor ? honest : groupTop(wanted);
};
/** The most frequent visible face when it shows at least twice; ties go to the higher face. */
const keepFace = (r: PublicRound): DieValue | null => {
  const counts = faceCounts(r.dice.flatMap((d) => (d.value === null ? [] : [d.value])));
  const [best] = [...counts.entries()].sort(
    ([va, ca]: FaceCount, [vb, cb]: FaceCount) => cb - ca || vb - va,
  );
  return best !== undefined && best[1] >= 2 ? best[0] : null;
};
/** Every subset of 0..n-1 as an index list, in bit-mask order. */
const subsets = (n: number): ReadonlyArray<ReadonlyArray<number>> =>
  Array.from({ length: 2 ** n }, (_, mask) =>
    Array.from({ length: n }, (_2, i) => i).filter((i) => ((mask >> i) & 1) === 1),
  );
/** The keep set that most often clears `floor` after a reroll, expected rank breaking ties. */
const bestKeep = (r: PublicRound, floor: Rank): KeepPlan | null => {
  if (!canSeeAll(r)) return null;
  const values = r.dice.map((d) => d.value);
  const plans = subsets(values.length).map((keep): KeepPlan => {
    // `keep` indexes `values` by construction; the branch only narrows the type.
    const kept = keep.flatMap((i) => {
      const v = values[i];
      return v === undefined ? [] : [v];
    });
    return {
      keep,
      expected: expectedRank(kept, values.length - keep.length),
      clears: probabilityAtLeast(kept, values.length - keep.length, floor),
    };
  });
  return plans.reduce((best, p) =>
    p.clears > best.clears + 1e-9 ||
    (Math.abs(p.clears - best.clears) <= 1e-9 && p.expected > best.expected)
      ? p
      : best,
  );
};
/** The pulls and the roll that realise a keep plan from the round's current cup and table. */
const rollFor = (
  r: PublicRound,
  plan: Readonly<{ keep: ReadonlyArray<number> }>,
): Readonly<{ pulls: ReadonlyArray<number>; roll: RollAction | null }> => {
  const keep = new Set(plan.keep);
  const pulls = publicCupIndices(r).filter((i) => keep.has(i));
  const tucks = publicTableIndices(r).filter((i) => !keep.has(i));
  const cupLeft = publicCupIndices(r).filter((i) => !keep.has(i));
  const roll: RollAction | null =
    cupLeft.length + tucks.length === 0
      ? null
      : { type: 'roll', cup: cupLeft.length > 0, table: [], intoCup: tucks };
  return { pulls, roll };
};
/** The chairs after `from` that still have lives, in turn order. */
const seatsAfter = (s: PublicState, from: Seat): ReadonlyArray<Seat> => {
  const n = s.players.length;
  return Array.from({ length: n - 1 }, (_, k) => seat((from + k + 1) % n)).filter(
    (i) => (s.players[i]?.lives ?? 0) > 0,
  );
};
const nextSeat = (view: BotView): Seat => seatsAfter(view.state, view.me)[0] ?? view.me;
/** A chair's lives; in a scored game (lives 0) every chair reads as three. */
const livesOf = (s: PublicState, i: Seat): number =>
  s.lives === 0 ? 3 : (s.players[i]?.lives ?? 0);
/** The size of every raise `who` made among one round's bids; `null` names no chair. */
const raisesBy = (bids: ReadonlyArray<Bid>, who: Seat | null): ReadonlyArray<number> =>
  bids.flatMap((b, i) => {
    const prev = bids[i - 1];
    return b.seat === who && i > 0 && prev !== undefined ? [b.rank - prev.rank] : [];
  });
const mean = (xs: ReadonlyArray<number>, fallback: number): number =>
  xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : fallback;
/** The dossier on `who`; with no evidence every rate is its prior. `null` reads as an empty one. */
const readSeat = (records: ReadonlyArray<RoundRecord>, who: Seat | null): SeatRead => {
  const theirCalledBids = records.filter((r) => r.bidder === who);
  const theirCalls = records.filter((r) => r.caller === who);
  const received = records.flatMap((r): ReadonlyArray<'raised' | 'called'> => [
    ...r.bids
      .slice(1)
      .filter((b) => b.seat === who)
      .map(() => 'raised' as const),
    ...(r.caller === who ? ['called' as const] : []),
  ]);
  return {
    bluffRate: mean(
      theirCalledBids.map((r) => (r.holds ? 0 : 1)),
      0.4,
    ),
    calledBids: theirCalledBids.length,
    callRate: mean(
      received.map((x) => (x === 'called' ? 1 : 0)),
      0.3,
    ),
    callAccuracy: mean(
      theirCalls.map((r) => (r.holds ? 0 : 1)),
      0.5,
    ),
    calls: theirCalls.length,
    avgRaise: mean(
      records.flatMap((r) => raisesBy(r.bids, who)),
      4,
    ),
    losses: records.filter((r) => r.loser === who).length,
  };
};
/** A uniform draw in [-w, w). */
const jitter = (rng: Rng, w: number): number => (rng() - 0.5) * 2 * w;

export {
  tableValues,
  canSeeAll,
  visibleRank,
  oddsAtLeast,
  oddsBidTrue,
  floorBid,
  clampRank,
  truthfulTop,
  say,
  keepFace,
  subsets,
  bestKeep,
  rollFor,
  seatsAfter,
  nextSeat,
  livesOf,
  raisesBy,
  mean,
  readSeat,
  jitter,
};
