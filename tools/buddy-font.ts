// The buddy's timer fonts (docs/design/rps-buddy.md "Moving in the island"): a Live Activity runs
// no free animation, but `Text(timerInterval:)` ticks on its own, so a font whose ten digit glyphs
// are a mood's frames turns the seconds' units digit into a 1 fps sprite loop with no pushes. One
// TrueType font per mood, written here from the PNG frames under web/public/games/rps/buddy/ with
// no font library and no PNG library: the PNG's IDAT is inflated with node's zlib and unfiltered
// by hand (8-bit RGBA, filters 0-4), every lit pixel (opaque and not the ink of the eyes and the
// mouth) becomes part of the glyph's mask (the mood's colour comes from the view's foregroundStyle;
// the ink pixels are holes the island's black shows through), one closed contour per horizontal
// run of lit pixels per row on a 24-pixel grid mapped to 1024 units per em (a pixel is 42.67 units,
// rounded to integers), a digit advances exactly one em, space and colon are empty and zero-wide,
// and the ten tables (head, hhea, maxp, OS/2, hmtx, cmap, loca, glyf, name, post) carry correct
// checksums and the head's checkSumAdjustment. The digits cycle the frames: a 4-frame walk is
// 0 1 2 3 0 1 2 3 0 1, a 6-frame bounce 0 1 2 3 4 5 0 1 2 3, so the loop skips once every ten
// seconds. The same bytes land in ios/DiceClip/Config/Fonts/ and web/public/games/rps/buddy/fonts/,
// and preview.html gets its font row between two markers. tools/buddy-font.test.ts reads the
// fonts back.
//   node --experimental-strip-types tools/buddy-font.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

import { concatBytes, unfilterScanlines, withUint32 } from './buddy-font.algorithms.ts';
import { REPO_ROOT, isMain } from './legacy/extract.ts';

export type Mood = 'very-sad' | 'sad' | 'neutral' | 'happy' | 'very-happy';

/** The moods in counter order, −5 up to +5; the hops get no font (a hop plays once, on a push). */
export const MOODS: ReadonlyArray<Mood> = ['very-sad', 'sad', 'neutral', 'happy', 'very-happy'];

/** The font's family, full and PostScript name: what `.font(.custom(_:size:))` and `@font-face` use. */
export const FONT_NAMES: Readonly<Record<Mood, string>> = {
  'very-sad': 'Buddy-VerySad',
  sad: 'Buddy-Sad',
  neutral: 'Buddy-Neutral',
  happy: 'Buddy-Happy',
  'very-happy': 'Buddy-VeryHappy',
};

export const PUBLIC_DIR = 'web/public/games/rps/buddy';
export const WEB_FONT_DIR = `${PUBLIC_DIR}/fonts`;
export const IOS_FONT_DIR = 'ios/DiceClip/Config/Fonts';

/** The frames' grid and the em: a pixel is UNITS_PER_EM / GRID units, rounded per edge. */
export const GRID = 24;
export const UNITS_PER_EM = 1024;

/** The frames' ink (tools/buddy-frames.ts `INK`): eyes and mouth, left out of the mask as holes. */
export const INK = '#2a2622';

/** The ten digits; the glyph order is .notdef, space, colon, then these. */
export const DIGITS: ReadonlyArray<string> = Array.from({ length: 10 }, (_, d) => String(d));
const GLYPH_NOTDEF = 0;
const GLYPH_SPACE = 1;
const GLYPH_COLON = 2;
const GLYPH_DIGIT_FIRST = 3;

/** head.created and head.modified, fixed so a regeneration is byte-identical. */
export const FONT_DATE = '2026-09-29T00:00:00Z';

// --- PNG ---------------------------------------------------------------------------------------

export type Rgba = Readonly<{ r: number; g: number; b: number; a: number }>;
export type Image = Readonly<{ width: number; height: number; pixels: ReadonlyArray<Rgba> }>;

const PNG_SIGNATURE: ReadonlyArray<number> = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

type Chunk = Readonly<{ type: string; data: Uint8Array }>;

const view = (bytes: Uint8Array): DataView =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** The chunks after the signature, in order, up to and including IEND. */
const chunks = (bytes: Uint8Array, offset = 8): ReadonlyArray<Chunk> => {
  if (offset + 8 > bytes.length) return [];
  const dv = view(bytes);
  const length = dv.getUint32(offset);
  const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
  const data = bytes.subarray(offset + 8, offset + 8 + length);
  const rest = type === 'IEND' ? [] : chunks(bytes, offset + 12 + length);
  return [{ type, data }, ...rest];
};

/** An 8-bit RGBA, non-interlaced PNG as pixels, row-major; anything else throws. */
export const decodePng = (bytes: Uint8Array): Image => {
  if (!PNG_SIGNATURE.every((b, i) => bytes[i] === b)) throw new Error('not a PNG');
  const all = chunks(bytes);
  const ihdr = all.find((c) => c.type === 'IHDR');
  if (ihdr === undefined) throw new Error('PNG without IHDR');
  const dv = view(ihdr.data);
  const width = dv.getUint32(0);
  const height = dv.getUint32(4);
  const [bitDepth, colourType, interlace] = [ihdr.data[8], ihdr.data[9], ihdr.data[12]];
  if (bitDepth !== 8 || colourType !== 6 || interlace !== 0) {
    throw new Error(
      `PNG must be 8-bit RGBA, not interlaced (got ${String(bitDepth)}/${String(colourType)}/${String(interlace)})`,
    );
  }
  const idat = concatBytes(all.filter((c) => c.type === 'IDAT').map((c) => c.data));
  const raw = unfilterScanlines(new Uint8Array(inflateSync(idat)), width, height, 4);
  const pixels = Array.from({ length: width * height }, (_, i) => ({
    r: raw[i * 4] ?? 0,
    g: raw[i * 4 + 1] ?? 0,
    b: raw[i * 4 + 2] ?? 0,
    a: raw[i * 4 + 3] ?? 0,
  }));
  return { width, height, pixels };
};

const hex2 = (n: number): string => n.toString(16).padStart(2, '0');

/** `#rrggbb` of a pixel, its alpha ignored. */
export const hexOf = (p: Rgba): string => `#${hex2(p.r)}${hex2(p.g)}${hex2(p.b)}`;

/** Lit: opaque and not ink. The mask the glyph fills. */
export const isLit = (p: Rgba): boolean => p.a > 0 && hexOf(p) !== INK;

/** The lit cells of an image, row-major booleans. */
export const mask = (image: Image): ReadonlyArray<boolean> => image.pixels.map(isLit);

// --- The glyph geometry --------------------------------------------------------------------------

export type Run = Readonly<{ x0: number; x1: number; y: number }>;

/** The horizontal runs of lit cells in one row: `x0` the first lit column, `x1` the last. */
export const runsOfRow = (row: ReadonlyArray<boolean>, y: number): ReadonlyArray<Run> =>
  row.reduce<ReadonlyArray<Run>>((runs, lit, x) => {
    if (!lit) return runs;
    const last = runs.at(-1);
    return last?.x1 === x - 1
      ? [...runs.slice(0, -1), { ...last, x1: x }]
      : [...runs, { x0: x, x1: x, y }];
  }, []);

/** Every run of a `width`-wide mask, row by row. */
export const runs = (cells: ReadonlyArray<boolean>, width: number): ReadonlyArray<Run> =>
  Array.from({ length: Math.ceil(cells.length / width) }, (_, y) =>
    runsOfRow(cells.slice(y * width, (y + 1) * width), y),
  ).flat();

/** A grid edge in font units: edge `n` of GRID, rounded once so neighbours share it exactly. */
export const unit = (n: number): number => Math.round((n * UNITS_PER_EM) / GRID);

export type Point = Readonly<{ x: number; y: number }>;

/**
 * A run as a closed contour, clockwise with y up (TrueType's outer direction): the row `y` from
 * the top of the grid becomes the band unit(GRID − y − 1) … unit(GRID − y) above the baseline.
 */
export const contour = (run: Run): ReadonlyArray<Point> => {
  const left = unit(run.x0);
  const right = unit(run.x1 + 1);
  const top = unit(GRID - run.y);
  const bottom = unit(GRID - run.y - 1);
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
};

export type Glyph = Readonly<{
  contours: ReadonlyArray<ReadonlyArray<Point>>;
  advance: number;
}>;

export type Bounds = Readonly<{ xMin: number; yMin: number; xMax: number; yMax: number }>;

const EMPTY_BOUNDS: Bounds = { xMin: 0, yMin: 0, xMax: 0, yMax: 0 };

export const bounds = (glyph: Glyph): Bounds => {
  const points = glyph.contours.flat();
  if (points.length === 0) return EMPTY_BOUNDS;
  return {
    xMin: Math.min(...points.map((p) => p.x)),
    yMin: Math.min(...points.map((p) => p.y)),
    xMax: Math.max(...points.map((p) => p.x)),
    yMax: Math.max(...points.map((p) => p.y)),
  };
};

/** A frame as a digit glyph: one contour per run, one em of advance. */
export const frameGlyph = (image: Image): Glyph => ({
  contours: runs(mask(image), image.width).map(contour),
  advance: UNITS_PER_EM,
});

const EMPTY_GLYPH: Glyph = { contours: [], advance: 0 };

/** The digit `d` shows frame `d mod frames`: the cycle 0 1 2 3 0 1 2 3 0 1 for four frames. */
export const frameForDigit = (digit: number, frames: number): number => digit % frames;

/** The thirteen glyphs of a mood's font, in glyph order. */
export const glyphsFor = (frames: ReadonlyArray<Image>): ReadonlyArray<Glyph> => {
  if (frames.length === 0) throw new Error('a font needs at least one frame');
  const digits = Array.from({ length: 10 }, (_, d) => frames[frameForDigit(d, frames.length)]);
  return [
    EMPTY_GLYPH,
    EMPTY_GLYPH,
    EMPTY_GLYPH,
    ...digits.map((image) => (image === undefined ? EMPTY_GLYPH : frameGlyph(image))),
  ];
};

// --- Bytes -----------------------------------------------------------------------------------------

const u8 = (...values: ReadonlyArray<number>): Uint8Array => Uint8Array.from(values);
const u16 = (n: number): Uint8Array => u8((n >>> 8) & 0xff, n & 0xff);
const i16 = (n: number): Uint8Array => u16(n & 0xffff);
const u32 = (n: number): Uint8Array =>
  u8((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
const fixed = (n: number): Uint8Array => u32(Math.round(n * 65536));
const tag = (s: string): Uint8Array => u8(...Array.from(s, (c) => c.charCodeAt(0)));
const ascii = (s: string): Uint8Array => tag(s);
const utf16 = (s: string): Uint8Array => concatBytes(Array.from(s, (c) => u16(c.charCodeAt(0))));
const zeros = (n: number): Uint8Array => new Uint8Array(n);
const many = (n: number, bytes: (i: number) => Uint8Array): Uint8Array =>
  concatBytes(Array.from({ length: n }, (_, i) => bytes(i)));

/** Padded to a multiple of four with zeros, as the table directory expects. */
export const pad4 = (bytes: Uint8Array): Uint8Array =>
  concatBytes([bytes, zeros((4 - (bytes.length % 4)) % 4)]);

/** The OpenType checksum: the uint32 sum of the padded bytes, modulo 2^32. */
export const checksum = (bytes: Uint8Array): number => {
  const padded = pad4(bytes);
  const dv = view(padded);
  return Array.from({ length: padded.length / 4 }, (_, i) => dv.getUint32(i * 4)).reduce(
    (sum, word) => (sum + word) >>> 0,
    0,
  );
};

/** LONGDATETIME: seconds since 1904-01-01T00:00:00Z, eight bytes. */
const longDateTime = (iso: string): Uint8Array => {
  const seconds = Math.floor(Date.parse(iso) / 1000) + 2082844800;
  return concatBytes([u32(Math.floor(seconds / 2 ** 32)), u32(seconds % 2 ** 32)]);
};

// --- Tables --------------------------------------------------------------------------------------

/** A glyph's `glyf` entry: header, end points, no instructions, one flag per point, int16 deltas. */
export const glyfEntry = (glyph: Glyph): Uint8Array => {
  if (glyph.contours.length === 0) return zeros(0);
  const points = glyph.contours.flat();
  const b = bounds(glyph);
  const ends = glyph.contours.map(
    (_, i) => glyph.contours.slice(0, i + 1).reduce((n, cc) => n + cc.length, 0) - 1,
  );
  const deltas = points.map((p, i) => {
    const prev = i === 0 ? { x: 0, y: 0 } : (points[i - 1] ?? { x: 0, y: 0 });
    return { dx: p.x - prev.x, dy: p.y - prev.y };
  });
  return concatBytes([
    i16(glyph.contours.length),
    i16(b.xMin),
    i16(b.yMin),
    i16(b.xMax),
    i16(b.yMax),
    ...ends.map(u16),
    u16(0),
    many(points.length, () => u8(0x01)),
    ...deltas.map((d) => i16(d.dx)),
    ...deltas.map((d) => i16(d.dy)),
  ]);
};

export type GlyfLoca = Readonly<{ glyf: Uint8Array; loca: Uint8Array }>;

/** glyf with every entry padded to four bytes, and the long-format loca over it. */
export const glyfAndLoca = (glyphs: ReadonlyArray<Glyph>): GlyfLoca => {
  const entries = glyphs.map((g) => pad4(glyfEntry(g)));
  const offsets = entries.reduce<ReadonlyArray<number>>(
    (acc, e) => [...acc, (acc.at(-1) ?? 0) + e.length],
    [0],
  );
  return { glyf: concatBytes(entries), loca: concatBytes(offsets.map(u32)) };
};

export const hmtx = (glyphs: ReadonlyArray<Glyph>): Uint8Array =>
  concatBytes(glyphs.map((g) => concatBytes([u16(g.advance), i16(bounds(g).xMin)])));

const fontBounds = (glyphs: ReadonlyArray<Glyph>): Bounds => {
  const drawn = glyphs.filter((g) => g.contours.length > 0).map(bounds);
  if (drawn.length === 0) return EMPTY_BOUNDS;
  return {
    xMin: Math.min(...drawn.map((b) => b.xMin)),
    yMin: Math.min(...drawn.map((b) => b.yMin)),
    xMax: Math.max(...drawn.map((b) => b.xMax)),
    yMax: Math.max(...drawn.map((b) => b.yMax)),
  };
};

/** head with checkSumAdjustment 0; `buildFont` patches the adjustment in. */
export const head = (glyphs: ReadonlyArray<Glyph>): Uint8Array => {
  const b = fontBounds(glyphs);
  return concatBytes([
    fixed(1), // version
    fixed(1), // fontRevision
    u32(0), // checkSumAdjustment
    u32(0x5f0f3cf5), // magicNumber
    u16(0x000b), // flags: baseline at y 0, lsb at x 0, integer scaling
    u16(UNITS_PER_EM),
    longDateTime(FONT_DATE),
    longDateTime(FONT_DATE),
    i16(b.xMin),
    i16(b.yMin),
    i16(b.xMax),
    i16(b.yMax),
    u16(0), // macStyle
    u16(8), // lowestRecPPEM
    i16(2), // fontDirectionHint
    i16(1), // indexToLocFormat: long
    i16(0), // glyphDataFormat
  ]);
};

export const hhea = (glyphs: ReadonlyArray<Glyph>): Uint8Array => {
  const drawn = glyphs.filter((g) => g.contours.length > 0);
  const b = fontBounds(glyphs);
  const minRsb = Math.min(...drawn.map((g) => g.advance - bounds(g).xMax), 0);
  return concatBytes([
    fixed(1),
    i16(UNITS_PER_EM), // ascender: the grid's top
    i16(0), // descender: the grid's bottom is the baseline
    i16(0), // lineGap
    u16(Math.max(...glyphs.map((g) => g.advance), 0)), // advanceWidthMax
    i16(b.xMin), // minLeftSideBearing
    i16(minRsb), // minRightSideBearing
    i16(b.xMax), // xMaxExtent
    i16(1), // caretSlopeRise
    i16(0), // caretSlopeRun
    i16(0), // caretOffset
    zeros(8), // reserved
    i16(0), // metricDataFormat
    u16(glyphs.length), // numberOfHMetrics
  ]);
};

export const maxp = (glyphs: ReadonlyArray<Glyph>): Uint8Array =>
  concatBytes([
    fixed(1),
    u16(glyphs.length),
    u16(Math.max(...glyphs.map((g) => g.contours.flat().length), 0)), // maxPoints
    u16(Math.max(...glyphs.map((g) => g.contours.length), 0)), // maxContours
    u16(0), // maxCompositePoints
    u16(0), // maxCompositeContours
    u16(1), // maxZones
    u16(0), // maxTwilightPoints
    u16(0), // maxStorage
    u16(0), // maxFunctionDefs
    u16(0), // maxInstructionDefs
    u16(0), // maxStackElements
    u16(0), // maxSizeOfInstructions
    u16(0), // maxComponentElements
    u16(0), // maxComponentDepth
  ]);

export const os2 = (): Uint8Array =>
  concatBytes([
    u16(4), // version
    i16(UNITS_PER_EM), // xAvgCharWidth
    u16(400), // usWeightClass
    u16(5), // usWidthClass
    u16(0), // fsType: installable
    i16(640), // ySubscriptXSize
    i16(640), // ySubscriptYSize
    i16(0), // ySubscriptXOffset
    i16(140), // ySubscriptYOffset
    i16(640), // ySuperscriptXSize
    i16(640), // ySuperscriptYSize
    i16(0), // ySuperscriptXOffset
    i16(480), // ySuperscriptYOffset
    i16(50), // yStrikeoutSize
    i16(512), // yStrikeoutPosition
    i16(0), // sFamilyClass
    zeros(10), // panose
    u32(1), // ulUnicodeRange1: Basic Latin
    u32(0),
    u32(0),
    u32(0),
    tag('BUDY'), // achVendID
    u16(0x00c0), // fsSelection: REGULAR, USE_TYPO_METRICS
    u16(0x0020), // usFirstCharIndex: space
    u16(0x003a), // usLastCharIndex: colon
    i16(UNITS_PER_EM), // sTypoAscender
    i16(0), // sTypoDescender
    i16(0), // sTypoLineGap
    u16(UNITS_PER_EM), // usWinAscent
    u16(0), // usWinDescent
    u32(1), // ulCodePageRange1: Latin 1
    u32(0),
    i16(UNITS_PER_EM), // sxHeight
    i16(UNITS_PER_EM), // sCapHeight
    u16(0), // usDefaultChar
    u16(0x0020), // usBreakChar
    u16(0), // usMaxContext
  ]);

type Segment = Readonly<{ start: number; end: number; glyph: number }>;

/** The three ranges the timer can emit, then the closing 0xFFFF segment. */
const SEGMENTS: ReadonlyArray<Segment> = [
  { start: 0x20, end: 0x20, glyph: GLYPH_SPACE },
  { start: 0x30, end: 0x39, glyph: GLYPH_DIGIT_FIRST },
  { start: 0x3a, end: 0x3a, glyph: GLYPH_COLON },
  { start: 0xffff, end: 0xffff, glyph: GLYPH_NOTDEF },
];

/** cmap: one format 4 subtable, reached from both the Unicode (0,3) and the Windows (3,1) records. */
export const cmap = (): Uint8Array => {
  const segCount = SEGMENTS.length;
  const entrySelector = Math.floor(Math.log2(segCount));
  const searchRange = 2 * 2 ** entrySelector;
  const subtableLength = 16 + 8 * segCount;
  const subtable = concatBytes([
    u16(4),
    u16(subtableLength),
    u16(0), // language
    u16(segCount * 2),
    u16(searchRange),
    u16(entrySelector),
    u16(segCount * 2 - searchRange),
    ...SEGMENTS.map((s) => u16(s.end)),
    u16(0), // reservedPad
    ...SEGMENTS.map((s) => u16(s.start)),
    ...SEGMENTS.map((s) => u16(s.glyph === GLYPH_NOTDEF ? 1 : (s.glyph - s.start) & 0xffff)),
    ...SEGMENTS.map(() => u16(0)),
  ]);
  const headerLength = 4 + 8 * 2;
  return concatBytes([
    u16(0),
    u16(2),
    u16(0),
    u16(3),
    u32(headerLength),
    u16(3),
    u16(1),
    u32(headerLength),
    subtable,
  ]);
};

type NameRecord = Readonly<{
  platform: number;
  encoding: number;
  language: number;
  id: number;
  text: string;
}>;

/** The seven strings every reader wants, once for the Mac (ASCII) and once for Windows (UTF-16). */
export const nameStrings = (
  fontName: string,
): ReadonlyArray<Readonly<{ id: number; text: string }>> => [
  {
    id: 0,
    text: 'Original pixel art from the games repository (tools/buddy-frames.ts); the font by tools/buddy-font.ts.',
  },
  { id: 1, text: fontName },
  { id: 2, text: 'Regular' },
  { id: 3, text: `${fontName};BUDY;1.000` },
  { id: 4, text: fontName },
  { id: 5, text: 'Version 1.000' },
  { id: 6, text: fontName },
];

export const name = (fontName: string): Uint8Array => {
  const strings = nameStrings(fontName);
  const records: ReadonlyArray<NameRecord> = [
    ...strings.map((s) => ({ platform: 1, encoding: 0, language: 0, ...s })),
    ...strings.map((s) => ({ platform: 3, encoding: 1, language: 0x0409, ...s })),
  ];
  const encoded = records.map((r) => (r.platform === 3 ? utf16(r.text) : ascii(r.text)));
  const offsets = encoded.reduce<ReadonlyArray<number>>(
    (acc, e) => [...acc, (acc.at(-1) ?? 0) + e.length],
    [0],
  );
  const stringOffset = 6 + 12 * records.length;
  return concatBytes([
    u16(0),
    u16(records.length),
    u16(stringOffset),
    ...records.map((r, i) =>
      concatBytes([
        u16(r.platform),
        u16(r.encoding),
        u16(r.language),
        u16(r.id),
        u16(encoded[i]?.length ?? 0),
        u16(offsets[i] ?? 0),
      ]),
    ),
    ...encoded,
  ]);
};

/** post version 3: no glyph names; fixed pitch. */
export const post = (): Uint8Array =>
  concatBytes([fixed(3), fixed(0), i16(0), i16(0), u32(1), u32(0), u32(0), u32(0), u32(0)]);

// --- The font ------------------------------------------------------------------------------------

export type Table = Readonly<{ tag: string; bytes: Uint8Array }>;

/** The ten tables, in tag order (the directory's order), the head's adjustment still zero. */
export const tables = (fontName: string, glyphs: ReadonlyArray<Glyph>): ReadonlyArray<Table> => {
  const { glyf, loca } = glyfAndLoca(glyphs);
  return [
    { tag: 'OS/2', bytes: os2() },
    { tag: 'cmap', bytes: cmap() },
    { tag: 'glyf', bytes: glyf },
    { tag: 'head', bytes: head(glyphs) },
    { tag: 'hhea', bytes: hhea(glyphs) },
    { tag: 'hmtx', bytes: hmtx(glyphs) },
    { tag: 'loca', bytes: loca },
    { tag: 'maxp', bytes: maxp(glyphs) },
    { tag: 'name', bytes: name(fontName) },
    { tag: 'post', bytes: post() },
  ];
};

const CHECKSUM_MAGIC = 0xb1b0afba;

/** The whole TrueType file: directory, padded tables, and the head's checkSumAdjustment set. */
export const assemble = (fontTables: ReadonlyArray<Table>): Uint8Array => {
  const n = fontTables.length;
  const entrySelector = Math.floor(Math.log2(n));
  const searchRange = 16 * 2 ** entrySelector;
  const directoryLength = 12 + 16 * n;
  const padded = fontTables.map((t) => pad4(t.bytes));
  const offsets = padded.reduce<ReadonlyArray<number>>(
    (acc, p) => [...acc, (acc.at(-1) ?? directoryLength) + p.length],
    [directoryLength],
  );
  const directory = concatBytes([
    u32(0x00010000),
    u16(n),
    u16(searchRange),
    u16(entrySelector),
    u16(n * 16 - searchRange),
    ...fontTables.map((t, i) =>
      concatBytes([tag(t.tag), u32(checksum(t.bytes)), u32(offsets[i] ?? 0), u32(t.bytes.length)]),
    ),
  ]);
  const unadjusted = concatBytes([directory, ...padded]);
  const headIndex = fontTables.findIndex((t) => t.tag === 'head');
  const headOffset = offsets[headIndex] ?? 0;
  return withUint32(unadjusted, headOffset + 8, (CHECKSUM_MAGIC - checksum(unadjusted)) >>> 0);
};

/** A mood's font from its frames. */
export const buildFont = (fontName: string, frames: ReadonlyArray<Image>): Uint8Array =>
  assemble(tables(fontName, glyphsFor(frames)));

// --- The edge: files ------------------------------------------------------------------------------

type ManifestMood = Readonly<{ frames: number }>;
type Manifest = Readonly<{ moods: Readonly<Record<string, ManifestMood>> }>;

const readRepo = (path: string): Buffer => readFileSync(resolve(REPO_ROOT, path));

/** How many frames a mood has, from buddy.json. */
export const frameCount = (manifest: Manifest, mood: Mood): number => {
  const entry = manifest.moods[mood];
  if (entry === undefined) throw new Error(`buddy.json has no mood ${mood}`);
  return entry.frames;
};

export const framePath = (mood: Mood, i: number): string =>
  `${PUBLIC_DIR}/${mood}/${String(i).padStart(2, '0')}.png`;

export const fontFile = (mood: Mood): string => `${FONT_NAMES[mood]}.ttf`;

/** A mood's frames decoded from disk. */
export const readFrames = (mood: Mood): ReadonlyArray<Image> => {
  const manifest = JSON.parse(readRepo(`${PUBLIC_DIR}/buddy.json`).toString('utf8')) as Manifest;
  return Array.from({ length: frameCount(manifest, mood) }, (_, i) =>
    decodePng(new Uint8Array(readRepo(framePath(mood, i)))),
  );
};

export const PREVIEW_START = '<!-- buddy-font: the timer fonts, written by tools/buddy-font.ts -->';
export const PREVIEW_END = '<!-- /buddy-font -->';

/**
 * The preview page's font row: each mood's font showing the seconds' units digit of a JS clock,
 * the glyph the island's timer shows at that second.
 */
export const previewRow = (): string => {
  const faces = MOODS.map(
    (mood) =>
      `      @font-face { font-family: '${FONT_NAMES[mood]}'; src: url(fonts/${fontFile(mood)}) format('truetype'); }`,
  ).join('\n');
  const cells = MOODS.map(
    (mood) =>
      `      <figure><div class="glyph" style="font-family: '${FONT_NAMES[mood]}'">0</div><figcaption><code>${FONT_NAMES[mood]}</code></figcaption></figure>`,
  ).join('\n');
  return [
    `    ${PREVIEW_START}`,
    '    <style>',
    faces,
    '      .glyph { font-size: 96px; line-height: 1; height: 96px; width: 96px; margin: 0 auto; color: var(--c); }',
    '      .glyph.island { font-size: 32px; height: 32px; width: 32px; }',
    '    </style>',
    '    <h1>The timer fonts: the seconds digit of a clock, one glyph per mood (what the island shows at 1 fps)</h1>',
    '    <div class="sets" id="fonts">',
    cells,
    '    </div>',
    '    <script>',
    "      const colours = ['#3b6fd6', '#6c9bea', '#f2e6a8', '#f5cd3b', '#ffd200'];",
    "      const glyphs = Array.from(document.querySelectorAll('#fonts .glyph'));",
    "      glyphs.forEach((g, i) => g.style.setProperty('--c', colours[i]));",
    '      const tickFont = () => {',
    '        const digit = String(Math.floor(Date.now() / 1000) % 10);',
    '        glyphs.forEach((g) => (g.textContent = digit));',
    '      };',
    '      tickFont();',
    '      setInterval(tickFont, 250);',
    '    </script>',
    `    ${PREVIEW_END}`,
  ].join('\n');
};

/** The preview page with the font row in place: replaced between the markers, or inserted before the frame table. */
export const withPreviewRow = (html: string): string => {
  const row = previewRow();
  const start = html.indexOf(PREVIEW_START);
  const end = html.indexOf(PREVIEW_END);
  if (start >= 0 && end > start) {
    const lineStart = html.lastIndexOf('\n', start) + 1;
    return `${html.slice(0, lineStart)}${row}${html.slice(end + PREVIEW_END.length)}`;
  }
  const anchor = '    <h1>Frame table</h1>';
  const at = html.indexOf(anchor);
  if (at < 0) throw new Error('preview.html has no "Frame table" heading to insert before');
  return `${html.slice(0, at)}${row}\n${html.slice(at)}`;
};

const writeRepoFile = (path: string, bytes: Uint8Array | string): void => {
  const full = resolve(REPO_ROOT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, bytes);
};

export const main = (): void => {
  MOODS.forEach((mood) => {
    const font = buildFont(FONT_NAMES[mood], readFrames(mood));
    writeRepoFile(`${WEB_FONT_DIR}/${fontFile(mood)}`, font);
    writeRepoFile(`${IOS_FONT_DIR}/${fontFile(mood)}`, font);
    console.log(
      `${fontFile(mood)}: ${String(font.length)} bytes, ${String(readFrames(mood).length)} frames`,
    );
  });
  const previewPath = `${PUBLIC_DIR}/preview.html`;
  if (existsSync(resolve(REPO_ROOT, previewPath))) {
    writeRepoFile(previewPath, withPreviewRow(readRepo(previewPath).toString('utf8')));
    console.log(`${previewPath}: font row in place`);
  }
};

if (isMain(import.meta.url)) main();
