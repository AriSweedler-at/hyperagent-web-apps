// Gin's one sound table (docs/design/sound-fonts.md §5): each event the reducer or the scorer
// raises (ui/cues.ts `Cue`, plus the tap) named as a generic cue every font composes for, beside
// its vibration pattern. The notes that used to sit here (the legacy `fx` object's numbers,
// docs/MIGRATION.md step 12) live in the `default` font (web/shared/lib/sound/fonts/default.ts)
// under these cue names; fx.test.ts pins that the default font still plays them number for
// number. The buzz stays here because a vibration is not part of a font (§1 "Haptics"). Nothing
// else in the game names a sound: fx.ts plays a row through the shared edge with the App's font.
import type { SoundCue } from '../../../../shared/lib/sound/cues.ts';
import type { Cue } from './cues.ts';

/** What one event plays: the cue the font voices, and a vibration pattern. */
export type CueSpec = Readonly<{ cue: SoundCue; buzz: number | ReadonlyArray<number> }>;

export const CUES: Readonly<Record<Cue | 'tap', CueSpec>> = {
  tap: { cue: 'tap', buzz: 12 },
  yourTurn: { cue: 'turn', buzz: [40, 60, 40] },
  knockGood: { cue: 'good', buzz: [30, 40, 30, 40, 60] },
  gin: { cue: 'great', buzz: [50, 50, 50, 50, 120] },
  bad: { cue: 'bad', buzz: [120] },
  neutral: { cue: 'neutral', buzz: 30 },
  win: { cue: 'victory', buzz: [80, 50, 80, 50, 200] },
  lose: { cue: 'loss', buzz: [200] },
  // The opponent's pickup (ui/cues.ts `oppDrawCue`): the stock is face down, the discard pile face up.
  oppStock: { cue: 'draw', buzz: 15 },
  oppDiscard: { cue: 'pickup', buzz: 15 },
};
