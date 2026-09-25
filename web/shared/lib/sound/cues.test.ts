// The cue vocabulary (docs/design/sound-fonts.md §2), frozen: a game's table and every font name
// these, so a rename here is a shared change and this list is where it shows first.
import { describe, expect, test } from 'vitest';

import {
  SHELL_CUES,
  SOUND_CUES,
  baseOf,
  decodeCueId,
  isCueId,
  isSoundCue,
  ladder,
  type CueId,
} from './cues.ts';

describe('the cue vocabulary', () => {
  test('twenty generic cues, in the design doc order, no duplicates', () => {
    expect(SOUND_CUES).toEqual([
      'tap',
      'move',
      'pickup',
      'draw',
      'roll',
      'capture',
      'score',
      'undo',
      'start',
      'turn',
      'good',
      'great',
      'bad',
      'neutral',
      'challenge',
      'victory',
      'loss',
      'connection',
      'disconnect',
      'invite',
    ]);
    expect(new Set(SOUND_CUES).size).toBe(20);
  });

  test("no cue names a game's own concept", () => {
    ['knock', 'gin', 'bearOff', 'hit', 'double', 'yourTurn', 'oppStock', 'win', 'lose'].forEach(
      (name) => {
        expect(SOUND_CUES).not.toContain(name);
      },
    );
  });
});

describe("the shell's rows (dry-round-2.md E9)", () => {
  test('tap, yourTurn, win and lose, each on a generic cue with a buzz; every game spreads them', () => {
    expect(Object.keys(SHELL_CUES)).toEqual(['tap', 'yourTurn', 'win', 'lose']);
    Object.values(SHELL_CUES).forEach(({ cue, buzz }) => {
      expect(SOUND_CUES).toContain(cue);
      expect(typeof buzz === 'number' ? [buzz] : buzz).not.toHaveLength(0);
    });
  });
});

describe('qualified cues (sound-fonts.md §2.1)', () => {
  test('the ladder walks a qualified id up to its base, most specific first; a base is its own ladder', () => {
    expect(ladder<CueId>('good.trick.briscola.steal')).toEqual([
      'good.trick.briscola.steal',
      'good.trick.briscola',
      'good.trick',
      'good',
    ]);
    expect(ladder<CueId>('good')).toEqual(['good']);
    expect(ladder('voice.trick.steal')).toEqual(['voice.trick.steal', 'voice.trick', 'voice']);
  });

  test('baseOf is the text before the first dot', () => {
    expect(baseOf('good.trick.steal')).toBe('good');
    expect(baseOf('victory')).toBe('victory');
    expect(isSoundCue('victory')).toBe(true);
    expect(isSoundCue('knock')).toBe(false);
  });

  test.each([
    'good',
    'good.trick',
    'good.trick.briscola.steal',
    'bad.trick.big-loss',
    'score.points22',
  ])('decodeCueId accepts %s: a known base, then dotted [a-z0-9-] segments', (id) => {
    expect(isCueId(id)).toBe(true);
    expect(decodeCueId(id)).toEqual({ ok: true, value: id });
  });

  test.each([
    ['knock', 'an unknown base'],
    ['knock.good', 'an unknown base with segments'],
    ['Good', 'upper case'],
    ['good.', 'a trailing dot'],
    ['.good', 'a leading dot'],
    ['good..trick', 'an empty segment'],
    ['good.Trick', 'an upper-case segment'],
    ['good.trick_steal', 'an underscore'],
    ['good trick', 'a space'],
    ['', 'nothing'],
    ['voice.trick', 'the voice namespace is not a cue'],
  ])('decodeCueId refuses %s (%s)', (id) => {
    expect(isCueId(id)).toBe(false);
    expect(decodeCueId(id)).toEqual({
      ok: false,
      error: { path: [], expected: 'a cue id: a base cue, then dotted segments of [a-z0-9-]' },
    });
  });

  test('decodeCueId refuses a non-string as the string decoder does', () => {
    expect(decodeCueId(7)).toEqual({ ok: false, error: { path: [], expected: 'string' } });
  });
});
