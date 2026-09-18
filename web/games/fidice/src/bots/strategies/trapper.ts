// The Trapper (docs/MIGRATION.md step 8): typed from legacy/fidice/index.html lines 1156-1276
// (bundle section "// src/bots/strategies/trapper.ts"); behaviour is unchanged,
// test/parity/fidice.legacy.test.ts pins its decisions. It remembers the dice it last saw under
// the cup (`Snapshot`, invalidated by the shakes it hears in the log), shows its rubbish, bids the
// truth and calls the moment a bid runs past what it knows is there.
import type { Rng } from '../../../../../shared/lib/rng.ts';
import { BOTTOM_RANK, TOP_RANK, rankOf } from '../../domain/hands.ts';
import { publicCupIndices, publicTableIndices } from '../../domain/publicState.ts';
import type { Action, DieValue, PublicRound, PublicState, Rank, Seat } from '../../domain/types.ts';
import {
  bestKeep,
  canSeeAll,
  floorBid,
  jitter,
  keepFace,
  livesOf,
  nextSeat,
  oddsAtLeast,
  oddsBidTrue,
  readSeat,
  rollFor,
  say,
  seatsAfter,
  visibleRank,
} from '../toolkit.ts';
import {
  hasBid,
  type BidRound,
  type BotView,
  type Decision,
  type Step,
  type Strategy,
} from '../types.ts';

type Stage = 'pull' | 'roll' | 'bid';
/** The dice as last seen with the cup lifted, and how many shakes the log held then. */
export type Snapshot = Readonly<{
  roundNo: number;
  shakes: number;
  values: ReadonlyArray<DieValue>;
}>;
export type TrapperPlan = Readonly<{
  turn: string;
  stage: Stage;
  toPull: ReadonlyArray<number>;
  intoCup: ReadonlyArray<number>;
  rollCup: boolean;
}>;
export type TrapperMemory = Readonly<{ plan: TrapperPlan | null; know: Snapshot | null }>;

const SHAKE = 'shakes the cup';
const MIN_HIDDEN = 2;
const JUNK_FACE = 4;
const turnKey3 = (view: BotView): string =>
  `${String(view.state.roundNo)}:${String(view.state.round.history.length)}`;
const valueAt = (r: PublicRound, i: number): number => r.dice[i]?.value ?? 0;
/** Shakes logged since this round's opening line; null until that line exists. */
const shakesHeard = (s: PublicState): number | null => {
  const from = s.log.findIndex((e) => e.text.startsWith(`Round ${String(s.roundNo)}:`));
  return from < 0 ? null : s.log.slice(from).filter((e) => e.text.includes(SHAKE)).length;
};
const snapshot = (s: PublicState, r: PublicRound): Snapshot | null => {
  const shakes = shakesHeard(s);
  return canSeeAll(r) && shakes !== null
    ? { roundNo: s.roundNo, shakes, values: r.dice.map((d) => d.value) }
    : null;
};
/** The round's true rank when the snapshot still holds (same round, no shake since). */
const exactRank = (s: PublicState, r: PublicRound, k: Snapshot | null): Rank | null => {
  if (k?.roundNo !== s.roundNo || shakesHeard(s) !== k.shakes) return null;
  const values = r.dice.flatMap((d, i) => {
    const seen = d.value ?? k.values[i] ?? null;
    return seen === null ? [] : [seen];
  });
  return values.length === r.dice.length ? rankOf(values) : null;
};
/** How far the chairs between me and the last one tend to climb in a round. */
const climbAhead = (view: BotView): number => {
  const middle = seatsAfter(view.state, view.me).slice(0, -1);
  return middle.reduce<number>(
    (sum, i) => sum + Math.min(14, Math.max(2, readSeat(view.state.records, i).avgRaise)),
    0,
  );
};
/** How often a chair bids without shaking, read from the log; 0 with fewer than two turns seen. */
const stickiness = (s: PublicState, i: Seat): number => {
  const name = s.players[i]?.name;
  const theirs = name === undefined ? [] : s.log.filter((e) => e.text.startsWith(`${name} `));
  const turns = theirs.filter((e) => e.text.includes(' bids ')).length;
  const shakes = theirs.filter((e) => e.text.includes(SHAKE)).length;
  return turns < 2 ? 0 : Math.max(0, 1 - shakes / turns);
};
const stickyAhead = (view: BotView): number => {
  const middle = seatsAfter(view.state, view.me).slice(0, -1);
  return middle.length === 0
    ? 0
    : middle.reduce<number>((sum, i) => sum + stickiness(view.state, i), 0) / middle.length;
};
const timidity = (view: BotView): number =>
  1 - Math.min(1, readSeat(view.state.records, nextSeat(view)).callRate * 1.6);
const receive = (view: BotView, r: BidRound, know: Snapshot | null, rng: Rng): Step => {
  const s = view.state;
  const bid = r.bid;
  if (bid >= TOP_RANK) return { delay: 1400, action: { type: 'call' } };
  const real = exactRank(s, r, know);
  if (real !== null)
    return { delay: 900 + rng() * 500, action: bid > real ? { type: 'call' } : { type: 'peek' } };
  const bidder = r.bidder;
  const read = readSeat(s.records, bidder);
  const honesty = read.calledBids >= 2 ? 1 - read.bluffRate : 0.55;
  const p = oddsBidTrue(r);
  const believable = p + (1 - p) * honesty;
  const room = oddsAtLeast(r, floorBid(r));
  const theirTrigger = Math.min(0.8, Math.max(0.12, readSeat(s.records, nextSeat(view)).callRate));
  const worthIt =
    0.035 +
    2 * (1 - room) * theirTrigger +
    (livesOf(s, view.me) <= 1 ? -0.08 : 0) +
    jitter(rng, 0.05);
  return {
    delay: 1300 + rng() * 700,
    action: believable < worthIt ? { type: 'call' } : { type: 'peek' },
  };
};
const planTurn3 = (
  r: PublicRound,
  real: Rank,
  floor: Rank,
  rng: Rng,
): Omit<TrapperPlan, 'turn'> => {
  const face = keepFace(r);
  const spare = Math.max(0, publicCupIndices(r).length - MIN_HIDDEN);
  if (real >= floor) {
    const show = publicCupIndices(r)
      .filter((i) => valueAt(r, i) !== face && valueAt(r, i) <= JUNK_FACE)
      .slice(0, rng() < 0.55 ? Math.min(spare, 2) : 0);
    return { stage: show.length > 0 ? 'pull' : 'bid', toPull: show, intoCup: [], rollCup: false };
  }
  if (r.rolled) return { stage: 'bid', toPull: [], intoCup: [], rollCup: false };
  const best = bestKeep(r, floor);
  if (best === null || best.keep.length === r.dice.length)
    return { stage: 'bid', toPull: [], intoCup: [], rollCup: false };
  const { pulls } = rollFor(r, best);
  const hide = publicTableIndices(r).filter((i) => !best.keep.includes(i));
  return { stage: pulls.length > 0 ? 'pull' : 'roll', toPull: pulls, intoCup: hide, rollCup: true };
};
const chooseBid2 = (view: BotView, r: PublicRound, real: Rank, rng: Rng): Rank => {
  const s = view.state;
  const floor = floorBid(r);
  if (real < floor) {
    const shy = timidity(view);
    const leap = rng() < 0.25 + 0.3 * shy ? Math.floor(rng() * 10) : Math.floor(rng() * 4);
    return say(floor + leap, real, floor);
  }
  const next = nextSeat(view);
  const read = readSeat(s.records, next);
  const asleep = read.calls === 0 && read.callRate < 0.15 && s.records.length >= 6;
  if (asleep && livesOf(s, view.me) > 1 && livesOf(s, next) > 1 && rng() < 0.5) {
    return say(
      Math.min(TOP_RANK - 12, real + 6 + Math.floor(rng() * (10 + 22 * timidity(view)))),
      real,
      floor,
    );
  }
  const lure = Math.max(0, 1.2 * stickyAhead(view) * climbAhead(view) * (1 + jitter(rng, 0.4)));
  return say(Math.max(floor, real - lure), real, floor);
};
const holding = (
  view: BotView,
  r: PublicRound,
  mem: TrapperMemory,
  rng: Rng,
): Decision<TrapperMemory> => {
  const real = visibleRank(r) ?? BOTTOM_RANK;
  const turn = turnKey3(view);
  const plan: TrapperPlan =
    mem.plan?.turn === turn ? mem.plan : { turn, ...planTurn3(r, real, floorBid(r), rng) };
  const [next, ...rest] = plan.toPull;
  if (plan.stage === 'pull' && next !== undefined && r.dice[next]?.inCup) {
    const stage =
      rest.length > 0 ? 'pull' : plan.rollCup || plan.intoCup.length > 0 ? 'roll' : 'bid';
    return {
      step: { delay: 800 + rng() * 400, action: { type: 'pull', die: next } },
      memory: { ...mem, plan: { ...plan, toPull: rest, stage } },
    };
  }
  const cup = publicCupIndices(r);
  const tuck = plan.intoCup.filter((i) => !r.dice[i]?.inCup);
  if (plan.stage === 'roll' && !r.rolled && plan.rollCup && (cup.length > 0 || tuck.length > 0)) {
    const action: Action = { type: 'roll', cup: cup.length > 0, table: [], intoCup: tuck };
    return {
      step: { delay: 1000 + rng() * 500, action },
      memory: { ...mem, plan: { ...plan, stage: 'bid' } },
    };
  }
  return {
    step: {
      delay: 1400 + rng() * 800,
      action: { type: 'bid', rank: chooseBid2(view, r, real, rng) },
    },
    memory: { ...mem, plan: { ...plan, stage: 'bid' } },
  };
};
const trapper: Strategy<TrapperMemory> = {
  id: 'trapper',
  name: 'The Trapper',
  blurb:
    'Shows you rubbish, bids the truth, remembers every die — and calls the moment you overreach.',
  fresh: () => ({ plan: null, know: null }),
  decide: (view, memory, rng): Decision<TrapperMemory> => {
    const s = view.state;
    const r = s.round;
    const seen = snapshot(s, r);
    const mem = seen === null ? memory : { ...memory, know: seen };
    if (hasBid(r) && !r.touched) return { step: receive(view, r, mem.know, rng), memory: mem };
    return holding(view, r, mem, rng);
  },
};

export {
  SHAKE,
  MIN_HIDDEN,
  JUNK_FACE,
  turnKey3,
  valueAt,
  shakesHeard,
  snapshot,
  exactRank,
  climbAhead,
  stickiness,
  stickyAhead,
  timidity,
  receive,
  planTurn3,
  chooseBid2,
  holding,
  trapper,
};
