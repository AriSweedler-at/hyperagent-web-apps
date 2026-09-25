// The scaffolding the engine tests redeclared, written once (dry-round-2.md F4: `viaJson` in six
// files, `failureOf` in two, `PLAYERS` in eighteen, `now` in fifteen, `counting` in two, `must` in
// two, and the eight-line `run` both games' ui/state.test.ts opened with). Test code: it has no
// coverage row, being exercised by every suite that imports it. The engine tests beside the
// engines import it, so tsconfig.pure.json compiles it too: it names no node or DOM type.
import { formatError, type DecodeError } from '../../web/shared/lib/json.ts';
import type { Rng } from '../../web/shared/lib/rng.ts';

/**
 * The two seats, as the gin suites seat them; the backgammon suites keep their own pair in
 * web/games/backgammon/src/engine/test-helpers.ts, since the names are in every state they pin.
 */
export const PLAYERS = [
  { id: 'a', name: 'Alice' },
  { id: 'b', name: 'Bob' },
] as const;

/** A fixed wall clock for the suites that pin timestamps. */
export const NOW = 1_700_000_000_000;
export const now = (): number => NOW;
/** The clock stuck at the epoch, for the drivers that mask timestamps or never read one. */
export const epoch = (): number => 0;

/** Through JSON, as the wire and localStorage carry it. */
export const viaJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

/**
 * `ok`, or the failure as text: a decoder's `$.path: expected ...` (json.ts `formatError`), an
 * engine's rule error as it is. One helper serves both result shapes so a test reads the same
 * either way.
 */
export const failureOf = (r: Readonly<{ ok: boolean; error?: unknown }>): string => {
  if (r.ok || r.error === undefined) return 'ok';
  return typeof r.error === 'string' ? r.error : formatError(r.error as DecodeError);
};

/** The value of a result that must be `ok`; the test fails on its error text otherwise. */
export const must = <T>(
  r: Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: string }>,
): T => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

/** Counts the calls so a test can pin how often the engine reads the rng. */
export const countingRng = (inner: Rng): Rng & Readonly<{ calls: () => number }> => {
  let n = 0;
  const rng = (): number => {
    n += 1;
    return inner();
  };
  return Object.assign(rng, { calls: () => n });
};

/** One reduce step's result: the App after the intents and every effect they emitted, in order. */
export type IntentStep<App, Effect> = Readonly<{ app: App; effects: ReadonlyArray<Effect> }>;

/** Dispatch intents in turn, collecting every effect: `run` of both games' ui/state.test.ts. */
export const runIntents =
  <App, Intent, Effect, Ctx>(
    reduce: (app: App, intent: Intent, ctx: Ctx) => IntentStep<App, Effect>,
    ctx: Ctx,
  ) =>
  (app: App, ...intents: ReadonlyArray<Intent>): IntentStep<App, Effect> =>
    intents.reduce<IntentStep<App, Effect>>(
      (s, intent) => {
        const next = reduce(s.app, intent, ctx);
        return { app: next.app, effects: [...s.effects, ...next.effects] };
      },
      { app, effects: [] },
    );
