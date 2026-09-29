// The cue table and the wiring: every event has a row, the resolve's buzz is the owner's haptic,
// and `createFx` plays the table through the shared player and persists the preference under the
// page's key.
import { describe, expect, test } from 'vitest';

import { createSampleCache } from '../../../shared/edge/sound.ts';
import { createStore } from '../../../shared/edge/storage.ts';
import { isCueId } from '../../../shared/lib/sound/cues.ts';
import { createFx } from './fx.ts';
import { STORAGE_KEYS } from './storage.ts';
import { CUES, RESOLVE_BUZZ_MS, type Cue } from './ui/sound.ts';

const EVENTS: ReadonlyArray<Cue | 'tap'> = [
  'tap',
  'resolve',
  'win',
  'tie',
  'loss',
  'timeout',
  'techUp',
  'reset',
];

const fakeAudio = (enabled: boolean) => {
  const calls: string[] = [];
  const state = { enabled };
  return {
    calls,
    audio: {
      tone: (freq: number, start: number, dur: number) => {
        calls.push(`tone ${String(freq)} ${String(start)} ${String(dur)}`);
      },
      seq: (notes: ReadonlyArray<unknown>) => {
        calls.push(`seq ${String(notes.length)}`);
      },
      warm: () => {
        calls.push('warm');
      },
      setEnabled: (on: boolean) => {
        state.enabled = on;
      },
      enabled: () => state.enabled,
      context: () => null,
    },
  };
};

describe('the cue table', () => {
  test('every event has a row naming a cue of the shared vocabulary', () => {
    expect(Object.keys(CUES).sort()).toEqual([...EVENTS].sort());
    EVENTS.forEach((event) => {
      expect(isCueId(CUES[event].cue), event).toBe(true);
    });
  });

  test("the resolve beeps and buzzes the owner's 30 ms; the verdicts differ in valence", () => {
    expect(CUES.resolve).toEqual({ cue: 'start', buzz: RESOLVE_BUZZ_MS });
    expect(RESOLVE_BUZZ_MS).toBe(30);
    expect(CUES.win.cue).toBe('good');
    expect(CUES.loss.cue).toBe('bad');
    expect(CUES.timeout.cue).toBe('bad.timeout');
    expect(CUES.techUp.cue).toBe('great');
  });
});

describe('createFx', () => {
  test('plays a row through the audio and buzzes; toggling persists rps_sound', () => {
    const { audio, calls } = fakeAudio(true);
    const buzzes: (number | ReadonlyArray<number>)[] = [];
    const storage = new Map<string, string>();
    const store = createStore({
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => storage.set(k, v),
      removeItem: (k) => storage.delete(k),
    });
    const toggled: boolean[] = [];
    const fx = createFx({
      audio,
      sound: {
        fetchBuffer: () => Promise.reject(new Error('no samples')),
        cache: createSampleCache(),
      },
      vibrate: (pattern) => {
        buzzes.push(pattern);
      },
      store,
      onToggle: (enabled) => {
        toggled.push(enabled);
      },
    });
    fx.play('resolve', 'default');
    expect(calls.length).toBeGreaterThan(0);
    expect(buzzes).toEqual([RESOLVE_BUZZ_MS]);
    fx.toggle('default');
    expect(fx.enabled()).toBe(false);
    expect(storage.get(STORAGE_KEYS.sound)).toBe('off');
    expect(toggled).toEqual([false]);
    // Muted: no buzz for a row.
    fx.play('win', 'default');
    expect(buzzes).toEqual([RESOLVE_BUZZ_MS]);
    fx.toggle('default');
    expect(storage.get(STORAGE_KEYS.sound)).toBe('on');
  });
});
