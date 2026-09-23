// The shared sound player (docs/design/sound-fonts.md §3, §9): one Sound (web/shared/lib/sound/
// sound.ts) to the speaker. A `synth` goes through `AudioCues.seq`, the legacy gin envelope; a
// `sample` is fetched through the injected `fetchBuffer`, decoded by the cues' own context and
// played from a buffer source into that context's destination, once per URL (the decoded buffer is
// cached in `deps.cache`, failures included, so a bad file is asked for once); `silence` does
// nothing. Every failure is silent, as the rest of this edge: a cue is never worth a crash. A game's
// fx.ts calls `playSound` with the sound its font resolves; the cues' `enabled` still gates
// everything, because a disabled `AudioCues` has no context and plays no sequence.
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

const startSource = (c: AudioContextLike, buffer: AudioBufferLike, gain: number): void => {
  try {
    if (c.createBufferSource === undefined) return;
    const src = c.createBufferSource();
    const g = c.createGain();
    // A buffer source is mutable by nature; `buffer` is the one field set directly (as fx.ts sets an oscillator's type).
    (src as { buffer: AudioBufferLike | null }).buffer = buffer;
    g.gain.setValueAtTime(gain, c.currentTime);
    src.connect(g).connect(c.destination);
    src.start(c.currentTime);
  } catch {
    /* a closed context or a bad buffer: no cue, no crash */
  }
};

const playSample = (audio: AudioCues, url: string, gain: number, deps: SoundDeps): void => {
  const c = audio.context();
  if (c?.state !== 'running') return;
  const cached =
    deps.cache.get(url) ??
    deps
      .fetchBuffer(url)
      .then((bytes) => decodeInto(c, bytes))
      .catch(() => null);
  deps.cache.set(url, cached);
  void cached.then((buffer) => {
    if (buffer !== null) startSource(c, buffer, gain);
  });
};

/** Play one sound through the cues; silent when disabled, unsupported or failing. */
export const playSound = (audio: AudioCues, sound: Sound, deps: SoundDeps): void => {
  switch (sound.kind) {
    case 'synth':
      audio.seq(sound.notes, sound.voice, sound.gain);
      return;
    case 'sample':
      playSample(audio, sound.url, sound.gain, deps);
      return;
    case 'silence':
      return;
  }
};
