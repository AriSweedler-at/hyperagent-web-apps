// The animation-speed literals (docs/design/briscola-battle.md §3.7, D8): three values, `normal`
// the default, the guard and the decoder accepting each and refusing anything else.
import { describe, expect, test } from 'vitest';

import { DEFAULT_SPEED, SPEEDS, decodeSpeed, isSpeed } from './speed.ts';

describe('speed', () => {
  test('three literals, normal the default', () => {
    expect(SPEEDS).toEqual(['normal', 'quick', 'off']);
    expect(DEFAULT_SPEED).toBe('normal');
    expect(SPEEDS).toContain(DEFAULT_SPEED);
  });

  test('isSpeed admits each literal and refuses a stranger, the empty string and a case change', () => {
    SPEEDS.forEach((s) => {
      expect(isSpeed(s)).toBe(true);
    });
    expect(isSpeed('fast')).toBe(false);
    expect(isSpeed('')).toBe(false);
    expect(isSpeed('Quick')).toBe(false);
  });

  test('decodeSpeed reads each literal back and refuses junk of every shape', () => {
    SPEEDS.forEach((s) => {
      expect(decodeSpeed(s)).toEqual({ ok: true, value: s });
    });
    expect(decodeSpeed('fast').ok).toBe(false);
    expect(decodeSpeed(1).ok).toBe(false);
    expect(decodeSpeed(null).ok).toBe(false);
    expect(decodeSpeed(undefined).ok).toBe(false);
  });
});
