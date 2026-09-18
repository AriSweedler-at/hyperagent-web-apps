// The learners (docs/MIGRATION.md step 8): typed from legacy/fidice/index.html lines 1656-1759
// (bundle section "// src/bots/strategies/learner.ts"); behaviour is unchanged,
// test/parity/fidice.legacy.test.ts pins each generation's decisions. Three linear scorers
// (receive, roll, bid) over hand-picked features, with weights evolved offline
// (learnerWeights.ts); `learnerWith` builds one strategy per checkpoint.
import { BOTTOM_RANK, GROUPS, TOP_RANK, groupTop } from '../../domain/hands.ts';
import { publicCupIndices } from '../../domain/publicState.ts';
import type { PublicRound, Rank } from '../../domain/types.ts';
import {
  bestKeep,
  floorBid,
  livesOf,
  nextSeat,
  oddsAtLeast,
  oddsBidTrue,
  readSeat,
  rollFor,
  visibleRank,
} from '../toolkit.ts';
import type { BotView, Decision, Strategy } from '../types.ts';

type Weights = ReadonlyArray<number>;
type Stage = 'bid' | 'pull' | 'roll';
export type LearnerPlan = Readonly<{ turn: string; stage: Stage; pulls: ReadonlyArray<number> }>;
export type LearnerMemory = LearnerPlan | null;
/** One weight vector cut into the three scorers' slices. */
type Slices = Readonly<{ receive: Weights; roll: Weights; bid: Weights }>;
type ScoredBid = Readonly<{ cand: Rank; score: number }>;

const RECEIVE_FEATURES = 11;
const ROLL_FEATURES = 7;
const BID_FEATURES = 10;
const WEIGHT_COUNT = RECEIVE_FEATURES + ROLL_FEATURES + BID_FEATURES;
const dot = (w: Weights, f: Weights): number => f.reduce((a, x, i) => a + x * (w[i] ?? 0), 0);
const clip = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const turnKey6 = (view: BotView): string =>
  `${String(view.state.roundNo)}:${String(view.state.round.history.length)}`;
/** The top rung of every group, strongest first: the bids a learner chooses among. */
const BID_LADDER: ReadonlyArray<Rank> = [...GROUPS].reverse().map((g) => g.maxRank);
const raiseSize = (r: PublicRound): number => {
  const prev = r.history[r.history.length - 2];
  return r.bid !== null && prev !== undefined ? r.bid - prev.rank : 0;
};
const receiveFeatures = (view: BotView, r: PublicRound): Weights => {
  const s = view.state;
  const bidder = r.bidder ?? view.me;
  const read = readSeat(s.records, bidder);
  return [
    1,
    oddsBidTrue(r),
    clip(raiseSize(r) / 50, 0, 2),
    r.history.length <= 1 ? 1 : 0,
    read.bluffRate,
    read.calledBids > 0 ? 1 : 0,
    livesOf(s, view.me) / 3,
    livesOf(s, bidder) / 3,
    oddsAtLeast(r, floorBid(r)),
    readSeat(s.records, nextSeat(view)).callRate,
    (r.bid ?? 0) / TOP_RANK,
  ];
};
const rollFeatures = (
  view: BotView,
  r: PublicRound,
  real: Rank,
  floor: Rank,
  clears: number,
  expected: number,
): Weights => [
  1,
  real >= floor ? 1 : 0,
  clip((real - floor) / 50, -2, 2),
  clears,
  (expected - real) / TOP_RANK,
  publicCupIndices(r).length / 5,
  livesOf(view.state, view.me) / 3,
];
const bidFeatures = (
  view: BotView,
  r: PublicRound,
  real: Rank,
  floor: Rank,
  cand: Rank,
): Weights => {
  const honestTop = groupTop(real);
  const honest = honestTop >= cand;
  const next = nextSeat(view);
  const plausible = oddsAtLeast(r, cand);
  const nextCalls = readSeat(view.state.records, next).callRate;
  return [
    1,
    honest ? 1 : 0,
    clip((cand - floor) / 50, 0, 5),
    plausible,
    honest ? clip((honestTop - cand) / 50, 0, 5) : 0,
    honest ? 0 : clip((cand - honestTop) / 50, 0, 5),
    nextCalls,
    livesOf(view.state, next) / 3,
    cand >= TOP_RANK ? 1 : 0,
    plausible * nextCalls,
  ];
};
const slices = (w: Weights): Slices => ({
  receive: w.slice(0, RECEIVE_FEATURES),
  roll: w.slice(RECEIVE_FEATURES, RECEIVE_FEATURES + ROLL_FEATURES),
  bid: w.slice(RECEIVE_FEATURES + ROLL_FEATURES, WEIGHT_COUNT),
});
const chooseBid3 = (view: BotView, r: PublicRound, real: Rank, floor: Rank, w: Weights): Rank => {
  const legal = BID_LADDER.filter((c) => c >= floor);
  const scored = legal.map((cand): ScoredBid => ({
    cand,
    score: dot(w, bidFeatures(view, r, real, floor, cand)),
  }));
  return scored.reduce((best, x) => (x.score > best.score ? x : best)).cand;
};
const learnerWith = (
  id: string,
  name: string,
  blurb: string,
  weights: Weights,
): Strategy<LearnerMemory> => {
  const w = slices(weights);
  return {
    id,
    name,
    blurb,
    fresh: () => null,
    decide: (view, memory, rng): Decision<LearnerMemory> => {
      const r = view.state.round;
      if (r.bid !== null && !r.touched) {
        const call = r.bid >= TOP_RANK || dot(w.receive, receiveFeatures(view, r)) > 0;
        return {
          step: { delay: 1300 + rng() * 600, action: call ? { type: 'call' } : { type: 'peek' } },
          memory: null,
        };
      }
      const real = visibleRank(r) ?? BOTTOM_RANK;
      const floor = floorBid(r);
      const turn = turnKey6(view);
      const freshPlan = (): LearnerPlan => {
        const best = r.rolled ? null : bestKeep(r, floor);
        if (best === null) return { turn, stage: 'bid', pulls: [] };
        const wantsRoll =
          best.keep.length < r.dice.length &&
          dot(w.roll, rollFeatures(view, r, real, floor, best.clears, best.expected)) > 0;
        if (!wantsRoll) return { turn, stage: 'bid', pulls: [] };
        const { pulls } = rollFor(r, best);
        return { turn, stage: pulls.length > 0 ? 'pull' : 'roll', pulls };
      };
      const plan = memory?.turn === turn ? memory : freshPlan();
      const [next, ...rest] = plan.pulls;
      if (plan.stage === 'pull' && next !== undefined && r.dice[next]?.inCup) {
        return {
          step: { delay: 800, action: { type: 'pull', die: next } },
          memory: { ...plan, stage: rest.length > 0 ? 'pull' : 'roll', pulls: rest },
        };
      }
      if (plan.stage === 'roll' && !r.rolled) {
        const best = bestKeep(r, floor);
        const roll = best !== null ? rollFor(r, best).roll : null;
        if (roll !== null)
          return { step: { delay: 1000, action: roll }, memory: { ...plan, stage: 'bid' } };
      }
      return {
        step: {
          delay: 1400 + rng() * 600,
          action: { type: 'bid', rank: chooseBid3(view, r, real, floor, w.bid) },
        },
        memory: { ...plan, stage: 'bid' },
      };
    },
  };
};

export {
  RECEIVE_FEATURES,
  ROLL_FEATURES,
  BID_FEATURES,
  WEIGHT_COUNT,
  dot,
  clip,
  turnKey6,
  BID_LADDER,
  raiseSize,
  receiveFeatures,
  rollFeatures,
  bidFeatures,
  slices,
  chooseBid3,
  learnerWith,
};
