// Sheshbesh's one sound table (docs/design/backgammon-board.md §5.1 "Sound"; docs/design/sound-fonts.md §5):
// each event the reducer raises (ui/state.ts `cuesBetween`, plus the tap) named as a generic cue
// every font composes for, beside its vibration pattern. No notes live here: the shipped fonts
// (web/shared/lib/sound/fonts/*.ts) voice each cue, and src/fx.ts plays a row through the shared
// edge with the App's font. The buzz stays here because a vibration is not part of a font (§1
// "Haptics"). Nothing else in the game names a sound.
import { SHELL_CUES, type CueSpec } from '../../../../shared/lib/sound/cues.ts';
import type { CueMemory } from '../../../../shared/ui/shell.ts';

/** The events of the table (design §5.1): the reducer derives them from the change between two views, and `doubles` from the settled roll (§4.7). */
export type Cue =
  'roll' | 'place' | 'hit' | 'bearOff' | 'yourTurn' | 'win' | 'lose' | 'double' | 'doubles';

// `CueSpec` (one row: the cue the font voices, and a vibration pattern) is web/shared/lib's since
// DRY round 2 (dry-round-2.md E9); re-exported so this module's import path holds.
export type { CueSpec };

export const CUES: Readonly<Record<Cue | 'tap', CueSpec>> = {
  // The shell's four rows (tap, yourTurn, win, lose), the same in every game (E9).
  ...SHELL_CUES,
  roll: { cue: 'roll', buzz: [20, 30, 20] },
  // A double, as the tumble settles on it (the owner, 2026-09-24: "a small excited sound"): the
  // font's favourable notice, small and quick, with a light buzz; both seats hear it, as both hear the roll.
  doubles: { cue: 'good', buzz: [30, 40, 30] },
  place: { cue: 'move', buzz: 15 },
  // A blot sent to the bar: the font's capture, and the buzz the hit player feels.
  hit: { cue: 'capture', buzz: [60, 40, 60] },
  bearOff: { cue: 'score', buzz: 25 },
  double: { cue: 'challenge', buzz: [50, 50, 90] },
};

/**
 * The cue machine's memory (ui/state.ts `rendered`): the view the last cues were played for, so a
 * re-sent frame plays none. The shared `CueMemory` as it is (docs/design/dry-round-2.md F6: the
 * once-per-key rule is web/shared/ui/shell.ts `fresh`; the cues themselves stay `cuesBetween`'s).
 * Here rather than in state.ts because the shell config (shellConfig.ts) starts the shell with it,
 * and state.ts imports that config.
 */
export type CueState = CueMemory;
export const INITIAL_CUES: CueState = { key: null };
