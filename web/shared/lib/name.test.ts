import { describe, expect, test } from 'vitest';

import { normaliseName, type NameRule } from './name.ts';

// Fidice's rule (domain/types.ts NAME_RULE), the first consumer; the legacy lobby's
// `cleanName('  abcdefghijklmnopqrstuvwxyz ')` is 'abcdefghijklmnop' (test/parity/fidice.legacy).
const RULE: NameRule = { max: 16, fallback: 'Player' };

describe('normaliseName', () => {
  test.each([
    ['trims', '  Ari  ', 'Ari'],
    ['cuts at max after trimming', '  abcdefghijklmnopqrstuvwxyz ', 'abcdefghijklmnop'],
    ['keeps a name of exactly max whole', 'abcdefghijklmnop', 'abcdefghijklmnop'],
    ['cuts one over max', 'abcdefghijklmnopq', 'abcdefghijklmnop'],
    ['an empty name takes the fallback', '', 'Player'],
    ['a whitespace-only name takes the fallback', '   ', 'Player'],
    ['inner spaces stay', 'Big  Al', 'Big  Al'],
  ])('%s', (_, raw, expected) => {
    expect(normaliseName(raw, RULE)).toBe(expected);
  });

  test('an empty fallback yields the cut name or the empty string (the filter sites)', () => {
    const clean: NameRule = { max: 16, fallback: '' };
    expect(normaliseName('  Ziggy  ', clean)).toBe('Ziggy');
    expect(normaliseName('   ', clean)).toBe('');
  });
});
