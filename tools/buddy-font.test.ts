// The timer fonts read back with a reader of their own (docs/design/rps-buddy.md "Moving in the
// island"): the table directory and every checksum, the head's adjustment closing the file's sum
// to 0xB1B0AFBA, the cmap's lookup for space, colon and the ten digits, and each digit's glyph
// through loca and glyf: its bounding box and its pixel count are the frame's (the frame the digit
// cycles to), so the seconds digit shows the right frame. The committed .ttf files under the web
// folder and the iOS Config folder are the writer's own bytes (regenerable, no other tool), the
// preview page carries the font row once, and Chromium loads one font through `@font-face` and
// measures a digit at exactly one em (skipped where the Playwright browser is not installed: the
// harness CI job installs none; the pre-push hook and a laptop run it).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { chromium } from '@playwright/test';
import { format, resolveConfig } from 'prettier';
import { describe, expect, test } from 'vitest';

import {
  DIGITS,
  FONT_NAMES,
  GRID,
  INK,
  IOS_FONT_DIR,
  MOODS,
  PREVIEW_END,
  PREVIEW_START,
  PUBLIC_DIR,
  UNITS_PER_EM,
  WEB_FONT_DIR,
  buildFont,
  checksum,
  decodePng,
  fontFile,
  frameForDigit,
  framePath,
  hexOf,
  isLit,
  mask,
  previewRow,
  readFrames,
  runs,
  runsOfRow,
  unit,
  withPreviewRow,
  type Image,
  type Run,
} from './buddy-font.ts';
import { REPO_ROOT } from './legacy/extract.ts';

const readRepo = (path: string): Uint8Array =>
  new Uint8Array(readFileSync(resolve(REPO_ROOT, path)));

// --- A minimal reader ------------------------------------------------------------------------------

const view = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength);

type Entry = Readonly<{ tag: string; checksum: number; offset: number; length: number }>;

const directory = (font: Uint8Array): ReadonlyArray<Entry> => {
  const dv = view(font);
  return Array.from({ length: dv.getUint16(4) }, (_, i) => {
    const at = 12 + 16 * i;
    return {
      tag: String.fromCharCode(...font.subarray(at, at + 4)),
      checksum: dv.getUint32(at + 4),
      offset: dv.getUint32(at + 8),
      length: dv.getUint32(at + 12),
    };
  });
};

const table = (font: Uint8Array, tag: string): Uint8Array => {
  const entry = directory(font).find((e) => e.tag === tag);
  if (entry === undefined) throw new Error(`no ${tag} table`);
  return font.subarray(entry.offset, entry.offset + entry.length);
};

/** The glyph a character maps to, through the (3,1) record's format 4 subtable. */
const glyphFor = (font: Uint8Array, ch: string): number => {
  const cmap = table(font, 'cmap');
  const dv = view(cmap);
  const records = Array.from({ length: dv.getUint16(2) }, (_, i) => ({
    platform: dv.getUint16(4 + 8 * i),
    encoding: dv.getUint16(6 + 8 * i),
    offset: dv.getUint32(8 + 8 * i),
  }));
  const windows = records.find((r) => r.platform === 3 && r.encoding === 1);
  if (windows === undefined) throw new Error('no (3,1) cmap record');
  const sub = windows.offset;
  expect(dv.getUint16(sub)).toBe(4);
  const segCount = dv.getUint16(sub + 6) / 2;
  const ends = sub + 14;
  const starts = ends + segCount * 2 + 2;
  const deltas = starts + segCount * 2;
  const rangeOffsets = deltas + segCount * 2;
  const code = ch.charCodeAt(0);
  const seg = Array.from({ length: segCount }, (_, i) => i).find(
    (i) => code >= dv.getUint16(starts + 2 * i) && code <= dv.getUint16(ends + 2 * i),
  );
  if (seg === undefined) return 0;
  expect(dv.getUint16(rangeOffsets + 2 * seg)).toBe(0);
  return (code + dv.getUint16(deltas + 2 * seg)) & 0xffff;
};

type Rect = Readonly<{ left: number; top: number; right: number; bottom: number }>;
type ReadGlyph = Readonly<{
  bbox: Readonly<{ xMin: number; yMin: number; xMax: number; yMax: number }>;
  rects: ReadonlyArray<Rect>;
}>;

/** One glyph's rectangles, each contour read back as its four points. */
const readGlyph = (font: Uint8Array, gid: number): ReadGlyph | null => {
  const loca = view(table(font, 'loca'));
  const from = loca.getUint32(gid * 4);
  const to = loca.getUint32(gid * 4 + 4);
  if (from === to) return null;
  const glyf = table(font, 'glyf').subarray(from, to);
  const dv = view(glyf);
  const contours = dv.getInt16(0);
  const bbox = {
    xMin: dv.getInt16(2),
    yMin: dv.getInt16(4),
    xMax: dv.getInt16(6),
    yMax: dv.getInt16(8),
  };
  const ends = Array.from({ length: contours }, (_, i) => dv.getUint16(10 + 2 * i));
  const pointCount = (ends.at(-1) ?? -1) + 1;
  const instructionLength = dv.getUint16(10 + 2 * contours);
  const flagsAt = 12 + 2 * contours + instructionLength;
  const flags = Array.from({ length: pointCount }, (_, i) => glyf[flagsAt + i] ?? 0);
  expect(flags.every((f) => f === 0x01)).toBe(true);
  const xsAt = flagsAt + pointCount;
  const ysAt = xsAt + 2 * pointCount;
  const xs = Array.from({ length: pointCount }, (_, i) => dv.getInt16(xsAt + 2 * i)).reduce<
    ReadonlyArray<number>
  >((acc, d) => [...acc, (acc.at(-1) ?? 0) + d], []);
  const ys = Array.from({ length: pointCount }, (_, i) => dv.getInt16(ysAt + 2 * i)).reduce<
    ReadonlyArray<number>
  >((acc, d) => [...acc, (acc.at(-1) ?? 0) + d], []);
  const rects = ends.map((end, i) => {
    const start = i === 0 ? 0 : (ends[i - 1] ?? 0) + 1;
    expect(end - start).toBe(3);
    const px = xs.slice(start, end + 1);
    const py = ys.slice(start, end + 1);
    return {
      left: Math.min(...px),
      right: Math.max(...px),
      top: Math.max(...py),
      bottom: Math.min(...py),
    };
  });
  return { bbox, rects };
};

/** A font-unit edge back to its grid edge. */
const gridEdge = (u: number): number => Math.round((u * GRID) / UNITS_PER_EM);

const rectPixels = (r: Rect): number =>
  (gridEdge(r.right) - gridEdge(r.left)) * (gridEdge(r.top) - gridEdge(r.bottom));

/** The lit cells' bounding box in the grid, as the glyph's box in font units should read. */
const maskBox = (
  image: Image,
): Readonly<{ xMin: number; yMin: number; xMax: number; yMax: number }> => {
  const lit = runs(mask(image), image.width);
  return {
    xMin: unit(Math.min(...lit.map((r) => r.x0))),
    xMax: unit(Math.max(...lit.map((r) => r.x1 + 1))),
    yMin: unit(GRID - Math.max(...lit.map((r) => r.y)) - 1),
    yMax: unit(GRID - Math.min(...lit.map((r) => r.y))),
  };
};

const litCount = (image: Image): number => image.pixels.filter(isLit).length;

// --- The frames ------------------------------------------------------------------------------------

describe('the frames as masks', () => {
  test('a frame decodes to a 24x24 RGBA image of hard pixels, ink among its colours', () => {
    const image = decodePng(readRepo(framePath('happy', 0)));
    expect(image.width).toBe(GRID);
    expect(image.height).toBe(GRID);
    expect(image.pixels).toHaveLength(GRID * GRID);
    expect(image.pixels.every((p) => p.a === 0 || p.a === 255)).toBe(true);
    const colours = new Set(image.pixels.filter((p) => p.a === 255).map(hexOf));
    expect(colours.has(INK)).toBe(true);
    expect(colours.has('#f5cd3b')).toBe(true);
    expect(litCount(image)).toBeGreaterThan(100);
    expect(image.pixels.filter((p) => p.a === 255 && !isLit(p)).length).toBeGreaterThan(4);
  });

  test('runs join neighbouring lit cells and stop at a gap', () => {
    const row = [false, true, true, false, true, true, true, false];
    const expected: ReadonlyArray<Run> = [
      { x0: 1, x1: 2, y: 3 },
      { x0: 4, x1: 6, y: 3 },
    ];
    expect(runsOfRow(row, 3)).toEqual(expected);
    expect(runs([...row, ...row], row.length).map((r) => r.y)).toEqual([0, 0, 1, 1]);
  });

  test('grid edges are integers that neighbours share and the em is 24 pixels', () => {
    expect(unit(0)).toBe(0);
    expect(unit(GRID)).toBe(UNITS_PER_EM);
    expect(unit(1)).toBe(43);
    expect(Array.from({ length: GRID + 1 }, (_, n) => unit(n)).every(Number.isInteger)).toBe(true);
  });

  test('the digits cycle the frames', () => {
    expect(DIGITS.map((d) => frameForDigit(Number(d), 4))).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0, 1]);
    expect(DIGITS.map((d) => frameForDigit(Number(d), 6))).toEqual([0, 1, 2, 3, 4, 5, 0, 1, 2, 3]);
  });
});

// --- The fonts ---------------------------------------------------------------------------------------

describe.each(MOODS)('the %s font', (mood) => {
  const frames = readFrames(mood);
  const font = buildFont(FONT_NAMES[mood], frames);

  test('has the ten tables in tag order with the directory checksums and the closing adjustment', () => {
    const entries = directory(font);
    expect(entries.map((e) => e.tag)).toEqual([
      'OS/2',
      'cmap',
      'glyf',
      'head',
      'hhea',
      'hmtx',
      'loca',
      'maxp',
      'name',
      'post',
    ]);
    entries.forEach((e) => {
      expect(e.offset % 4).toBe(0);
      const bytes = font.subarray(e.offset, e.offset + e.length);
      const stored =
        e.tag === 'head'
          ? checksum(Uint8Array.from(bytes, (b, i) => (i >= 8 && i < 12 ? 0 : b)))
          : checksum(bytes);
      expect(stored).toBe(e.checksum);
    });
    expect(checksum(font)).toBe(0xb1b0afba);
    const head = view(table(font, 'head'));
    expect(head.getUint32(12)).toBe(0x5f0f3cf5);
    expect(head.getUint16(18)).toBe(UNITS_PER_EM);
    expect(head.getInt16(50)).toBe(1);
    expect(view(table(font, 'maxp')).getUint16(4)).toBe(13);
  });

  test('names itself for .font(.custom) and @font-face', () => {
    const name = table(font, 'name');
    const dv = view(name);
    const count = dv.getUint16(2);
    const stringOffset = dv.getUint16(4);
    const records = Array.from({ length: count }, (_, i) => ({
      platform: dv.getUint16(6 + 12 * i),
      id: dv.getUint16(12 + 12 * i),
      length: dv.getUint16(14 + 12 * i),
      offset: dv.getUint16(16 + 12 * i),
    }));
    const text = (r: (typeof records)[number]): string => {
      const bytes = name.subarray(stringOffset + r.offset, stringOffset + r.offset + r.length);
      return r.platform === 3
        ? String.fromCharCode(
            ...Array.from({ length: bytes.length / 2 }, (_, i) => view(bytes).getUint16(2 * i)),
          )
        : String.fromCharCode(...bytes);
    };
    const byId = (platform: number, id: number): string | undefined =>
      records.filter((r) => r.platform === platform && r.id === id).map(text)[0];
    [1, 3].forEach((platform) => {
      expect(byId(platform, 1)).toBe(FONT_NAMES[mood]);
      expect(byId(platform, 4)).toBe(FONT_NAMES[mood]);
      expect(byId(platform, 6)).toBe(FONT_NAMES[mood]);
      expect(byId(platform, 2)).toBe('Regular');
    });
  });

  test('maps space and colon to empty zero-width glyphs and the digits to one-em frames', () => {
    const hmtx = view(table(font, 'hmtx'));
    const advance = (gid: number): number => hmtx.getUint16(gid * 4);
    expect(glyphFor(font, ' ')).toBe(1);
    expect(glyphFor(font, ':')).toBe(2);
    expect(glyphFor(font, 'x')).toBe(0);
    expect(readGlyph(font, 0)).toBeNull();
    expect(readGlyph(font, 1)).toBeNull();
    expect(readGlyph(font, 2)).toBeNull();
    expect([0, 1, 2].map(advance)).toEqual([0, 0, 0]);
    DIGITS.forEach((d, i) => {
      expect(glyphFor(font, d)).toBe(3 + i);
      expect(advance(3 + i)).toBe(UNITS_PER_EM);
    });
  });

  test('every digit draws the frame it cycles to: its box and its pixel count', () => {
    DIGITS.forEach((d) => {
      const frame = frames[frameForDigit(Number(d), frames.length)];
      if (frame === undefined) throw new Error('missing frame');
      const glyph = readGlyph(font, glyphFor(font, d));
      if (glyph === null) throw new Error(`digit ${d} has no outline`);
      expect(glyph.bbox).toEqual(maskBox(frame));
      expect(glyph.rects.reduce((n, r) => n + rectPixels(r), 0)).toBe(litCount(frame));
      expect(glyph.rects).toHaveLength(runs(mask(frame), frame.width).length);
      const hmtx = view(table(font, 'hmtx'));
      expect(hmtx.getInt16(glyphFor(font, d) * 4 + 2)).toBe(glyph.bbox.xMin);
    });
  });

  test('the committed fonts are these bytes, on the web and in the iOS bundle', () => {
    expect(readRepo(`${WEB_FONT_DIR}/${fontFile(mood)}`)).toEqual(font);
    expect(readRepo(`${IOS_FONT_DIR}/${fontFile(mood)}`)).toEqual(font);
  });
});

// --- The preview page -------------------------------------------------------------------------------

describe('the preview page', () => {
  test('carries the font row once, formatted; the tool then prettier reproduce it byte for byte', async () => {
    const path = resolve(REPO_ROOT, `${PUBLIC_DIR}/preview.html`);
    const html = readFileSync(path, 'utf8');
    expect(html.split(PREVIEW_START)).toHaveLength(2);
    expect(html.split(PREVIEW_END)).toHaveLength(2);
    expect(html).toContain('id="fonts"');
    MOODS.forEach((mood) => {
      expect(html).toContain(`url(fonts/${fontFile(mood)})`);
      expect(html).toContain(`font-family: '${FONT_NAMES[mood]}'`);
    });
    expect(previewRow()).toContain(PREVIEW_START);
    const options = (await resolveConfig(path)) ?? {};
    expect(await format(withPreviewRow(html), { ...options, filepath: path })).toBe(html);
  });
});

// --- Chromium -----------------------------------------------------------------------------------------

const chromiumInstalled = existsSync(chromium.executablePath());

describe('in Chromium', () => {
  test.skipIf(!chromiumInstalled)(
    'the happy font loads through @font-face and a digit measures one em',
    async () => {
      const font = readRepo(`${WEB_FONT_DIR}/${fontFile('happy')}`);
      const b64 = Buffer.from(font).toString('base64');
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        await page.setContent(
          `<style>@font-face { font-family: 'Buddy-Happy'; src: url(data:font/ttf;base64,${b64}) format('truetype'); }</style><canvas id="c" width="64" height="64"></canvas>`,
        );
        type Measured = Readonly<{
          loaded: boolean;
          em: number;
          colon: number;
          timer: number;
          alpha: number;
        }>;
        // A string, not a closure: the node tsconfig has no DOM types, and the page is the judge.
        const result = await page.evaluate<Measured>(`(async () => {
          await document.fonts.load("32px 'Buddy-Happy'");
          const canvas = document.querySelector('canvas');
          const ctx = canvas.getContext('2d');
          ctx.font = "32px 'Buddy-Happy'";
          const em = ctx.measureText('7').width;
          const colon = ctx.measureText(':').width;
          const timer = ctx.measureText('12:37').width;
          ctx.fillStyle = '#f5cd3b';
          ctx.fillText('7', 0, 32);
          const alpha = Array.from(ctx.getImageData(0, 0, 32, 32).data).filter(
            (v, i) => i % 4 === 3 && v > 0,
          ).length;
          return { loaded: document.fonts.check("32px 'Buddy-Happy'"), em, colon, timer, alpha };
        })()`);
        expect(result.loaded).toBe(true);
        expect(result.em).toBe(32);
        expect(result.colon).toBe(0);
        expect(result.timer).toBe(128);
        expect(result.alpha).toBeGreaterThan(200);
      } finally {
        await browser.close();
      }
    },
    30_000,
  );
});
