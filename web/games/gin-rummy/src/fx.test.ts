// The legacy pin (docs/design/sound-fonts.md §10): every gin event, played in the `default` font,
// is the legacy `fx` object's notes, voice and gain number for number, and its buzz is unchanged.
// LEGACY below is a frozen copy of the numbers (legacy/gin-rummy/index.html, then ui/sound.ts
// before the fonts), not a read of the file it checks.
import { describe, expect, test } from 'vitest';

import type { AudioCues, Note, OscillatorType } from '../../../shared/edge/fx.ts';
import { createSampleCache } from '../../../shared/edge/sound.ts';
import { createStore, type StorageLike } from '../../../shared/edge/storage.ts';
import { fontByName, resolveSound } from '../../../shared/lib/sound/fonts.ts';
import { createFx } from './fx.ts';
import { STORAGE_KEYS } from './storage.ts';
import type { Cue } from './ui/cues.ts';
import { CUES } from './ui/sound.ts';

type Legacy = Readonly<{
  notes: ReadonlyArray<Note>;
  type: OscillatorType;
  gain: number;
  buzz: number | ReadonlyArray<number>;
}>;
const n = (freq: number, dur: number, gap?: number): Note =>
  gap === undefined ? { freq, dur } : { freq, dur, gap };

const LEGACY: Readonly<Record<Cue | 'tap', Legacy>> = {
  tap: { notes: [n(660, 0.05)], type: 'triangle', gain: 0.08, buzz: 12 },
  yourTurn: {
    notes: [n(523, 0.12, 0.13), n(784, 0.22)],
    type: 'sine',
    gain: 0.2,
    buzz: [40, 60, 40],
  },
  knockGood: {
    notes: [n(587, 0.1, 0.11), n(740, 0.1, 0.11), n(880, 0.28)],
    type: 'triangle',
    gain: 0.2,
    buzz: [30, 40, 30, 40, 60],
  },
  gin: {
    notes: [n(523, 0.09, 0.1), n(659, 0.09, 0.1), n(784, 0.09, 0.1), n(1047, 0.36)],
    type: 'triangle',
    gain: 0.22,
    buzz: [50, 50, 50, 50, 120],
  },
  bad: { notes: [n(440, 0.14, 0.15), n(330, 0.3)], type: 'sawtooth', gain: 0.09, buzz: [120] },
  neutral: { notes: [n(494, 0.18)], type: 'sine', gain: 0.12, buzz: 30 },
  win: {
    notes: [
      n(523, 0.12, 0.13),
      n(659, 0.12, 0.13),
      n(784, 0.12, 0.13),
      n(1047, 0.18, 0.2),
      n(784, 0.1, 0.11),
      n(1047, 0.45),
    ],
    type: 'triangle',
    gain: 0.22,
    buzz: [80, 50, 80, 50, 200],
  },
  lose: {
    notes: [n(392, 0.2, 0.22), n(349, 0.2, 0.22), n(294, 0.45)],
    type: 'sine',
    gain: 0.14,
    buzz: [200],
  },
  oppStock: { notes: [n(392, 0.06, 0.07), n(330, 0.09)], type: 'triangle', gain: 0.09, buzz: 15 },
  oppDiscard: { notes: [n(494, 0.06, 0.07), n(587, 0.09)], type: 'triangle', gain: 0.1, buzz: 15 },
};
const EVENTS = Object.keys(LEGACY) as ReadonlyArray<Cue | 'tap'>;

describe('the table on the default font', () => {
  test.each(EVENTS)(
    '%s: the legacy notes, voice and gain number for number; the buzz unchanged',
    (event) => {
      const legacy = LEGACY[event];
      expect(resolveSound(fontByName('default'), CUES[event].cue)).toStrictEqual({
        kind: 'synth',
        notes: legacy.notes,
        voice: legacy.type,
        gain: legacy.gain,
      });
      expect(CUES[event].buzz).toEqual(legacy.buzz);
    },
  );

  test('ten events onto ten distinct generic cues', () => {
    expect(EVENTS).toHaveLength(10);
    expect(new Set(Object.values(CUES).map((s) => s.cue)).size).toBe(10);
  });
});

// ---------------------------------------------------------------------------------------------
// createFx over fakes
// ---------------------------------------------------------------------------------------------
type Call = ReadonlyArray<unknown>;

const fakeAudio = (initial = true): Readonly<{ audio: AudioCues; calls: Call[] }> => {
  const calls: Call[] = [];
  const state = { enabled: initial };
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

const world = (
  enabled = true,
): Readonly<{
  fx: ReturnType<typeof createFx>;
  calls: Call[];
  buzzes: unknown[];
  toggles: boolean[];
  storage: ReturnType<typeof fakeStorage>;
}> => {
  const { audio, calls } = fakeAudio(enabled);
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
  return { fx, calls, buzzes, toggles, storage };
};

describe('createFx', () => {
  test('play: every event is one sequence from the font and its buzz', () => {
    const { fx, calls, buzzes } = world();
    EVENTS.forEach((event) => {
      fx.play(event, 'default');
    });
    expect(calls).toEqual(
      EVENTS.map((event) => {
        const legacy = LEGACY[event];
        return ['seq', legacy.notes, legacy.type, legacy.gain];
      }),
    );
    expect(buzzes).toEqual(EVENTS.map((event) => LEGACY[event].buzz));
  });

  test("another font re-voices the same event; the buzz is the table's, not the font's", () => {
    const { fx, calls, buzzes } = world();
    fx.play('gin', 'arcade');
    const arcade = resolveSound(fontByName('arcade'), 'great');
    expect(arcade.kind).toBe('synth');
    if (arcade.kind !== 'synth') return;
    expect(calls).toEqual([['seq', arcade.notes, 'square', arcade.gain]]);
    expect(calls[0]?.[1]).not.toEqual(LEGACY.gin.notes);
    expect(buzzes).toEqual([LEGACY.gin.buzz]);
  });

  test('disabled: the audio edge stays silent on its own and no buzz is sent', () => {
    const { fx, buzzes, calls } = world(false);
    fx.play('gin', 'default');
    expect(buzzes).toEqual([]);
    // The sequence is still handed to the audio cues, which drop it themselves while disabled.
    expect(calls).toHaveLength(1);
    expect(fx.enabled()).toBe(false);
    fx.warm();
    expect(calls).toHaveLength(1);
  });

  test('toggle flips and persists the preference; turning on warms the context and taps in the font', () => {
    const { fx, calls, buzzes, toggles, storage } = world();
    fx.toggle('felt');
    expect(fx.enabled()).toBe(false);
    expect(storage.map.get(STORAGE_KEYS.sound)).toBe('off');
    expect(storage.map.has(STORAGE_KEYS.soundFont)).toBe(false);
    expect(toggles).toEqual([false]);
    expect(calls).toEqual([]);
    fx.toggle('felt');
    expect(fx.enabled()).toBe(true);
    expect(storage.map.get(STORAGE_KEYS.sound)).toBe('on');
    expect(storage.map.has(STORAGE_KEYS.soundFont)).toBe(false);
    expect(toggles).toEqual([false, true]);
    const felt = resolveSound(fontByName('felt'), 'tap');
    expect(felt.kind).toBe('synth');
    if (felt.kind !== 'synth') return;
    expect(calls).toEqual([['warm'], ['seq', felt.notes, felt.voice, felt.gain]]);
    expect(buzzes).toEqual([12]);
    fx.warm();
    expect(calls.at(-1)).toEqual(['warm']);
  });
});
