import { describe, expect, test } from 'vitest';

import type { AudioCues, Note, OscillatorType } from '../../../shared/edge/fx.ts';
import { createStore, type StorageLike } from '../../../shared/edge/storage.ts';
import { createFx } from './fx.ts';
import { STORAGE_KEYS } from './storage.ts';
import { CUES, TAP } from './ui/sound.ts';

type Call = ReadonlyArray<unknown>;

const fakeAudio = (
  initial = true,
): Readonly<{ audio: AudioCues; calls: Call[]; enabled: () => boolean }> => {
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
  };
  return { audio, calls, enabled: () => state.enabled };
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
    vibrate: (pattern) => buzzes.push(pattern),
    store: createStore(storage),
    onToggle: (on) => toggles.push(on),
  });
  return { fx, calls, buzzes, toggles, storage };
};

describe('the cue tables', () => {
  test('are the legacy numbers: a tap and the seven cues', () => {
    expect(TAP).toEqual({
      notes: [{ freq: 660, dur: 0.05 }],
      type: 'triangle',
      gain: 0.08,
      buzz: 12,
    });
    expect(CUES.yourTurn).toEqual({
      notes: [
        { freq: 523, dur: 0.12, gap: 0.13 },
        { freq: 784, dur: 0.22 },
      ],
      type: 'sine',
      gain: 0.2,
      buzz: [40, 60, 40],
    });
    expect(CUES.gin.notes.map((n) => n.freq)).toEqual([523, 659, 784, 1047]);
    expect(CUES.win.notes).toHaveLength(6);
    expect(CUES.lose).toEqual({
      notes: [
        { freq: 392, dur: 0.2, gap: 0.22 },
        { freq: 349, dur: 0.2, gap: 0.22 },
        { freq: 294, dur: 0.45 },
      ],
      type: 'sine',
      gain: 0.14,
      buzz: [200],
    });
    expect(CUES.neutral).toEqual({
      notes: [{ freq: 494, dur: 0.18 }],
      type: 'sine',
      gain: 0.12,
      buzz: 30,
    });
    expect(CUES.bad.type).toBe('sawtooth');
    expect(CUES.knockGood.buzz).toEqual([30, 40, 30, 40, 60]);
  });

  test("the port's pickup cues: a falling pair for the stock, a rising pair for the discard pile", () => {
    expect(CUES.oppStock).toEqual({
      notes: [
        { freq: 392, dur: 0.06, gap: 0.07 },
        { freq: 330, dur: 0.09 },
      ],
      type: 'triangle',
      gain: 0.09,
      buzz: 15,
    });
    expect(CUES.oppDiscard.notes.map((n) => n.freq)).toEqual([494, 587]);
    expect(CUES.oppDiscard.gain).toBeLessThan(CUES.yourTurn.gain);
  });
});

describe('createFx', () => {
  test('each method plays its sequence and buzzes its pattern', () => {
    const { fx, calls, buzzes } = world();
    fx.tap();
    fx.yourTurn();
    fx.knockGood();
    fx.gin();
    fx.bad();
    fx.neutral();
    fx.win();
    fx.lose();
    fx.play('tap');
    expect(calls.map((c) => c[0])).toEqual(Array.from({ length: 9 }, () => 'seq'));
    expect(calls[0]).toEqual(['seq', TAP.notes, 'triangle', 0.08]);
    expect(calls[1]).toEqual(['seq', CUES.yourTurn.notes, 'sine', 0.2]);
    expect(calls[7]).toEqual(['seq', CUES.lose.notes, 'sine', 0.14]);
    expect(buzzes).toEqual([
      12,
      [40, 60, 40],
      [30, 40, 30, 40, 60],
      [50, 50, 50, 50, 120],
      [120],
      30,
      [80, 50, 80, 50, 200],
      [200],
      12,
    ]);
  });

  test('disabled: the audio edge stays silent on its own and no buzz is sent', () => {
    const { fx, buzzes, calls } = world(false);
    fx.gin();
    expect(buzzes).toEqual([]);
    // The sequence is still handed to the audio cues, which drop it themselves while disabled.
    expect(calls).toHaveLength(1);
    expect(fx.enabled()).toBe(false);
    fx.warm();
    expect(calls).toHaveLength(1);
  });

  test('toggle flips and persists the preference; turning on warms the context and taps', () => {
    const { fx, calls, buzzes, toggles, storage } = world();
    fx.toggle();
    expect(fx.enabled()).toBe(false);
    expect(storage.map.get(STORAGE_KEYS.sound)).toBe('off');
    expect(toggles).toEqual([false]);
    expect(calls).toEqual([]);
    fx.toggle();
    expect(fx.enabled()).toBe(true);
    expect(storage.map.get(STORAGE_KEYS.sound)).toBe('on');
    expect(toggles).toEqual([false, true]);
    expect(calls).toEqual([['warm'], ['seq', TAP.notes, 'triangle', 0.08]]);
    expect(buzzes).toEqual([12]);
    fx.warm();
    expect(calls.at(-1)).toEqual(['warm']);
  });
});
