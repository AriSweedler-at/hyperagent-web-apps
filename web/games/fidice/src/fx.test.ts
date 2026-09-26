// The table (ui/sound.ts; plan §7 D11) and the wiring over fakes: the four rows are the shared
// SHELL_CUES byte for byte and nothing else yet (M9 adds fidice's), and `createFx` is the shared
// player over this table and the `fidice_sound` key.
import { describe, expect, test } from 'vitest';

import type { AudioCues, Note, OscillatorType } from '../../../shared/edge/fx.ts';
import { createSampleCache } from '../../../shared/edge/sound.ts';
import { createStore, type StorageLike } from '../../../shared/edge/storage.ts';
import { SHELL_CUES, isCueId } from '../../../shared/lib/sound/cues.ts';
import { fontByName, resolveSound } from '../../../shared/lib/sound/fonts.ts';
import { createFx } from './fx.ts';
import { STORAGE_KEYS } from './storage.ts';
import { CUES, INITIAL_CUES } from './ui/sound.ts';

describe('the table', () => {
  test('the four rows are the shared SHELL_CUES, byte for byte, and nothing else yet (D11)', () => {
    expect(Object.keys(CUES)).toEqual(['tap', 'yourTurn', 'win', 'lose']);
    expect(CUES).toStrictEqual({
      tap: { cue: 'tap', buzz: 12 },
      yourTurn: { cue: 'turn', buzz: [40, 60, 40] },
      win: { cue: 'victory', buzz: [80, 50, 80, 50, 200] },
      lose: { cue: 'loss', buzz: [200] },
    });
    (Object.keys(SHELL_CUES) as ReadonlyArray<keyof typeof SHELL_CUES>).forEach((event) => {
      expect(CUES[event]).toBe(SHELL_CUES[event]);
      expect(isCueId(CUES[event].cue)).toBe(true);
      expect(resolveSound(fontByName('default'), CUES[event].cue).kind).toBe('synth');
    });
    expect(INITIAL_CUES).toEqual({ key: null });
  });
});

type Call = ReadonlyArray<unknown>;

const fakeAudio = (): Readonly<{ audio: AudioCues; calls: Call[] }> => {
  const calls: Call[] = [];
  const state = { enabled: true };
  const audio: AudioCues = {
    tone: (freq, start, dur, type, gain) => {
      calls.push(['tone', freq, start, dur, type, gain]);
    },
    seq: (notes: ReadonlyArray<Note>, type?: OscillatorType, gain?: number) => {
      calls.push(['seq', notes, type, gain]);
    },
    warm: () => {
      calls.push(['warm']);
    },
    setEnabled: (value) => {
      state.enabled = value;
    },
    enabled: () => state.enabled,
    context: () => null,
  };
  return { audio, calls };
};

const fakeStorage = (): StorageLike & Readonly<{ map: Map<string, string> }> => {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
};

describe('createFx', () => {
  test('wires the shared player to the table and the fidice_sound key', () => {
    const { audio, calls } = fakeAudio();
    const buzzes: unknown[] = [];
    const toggles: boolean[] = [];
    const storage = fakeStorage();
    const fx = createFx({
      audio,
      sound: {
        fetchBuffer: () => Promise.reject(new Error('no samples here')),
        cache: createSampleCache(),
      },
      vibrate: (pattern) => buzzes.push(pattern),
      store: createStore(storage),
      onToggle: (on) => toggles.push(on),
    });
    fx.play('yourTurn', 'default');
    const turn = resolveSound(fontByName('default'), 'turn');
    expect(calls).toEqual([
      turn.kind === 'synth' ? ['seq', turn.notes, turn.voice, turn.gain] : ['not synth'],
    ]);
    expect(buzzes).toEqual([CUES.yourTurn.buzz]);
    fx.toggle('default');
    expect(fx.enabled()).toBe(false);
    expect(storage.map.get(STORAGE_KEYS.sound)).toBe('off');
    expect(storage.map.has(STORAGE_KEYS.soundFont)).toBe(false);
    expect(toggles).toEqual([false]);
  });
});
