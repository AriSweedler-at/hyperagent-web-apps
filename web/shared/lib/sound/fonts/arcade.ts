// The `arcade` font (docs/design/sound-fonts.md §4): the 8-bit register. Square waves throughout,
// crisp attacks (gaps barely longer than the notes), fanfares that climb a fifth further than the
// default's; gains sit lower because a square wave carries more energy than a sine at the same gain.
import type { SoundFont } from '../fonts.ts';
import { note, synth } from '../sound.ts';

export const ARCADE_FONT: SoundFont = {
  name: 'arcade',
  label: 'Arcade',
  sounds: {
    tap: synth('square', 0.05, [note(880, 0.03)]),
    move: synth('square', 0.06, [note(330, 0.04)]),
    pickup: synth('square', 0.06, [note(523, 0.04, 0.045), note(659, 0.06)]),
    draw: synth('square', 0.06, [note(440, 0.04, 0.045), note(349, 0.06)]),
    roll: synth('square', 0.05, [
      note(988, 0.025, 0.03),
      note(784, 0.025, 0.03),
      note(1175, 0.025, 0.03),
      note(880, 0.06),
    ]),
    capture: synth('square', 0.07, [
      note(784, 0.05, 0.055),
      note(392, 0.05, 0.055),
      note(196, 0.1),
    ]),
    score: synth('square', 0.08, [note(659, 0.05, 0.055), note(988, 0.05, 0.055), note(1319, 0.1)]),
    undo: synth('square', 0.06, [note(659, 0.05, 0.055), note(523, 0.07)]),
    start: synth('square', 0.08, [
      note(523, 0.06, 0.065),
      note(659, 0.06, 0.065),
      note(784, 0.06, 0.065),
      note(1047, 0.12),
    ]),
    turn: synth('square', 0.1, [note(659, 0.08, 0.09), note(988, 0.16)]),
    good: synth('square', 0.1, [note(784, 0.06, 0.07), note(988, 0.06, 0.07), note(1175, 0.2)]),
    great: synth('square', 0.12, [
      note(523, 0.06, 0.07),
      note(659, 0.06, 0.07),
      note(784, 0.06, 0.07),
      note(1047, 0.06, 0.07),
      note(1319, 0.3),
    ]),
    bad: synth('square', 0.08, [note(330, 0.1, 0.11), note(247, 0.2)]),
    neutral: synth('square', 0.06, [note(587, 0.12)]),
    challenge: synth('square', 0.1, [note(440, 0.08, 0.09), note(880, 0.16)]),
    victory: synth('square', 0.12, [
      note(523, 0.1, 0.11),
      note(659, 0.1, 0.11),
      note(784, 0.1, 0.11),
      note(1047, 0.15, 0.17),
      note(784, 0.08, 0.09),
      note(1047, 0.4),
    ]),
    loss: synth('square', 0.09, [note(392, 0.15, 0.17), note(330, 0.15, 0.17), note(262, 0.4)]),
    connection: synth('square', 0.07, [note(659, 0.05, 0.06), note(988, 0.1)]),
    disconnect: synth('square', 0.07, [note(988, 0.05, 0.06), note(659, 0.12)]),
    invite: synth('square', 0.07, [note(880, 0.05, 0.06), note(1319, 0.1)]),
  },
};
