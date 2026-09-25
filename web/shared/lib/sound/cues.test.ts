// The cue vocabulary (docs/design/sound-fonts.md §2), frozen: a game's table and every font name
// these, so a rename here is a shared change and this list is where it shows first.
import { describe, expect, test } from 'vitest';

import { SHELL_CUES, SOUND_CUES } from './cues.ts';

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
