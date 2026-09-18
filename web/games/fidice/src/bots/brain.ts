// The host's bot driver (docs/MIGRATION.md step 8): typed from legacy/fidice/index.html lines
// 1802-1813 (bundle section "// src/bots/brain.ts"); behaviour is unchanged,
// test/parity/fidice.legacy.test.ts replays seeded bot games through it on both legs. `decide`
// gives the holder's strategy its redacted view and its memory and returns the move to schedule;
// the memories map is replaced, never mutated.
import type { Rng } from '../../../../shared/lib/rng.ts';
import { redactFor } from '../domain/publicState.ts';
import type { State } from '../domain/types.ts';
import { strategyFor } from './registry.ts';
import { hasRound, type Step } from './types.ts';

/** Each bot's strategy memory by player id; the strategy alone knows the shape. */
export type Memories = ReadonlyMap<string, unknown>;
export type BotMove = Readonly<{ step: Step; memories: Memories }>;

const emptyMemories: Memories = new Map();
/** The holder's next move when the holder is a bot and the round is live; null otherwise. */
const decide = (s: State, memories: Memories, rng: Rng): BotMove | null => {
  const r = s.round;
  if (s.phase !== 'playing' || r === null || s.reveal !== null) return null;
  const me = s.players[r.holder];
  if (!me?.bot) return null;
  const strategy = strategyFor(me.bot);
  const memory = memories.has(me.id) ? memories.get(me.id) : strategy.fresh();
  const state = redactFor(s, { kind: 'seat', seat: r.holder });
  // `redactFor` keeps a round whenever `s` has one, so the guard only narrows the type.
  if (!hasRound(state)) return null;
  const d = strategy.decide({ state, me: r.holder }, memory, rng);
  return { step: d.step, memories: new Map(memories).set(me.id, d.memory) };
};

export { emptyMemories, decide };
