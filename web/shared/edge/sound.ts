// The shared sound player (docs/design/sound-fonts.md §3, §9): one Sound (web/shared/lib/sound/
// sound.ts) to the speaker, at an offset. A `synth` goes through `AudioCues.seq`, the legacy gin
// envelope; a `sample` is fetched through the injected `fetchBuffer`, decoded by the cues' own
// context and played from a buffer source into that context's destination, once per URL (the
// decoded buffer is cached in `deps.cache`, failures included, so a bad file is asked for once);
// `silence` does nothing. Every failure is silent, as the rest of this edge: a cue is never worth
// a crash. Since the phrases (sound-fonts.md §2.2) a caller hands `Slot`s (lib/sound/phrase.ts
// `schedule`: the sound and its offset from now) and each is booked at `currentTime + atMs`:
// Web Audio schedules ahead, so a whole phrase queues in one tick and the edge never waits for a
// step to end before starting the next. A game's fx.ts reaches this through the cue player; the
// cues' `enabled` still gates everything, because a disabled `AudioCues` has no context and plays
// no sequence.
import { schedule, type Phrase, type Slot } from '../lib/sound/phrase.ts';
import type { SoundFont } from '../lib/sound/fonts.ts';
import type { Sound } from '../lib/sound/sound.ts';
import type { AudioBufferLike, AudioContextLike, AudioCues } from './fx.ts';

/** Decoded samples by URL; null remembers a fetch or decode that failed. One per page (main.ts). */
export type SampleCache = Readonly<{
  get: (url: string) => Promise<AudioBufferLike | null> | undefined;
  set: (url: string, sample: Promise<AudioBufferLike | null>) => void;
  size: () => number;
}>;

export const createSampleCache = (): SampleCache => {
  const samples = new Map<string, Promise<AudioBufferLike | null>>();
  return {
    get: (url) => samples.get(url),
    set: (url, sample) => {
      samples.set(url, sample);
    },
    size: () => samples.size,
  };
};

export type SoundDeps = Readonly<{
  /** `fetch(url).then((r) => r.arrayBuffer())` on the page; rejects on a network or HTTP error. */
  fetchBuffer: (url: string) => Promise<ArrayBuffer>;
  cache: SampleCache;
}>;

const decodeInto = (c: AudioContextLike, bytes: ArrayBuffer): Promise<AudioBufferLike | null> =>
  c.decodeAudioData === undefined ? Promise.resolve(null) : c.decodeAudioData(bytes);

/**
 * How far past its slot a sample may still start (briscola-sound-history.md §3.4, risk 2): a
 * sample not decoded when its slot arrives is skipped, never late, so the steps after it keep
 * their places. The grace exists because `currentTime` advances per render quantum and the
 * decoded buffer arrives a microtask after the slot was booked: without it a CACHED sample at
 * offset 0 would read as late by a hair and never play.
 */
export const SAMPLE_LATE_MS = 120;

const startSource = (
  c: AudioContextLike,
  buffer: AudioBufferLike,
  gain: number,
  when: number,
): void => {
  try {
    if (c.createBufferSource === undefined) return;
    const src = c.createBufferSource();
    const g = c.createGain();
    // A buffer source is mutable by nature; `buffer` is the one field set directly (as fx.ts sets an oscillator's type).
    (src as { buffer: AudioBufferLike | null }).buffer = buffer;
    g.gain.setValueAtTime(gain, when);
    src.connect(g).connect(c.destination);
    src.start(when);
  } catch {
    /* a closed context or a bad buffer: no cue, no crash */
  }
};

/** The decoded sample, from the cache or fetched and decoded now; the cache remembers a failure as null. */
const sampleOf = (
  c: AudioContextLike,
  url: string,
  deps: SoundDeps,
): Promise<AudioBufferLike | null> => {
  const cached =
    deps.cache.get(url) ??
    deps
      .fetchBuffer(url)
      .then((bytes) => decodeInto(c, bytes))
      .catch(() => null);
  deps.cache.set(url, cached);
  return cached;
};

const playSampleAt = (
  audio: AudioCues,
  url: string,
  gain: number,
  atMs: number,
  deps: SoundDeps,
): void => {
  const c = audio.context();
  if (c?.state !== 'running') return;
  const when = c.currentTime + atMs / 1000;
  void sampleOf(c, url, deps).then((buffer) => {
    if (buffer !== null && c.currentTime - when <= SAMPLE_LATE_MS / 1000) {
      startSource(c, buffer, gain, when);
    }
  });
};

/** One slot: its sound `atMs` from now; silent when disabled, unsupported or failing. */
export const playSlot = (audio: AudioCues, slot: Slot, deps: SoundDeps): void => {
  const { sound, atMs } = slot;
  switch (sound.kind) {
    case 'synth':
      audio.seq(sound.notes, sound.voice, sound.gain, atMs / 1000);
      return;
    case 'sample':
      playSampleAt(audio, sound.url, sound.gain, atMs, deps);
      return;
    case 'silence':
      return;
  }
};

/** Play one sound now: the one-slot case every table row is. */
export const playSound = (audio: AudioCues, sound: Sound, deps: SoundDeps): void => {
  playSlot(audio, { sound, atMs: 0, ms: 0 }, deps);
};

/**
 * Fetch and decode every sample the slots name without playing (sound-history.md §3.4 "warms
 * every URL"): on the first gesture over a table, and before a phrase's first step, so a later
 * step's bytes are ready by its slot. Needs a context (made by `warm`), not a running one.
 */
export const warmSamples = (
  audio: AudioCues,
  slots: ReadonlyArray<Slot>,
  deps: SoundDeps,
): void => {
  const c = audio.context();
  if (c === null) return;
  slots.forEach(({ sound }) => {
    if (sound.kind === 'sample') void sampleOf(c, sound.url, deps);
  });
};

/** Every slot of the schedule, booked in one tick; the samples are warmed first. */
export const playSlots = (audio: AudioCues, slots: ReadonlyArray<Slot>, deps: SoundDeps): void => {
  warmSamples(audio, slots, deps);
  slots.forEach((slot) => {
    playSlot(audio, slot, deps);
  });
};

/** A phrase in a font: its schedule, played. */
export const playPhrase = (
  audio: AudioCues,
  font: SoundFont,
  phrase: Phrase,
  deps: SoundDeps,
): void => {
  playSlots(audio, schedule(font, phrase), deps);
};
