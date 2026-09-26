// The engine's legal actions for a view (docs/design/fidice-shell-adoption.md §3 "Boot": the
// boot's `legal`, the documented hook's `legal()`; docs/ARCHITECTURE.md "Documented test hooks").
// The domain has no such list (its `apply` refuses what it must, game.ts), so this spells the cup
// holder's choices off the round the way the table's action steps offer them
// (src/view/screens/table.ts `actions`): facing a bid, call or peek (accept the cup); once the cup
// is accepted the holder must bid (game.ts: "You accepted the cup — you must bid"), so with the cup
// accepted (or no bid yet) every rung above the bid; a reveal waits for next; a table that keeps
// score may finish. The view does not say whose it is, so the list is
// the holder's; pull and roll take dice the caller picks and are not listed.
import { keepsScore } from './domain/game.ts';
import { TOP_RANK, isRank } from './domain/hands.ts';
import type { Action, PublicState, Rank } from './domain/types.ts';

/** Every rung above `bid` (every rung when there is none), lowest first. */
export const ranksAbove = (bid: Rank | null): ReadonlyArray<Rank> => {
  const from = bid ?? -1;
  return Array.from({ length: TOP_RANK - from }, (_, i) => from + 1 + i).filter(isRank);
};

export const legalActions = (v: PublicState): ReadonlyArray<Action> => {
  if (v.phase !== 'playing') return [];
  if (v.reveal !== null) return [{ type: 'next' }];
  const r = v.round;
  if (r === null) return [];
  const facing = r.bid !== null && !r.touched;
  const call: ReadonlyArray<Action> = facing ? [{ type: 'call' }] : [];
  const peek: ReadonlyArray<Action> = facing ? [{ type: 'peek' }] : [];
  const bids: ReadonlyArray<Action> =
    r.bid === null || r.touched ? ranksAbove(r.bid).map((rank) => ({ type: 'bid', rank })) : [];
  const finish: ReadonlyArray<Action> = keepsScore(v) ? [{ type: 'finish' }] : [];
  return [...call, ...peek, ...bids, ...finish];
};
