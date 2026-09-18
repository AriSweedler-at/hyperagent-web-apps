// The seeded legal-play policy the gin parity suites drive games with (docs/MIGRATION.md steps 2
// and 10). It reads the legacy-shaped view (gin.api.ts), which the `current` engine's view equals
// key for key, so gin.legacy.test.ts and gin.replay.test.ts choose the same moves from either leg.
import type { Rng } from '../../web/shared/lib/rng.ts';
import type { GinAction, GinState, GinView } from './gin.api.ts';

/** Seat whose move it is: in roundOver/gameOver the first player not yet ready. */
export const actor = (s: GinState): number =>
  s.phase === 'roundOver' || s.phase === 'gameOver' ? (s.ready[0] === true ? 1 : 0) : s.turn;

const deadwoodAfter = (view: GinView, a: GinAction): number => {
  if (a.type !== 'discard' && a.type !== 'knock') return Infinity;
  const option = view.discardOptions?.[a.cardId];
  return option === undefined || option.locked === true ? Infinity : option.deadwood;
};

const leastDeadwood = (view: GinView, acts: GinAction[]): GinAction | undefined =>
  acts.reduce<GinAction | undefined>(
    (best, a) =>
      best === undefined || deadwoodAfter(view, a) < deadwoodAfter(view, best) ? a : best,
    undefined,
  );

/**
 * Seeded legal play. A uniform choice over legalActions does not finish: random hands almost
 * never reach knocking deadwood, so every hand ends void when the stock runs out, and void
 * hands score nothing. So: knock whenever knocking is legal (the least-deadwood knock), discard
 * the least-deadwood card three times in four, and choose uniformly otherwise. Every choice is
 * an element of legalActions(view).
 */
export const policy = (rng: Rng, view: GinView, acts: GinAction[]): GinAction => {
  const knocks = acts.filter((a) => a.type === 'knock');
  const discards = acts.filter((a) => a.type === 'discard');
  const preferred =
    knocks.length > 0
      ? leastDeadwood(view, knocks)
      : discards.length > 0 && rng() < 0.75
        ? leastDeadwood(view, discards)
        : undefined;
  const uniform = acts[Math.floor(rng() * acts.length)];
  const chosen = preferred ?? uniform;
  if (chosen === undefined) throw new Error('no legal action');
  return chosen;
};
