// The page's reducer (docs/design/rps-island.md §3, the round): the phase the round is in, what
// each intent does to it, and the effects the edge runs for it (the timers, the cues, the save).
// Pure: the random draws (the scroll's length, the computer's hand) and the clock readings (the
// resolve instant, the tap instant, off `performance.now()`) arrive inside the intents from
// main.ts, so a test scripts a whole round and the e2e rigs one.
import type { Rng } from '../../../../shared/lib/rng.ts';
import {
  HANDS,
  applyRound,
  canTechUp,
  reset as resetProgress,
  techUp as takeTechUp,
  type Hand,
  type Outcome,
  type Progress,
} from '../engine/engine.ts';
import type { Cue } from './sound.ts';

/** The shown hand changes this often while the computer scrolls (§3 step 2). */
export const SCROLL_TICK_MS = 80;
/** The scroll's length is drawn uniformly in this range (§3 step 2). */
export const SCROLL_MIN_MS = 800;
export const SCROLL_MAX_MS = 2000;
/** After a verdict the next round starts by itself this much later (§3 step 1). */
export const NEXT_ROUND_MS = 1400;

export type Phase =
  /** Before Go, after Stop, or while Tech up is on offer: the game waits. */
  | Readonly<{ kind: 'idle' }>
  /** The computer's hand cycles; taps do nothing. */
  | Readonly<{ kind: 'scrolling'; shown: Hand }>
  /** The hand is shown, the clock runs, the buttons are armed. */
  | Readonly<{ kind: 'armed'; computer: Hand; resolvedAt: number }>
  /** The round is over; the next starts by itself unless stopped or a Tech up waits. `windowMs` is the window the round was played to (a loss has already slowed the progress's). */
  | Readonly<{
      kind: 'verdict';
      computer: Hand;
      player: Hand | null;
      outcome: Outcome;
      reactionMs: number | null;
      windowMs: number;
    }>;

export type App = Readonly<{
  progress: Progress;
  phase: Phase;
  /** Rounds played this visit. */
  rounds: number;
  /** The player pressed Stop: the next round waits for Go. */
  paused: boolean;
}>;

export type Intent =
  | Readonly<{ type: 'go'; scrollMs: number }>
  | Readonly<{ type: 'scroll/tick' }>
  | Readonly<{ type: 'resolve'; computer: Hand; at: number }>
  | Readonly<{ type: 'tap'; hand: Hand; at: number }>
  | Readonly<{ type: 'timeout' }>
  | Readonly<{ type: 'stop' }>
  | Readonly<{ type: 'techUp' }>
  | Readonly<{ type: 'reset' }>;

/** The edge's named timers; arming one again restarts it. */
export type TimerId = 'scroll' | 'resolve' | 'window' | 'next';

export type Effect =
  | Readonly<{ kind: 'timer'; id: TimerId; ms: number }>
  | Readonly<{ kind: 'cancel'; id: TimerId }>
  | Readonly<{ kind: 'cue'; cue: Cue }>
  | Readonly<{ kind: 'save' }>;

export type Step = Readonly<{ app: App; effects: ReadonlyArray<Effect> }>;

export const initialApp = (progress: Progress): App => ({
  progress,
  phase: { kind: 'idle' },
  rounds: 0,
  paused: false,
});

const ALL_TIMERS: ReadonlyArray<TimerId> = ['scroll', 'resolve', 'window', 'next'];
const cancelAll: ReadonlyArray<Effect> = ALL_TIMERS.map((id) => ({ kind: 'cancel', id }));

/** A scroll length, uniform in 0.8 … 2.0 s (§3 step 2). */
export const drawScrollMs = (rng: Rng): number =>
  Math.round(SCROLL_MIN_MS + rng() * (SCROLL_MAX_MS - SCROLL_MIN_MS));

/** The computer's hand, uniform and independent of where the scroll stopped (§3 step 3). */
export const drawHand = (rng: Rng): Hand =>
  HANDS[Math.min(HANDS.length - 1, Math.floor(rng() * HANDS.length))] ?? 'rock';

/** The hand after `hand` in the scroll's cycle ✊ → ✋ → ✌️ → ✊. */
export const nextShown = (hand: Hand): Hand =>
  HANDS[(HANDS.indexOf(hand) + 1) % HANDS.length] ?? 'rock';

/** Whether the next round should start by itself after this verdict (§3 step 1). */
export const autoNext = (app: App): boolean =>
  app.phase.kind === 'verdict' && !app.paused && !canTechUp(app.progress);

const still = (app: App): Step => ({ app, effects: [] });

/** A round's end: the verdict phase, its cue, the save, and the next round's timer unless it waits. */
const settle = (app: App, computer: Hand, player: Hand | null, reactionMs: number | null): Step => {
  const { outcome, progress } = applyRound(app.progress, player, computer, reactionMs);
  const next: App = {
    ...app,
    progress,
    rounds: app.rounds + 1,
    phase: {
      kind: 'verdict',
      computer,
      player,
      outcome,
      reactionMs,
      windowMs: app.progress.windowMs,
    },
  };
  return {
    app: next,
    effects: [
      { kind: 'cancel', id: 'window' },
      { kind: 'cue', cue: outcome },
      { kind: 'save' },
      ...(autoNext(next)
        ? [{ kind: 'timer', id: 'next', ms: NEXT_ROUND_MS } as const]
        : [{ kind: 'cancel', id: 'next' } as const]),
    ],
  };
};

export const reduce = (app: App, intent: Intent): Step => {
  switch (intent.type) {
    case 'go': {
      if (app.phase.kind === 'scrolling' || app.phase.kind === 'armed') return still(app);
      return {
        app: { ...app, paused: false, phase: { kind: 'scrolling', shown: 'rock' } },
        effects: [
          { kind: 'cancel', id: 'next' },
          { kind: 'timer', id: 'scroll', ms: SCROLL_TICK_MS },
          { kind: 'timer', id: 'resolve', ms: intent.scrollMs },
        ],
      };
    }
    case 'scroll/tick': {
      if (app.phase.kind !== 'scrolling') return still(app);
      return {
        app: { ...app, phase: { kind: 'scrolling', shown: nextShown(app.phase.shown) } },
        effects: [{ kind: 'timer', id: 'scroll', ms: SCROLL_TICK_MS }],
      };
    }
    case 'resolve': {
      if (app.phase.kind !== 'scrolling') return still(app);
      return {
        app: { ...app, phase: { kind: 'armed', computer: intent.computer, resolvedAt: intent.at } },
        effects: [
          { kind: 'cancel', id: 'scroll' },
          { kind: 'cue', cue: 'resolve' },
          { kind: 'timer', id: 'window', ms: app.progress.windowMs },
        ],
      };
    }
    case 'tap': {
      if (app.phase.kind !== 'armed') return still(app);
      const reactionMs = Math.max(0, Math.round(intent.at - app.phase.resolvedAt));
      return settle(app, app.phase.computer, intent.hand, reactionMs);
    }
    case 'timeout': {
      if (app.phase.kind !== 'armed') return still(app);
      return settle(app, app.phase.computer, null, null);
    }
    case 'stop': {
      if (app.phase.kind === 'scrolling' || app.phase.kind === 'armed') return still(app);
      return { app: { ...app, paused: true }, effects: [{ kind: 'cancel', id: 'next' }] };
    }
    case 'techUp': {
      if (!canTechUp(app.progress) || app.phase.kind === 'armed') return still(app);
      return {
        app: { ...app, progress: takeTechUp(app.progress), phase: { kind: 'idle' } },
        effects: [{ kind: 'cancel', id: 'next' }, { kind: 'cue', cue: 'techUp' }, { kind: 'save' }],
      };
    }
    case 'reset': {
      return {
        app: { ...app, progress: resetProgress(), phase: { kind: 'idle' }, paused: false },
        effects: [...cancelAll, { kind: 'cue', cue: 'reset' }, { kind: 'save' }],
      };
    }
    default: {
      const never: never = intent;
      return never;
    }
  }
};
