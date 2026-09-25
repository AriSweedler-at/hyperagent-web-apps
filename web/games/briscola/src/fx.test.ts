// The table (ui/sound.ts; docs/design/briscola-sound-history.md §4; docs/design/sound-fonts.md §2.1,
// §5) and the wiring over fakes: every row spells a qualified id (its key) that the default font
// resolves down its ladder to a base cue, the shell's four rows are the shared ones, and `createFx`
// is the shared player over this table and the `briscola_sound` key. The cells themselves are
// ui/sound.test.ts's.
import { describe, expect, test } from 'vitest';

import type { AudioCues, Note, OscillatorType } from '../../../shared/edge/fx.ts';
import { createSampleCache } from '../../../shared/edge/sound.ts';
import { createStore, type StorageLike } from '../../../shared/edge/storage.ts';
import { SHELL_CUES, isCueId, type SoundCue } from '../../../shared/lib/sound/cues.ts';
import { fontByName, resolveSound, type SoundFontName } from '../../../shared/lib/sound/fonts.ts';
import { createFx } from './fx.ts';
import { STORAGE_KEYS } from './storage.ts';
import { CUES, type Cue } from './ui/sound.ts';

const EVENTS = Object.keys(CUES) as ReadonlyArray<Cue | 'tap'>;

describe('the table', () => {
  test.each(EVENTS)(
    '%s spells its key as a qualified id the default font resolves to a synth, with a buzz',
    (event) => {
      const { cue, buzz } = CUES[event];
      expect(isCueId(cue)).toBe(true);
      expect(cue).toBe(
        event === 'yourTurn'
          ? 'turn'
          : event === 'win'
            ? 'victory'
            : event === 'lose'
              ? 'loss'
              : event,
      );
      expect(resolveSound(fontByName('default'), cue).kind).toBe('synth');
      const pattern = typeof buzz === 'number' ? [buzz] : buzz;
      expect(pattern.length).toBeGreaterThan(0);
      pattern.forEach((ms) => {
        expect(ms).toBeGreaterThan(0);
      });
    },
  );

  test("the shell's four rows are the shared SHELL_CUES, byte for byte (dry-round-2.md E9)", () => {
    expect(SHELL_CUES).toStrictEqual({
      tap: { cue: 'tap', buzz: 12 },
      yourTurn: { cue: 'turn', buzz: [40, 60, 40] },
      win: { cue: 'victory', buzz: [80, 50, 80, 50, 200] },
      lose: { cue: 'loss', buzz: [200] },
    });
    (Object.keys(SHELL_CUES) as ReadonlyArray<keyof typeof SHELL_CUES>).forEach((event) => {
      expect(CUES[event]).toBe(SHELL_CUES[event]);
    });
  });
});

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

/** What a font says a synth cue sounds like, as the audio edge receives it. */
const seqOf = (font: SoundFontName, cue: SoundCue): Call => {
  const sound = resolveSound(fontByName(font), cue);
  return sound.kind === 'synth' ? ['seq', sound.notes, sound.voice, sound.gain] : ['not synth'];
};

describe('createFx', () => {
  test('wires the shared player to the table and the briscola_sound key; a qualified row plays its base', () => {
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
    fx.play('good.trick.big', 'default');
    expect(calls).toEqual([seqOf('default', 'good')]);
    expect(buzzes).toEqual([CUES['good.trick.big'].buzz]);
    fx.toggle('default');
    expect(fx.enabled()).toBe(false);
    expect(storage.map.get(STORAGE_KEYS.sound)).toBe('off');
    expect(storage.map.has(STORAGE_KEYS.soundFont)).toBe(false);
    expect(toggles).toEqual([false]);
  });
});
