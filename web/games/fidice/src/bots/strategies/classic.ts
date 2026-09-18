// The classic bots (docs/MIGRATION.md step 8): typed from legacy/fidice/index.html lines 975-1035
// (bundle section "// src/bots/strategies/classic.ts"); behaviour is unchanged,
// test/parity/fidice.legacy.test.ts pins each one's decisions. Three tunings of one plain style:
// call on the odds, reroll the junk, bid the hand with an occasional bluff.
import type { Rng } from '../../../../../shared/lib/rng.ts';
import { BOTTOM_RANK, TOP_RANK } from '../../domain/hands.ts';
import { publicCupIndices, publicTableIndices } from '../../domain/publicState.ts';
import type { Action, PublicRound, Rank } from '../../domain/types.ts';
import { bestKeep, floorBid, jitter, oddsBidTrue, rollFor, say, visibleRank } from '../toolkit.ts';
import type { BotView, Decision, Strategy } from '../types.ts';

export type ClassicStyle = Readonly<{
  /** Call when the bid's odds of holding fall below this. */
  callAt: number;
  /** How often a bid runs past the hand. */
  bluff: number;
  /** How far past it. */
  jump: number;
  noise: number;
}>;
type Stage = 'bidding' | 'pulling' | 'rolling';
type TurnPlan = Readonly<{
  stage: Stage;
  toPull: ReadonlyArray<number>;
  keep: ReadonlyArray<number>;
}>;
/** The plan for the current turn, keyed by `turnKey`; null before the first turn. */
export type ClassicMemory = Readonly<{ turn: string } & TurnPlan> | null;

const turnKey = (view: BotView): string =>
  `${String(view.state.roundNo)}:${String(view.state.round.history.length)}`;
const decideCallOrAccept = (r: PublicRound, style: ClassicStyle, rng: Rng): Action => {
  if (r.bid !== null && r.bid >= TOP_RANK) return { type: 'call' };
  return oddsBidTrue(r) + jitter(rng, style.noise) < style.callAt
    ? { type: 'call' }
    : { type: 'peek' };
};
const planTurn = (r: PublicRound, real: Rank, rng: Rng): TurnPlan => {
  const need = r.bid === null ? BOTTOM_RANK : r.bid + 1;
  const comfortable = real >= need + 2 && rng() < 0.75;
  if (comfortable) return { stage: 'bidding', toPull: [], keep: [] };
  const best = bestKeep(r, floorBid(r));
  if (best === null || best.keep.length === r.dice.length)
    return { stage: 'bidding', toPull: [], keep: [] };
  const { pulls } = rollFor(r, best);
  return { stage: pulls.length > 0 ? 'pulling' : 'rolling', toPull: pulls, keep: best.keep };
};
const chooseBid = (r: PublicRound, real: Rank, style: ClassicStyle, rng: Rng): Rank => {
  const cur = r.bid;
  const floor = floorBid(r);
  if (cur === null) {
    const roll = rng();
    const raw =
      roll < 0.55
        ? real
        : roll < 0.8
          ? real - Math.floor(rng() * 12)
          : real + Math.floor(rng() * style.jump);
    return say(raw, real, floor);
  }
  if (real > cur) {
    const room = real - cur;
    const honest = rng() < 0.7 ? real : cur + 1 + Math.floor(rng() * Math.min(room, 4));
    const puffed = rng() < style.bluff * 0.4 ? real + 1 + Math.floor(rng() * style.jump) : honest;
    return say(puffed, real, floor);
  }
  const leap = rng() < style.bluff ? style.jump : 2;
  return say(cur + 1 + Math.floor(rng() * leap), real, floor);
};
const classic = (
  id: string,
  name: string,
  blurb: string,
  style: ClassicStyle,
): Strategy<ClassicMemory> => ({
  id,
  name,
  blurb,
  fresh: () => null,
  decide: (view, memory, rng): Decision<ClassicMemory> => {
    const r = view.state.round;
    if (r.bid !== null && !r.touched)
      return {
        step: { delay: 1400 + rng() * 800, action: decideCallOrAccept(r, style, rng) },
        memory,
      };
    const real = visibleRank(r) ?? BOTTOM_RANK;
    const turn = turnKey(view);
    const plan = memory?.turn === turn ? memory : { turn, ...planTurn(r, real, rng) };
    if (plan.stage === 'pulling') {
      const [next, ...rest] = plan.toPull;
      if (next !== undefined) {
        return {
          step: { delay: 900, action: { type: 'pull', die: next } },
          memory: { ...plan, stage: rest.length > 0 ? 'pulling' : 'rolling', toPull: rest },
        };
      }
    }
    if (plan.stage !== 'bidding' && !r.rolled) {
      const keep = new Set(plan.keep);
      const cupLeft = publicCupIndices(r).filter((i) => !keep.has(i));
      const tucks = publicTableIndices(r).filter((i) => !keep.has(i));
      const action: Action = { type: 'roll', cup: cupLeft.length > 0, table: [], intoCup: tucks };
      if (cupLeft.length + tucks.length > 0)
        return { step: { delay: 1100, action }, memory: { ...plan, stage: 'bidding', toPull: [] } };
    }
    return {
      step: {
        delay: 1500 + rng() * 900,
        action: { type: 'bid', rank: chooseBid(r, real, style, rng) },
      },
      memory: { ...plan, stage: 'bidding' },
    };
  },
});
const classicCautious = classic(
  'classic-cautious',
  'Cautious classic',
  'Calls early, bluffs small, plays the odds.',
  { callAt: 0.42, bluff: 0.25, jump: 3, noise: 0.08 },
);
const classicSteady = classic(
  'classic-steady',
  'Steady classic',
  'Middle of the road: bids its hand, bluffs now and then.',
  { callAt: 0.5, bluff: 0.4, jump: 5, noise: 0.08 },
);
const classicReckless = classic(
  'classic-reckless',
  'Reckless classic',
  'Lets bids ride and bluffs big.',
  { callAt: 0.6, bluff: 0.65, jump: 9, noise: 0.08 },
);

export {
  turnKey,
  decideCallOrAccept,
  planTurn,
  chooseBid,
  classic,
  classicCautious,
  classicSteady,
  classicReckless,
};
