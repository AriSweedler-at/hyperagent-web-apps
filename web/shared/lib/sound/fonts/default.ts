// The `default` font (docs/design/sound-fonts.md §4): gin's legacy tones (legacy/gin-rummy/
// index.html `fx`, then web/games/gin-rummy/src/ui/sound.ts) number for number under their generic
// names, plus composed sounds in the same register for the cues gin never had. Total over the cues
// by type, so `resolveSound` always has a fallback; gin's fx.test.ts pins the legacy numbers.
import type { SoundCue } from '../cues.ts';
import type { SoundFont } from '../fonts.ts';
import { note, synth, type Sound } from '../sound.ts';

export const DEFAULT_SOUNDS: Readonly<Record<SoundCue, Sound>> = {
  // ---- the legacy gin numbers, renamed: tap, yourTurn, knockGood, gin, bad, neutral, win, lose,
  // oppStock (draw), oppDiscard (pickup) ----
  tap: synth('triangle', 0.08, [note(660, 0.05)]),
  turn: synth('sine', 0.2, [note(523, 0.12, 0.13), note(784, 0.22)]),
  good: synth('triangle', 0.2, [note(587, 0.1, 0.11), note(740, 0.1, 0.11), note(880, 0.28)]),
  great: synth('triangle', 0.22, [
    note(523, 0.09, 0.1),
    note(659, 0.09, 0.1),
    note(784, 0.09, 0.1),
    note(1047, 0.36),
  ]),
  bad: synth('sawtooth', 0.09, [note(440, 0.14, 0.15), note(330, 0.3)]),
  neutral: synth('sine', 0.12, [note(494, 0.18)]),
  victory: synth('triangle', 0.22, [
    note(523, 0.12, 0.13),
    note(659, 0.12, 0.13),
    note(784, 0.12, 0.13),
    note(1047, 0.18, 0.2),
    note(784, 0.1, 0.11),
    note(1047, 0.45),
  ]),
  loss: synth('sine', 0.14, [note(392, 0.2, 0.22), note(349, 0.2, 0.22), note(294, 0.45)]),
  // A draw from the stock falls (a card slid off the pile), a pickup from the discard pile rises
  // (a card taken up), so the ear tells the two apart; both quieter than the turn chime.
  draw: synth('triangle', 0.09, [note(392, 0.06, 0.07), note(330, 0.09)]),
  pickup: synth('triangle', 0.1, [note(494, 0.06, 0.07), note(587, 0.09)]),
  // ---- composed for the cues gin never had, in the same sine-and-triangle register ----
  /** One low tock: a piece set down. */
  move: synth('sine', 0.12, [note(262, 0.06)]),
  /** A quick rattle that lands on one note. */
  roll: synth('triangle', 0.08, [
    note(880, 0.03, 0.035),
    note(740, 0.03, 0.035),
    note(988, 0.03, 0.035),
    note(659, 0.03, 0.035),
    note(784, 0.08),
  ]),
  /** Sharp and falling: a piece sent back. */
  capture: synth('sawtooth', 0.08, [note(660, 0.06, 0.07), note(440, 0.12)]),
  /** Light and rising: points banked. */
  score: synth('triangle', 0.12, [note(659, 0.07, 0.08), note(988, 0.14)]),
  /** A gentle step back. */
  undo: synth('sine', 0.1, [note(587, 0.07, 0.08), note(494, 0.1)]),
  /** Three quick rising notes: the deal. */
  start: synth('triangle', 0.14, [note(523, 0.08, 0.09), note(659, 0.08, 0.09), note(784, 0.16)]),
  /** An octave leap: a stake raised. */
  challenge: synth('triangle', 0.14, [note(440, 0.1, 0.12), note(880, 0.2)]),
  /** A rising pair: someone arrived. */
  connection: synth('sine', 0.12, [note(659, 0.08, 0.09), note(880, 0.14)]),
  /** The same pair falling: someone left. */
  disconnect: synth('sine', 0.12, [note(880, 0.08, 0.09), note(659, 0.16)]),
  /** A light chime: the invite is out. */
  invite: synth('triangle', 0.1, [note(784, 0.06, 0.07), note(1047, 0.12)]),
};

export const DEFAULT_FONT: SoundFont = {
  name: 'default',
  label: 'Default',
  sounds: DEFAULT_SOUNDS,
};
