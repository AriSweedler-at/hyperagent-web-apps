// The fonts (docs/design/sound-fonts.md §4, §10 "lib"): the default is total, every font is valid
// (gains in (0, 0.3], durations and gaps positive, sample URLs document-relative), names match the
// list and the files, `resolveSound` falls back to the default, and the guard and its message.
// Since the qualified cues (§2.1): the lookup walks the id's ladder in the font, then in its
// `base`, then in `default`; voices along the same ladder or silence; a length declared, summed or
// assumed.
import { describe, expect, test } from 'vitest';

import { SOUND_CUES, type SoundCue } from './cues.ts';
import {
  DEFAULT_SOUND_FONT,
  SAMPLE_MS_FALLBACK,
  SOUND_FONTS,
  badSoundFontMsg,
  fontByName,
  isSoundFont,
  resolveCue,
  resolveSound,
  resolveVoice,
  type SoundFont,
} from './fonts.ts';
import { DEFAULT_SOUNDS } from './fonts/default.ts';
import { MAX_GAIN, SILENCE, note, sample, synth, type Sound } from './sound.ts';

const VOICES = ['sine', 'square', 'sawtooth', 'triangle'];

const expectValid = (sound: Sound | undefined, where: string): void => {
  expect(sound, where).toBeDefined();
  if (sound === undefined) return;
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
    // Base cues only, no voices and no base: it is the last rung, and the qualified walk ends
    // in a direct read of its table.
    expect(fontByName('default').voices).toBeUndefined();
    expect(fontByName('default').base).toBeUndefined();
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

  // ---- the qualified walk (§2.1) ----
  const STEAL = synth('square', 0.1, [note(880, 0.1)]);
  const TRICK = synth('square', 0.1, [note(660, 0.2, 0.25), note(770, 0.1)]);
  const GOOD = synth('sine', 0.1, [note(500, 0.3)]);
  const STING = sample('../../shared/sound/x/sting.mp3', 0.2);
  const partial: SoundFont = {
    name: 'arcade',
    label: 'Partial',
    sounds: { 'good.trick.briscola.steal': STEAL, 'good.trick': TRICK, tap: STING },
    durationsMs: { tap: 180 },
  };
  const layered: SoundFont = {
    name: 'felt',
    label: 'Layered',
    sounds: { good: GOOD, victory: STING },
    voices: { 'voice.trick': STEAL },
    base: 'arcade',
  };

  test('resolveCue walks the ladder: the exact key, a prefix, the base, then the default font', () => {
    expect(resolveCue(partial, 'good.trick.briscola.steal').sound).toBe(STEAL);
    expect(resolveCue(partial, 'good.trick.briscola').sound).toBe(TRICK);
    expect(resolveCue(partial, 'good.trick.other').sound).toBe(TRICK);
    expect(resolveCue(partial, 'good.knock').sound).toBe(DEFAULT_SOUNDS.good);
    expect(resolveCue(partial, 'good').sound).toBe(DEFAULT_SOUNDS.good);
    expect(resolveSound(partial, 'victory.match')).toBe(DEFAULT_SOUNDS.victory);
    // A shipped partial font: its own key, else the default, for a qualified id too.
    expect(resolveSound(fontByName('felt'), 'tap.card')).toBe(fontByName('felt').sounds.tap);
  });

  test('a `base` is one more rung before default, the REAL font of that name walked along the same ladder', () => {
    // `layered` re-voices `good` itself, so its own key wins over anything below.
    expect(resolveCue(layered, 'good.trick.briscola.steal').sound).toBe(GOOD);
    // A cue it leaves out resolves as its base (`arcade`) would, qualified or not, before default.
    const bare: SoundFont = { ...layered, sounds: {} };
    const arcade = fontByName('arcade');
    expect(resolveCue(bare, 'good.trick.x').sound).toBe(resolveSound(arcade, 'good'));
    expect(resolveCue(bare, 'good.trick.x').sound).not.toBe(DEFAULT_SOUNDS.good);
    SOUND_CUES.forEach((cue) => {
      expect(resolveCue(bare, cue).sound, cue).toBe(resolveSound(arcade, cue));
    });
    // A base that is `default` is the default rung once.
    expect(resolveCue({ ...partial, base: 'default' }, 'roll').sound).toBe(DEFAULT_SOUNDS.roll);
  });

  test('the length: declared beside the key, else summed from the synth, else the sample fallback; the default sums its own', () => {
    expect(resolveCue(partial, 'tap')).toEqual({ sound: STING, ms: 180 });
    expect(resolveCue(partial, 'good.trick')).toEqual({ sound: TRICK, ms: 350 });
    expect(resolveCue(layered, 'victory')).toEqual({ sound: STING, ms: SAMPLE_MS_FALLBACK });
    expect(SAMPLE_MS_FALLBACK).toBe(400);
    expect(resolveCue(fontByName('default'), 'tap.card')).toEqual({
      sound: DEFAULT_SOUNDS.tap,
      ms: 50,
    });
    expect(resolveCue(fontByName('default'), 'turn')).toEqual({
      sound: DEFAULT_SOUNDS.turn,
      ms: 350,
    });
  });

  test('a voice along its ladder through the same rungs; silence, 0 ms, when no rung voices it', () => {
    expect(resolveVoice(layered, 'voice.trick.steal')).toEqual({ sound: STEAL, ms: 100 });
    expect(resolveVoice(layered, 'voice.trick')).toEqual({ sound: STEAL, ms: 100 });
    expect(resolveVoice(layered, 'voice.result')).toEqual({ sound: SILENCE, ms: 0 });
    expect(resolveVoice(partial, 'voice.trick')).toEqual({ sound: SILENCE, ms: 0 });
    // The `voice` root answers any line in the font's own table. A hit in a BASE font's voices
    // cannot be pinned yet: `rungs` resolves `base` through the real registry and no shipped
    // font carries `voices` (the base rung is still walked: `layered` above reaches arcade).
    const voicedBase: SoundFont = { ...partial, voices: { voice: GOOD } };
    expect(resolveVoice(layered, 'voice.result').sound).toBe(SILENCE);
    const bare: SoundFont = { name: 'felt', label: 'Bare', sounds: {} };
    expect(resolveVoice(bare, 'voice.trick').sound).toBe(SILENCE);
    expect(resolveVoice({ ...voicedBase, name: 'arcade' }, 'voice.anything').sound).toBe(GOOD);
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
