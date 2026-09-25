// Seeded random play to the end of the match (rules R33): a
// policy over `legalActions` drives `applyAction`, and after every step the
// invariants hold: thirty checkers, stacks of one owner, `off` never decreasing within a game,
// the mover's pips falling by the die (or the point, bearing off) and the opponent's rising by
// exactly a hit, the wrong seat refused, every single step not offered refused, both seats'
// views agreeing on the board, the log growing by the expected lines, the rng read only by rolls
// and openings, byte-stable re-encoding, and `legalMoves` set-equal to the first moves of the
// maximal plays (the enumeration is the oracle). Each suite also asserts outcome coverage. The
// seeded driver (dice, picks, the policy before each apply, the rng accounting) is
// test/shared/replay.ts's `driveGame` (dry-round-2.md F3); the invariants stay here, the
// backgammon-only scaffolding beside the engine in test-helpers.ts.
import { describe, expect, test } from 'vitest';

import { epoch as now } from '../../../../../test/shared/engine-helpers.ts';
import {
  byteStable,
  driveGame,
  replayScale,
  seeds,
  type Step as DrivenStep,
} from '../../../../../test/shared/replay.ts';
import * as bg from './index.ts';
import type { Action, ShippedVariant, State, View } from './index.ts';
import { PLAYERS } from './test-helpers.ts';

/** A random match of 3 runs a few hundred steps; the cap only turns a hang into a failure. */
const STEP_CAP = 20_000;

/** Doubles at 15%, undoes at 5%, passes at 25%, otherwise a uniformly random legal move. */
const choose = (view: View, pick: () => number): Action => {
  switch (view.phase) {
    case 'over':
      return { type: 'next' };
    case 'cubeOffered':
      return { type: pick() < 0.75 ? 'take' : 'pass' };
    case 'moving': {
      if (view.canUndo && pick() < 0.05) return { type: 'undo' };
      const m = view.legal[Math.floor(pick() * view.legal.length)];
      if (m === undefined) throw new Error('no legal move while moving');
      return { type: 'move', from: m.from, to: m.to, die: m.die };
    }
    case 'opening':
    case 'toRoll':
      return view.canDouble && pick() < 0.15 ? { type: 'double' } : { type: 'roll' };
  }
};

const keys = (moves: ReadonlyArray<bg.Move>): ReadonlySet<string> => new Set(moves.map(bg.moveKey));

type Step = DrivenStep<State, View, Action> & Readonly<{ cov: Set<string> }>;

/** A cheap assertion for the per-step invariants: `expect` per check would dominate the run. */
const ensure = (ok: boolean, label: string, what: string): void => {
  if (!ok) throw new Error(`${label}: ${what}`);
};
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const checkStep = ({ before, after, view, actor, action, rngCalls, step, cov }: Step): void => {
  const rules = bg.rulesOf(before.variant);
  const label = `step ${String(step)} ${action.type}`;
  const opp = bg.otherSeat(actor);
  // 1. Thirty checkers, one owner per stack, 24 points.
  ensure(after.board.points.length === 24, label, '24 points');
  ensure(
    bg.checkerCount(after.board, 0) === 15 && bg.checkerCount(after.board, 1) === 15,
    label,
    'fifteen a side',
  );
  ensure(bg.isHomogeneous(after.board), label, 'a stack mixes owners');
  // 2. `off` never decreases within a game (an undo restores the turn's start, R26); fifteen off
  //    iff the game ended by bearing off.
  if (action.type === 'undo')
    ensure(same(after.board, before.turnStart), label, 'undo did not restore turnStart');
  else if (after.gameNo === before.gameNo)
    ensure(
      after.board.off[0] >= before.board.off[0] && after.board.off[1] >= before.board.off[1],
      label,
      'off decreased',
    );
  ([0, 1] as const).forEach((s) => {
    const won =
      after.phase === 'over' && after.result?.reason === 'borneOff' && after.result.winner === s;
    ensure((after.board.off[s] === 15) === won, label, `off[${String(s)}] vs the result`);
  });
  // 3./4. A move: from the bar first, offered by legalMoves, exact pip deltas.
  if (action.type === 'move') {
    if (before.board.bar[actor] > 0)
      ensure(action.from === 'bar', label, 'moved with a checker on the bar');
    ensure(keys(view.legal).has(bg.moveKey(action)), label, 'the move was not offered');
    const own = action.from === 'bar' ? bg.BAR_PIPS : rules.ownOf(actor, action.from);
    const spent = action.to === 'off' ? own : action.die;
    ensure(
      bg.pipCount(after.board, actor, rules) === bg.pipCount(before.board, actor, rules) - spent,
      label,
      'the mover pips',
    );
    const hit = after.board.bar[opp] === before.board.bar[opp] + 1;
    const gained = hit && action.to !== 'off' ? bg.BAR_PIPS - rules.ownOf(opp, action.to) : 0;
    ensure(
      bg.pipCount(after.board, opp, rules) === bg.pipCount(before.board, opp, rules) + gained,
      label,
      'the opponent pips',
    );
    if (hit) cov.add('hit');
    if (hit && action.from === 'bar') cov.add('barHit');
    if (action.to === 'off' && action.die > own) cov.add('bigDieOff');
    // The steps `legalMoves` did not offer are refused (sampled: each is a full applyAction).
    if (step % 3 === 0)
      bg.remainingDice(before).forEach((die) => {
        bg.singleSteps(before.board, actor, die, rules)
          .filter((m) => !keys(view.legal).has(bg.moveKey(m)))
          .forEach((m) => {
            const refused = bg.applyAction(before, actor, { type: 'move', ...m }, () => 0, now);
            ensure(
              !refused.ok && refused.error === bg.MESSAGES.ILLEGAL_MOVE,
              label,
              'an unoffered step was accepted',
            );
          });
      });
  }
  // 5. The wrong seat is refused.
  if (before.phase !== 'over') {
    const wrong = bg.applyAction(before, opp, action, () => 0, now);
    ensure(
      !wrong.ok && wrong.error === bg.MESSAGES.NOT_YOUR_TURN,
      label,
      'the wrong seat was not refused',
    );
  }
  // 6. Both views agree on the board; legal only for the actor; movesLeft consistent.
  const v0 = bg.viewFor(after, 0);
  const v1 = bg.viewFor(after, 1);
  ensure(
    bg.boardKey(v0.board) === bg.boardKey(v1.board) && same(v0.pips, v1.pips),
    label,
    'the views disagree',
  );
  const nextActor = bg.actorOf(after);
  [v0, v1].forEach((v) => {
    if (v.me.idx !== nextActor || after.phase !== 'moving')
      ensure(v.legal.length === 0, label, 'legal for a non-mover');
    else ensure(v.legal.length > 0, label, 'no legal move for the mover');
    if (after.phase === 'moving' && after.dice !== null)
      ensure(
        v.movesLeft.length === bg.expandDice(after.dice).length - after.played.length,
        label,
        'movesLeft',
      );
  });
  // The enumeration is the oracle for the level-set algorithm (the mover's view carries the plays).
  if (after.phase === 'moving' && nextActor !== null) {
    const v = nextActor === 0 ? v0 : v1;
    const firsts =
      v.playsTotal <= bg.PLAYS_CAP
        ? v.plays.flatMap((p) => p.slice(0, 1))
        : bg
            .maximalPlays(after.board, nextActor, bg.remainingDice(after), rules)
            .flatMap((p) => p.slice(0, 1));
    const a = [...new Set(firsts.map(bg.moveKey))].sort();
    const b = v.legal.map(bg.moveKey).sort();
    ensure(same(a, b), label, 'legal differs from the first moves of the maximal plays');
  }
  // 7. Log growth per action.
  const grew = after.log.length - before.log.length;
  switch (action.type) {
    case 'roll':
      ensure(grew === 1, label, 'a roll logs one line');
      if (after.lastAction?.kind === 'noMove') cov.add('noMove');
      break;
    case 'undo':
      ensure(grew === 0, label, 'an undo logs nothing');
      cov.add('undo');
      break;
    case 'double':
    case 'take':
      ensure(grew === 1, label, 'a cube action logs one line');
      if (action.type === 'take') cov.add('take');
      break;
    case 'pass':
      ensure(grew === 2, label, 'a pass logs two lines');
      break;
    case 'move':
      if (after.phase === 'over')
        ensure(grew >= 2, label, 'a finishing move logs the turn and the result');
      else if (after.turn !== before.turn)
        ensure(grew >= 1, label, 'a completed turn logs its line');
      else ensure(grew === 0, label, 'a move mid-turn logs nothing');
      break;
    case 'next':
      ensure(after.log.length >= 2, label, 'a new game opens with its lines');
      break;
  }
  // 8. The finished game.
  if (after.phase === 'over' && before.phase !== 'over') {
    const r = after.result;
    ensure(r !== null, label, 'no result');
    if (r === null) return;
    ensure(r.multiplier <= rules.maxMultiplier, label, 'multiplier above the cap');
    ensure(r.points === r.multiplier * r.cube, label, 'points');
    ensure(after.match.score[r.winner] === before.match.score[r.winner] + r.points, label, 'score');
    ensure(after.games.at(-1)?.gameNo === after.gameNo && after.endedAt !== null, label, 'record');
    if (r.reason === 'borneOff')
      ensure(bg.multiplierFor(after.board, r.winner, rules) === r.multiplier, label, 'multiplier');
    else cov.add('pass');
    cov.add(['single', 'gammon', 'backgammon'][r.multiplier - 1] ?? '');
  }
  if (after.match.isCrawfordGame) cov.add('crawford');
  // 10. RNG accounting: a roll reads two dice; an opening two per attempt; nothing else reads.
  const ties = after.log.filter((e) => e.kind === 'opening' && e.seat === null).length;
  ensure(
    rngCalls === (action.type === 'roll' ? 2 : action.type === 'next' ? 2 * (ties + 1) : 0),
    label,
    'rng reads',
  );
  // 9. Byte stability every 25th step (decode.test.ts round-trips every state of a whole match).
  if (step % 25 === 0)
    ensure(
      byteStable(after, bg.decodeState) &&
        byteStable(v0, bg.decodeView) &&
        byteStable(v1, bg.decodeView),
      label,
      'not byte-stable',
    );
};

/**
 * One seeded match (`rotation`, `matchLength`) to the end: the shared driver's dice and picks,
 * the invariants of `checkStep` on every step.
 */
const playMatch = (
  seed: number,
  rotation: ReadonlyArray<ShippedVariant>,
  matchLength: number,
  cov: Set<string>,
): number => {
  const run = driveGame(bg.ENGINE, {
    seed,
    now,
    start: (dice, clock) => bg.createGame(PLAYERS, { matchLength, rotation }, dice, clock),
    policy: (view, pick) => choose(view, pick),
    stepCap: STEP_CAP,
    over: (s) => s.phase === 'over' && bg.matchOver(s.match),
    onStep: ({ before, after, view, actor, action, rngCalls, step }) => {
      // The higher-die rule at work: two different dice, either playable alone, only one move deep.
      if (
        before.phase === 'moving' &&
        before.played.length === 0 &&
        before.dice !== null &&
        before.dice[0] !== before.dice[1] &&
        view.plays.every((p) => p.length === 1) &&
        bg.singleSteps(
          before.board,
          actor,
          Math.min(...before.dice) as bg.Die,
          bg.rulesOf(before.variant),
        ).length > 0
      )
        cov.add('higherDie');
      checkStep({ before, after, view, actor, action, rngCalls, step, cov });
    },
  });
  expect(run.done, `seed ${String(seed)} did not finish in ${String(STEP_CAP)} steps`).toBe(true);
  expect(bg.matchWinner(run.state.match), `seed ${String(seed)}`).not.toBeNull();
  expect(bg.applyAction(run.state, 0, { type: 'next' }, run.rng, now)).toEqual({
    ok: false,
    error: bg.MESSAGES.MATCH_OVER,
  });
  return run.steps;
};

/**
 * How many matches the three suites play together: 91 by default (60 + 25 + 6; every push and PR,
 * about eight seconds), `BG_REPLAY_GAMES=1000` in .github/workflows/nightly.yml beside gin's
 * `GIN_REPLAY_GAMES`, lower for a quick local run. Each suite keeps its share of the total, and the
 * outcome-coverage assertions expect at least the default.
 */
const { share, timeoutMs: TIMEOUT_MS } = replayScale('BG_REPLAY_GAMES', 91);

describe('seeded random play to the end (R33)', () => {
  test(
    'portes: single games, every invariant every step',
    () => {
      const cov = new Set<string>();
      const steps = seeds(1, share(60)).map((seed) => playMatch(seed, ['portes'], 1, cov));
      expect(steps.reduce((a, b) => a + b, 0)).toBeGreaterThan(share(60) * 60);
      ['single', 'gammon', 'noMove', 'hit', 'barHit', 'higherDie', 'bigDieOff', 'undo'].forEach(
        (c) => {
          expect(cov.has(c), c).toBe(true);
        },
      );
      expect(cov.has('backgammon')).toBe(false);
      expect(cov.has('take')).toBe(false);
    },
    TIMEOUT_MS,
  );

  test(
    'backgammon: matches to 3 with the cube',
    () => {
      const cov = new Set<string>();
      const steps = seeds(1001, share(25)).map((seed) => playMatch(seed, ['backgammon'], 3, cov));
      expect(steps.reduce((a, b) => a + b, 0)).toBeGreaterThan(share(25) * 100);
      [
        'single',
        'gammon',
        'backgammon',
        'noMove',
        'hit',
        'barHit',
        'higherDie',
        'bigDieOff',
        'undo',
        'take',
        'pass',
        'crawford',
      ].forEach((c) => {
        expect(cov.has(c), c).toBe(true);
      });
    },
    TIMEOUT_MS,
  );

  test(
    'a rotation of portes and backgammon, matches to 3',
    () => {
      const cov = new Set<string>();
      seeds(5001, share(6)).forEach((seed) => playMatch(seed, ['portes', 'backgammon'], 3, cov));
      ['single', 'gammon', 'crawford'].forEach((c) => {
        expect(cov.has(c), c).toBe(true);
      });
    },
    TIMEOUT_MS,
  );
});
