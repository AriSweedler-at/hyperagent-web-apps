// The FNV-1a vectors (the reference implementation's, http://www.isthe.com/chongo/tech/comp/fnv/),
// determinism, the unsigned range, and that the low digits spread: the clash variant's arities
// divide the hash, so a constant low byte would make one variant far too common.
import { describe, expect, test } from 'vitest';

import { FNV_OFFSET_32, fnv1a32 } from './hash.ts';

describe('fnv1a32', () => {
  test('the reference vectors', () => {
    expect(fnv1a32('')).toBe(FNV_OFFSET_32);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });

  test('deterministic, unsigned, and a one-character change moves it', () => {
    const seed = '1727280000000:1:7:AC,3D';
    expect(fnv1a32(seed)).toBe(fnv1a32(seed));
    expect(fnv1a32(seed)).toBeGreaterThanOrEqual(0);
    expect(fnv1a32(seed)).toBeLessThan(2 ** 32);
    expect(fnv1a32(seed)).not.toBe(fnv1a32('1727280000000:1:8:AC,3D'));
  });

  test('a code unit above 255 hashes both bytes, so two strings differing only there differ', () => {
    expect(fnv1a32('café')).not.toBe(fnv1a32('cafǩ'));
  });

  test('the residues mod 6480 over 2000 seeds cover more than half the range', () => {
    const seen = new Set(
      Array.from({ length: 2000 }, (_, i) => fnv1a32(`1727280000000:1:${String(i)}:AC,3D`) % 6480),
    );
    expect(seen.size).toBeGreaterThan(1600);
  });
});
