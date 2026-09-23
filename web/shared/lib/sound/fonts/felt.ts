// The `felt` font (docs/design/sound-fonts.md §4): a quiet table. Sine and triangle voices only,
// gains about half the default's, tails cut short, the same shapes (a rising pair is still a
// rising pair) so a player who knows the default still knows what happened.
import type { SoundFont } from '../fonts.ts';
import { note, synth } from '../sound.ts';

export const FELT_FONT: SoundFont = {
  name: 'felt',
  label: 'Felt',
  sounds: {
    tap: synth('sine', 0.05, [note(660, 0.03)]),
    move: synth('sine', 0.08, [note(262, 0.04)]),
    pickup: synth('sine', 0.06, [note(494, 0.05, 0.06), note(587, 0.07)]),
    draw: synth('sine', 0.06, [note(392, 0.05, 0.06), note(330, 0.07)]),
    roll: synth('triangle', 0.05, [
      note(784, 0.03, 0.035),
      note(659, 0.03, 0.035),
      note(880, 0.06),
    ]),
    capture: synth('triangle', 0.07, [note(523, 0.05, 0.06), note(392, 0.09)]),
    score: synth('sine', 0.08, [note(659, 0.06, 0.07), note(988, 0.1)]),
    undo: synth('sine', 0.06, [note(587, 0.05, 0.06), note(494, 0.07)]),
    start: synth('sine', 0.08, [note(523, 0.06, 0.07), note(659, 0.06, 0.07), note(784, 0.1)]),
    turn: synth('sine', 0.12, [note(523, 0.1, 0.11), note(784, 0.16)]),
    good: synth('sine', 0.1, [note(587, 0.08, 0.09), note(880, 0.18)]),
    great: synth('sine', 0.12, [
      note(523, 0.07, 0.08),
      note(659, 0.07, 0.08),
      note(784, 0.07, 0.08),
      note(1047, 0.24),
    ]),
    bad: synth('triangle', 0.07, [note(440, 0.1, 0.11), note(330, 0.18)]),
    neutral: synth('sine', 0.07, [note(494, 0.12)]),
    challenge: synth('sine', 0.1, [note(440, 0.08, 0.1), note(880, 0.14)]),
    victory: synth('sine', 0.12, [
      note(523, 0.1, 0.11),
      note(659, 0.1, 0.11),
      note(784, 0.1, 0.11),
      note(1047, 0.3),
    ]),
    loss: synth('sine', 0.09, [note(392, 0.14, 0.16), note(294, 0.3)]),
    connection: synth('sine', 0.08, [note(659, 0.06, 0.07), note(880, 0.1)]),
    disconnect: synth('sine', 0.08, [note(880, 0.06, 0.07), note(659, 0.12)]),
    invite: synth('sine', 0.07, [note(784, 0.05, 0.06), note(1047, 0.09)]),
  },
};
