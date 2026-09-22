// Full-game parity for the gin engine (docs/MIGRATION.md step 10; docs/ARCHITECTURE.md "Testing
// pyramid", parity): seeded random legal play on BOTH legs at once, the legacy fixture and the
// TypeScript engine, each fed its own copy of the same mulberry32 stream. The policy reads the
// legacy view; the chosen action is applied to both legs, and after every action the full state
// (wall-clock fields zeroed), `viewFor` for both seats and `legalActions` for both seats must be
// the same JSON text: same values, same keys, same key order.
//
// The legs disagree on three behaviours, each normalised and tallied. The legacy `lastDrawn` leak
// (docs/MIGRATION.md step 15): the legacy dealHand keeps the previous hand's last draw, the
// current one resets it; after a legacy redeal the leak is counted from the legacy views, then the
// legacy state is normalised (`lastDrawn = null`, what the current engine does) so every later
// comparison stays strict. The undo of a stock draw (docs/design/gin-arrangement-and-discards.md
// §4): the legacy offers it, the current engine refuses it; while the legacy `pendingDraw` is from
// the stock its view is compared with `canUndo: false` and its legal actions without `undoDraw`,
// and the policy chooses from that list, so both legs play the same game. The layoff of a card
// that fits two knocker melds (§7, `multiFit` in gin.layoffs.ts): the current engine may leave the
// defender less deadwood, and every total after that knock diverges, so the seed asserts
// `current <= legacy` on the defender's deadwood and ends there.
//
// The corpus is seeds 1..GAMES, split into SHARDS equal ranges so vitest runs them on SHARDS
// workers at once: `gin.replay.<n>.test.ts` is one line, `replayShard(n)`. Each shard asserts the
// outcome coverage, that the legacy leak shows at least once, that the current engine never marks
// a card fresh right after a redeal, and that the stock-undo normaliser fired, over its own range.
// GIN_REPLAY_GAMES overrides the game count for a quicker local run (CI runs the default 1000).
import { describe, expect, test } from 'vitest';

import * as current from '../../web/games/gin-rummy/src/engine/index.ts';
import type { Pair, Seat, State, View } from '../../web/games/gin-rummy/src/engine/index.ts';
import { mulberry32 } from '../../web/shared/lib/rng.ts';
import { loadLegacyGin, type GinAction, type GinState, type GinView } from './gin.api.ts';
import { multiFit } from './gin.layoffs.ts';
import { actor, policy } from './gin.policy.ts';

const legacy = loadLegacyGin();
const GAMES = Number(process.env['GIN_REPLAY_GAMES'] ?? 1000);
const SHARDS = 4;
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

type Replay = {
  steps: number;
  legacyLeaks: number;
  currentLeaks: number;
  /** Legacy views offering the undo of a stock draw, compared without it. */
  stockUndos: number;
  /** Whether the seed ended at a knock whose defender's hand fits two knocker melds. */
  multiFitKnock: boolean;
  outcomes: Set<string>;
};
/**
 * One seat's legacy view and legal actions after a step, compared to the current leg's already;
 * `normalised` when the view offered the undo of a stock draw, which both are shown without.
 */
type Seen = { view: GinView; acts: GinAction[]; normalised: boolean };

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
    const legacyView: GinView = legacy.viewFor(L, seat);
    // RULE CHANGE (undo from the discard pile only): a stock draw the legacy would undo is shown
    // as final, as the current engine has it, and the policy never chooses that undo.
    const normalised = L.pendingDraw?.from === 'stock' && legacyView.canUndo;
    const vL: GinView = normalised ? { ...legacyView, canUndo: false } : legacyView;
    // ADDITION (the discards sheet): the current view lists the discarded ids; the legacy never did.
    const { discardIds, ...vC }: View = current.viewFor(C, seat);
    expect(discardIds).toEqual(C.discard.map((c) => c.id));
    expectSame(`${label}: viewFor(${String(seat)})`, masked(vC), masked(vL));
    const aL = legacy.legalActions(legacyView).filter((a) => !normalised || a.type !== 'undoDraw');
    expectSame(
      `${label}: legalActions(${String(seat)})`,
      JSON.stringify(current.legalActions(vC)),
      JSON.stringify(aL),
    );
    return { view: vL, acts: aL, normalised };
  };
  /** Compare state, both views and both legal-action lists; the legacy views drive the policy. */
  const at = (label: string, C: State): Pair<Seen> => {
    expectSame(`${label}: state`, masked(C), masked(L));
    return [compareSeat(label, C, 0), compareSeat(label, C, 1)];
  };
  const outcomes = new Set<string>();
  /** Whether either seat's view marks a card as the last drawn. */
  const marksFresh = (viewOf: (seat: Seat) => { lastDrawnId: string | null }): boolean =>
    viewOf(0).lastDrawnId !== null || viewOf(1).lastDrawnId !== null;
  /**
   * RULE CHANGE (the layoff branch): after a knock, whether the defender's hand fits two knocker
   * melds. The legs may then disagree on the defender's deadwood, so the current engine is held
   * to `<=` and the seed ends: every total from here on would differ.
   */
  const multiFitKnock = (action: GinAction, defender: Seat, C: State): boolean => {
    const rL = L.result;
    const rC = C.result;
    if (action.type !== 'knock' || rL === null || rL.void || rC === null || rC.void) return false;
    if (rL.outcome === 'gin' || !multiFit(L.hands[defender] ?? [], rL.knocker.melds)) return false;
    expect(rC.opponent.value, `seed ${String(seed)}: the defender's deadwood`).toBeLessThanOrEqual(
      rL.opponent.value,
    );
    return true;
  };
  type Progress = {
    C: State;
    seen: Pair<Seen>;
    steps: number;
    legacyLeaks: number;
    currentLeaks: number;
    stockUndos: number;
    multiFitKnock: boolean;
    done: boolean;
  };
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
    if (multiFitKnock(action, seat === 0 ? 1 : 0, rC.value)) {
      return { ...acc, C: rC.value, steps: acc.steps + 1, multiFitKnock: true, done: true };
    }
    // KNOWN DEFECT (lastDrawn leak), legacy leg only: its dealHand does not reset lastDrawn, so
    // right after a redeal a card drawn in the previous hand shows as "last drawn" when the
    // shuffle gave it back. Count it from the legacy views, then normalise the legacy state to
    // what the current dealHand produces (null once the key exists) before comparing the legs.
    const redealt = L.handNumber > handsBefore;
    const legacyLeaked = redealt && marksFresh((seat) => legacy.viewFor(L, seat));
    if (redealt && L.lastDrawn !== undefined) L.lastDrawn = null;
    const currentLeaked = redealt && marksFresh((seat) => current.viewFor(rC.value, seat));
    const seen = at(label, rC.value);
    const last = L.rounds.at(-1);
    if (last !== undefined && L.phase === 'roundOver') {
      outcomes.add(last.void === true ? 'void' : (last.outcome ?? 'none'));
    }
    return {
      C: rC.value,
      seen,
      steps: acc.steps + 1,
      legacyLeaks: acc.legacyLeaks + (legacyLeaked ? 1 : 0),
      currentLeaks: acc.currentLeaks + (currentLeaked ? 1 : 0),
      stockUndos: acc.stockUndos + seen.filter((x) => x.normalised).length,
      multiFitKnock: false,
      done: false,
    };
  };
  const final = Array.from({ length: STEP_CAP }).reduce<Progress>(step, {
    C: start,
    seen: at(`seed ${String(seed)} after the deal`, start),
    steps: 0,
    legacyLeaks: 0,
    currentLeaks: 0,
    stockUndos: 0,
    multiFitKnock: false,
    done: false,
  });
  if (!final.multiFitKnock) {
    expect(L.phase, `seed ${String(seed)} did not finish in ${String(STEP_CAP)} steps`).toBe(
      'gameOver',
    );
  }
  return {
    steps: final.steps,
    legacyLeaks: final.legacyLeaks,
    currentLeaks: final.currentLeaks,
    stockUndos: final.stockUndos,
    multiFitKnock: final.multiFitKnock,
    outcomes,
  };
};

/** Seeds of shard `n` (0-based): the n-th of SHARDS equal ranges of 1..GAMES. */
const seedsOf = (shard: number): ReadonlyArray<number> => {
  const from = Math.floor((shard * GAMES) / SHARDS) + 1;
  const to = Math.floor(((shard + 1) * GAMES) / SHARDS);
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
};

/** Registers shard `n`'s test; each `gin.replay.<n+1>.test.ts` calls this once. */
export const replayShard = (shard: number): void => {
  const seeds = seedsOf(shard);
  describe(`gin engine parity: legacy vs current, full games (shard ${String(shard + 1)} of ${String(SHARDS)})`, () => {
    test(`seeds ${String(seeds[0])}..${String(seeds.at(-1))} agree on every state, both views and both legal-action lists after every action`, () => {
      const games = seeds.map(replay);
      const outcomes = new Set(games.flatMap((g) => [...g.outcomes]));
      expect(outcomes).toEqual(new Set(['gin', 'knock', 'undercut', 'void']));
      expect(games.reduce((n, g) => n + g.steps, 0)).toBeGreaterThan(seeds.length * 100);
      // The legacy lastDrawn leak shows in every shard; the current engine never has it (see the
      // comment in `replay`).
      expect(games.reduce((n, g) => n + g.legacyLeaks, 0)).toBeGreaterThan(0);
      expect(games.reduce((n, g) => n + g.currentLeaks, 0)).toBe(0);
      // The stock-undo normaliser fires in every shard; a seed ending at a multi-fit knock is rare
      // (it asserted the defender's deadwood inequality before it ended) and never the majority.
      expect(games.reduce((n, g) => n + g.stockUndos, 0)).toBeGreaterThan(0);
      expect(games.filter((g) => g.multiFitKnock).length).toBeLessThan(seeds.length / 4);
    }, 600_000);
  });
};
