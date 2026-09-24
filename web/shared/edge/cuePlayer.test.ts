// The player over fakes (docs/design/shared-shell.md §5 A4: gin's and backgammon's four createFx
// tests, moved here once): a row of the injected table is one sequence from the font and the row's
// buzz, another font re-voices the same event while the buzz stays the table's, a disabled player
// buzzes nothing and warms nothing, and `toggle` persists through the injected callback, warming
// and tapping when it turns on. The table here is the test's own; each game pins its real table
// and the wiring of its key beside its fx.ts.
import { describe, expect, test } from 'vitest';

import type { SoundCue } from '../lib/sound/cues.ts';
import { fontByName, resolveSound, type SoundFontName } from '../lib/sound/fonts.ts';
import { createCuePlayer, type CueSpec, type SoundState } from './cuePlayer.ts';
import type { AudioCues, Note, OscillatorType } from './fx.ts';
import { createSampleCache } from './sound.ts';

type Event = 'yourTurn' | 'win';
const CUES: Readonly<Record<Event | 'tap', CueSpec>> = {
  tap: { cue: 'tap', buzz: 12 },
  yourTurn: { cue: 'turn', buzz: [40, 60, 40] },
  win: { cue: 'victory', buzz: [80, 50, 80, 50, 200] },
};
const EVENTS = Object.keys(CUES) as ReadonlyArray<Event | 'tap'>;

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

const world = (
  enabled = true,
): Readonly<{
  player: ReturnType<typeof createCuePlayer<Event>>;
  calls: Call[];
  buzzes: unknown[];
  toggles: boolean[];
  persisted: SoundState[];
}> => {
  const { audio, calls } = fakeAudio(enabled);
  const buzzes: unknown[] = [];
  const toggles: boolean[] = [];
  const persisted: SoundState[] = [];
  const player = createCuePlayer<Event>({
    audio,
    sound: {
      fetchBuffer: () => Promise.reject(new Error('no samples here')),
      cache: createSampleCache(),
    },
    vibrate: (pattern) => buzzes.push(pattern),
    cues: CUES,
    persist: (state) => persisted.push(state),
    onToggle: (on) => toggles.push(on),
  });
  return { player, calls, buzzes, toggles, persisted };
};

/** What a font says a synth cue sounds like, as the audio edge receives it. */
const seqOf = (font: SoundFontName, cue: SoundCue): Call => {
  const sound = resolveSound(fontByName(font), cue);
  return sound.kind === 'synth' ? ['seq', sound.notes, sound.voice, sound.gain] : ['not synth'];
};

describe('createCuePlayer', () => {
  test('play: every event is one sequence from the font and its buzz', () => {
    const { player, calls, buzzes } = world();
    EVENTS.forEach((event) => {
      player.play(event, 'default');
    });
    expect(calls).toEqual(EVENTS.map((event) => seqOf('default', CUES[event].cue)));
    expect(buzzes).toEqual(EVENTS.map((event) => CUES[event].buzz));
  });

  test("another font re-voices the same event; the buzz is the table's, not the font's", () => {
    const { player, calls, buzzes } = world();
    player.play('win', 'arcade');
    expect(calls).toEqual([seqOf('arcade', 'victory')]);
    expect(calls[0]?.[2]).toBe('square');
    expect(calls[0]?.[1]).not.toEqual(seqOf('default', 'victory')[1]);
    expect(buzzes).toEqual([CUES.win.buzz]);
  });

  test('disabled: the audio edge stays silent on its own and no buzz is sent', () => {
    const { player, buzzes, calls } = world(false);
    player.play('win', 'default');
    expect(buzzes).toEqual([]);
    // The sequence is still handed to the audio cues, which drop it themselves while disabled.
    expect(calls).toHaveLength(1);
    expect(player.enabled()).toBe(false);
    player.warm();
    expect(calls).toHaveLength(1);
  });

  test('toggle flips and persists the preference; turning on warms the context and taps in the font', () => {
    const { player, calls, buzzes, toggles, persisted } = world();
    player.toggle('felt');
    expect(player.enabled()).toBe(false);
    expect(persisted).toEqual(['off']);
    expect(toggles).toEqual([false]);
    expect(calls).toEqual([]);
    player.toggle('felt');
    expect(player.enabled()).toBe(true);
    expect(persisted).toEqual(['off', 'on']);
    expect(toggles).toEqual([false, true]);
    expect(calls).toEqual([['warm'], seqOf('felt', 'tap')]);
    expect(buzzes).toEqual([CUES.tap.buzz]);
    player.warm();
    expect(calls.at(-1)).toEqual(['warm']);
  });
});
