// The beat's clock, pure (docs/design/briscola-battle.md §3.2, §3.7): how long each stage of the
// settle beat holds the table, by the device's speed preference (`briscola_speed`: `normal`, the
// design; `quick`, ×0.6 with floors, an impact never under 80 ms nor a glide under 90; `off`, the
// reduced tables) and its `prefers-reduced-motion` (every glide 1 ms, the hold a 300 ms still, the
// clash skipped to a still). ui/state.ts arms its timers from these and ui/render.ts times its
// flights from the same table, so the two agree; theme.css carries the same numbers as `--beat-*`
// on `#tableScreen`, overridden by `[data-speed]` and the reduced-motion block. The battle stages
// (`play` … `packGlide`) are here for the beat that grows over them (PRs D to F); today's settle
// reads `holdMs`/`flyMs`/`drawMs`/`drawGapMs`. No DOM, no engine.
import type { Speed } from '../../../../shared/lib/speed.ts';

// ---- today's settle (§5.3) ----------------------------------------------------------------------------

export type Durations = Readonly<{
  /** The trick shown resolved, the taking card lifted, before anything flies. */
  holdMs: number;
  /** The trick's cards to the winner's cell. */
  flyMs: number;
  /** One back from the stock to a seat. */
  drawMs: number;
  /** Between one draw's start and the next. */
  drawGapMs: number;
  /** My drawn card's turn from its back to its face once its flight has landed (§3.1 DRAW, tap-gated). */
  flipMs: number;
}>;

export const DURATIONS: Durations = {
  holdMs: 900,
  flyMs: 320,
  drawMs: 260,
  drawGapMs: 160,
  flipMs: 220,
};
/** `quick`: ×0.6, the glides floored at 90 ms. */
export const QUICK_DURATIONS: Durations = {
  holdMs: 540,
  flyMs: 200,
  drawMs: 160,
  drawGapMs: 100,
  flipMs: 140,
};
/** `prefers-reduced-motion` and `off`: every glide 1 ms, the hold 300 ms (long enough to read the trick). */
export const REDUCED_DURATIONS: Durations = {
  holdMs: 300,
  flyMs: 1,
  drawMs: 1,
  drawGapMs: 1,
  flipMs: 1,
};

// ---- the draw order round my tap (§3.1 DRAW) ------------------------------------------------------------

/**
 * Where `me` stands in a trick's draw order (`drew`, the winner first): how many seats draw before
 * my tap, whether I draw at all, and how many draw after my card has landed; every seat before
 * and none after when I am not drawing (the engine draws everyone or nobody, so that is a device
 * whose seat is not at the table).
 */
export type DrawSpan = Readonly<{ before: number; mine: boolean; after: number }>;

export const drawSpan = (drew: ReadonlyArray<number>, me: number): DrawSpan => {
  const i = drew.indexOf(me);
  return i < 0
    ? { before: drew.length, mine: false, after: 0 }
    : { before: i, mine: true, after: drew.length - i - 1 };
};

/** A run of `n` auto draws with the gaps between them; 0 for none (the reducer arms no timer for 0). */
export const drawRunMs = (n: number, d: Durations): number =>
  n <= 0 ? 0 : d.drawMs + d.drawGapMs * (n - 1);

/** The settle's durations for a device: reduced motion wins over the switch; `off` reads the reduced tables. */
export const durationsFor = (speed: Speed, reducedMotion: boolean): Durations =>
  reducedMotion || speed === 'off'
    ? REDUCED_DURATIONS
    : speed === 'quick'
      ? QUICK_DURATIONS
      : DURATIONS;

// ---- the battle beat's stages (§3.2) -----------------------------------------------------------------

export type BeatStage =
  | 'drawFlight'
  | 'drawFlip'
  | 'drawAuto'
  | 'drawAutoGap'
  | 'play'
  | 'follow'
  | 'followLast'
  | 'charge'
  | 'strike'
  | 'impact'
  | 'vibrate'
  | 'aftermath'
  | 'sparkles'
  | 'packStack'
  | 'packGlide'
  | 'deal'
  | 'dealGap';

type StageRow = Readonly<{ normal: number; quick: number; reduced: number }>;

/** §3.2's table: `normal` the design, `quick` the ×0.6 column with its floors, `reduced` the still (the impact is the 300 ms still; charge, strike, vibrate and aftermath vanish). */
export const BEAT_MS: Readonly<Record<BeatStage, StageRow>> = {
  drawFlight: { normal: 240, quick: 150, reduced: 1 },
  drawFlip: { normal: 220, quick: 140, reduced: 1 },
  drawAuto: { normal: 220, quick: 130, reduced: 1 },
  drawAutoGap: { normal: 110, quick: 70, reduced: 1 },
  play: { normal: 320, quick: 200, reduced: 1 },
  follow: { normal: 240, quick: 150, reduced: 1 },
  followLast: { normal: 200, quick: 120, reduced: 1 },
  charge: { normal: 120, quick: 80, reduced: 0 },
  strike: { normal: 80, quick: 50, reduced: 0 },
  impact: { normal: 160, quick: 100, reduced: 300 },
  vibrate: { normal: 90, quick: 60, reduced: 0 },
  aftermath: { normal: 300, quick: 180, reduced: 0 },
  sparkles: { normal: 320, quick: 190, reduced: 0 },
  packStack: { normal: 140, quick: 90, reduced: 1 },
  packGlide: { normal: 240, quick: 150, reduced: 1 },
  // The deal (§7 H): one back from the stock per card at DRAW-auto's pace, `dealGap` apart.
  deal: { normal: 220, quick: 130, reduced: 1 },
  dealGap: { normal: 110, quick: 70, reduced: 1 },
};

/** The stages a variant's `tempo` scales (§3.3): the anticipation, the strike and the poses; never the impact. */
export const TEMPO_STAGES: ReadonlySet<BeatStage> = new Set(['charge', 'strike', 'aftermath']);

/**
 * How long `stage` holds at this device's speed, `tempo` (×0.85 snappy, ×1 even, ×1.15 heavy)
 * applied to the tempo stages alone; the impact's length is the caller's (`freezeMs`, by the
 * trick's value), so `impact` here is the design's middle row for a stage table that needs one.
 */
export const stageMs = (
  stage: BeatStage,
  speed: Speed,
  reducedMotion: boolean,
  tempo = 1,
): number => {
  const row = BEAT_MS[stage];
  if (reducedMotion || speed === 'off') return row.reduced;
  const base = speed === 'quick' ? row.quick : row.normal;
  return TEMPO_STAGES.has(stage) ? Math.round(base * tempo) : base;
};

// ---- the hit-stop (§3.2 IMPACT) --------------------------------------------------------------------------

/** The still's length under reduced motion and `off`: long enough to read the trick. */
export const STILL_MS = 300;
/** `quick`'s floor for the hit-stop. */
export const IMPACT_FLOOR_MS = 80;

/**
 * IMPACT's length on this device: the trick's value picks `freezeMs` (120/160/200, never × tempo,
 * ui/variant.ts); `quick` scales it ×0.6 floored at 80; reduced motion and `off` show the 300 ms still.
 */
export const freezeMsFor = (freezeMs: number, speed: Speed, reducedMotion: boolean): number =>
  reducedMotion || speed === 'off'
    ? STILL_MS
    : speed === 'quick'
      ? Math.max(IMPACT_FLOOR_MS, Math.round(freezeMs * 0.6))
      : freezeMs;

/**
 * §3.2's budget: from the completing paint to the chip's landing, the clash's stages at `tempo`
 * plus the hit-stop and the pack (`flyMs`); the §6 invariant keeps every (tempo, value class)
 * under `BUDGET_MS`.
 */
export const BUDGET_MS = 1650;

// ---- the deal (§7 H, §2.2 A3: "3 carte … una alla volta") ------------------------------------------------

/** The deal's rounds: one card per seat a round, the leader first. */
export const DEAL_ROUNDS = 3;

/**
 * How long the deal of `cards` cards holds at this device's speed: each leaves `dealGap` after the
 * one before and the last lands `deal` later; 0 for no cards. Every seat count (6, 9 or 12 cards)
 * stays under `BUDGET_MS` at normal, shorter at quick; under reduced motion a millisecond a card.
 */
export const dealMs = (cards: number, speed: Speed, reducedMotion: boolean): number =>
  cards <= 0
    ? 0
    : (cards - 1) * stageMs('dealGap', speed, reducedMotion) +
      stageMs('deal', speed, reducedMotion);
export const clashBudgetMs = (tempo: number, freezeMs: number, speed: Speed = 'normal'): number =>
  stageMs('followLast', speed, false) +
  stageMs('charge', speed, false, tempo) +
  stageMs('strike', speed, false, tempo) +
  freezeMsFor(freezeMs, speed, false) +
  stageMs('aftermath', speed, false, tempo) +
  durationsFor(speed, false).flyMs;
