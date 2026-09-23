// The sound player over fakes (docs/design/sound-fonts.md §10 "edge"): each kind of Sound, a
// failing fetch and a failing decode both silent, and the sample cache fetching once per URL.
import { describe, expect, test } from 'vitest';

import type { AudioBufferLike, AudioContextLike, AudioCues, AudioNodeLike } from './fx.ts';
import { createSampleCache, playSound, type SoundDeps } from './sound.ts';

type Call = ReadonlyArray<unknown>;

type World = Readonly<{
  audio: AudioCues;
  calls: Call[];
  fetched: string[];
  deps: SoundDeps;
  /** Settle every promise the player chained. */
  flush: () => Promise<void>;
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
  const ctx: AudioContextLike = {
    state: options.state ?? 'running',
    currentTime: 10,
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
    seq: (notes, type, gain) => {
      calls.push(['seq', notes, type, gain]);
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
  return { audio, calls, fetched, deps, flush };
};

const SAMPLE = { kind: 'sample', url: '../../shared/sound/x/tap.mp3', gain: 0.2 } as const;

describe('playSound', () => {
  test('a synth goes through the cues as one sequence; silence touches nothing', () => {
    const w = world();
    const notes = [{ freq: 660, dur: 0.05 }];
    playSound(w.audio, { kind: 'synth', notes, voice: 'triangle', gain: 0.08 }, w.deps);
    playSound(w.audio, { kind: 'silence' }, w.deps);
    expect(w.calls).toEqual([['seq', notes, 'triangle', 0.08]]);
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
