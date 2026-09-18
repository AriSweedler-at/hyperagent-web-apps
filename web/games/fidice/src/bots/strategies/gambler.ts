// The Gambler (docs/MIGRATION.md step 8): typed from legacy/fidice/index.html lines 1279-1519
// (bundle section "// src/bots/strategies/gambler.ts"); behaviour is unchanged,
// test/parity/fidice.legacy.test.ts pins its decisions. The tournament winner: it prices every
// life by the score, models the chair on its left as a listener with a call bar and a taste for
// raise sizes, and picks the bid, the reroll and the call by expected value.
import type { Rng } from '../../../../../shared/lib/rng.ts';
import { BOTTOM_RANK, GROUPS, TOP_RANK, asRank } from '../../domain/hands.ts';
import { publicCupIndices, publicTableIndices } from '../../domain/publicState.ts';
import type { DieValue, PublicRound, PublicState, Rank, Seat } from '../../domain/types.ts';
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
  type RollAction,
  type SeatRead,
} from '../toolkit.ts';
import type { BotView, Decision, Strategy } from '../types.ts';

type Stage = 'bidding' | 'pulling' | 'rolling';
/** The turn plan plus running counts of my own bids and calls, for `appetiteOf`. */
export type GamblerMemory = Readonly<{
  turn: string;
  stage: Stage;
  toPull: ReadonlyArray<number>;
  toTuck: ReadonlyArray<number>;
  bids: number;
  bluffs: number;
  raises: number;
  minRaises: number;
  received: number;
  calls: number;
}>;
/** The next chair as a listener: the odds below which it calls, and the raise size it likes. */
export type Listener = Readonly<{ bar: number; taste: number; tasteWeight: number }>;
export type Stakes = Readonly<{
  alive: number;
  myCost: number;
  gainNext: number;
  next: Listener;
}>;
export type Appetite = Readonly<{ bluff: number; minPenalty: number }>;
type ScoredBid = Readonly<{ c: Rank; v: number }>;
export type CupPlan = Readonly<{
  pull: ReadonlyArray<number>;
  tuck: ReadonlyArray<number>;
  shake: boolean;
  worth: number;
}>;

const freshMemory = (): GamblerMemory => ({
  turn: '',
  stage: 'bidding',
  toPull: [],
  toTuck: [],
  bids: 0,
  bluffs: 0,
  raises: 0,
  minRaises: 0,
  received: 0,
  calls: 0,
});
const turnKey4 = (view: BotView): string =>
  `${String(view.state.roundNo)}:${String(view.state.round.history.length)}:${String(view.me)}`;
const clamp2 = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const share = (n: number, d: number, fallback: number): number => (d > 0 ? n / d : fallback);
const valueAt2 = (r: PublicRound, i: number): DieValue | null => r.dice[i]?.value ?? null;
/** The top rung of every group, weakest first: the bids worth saying. */
const GROUP_TOPS: ReadonlyArray<Rank> = [...GROUPS].map((g) => g.maxRank).sort((a, b) => a - b);
const sayableFrom = (floor: Rank): ReadonlyArray<Rank> => GROUP_TOPS.filter((c) => c >= floor);
/** The size of the raise `who` called in each round it called; -1 when it called an opening bid. */
const calledRaises = (s: PublicState, who: Seat): ReadonlyArray<number> =>
  s.records.flatMap((rec) => {
    if (rec.caller !== who) return [];
    const prev = rec.bids[rec.bids.length - 2];
    return [prev !== undefined ? rec.bid - prev.rank : -1];
  });
const listenerAt = (s: PublicState, who: Seat): Listener => {
  const read = readSeat(s.records, who);
  const observed = 0.34 + 0.95 * (read.callRate - 0.3);
  const punished = read.calls >= 2 ? 0.14 * (read.callAccuracy - 0.5) : 0;
  const desperate = livesOf(s, who) <= 1 ? -0.05 : 0;
  const raises = calledRaises(s, who).filter((x) => x >= 0);
  return {
    bar: clamp2(observed + punished + desperate, 0.12, 0.72),
    taste: raises.length > 0 ? raises.reduce((a, b) => a + b, 0) / raises.length : 22,
    tasteWeight: Math.min(0.35, 0.12 * raises.length),
  };
};
/** How likely `l` is to call a bid with odds `q` reached by a raise of `raise`. */
const callChance = (l: Listener, q: number, raise: number, maxed: boolean): number => {
  if (maxed) return 1;
  const byOdds = 0.05 + 0.85 / (1 + Math.exp((q - l.bar) / 0.085));
  const byShape = 0.06 + 0.8 * Math.exp(-(((raise - l.taste) / 17) ** 2));
  return clamp2((1 - l.tasteWeight) * byOdds + l.tasteWeight * byShape, 0.03, 1);
};
const lieLean = (read: SeatRead, lives: number): number =>
  clamp2(
    0.3 * (read.bluffRate - 0.4) +
      0.008 * (read.avgRaise - 4) +
      0.02 * Math.min(read.losses, 4) +
      (lives <= 1 ? 0.04 : 0),
    -0.12,
    0.18,
  );
const lastRaiseSize = (r: PublicRound): number => {
  const h = r.history;
  const prev = h[h.length - 2];
  return r.bid !== null && prev !== undefined ? r.bid - prev.rank : -1;
};
/** The chance the standing bid is honest, from its raise, height, odds and the bidder's lean. */
const honestyOdds = (raise: number, rank: number, q: number, lean: number): number => {
  const opened = raise < 0;
  const leap = opened ? 0.86 : 0.25 + 0.56 / (1 + Math.exp(-(raise - 22) / 9));
  const high = opened ? 0 : -0.06 * (rank / TOP_RANK);
  const cheap = Math.max(0, (q - 0.6) / 0.4);
  const base = clamp2(leap + high - lean, 0.05, 0.95);
  return base + (1 - base) * cheap;
};
const aliveCount = (s: PublicState): number => s.players.filter((p) => p.lives > 0).length;
const bestRival = (s: PublicState, me: Seat): number =>
  s.players.reduce((m, p, i) => (i === me ? m : Math.max(m, p.lives)), 0);
/** What losing a life costs me now, by my lead over the best rival. */
const lifeCost = (s: PublicState, me: Seat): number => {
  const mine = livesOf(s, me);
  const edge = mine - bestRival(s, me);
  const scared = mine <= 1 ? 0.18 : 0;
  return clamp2(1 + 0.16 * edge + scared, 0.72, 1.42);
};
/** What taking a life from `target` is worth to me. */
const lifeGain = (s: PublicState, target: Seat, me: Seat): number => {
  const theirs = livesOf(s, target);
  const leader = theirs >= bestRival(s, me) ? 0.22 : 0;
  const kill = theirs <= 1 ? 0.3 : 0;
  const spare = aliveCount(s) > 2 && livesOf(s, me) > theirs + 1 ? -0.14 : 0;
  return clamp2(1 + leader + kill + spare, 0.7, 1.6);
};
const stakesFor = (view: BotView): Stakes => {
  const s = view.state;
  const next = nextSeat(view);
  return {
    alive: aliveCount(s),
    myCost: lifeCost(s, view.me),
    gainNext: lifeGain(s, next, view.me),
    next: listenerAt(s, next),
  };
};
/** The chance of clearing `floor` given one more shake. */
const escapeChance = (r: PublicRound, floor: Rank): number => {
  const q = oddsAtLeast(r, floor);
  const shake = publicCupIndices(r).length > 0 || publicTableIndices(r).length > 0 ? q : 0;
  return 1 - (1 - q) * (1 - shake);
};
/** Corrections from my own record this game: bluff less when I have bluffed a lot, and so on. */
const appetiteOf = (mem: GamblerMemory, s: PublicState, me: Seat): Appetite => {
  const bluffShare = share(mem.bluffs, mem.bids, 0.3);
  const minShare = share(mem.minRaises, mem.raises, 0.2);
  const behind = livesOf(s, me) < bestRival(s, me) ? 0.06 : 0;
  return {
    bluff: clamp2(0.34 - bluffShare, -0.06, 0.16) + behind,
    minPenalty: clamp2(0.7 * (minShare - 0.22), 0, 0.14),
  };
};
const scoreBid = (
  r: PublicRound,
  real: Rank,
  c: Rank,
  st: Stakes,
  app: Appetite,
  floor: Rank,
  qFloor: number,
): number => {
  const honest = c <= real;
  if (!honest && c >= TOP_RANK) return -9;
  const q = oddsAtLeast(r, c);
  const raise = r.bid === null ? -1 : c - r.bid;
  const pCall = callChance(st.next, q, raise, c >= TOP_RANK);
  const immediate = honest ? pCall * st.gainNext : -pCall * st.myCost;
  const above = asRank(Math.min(TOP_RANK, c + 1));
  const squeeze = (1 - oddsAtLeast(r, above)) ** 2;
  const whoProfits = st.alive === 2 ? 0.5 * st.gainNext : 0.16;
  const follow = (1 - pCall) * squeeze * whoProfits;
  const quiet = honest ? 0 : 4 * (qFloor - q);
  const style = (honest ? 0 : app.bluff) - (c === floor ? app.minPenalty : 0);
  return immediate + follow + style - quiet;
};
const bestBid = (r: PublicRound, real: Rank, st: Stakes, app: Appetite, rng: Rng): Rank => {
  const floor = floorBid(r);
  const sayable = sayableFrom(floor);
  const plausible = sayable.filter((c, i) => c <= real || i < 26 || oddsAtLeast(r, c) > 0.04);
  const pool = plausible.length > 0 ? plausible : sayable.slice(0, 1);
  // `sayable` always holds TOP_RANK, so `pool` is never empty; the branch only narrows the type.
  const [first] = pool;
  const qFloor = first === undefined ? 0 : oddsAtLeast(r, first);
  const scored = pool.map((c): ScoredBid => ({
    c,
    v: scoreBid(r, real, c, st, app, floor, qFloor) + jitter(rng, 0.03),
  }));
  const pick = scored.reduce((a, b) => (b.v > a.v ? b : a));
  return say(pick.c, real, floor);
};
/** What holding `hand` and saying it is worth against the next chair. */
const handValue = (
  r: PublicRound,
  hand: Rank,
  q: number,
  floor: Rank,
  lieRisk: number,
  st: Stakes,
): number => {
  if (hand < floor) return -lieRisk * st.myCost;
  const raise = r.bid === null ? -1 : hand - r.bid;
  return callChance(st.next, q, raise, hand >= TOP_RANK) * st.gainNext;
};
const sayableUpTo = (real: Rank): Rank | null =>
  GROUP_TOPS.filter((c) => c <= real).slice(-1)[0] ?? null;
/** The expected value of a shake, over every group top the shaken dice may reach. */
const shakeValue = (r: PublicRound, floor: Rank, st: Stakes): number => {
  const surv = GROUP_TOPS.map((c) => oddsAtLeast(r, c));
  const lieRisk = callChance(st.next, oddsAtLeast(r, floor), 4, false);
  const bottom = (1 - (surv[0] ?? 0)) * handValue(r, BOTTOM_RANK, 1, floor, lieRisk, st);
  return GROUP_TOPS.reduce(
    (acc, c, i) =>
      acc +
      ((surv[i] ?? 0) - (surv[i + 1] ?? 0)) * handValue(r, c, surv[i] ?? 0, floor, lieRisk, st),
    bottom,
  );
};
/** The round as it would look with the dice at `idx` moved into or out of the cup. */
const moved = (r: PublicRound, idx: ReadonlyArray<number>, inCup: boolean): PublicRound => ({
  ...r,
  dice: r.dice.map((d, i) => (idx.includes(i) ? { ...d, inCup } : d)),
});
const keepers = (r: PublicRound, face: DieValue | null): ReadonlyArray<number> =>
  face === null ? [] : publicCupIndices(r).filter((i) => valueAt2(r, i) === face);
const junk = (r: PublicRound, face: DieValue | null): ReadonlyArray<number> =>
  [...publicTableIndices(r).filter((i) => valueAt2(r, i) !== face)]
    .sort((a, b) => (valueAt2(r, a) ?? 0) - (valueAt2(r, b) ?? 0))
    .slice(0, 2);
/** Standing pat, and (before the roll) the best shake, each with what it is worth. */
const cupPlans = (r: PublicRound, real: Rank, floor: Rank, st: Stakes): ReadonlyArray<CupPlan> => {
  // The bundle also computed `keepers` and `junk` of `keepFace(r)` here and never read them.
  const said = sayableUpTo(real);
  const lieRisk = callChance(st.next, oddsAtLeast(r, floor), 4, false);
  const stand: CupPlan = {
    pull: [],
    tuck: [],
    shake: false,
    worth:
      said === null || said < floor
        ? -lieRisk * st.myCost
        : handValue(r, said, oddsAtLeast(r, said), floor, lieRisk, st),
  };
  if (r.rolled) return [stand];
  const best = bestKeep(r, floor);
  if (best === null || best.keep.length === r.dice.length) return [stand];
  const { pulls } = rollFor(r, best);
  const tucks = publicTableIndices(r).filter((i) => !best.keep.includes(i));
  const shaken = moved(moved(r, pulls, false), tucks, true);
  return [stand, { pull: pulls, tuck: tucks, shake: true, worth: shakeValue(shaken, floor, st) }];
};
const rollAction = (r: PublicRound, tuck: ReadonlyArray<number>): RollAction => {
  const tucks = tuck.filter((i) => r.dice[i]?.inCup === false);
  if (publicCupIndices(r).length > 0 || tucks.length > 0)
    return { type: 'roll', cup: true, table: [], intoCup: tucks };
  return { type: 'roll', cup: false, table: publicTableIndices(r), intoCup: [] };
};
const planTurn4 = (
  r: PublicRound,
  real: Rank,
  st: Stakes,
  rng: Rng,
): Pick<GamblerMemory, 'stage' | 'toPull' | 'toTuck'> => {
  const floor = floorBid(r);
  const plans = cupPlans(r, real, floor, st);
  const best = plans.reduce((a, b) => (b.worth + jitter(rng, 0.01) > a.worth ? b : a));
  if (!best.shake) return { stage: 'bidding', toPull: [], toTuck: [] };
  return {
    stage: best.pull.length > 0 ? 'pulling' : 'rolling',
    toPull: best.pull,
    toTuck: best.tuck,
  };
};
/** Call (true) or accept the bid, by the expected value of each against a call habit correction. */
const callOrAccept = (view: BotView, r: PublicRound, mem: GamblerMemory, rng: Rng): boolean => {
  if (r.bid === null || r.bid >= TOP_RANK) return true;
  const s = view.state;
  const bidder = r.bidder ?? nextSeat(view);
  const st = stakesFor(view);
  const p = clamp2(
    honestyOdds(
      lastRaiseSize(r),
      r.bid,
      oddsBidTrue(r),
      lieLean(readSeat(s.records, bidder), livesOf(s, bidder)),
    ),
    0.03,
    0.97,
  );
  const evCall = (1 - p) * lifeGain(s, bidder, view.me) - p * st.myCost;
  const floor = floorBid(r);
  const escape = escapeChance(r, floor);
  const pCallNext = callChance(st.next, oddsAtLeast(r, floor), 12, false);
  const evAccept =
    escape * pCallNext * st.gainNext -
    (1 - escape) * pCallNext * st.myCost +
    (st.alive > 2 ? 0.3 : 0.02);
  const callShare = share(mem.calls, mem.received, 0.3);
  const habit = callShare < 0.26 ? -0.08 : callShare > 0.58 ? 0.08 : 0;
  return evCall > evAccept + habit + jitter(rng, 0.05);
};
const gambler: Strategy<GamblerMemory | null> = {
  id: 'gambler',
  name: 'The Gambler',
  blurb:
    'Plays the chair on its left, not the dice: calls the squeezed, hides its good hands, dresses up its lies, and prices every life by the score.',
  fresh: freshMemory,
  decide: (view, memory, rng): Decision<GamblerMemory | null> => {
    const r = view.state.round;
    const mem = memory ?? freshMemory();
    if (r.bid !== null && !r.touched) {
      const call = callOrAccept(view, r, mem, rng);
      const seen = { ...mem, received: mem.received + 1, calls: mem.calls + (call ? 1 : 0) };
      return {
        step: { delay: 1200 + rng() * 900, action: call ? { type: 'call' } : { type: 'peek' } },
        memory: seen,
      };
    }
    const real = visibleRank(r) ?? BOTTOM_RANK;
    const st = stakesFor(view);
    const turn = turnKey4(view);
    const plan = mem.turn === turn ? mem : { ...mem, turn, ...planTurn4(r, real, st, rng) };
    if (plan.stage === 'pulling') {
      const [next, ...rest] = plan.toPull;
      if (next !== undefined && valueAt2(r, next) !== null && r.dice[next]?.inCup === true) {
        const stage = rest.length > 0 ? 'pulling' : r.rolled ? 'bidding' : 'rolling';
        return {
          step: { delay: 800 + rng() * 300, action: { type: 'pull', die: next } },
          memory: { ...plan, stage, toPull: rest },
        };
      }
    }
    if (plan.stage !== 'bidding' && !r.rolled) {
      return {
        step: { delay: 950 + rng() * 400, action: rollAction(r, plan.toTuck) },
        memory: { ...plan, stage: 'bidding', toPull: [], toTuck: [] },
      };
    }
    const floor = floorBid(r);
    const app = appetiteOf(plan, view.state, view.me);
    const rank = bestBid(r, real, st, app, rng);
    const told: GamblerMemory = {
      ...plan,
      stage: 'bidding',
      toPull: [],
      toTuck: [],
      bids: plan.bids + 1,
      bluffs: plan.bluffs + (rank > real ? 1 : 0),
      raises: plan.raises + (r.bid !== null ? 1 : 0),
      minRaises: plan.minRaises + (r.bid !== null && rank === floor ? 1 : 0),
    };
    return { step: { delay: 1400 + rng() * 800, action: { type: 'bid', rank } }, memory: told };
  },
};

export {
  freshMemory,
  turnKey4,
  clamp2,
  share,
  valueAt2,
  GROUP_TOPS,
  sayableFrom,
  calledRaises,
  listenerAt,
  callChance,
  lieLean,
  lastRaiseSize,
  honestyOdds,
  aliveCount,
  bestRival,
  lifeCost,
  lifeGain,
  stakesFor,
  escapeChance,
  appetiteOf,
  scoreBid,
  bestBid,
  handValue,
  sayableUpTo,
  shakeValue,
  moved,
  keepers,
  junk,
  cupPlans,
  rollAction,
  planTurn4,
  callOrAccept,
  gambler,
};
