// FNV-1a, 32-bit (Fowler–Noll–Vo, the `a` variant: xor the byte, then multiply by the prime), over
// a string's UTF-16 code units, the low byte first and the high byte only when the unit has one, so
// an ASCII string hashes as its bytes and the classic vectors hold ('' → 0x811c9dc5, 'a' →
// 0xe40c292c, 'foobar' → 0xbf9cf968). Pure and cheap: one multiply per byte, no table, nothing
// secret. Briscola's clash variant (docs/design/briscola-battle.md §3.4) hashes
// `startedAt:gameNo:no:cardIds` with it so every device at a table decodes the same flavour digits
// without a wire field; `hash % 6480` is then biased by about 1.5 ppm, which no eye can see.
export const FNV_OFFSET_32 = 0x811c9dc5;
export const FNV_PRIME_32 = 0x01000193;

const mixByte = (h: number, byte: number): number => Math.imul(h ^ byte, FNV_PRIME_32) >>> 0;

/** The string's UTF-16 code units as bytes: one per unit below 256, else the low byte then the high. */
const bytesOf = (s: string): ReadonlyArray<number> =>
  Array.from({ length: s.length }, (_, i) => s.charCodeAt(i)).flatMap((unit) =>
    unit > 0xff ? [unit & 0xff, unit >>> 8] : [unit],
  );

/** The 32-bit FNV-1a hash of `s`, an unsigned integer (0 to 2^32 − 1). */
export const fnv1a32 = (s: string): number => bytesOf(s).reduce(mixByte, FNV_OFFSET_32) >>> 0;
