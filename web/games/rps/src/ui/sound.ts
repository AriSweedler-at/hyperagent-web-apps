// The page's cue table (docs/design/rps-island.md §3 step 3: "a short beep" at the resolve; the
// verdicts and the ladder have a sound each): every event the reducer raises onto a generic cue of
// the shared vocabulary (web/shared/lib/sound/cues.ts) and its buzz, played by the shared cue
// player in the chosen font. The resolve's row carries the owner's haptic (30 ms) so a phone with
// sound on buzzes once with the beep; main.ts buzzes the same 30 ms itself when sound is off,
// since the cue player skips a muted row's buzz.
import { SHELL_CUES, type CueSpec } from '../../../../shared/lib/sound/cues.ts';

/** The events with a sound: the resolve, the four verdicts, the Tech up and the Reset. */
export type Cue = 'resolve' | 'win' | 'tie' | 'loss' | 'timeout' | 'techUp' | 'reset';

/** The haptic at the resolve (§3 step 3), the same whether the row or main.ts fires it. */
export const RESOLVE_BUZZ_MS = 30;

export const CUES: Readonly<Record<Cue | 'tap', CueSpec>> = {
  tap: SHELL_CUES.tap,
  resolve: { cue: 'start', buzz: RESOLVE_BUZZ_MS },
  win: { cue: 'good', buzz: 40 },
  tie: { cue: 'neutral', buzz: 20 },
  loss: { cue: 'bad', buzz: [60] },
  timeout: { cue: 'bad.timeout', buzz: [60, 40, 60] },
  techUp: { cue: 'great', buzz: [80, 50, 80] },
  reset: { cue: 'undo', buzz: 20 },
};
