import { describe, expect, test } from 'vitest';

import { MAX_GAIN, SILENCE, note, sample, synth } from './sound.ts';

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
