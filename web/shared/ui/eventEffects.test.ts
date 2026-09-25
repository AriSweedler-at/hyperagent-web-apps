// `eventEffects` (briscola-sound-history.md §3.5): the new events' phrases as one `phrases`
// effect in stream order, silent events dropped, nothing for no new event or a first paint.
import { describe, expect, test } from 'vitest';

import type { GameEvent } from '../lib/events.ts';
import { SHELL_CUES } from '../lib/sound/cues.ts';
import { spec, type Phrase } from '../lib/sound/phrase.ts';
import { eventEffects } from './eventEffects.ts';
import type { ShellTypes } from './shell.ts';

type Ev = GameEvent<'play' | 'trick' | 'result', null>;
const ev = (id: number, kind: Ev['kind']): Ev => ({ id, kind, seat: 0, at: id, data: null });
const TRICK: Phrase = { steps: [{ cue: 'good.trick' }, { cue: 'score' }], buzz: [30, 40, 30] };
const phraseOf = (e: Ev): Phrase | null =>
  e.kind === 'trick' ? TRICK : e.kind === 'result' ? SHELL_CUES.win : null;

describe('eventEffects', () => {
  test('one `phrases` effect with the new events` phrases in order; silent events dropped', () => {
    const prev = [ev(0, 'play')];
    const next = [...prev, ev(1, 'play'), ev(2, 'trick'), ev(3, 'result')];
    expect(eventEffects<Ev, ShellTypes>(prev, next, phraseOf)).toEqual([
      { type: 'phrases', phrases: [TRICK, SHELL_CUES.win] },
    ]);
  });

  test('nothing when no event is new, when every new event is silent, or on a first paint', () => {
    const stream = [ev(0, 'play'), ev(1, 'trick')];
    expect(eventEffects<Ev, ShellTypes>(stream, stream, phraseOf)).toEqual([]);
    expect(eventEffects<Ev, ShellTypes>(stream, [...stream, ev(2, 'play')], phraseOf)).toEqual([]);
    expect(eventEffects<Ev, ShellTypes>(null, stream, phraseOf)).toEqual([]);
  });

  test('a one-step row is a phrase like any other', () => {
    expect(eventEffects<Ev, ShellTypes>([], [ev(0, 'result')], () => spec('victory', 12))).toEqual([
      { type: 'phrases', phrases: [spec('victory', 12)] },
    ]);
  });
});
