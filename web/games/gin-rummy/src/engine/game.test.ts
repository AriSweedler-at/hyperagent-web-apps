import { describe, expect, test } from 'vitest';

import { inPlay } from './game.ts';

describe('inPlay', () => {
  test('the three phases a hand is played in; a round over or a game over is neither', () => {
    expect(inPlay('upcard')).toBe(true);
    expect(inPlay('draw')).toBe(true);
    expect(inPlay('discard')).toBe(true);
    expect(inPlay('roundOver')).toBe(false);
    expect(inPlay('gameOver')).toBe(false);
  });
});
