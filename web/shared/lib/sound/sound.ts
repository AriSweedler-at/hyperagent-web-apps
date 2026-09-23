// Sounds as data (docs/design/sound-fonts.md §3): what a font says a cue sounds like, with no
// audio API in sight. `synth` is what every shipped font uses (web/shared/edge/sound.ts plays the
// notes through `AudioCues.seq`, the legacy gin envelope); `sample` is the seam for a recorded
// font (a document-relative URL, fetched and decoded once by the edge); `silence` mutes a cue on
// purpose. The three types were spelled in web/shared/edge/fx.ts until the fonts needed them
// below the edge; that module imports them from here now.

/** The four Web Audio oscillator voices, spelled here so the pure layer names no DOM type. */
export type OscillatorType = 'sine' | 'square' | 'sawtooth' | 'triangle';
/** One note: frequency in Hz, duration in seconds, and the gap to the next note (defaults to `dur`). */
export type Note = Readonly<{ freq: number; dur: number; gap?: number }>;

export type Sound =
  | Readonly<{ kind: 'synth'; notes: ReadonlyArray<Note>; voice: OscillatorType; gain: number }>
  | Readonly<{ kind: 'sample'; url: string; gain: number }>
  | Readonly<{ kind: 'silence' }>;

/** A note without a `gap` key when none is given, so a font's literal reads as the legacy tables did. */
export const note = (freq: number, dur: number, gap?: number): Note =>
  gap === undefined ? { freq, dur } : { freq, dur, gap };

export const synth = (voice: OscillatorType, gain: number, notes: ReadonlyArray<Note>): Sound => ({
  kind: 'synth',
  notes,
  voice,
  gain,
});

export const sample = (url: string, gain: number): Sound => ({ kind: 'sample', url, gain });

export const SILENCE: Sound = { kind: 'silence' };

/** Gains stay in this range: the legacy tables peaked at 0.22, and a square wave at 0.3 is already loud. */
export const MAX_GAIN = 0.3;
