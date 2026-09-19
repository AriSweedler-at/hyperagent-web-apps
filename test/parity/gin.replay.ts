// Full-game parity for the gin engine (docs/MIGRATION.md step 10; docs/ARCHITECTURE.md "Testing
// pyramid", parity): seeded random legal play on BOTH legs at once, the legacy fixture and the
// TypeScript engine, each fed its own copy of the same mulberry32 stream. The policy reads the
// legacy view; the chosen action is applied to both legs, and after every action the full state
// (wall-clock fields zeroed), `viewFor` for both seats and `legalActions` for both seats must be
// the same JSON text: same values, same keys, same key order.
//
// GIN_REPLAY_GAMES overrides the game count for a quicker local run (CI runs the default 1000).
import { describe, expect, test } from 'vitest';

import * as current from '../../web/games/gin-rummy/src/engine/index.ts';
import type { Pair, Seat, State, View } from '../../web/games/gin-rummy/src/engine/index.ts';
import { mulberry32 } from '../../web/shared/lib/rng.ts';
import { loadLegacyGin, type GinAction, type GinState, type GinView } from './gin.api.ts';
import { actor, policy } from './gin.policy.ts';

const legacy = loadLegacyGin();
const GAMES = Number(process.env['GIN_REPLAY_GAMES'] ?? 1000);
/** A seeded game averages ~430 steps; the cap only exists to turn a hang into a failure. */
const STEP_CAP = 5000;
const PLAYERS = [
  { id: 'a', name: 'Alice' },
  { id: 'b', name: 'Bob' },
] as const;
/** The current engine's clock; the legacy reads Date.now, so both timestamps are masked. */
const now = (): number => 0;

/** JSON with the wall-clock fields zeroed; comparing the text pins key order too. */
const masked = (value: unknown): string =>
  JSON.stringify(value, (key: string, v: unknown) => (key === 'ts' || key === 'startedAt' ? 0 : v));

/** Equal JSON text, or a readable diff of the parsed values. */
const expectSame = (label: string, currentText: string, legacyText: string): void => {
  if (currentText !== legacyText) {
    expect(JSON.parse(currentText), label).toEqual(JSON.parse(legacyText));
    expect(currentText, `${label}: same values but different key order`).toBe(legacyText);
  }
};

type Replay = { steps: number; leaks: number; outcomes: Set<string> };
/** One seat's legacy view and legal actions after a step, compared to the current leg's already. */
type Seen = { view: GinView; acts: GinAction[] };

/** One game on both legs; every observable value compared after every action. */
const replay = (seed: number): Replay => {
  const rngLegacy = mulberry32(seed);
  const rngCurrent = mulberry32(seed);
  const choices = mulberry32(seed * 7919);
  const dealer = (seed % 2) as Seat;
  const L: GinState = legacy.createGame({
    players: [...PLAYERS],
    target: 100,
    dealer,
    rng: rngLegacy,
  });
  const start = current.createGame({ players: PLAYERS, target: 100, dealer }, rngCurrent, now);
  const compareSeat = (label: string, C: State, seat: Seat): Seen => {
    const vL: GinView = legacy.viewFor(L, seat);
    const vC: View = current.viewFor(C, seat);
    expectSame(`${label}: viewFor(${String(seat)})`, masked(vC), masked(vL));
    const aL = legacy.legalActions(vL);
    expectSame(
      `${label}: legalActions(${String(seat)})`,
      JSON.stringify(current.legalActions(vC)),
      JSON.stringify(aL),
    );
    return { view: vL, acts: aL };
  };
  /** Compare state, both views and both legal-action lists; the legacy views drive the policy. */
  const at = (label: string, C: State): Pair<Seen> => {
    expectSame(`${label}: state`, masked(C), masked(L));
    return [compareSeat(label, C, 0), compareSeat(label, C, 1)];
  };
  const outcomes = new Set<string>();
  type Progress = { C: State; seen: Pair<Seen>; steps: number; leaks: number; done: boolean };
  const step = (acc: Progress): Progress => {
    if (acc.done || L.phase === 'gameOver') return { ...acc, done: true };
    const seat = actor(L) as Seat;
    const { view, acts } = acc.seen[seat];
    const action = policy(choices, view, acts);
    const handsBefore = L.handNumber;
    const rL = legacy.applyAction(L, seat, action, rngLegacy);
    const rC = current.applyAction(acc.C, seat, action, rngCurrent, now);
    const label = `seed ${String(seed)} step ${String(acc.steps + 1)} ${String(seat)} ${JSON.stringify(action)}`;
    expect(rC.ok, `${label}: current refused ${rC.ok ? '' : rC.error}`).toBe(true);
    expect(rL.ok, `${label}: legacy refused ${rL.ok ? '' : rL.error}`).toBe(true);
    if (!rC.ok) return { ...acc, done: true };
    const seen = at(label, rC.value);
    const last = L.rounds.at(-1);
    if (last !== undefined && L.phase === 'roundOver') {
      outcomes.add(last.void === true ? 'void' : (last.outcome ?? 'none'));
    }
    // KNOWN DEFECT (lastDrawn leak): dealHand does not reset lastDrawn, so right after a redeal a
    // card drawn in the previous hand can show as "last drawn" when the shuffle gave it back.
    // Both legs exhibit it (the state and view comparisons above include it); count it here so
    // the corpus is known to cover it.
    const leaked = L.handNumber > handsBefore && seen.some((s) => s.view.lastDrawnId !== null);
    return {
      C: rC.value,
      seen,
      steps: acc.steps + 1,
      leaks: acc.leaks + (leaked ? 1 : 0),
      done: false,
    };
  };
  const final = Array.from({ length: STEP_CAP }).reduce<Progress>(step, {
    C: start,
    seen: at(`seed ${String(seed)} after the deal`, start),
    steps: 0,
    leaks: 0,
    done: false,
  });
  expect(L.phase, `seed ${String(seed)} did not finish in ${String(STEP_CAP)} steps`).toBe(
    'gameOver',
  );
  return { steps: final.steps, leaks: final.leaks, outcomes };
};

describe('gin engine parity: legacy vs current, full games', () => {
  test(`${String(GAMES)} seeded games agree on every state, both views and both legal-action lists after every action`, () => {
    const games = Array.from({ length: GAMES }, (_, i) => replay(i + 1));
    const outcomes = new Set(games.flatMap((g) => [...g.outcomes]));
    expect(outcomes).toEqual(new Set(['gin', 'knock', 'undercut', 'void']));
    expect(games.reduce((n, g) => n + g.steps, 0)).toBeGreaterThan(GAMES * 100);
    // The lastDrawn leak shows in the corpus (see the comment in `replay`).
    expect(games.reduce((n, g) => n + g.leaks, 0)).toBeGreaterThan(0);
  }, 600_000);
});
