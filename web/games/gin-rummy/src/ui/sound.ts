// Gin's one sound table (docs/design/sound-fonts.md §5): each event the reducer or the scorer
// raises (ui/cues.ts `Cue`, plus the tap) named as a generic cue every font composes for, beside
// its vibration pattern. The notes that used to sit here (the legacy `fx` object's numbers,
// docs/MIGRATION.md step 12) live in the `default` font (web/shared/lib/sound/fonts/default.ts)
// under these cue names; fx.test.ts pins that the default font still plays them number for
// number. The buzz stays here because a vibration is not part of a font (§1 "Haptics"). Nothing
// else in the game names a sound: fx.ts plays a row through the shared edge with the App's font.
import { SHELL_CUES, type CueSpec } from '../../../../shared/lib/sound/cues.ts';
import type { Cue } from './cues.ts';

// `CueSpec` (one row: the cue the font voices, and a vibration pattern) is web/shared/lib's since
// DRY round 2 (dry-round-2.md E9); re-exported so this module's import path holds.
export type { CueSpec };

export const CUES: Readonly<Record<Cue | 'tap', CueSpec>> = {
  // The shell's four rows (tap, yourTurn, win, lose), the same in every game (E9).
  ...SHELL_CUES,
  knockGood: { cue: 'good', buzz: [30, 40, 30, 40, 60] },
  gin: { cue: 'great', buzz: [50, 50, 50, 50, 120] },
  bad: { cue: 'bad', buzz: [120] },
  neutral: { cue: 'neutral', buzz: 30 },
  // The opponent's pickup (ui/cues.ts `oppDrawCue`): the stock is face down, the discard pile face up.
  oppStock: { cue: 'draw', buzz: 15 },
  oppDiscard: { cue: 'pickup', buzz: 15 },
};
