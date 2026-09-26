// Fidice's sound table on the shell path (docs/design/fidice-shell-adoption.md §3 "Sound", §7
// D11): the four rows every game's table carries, the shared `SHELL_CUES` byte for byte
// (web/shared/lib/sound/cues.ts: the shell taps on a touch, chimes the turn, plays the win and
// the loss; docs/design/dry-round-2.md E9), and nothing else yet. The shell requires an `fx`
// (web/shared/edge/boot.ts), so sound arrives with the shell markup at M4, muted by default on a
// coarse pointer (web/shared/edge/prefs.ts `soundPref.enabled`); fidice's own cues (the roll, the
// bid, the call, the reveal, a refused action) are M9's rows under these four, a feature named in
// that PR's body. The cue memory (`CueState`) is the shell's `CueMemory`: the key of the position
// the cues last played for, so a re-sent frame chimes nothing. No notes live here: the fonts
// (web/shared/lib/sound/fonts/*.ts) voice each cue, src/fx.ts plays a row through the shared edge.
import { SHELL_CUES, type CueSpec } from '../../../../shared/lib/sound/cues.ts';
import type { CueMemory } from '../../../../shared/ui/shell.ts';

export type { CueSpec };

/** The table: the shell's four rows, the same in every game (dry-round-2.md E9); M9 adds fidice's. */
export const CUES = {
  ...SHELL_CUES,
} as const satisfies Readonly<Record<string, CueSpec>>;

/** The events the table names beyond the shell's `tap` (which the bag's `Cue<G>` adds itself). */
export type Cue = Exclude<keyof typeof CUES, 'tap'>;
export type CueName = keyof typeof CUES;

/** What the cue machine remembers between paints (web/shared/ui/shell.ts `CueMemory`): the position it last played for. */
export type CueState = CueMemory;
export const INITIAL_CUES: CueState = { key: null };
