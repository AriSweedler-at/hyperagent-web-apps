// THE REPLAY ORACLE (docs/design/fidice-shell-adoption.md §4 M3, §6 risk 11; the flip gate's (2)):
// the game loop moved from the legacy host session's timers (src/net/host.ts `schedule()`,
// `AUTO_NEXT_MS`) into the reducer's `bot/step` and `autoNext` timers, and this suite proves the
// move kept the bots' games. test/parity/fidice.legacy.test.ts `botGame` plays twelve seeded
// tables of three to six computers (their strategies walking STRATEGY_IDS from the seed) straight
// through `decide` and `apply`; here the same twelve tables are played through `reduce`: the table
// loaded as a pass-the-phone game (Watch: no human, the host standing), `start` applied under the
// same seeded rng, then every timer the reducer arms fired in turn on a stepping clock (the
// effect's `then` dispatched after its `ms`), until the game is over. The players, the round
// records and the log lines (text and weight; the reducer stamps each line with the clock where
// the oracle leaves `at` null) are the oracle's, seed for seed. The oracle's helpers are not
// imported (test/parity/** is read-only): its seeds and its lobby are re-derived line for line.
import { describe, expect, test } from 'vitest';

import { mulberry32 } from '../../../../shared/lib/rng.ts';
import { decide, emptyMemories } from '../bots/brain.ts';
import { HOST, apply, bySeat, newGame } from '../domain/game.ts';
import { makeBot, seatPlayer } from '../domain/lobby.ts';
import type { State } from '../domain/types.ts';
import { AUTO_NEXT_MS, initialApp, reduce, type App, type Effect, type Intent } from './state.ts';

/** test/parity/fidice.legacy.test.ts: twelve seeds, the strategy walk, the table of `3 + seed % 4` computers. */
const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);
const STRATEGY_IDS = [
  'gambler',
  'profiler',
  'pressure',
  'trapper',
  'classic-cautious',
  'classic-steady',
  'classic-reckless',
  'learner-10',
  'learner-100',
  'learner-300',
];
/** A bot game takes a few hundred steps; the cap turns a hang into a failure. */
const STEP_CAP = 20_000;

const unwrap = <T>(
  r: Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: string }>,
): T => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

/** `botTableOn` of the legacy oracle: a lobby of `players` computers whose strategies walk STRATEGY_IDS from `seed`. */
const botTable = (seed: number, players: number): State =>
  Array.from({ length: players }, (_, i) => i).reduce(
    (s, i) =>
      unwrap(
        seatPlayer(
          s,
          makeBot(s, `bot${String(i)}`, {
            strategy: STRATEGY_IDS[(seed + i) % STRATEGY_IDS.length] ?? 'gambler',
            random: false,
          }),
        ),
      ),
    newGame('ABCDE', 3),
  );

type Oracle = Readonly<{ state: State; steps: number }>;

/** `playBotsOn` of the legacy oracle: the way HostSession.schedule() drove a game, minus the timers. */
const oracle = (seed: number, players: number): Oracle => {
  const rng = mulberry32(seed);
  const start = unwrap(apply(botTable(seed, players), HOST, { type: 'start' }, rng));
  const run = (
    acc: Readonly<{ state: State; memories: typeof emptyMemories; steps: number }>,
  ): Readonly<{ state: State; memories: typeof emptyMemories; steps: number }> => {
    const { state, memories, steps } = acc;
    if (state.phase === 'over' || steps >= STEP_CAP) return acc;
    if (state.reveal)
      return run({
        state: unwrap(apply(state, HOST, { type: 'next' }, rng)),
        memories,
        steps: steps + 1,
      });
    const holder = state.round?.holder;
    const decision = decide(state, memories, rng);
    if (holder === undefined || decision === null) throw new Error(`no bot move in ${state.phase}`);
    return run({
      state: unwrap(apply(state, bySeat(holder), decision.step.action, rng)),
      memories: decision.memories,
      steps: steps + 1,
    });
  };
  const end = run({ state: start, memories: emptyMemories, steps: 0 });
  return { state: end.state, steps: end.steps };
};

// ---- the reducer, driven by its own timers on a stepping clock -------------------------------------

type Timer = Extract<Effect, Readonly<{ type: 'startTimer' }>>;
const isTimer = (e: Effect): e is Timer => e.type === 'startTimer';
const isCancel = (e: Effect): e is Extract<Effect, Readonly<{ type: 'cancelTimer' }>> =>
  e.type === 'cancelTimer';

type Replay = Readonly<{
  app: App;
  now: number;
  /** Every timer intent fired, in order. */
  fired: ReadonlyArray<Intent>;
  /** The autoNext stamps the reducer broadcast, in order. */
  stamps: ReadonlyArray<number>;
}>;

/**
 * The armed timers as web/shared/ui/toast.ts `createTimers` keeps them: one per id, arming again
 * restarts, cancelling forgets. The next to fire is the earliest due; a tie fires `bot/step` first
 * (the legacy never had both armed: a reveal clears the bot timer).
 */
type Armed = ReadonlyMap<string, Readonly<{ due: number; then: Intent }>>;
const armedAfter = (armed: Armed, effects: ReadonlyArray<Effect>, now: number): Armed =>
  effects.reduce<Armed>((acc, e) => {
    if (isTimer(e)) return new Map(acc).set(e.id, { due: now + e.ms, then: e.then });
    if (isCancel(e)) {
      const next = new Map(acc);
      next.delete(e.id);
      return next;
    }
    return acc;
  }, armed);

/** The table loaded as a pass-the-phone game nobody plays from the device (Watch), not yet started. */
const watching = (table: State): App => ({
  ...initialApp,
  shell: {
    ...initialApp.shell,
    role: 'local',
    playMode: 'watch',
    opts: { ...initialApp.shell.opts, watch: true, bots: table.players.length },
    game: table,
    localNames: table.players.map((p) => p.name),
    localSeats: table.players.map((_, i) => i as 0 | 1 | 2 | 3 | 4 | 5),
  },
});

/** `start` under the seeded rng, then every timer fired at its due time until the game is over. */
const replay = (seed: number, players: number): Replay => {
  const rng = mulberry32(seed);
  const clock = { now: 1_700_000_000_000 };
  const ctx = { rng, now: () => clock.now };
  const first = reduce(
    watching(botTable(seed, players)),
    { type: 'act', action: { type: 'start' } },
    ctx,
  );
  const run = (
    acc: Readonly<{
      app: App;
      armed: Armed;
      fired: ReadonlyArray<Intent>;
      stamps: ReadonlyArray<number>;
    }>,
    left: number,
  ): Replay => {
    const { app, armed, fired, stamps } = acc;
    const game = app.shell.game;
    if (game === null || game.phase === 'over' || armed.size === 0 || left === 0)
      return { app, now: clock.now, fired, stamps };
    const next = [...armed.entries()].sort(
      (a, b) => a[1].due - b[1].due || (a[0] === 'bot/step' ? -1 : 1),
    )[0];
    if (next === undefined) return { app, now: clock.now, fired, stamps };
    const [id, { due, then }] = next;
    // The clock steps to the timer; `createTimers` forgets a fired timer before its intent runs.
    clock.now = Math.max(clock.now, due);
    const forgotten = new Map(armed);
    forgotten.delete(id);
    const s = reduce(app, then, ctx);
    const stamped = s.app.shell.game?.autoNextAt;
    return run(
      {
        app: s.app,
        armed: armedAfter(forgotten, s.effects, clock.now),
        fired: [...fired, then],
        stamps:
          stamped !== undefined && stamped !== null && stamps.at(-1) !== stamped
            ? [...stamps, stamped]
            : stamps,
      },
      left - 1,
    );
  };
  return run(
    {
      app: first.app,
      armed: armedAfter(new Map(), first.effects, clock.now),
      fired: [],
      stamps: [],
    },
    STEP_CAP,
  );
};

const bare = (
  s: State,
): Readonly<{
  players: State['players'];
  records: State['records'];
  log: ReadonlyArray<readonly [string, boolean]>;
}> => ({
  players: s.players,
  records: s.records,
  log: s.log.map((e) => [e.text, e.big] as const),
});

describe('the replay oracle: the twelve seeded bot tables through the reducer`s timers', () => {
  test.each(SEEDS)(
    'seed %i: the reducer reaches the oracle`s players, records and log, one timer per step',
    (seed) => {
      const players = 3 + (seed % 4);
      const expected = oracle(seed, players);
      const got = replay(seed, players);
      const game = got.app.shell.game;
      if (game === null) throw new Error('no game');
      expect(game.phase).toBe('over');
      expect(bare(game)).toEqual(bare(expected.state));
      // Every step of the oracle is one timer fired here: a computer's move or the reveal's next.
      expect(got.fired).toHaveLength(expected.steps);
      expect(got.fired.every((i) => i.type === 'bot/step' || i.type === 'autoNext')).toBe(true);
      // The reducer stamps every log line with the clock where the oracle leaves it null.
      expect(game.log.every((e) => e.at !== null)).toBe(true);
      // Each reveal was stamped with `now + AUTO_NEXT_MS` once and broadcast (the legacy `scheduleAutoNext`).
      expect(got.stamps).toHaveLength(got.fired.filter((i) => i.type === 'autoNext').length);
      // The oracle's lobby seats its computers under the default host chair (never stood up): kept as is.
      expect(game.hostSeat).toBe(expected.state.hostSeat);
    },
  );

  test('seed 1 is the profiler, pressure, trapper table the legacy suite names, and its reveals waited AUTO_NEXT_MS each', () => {
    const got = replay(1, 3);
    const game = got.app.shell.game;
    if (game === null) throw new Error('no game');
    expect(game.players.map((p) => p.bot?.strategy)).toEqual(['profiler', 'pressure', 'trapper']);
    // Every reveal but the last (which ends the game: no next round) waited for its `autoNext`.
    const reveals = got.fired.filter((i) => i.type === 'autoNext').length;
    expect(reveals).toBe(game.records.length - 1);
    expect(got.stamps.length).toBe(reveals);
    // The clock advanced by every bot delay and every 7 s reveal: at least the reveals' share.
    expect(got.now - 1_700_000_000_000).toBeGreaterThanOrEqual(reveals * AUTO_NEXT_MS);
  });
});
