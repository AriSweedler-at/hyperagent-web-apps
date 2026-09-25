// The player over fakes (docs/design/shared-shell.md §5 A4: gin's and backgammon's four createFx
// tests, moved here once): a row of the injected table is one sequence from the font and the row's
// buzz, another font re-voices the same event while the buzz stays the table's, a disabled player
// buzzes nothing and warms nothing, and `toggle` persists through the injected callback, warming
// and tapping when it turns on. The table here is the test's own; each game pins its real table
// and the wiring of its key beside its fx.ts.
import { describe, expect, test } from 'vitest';

import { SHELL_CUES, type CueId, type CueSpec as LibCueSpec } from '../lib/sound/cues.ts';
import { fontByName, resolveCue, resolveSound, type SoundFontName } from '../lib/sound/fonts.ts';
import { PHRASE_GAP_MS, joinBuzz, phraseMs, type Phrase } from '../lib/sound/phrase.ts';
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
    seq: (notes: ReadonlyArray<Note>, type?: OscillatorType, gain?: number, start?: number) => {
      calls.push(['seq', notes, type, gain, start]);
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

/** What a font says a synth cue sounds like, as the audio edge receives it: a row plays at 0. */
const seqOf = (font: SoundFontName, cue: CueId): Call => {
  const sound = resolveSound(fontByName(font), cue);
  return sound.kind === 'synth' ? ['seq', sound.notes, sound.voice, sound.gain, 0] : ['not synth'];
};

describe('createCuePlayer', () => {
  test("CueSpec is web/shared/lib/sound/cues.ts's, re-exported (dry-round-2.md E9): one type, both paths", () => {
    // A compile check: a row typed by either path is a row by the other.
    const fromLib: LibCueSpec = CUES.tap;
    const fromEdge: CueSpec = fromLib;
    expect(fromEdge).toBe(CUES.tap);
  });

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

// ---------------------------------------------------------------------------------------------
// Phrases (docs/design/sound-fonts.md §2.2): a long row, a run, and the warm over a font
// ---------------------------------------------------------------------------------------------
type Long = 'steal' | 'result';
const LONG: Readonly<Record<Long | 'tap', Phrase>> = {
  tap: SHELL_CUES.tap,
  // A qualified two-step row: the arcade font voices neither leaf, so the walk lands on its base cues.
  steal: { steps: [{ cue: 'good.trick.steal' }, { cue: 'score', gapMs: 40 }], buzz: [30, 40, 30] },
  result: SHELL_CUES.win,
};

const longWorld = (): Readonly<{
  player: ReturnType<typeof createCuePlayer<Long>>;
  calls: Call[];
  buzzes: unknown[];
}> => {
  const { audio, calls } = fakeAudio(true);
  const buzzes: unknown[] = [];
  const player = createCuePlayer<Long>({
    audio,
    sound: {
      fetchBuffer: () => Promise.reject(new Error('no samples here')),
      cache: createSampleCache(),
    },
    vibrate: (pattern) => buzzes.push(pattern),
    cues: LONG,
    persist: () => undefined,
    onToggle: () => undefined,
  });
  return { player, calls, buzzes };
};

/** A font's synth cue as a `seq` call at an offset (seconds). */
const seqAt = (font: SoundFontName, cue: CueId, start: number): Call => {
  const sound = resolveSound(fontByName(font), cue);
  return sound.kind === 'synth'
    ? ['seq', sound.notes, sound.voice, sound.gain, start]
    : ['not synth'];
};

describe('createCuePlayer over phrases', () => {
  test('a two-step row books its second step after the first`s declared length plus the gap; the buzz is the row`s', () => {
    const { player, calls, buzzes } = longWorld();
    player.play('steal', 'arcade');
    const first = resolveCue(fontByName('arcade'), 'good.trick.steal');
    expect(calls).toEqual([
      seqAt('arcade', 'good', 0),
      seqAt('arcade', 'score', (first.ms + 40) / 1000),
    ]);
    expect(buzzes).toEqual([[30, 40, 30]]);
  });

  test('playPhrases runs phrases PHRASE_GAP_MS apart with one joined vibrate; an empty run plays nothing', () => {
    const { player, calls, buzzes } = longWorld();
    player.playPhrases([LONG.steal, LONG.result], 'default');
    const font = fontByName('default');
    const stealMs = phraseMs(font, LONG.steal);
    const at = (stealMs + PHRASE_GAP_MS) / 1000;
    expect(calls).toEqual([
      seqAt('default', 'good', 0),
      seqAt('default', 'score', (resolveCue(font, 'good').ms + 40) / 1000),
      seqAt('default', 'victory', at),
    ]);
    expect(buzzes).toEqual([
      joinBuzz([
        { buzz: [30, 40, 30], atMs: 0 },
        { buzz: SHELL_CUES.win.buzz, atMs: stealMs + PHRASE_GAP_MS },
      ]),
    ]);
    player.playPhrases([], 'default');
    expect(calls).toHaveLength(3);
    expect(buzzes).toHaveLength(1);
  });

  test('warm(font) warms the context and the table`s samples in that font (none in the shipped fonts); disabled, nothing', () => {
    const { player, calls } = longWorld();
    player.warm('arcade');
    expect(calls).toEqual([['warm']]);
    player.warm();
    expect(calls).toEqual([['warm'], ['warm']]);
    const off = world(false);
    off.player.warm('arcade');
    expect(off.calls).toEqual([]);
  });
});
