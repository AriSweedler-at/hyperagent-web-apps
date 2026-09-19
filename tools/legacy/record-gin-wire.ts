// Records the gin wire corpus, test/fixtures/legacy/gin-wire/*.json (docs/MIGRATION.md step 11):
// one file per frame tag the legacy multiplayer UI sends over its PeerJS data channel, read off
// legacy/gin-rummy/index.html (`conn.send({ t: ... })` in the UI IIFE):
//   guest -> host   {t:'join', name}   {t:'action', action}
//   host  -> guest  {t:'welcome', hostName, target}   {t:'lobby', hostName, target}   {t:'full'}
//                   {t:'toast', msg}   {t:'state', view}
// The `state` views, the `action`s and the `toast` refusals are real: seeded games are played on
// the pinned legacy engine (test/fixtures/legacy/gin-engine.cjs) with the parity policy, and the
// guest's view (`viewFor(game, 1)`, as `broadcast()` sends it) is sampled once per distinct
// position class; the refusals are what `applyAction` answers to out-of-turn and unfit moves. The
// name/target frames are the literals the page builds from its inputs. `Date.now` is pinned while
// recording so the corpus is reproducible: test/fixtures/legacy/gin-wire.test.ts re-records and
// compares. A live capture needs two peers (CI only; step 12 adds the differential net test). Run:
//   node --experimental-strip-types tools/legacy/record-gin-wire.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  loadLegacyGin,
  type GinAction,
  type GinEngine,
  type GinState,
  type GinView,
} from '../../test/parity/gin.api.ts';
import { actor, policy } from '../../test/parity/gin.policy.ts';
import { mulberry32 } from '../../web/shared/lib/rng.ts';
import { FIXTURE_DIR, REPO_ROOT, isMain } from './extract.ts';

export const WIRE_DIR = `${FIXTURE_DIR}/gin-wire`;
/** Seeds of the games the corpus is sampled from; enough for every outcome and position class. */
const SEEDS: ReadonlyArray<number> = Array.from({ length: 40 }, (_, i) => i + 1);
const STEP_CAP = 5000;
/** The pinned clock: a fixed epoch stepping one second per read. */
const EPOCH = 1_700_000_000_000;
/** Frames per state file, so each file stays well under the 100 KB golden limit. */
const STATES_PER_FILE = 6;

export type Frame = Readonly<Record<string, unknown>>;
export type Corpus = Readonly<Record<string, ReadonlyArray<Frame>>>;

const PLAYERS = [
  { id: 'host', name: 'Ann' },
  { id: 'guest', name: 'Jeff' },
] as const;

/** Position class of a guest view: one sample per class is kept. */
const classOf = (v: GinView): string => {
  const result = v.result;
  const outcome = result === null ? '' : result.void ? 'void' : result.outcome;
  const locked = Object.values(v.discardOptions ?? {}).some((o) => o.locked === true);
  return [
    v.phase,
    v.isMyTurn ? 'mine' : 'theirs',
    v.upcardStage ?? '',
    outcome,
    v.forceStock ? 'forceStock' : '',
    v.canUndo ? 'canUndo' : '',
    v.lastDrawnId === null ? '' : 'lastDrawn',
    v.meldOptions.length > 1 ? 'alternatives' : '',
    locked ? 'locked' : '',
  ].join('|');
};

/** Refusals that differ only by their numbers ("...would leave 24 deadwood instead of 18.") count once. */
const templateOf = (message: string): string => message.replace(/\d+/g, '#');

/** Distinct refusal texts: every legal action of the mover tried as the other seat, and unfit moves. */
const refusals = (E: GinEngine, state: GinState, view: GinView, acts: GinAction[]): string[] => {
  const other = 1 - actor(state);
  const bogus: GinAction[] = [
    { type: 'discard', cardId: 'ZZ' },
    { type: 'knock', cardId: view.me.hand[0]?.id ?? 'AS' },
    { type: 'undoDraw' },
    { type: 'drawDiscard' },
    { type: 'takeUpcard' },
    { type: 'ready' },
    { type: 'setMelds', melds: [['AS', 'AH', 'AD']] },
  ];
  const tryAs = (seat: number, a: GinAction): string | null => {
    const copy = structuredClone(state);
    const r = E.applyAction(copy, seat, a, mulberry32(0));
    return r.ok ? null : r.error;
  };
  return [...acts.map((a) => tryAs(other, a)), ...bogus.map((a) => tryAs(actor(state), a))].filter(
    (m): m is string => m !== null,
  );
};

type Sampled = {
  states: Map<string, GinView>;
  actions: Map<string, GinAction>;
  /** Refusal template -> the first message seen with it. */
  toasts: Map<string, string>;
};

const play = (E: GinEngine, seed: number, into: Sampled): void => {
  const rng = mulberry32(seed);
  const choices = mulberry32(seed * 7919);
  const state = E.createGame({ players: [...PLAYERS], target: 100, dealer: seed % 2, rng });
  const sample = (): void => {
    const view = E.viewFor(state, 1);
    const key = classOf(view);
    if (!into.states.has(key)) into.states.set(key, view);
  };
  sample();
  const step = (n: number): void => {
    if (n >= STEP_CAP || state.phase === 'gameOver') return;
    const seat = actor(state);
    const view = E.viewFor(state, seat);
    const acts = E.legalActions(view);
    refusals(E, state, view, acts).forEach((m) => {
      if (!into.toasts.has(templateOf(m))) into.toasts.set(templateOf(m), m);
    });
    const action = policy(choices, view, acts);
    const actionKey = action.type === 'setMelds' ? 'setMelds' : action.type;
    if (!into.actions.has(actionKey)) into.actions.set(actionKey, action);
    const r = E.applyAction(state, seat, action, rng);
    if (!r.ok) throw new Error(`seed ${String(seed)}: legacy refused ${JSON.stringify(action)}`);
    sample();
    step(n + 1);
  };
  step(0);
};

const chunk = <T>(xs: ReadonlyArray<T>, size: number): ReadonlyArray<ReadonlyArray<T>> =>
  Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, (i + 1) * size));

/** The whole corpus, file name (without .json) -> frames, with the clock pinned. */
export const recordGinWire = (): Corpus => {
  const realNow = Date.now;
  const clock = { t: EPOCH };
  // The legacy engine reads Date.now() for startedAt and every round's ts.
  Date.now = () => {
    clock.t += 1000;
    return clock.t;
  };
  try {
    const E = loadLegacyGin();
    const sampled: Sampled = { states: new Map(), actions: new Map(), toasts: new Map() };
    SEEDS.forEach((seed) => {
      play(E, seed, sampled);
    });
    const states = [...sampled.states.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, view]) => ({ t: 'state', view }));
    const stateFiles = Object.fromEntries(
      chunk(states, STATES_PER_FILE).map((frames, i) => [`state.${String(i + 1)}`, frames]),
    );
    const names = ['Jeff', 'Guest', 'ABCDEFGHIJKLMNOPQRST', 'Zoë 🃏', 'Ann 2'];
    return {
      join: names.map((name) => ({ t: 'join', name })),
      welcome: [
        { t: 'welcome', hostName: 'Ann', target: 100 },
        { t: 'welcome', hostName: 'ABCDEFGHIJKLMNOPQRST', target: 250 },
        { t: 'welcome', hostName: 'Zoë 🃏', target: 1 },
      ],
      lobby: [
        { t: 'lobby', hostName: 'Ann', target: 100 },
        { t: 'lobby', hostName: 'Host', target: 50 },
      ],
      full: [{ t: 'full' }],
      toast: [...sampled.toasts.values()].sort().map((msg) => ({ t: 'toast', msg })),
      action: [...sampled.actions.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, action]) => ({ t: 'action', action })),
      ...stateFiles,
    };
  } finally {
    Date.now = realNow;
  }
};

export const corpusFile = (name: string): string => resolve(REPO_ROOT, WIRE_DIR, `${name}.json`);

if (isMain(import.meta.url)) {
  const corpus = recordGinWire();
  mkdirSync(resolve(REPO_ROOT, WIRE_DIR), { recursive: true });
  Object.entries(corpus).forEach(([name, frames]) => {
    const text = `${JSON.stringify(frames, null, 2)}\n`;
    writeFileSync(corpusFile(name), text);
    console.log(
      `${WIRE_DIR}/${name}.json: ${String(frames.length)} frames, ${String(Buffer.byteLength(text))} bytes`,
    );
  });
}
