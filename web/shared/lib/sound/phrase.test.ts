// Phrases (docs/design/sound-fonts.md §2.2, §10 "lib"): a row is a one-step phrase; `schedule`
// lays steps end to end from the declared lengths (gaps kept, silence booked but not played),
// voices at their offsets over the steps; `place` runs phrases back to back with the gap; and
// `joinBuzz` makes one vibrate pattern whose pauses come from the schedule.
import { describe, expect, test } from 'vitest';

import { SHELL_CUES, type CueSpec } from './cues.ts';
import { fontByName, type SoundFont } from './fonts.ts';
import { DEFAULT_SOUNDS } from './fonts/default.ts';
import {
  PHRASE_GAP_MS,
  joinBuzz,
  phraseMs,
  place,
  schedule,
  sequenceOf,
  spec,
  type Phrase,
} from './phrase.ts';
import { SILENCE, note, sample, synth } from './sound.ts';

const A = synth('square', 0.1, [note(880, 0.1)]); // 100 ms
const B = synth('square', 0.1, [note(660, 0.2, 0.25), note(770, 0.1)]); // 350 ms
const V = synth('sine', 0.05, [note(300, 0.5)]); // 500 ms
const S = sample('../../shared/sound/x/win.mp3', 0.2); // declared 250 ms

const FONT: SoundFont = {
  name: 'arcade',
  label: 'Test',
  sounds: { 'good.trick.steal': A, 'good.trick': B, victory: S, neutral: SILENCE },
  voices: { 'voice.trick': V },
  durationsMs: { victory: 250 },
};

describe('a row is a phrase', () => {
  test('spec() is the one-step phrase; sequenceOf reads a row as it and passes a sequence through', () => {
    expect(spec('good', 12)).toEqual({ steps: [{ cue: 'good' }], buzz: 12 });
    expect(sequenceOf(SHELL_CUES.tap)).toEqual(spec('tap', 12));
    const long: Phrase = { steps: [{ cue: 'good' }, { cue: 'victory', gapMs: 60 }], buzz: [80] };
    expect(sequenceOf(long)).toBe(long);
    // The compile check the games rely on: a table of rows is a table of phrases.
    const rows: Readonly<Record<'a' | 'b', CueSpec>> = { a: SHELL_CUES.win, b: SHELL_CUES.lose };
    const phrases: Readonly<Record<'a' | 'b', Phrase>> = rows;
    expect(phrases.a).toBe(SHELL_CUES.win);
  });

  test('a row schedules as today: its one sound at 0, booked for its length', () => {
    expect(schedule(fontByName('default'), SHELL_CUES.yourTurn)).toEqual([
      { sound: DEFAULT_SOUNDS.turn, atMs: 0, ms: 350 },
    ]);
    expect(phraseMs(fontByName('default'), SHELL_CUES.tap)).toBe(50);
  });
});

describe('schedule', () => {
  test('steps follow each other by declared length plus gap; a qualified step walks the ladder', () => {
    const phrase: Phrase = {
      steps: [{ cue: 'good.trick.steal' }, { cue: 'victory', gapMs: 60 }, { cue: 'good.trick.x' }],
      buzz: 12,
    };
    expect(schedule(FONT, phrase)).toEqual([
      { sound: A, atMs: 0, ms: 100 },
      { sound: S, atMs: 160, ms: 250 },
      { sound: B, atMs: 410, ms: 350 },
    ]);
    expect(phraseMs(FONT, phrase)).toBe(760);
  });

  test('a silent step keeps its place (0 ms, its gap) but is not played', () => {
    const phrase: Phrase = {
      steps: [{ cue: 'neutral' }, { cue: 'good.trick.steal', gapMs: 30 }],
      buzz: 12,
    };
    expect(schedule(FONT, phrase)).toEqual([{ sound: A, atMs: 30, ms: 100 }]);
    expect(schedule(FONT, spec('neutral', 12))).toEqual([]);
    expect(phraseMs(FONT, spec('neutral', 12))).toBe(0);
  });

  test('a voice at 0 lies over a two-step phrase and can outlast it; its gain overrides the font`s; an unvoiced line is silence', () => {
    const phrase: Phrase = {
      steps: [{ cue: 'good.trick.steal' }, { cue: 'good.trick' }],
      voices: [
        { cue: 'voice.trick.steal', atMs: 0 },
        { cue: 'voice.trick', atMs: 120, gain: 0.2 },
        { cue: 'voice.result', atMs: 0 },
      ],
      buzz: 12,
    };
    expect(schedule(FONT, phrase)).toEqual([
      { sound: A, atMs: 0, ms: 100 },
      { sound: B, atMs: 100, ms: 350 },
      { sound: V, atMs: 0, ms: 500 },
      { sound: { ...V, gain: 0.2 }, atMs: 120, ms: 500 },
    ]);
    expect(phraseMs(FONT, phrase)).toBe(620);
  });
});

describe('place and joinBuzz', () => {
  test('phrases run back to back PHRASE_GAP_MS apart, slots shifted to each start', () => {
    expect(PHRASE_GAP_MS).toBe(120);
    const placed = place(FONT, [spec('good.trick.steal', 12), spec('victory', [80, 50, 80])], 120);
    expect(placed).toEqual([
      { atMs: 0, slots: [{ sound: A, atMs: 0, ms: 100 }], buzz: 12 },
      { atMs: 220, slots: [{ sound: S, atMs: 220, ms: 250 }], buzz: [80, 50, 80] },
    ]);
    expect(place(FONT, [], 120)).toEqual([]);
  });

  test('one vibrate pattern: each buzz at its phrase`s start, the pause measured from the schedule', () => {
    // A single part: a 0 ms on then no pause, the pattern as given.
    expect(joinBuzz([{ buzz: 12, atMs: 0 }])).toEqual([0, 0, 12]);
    // Odd length so far (ends on an on): the pause is the off before the next buzz.
    expect(
      joinBuzz([
        { buzz: 12, atMs: 0 },
        { buzz: [80, 50, 80], atMs: 220 },
      ]),
    ).toEqual([0, 0, 12, 208, 80, 50, 80]);
    // Even length so far (ends on an off): a 0 ms on keeps the pause an off.
    expect(
      joinBuzz([
        { buzz: [40, 60], atMs: 0 },
        { buzz: 30, atMs: 400 },
      ]),
    ).toEqual([0, 0, 40, 60, 0, 300, 30]);
    // A buzz longer than the gap: the next follows at once.
    expect(
      joinBuzz([
        { buzz: [500], atMs: 0 },
        { buzz: 30, atMs: 220 },
      ]),
    ).toEqual([0, 0, 500, 0, 30]);
  });
});
