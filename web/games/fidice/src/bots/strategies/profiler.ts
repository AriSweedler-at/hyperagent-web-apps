// The Reader (docs/MIGRATION.md step 8): typed from legacy/fidice/index.html lines 1038-1153
// (bundle section "// src/bots/strategies/profiler.ts"); behaviour is unchanged,
// test/parity/fidice.legacy.test.ts pins its decisions. It keeps a dossier on every chair from the
// round records (bluffiness, call hunger, sharpness) and bids into what the next chair will swallow.
import type { Rng } from '../../../../../shared/lib/rng.ts';
import { BOTTOM_RANK, TOP_RANK, asRank } from '../../domain/hands.ts';
import { probabilityAtLeast } from '../../domain/probability.ts';
import { publicCupIndices, publicTableIndices } from '../../domain/publicState.ts';
import type { Action, PublicRound, Rank, RoundRecord, Seat } from '../../domain/types.ts';
import {
  bestKeep,
  floorBid,
  jitter,
  livesOf,
  nextSeat,
  oddsAtLeast,
  oddsBidTrue,
  readSeat,
  rollFor,
  say,
  visibleRank,
} from '../toolkit.ts';
import { hasBid, type BidRound, type BotView, type Decision, type Strategy } from '../types.ts';

type Stage = 'bid' | 'pull' | 'roll';
/** The plan for the current turn plus `dial`, the mood (0 timid .. 1 bold) drawn once per turn. */
export type ProfilerPlan = Readonly<{
  turn: string;
  stage: Stage;
  toPull: ReadonlyArray<number>;
  keep: ReadonlyArray<number>;
  dial: number;
}>;
export type ProfilerMemory = ProfilerPlan | null;
/** A chair's dossier, priors blended with the evidence in the records. */
export type Profile = Readonly<{
  bluffiness: number;
  callHunger: number;
  sharpness: number;
  boldness: number;
  lieSize: number;
  samples: number;
}>;

const LIE_WEIGHT = 0.5;
const PRIOR = { bluff: 0.4, call: 0.33, sharp: 0.4, raise: 30, lie: 26 } as const;
const WEIGHT = { bluff: 2.2, call: 2.6, sharp: 2, raise: 3 } as const;
const CORNER = { base: 0.2, tight: 0.55, hungry: 0.3, easy: 0.11 } as const;
const LINE = { base: 0.15, hunger: 0.62, sharp: 0.06 } as const;
const CREDIT = { base: 0.42, slope: 1.35 } as const;
const TIMID = { evidence: 6, hunger: 0.22 } as const;
const HOLD_BACK = 20;
const CONTENT_GAP = 60;
const CONTENT_WHIM = 0.15;
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const blend = (v: number, prior: number, n: number, k: number): number =>
  (v * n + prior * k) / (n + k);
/** How many bids `s` has received (raises on it plus calls it made). */
const receivedBy = (records: ReadonlyArray<RoundRecord>, s: Seat): number =>
  records.reduce(
    (n, r) => n + r.bids.slice(1).filter((b) => b.seat === s).length + (r.caller === s ? 1 : 0),
    0,
  );
const meanOr = (xs: ReadonlyArray<number>, fallback: number): number =>
  xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : fallback;
const profileOf = (records: ReadonlyArray<RoundRecord>, s: Seat): Profile => {
  const base = readSeat(records, s);
  const received = receivedBy(records, s);
  const busted = records.filter((r) => r.bidder === s && !r.holds);
  return {
    bluffiness: clamp(
      blend(base.bluffRate, PRIOR.bluff, base.calledBids, WEIGHT.bluff),
      0.03,
      0.97,
    ),
    callHunger: clamp(blend(base.callRate, PRIOR.call, received, WEIGHT.call), 0.03, 0.95),
    sharpness: clamp(blend(base.callAccuracy, PRIOR.sharp, base.calls, WEIGHT.sharp), 0.05, 0.95),
    boldness: clamp(blend(base.avgRaise, PRIOR.raise, received, WEIGHT.raise) / 70, 0, 1),
    lieSize: meanOr(
      busted.map((r) => r.bid - r.real),
      PRIOR.lie,
    ),
    samples: base.calledBids + base.calls,
  };
};
/** Whether each of my called bids held, oldest first. */
const myVerdicts = (records: ReadonlyArray<RoundRecord>, me: Seat): ReadonlyArray<boolean> =>
  records.filter((r) => r.bidder === me).map((r) => r.holds);
const inPenance = (verdicts: ReadonlyArray<boolean>): boolean => verdicts.slice(-2).includes(false);
/** Consecutive held bids since my last bust. */
const creditOf = (verdicts: ReadonlyArray<boolean>): number =>
  verdicts.reduce((n, held) => (held ? n + 1 : 0), 0);
const holdChance = (odds: number, bluffiness: number): number =>
  odds <= 0 ? 0 : odds / (odds + LIE_WEIGHT * bluffiness * (1 - odds));
const callLineOf = (them: Profile, myBluffRep: number): number => {
  const appetite = LINE.base + LINE.hunger * them.callHunger - LINE.sharp * them.sharpness;
  return clamp(appetite * clamp(CREDIT.base + CREDIT.slope * myBluffRep, 0.34, 1.15), 0.055, 0.7);
};
/** The highest rank at or above `floor` the table still gives odds `minOdds` of holding. */
const topRungAbove = (r: PublicRound, floor: Rank, minOdds: number): Rank => {
  const rungs = Array.from({ length: TOP_RANK - floor + 1 }, (_, k) => asRank(floor + k));
  const believable = rungs.filter((t) => oddsAtLeast(r, t) >= minOdds);
  return believable[believable.length - 1] ?? floor;
};
const receiveBid = (view: BotView, r: BidRound, dial: number, rng: Rng): Action => {
  if (r.bid >= TOP_RANK) return { type: 'call' };
  const state = view.state;
  const bidder = r.bidder ?? view.me;
  const hold = holdChance(oddsBidTrue(r), profileOf(state.records, bidder).bluffiness);
  const air = probabilityAtLeast([], 5, floorBid(r));
  const heir = profileOf(state.records, nextSeat(view));
  const cornered = clamp(
    CORNER.base + CORNER.tight * (1 - air) + CORNER.hungry * heir.callHunger,
    0,
    1,
  );
  const risk = (1 - air) * cornered + air * CORNER.easy;
  const lifeAdj =
    (livesOf(state, view.me) <= 1 ? 0.86 : 1) * (livesOf(state, bidder) <= 1 ? 1.22 : 1);
  const mood = inPenance(myVerdicts(state.records, view.me)) ? 1.12 : 1;
  const line = risk * lifeAdj * mood * (0.88 + 0.3 * dial) + jitter(rng, 0.045);
  return hold < line ? { type: 'call' } : { type: 'peek' };
};
const aimAt = (view: BotView, r: PublicRound, real: Rank, dial: number, rng: Rng): Rank => {
  const floor = floorBid(r);
  const records = view.state.records;
  const verdicts = myVerdicts(records, view.me);
  const heir = profileOf(records, nextSeat(view));
  const myRep = profileOf(records, view.me).bluffiness;
  const penance = inPenance(verdicts);
  if (real >= floor) {
    const line2 = clamp(callLineOf(heir, myRep) - 0.1 * creditOf(verdicts), 0.12, 0.9);
    const ceiling = topRungAbove(r, floor, line2);
    const timid = !penance && heir.samples >= TIMID.evidence && heir.callHunger < TIMID.hunger;
    const push = timid && dial > 0.22 && ceiling > real ? ceiling : real;
    return say(push - Math.round(Math.max(0, jitter(rng, 3))), real, floor);
  }
  const bare = oddsAtLeast(r, floor);
  const line = callLineOf(heir, myRep);
  if (penance || bare >= line) return say(floor, real, floor);
  const roof = clamp(TOP_RANK - HOLD_BACK, floor, TOP_RANK - 1);
  return say(clamp(floor + (roof - floor) * (0.35 + 0.6 * dial), floor, roof), real, floor);
};
const turnKey2 = (view: BotView): string =>
  `${String(view.state.roundNo)}:${String(view.state.round.history.length)}:${String(view.me)}`;
const planTurn2 = (
  r: PublicRound,
  real: Rank,
  dial: number,
  rng: Rng,
): Omit<ProfilerPlan, 'turn' | 'dial'> => {
  const floor = floorBid(r);
  const content = real >= floor && (real >= floor + CONTENT_GAP || rng() < CONTENT_WHIM * dial);
  if (content) return { stage: 'bid', toPull: [], keep: [] };
  const best = bestKeep(r, floor);
  if (best === null || best.keep.length === r.dice.length)
    return { stage: 'bid', toPull: [], keep: [] };
  const { pulls } = rollFor(r, best);
  return {
    stage: pulls.length > 0 ? 'pull' : 'roll',
    toPull: pulls,
    keep: publicTableIndices(r).filter((i) => best.keep.includes(i)),
  };
};
const shake = (r: PublicRound, keep: ReadonlyArray<number>): Action => ({
  type: 'roll',
  cup: true,
  table: [],
  intoCup: publicTableIndices(r).filter((i) => !keep.includes(i)),
});
const canShake = (r: PublicRound, keep: ReadonlyArray<number>): boolean =>
  publicCupIndices(r).length > 0 || publicTableIndices(r).some((i) => !keep.includes(i));
const profiler: Strategy<ProfilerMemory> = {
  id: 'profiler',
  name: 'The Reader',
  blurb:
    'Keeps a dossier on every chair — calls the known liars thin, and leans on whoever flinches.',
  fresh: () => null,
  decide: (view, memory, rng): Decision<ProfilerMemory> => {
    const r = view.state.round;
    const turn = turnKey2(view);
    const carried = memory?.turn === turn ? memory : null;
    const dial = carried ? carried.dial : clamp((memory?.dial ?? rng()) + jitter(rng, 0.28), 0, 1);
    if (hasBid(r) && !r.touched) {
      const action = receiveBid(view, r, dial, rng);
      return {
        step: { delay: 1300 + rng() * 700, action },
        memory: { turn: '', stage: 'bid', toPull: [], keep: [], dial },
      };
    }
    const real = visibleRank(r) ?? BOTTOM_RANK;
    const plan: ProfilerPlan = carried ?? { turn, dial, ...planTurn2(r, real, dial, rng) };
    const [next, ...rest] = plan.toPull;
    if (plan.stage === 'pull' && next !== undefined) {
      const stage = rest.length > 0 ? 'pull' : 'roll';
      return {
        step: { delay: 800, action: { type: 'pull', die: next } },
        memory: { ...plan, stage, toPull: rest, keep: [...plan.keep, next] },
      };
    }
    if (plan.stage !== 'bid' && !r.rolled && canShake(r, plan.keep)) {
      return {
        step: { delay: 1000, action: shake(r, plan.keep) },
        memory: { ...plan, stage: 'bid', toPull: [] },
      };
    }
    return {
      step: {
        delay: 1400 + rng() * 800,
        action: { type: 'bid', rank: aimAt(view, r, real, dial, rng) },
      },
      memory: { ...plan, stage: 'bid', toPull: [] },
    };
  },
};

export {
  LIE_WEIGHT,
  PRIOR,
  WEIGHT,
  CORNER,
  LINE,
  CREDIT,
  TIMID,
  HOLD_BACK,
  CONTENT_GAP,
  CONTENT_WHIM,
  clamp,
  blend,
  receivedBy,
  meanOr,
  profileOf,
  myVerdicts,
  inPenance,
  creditOf,
  holdChance,
  callLineOf,
  topRungAbove,
  receiveBid,
  aimAt,
  turnKey2,
  planTurn2,
  shake,
  canShake,
  profiler,
};
