import { describe, expect, test } from 'vitest';

import { MAX_GAIN, SILENCE, note, sample, soundMs, synth } from './sound.ts';

describe('sounds as data', () => {
  test('note leaves the gap key out when none is given, so literals read as the legacy tables did', () => {
    expect(note(660, 0.05)).toStrictEqual({ freq: 660, dur: 0.05 });
    expect(note(523, 0.12, 0.13)).toStrictEqual({ freq: 523, dur: 0.12, gap: 0.13 });
  });

  test('synth, sample and silence are the three kinds', () => {
    expect(synth('triangle', 0.08, [note(660, 0.05)])).toEqual({
      kind: 'synth',
      notes: [{ freq: 660, dur: 0.05 }],
      voice: 'triangle',
      gain: 0.08,
    });
    expect(sample('../../shared/sound/felt/tap.mp3', 0.2)).toEqual({
      kind: 'sample',
      url: '../../shared/sound/felt/tap.mp3',
      gain: 0.2,
    });
    expect(SILENCE).toEqual({ kind: 'silence' });
    expect(MAX_GAIN).toBe(0.3);
  });
});

describe('soundMs', () => {
  test('a synth ends where its last note does: each note starts `gap ?? dur` after the one before', () => {
    expect(soundMs(synth('sine', 0.2, [note(523, 0.12, 0.13), note(784, 0.22)]))).toBe(350);
    expect(soundMs(synth('triangle', 0.08, [note(660, 0.05)]))).toBe(50);
    // A long note followed by a short one ends with the long one.
    expect(soundMs(synth('sine', 0.1, [note(440, 0.5, 0.1), note(880, 0.1)]))).toBe(500);
  });

  test('silence takes no time; a sample has no length until the font declares one', () => {
    expect(soundMs(SILENCE)).toBe(0);
    expect(soundMs(sample('../../shared/sound/x/tap.mp3', 0.2))).toBeNull();
  });
});
