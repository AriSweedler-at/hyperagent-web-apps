// The fonts (docs/design/sound-fonts.md §4, §10 "lib"): the default is total, every font is valid
// (gains in (0, 0.3], durations and gaps positive, sample URLs document-relative), names match the
// list and the files, `resolveSound` falls back to the default, and the guard and its message.
import { describe, expect, test } from 'vitest';

import { SOUND_CUES, type SoundCue } from './cues.ts';
import {
  DEFAULT_SOUND_FONT,
  SOUND_FONTS,
  badSoundFontMsg,
  fontByName,
  isSoundFont,
  resolveSound,
  type SoundFont,
} from './fonts.ts';
import { DEFAULT_SOUNDS } from './fonts/default.ts';
import { MAX_GAIN, type Sound } from './sound.ts';

const VOICES = ['sine', 'square', 'sawtooth', 'triangle'];

const expectValid = (sound: Sound, where: string): void => {
  switch (sound.kind) {
    case 'synth':
      expect(VOICES, where).toContain(sound.voice);
      expect(sound.gain, where).toBeGreaterThan(0);
      expect(sound.gain, where).toBeLessThanOrEqual(MAX_GAIN);
      expect(sound.notes.length, where).toBeGreaterThan(0);
      sound.notes.forEach((n) => {
        expect(n.freq, where).toBeGreaterThan(0);
        expect(n.dur, where).toBeGreaterThan(0);
        if (n.gap !== undefined) expect(n.gap, where).toBeGreaterThan(0);
      });
      return;
    case 'sample':
      expect(sound.gain, where).toBeGreaterThan(0);
      expect(sound.gain, where).toBeLessThanOrEqual(MAX_GAIN);
      // Both origins must resolve it (docs/ARCHITECTURE.md "Two origins"): no absolute URL.
      expect(sound.url, where).not.toMatch(/^(\/|[a-z]+:)/i);
      return;
    case 'silence':
      return;
  }
};

describe('the fonts', () => {
  test('three fonts; the default is one of them and is total over the cues', () => {
    expect(SOUND_FONTS).toEqual(['default', 'felt', 'arcade']);
    expect(isSoundFont(DEFAULT_SOUND_FONT)).toBe(true);
    expect(Object.keys(DEFAULT_SOUNDS).sort()).toEqual([...SOUND_CUES].sort());
    expect(fontByName('default').sounds).toBe(DEFAULT_SOUNDS);
  });

  test.each(SOUND_FONTS)('%s: name and label as listed, every sound valid', (name) => {
    const font = fontByName(name);
    expect(font.name).toBe(name);
    expect(font.label).toBe(name.charAt(0).toUpperCase() + name.slice(1));
    Object.entries(font.sounds).forEach(([cue, sound]) => {
      expect(SOUND_CUES).toContain(cue);
      expectValid(sound, `${name}.${cue}`);
    });
  });

  // Over the font's own entries, not every cue: a partial font is allowed (§4, §8), and the next
  // test pins that its uncomposed cues resolve to the default.
  test('the shipped fonts differ from the default on every cue they compose', () => {
    SOUND_FONTS.filter((n) => n !== 'default').forEach((name) => {
      Object.entries(fontByName(name).sounds).forEach(([cue, sound]) => {
        expect(sound, `${name}.${cue}`).not.toEqual(DEFAULT_SOUNDS[cue as SoundCue]);
      });
    });
  });

  test("resolveSound plays the font's sound, and the default's where the font composed none", () => {
    const partial: SoundFont = {
      name: 'felt',
      label: 'Partial',
      sounds: { tap: { kind: 'silence' } },
    };
    expect(resolveSound(partial, 'tap')).toEqual({ kind: 'silence' });
    expect(resolveSound(partial, 'victory')).toBe(DEFAULT_SOUNDS.victory);
    SOUND_CUES.forEach((cue: SoundCue) => {
      expect(resolveSound(fontByName('default'), cue)).toBe(DEFAULT_SOUNDS[cue]);
    });
  });

  test('isSoundFont accepts each name exactly and nothing else', () => {
    SOUND_FONTS.forEach((n) => {
      expect(isSoundFont(n)).toBe(true);
    });
    ['', 'Default', 'felt ', 'plaid', 'arcade\n'].forEach((v) => {
      expect(isSoundFont(v)).toBe(false);
    });
  });

  test('the refusal names the key, quotes the value, keeps the current font and lists the fonts', () => {
    expect(badSoundFontMsg('ginRummy_soundFont', 'plaid')).toBe(
      'ginRummy_soundFont: "plaid" is not a sound font; kept the current one. One of: default, felt, arcade.',
    );
  });
});
