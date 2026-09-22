// The derived raster card backs (tools/card-backs.ts) are committed, because the deploying build
// has no browser to draw them with; this guards that each one the tool would write exists at the
// size it would draw, so a changed source or a changed width list is caught until the tool is
// re-run. The size is read from the JPEG's own start-of-frame marker: no image library.
import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import { RASTER_BACKS, RATIOS, derivedPath, derivedSize, type Size } from '../tools/card-backs.ts';

/** JPEG start-of-frame markers (SOF0–SOF15 without the DHT, JPG and DAC markers), which carry the frame's size. */
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** The frame size of a JPEG, walking its marker segments from the one after SOI; null when malformed. */
const jpegSize = (bytes: Buffer, at = 2): Size | null => {
  if (at + 9 > bytes.length || bytes[at] !== 0xff) return null;
  const marker = bytes[at + 1] ?? 0;
  if (SOF.has(marker))
    return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
  return jpegSize(bytes, at + 2 + bytes.readUInt16BE(at + 2));
};

describe('the derived raster card backs', () => {
  test('a source per raster back; the widths 112, 224 and 336 at the card aspect', () => {
    expect(Object.keys(RASTER_BACKS)).toEqual(['yu-gi-oh']);
    expect(RATIOS.map(derivedSize)).toEqual([
      { width: 112, height: 161 },
      { width: 224, height: 323 },
      { width: 336, height: 484 },
    ]);
  });

  Object.keys(RASTER_BACKS).forEach((name) => {
    RATIOS.forEach((ratio) => {
      test(`${name} at ${String(ratio)}x is committed at ${String(derivedSize(ratio).width)}px wide`, () => {
        const path = derivedPath(name, ratio);
        const bytes = readFileSync(new URL(`../${path}`, import.meta.url));
        expect(jpegSize(bytes)).toEqual(derivedSize(ratio));
        // A card back is a small file: the source is what the owner supplied, not what a phone loads.
        expect(bytes.byteLength).toBeLessThan(120_000);
      });
    });
  });

  test('the size reader: a source of 740 × 1079, and null for what is not a JPEG', () => {
    const source = readFileSync(new URL(`../${RASTER_BACKS['yu-gi-oh'] ?? ''}`, import.meta.url));
    expect(jpegSize(source)).toEqual({ width: 740, height: 1079 });
    expect(jpegSize(Buffer.from('not a jpeg'))).toBeNull();
  });
});
