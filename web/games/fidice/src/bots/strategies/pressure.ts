// The Showman (docs/MIGRATION.md step 8): typed from legacy/fidice/index.html lines 1522-1653
// (bundle section "// src/bots/strategies/pressure.ts"); behaviour is unchanged,
// test/parity/fidice.legacy.test.ts pins its decisions. It plays the cup like a prop: shows dice
// so its bids are believable, sweeps them back to erase what the table learned, and says the
// biggest thing the next chair will swallow (`ceilingOf` at the trust that chair needs).
import type { Rng } from '../../../../../shared/lib/rng.ts';
import { BOTTOM_RANK, HAND_COUNT, TOP_RANK, asRank } from '../../domain/hands.ts';
import { probabilityAtLeast } from '../../domain/probability.ts';
import { publicCupIndices, publicTableIndices } from '../../domain/publicState.ts';
import type { Action, DieValue, PublicRound, PublicState, Rank, Seat } from '../../domain/types.ts';
import {
  bestKeep,
  floorBid,
  jitter,
  livesOf,
  nextSeat,
  oddsBidTrue,
  readSeat,
  rollFor,
  say,
  tableValues,
  truthfulTop,
  visibleRank,
} from '../toolkit.ts';
import type { BotView, Decision, Strategy } from '../types.ts';

export type ShowStyle = Readonly<{
  margin: number;
  push: number;
  puff: number;
  showP: number;
  eraseP: number;
  callAdj: number;
  hungerAt: number;
  stuckAt: number;
  sweepTol: number;
}>;
type Act = 'straight' | 'tell' | 'show';
/** The act for the current turn, drawn once in `freshTurn`. */
export type ShowPlan = Readonly<{
  turn: string;
  act: Act;
  showy: boolean;
  erasing: boolean;
  puffing: boolean;
}>;
export type ShowMemory = ShowPlan | null;
/** Dice indices to show or sweep, and the ceiling the table would then support. */
type Scored = Readonly<{ dice: ReadonlyArray<number>; ceiling: Rank }>;

const RANKS: ReadonlyArray<Rank> = Array.from({ length: HAND_COUNT }, (_, i) => asRank(i));
/** The highest rank the table plus `cupCount` hidden dice reach with probability `trust`. */
const ceilingOf = (table: ReadonlyArray<DieValue>, cupCount: number, trust: number): Rank =>
  RANKS.findLast((r) => probabilityAtLeast(table, cupCount, r) >= trust) ?? BOTTOM_RANK;
const clamp3 = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
/** Every subset of `xs`, the empty one first. */
const subsets2 = (xs: ReadonlyArray<number>): ReadonlyArray<ReadonlyArray<number>> => {
  const [head, ...rest] = xs;
  if (head === undefined) return [[]];
  const tail = subsets2(rest);
  return [...tail, ...tail.map((s) => [head, ...s])];
};
const valueAt3 = (r: PublicRound, i: number): DieValue => r.dice[i]?.value ?? 1;
const hereCeiling = (r: PublicRound, trust: number): Rank =>
  ceilingOf(tableValues(r), publicCupIndices(r).length, trust);
/** Which cup dice to show for the highest ceiling; ties go to more dice when `showy`, else fewer. */
const bestShow = (r: PublicRound, trust: number, showy: boolean): Scored => {
  const cup = publicCupIndices(r);
  const table = tableValues(r);
  const scored = subsets2(cup).map((dice): Scored => ({
    dice,
    ceiling: ceilingOf(
      [...table, ...dice.map((i) => valueAt3(r, i))],
      cup.length - dice.length,
      trust,
    ),
  }));
  return scored.reduce((a, b) =>
    b.ceiling !== a.ceiling
      ? b.ceiling > a.ceiling
        ? b
        : a
      : (showy ? b.dice.length > a.dice.length : b.dice.length < a.dice.length)
        ? b
        : a,
  );
};
/** Which table dice to sweep back for the highest ceiling; ties go to more dice when `hungry`. */
const bestErase = (r: PublicRound, trust: number, hungry: boolean): Scored => {
  const table = publicTableIndices(r);
  if (table.length === 0) return { dice: [], ceiling: hereCeiling(r, trust) };
  const scored = subsets2(table)
    .filter((dice) => dice.length > 0)
    .map((dice): Scored => {
      const left = table.filter((i) => !dice.includes(i)).map((i) => valueAt3(r, i));
      return { dice, ceiling: ceilingOf(left, 5 - left.length, trust) };
    });
  return scored.reduce((a, b) =>
    b.ceiling !== a.ceiling
      ? b.ceiling > a.ceiling
        ? b
        : a
      : (hungry ? b.dice.length > a.dice.length : b.dice.length < a.dice.length)
        ? b
        : a,
  );
};
/** The odds `victim` needs before it lets a bid stand, from its call rate so far. */
const trustNeededBy = (s: PublicState, victim: Seat): number => {
  const read = readSeat(s.records, victim);
  const seen = clamp3(s.records.length / 4, 0, 1);
  const eager = 0.5 * (read.callRate - 0.3) * seen;
  const scared = livesOf(s, victim) <= 1 ? -0.08 : 0;
  return clamp3(0.44 + eager + scared, 0.28, 0.76);
};
const callBar = (s: PublicState, bidder: Seat, rng: Rng, adj: number): number => {
  const read = readSeat(s.records, bidder);
  const confidence = Math.min(1, read.calledBids / 2);
  return clamp3(
    0.5 + adj + 0.4 * (read.bluffRate - 0.4) * confidence + jitter(rng, 0.05),
    0.3,
    0.75,
  );
};
/** My credibility this game: busts cost, held bids earn. */
const credit = (s: PublicState, me: Seat): number => {
  const mine = s.records.filter((rec) => rec.bidder === me);
  const busts = mine.filter((rec) => !rec.holds).length;
  return clamp3(1 - 0.4 * busts + 0.12 * (mine.length - busts), 0, 1);
};
const turnKey5 = (view: BotView): string =>
  `${String(view.state.roundNo)}:${String(view.state.round.history.length)}`;
const freshTurn = (view: BotView, style: ShowStyle, rng: Rng): ShowPlan => {
  const cred = credit(view.state, view.me);
  const draw = rng() * (0.55 + 0.45 * cred);
  const act = draw < 0.18 ? 'straight' : draw < 0.36 ? 'tell' : 'show';
  return {
    turn: turnKey5(view),
    act,
    showy: act !== 'straight' && rng() < style.showP,
    erasing: act !== 'straight' && rng() < style.eraseP,
    puffing: act !== 'straight' && rng() < style.puff * (0.4 + 0.6 * cred),
  };
};
const honestTop = (real: Rank, floor: Rank): Rank | null => {
  const top = truthfulTop(real);
  return top !== null && top >= floor ? top : null;
};
/** The highest bid the holder could still make believable after a sweep. */
const reachable = (r: PublicRound, trust: number): Rank => {
  const cup = publicCupIndices(r).length;
  const best = Math.max(hereCeiling(r, trust), bestErase(r, trust, true).ceiling);
  return asRank(Math.min(TOP_RANK, best + (cup >= 2 ? 30 : 6)));
};
const receive2 = (view: BotView, r: PublicRound, style: ShowStyle, rng: Rng): Action => {
  if (r.bid === null || r.bid >= TOP_RANK) return { type: 'call' };
  const s = view.state;
  const bidder = r.bidder ?? view.me;
  const read = readSeat(s.records, bidder);
  const belief = oddsBidTrue(r) - 0.28 * (read.bluffRate - 0.4) * Math.min(1, read.calledBids / 2);
  if (belief < callBar(s, bidder, rng, style.callAdj)) return { type: 'call' };
  const stuck = reachable(r, trustNeededBy(s, nextSeat(view))) <= r.bid;
  return stuck && belief < style.stuckAt ? { type: 'call' } : { type: 'peek' };
};
const step = <M>(action: Action, delay: number, memory: M): Decision<M> => ({
  step: { action, delay },
  memory,
});
const makeShowman = (
  id: string,
  name: string,
  blurb: string,
  style: ShowStyle,
): Strategy<ShowMemory> => ({
  id,
  name,
  blurb,
  fresh: () => null,
  decide: (view, memory, rng): Decision<ShowMemory> => {
    const r = view.state.round;
    if (r.bid !== null && !r.touched)
      return {
        step: { delay: 1300 + rng() * 700, action: receive2(view, r, style, rng) },
        memory,
      };
    const turn = turnKey5(view);
    const plan = memory?.turn === turn ? memory : freshTurn(view, style, rng);
    const real = visibleRank(r) ?? BOTTOM_RANK;
    const floor = floorBid(r);
    const honest = honestTop(real, floor);
    const trust = clamp3(trustNeededBy(view.state, nextSeat(view)) + style.margin, 0.3, 0.9);
    const base = hereCeiling(r, trust);
    const cup = publicCupIndices(r);
    const poor = honest === null || honest < floor + style.hungerAt;
    if (!r.rolled) {
      const erase = bestErase(r, trust, poor);
      const sweep = erase.dice.length > 0 && erase.ceiling >= base - style.sweepTol;
      const wantsRoll = honest === null || (plan.erasing && sweep && poor);
      const best = wantsRoll ? bestKeep(r, floor) : null;
      if (best !== null && best.keep.length < r.dice.length) {
        const { pulls, roll } = rollFor(r, best);
        const pullNext = pulls[0];
        if (pullNext !== undefined)
          return step({ type: 'pull', die: pullNext }, 800 + rng() * 400, plan);
        if (roll !== null) return step(roll, 1100 + rng() * 500, plan);
      }
    }
    const show = bestShow(r, trust, plan.act === 'show');
    const gate = plan.act === 'straight' ? 12 : honest === null ? 1 : 22;
    const staging = show.ceiling > base + gate && (honest === null || plan.showy) ? show.dice : [];
    const next = staging[0];
    if (next !== undefined) return step({ type: 'pull', die: next }, 800 + rng() * 400, plan);
    if (plan.act === 'tell' && cup.length >= 2 && plan.showy) {
      const solo = cup
        .filter((i) => valueAt3(r, i) >= 5)
        .find(
          (i) => ceilingOf([...tableValues(r), valueAt3(r, i)], cup.length - 1, trust) >= base - 3,
        );
      if (solo !== undefined) return step({ type: 'pull', die: solo }, 900 + rng() * 400, plan);
    }
    const ceiling = hereCeiling(r, trust);
    const aim =
      honest !== null
        ? plan.puffing && ceiling > honest
          ? ceiling
          : honest
        : floor + Math.round(Math.max(0, ceiling - floor) * style.push);
    return step({ type: 'bid', rank: say(aim, real, floor) }, 1400 + rng() * 800, plan);
  },
});
const pressure = makeShowman(
  'pressure',
  'The Showman',
  'Plays the cup like a prop: shows dice so its lies are believable, sweeps them away to erase what you learned, and says the biggest thing the room will swallow.',
  {
    margin: 0.18,
    push: 0.6,
    puff: 0.35,
    showP: 0.35,
    eraseP: 0.3,
    callAdj: 0,
    hungerAt: 24,
    stuckAt: 0.58,
    sweepTol: 8,
  },
);

export {
  RANKS,
  ceilingOf,
  clamp3,
  subsets2,
  valueAt3,
  hereCeiling,
  bestShow,
  bestErase,
  trustNeededBy,
  callBar,
  credit,
  turnKey5,
  freshTurn,
  honestTop,
  reachable,
  receive2,
  step,
  makeShowman,
  pressure,
};
