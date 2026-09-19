// The gin sound cues as data (docs/MIGRATION.md step 12): the notes, oscillator type, gain and
// vibration pattern of each method of the legacy `fx` object (legacy/gin-rummy/index.html),
// number for number. `fx.ts` plays them through web/shared/edge/fx.ts; this module holds only the
// tables, so it stays pure and the cue machine (ui/cues.ts) and the tables are tested without audio.
import type { Cue } from './cues.ts';

// The shapes web/shared/edge/fx.ts plays, spelled here because ui/ may reach no edge but dom
// (docs/ARCHITECTURE.md "Module boundaries"); `AudioCues.seq` takes them structurally.
export type OscillatorType = 'sine' | 'square' | 'sawtooth' | 'triangle';
/** One note: frequency in Hz, duration in seconds, and the gap to the next note (defaults to `dur`). */
export type Note = Readonly<{ freq: number; dur: number; gap?: number }>;

/** What one cue plays: a note sequence with its voice, and a vibration pattern. */
export type CueSpec = Readonly<{
  notes: ReadonlyArray<Note>;
  type: OscillatorType;
  gain: number;
  buzz: number | ReadonlyArray<number>;
}>;

const note = (freq: number, dur: number, gap?: number): Note =>
  gap === undefined ? { freq, dur } : { freq, dur, gap };

/** `fx.tap()`: one short triangle blip. */
export const TAP: CueSpec = { notes: [note(660, 0.05)], type: 'triangle', gain: 0.08, buzz: 12 };

/** The seven named cues `playCuesFor` fires. */
export const CUES: Readonly<Record<Cue, CueSpec>> = {
  yourTurn: {
    notes: [note(523, 0.12, 0.13), note(784, 0.22)],
    type: 'sine',
    gain: 0.2,
    buzz: [40, 60, 40],
  },
  knockGood: {
    notes: [note(587, 0.1, 0.11), note(740, 0.1, 0.11), note(880, 0.28)],
    type: 'triangle',
    gain: 0.2,
    buzz: [30, 40, 30, 40, 60],
  },
  gin: {
    notes: [note(523, 0.09, 0.1), note(659, 0.09, 0.1), note(784, 0.09, 0.1), note(1047, 0.36)],
    type: 'triangle',
    gain: 0.22,
    buzz: [50, 50, 50, 50, 120],
  },
  bad: {
    notes: [note(440, 0.14, 0.15), note(330, 0.3)],
    type: 'sawtooth',
    gain: 0.09,
    buzz: [120],
  },
  neutral: { notes: [note(494, 0.18)], type: 'sine', gain: 0.12, buzz: 30 },
  win: {
    notes: [
      note(523, 0.12, 0.13),
      note(659, 0.12, 0.13),
      note(784, 0.12, 0.13),
      note(1047, 0.18, 0.2),
      note(784, 0.1, 0.11),
      note(1047, 0.45),
    ],
    type: 'triangle',
    gain: 0.22,
    buzz: [80, 50, 80, 50, 200],
  },
  lose: {
    notes: [note(392, 0.2, 0.22), note(349, 0.2, 0.22), note(294, 0.45)],
    type: 'sine',
    gain: 0.14,
    buzz: [200],
  },
};
