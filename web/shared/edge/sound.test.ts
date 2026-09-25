// The sound player over fakes (docs/design/sound-fonts.md §10 "edge"): each kind of Sound, a
// failing fetch and a failing decode both silent, and the sample cache fetching once per URL.
// Since the phrases (§2.2): a slot books its sound `atMs` ahead on the context's clock, a sample
// whose slot passed while it decoded is skipped (never late), warming fetches without playing,
// and a two-step phrase queues in one tick.
import { describe, expect, test } from 'vitest';

import type { SoundFont } from '../lib/sound/fonts.ts';
import { note } from '../lib/sound/sound.ts';
import type { AudioBufferLike, AudioContextLike, AudioCues, AudioNodeLike } from './fx.ts';
import {
  SAMPLE_LATE_MS,
  createSampleCache,
  playPhrase,
  playSlot,
  playSlots,
  playSound,
  warmSamples,
  type SoundDeps,
} from './sound.ts';

type Call = ReadonlyArray<unknown>;

type World = Readonly<{
  audio: AudioCues;
  calls: Call[];
  fetched: string[];
  deps: SoundDeps;
  /** Settle every promise the player chained. */
  flush: () => Promise<void>;
  /** Move the context's clock (seconds): what the audio thread does while a sample decodes. */
  tick: (seconds: number) => void;
}>;

type Options = Readonly<{
  state?: string;
  context?: boolean;
  decode?: boolean | 'fail';
  source?: boolean | 'throw';
  fetch?: 'ok' | 'fail';
}>;

const buffer: AudioBufferLike = { duration: 1 };

const world = (options: Options = {}): World => {
  const calls: Call[] = [];
  const fetched: string[] = [];
  const destination: AudioNodeLike = { connect: (t) => t };
  const clock = { now: 10 };
  const ctx: AudioContextLike = {
    state: options.state ?? 'running',
    get currentTime() {
      return clock.now;
    },
    destination,
    resume: () => Promise.resolve(),
    createOscillator: () => {
      throw new Error('not in this test');
    },
    createGain: () => {
      calls.push(['createGain']);
      return {
        gain: {
          setValueAtTime: (v: number, t: number) => calls.push(['gain.set', v, t]),
          exponentialRampToValueAtTime: () => undefined,
        },
        connect: (t: AudioNodeLike) => {
          calls.push(['gain.connect', t === destination ? 'destination' : 'node']);
          return t;
        },
      };
    },
    ...(options.decode === false
      ? {}
      : {
          decodeAudioData: (data: ArrayBuffer) => {
            calls.push(['decode', data.byteLength]);
            return options.decode === 'fail'
              ? Promise.reject(new Error('bad file'))
              : Promise.resolve(buffer);
          },
        }),
    ...(options.source === false
      ? {}
      : {
          createBufferSource: () => {
            if (options.source === 'throw') throw new Error('closed');
            calls.push(['createBufferSource']);
            return {
              buffer: null,
              start: (t: number) => calls.push(['source.start', t]),
              connect: (t: AudioNodeLike) => {
                calls.push(['source.connect', t === destination ? 'destination' : 'node']);
                return t;
              },
            };
          },
        }),
  };
  const audio: AudioCues = {
    tone: () => undefined,
    seq: (notes, type, gain, start) => {
      calls.push(['seq', notes, type, gain, start]);
    },
    warm: () => undefined,
    setEnabled: () => undefined,
    enabled: () => true,
    context: () => (options.context === false ? null : ctx),
  };
  const deps: SoundDeps = {
    fetchBuffer: (url) => {
      fetched.push(url);
      return options.fetch === 'fail'
        ? Promise.reject(new Error('404'))
        : Promise.resolve(new ArrayBuffer(8));
    },
    cache: createSampleCache(),
  };
  const flush = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };
  const tick = (seconds: number): void => {
    clock.now += seconds;
  };
  return { audio, calls, fetched, deps, flush, tick };
};

const SAMPLE = { kind: 'sample', url: '../../shared/sound/x/tap.mp3', gain: 0.2 } as const;

describe('playSound', () => {
  test('a synth goes through the cues as one sequence; silence touches nothing', () => {
    const w = world();
    const notes = [{ freq: 660, dur: 0.05 }];
    playSound(w.audio, { kind: 'synth', notes, voice: 'triangle', gain: 0.08 }, w.deps);
    playSound(w.audio, { kind: 'silence' }, w.deps);
    expect(w.calls).toEqual([['seq', notes, 'triangle', 0.08, 0]]);
    expect(w.fetched).toEqual([]);
  });

  test('a sample is fetched, decoded and started from a buffer source at the given gain', async () => {
    const w = world();
    playSound(w.audio, SAMPLE, w.deps);
    await w.flush();
    expect(w.fetched).toEqual([SAMPLE.url]);
    expect(w.calls).toEqual([
      ['decode', 8],
      ['createBufferSource'],
      ['createGain'],
      ['gain.set', 0.2, 10],
      ['source.connect', 'node'],
      ['gain.connect', 'destination'],
      ['source.start', 10],
    ]);
  });

  test('the cache fetches and decodes once per URL, and plays every time', async () => {
    const w = world();
    playSound(w.audio, SAMPLE, w.deps);
    playSound(w.audio, SAMPLE, w.deps);
    await w.flush();
    playSound(w.audio, { ...SAMPLE, url: '../../shared/sound/x/turn.mp3' }, w.deps);
    playSound(w.audio, SAMPLE, w.deps);
    await w.flush();
    expect(w.fetched).toEqual([SAMPLE.url, '../../shared/sound/x/turn.mp3']);
    expect(w.calls.filter(([n]) => n === 'decode')).toHaveLength(2);
    expect(w.calls.filter(([n]) => n === 'source.start')).toHaveLength(4);
    expect(w.deps.cache.size()).toBe(2);
  });

  test('a failing fetch and a failing decode are silent, and each is asked for once', async () => {
    const failing = world({ fetch: 'fail' });
    playSound(failing.audio, SAMPLE, failing.deps);
    playSound(failing.audio, SAMPLE, failing.deps);
    await failing.flush();
    expect(failing.fetched).toEqual([SAMPLE.url]);
    expect(failing.calls).toEqual([]);

    const bad = world({ decode: 'fail' });
    playSound(bad.audio, SAMPLE, bad.deps);
    await bad.flush();
    playSound(bad.audio, SAMPLE, bad.deps);
    await bad.flush();
    expect(bad.fetched).toEqual([SAMPLE.url]);
    expect(bad.calls).toEqual([['decode', 8]]);
  });

  test('nothing is fetched without a running context; no decoder, no source or a throwing source stay silent', async () => {
    const off = world({ context: false });
    playSound(off.audio, SAMPLE, off.deps);
    const suspended = world({ state: 'suspended' });
    playSound(suspended.audio, SAMPLE, suspended.deps);
    await off.flush();
    expect(off.fetched).toEqual([]);
    expect(suspended.fetched).toEqual([]);

    const noDecoder = world({ decode: false });
    playSound(noDecoder.audio, SAMPLE, noDecoder.deps);
    await noDecoder.flush();
    expect(noDecoder.fetched).toEqual([SAMPLE.url]);
    expect(noDecoder.calls).toEqual([]);

    const noSource = world({ source: false });
    playSound(noSource.audio, SAMPLE, noSource.deps);
    await noSource.flush();
    expect(noSource.calls).toEqual([['decode', 8]]);

    const throwing = world({ source: 'throw' });
    expect(() => {
      playSound(throwing.audio, SAMPLE, throwing.deps);
    }).not.toThrow();
    await throwing.flush();
    expect(throwing.calls).toEqual([['decode', 8]]);
  });
});

const STING = { kind: 'sample', url: '../../shared/sound/x/sting.mp3', gain: 0.2 } as const;
const A = { kind: 'synth', notes: [note(880, 0.1)], voice: 'square', gain: 0.1 } as const;
const FONT: SoundFont = {
  name: 'arcade',
  label: 'Test',
  sounds: { 'good.trick': A, victory: STING },
  durationsMs: { victory: 250 },
};

describe('slots and phrases', () => {
  test('a slot books its sound atMs ahead: a synth through seq with a start, a sample at currentTime + atMs', async () => {
    const w = world();
    playSlot(w.audio, { sound: A, atMs: 400, ms: 100 }, w.deps);
    playSlot(w.audio, { sound: STING, atMs: 250, ms: 250 }, w.deps);
    await w.flush();
    expect(w.calls).toEqual([
      ['seq', A.notes, 'square', 0.1, 0.4],
      ['decode', 8],
      ['createBufferSource'],
      ['createGain'],
      ['gain.set', 0.2, 10.25],
      ['source.connect', 'node'],
      ['gain.connect', 'destination'],
      ['source.start', 10.25],
    ]);
  });

  test('a sample decoded after its slot is skipped, never late; one still within the grace starts', async () => {
    const late = world();
    playSlot(late.audio, { sound: STING, atMs: 100, ms: 250 }, late.deps);
    late.tick(0.1 + SAMPLE_LATE_MS / 1000 + 0.001);
    await late.flush();
    expect(late.calls).toEqual([['decode', 8]]);

    const grace = world();
    playSlot(grace.audio, { sound: STING, atMs: 100, ms: 250 }, grace.deps);
    grace.tick(0.1 + SAMPLE_LATE_MS / 1000 - 0.01);
    await grace.flush();
    expect(grace.calls.filter(([n]) => n === 'source.start')).toEqual([['source.start', 10.1]]);
    expect(SAMPLE_LATE_MS).toBe(120);
  });

  test('warmSamples fetches and decodes every sample once, plays nothing, and needs a context but not a running one', async () => {
    const w = world({ state: 'suspended' });
    const slots = [
      { sound: STING, atMs: 0, ms: 250 },
      { sound: A, atMs: 250, ms: 100 },
      { sound: STING, atMs: 350, ms: 250 },
    ];
    warmSamples(w.audio, slots, w.deps);
    warmSamples(w.audio, slots, w.deps);
    await w.flush();
    expect(w.fetched).toEqual([STING.url]);
    expect(w.calls).toEqual([['decode', 8]]);
    expect(w.deps.cache.size()).toBe(1);

    const off = world({ context: false });
    warmSamples(off.audio, slots, off.deps);
    await off.flush();
    expect(off.fetched).toEqual([]);
  });

  test('a two-step phrase queues in one tick from the font`s declared lengths, samples warmed first', async () => {
    const w = world();
    playPhrase(
      w.audio,
      FONT,
      { steps: [{ cue: 'good.trick.steal' }, { cue: 'victory', gapMs: 50 }], buzz: 12 },
      w.deps,
    );
    // The sample's fetch is under way before any step is booked.
    expect(w.fetched).toEqual([STING.url]);
    expect(w.calls).toEqual([['seq', A.notes, 'square', 0.1, 0]]);
    await w.flush();
    expect(w.calls.filter(([n]) => n === 'source.start')).toEqual([['source.start', 10.15]]);
    expect(w.calls.filter(([n]) => n === 'decode')).toHaveLength(1);
  });

  test('playSlots over an empty schedule touches nothing', async () => {
    const w = world();
    playSlots(w.audio, [], w.deps);
    await w.flush();
    expect(w.calls).toEqual([]);
    expect(w.fetched).toEqual([]);
  });
});
