// The byte-level loops of tools/buddy-font.ts: joining byte arrays, patching one big-endian word,
// and undoing PNG's five scanline filters (the standard's "Filter type 0" set: None, Sub, Up,
// Average, Paeth), each a running computation over the previous byte and the row above that reads
// as a loop and nothing else. Everything here takes and returns plain Uint8Arrays; the writer keeps
// the layout knowledge.

/** One array holding every part in order. */
export const concatBytes = (parts: ReadonlyArray<Uint8Array>): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

/** A copy with the big-endian uint32 at `offset` replaced. */
export const withUint32 = (bytes: Uint8Array, offset: number, value: number): Uint8Array => {
  const out = new Uint8Array(bytes);
  new DataView(out.buffer, out.byteOffset, out.byteLength).setUint32(offset, value >>> 0);
  return out;
};

/** Paeth's predictor: whichever of left, up and up-left is nearest the gradient estimate. */
const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
};

/**
 * The inflated IDAT stream as raw pixel bytes: `height` scanlines of `width * bpp` bytes, each
 * one's leading filter byte consumed and its filter undone against the line above.
 */
export const unfilterScanlines = (
  raw: Uint8Array,
  width: number,
  height: number,
  bpp: number,
): Uint8Array => {
  const stride = width * bpp;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const inBase = y * (stride + 1) + 1;
    const outBase = y * stride;
    for (let i = 0; i < stride; i += 1) {
      const x = raw[inBase + i] ?? 0;
      const a = i >= bpp ? (out[outBase + i - bpp] ?? 0) : 0;
      const b = y > 0 ? (out[outBase - stride + i] ?? 0) : 0;
      const c = y > 0 && i >= bpp ? (out[outBase - stride + i - bpp] ?? 0) : 0;
      const predicted =
        filter === 1
          ? a
          : filter === 2
            ? b
            : filter === 3
              ? Math.floor((a + b) / 2)
              : filter === 4
                ? paeth(a, b, c)
                : 0;
      out[outBase + i] = (x + predicted) & 0xff;
    }
  }
  return out;
};
