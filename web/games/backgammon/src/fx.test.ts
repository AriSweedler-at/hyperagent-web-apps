// The table (ui/sound.ts; docs/design/sound-fonts.md §5) and the player over fakes: every event
// names a generic cue the default font voices, no two events share a cue, and `createFx` plays a
// row through the audio edge with the table's buzz in whichever font it is handed.
import { describe, expect, test } from 'vitest';

import type { AudioCues, Note, OscillatorType } from '../../../shared/edge/fx.ts';
import { createSampleCache } from '../../../shared/edge/sound.ts';
import { createStore, type StorageLike } from '../../../shared/edge/storage.ts';
import { SOUND_CUES, type SoundCue } from '../../../shared/lib/sound/cues.ts';
import { fontByName, resolveSound, type SoundFontName } from '../../../shared/lib/sound/fonts.ts';
import { createFx } from './fx.ts';
import { STORAGE_KEYS } from './storage.ts';
import { CUES, type Cue } from './ui/sound.ts';

const EVENTS = Object.keys(CUES) as ReadonlyArray<Cue | 'tap'>;

describe('the table', () => {
  test('pins the design\'s mapping (design.md §4 "Sound"; sound-fonts.md §5)', () => {
    const mapping: Readonly<Record<Cue | 'tap', SoundCue>> = {
      tap: 'tap',
      roll: 'roll',
      place: 'move',
      hit: 'capture',
      bearOff: 'score',
      yourTurn: 'turn',
      double: 'challenge',
      win: 'victory',
      lose: 'loss',
    };
    expect(Object.fromEntries(EVENTS.map((e) => [e, CUES[e].cue]))).toEqual(mapping);
  });

  test.each(EVENTS)('%s names a shared cue the default font voices, with a buzz', (event) => {
    const { cue, buzz } = CUES[event];
    expect(SOUND_CUES).toContain(cue);
    expect(resolveSound(fontByName('default'), cue).kind).toBe('synth');
    const pattern = typeof buzz === 'number' ? [buzz] : buzz;
    expect(pattern.length).toBeGreaterThan(0);
    pattern.forEach((ms) => {
      expect(ms).toBeGreaterThan(0);
    });
  });

  test('no two events share a cue, so a font re-voices each one apart', () => {
    expect(new Set(EVENTS.map((e) => CUES[e].cue)).size).toBe(EVENTS.length);
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

/** What a font says a synth cue sounds like, as the audio edge receives it. */
const seqOf = (font: SoundFontName, cue: SoundCue): Call => {
  const sound = resolveSound(fontByName(font), cue);
  return sound.kind === 'synth' ? ['seq', sound.notes, sound.voice, sound.gain] : ['not synth'];
};

describe('createFx', () => {
  test('play: every event is one sequence from the font and its buzz', () => {
    const { fx, calls, buzzes } = world();
    EVENTS.forEach((event) => {
      fx.play(event, 'default');
    });
    expect(calls).toEqual(EVENTS.map((event) => seqOf('default', CUES[event].cue)));
    expect(buzzes).toEqual(EVENTS.map((event) => CUES[event].buzz));
  });

  test("another font re-voices the same event; the buzz is the table's, not the font's", () => {
    const { fx, calls, buzzes } = world();
    fx.play('win', 'arcade');
    expect(calls).toEqual([seqOf('arcade', 'victory')]);
    expect(calls[0]?.[2]).toBe('square');
    expect(calls[0]?.[1]).not.toEqual(seqOf('default', 'victory')[1]);
    expect(buzzes).toEqual([CUES.win.buzz]);
  });

  test('disabled: the audio edge stays silent on its own and no buzz is sent', () => {
    const { fx, buzzes, calls } = world(false);
    fx.play('win', 'default');
    expect(buzzes).toEqual([]);
    // The sequence is still handed to the audio cues, which drop it themselves while disabled.
    expect(calls).toHaveLength(1);
    expect(fx.enabled()).toBe(false);
    fx.warm();
    expect(calls).toHaveLength(1);
  });

  test('toggle flips and persists backgammon_sound; turning on warms the context and taps in the font', () => {
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
    expect(calls).toEqual([['warm'], seqOf('felt', 'tap')]);
    expect(buzzes).toEqual([CUES.tap.buzz]);
    fx.warm();
    expect(calls.at(-1)).toEqual(['warm']);
  });
});
