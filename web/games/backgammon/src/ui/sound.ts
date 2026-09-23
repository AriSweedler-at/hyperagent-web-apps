// Sheshbesh's one sound table (scratchpad/bg/design.md §4 "Sound"; docs/design/sound-fonts.md §5):
// each event the reducer raises (ui/state.ts `cuesBetween`, plus the tap) named as a generic cue
// every font composes for, beside its vibration pattern. No notes live here: the shipped fonts
// (web/shared/lib/sound/fonts/*.ts) voice each cue, and src/fx.ts plays a row through the shared
// edge with the App's font. The buzz stays here because a vibration is not part of a font (§1
// "Haptics"). Nothing else in the game names a sound.
import type { SoundCue } from '../../../../shared/lib/sound/cues.ts';

/** The events of the table (design §4): the reducer derives them from the change between two views. */
export type Cue = 'roll' | 'place' | 'hit' | 'bearOff' | 'yourTurn' | 'win' | 'lose' | 'double';

/** What one event plays: the cue the font voices, and a vibration pattern. */
export type CueSpec = Readonly<{ cue: SoundCue; buzz: number | ReadonlyArray<number> }>;

export const CUES: Readonly<Record<Cue | 'tap', CueSpec>> = {
  tap: { cue: 'tap', buzz: 12 },
  roll: { cue: 'roll', buzz: [20, 30, 20] },
  place: { cue: 'move', buzz: 15 },
  // A blot sent to the bar: the font's capture, and the buzz the hit player feels.
  hit: { cue: 'capture', buzz: [60, 40, 60] },
  bearOff: { cue: 'score', buzz: 25 },
  yourTurn: { cue: 'turn', buzz: [40, 60, 40] },
  double: { cue: 'challenge', buzz: [50, 50, 90] },
  win: { cue: 'victory', buzz: [80, 50, 80, 50, 200] },
  lose: { cue: 'loss', buzz: [200] },
};
