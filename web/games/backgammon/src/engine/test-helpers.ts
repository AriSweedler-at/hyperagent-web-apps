// The backgammon-only test scaffolding its engine and ui tests redeclared (dry-round-2.md F4:
// `pos` in nine files, `PLAYERS` in six, `scripted` in five, `START` in five, `mv` in four).
// Test code by name: eslint.config.js lists `**/test-helpers.ts` with the tests (a counter and a
// throw are fine here) and vitest.config.ts keeps it out of the coverage denominator, so it can
// sit beside the engine without falling under the pure profile or the engine's rows. The shared
// helpers (`now`, `must`, `viaJson`, `countingRng`) are test/shared/engine-helpers.ts's.
import type { Rng } from '../../../../shared/lib/rng.ts';
import { parseMove, parsePosition } from './notation.ts';
import type { Board, Move, Seat } from './types.ts';
import { VARIANTS } from './variants.ts';

/** The two seats, as every backgammon state these tests pin names them. */
export const PLAYERS = [
  { id: 'a', name: 'Ari' },
  { id: 'b', name: 'Jeff' },
] as const;

const R = VARIANTS.portes;

/** An rng whose successive `rollDie` results are exactly `dice`; 1s once the script runs out. */
export const scripted = (...dice: ReadonlyArray<number>): Rng => {
  let i = 0;
  return () => ((dice[i++] ?? 1) - 0.5) / 6;
};

/** A board from the test-table notation (R28), portes frame; a parse error fails the test. */
export const pos = (text: string): Board => {
  const r = parsePosition(text, R);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

/** A move from its notation for `seat`, portes frame; a parse error fails the test. */
export const mv = (seat: Seat, text: string): Move => {
  const r = parseMove(seat, text, R);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

/** The starting position in the notation `pos` reads. */
export const START = 'L: 24:2 13:5 8:3 6:5 | D: 24:2 13:5 8:3 6:5 | bar 0/0 | off 0/0';
