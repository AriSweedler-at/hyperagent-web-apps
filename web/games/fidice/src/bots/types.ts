// Shapes the fidice bots share (docs/MIGRATION.md step 8, phase 2), recovered from how the
// de-bundled strategies use them. A strategy is a pure function of (view, memory, rng): the host
// (bots/brain.ts) redacts the state for the holder's seat, keeps each bot's memory between turns
// and injects the rng, so a seeded replay is reproducible. As in domain/types.ts, the two type
// guards live next to the types they narrow to.
import type { Rng } from '../../../../shared/lib/rng.ts';
import type { Action, PublicRound, PublicState, Rank, Seat } from '../domain/types.ts';

/** What a bot sees: its seat's redaction of the state, during a round (`round` is never null). */
export type BotState = Readonly<Omit<PublicState, 'round'> & { round: PublicRound }>;
export type BotView = Readonly<{ state: BotState; me: Seat }>;

/** A round with a bid on the table: what a strategy answers with `call` or `peek`. */
export type BidRound = Readonly<Omit<PublicRound, 'bid'> & { bid: Rank }>;

export type Step = Readonly<{ delay: number; action: Action }>;
export type Decision<M> = Readonly<{ step: Step; memory: M }>;

/** `fresh` is the memory a bot starts with; `decide` returns its move and the memory to keep. */
export type Strategy<M> = Readonly<{
  id: string;
  name: string;
  blurb: string;
  fresh: () => M;
  decide: (view: BotView, memory: M, rng: Rng) => Decision<M>;
}>;
/** A strategy with its memory type erased (`anyStrategy` in strategy.ts), for the registry's pool. */
export type AnyStrategy = Strategy<unknown>;

export const hasRound = (s: PublicState): s is BotState => s.round !== null;
export const hasBid = (r: PublicRound): r is BidRound => r.bid !== null;
