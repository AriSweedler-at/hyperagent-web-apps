// The Score Counter's model and maths (docs/MIGRATION.md step 11): ported from the legacy
// scorer IIFE (legacy/gin-rummy/index.html, pinned in test/fixtures/legacy/gin-ui.cjs), which
// keeps score for a game played with real cards, any number of players. `computeRoundScores`
// takes the players explicitly where the legacy read the module's `state`; the maths is the
// legacy's: gin pays GIN_BONUS plus each opponent's deadwood to the knocker, an opponent at or
// under the knocker's count undercuts for the difference plus UNDERCUT_BONUS, anyone over it pays
// the knocker the difference. test/parity/gin.scorer.test.ts is the oracle.
import { GIN_BONUS, UNDERCUT_BONUS } from '../engine/types.ts';

export type KnockType = 'knock' | 'gin';
export const KNOCK_LABELS: Readonly<Record<KnockType, string>> = { knock: 'Knock', gin: 'Gin' };

export type ScorerPlayer = Readonly<{ id: string; name: string }>;
/** Numbers keyed by player id. */
export type ByPlayer = Readonly<Record<string, number>>;
/** What the board collects for a hand before it is scored. */
export type RoundEntry = Readonly<{ deadwood: ByPlayer; knockerId: string; knockType: KnockType }>;
/** A scored hand, as `ginRummyScorerState_v2` keeps it (the legacy `round` literal's key order). */
export type ScorerRound = Readonly<{
  deadwood: ByPlayer;
  knockerId: string;
  knockType: KnockType;
  scores: ByPlayer;
  ts: number;
}>;
export type ScorerState = Readonly<{
  players: ReadonlyArray<ScorerPlayer>;
  target: number;
  rounds: ReadonlyArray<ScorerRound>;
  startedAt: number;
}>;
export type Standing = Readonly<{ player: ScorerPlayer; total: number }>;

/**
 * Each player's points for one hand, keyed by id in `players` order (every player present, 0 when
 * nothing scored). A player missing from `deadwood` counts 0, as `deadwood[id] || 0` did.
 */
export const computeRoundScores = (
  players: ReadonlyArray<ScorerPlayer>,
  { deadwood, knockerId, knockType }: RoundEntry,
): ByPlayer => {
  const dw = (id: string): number => deadwood[id] ?? 0;
  const kdw = dw(knockerId);
  const zero: ByPlayer = Object.fromEntries(players.map((p) => [p.id, 0]));
  const add = (scores: ByPlayer, id: string, points: number): ByPlayer => ({
    ...scores,
    [id]: (scores[id] ?? 0) + points,
  });
  return players
    .filter((p) => p.id !== knockerId)
    .reduce((scores, p) => {
      const odw = dw(p.id);
      if (knockType === 'gin') return add(scores, knockerId, GIN_BONUS + odw);
      if (odw <= kdw) return add(scores, p.id, kdw - odw + UNDERCUT_BONUS);
      return add(scores, knockerId, odw - kdw);
    }, zero);
};

/** A player's running total over `rounds` (`r.scores[id] || 0` per hand). */
export const totalFor = (rounds: ReadonlyArray<ScorerRound>, id: string): number =>
  rounds.reduce((sum, r) => sum + (r.scores[id] ?? 0), 0);

/** Players by total, highest first (a stable sort: ties keep `players` order, as the legacy's did). */
export const ranked = (state: ScorerState): ReadonlyArray<Standing> =>
  [...state.players.map((player) => ({ player, total: totalFor(state.rounds, player.id) }))].sort(
    (a: Standing, b: Standing) => b.total - a.total,
  );

/** The leader once they have reached the target, else null (`checkWinner`). */
export const winnerOf = (state: ScorerState): Standing | null => {
  const top = ranked(state)[0];
  return top !== undefined && top.total >= state.target ? top : null;
};
