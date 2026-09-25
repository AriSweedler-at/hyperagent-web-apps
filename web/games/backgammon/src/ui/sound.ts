// Sheshbesh's one sound table (docs/design/backgammon-board.md §5.1 "Sound"; docs/design/sound-fonts.md §5):
// each event the reducer raises (ui/state.ts `cuesBetween`, plus the tap) named as a generic cue
// every font composes for, beside its vibration pattern. No notes live here: the shipped fonts
// (web/shared/lib/sound/fonts/*.ts) voice each cue, and src/fx.ts plays a row through the shared
// edge with the App's font. The buzz stays here because a vibration is not part of a font (§1
// "Haptics"). Nothing else in the game names a sound.
import type { SoundCue } from '../../../../shared/lib/sound/cues.ts';

/** The events of the table (design §5.1): the reducer derives them from the change between two views, and `doubles` from the settled roll (§4.7). */
export type Cue =
  'roll' | 'place' | 'hit' | 'bearOff' | 'yourTurn' | 'win' | 'lose' | 'double' | 'doubles';

/** What one event plays: the cue the font voices, and a vibration pattern. */
export type CueSpec = Readonly<{ cue: SoundCue; buzz: number | ReadonlyArray<number> }>;

export const CUES: Readonly<Record<Cue | 'tap', CueSpec>> = {
  tap: { cue: 'tap', buzz: 12 },
  roll: { cue: 'roll', buzz: [20, 30, 20] },
  // A double, as the tumble settles on it (the owner, 2026-09-24: "a small excited sound"): the
  // font's favourable notice, small and quick, with a light buzz; both seats hear it, as both hear the roll.
  doubles: { cue: 'good', buzz: [30, 40, 30] },
  place: { cue: 'move', buzz: 15 },
  // A blot sent to the bar: the font's capture, and the buzz the hit player feels.
  hit: { cue: 'capture', buzz: [60, 40, 60] },
  bearOff: { cue: 'score', buzz: 25 },
  yourTurn: { cue: 'turn', buzz: [40, 60, 40] },
  double: { cue: 'challenge', buzz: [50, 50, 90] },
  win: { cue: 'victory', buzz: [80, 50, 80, 50, 200] },
  lose: { cue: 'loss', buzz: [200] },
};
