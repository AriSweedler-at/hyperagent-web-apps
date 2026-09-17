import { describe, expect, test } from 'vitest';

import {
  createAudioCues,
  createWakeLock,
  vibrate,
  type AudioContextLike,
  type AudioNodeLike,
  type NavigatorLike,
  type WakeLockSentinelLike,
} from './fx.ts';

// ---------------------------------------------------------------------------------------------
// wake lock
// ---------------------------------------------------------------------------------------------
type FakeSentinel = WakeLockSentinelLike &
  Readonly<{ fireRelease: () => void; released: () => number }>;

const fakeSentinel = (): FakeSentinel => {
  const listeners: (() => void)[] = [];
  let released = 0;
  return {
    release: () => {
      released += 1;
      return Promise.resolve();
    },
    addEventListener: (_type, fn) => {
      listeners.push(fn);
    },
    fireRelease: () => {
      listeners.forEach((fn) => {
        fn();
      });
    },
    released: () => released,
  };
};

describe('createWakeLock', () => {
  test('requests a screen lock once and releases it', async () => {
    const sentinel = fakeSentinel();
    const requests: string[] = [];
    const nav: NavigatorLike = {
      wakeLock: {
        request: (type) => {
          requests.push(type);
          return Promise.resolve(sentinel);
        },
      },
    };
    const lock = createWakeLock(nav);
    expect(lock.held()).toBe(false);
    await lock.hold();
    await lock.hold();
    expect(requests).toEqual(['screen']);
    expect(lock.held()).toBe(true);
    lock.drop();
    expect(sentinel.released()).toBe(1);
    expect(lock.held()).toBe(false);
    lock.drop();
    expect(sentinel.released()).toBe(1);
  });

  test('the browser releasing the lock (tab hidden) clears the held state', async () => {
    const sentinel = fakeSentinel();
    const lock = createWakeLock({ wakeLock: { request: () => Promise.resolve(sentinel) } });
    await lock.hold();
    sentinel.fireRelease();
    expect(lock.held()).toBe(false);
    await lock.hold();
    expect(lock.held()).toBe(true);
  });

  test('a stale release event does not clear a newer lock', async () => {
    const first = fakeSentinel();
    const second = fakeSentinel();
    const sentinels = [first, second];
    const lock = createWakeLock({
      wakeLock: { request: () => Promise.resolve(sentinels.shift() ?? second) },
    });
    await lock.hold();
    lock.drop();
    await lock.hold();
    first.fireRelease();
    expect(lock.held()).toBe(true);
  });

  test('degrades silently without the API, on rejection and on a throwing release', async () => {
    const none = createWakeLock({});
    await none.hold();
    expect(none.held()).toBe(false);
    none.drop();

    const denied = createWakeLock({
      wakeLock: { request: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) },
    });
    await denied.hold();
    expect(denied.held()).toBe(false);

    const throwing = createWakeLock({
      wakeLock: {
        request: () => {
          throw new TypeError('not a function');
        },
      },
    });
    await throwing.hold();
    expect(throwing.held()).toBe(false);

    const badRelease = createWakeLock({
      wakeLock: {
        request: () =>
          Promise.resolve({
            release: () => {
              throw new Error('gone');
            },
            addEventListener: () => undefined,
          }),
      },
    });
    await badRelease.hold();
    expect(badRelease.held()).toBe(true);
    expect(() => {
      badRelease.drop();
    }).not.toThrow();
    expect(badRelease.held()).toBe(false);

    const rejectingRelease = createWakeLock({
      wakeLock: {
        request: () =>
          Promise.resolve({
            release: () => Promise.reject(new Error('late')),
            addEventListener: () => undefined,
          }),
      },
    });
    await rejectingRelease.hold();
    rejectingRelease.drop();
    await Promise.resolve();
    expect(rejectingRelease.held()).toBe(false);
  });
});

describe('vibrate', () => {
  test('forwards the pattern when supported', () => {
    const seen: unknown[] = [];
    vibrate(
      {
        vibrate: (p) => {
          seen.push(p);
          return true;
        },
      },
      [40, 60, 40],
    );
    vibrate(
      {
        vibrate: (p) => {
          seen.push(p);
          return true;
        },
      },
      12,
    );
    expect(seen).toEqual([[40, 60, 40], 12]);
  });

  test('is silent without the API or when it throws', () => {
    expect(() => {
      vibrate({}, 12);
      vibrate(
        {
          vibrate: () => {
            throw new Error('nope');
          },
        },
        12,
      );
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------------------------
// audio cues
// ---------------------------------------------------------------------------------------------
type Call = readonly [string, ...unknown[]];

type FakeContext = Readonly<{
  ctx: AudioContextLike;
  calls: ReadonlyArray<Call>;
  setState: (state: string) => void;
  resumed: () => number;
}>;

const fakeContext = (initial = 'running'): FakeContext => {
  const calls: Call[] = [];
  let state = initial;
  let resumed = 0;
  const destination: AudioNodeLike = { connect: (t) => t };
  const param = (name: string) => ({
    setValueAtTime: (v: number, t: number) => calls.push([`${name}.set`, v, t]),
    exponentialRampToValueAtTime: (v: number, t: number) => calls.push([`${name}.ramp`, v, t]),
  });
  const ctx: AudioContextLike = {
    get state() {
      return state;
    },
    currentTime: 10,
    destination,
    resume: () => {
      resumed += 1;
      return Promise.resolve();
    },
    createOscillator: () => {
      const osc = {
        type: 'sine' as const,
        frequency: param('freq'),
        connect: (t: AudioNodeLike) => {
          calls.push(['osc.connect', t === destination ? 'destination' : 'node']);
          return t;
        },
        start: (t: number) => calls.push(['osc.start', t]),
        stop: (t: number) => calls.push(['osc.stop', t]),
      };
      calls.push(['createOscillator']);
      return osc;
    },
    createGain: () => {
      calls.push(['createGain']);
      return {
        gain: param('gain'),
        connect: (t: AudioNodeLike) => {
          calls.push(['gain.connect', t === destination ? 'destination' : 'node']);
          return t;
        },
      };
    },
  };
  return {
    ctx,
    calls,
    setState: (s) => {
      state = s;
    },
    resumed: () => resumed,
  };
};

describe('createAudioCues', () => {
  test('tone schedules the legacy envelope on a running context', () => {
    const f = fakeContext();
    const cues = createAudioCues({ makeContext: () => f.ctx });
    cues.tone(660, 0, 0.05, 'triangle', 0.08);
    expect(f.calls).toEqual([
      ['createOscillator'],
      ['createGain'],
      ['freq.set', 660, 10],
      ['gain.set', 0.0001, 10],
      ['gain.ramp', 0.08, 10.012],
      ['gain.ramp', 0.0001, 10.05],
      ['osc.connect', 'node'],
      ['gain.connect', 'destination'],
      ['osc.start', 10],
      ['osc.stop', 10.07],
    ]);
  });

  test('defaults: sine at 0.18 gain; the context is created once', () => {
    let made = 0;
    const f = fakeContext();
    const cues = createAudioCues({
      makeContext: () => {
        made += 1;
        return f.ctx;
      },
    });
    cues.tone(494, 0, 0.18);
    cues.tone(494, 0, 0.18);
    expect(made).toBe(1);
    expect(f.calls.find(([name]) => name === 'gain.ramp')).toEqual(['gain.ramp', 0.18, 10.012]);
  });

  test('seq spaces notes by gap (or dur) and passes type and gain through', () => {
    const f = fakeContext();
    const cues = createAudioCues({ makeContext: () => f.ctx });
    cues.seq(
      [
        { freq: 523, dur: 0.12, gap: 0.13 },
        { freq: 784, dur: 0.22 },
      ],
      'sine',
      0.2,
    );
    const starts = f.calls.filter(([name]) => name === 'osc.start');
    expect(starts).toEqual([
      ['osc.start', 10],
      ['osc.start', 10.13],
    ]);
    const freqs = f.calls.filter(([name]) => name === 'freq.set');
    expect(freqs).toEqual([
      ['freq.set', 523, 10],
      ['freq.set', 784, 10.13],
    ]);
  });

  test('a suspended context is resumed and nothing is queued until it runs', () => {
    const f = fakeContext('suspended');
    const cues = createAudioCues({ makeContext: () => f.ctx });
    cues.tone(660, 0, 0.05);
    expect(f.resumed()).toBe(1);
    expect(f.calls).toEqual([]);
    f.setState('running');
    cues.tone(660, 0, 0.05);
    expect(f.calls.length).toBeGreaterThan(0);
  });

  test('disabled cues touch nothing; enabling later works', () => {
    let made = 0;
    const f = fakeContext();
    const cues = createAudioCues({
      makeContext: () => {
        made += 1;
        return f.ctx;
      },
      enabled: false,
    });
    expect(cues.enabled()).toBe(false);
    cues.tone(660, 0, 0.05);
    cues.seq([{ freq: 1, dur: 1 }]);
    expect(made).toBe(0);
    cues.setEnabled(true);
    cues.tone(660, 0, 0.05);
    expect(made).toBe(1);
    expect(cues.enabled()).toBe(true);
  });

  test('degrades silently without a constructor, when it throws, or when nodes throw', () => {
    const none = createAudioCues({ makeContext: undefined });
    expect(() => {
      none.tone(1, 0, 1);
    }).not.toThrow();

    const throwing = createAudioCues({
      makeContext: () => {
        throw new ReferenceError('AudioContext is not defined');
      },
    });
    expect(() => {
      throwing.tone(1, 0, 1);
    }).not.toThrow();

    const f = fakeContext();
    const broken = createAudioCues({
      makeContext: () => ({
        ...f.ctx,
        createOscillator: () => {
          throw new DOMException('closed', 'InvalidStateError');
        },
      }),
    });
    expect(() => {
      broken.tone(1, 0, 1);
    }).not.toThrow();

    const resumeRejects = createAudioCues({
      makeContext: () => ({
        ...fakeContext('suspended').ctx,
        resume: () => Promise.reject(new Error('gesture required')),
      }),
    });
    expect(() => {
      resumeRejects.tone(1, 0, 1);
    }).not.toThrow();
  });
});
