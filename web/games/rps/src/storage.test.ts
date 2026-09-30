// The keys, the progress round trip through the versioned codec, and the fresh start an unreadable
// or refused save reads as.
import { describe, expect, test } from 'vitest';

import { createStore } from '../../../shared/edge/storage.ts';
import { INITIAL_PROGRESS, type Progress } from './engine/engine.ts';
import {
  STORAGE_KEYS,
  readProgress,
  soundEnabled,
  writeProgress,
  writeSoundState,
} from './storage.ts';

const memory = () => {
  const map = new Map<string, string>();
  return {
    map,
    store: createStore({
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => map.set(k, v),
      removeItem: (k) => map.delete(k),
    }),
  };
};

describe('storage', () => {
  test("the keys carry the page's prefix; the progress key is the design's rps_progress", () => {
    expect(STORAGE_KEYS).toEqual({
      progress: 'rps_progress',
      sound: 'rps_sound',
      soundFont: 'rps_soundFont',
    });
  });

  test('progress round-trips as versioned JSON; nothing stored reads as the start', () => {
    const { map, store } = memory();
    expect(readProgress(store)).toEqual(INITIAL_PROGRESS);
    const progress: Progress = {
      counter: 3,
      windowMs: 750,
      prestige: 1,
      recentWins: [400, 350],
      best: 350,
    };
    writeProgress(store, progress);
    expect(JSON.parse(map.get('rps_progress') ?? '')).toEqual({ v: 2, ...progress });
    expect(readProgress(store)).toEqual(progress);
  });

  test('a version-1 save (the 1000 ms base) reads rescaled to the 2500 ms base, the rest kept', () => {
    const { map, store } = memory();
    map.set(
      'rps_progress',
      JSON.stringify({
        v: 1,
        counter: 3,
        windowMs: 750,
        prestige: 1,
        recentWins: [400, 350],
        best: 350,
      }),
    );
    expect(readProgress(store)).toEqual({
      counter: 3,
      windowMs: 1875,
      prestige: 1,
      recentWins: [400, 350],
      best: 350,
    });
  });

  test('a refused or unreadable save reads as the start (never a state the engine could not reach)', () => {
    const { map, store } = memory();
    map.set(
      'rps_progress',
      JSON.stringify({ v: 1, counter: 9, windowMs: 1000, prestige: 0, recentWins: [], best: null }),
    );
    expect(readProgress(store)).toEqual(INITIAL_PROGRESS);
    map.set('rps_progress', 'not json');
    expect(readProgress(store)).toEqual(INITIAL_PROGRESS);
  });

  test('the sound preference: the fallback until written, then what was written', () => {
    const { map, store } = memory();
    expect(soundEnabled(store, true)).toBe(true);
    expect(soundEnabled(store, false)).toBe(false);
    writeSoundState(store, 'off');
    expect(map.get('rps_sound')).toBe('off');
    expect(soundEnabled(store, true)).toBe(false);
    writeSoundState(store, 'on');
    expect(soundEnabled(store, false)).toBe(true);
  });
});
