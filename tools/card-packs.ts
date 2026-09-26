// The card-pack tool (docs/design/card-packs.md §4): tools/card-backs.ts generalised from one back
// to a pack. A pack's sources are committed once as supplied under assets/cards/<name>/ (faces as
// files or one sheet, an optional back, SOURCES.txt); Playwright's Chromium draws them at the widths
// a card is painted at (FACE_WIDTH × 1, 2, 3 device pixels, never upscaling); the derived files land
// under web/public/shared/cards/<name>/ and are committed too, because the dist that deploys is
// built by a job with no browser; the pack's manifest web/shared/lib/cards/packs/<name>.ts is
// generated beside them; and `check` (the same code test/card-packs.test.ts runs) reads every
// derived file's own frame size back so a stale tree fails until the tool is re-run.
//
//   node --experimental-strip-types tools/card-packs.ts build
//       every PACK_SOURCES entry, idempotent (today napoletane, the sheet the owner supplied on
//       2026-09-25; docs/design/card-packs.md §7)
//   node --experimental-strip-types tools/card-packs.ts add <name> --deck italian40 --faces <dir> [--back <img>] [--card <w>x<h>] \
//       --label … --author … --source-url … --licence … [--licence-url …] [--note …] [--mask <id>:<x>,<y>,<w>,<h>]… [--map <file>]
//   node --experimental-strip-types tools/card-packs.ts add <name> --deck italian40 --sheet <img> --rows C,D,S,B \
//       --cols A,2,3,4,5,6,7,F,C,R [--grid <inset>] [--back <img>] … (the same pack options)
//   node --experimental-strip-types tools/card-packs.ts check
//   node --experimental-strip-types tools/card-packs.ts preview <name> [--deck italian40] [--width 120] [--out <png>]
//
// `add` also prints the two lines a human adds to web/shared/lib/cards/packs.ts (the name in
// CARD_PACKS, the row in PACKS), as docs/design/sound-fonts.md §8 step 2 is a human step; `check`
// fails until both are done. Sheet mode: the share of non-white pixels per column and row, a run
// under GUTTER_SHARE is a gutter, the `cols × rows` largest runs between gutters are the cells (runs
// split by a gap under MIN_GUTTER px are merged, so a card's white interior is not a gutter), each
// cell trimmed to its ink box plus TRIM_MARGIN, then every cell normalised to the grid's median size
// centred on its ink box (the prototype's three-column cells came out 6% narrower because the
// threes' border is fainter). That wants a printed border and a white gutter; a sheet of borderless
// cards laid edge to edge on the scanner bed (the owner's Napoletane sheet) has neither: its white
// margins read as gutters and a six's two pip columns as two cards. `--grid <inset>` cuts such a
// sheet instead: `cols × rows` equal cells, each interior line snapped to the seam between two cards
// (a thin grey scan shadow with paper either side, scored along the row within GRID_SNAP px; a row
// that shows none takes the seam the other rows found, else the equal line), every cell equalised
// to the median card (a cell on the sheet's edge keeps its seam and grows outward, past a scan that
// clipped the outer margins), then `inset` px shaved so the seam's shadow stays out, and whatever
// the cut still shows past the card's own seams painted paper (a neighbour laid over this card's
// margin made its cell narrower than the median, so equalising grew the cut over the seam and into
// the neighbour: the sheet's 3S), as is what lies past the scan's edge. `--mask` paints
// a white rectangle over a region of one face (source pixels, after the cut) before deriving: the
// maker's mark on an ace of coins. No raw loops (the repo's lint), so the pixel work runs inside the
// page scripts, which are strings.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Page } from '@playwright/test';

import {
  DECKS,
  cardIds,
  isCardId,
  isDeckKind,
  splitId,
  type DeckKind,
} from '../web/shared/lib/cards/decks.ts';
import {
  CARD_PACKS,
  FACE_WIDTH,
  packByName,
  type CardPack,
  type Relabel,
} from '../web/shared/lib/cards/packs.ts';
import { relabelledId } from '../web/shared/lib/cards/resolve.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const RATIOS: ReadonlyArray<number> = [1, 2, 3];
const JPEG_QUALITY = 0.86;
/**
 * How far a picture's aspect may sit from the pack's printed box (`Faces.card`) before `check`
 * refuses it: the box paints the picture `contain`ed, so the gap is a margin of the card's field on
 * two sides, and past this it reads as a letterbox. Napoletane's scan sits 0.037 from its 51 × 83
 * (the white border the cut lost).
 */
export const BOX_TOLERANCE = 0.05;
/** A column or row whose share of ink is under this is a gutter. */
export const GUTTER_SHARE = 0.02;
/** Two cell runs closer than this many pixels are one cell (a white column inside a card). */
export const MIN_GUTTER = 4;
/** Kept around a cell's ink box so the card's own border is the edge. */
export const TRIM_MARGIN = 6;
/** `--grid`: how far from the equal grid's line the seam between two cards may sit (a hand-laid sheet drifts). */
export const GRID_SNAP = 40;
/** `--grid`: the share of a seam's length that must read as a thin grey line for the seam to count. */
export const MIN_SEAM = 0.4;
/** `--grid`: a pixel whose darkest channel is under this is not bare paper (a card's scan shadow is 160–240). */
export const PAPER = 245;
/** `--grid`: paper this many px either side of a seam; a sword's edge fails the test, its blade being there. */
export const SEAM_CLEAR = 6;
/** The caps the manifest test holds a pack to. */
export const MAX_FACE_BYTES = 120_000;
export const MAX_PACK_BYTES = 6_000_000;

export type Ext = 'jpg' | 'png' | 'svg';

/** A committed source: a folder of faces or one sheet, an optional back, and the attribution. */
export type SourceSpec = Readonly<{
  deck: DeckKind;
  /** The printed card's size in mm as its maker lists it: the card box's aspect (`Faces.card`); the picture keeps its own. */
  card?: Readonly<{ w: number; h: number }>;
  faces:
    | Readonly<{ kind: 'files'; dir: string }>
    | Readonly<{
        kind: 'sheet';
        file: string;
        rows: ReadonlyArray<string>;
        cols: ReadonlyArray<string>;
        /** Null: cells from the ink profiles (a bordered sheet with gutters); a number: the seam grid, this many px shaved per side. */
        grid: number | null;
      }>;
  back: string | null;
  label: string;
  author: string;
  sourceUrl: string;
  licence: string;
  licenceUrl: string | null;
  note: string;
  masks: ReadonlyArray<Mask>;
  map: string | null;
}>;

/**
 * The sourced packs `build` derives, each the `add` that made it (docs/design/card-packs.md §7):
 * `napoletane` is the one sheet the owner supplied on 2026-09-25, so the rule that no sourced deck
 * ships is lifted for it alone; the Trocche100 per-card scans stay out.
 */
export const PACK_SOURCES: Readonly<Record<string, SourceSpec>> = {
  napoletane: {
    deck: 'italian40',
    // Dal Negro lists 51 × 82, Modiano 51 × 83.5, it.wiki 50 × 83: a 0.614 box against the sheet's
    // 0.577 cut, which lost the printed white border (docs/design/briscola-battle.md §2.1).
    card: { w: 51, h: 83 },
    faces: {
      kind: 'sheet',
      file: 'assets/cards/napoletane/sheet.jpg',
      // The sheet's own order, top to bottom and left to right (assets/cards/napoletane/SOURCES.txt).
      rows: ['D', 'C', 'B', 'S'],
      cols: ['A', '2', '3', '4', '5', '6', '7', 'F', 'C', 'R'],
      grid: 6,
    },
    back: null,
    label: 'Napoletane',
    author: 'Florixc (Wikimedia Commons)',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Carte_napoletane_al_completo.jpg',
    licence: 'Public domain',
    // As the file page tags it: PD-old-70 and the Public Domain Mark 1.0, not PD-self
    // (assets/cards/napoletane/SOURCES.txt, docs/design/card-packs.md §7.1).
    licenceUrl: 'https://commons.wikimedia.org/wiki/Template:PD-old-70',
    note: 'Supplied by the owner on 2026-09-25; the Neapolitan pattern, one sheet of 40',
    masks: [],
    map: null,
  },
};

// ---- paths ---------------------------------------------------------------------------------------

export const publicDir = (name: string): string => `web/public/shared/cards/${name}`;
export const servedDir = (name: string, deck: DeckKind): string =>
  `../../shared/cards/${name}/${deck}`;
export const manifestPath = (name: string): string => `web/shared/lib/cards/packs/${name}.ts`;

/** `<dir>/<id>-<width>.<ext>`, or `<dir>/<id>.<ext>` for an SVG face (width 0: no raster size). */
export const derivedFace = (
  name: string,
  deck: DeckKind,
  id: string,
  width: number,
  ext: Ext,
): string =>
  width === 0
    ? `${publicDir(name)}/${deck}/${id}.${ext}`
    : `${publicDir(name)}/${deck}/${id}-${String(width)}.${ext}`;
export const derivedBack = (name: string, width: number, ext: Ext): string =>
  width === 0
    ? `${publicDir(name)}/back.${ext}`
    : `${publicDir(name)}/back-${String(width)}.${ext}`;

/** A served URL (`../../shared/…`) to its file under web/public/, repo-relative. */
export const servedToPublic = (url: string): string =>
  url.replace(/^\.\.\/\.\.\/shared\//, 'web/public/shared/');

// ---- sizes ---------------------------------------------------------------------------------------

export type Size = Readonly<{ width: number; height: number }>;

/** The ratios a source can serve without upscaling: a 263 px source yields [1, 2]. */
export const ratiosFor = (sourceWidth: number): ReadonlyArray<number> =>
  RATIOS.filter((r) => FACE_WIDTH * r <= sourceWidth);

export const derivedSize = (ratio: number, aspect: number): Size => ({
  width: FACE_WIDTH * ratio,
  height: Math.round((FACE_WIDTH * ratio) / aspect),
});

/** JPEG start-of-frame markers (SOF0–SOF15 without DHT, JPG and DAC), which carry the frame's size. */
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

const jpegSize = (bytes: Buffer, at = 2): Size | null => {
  if (at + 9 > bytes.length || bytes[at] !== 0xff) return null;
  const marker = bytes[at + 1] ?? 0;
  if (SOF.has(marker))
    return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
  return jpegSize(bytes, at + 2 + bytes.readUInt16BE(at + 2));
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngSize = (bytes: Buffer): Size | null =>
  bytes.length >= 24 &&
  bytes.subarray(0, 8).equals(PNG_SIGNATURE) &&
  bytes.toString('latin1', 12, 16) === 'IHDR'
    ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
    : null;

/** An SVG has no raster size: its viewBox's width and height stand for it (the aspect is what matters). */
const svgSize = (bytes: Buffer): Size | null => {
  const match = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(
    bytes.toString('utf8', 0, 512),
  );
  return match === null ? null : { width: Number(match[1]), height: Number(match[2]) };
};

/** The frame size a file declares about itself, by its extension; null when it is not what it claims. */
export const imageSize = (bytes: Buffer, ext: Ext): Size | null =>
  ext === 'jpg' ? jpegSize(bytes) : ext === 'png' ? pngSize(bytes) : svgSize(bytes);

export const extOf = (file: string): Ext | null => {
  const ext = extname(file).toLowerCase();
  return ext === '.jpg' || ext === '.jpeg'
    ? 'jpg'
    : ext === '.png'
      ? 'png'
      : ext === '.svg'
        ? 'svg'
        : null;
};

// ---- face ids from file names --------------------------------------------------------------------

const ITALIAN_RANKS: Readonly<Record<string, string>> = {
  asso: 'A',
  uno: 'A',
  due: '2',
  tre: '3',
  quattro: '4',
  cinque: '5',
  sei: '6',
  sette: '7',
  otto: 'F',
  fante: 'F',
  nove: 'C',
  cavallo: 'C',
  dieci: 'R',
  re: 'R',
};
const ITALIAN_SUITS: Readonly<Record<string, string>> = {
  coppe: 'C',
  denari: 'D',
  ori: 'D',
  spade: 'S',
  bastoni: 'B',
};
/** The decks' own numbering of the courts (fante 8, cavallo 9, re 10) and the ace as 1. */
const NUMERIC_RANKS: Readonly<Record<string, string>> = { '1': 'A', '8': 'F', '9': 'C', '10': 'R' };

/**
 * The card id a face file is named for: `<id>.<ext>` (`7S`, `AD`), a numeric id as the scans number
 * the deck (`1D`, `8C`, `10B`), or Commons-style Italian words ("05 Cinque di coppe.jpg" -> `5C`,
 * "40 Dieci di Bastoni" -> `RB`); null when none applies.
 */
export const idFromFileName = (deck: DeckKind, file: string): string | null => {
  const stem = basename(file, extname(file));
  const ids = cardIds(deck);
  if (ids.includes(stem)) return stem;
  const numeric = /^(\d{1,2})([A-Za-z])$/.exec(stem);
  if (numeric !== null) {
    const id = `${NUMERIC_RANKS[numeric[1] ?? ''] ?? numeric[1] ?? ''}${(numeric[2] ?? '').toUpperCase()}`;
    return ids.includes(id) ? id : null;
  }
  const words = stem
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w !== '');
  const rank = words.map((w) => ITALIAN_RANKS[w]).find((r) => r !== undefined);
  const suit = words.map((w) => ITALIAN_SUITS[w]).find((s) => s !== undefined);
  const id = `${rank ?? ''}${suit ?? ''}`;
  return rank !== undefined && suit !== undefined && ids.includes(id) ? id : null;
};

/** A `--map` file: `<file>\t<id>` per line, blank lines and `#` comments skipped. */
export const parseMap = (text: string): Readonly<Record<string, string>> =>
  Object.fromEntries(
    text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'))
      .map((line) => line.split(/\t+|\s{2,}/))
      .flatMap(([file, id]) =>
        file !== undefined && id !== undefined ? [[file, id] as const] : [],
      ),
  );

// ---- masks ---------------------------------------------------------------------------------------

export type Mask = Readonly<{ id: string; x: number; y: number; w: number; h: number }>;

/** `<id>:<x>,<y>,<w>,<h>` in source pixels of that face (after the cut in sheet mode). */
export const parseMask = (text: string): Mask | null => {
  const match = /^([A-Z0-9]+):(\d+),(\d+),(\d+),(\d+)$/.exec(text);
  if (match === null) return null;
  const [id, x, y, w, h] = match.slice(1);
  return { id: id ?? '', x: Number(x), y: Number(y), w: Number(w), h: Number(h) };
};

// ---- the sheet cutter's pure half ----------------------------------------------------------------

export type Run = readonly [start: number, end: number];

/** Runs of `profile >= threshold`, merged across gaps under `minGap`, the `n` longest, in position order. */
export const findCells = (
  profile: ReadonlyArray<number>,
  n: number,
  threshold: number = GUTTER_SHARE,
  minGap: number = MIN_GUTTER,
): ReadonlyArray<Run> => {
  const raw = profile.reduce<ReadonlyArray<Run>>((runs, value, i) => {
    if (value < threshold) return runs;
    const last = runs.at(-1);
    // The run that ends here grows by this column; otherwise a new run opens.
    return last?.[1] === i ? [...runs.slice(0, -1), [last[0], i + 1]] : [...runs, [i, i + 1]];
  }, []);
  const merged = raw.reduce<ReadonlyArray<Run>>((runs, run) => {
    const last = runs.at(-1);
    return last !== undefined && run[0] - last[1] < minGap
      ? [...runs.slice(0, -1), [last[0], run[1]]]
      : [...runs, run];
  }, []);
  return [...merged]
    .sort((a, b) => b[1] - b[0] - (a[1] - a[0]))
    .slice(0, n)
    .sort((a, b) => a[0] - b[0]);
};

export type Rect = Readonly<{ x: number; y: number; w: number; h: number }>;

const median = (values: ReadonlyArray<number>): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/** Every ink box grown (or shrunk) to the grid's median box, centred on its own centre, clamped to the sheet. */
export const normaliseCells = (boxes: ReadonlyArray<Rect>, sheet: Size): ReadonlyArray<Rect> => {
  const w = median(boxes.map((b) => b.w));
  const h = median(boxes.map((b) => b.h));
  return boxes.map((b) => ({
    x: Math.max(0, Math.min(sheet.width - w, Math.round(b.x + b.w / 2 - w / 2))),
    y: Math.max(0, Math.min(sheet.height - h, Math.round(b.y + b.h / 2 - h / 2))),
    w,
    h,
  }));
};

// ---- the seam grid (`--grid`): the pure half ----------------------------------------------------

/** The `n + 1` lines that cut `extent` into `n` equal cells: 0 first, `extent` last. */
export const gridLines = (extent: number, n: number): ReadonlyArray<number> =>
  Array.from({ length: n + 1 }, (_, k) => Math.round((k * extent) / n));

/**
 * Where one interior grid line's seam runs along each row (or column) it crosses. `scores[r][i]` is
 * the seam score at `line - snap + i` along row `r`: the best offset wins when its score reaches
 * `min`; a row that shows no seam (the shadow fades where the scanner's light fell flat) takes the
 * median of the rows that found one, and a seam no row found is the grid line itself.
 */
export const seamPositions = (
  line: number,
  scores: ReadonlyArray<ReadonlyArray<number>>,
  snap: number = GRID_SNAP,
  min: number = MIN_SEAM,
): ReadonlyArray<number> => {
  const found = scores.map((row) => {
    const best = row.reduce((b, s, i) => (s > (row[b] ?? -1) ? i : b), 0);
    return (row[best] ?? 0) >= min ? line - snap + best : null;
  });
  const seen = found.filter((p): p is number => p !== null);
  const fallback = seen.length === 0 ? line : median(seen);
  return found.map((p) => p ?? fallback);
};

/**
 * The cells a seam grid bounds, row-major: `vertical[r]` is row `r`'s `cols + 1` x lines (0 first,
 * the sheet's width last), `horizontal[c]` column `c`'s `rows + 1` y lines.
 */
export const cellsFromSeams = (
  vertical: ReadonlyArray<ReadonlyArray<number>>,
  horizontal: ReadonlyArray<ReadonlyArray<number>>,
): ReadonlyArray<Rect> =>
  vertical.flatMap((xs, r) =>
    xs.slice(0, -1).map((x, c) => {
      const y = horizontal[c]?.[r] ?? 0;
      return { x, y, w: (xs[c + 1] ?? x) - x, h: (horizontal[c]?.[r + 1] ?? y) - y };
    }),
  );

/**
 * Every cell takes the grid's median size (the cards are one physical size; a seam a few px off
 * made a cell a few px small): centred where it was, except that a cell on the sheet's edge keeps
 * its seam side and grows outward, past the sheet when the scan clipped the outer margin (what
 * lies outside is drawn as paper). Not clamped, unlike `normaliseCells`, for that reason.
 */
export const equaliseCells = (cells: ReadonlyArray<Rect>, sheet: Size): ReadonlyArray<Rect> => {
  const w = median(cells.map((c) => c.w));
  const h = median(cells.map((c) => c.h));
  const place = (start: number, length: number, size: number, extent: number): number =>
    start <= 0
      ? start + length - size
      : start + length >= extent
        ? start
        : Math.round(start + length / 2 - size / 2);
  return cells.map((c) => ({
    x: place(c.x, c.w, w, sheet.width),
    y: place(c.y, c.h, h, sheet.height),
    w,
    h,
  }));
};

/** The rectangle with `inset` px shaved from each side: the seam's own shadow stays out of the cut. */
export const shrink = (r: Rect, inset: number): Rect => ({
  x: r.x + inset,
  y: r.y + inset,
  w: r.w - 2 * inset,
  h: r.h - 2 * inset,
});

/**
 * The strips of a seam-grid cut that show a neighbouring card, in the cut's own pixels, to be
 * painted paper before deriving: `cut` is the cell equalised to the median and shaved by `inset`,
 * `seams` the same cell as its seams bound it. A card a neighbour was laid over has a cell narrower
 * than the median, and equalising centres the median frame on it, past its seams on both sides, so
 * the shave from the frame's edge lands on or over the seam and the neighbour's shadow comes with
 * it (napoletane's 3S: 332 px between its seams against a 350 px median, 9 px over each side). The
 * card's own picture ends `inset` px inside each interior seam; what the frame shows beyond that is
 * not this card. A side on the sheet's edge has no seam, only the scan's boundary, and `drawDerived`
 * paints what lies past that.
 */
export const paperPastSeams = (
  cut: Rect,
  seams: Rect,
  sheet: Size,
  inset: number,
): ReadonlyArray<Rect> => {
  const left = seams.x > 0 ? seams.x + inset - cut.x : 0;
  const right = seams.x + seams.w < sheet.width ? cut.x + cut.w - (seams.x + seams.w - inset) : 0;
  const top = seams.y > 0 ? seams.y + inset - cut.y : 0;
  const bottom = seams.y + seams.h < sheet.height ? cut.y + cut.h - (seams.y + seams.h - inset) : 0;
  return [
    { x: 0, y: 0, w: left, h: cut.h },
    { x: cut.w - right, y: 0, w: right, h: cut.h },
    { x: 0, y: 0, w: cut.w, h: top },
    { x: 0, y: cut.h - bottom, w: cut.w, h: bottom },
  ].filter((r) => r.w > 0 && r.h > 0);
};

/** `--grid <inset>`: a whole number of px shaved from each side of a seam-grid cell; absent, the ink cutter. */
export const gridInset = (value: string | null): number | null => {
  if (value === null) return null;
  if (!/^\d+$/.test(value))
    throw new Error(`--grid ${value}: expected a whole number of px to shave per side`);
  return Number(value);
};

// ---- the manifest --------------------------------------------------------------------------------

export type Manifest = Readonly<{
  name: string;
  deck: DeckKind;
  label: string;
  ext: Ext;
  widths: ReadonlyArray<number>;
  ids: ReadonlyArray<string>;
  aspect: number;
  card?: Readonly<{ w: number; h: number }>;
  inset: number;
  indices: 'printed' | 'overlay';
  back: Readonly<{
    ext: Ext;
    widths: ReadonlyArray<number>;
    aspect: number;
    colour: string;
  }> | null;
  attribution: Readonly<{
    author: string;
    sourceUrl: string;
    licence: string;
    licenceUrl: string | null;
    note: string;
  }>;
}>;

const q = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const num = (n: number): string => String(Math.round(n * 10_000) / 10_000);

const backSource = (name: string, back: Manifest['back']): string => {
  if (back === null) return "  back: { kind: 'none' },";
  if (back.ext === 'svg')
    return `  back: { kind: 'svg', url: '../../shared/cards/${name}/back.svg', aspect: ${num(back.aspect)}, colour: ${q(back.colour)} },`;
  const urls = back.widths
    .map(
      (w) =>
        `{ ratio: ${String(w / FACE_WIDTH)}, url: '../../shared/cards/${name}/back-${String(w)}.${back.ext}' }`,
    )
    .join(', ');
  return `  back: { kind: 'image', urls: [${urls}], aspect: ${num(back.aspect)}, colour: ${q(back.colour)} },`;
};

/** The pack's data file, in the shape packs.ts reads its siblings (one line per field; not run through Prettier). */
export const manifestSource = (m: Manifest): string =>
  [
    `// Generated by tools/card-packs.ts from assets/cards/${m.name}; edit the source, not this. ${m.label}:`,
    m.attribution.note === ''
      ? `// ${m.attribution.author}, ${m.attribution.licence}.`
      : `// ${m.attribution.note} (${m.attribution.author}, ${m.attribution.licence}).`,
    "import type { CardPack } from '../packs.ts';",
    '',
    `export const ${constName(m.name)} = {`,
    `  name: ${q(m.name)},`,
    `  label: ${q(m.label)},`,
    backSource(m.name, m.back),
    '  decks: {',
    `    ${m.deck}: {`,
    "      kind: 'files',",
    `      dir: ${q(servedDir(m.name, m.deck))},`,
    `      ext: ${q(m.ext)},`,
    `      widths: [${m.widths.map(String).join(', ')}],`,
    `      ids: [${m.ids.map(q).join(', ')}],`,
    `      aspect: ${num(m.aspect)},`,
    ...(m.card === undefined
      ? []
      : [`      card: { w: ${String(m.card.w)}, h: ${String(m.card.h)} },`]),
    `      inset: ${num(m.inset)},`,
    `      indices: ${q(m.indices)},`,
    '    },',
    '  },',
    '  attribution: {',
    `    author: ${q(m.attribution.author)},`,
    `    sourceUrl: ${q(m.attribution.sourceUrl)},`,
    `    licence: ${q(m.attribution.licence)},`,
    `    licenceUrl: ${m.attribution.licenceUrl === null ? 'null' : q(m.attribution.licenceUrl)},`,
    `    note: ${q(m.attribution.note)},`,
    '  },',
    '} as const satisfies CardPack;',
    '',
  ].join('\n');

/** `bergamasche` -> `BERGAMASCHE_PACK`, `blue-stripe` -> `BLUE_STRIPE_PACK`. */
export const constName = (name: string): string =>
  `${name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_PACK`;

/** The two lines `add` leaves to a human. */
export const manualLines = (name: string): ReadonlyArray<string> => [
  `web/shared/lib/cards/packs.ts CARD_PACKS: add '${name}'`,
  `web/shared/lib/cards/packs.ts PACKS: add \`'${name}': ${constName(name)},\` and its import from './packs/${name}.ts'`,
];

// ---- check: the manifest test's body -------------------------------------------------------------

export type ReadBytes = (repoRelative: string) => Buffer | null;

const within = (a: number, b: number, tolerance: number): boolean =>
  Math.abs(a - b) <= tolerance * Math.max(a, b);

const checkFile = (
  path: string,
  ext: Ext,
  expect: Readonly<{ width: number | null; aspect: number }>,
  read: ReadBytes,
): ReadonlyArray<string> => {
  const bytes = read(path);
  if (bytes === null) return [`${path}: missing`];
  const size = imageSize(bytes, ext);
  if (size === null) return [`${path}: not a ${ext}`];
  const problems = [
    ...(expect.width !== null && size.width !== expect.width
      ? [`${path}: ${String(size.width)} px wide, declared ${String(expect.width)}`]
      : []),
    ...(within(size.width / size.height, expect.aspect, ext === 'svg' ? 0.01 : 0.02)
      ? []
      : [`${path}: aspect ${num(size.width / size.height)}, declared ${num(expect.aspect)}`]),
    ...(bytes.byteLength > MAX_FACE_BYTES
      ? [`${path}: ${String(bytes.byteLength)} bytes, over ${String(MAX_FACE_BYTES)}`]
      : []),
  ];
  return problems;
};

const isServed = (url: string): boolean => url.startsWith('../../shared/');

/**
 * A relabel table's faults (docs/design/card-packs.md §3): a card whose suit the table does not map,
 * a card mapped onto no card of the target deck, two cards mapped onto one. Resolution draws the
 * deck's own glyph for the first two, silently; the third would show one picture twice. All three
 * are manifest errors a hand-written pack file may carry, so `check` names them card by card.
 */
const relabelProblems = (name: string, kind: DeckKind, relabel: Relabel): ReadonlyArray<string> => {
  const mapped = cardIds(kind).map((id) => {
    const split = splitId(kind, id);
    return { id, to: split === null ? null : relabelledId(relabel, split) };
  });
  const at = `${name}/${kind}`;
  return [
    ...mapped
      .filter((m) => m.to === null)
      .map((m) => `${at}: ${m.id} has no ${relabel.deck} suit in the relabel`),
    ...mapped
      .filter((m) => m.to !== null && !isCardId(relabel.deck, m.to))
      .map((m) => `${at}: ${m.id} relabels to ${String(m.to)}, not a ${relabel.deck} card`),
    ...mapped.flatMap((m, i) => {
      const first = mapped.find((o) => o.to === m.to);
      return m.to === null || first === undefined || mapped.indexOf(first) === i
        ? []
        : [`${at}: ${m.id} relabels to ${m.to}, as ${first.id} does`];
    }),
  ];
};

/** Every problem with one pack's data and derived files; empty when the pack is whole. */
export const checkPack = (pack: CardPack, read: ReadBytes): ReadonlyArray<string> => {
  const back = pack.back;
  const backProblems =
    back.kind === 'svg'
      ? [
          ...(isServed(back.url) ? [] : [`${back.url}: not ../../shared/-relative`]),
          ...checkFile(servedToPublic(back.url), 'svg', { width: null, aspect: back.aspect }, read),
        ]
      : back.kind === 'image'
        ? back.urls.flatMap((u) => {
            const ext = extOf(u.url);
            return [
              ...(isServed(u.url) ? [] : [`${u.url}: not ../../shared/-relative`]),
              ...(ext === null
                ? [`${u.url}: unknown extension`]
                : checkFile(
                    servedToPublic(u.url),
                    ext,
                    { width: null, aspect: back.aspect },
                    read,
                  )),
            ];
          })
        : [];
  const deckProblems = Object.entries(pack.decks).flatMap(([kind, faces]) => {
    if (!isDeckKind(kind)) return [`${pack.name}: ${kind} is not a deck kind`];
    if (faces.kind === 'glyph')
      return faces.relabel === undefined ? [] : relabelProblems(pack.name, kind, faces.relabel);
    // A sourced pack (rasters, or any sheet) says whose pictures they are; a drawn SVG pack (linea) need not.
    if (pack.attribution === null && (faces.kind === 'sprite' || faces.ext !== 'svg'))
      return [`${pack.name}: a ${faces.kind} pack needs an attribution`];
    const ids = cardIds(kind);
    const box = faces.card === undefined ? null : faces.card.w / faces.card.h;
    const aspectOk = [
      ...(faces.aspect > 0.45 && faces.aspect < 0.8
        ? []
        : [`${pack.name}/${kind}: aspect ${num(faces.aspect)} outside [0.45, 0.8]`]),
      ...(box === null || (box > 0.45 && box < 0.8)
        ? []
        : [`${pack.name}/${kind}: printed box ${num(box)} outside [0.45, 0.8]`]),
      // A picture far from its printed box would show as a letterbox under `contain`, not a margin.
      ...(box === null || Math.abs(faces.aspect - box) < BOX_TOLERANCE
        ? []
        : [
            `${pack.name}/${kind}: the picture aspect ${num(faces.aspect)} is ${num(Math.abs(faces.aspect - box))} off its printed box ${num(box)} (${String(faces.card?.w)} × ${String(faces.card?.h)}): over ${String(BOX_TOLERANCE)}, contain would letterbox it`,
          ]),
    ];
    if (faces.kind === 'sprite') {
      const strangers = Object.keys(faces.cells).filter((id) => !ids.includes(id));
      return [
        ...aspectOk,
        ...strangers.map((id) => `${pack.name}/${kind}: ${id} is not a card`),
        ...faces.sheets.flatMap((s) =>
          isServed(s.url) ? [] : [`${s.url}: not ../../shared/-relative`],
        ),
      ];
    }
    const strangers = faces.ids.filter((id) => !ids.includes(id));
    const missing = ids.filter((id) => !faces.ids.includes(id));
    const badWidths = faces.widths.filter(
      (w) => w !== 0 && !RATIOS.some((r) => r * FACE_WIDTH === w),
    );
    const files = faces.ids.flatMap((id) =>
      faces.widths.flatMap((w) =>
        checkFile(
          servedToPublic(`${faces.dir}/${w === 0 ? id : `${id}-${String(w)}`}.${faces.ext}`),
          faces.ext,
          { width: w === 0 ? null : w, aspect: faces.aspect },
          read,
        ),
      ),
    );
    return [
      ...aspectOk,
      ...(isServed(faces.dir) ? [] : [`${faces.dir}: not ../../shared/-relative`]),
      ...strangers.map((id) => `${pack.name}/${kind}: ${id} is not a card`),
      ...(missing.length > 0
        ? [`${pack.name}/${kind}: a shipped pack is total; missing ${missing.join(' ')}`]
        : []),
      ...badWidths.map(
        (w) => `${pack.name}/${kind}: width ${String(w)} is not ${String(FACE_WIDTH)} × a ratio`,
      ),
      ...files,
    ];
  });
  return [...backProblems, ...deckProblems];
};

/** The bytes of a pack's derived tree, for the budget. */
export const packBytes = (
  name: string,
  read: (dir: string) => ReadonlyArray<Readonly<{ path: string; bytes: number }>>,
): number => read(publicDir(name)).reduce((n, f) => n + f.bytes, 0);

const readRepo: ReadBytes = (path) =>
  existsSync(resolve(ROOT, path)) ? readFileSync(resolve(ROOT, path)) : null;

const filesUnder = (dir: string): ReadonlyArray<Readonly<{ path: string; bytes: number }>> =>
  existsSync(resolve(ROOT, dir))
    ? readdirSync(resolve(ROOT, dir), { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => ({
          path: resolve(e.parentPath, e.name),
          bytes: readFileSync(resolve(e.parentPath, e.name)).byteLength,
        }))
    : [];

const check = (): number => {
  const problems = CARD_PACKS.flatMap((name) => {
    const pack = packByName(name);
    const bytes = packBytes(name, filesUnder);
    return [
      ...checkPack(pack, readRepo),
      ...(bytes > MAX_PACK_BYTES
        ? [
            `${name}: ${String(bytes)} bytes under ${publicDir(name)}, over ${String(MAX_PACK_BYTES)}`,
          ]
        : []),
    ];
  });
  problems.forEach((p) => {
    console.error(p);
  });
  console.log(
    problems.length === 0
      ? `${String(CARD_PACKS.length)} packs whole`
      : `${String(problems.length)} problems`,
  );
  return problems.length === 0 ? 0 : 1;
};

// ---- the browser half ----------------------------------------------------------------------------

const dataUrl = (file: string): string => {
  const ext = extOf(file);
  const mime = ext === 'jpg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : 'image/svg+xml';
  return `data:${mime};base64,${readFileSync(file).toString('base64')}`;
};

const bytesOf = (url: string): Buffer => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');

/** The source's natural size, read by the browser. */
const naturalSize = (page: Page, src: string): Promise<Size> =>
  page.evaluate<Size>(`(async () => {
    const img = new Image(); img.src = ${JSON.stringify(src)}; await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight };
  })()`);

/**
 * A region of the source (`crop`, or the whole picture), with `mask` painted white, drawn onto a
 * canvas of `size` with high-quality smoothing and encoded as JPEG or PNG. The script is a string:
 * tools/ compiles without the DOM lib, and its loops are the browser's business.
 */
const drawDerived = (
  page: Page,
  src: string,
  crop: Rect | null,
  mask: ReadonlyArray<Rect>,
  size: Size,
  ext: Ext,
): Promise<string> =>
  page.evaluate<string>(`(async () => {
    const img = new Image(); img.src = ${JSON.stringify(src)}; await img.decode();
    const crop = ${JSON.stringify(crop)} ?? { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
    const cut = document.createElement('canvas'); cut.width = crop.w; cut.height = crop.h;
    const cctx = cut.getContext('2d'); cctx.fillStyle = '#fff'; cctx.fillRect(0, 0, crop.w, crop.h);
    // A seam-grid cell may reach past a scan that clipped the outer cards: only the part inside the
    // picture is drawn, and what lies outside stays paper white.
    const sx = Math.max(0, crop.x), sy = Math.max(0, crop.y);
    const sw = Math.min(img.naturalWidth, crop.x + crop.w) - sx, sh = Math.min(img.naturalHeight, crop.y + crop.h) - sy;
    if (sw > 0 && sh > 0) cctx.drawImage(img, sx, sy, sw, sh, sx - crop.x, sy - crop.y, sw, sh);
    for (const m of ${JSON.stringify(mask)}) { cctx.fillStyle = '#fff'; cctx.fillRect(m.x, m.y, m.w, m.h); }
    const out = document.createElement('canvas'); out.width = ${String(size.width)}; out.height = ${String(size.height)};
    const ctx = out.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cut, 0, 0, out.width, out.height);
    return ${ext === 'png' ? "out.toDataURL('image/png')" : `out.toDataURL('image/jpeg', ${String(JPEG_QUALITY)})`};
  })()`);

/** The share of non-white pixels per column and per row of the sheet. */
const inkProfiles = (
  page: Page,
  src: string,
): Promise<Readonly<{ size: Size; cols: ReadonlyArray<number>; rows: ReadonlyArray<number> }>> =>
  page.evaluate(`(async () => {
    const img = new Image(); img.src = ${JSON.stringify(src)}; await img.decode();
    const W = img.naturalWidth, H = img.naturalHeight;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, W, H).data;
    const cols = new Array(W).fill(0), rows = new Array(H).fill(0);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (Math.min(d[i], d[i + 1], d[i + 2]) < 200) { cols[x] += 1 / H; rows[y] += 1 / W; }
    }
    return { size: { width: W, height: H }, cols, rows };
  })()`);

/** Each cell's ink bounding box plus the margin, clamped to the sheet. */
const inkBoxes = (
  page: Page,
  src: string,
  cells: ReadonlyArray<Rect>,
): Promise<ReadonlyArray<Rect>> =>
  page.evaluate(`(async () => {
    const img = new Image(); img.src = ${JSON.stringify(src)}; await img.decode();
    const W = img.naturalWidth, H = img.naturalHeight;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, W, H).data;
    const m = ${String(TRIM_MARGIN)};
    return ${JSON.stringify(cells)}.map(({ x, y, w, h }) => {
      let x0 = x + w, x1 = x, y0 = y + h, y1 = y;
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
        const i = (yy * W + xx) * 4;
        if (Math.min(d[i], d[i + 1], d[i + 2]) < 200) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
      }
      const sx = Math.max(0, x0 - m), sy = Math.max(0, y0 - m);
      return { x: sx, y: sy, w: Math.min(W, x1 + m) - sx, h: Math.min(H, y1 + m) - sy };
    });
  })()`);

/**
 * `--grid`: the seam score at every offset within GRID_SNAP of each interior grid line, along each
 * row it crosses (vertical seams) or column (horizontal). A pixel scores when its 3 px window is not
 * paper and both sides SEAM_CLEAR px away are: a card's scan shadow is a thin grey line with paper
 * either side, where a sword or a pip has its own body beside its edge. The middle 80% of each
 * cell's span is scored, clear of the rounded corners and the crossing seams.
 */
const seamScores = (
  page: Page,
  src: string,
  size: Size,
  cols: number,
  rows: number,
): Promise<
  Readonly<{
    vertical: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>;
    horizontal: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>;
  }>
> =>
  page.evaluate(`(async () => {
    const img = new Image(); img.src = ${JSON.stringify(src)}; await img.decode();
    const W = img.naturalWidth, H = img.naturalHeight;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, W, H).data;
    const P = ${String(PAPER)}, C = ${String(SEAM_CLEAR)}, S = ${String(GRID_SNAP)};
    const at = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= H) return 255; const i = (y * W + x) * 4; return Math.min(d[i], d[i + 1], d[i + 2]); };
    const xs = ${JSON.stringify(gridLines(size.width, cols))}, ys = ${JSON.stringify(gridLines(size.height, rows))};
    const inner = (a, b) => [a + Math.round((b - a) * 0.1), b - Math.round((b - a) * 0.1)];
    const vScore = (x, y0, y1) => { let n = 0; for (let y = y0; y < y1; y++) if (Math.min(at(x - 1, y), at(x, y), at(x + 1, y)) < P && at(x - C, y) >= P && at(x + C, y) >= P) n++; return n / (y1 - y0); };
    const hScore = (y, x0, x1) => { let n = 0; for (let x = x0; x < x1; x++) if (Math.min(at(x, y - 1), at(x, y), at(x, y + 1)) < P && at(x, y - C) >= P && at(x, y + C) >= P) n++; return n / (x1 - x0); };
    const offsets = Array.from({ length: 2 * S + 1 }, (_, i) => i - S);
    const vertical = xs.slice(1, -1).map((gx) => ys.slice(0, -1).map((gy, r) => { const [y0, y1] = inner(gy, ys[r + 1]); return offsets.map((o) => vScore(gx + o, y0, y1)); }));
    const horizontal = ys.slice(1, -1).map((gy) => xs.slice(0, -1).map((gx, c) => { const [x0, x1] = inner(gx, xs[c + 1]); return offsets.map((o) => hScore(gy + o, x0, x1)); }));
    return { vertical, horizontal };
  })()`);

// ---- add / build ---------------------------------------------------------------------------------

/** One cell of a sheet: the source rectangle, and the strips of it (cut pixels) that are not this card. */
type Cut = Readonly<{ crop: Rect; paper: ReadonlyArray<Rect> }>;

type Face = Readonly<{
  id: string;
  src: string;
  crop: Rect | null;
  /** Painted paper before deriving, like a `--mask`: a seam-grid cut's strips past the card's seams. */
  paper: ReadonlyArray<Rect>;
  sourceWidth: number;
  aspect: number;
}>;

/** The faces of a folder: every image file whose name yields an id (or the map says which). */
const facesFromDir = async (
  page: Page,
  deck: DeckKind,
  dir: string,
  map: Readonly<Record<string, string>>,
): Promise<ReadonlyArray<Face>> => {
  const files = readdirSync(resolve(ROOT, dir)).filter((f) => extOf(f) !== null);
  const faces = await Promise.all(
    files.map(async (f) => {
      const id = map[f] ?? idFromFileName(deck, f);
      if (id === null) {
        console.warn(
          `${f}: no card id in its name; skipped (name it <id>.<ext>, in Italian, or list it in --map)`,
        );
        return [];
      }
      const src = dataUrl(resolve(ROOT, dir, f));
      const size = await naturalSize(page, src);
      return [
        {
          id,
          src,
          crop: null,
          paper: [],
          sourceWidth: size.width,
          aspect: size.width / size.height,
        },
      ];
    }),
  );
  return faces.flat();
};

/** The cells of a bordered sheet with gutters: the grid found from the ink profiles, refused on a wrong count. */
const cellsFromInk = async (
  page: Page,
  src: string,
  rows: number,
  cols: number,
): Promise<ReadonlyArray<Rect>> => {
  const { size, cols: colProfile, rows: rowProfile } = await inkProfiles(page, src);
  const colRuns = findCells(colProfile, cols);
  const rowRuns = findCells(rowProfile, rows);
  console.log(
    `sheet ${String(size.width)}×${String(size.height)}; columns ${JSON.stringify(colRuns)}; rows ${JSON.stringify(rowRuns)}`,
  );
  if (colRuns.length !== cols || rowRuns.length !== rows)
    throw new Error(
      `found ${String(colRuns.length)} columns and ${String(rowRuns.length)} rows, asked for ${String(cols)} × ${String(rows)}: pass --cols/--rows that match the sheet, or cut it by hand`,
    );
  const cells = rowRuns.flatMap(([y0, y1]) =>
    colRuns.map(([x0, x1]) => ({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })),
  );
  return normaliseCells(await inkBoxes(page, src, cells), size);
};

/**
 * The cells of a borderless sheet laid edge to edge (`--grid`): the seam grid, equalised and
 * shaved, each with the strips it shows past its own seams, to be painted paper.
 */
const cellsFromGrid = async (
  page: Page,
  src: string,
  rows: number,
  cols: number,
  inset: number,
): Promise<ReadonlyArray<Cut>> => {
  const size = await naturalSize(page, src);
  const scores = await seamScores(page, src, size, cols, rows);
  const xs = gridLines(size.width, cols);
  const ys = gridLines(size.height, rows);
  // One position per row for each interior vertical seam (per column for a horizontal one), then
  // each row's and column's full list of lines, the sheet's edges first and last.
  const vSeams = xs.slice(1, -1).map((gx, k) => seamPositions(gx, scores.vertical[k] ?? []));
  const hSeams = ys.slice(1, -1).map((gy, k) => seamPositions(gy, scores.horizontal[k] ?? []));
  const vertical = Array.from({ length: rows }, (_, r) => [
    0,
    ...vSeams.map((s) => s[r] ?? 0),
    size.width,
  ]);
  const horizontal = Array.from({ length: cols }, (_, c) => [
    0,
    ...hSeams.map((s) => s[c] ?? 0),
    size.height,
  ]);
  console.log(
    `sheet ${String(size.width)}×${String(size.height)}; seams per row ${JSON.stringify(vertical)}; per column ${JSON.stringify(horizontal)}`,
  );
  const seams = cellsFromSeams(vertical, horizontal);
  return equaliseCells(seams, size).map((c, i) => {
    const crop = shrink(c, inset);
    return { crop, paper: paperPastSeams(crop, seams[i] ?? c, size, inset) };
  });
};

/** The faces of one sheet, row-major, the ids `<col><row>`: `--rows`/`--cols` in the sheet's own order. */
const facesFromSheet = async (
  page: Page,
  deck: DeckKind,
  file: string,
  rows: ReadonlyArray<string>,
  cols: ReadonlyArray<string>,
  grid: number | null,
): Promise<ReadonlyArray<Face>> => {
  const ids = rows.flatMap((r) => cols.map((c) => `${c}${r}`));
  const strangers = ids.filter((id) => !cardIds(deck).includes(id));
  if (strangers.length > 0)
    throw new Error(`--rows/--cols name cards ${deck} has not: ${strangers.join(' ')}`);
  const src = dataUrl(resolve(ROOT, file));
  const cuts: ReadonlyArray<Cut> =
    grid === null
      ? (await cellsFromInk(page, src, rows.length, cols.length)).map((crop) => ({
          crop,
          paper: [],
        }))
      : await cellsFromGrid(page, src, rows.length, cols.length, grid);
  return ids.map((id, i) => {
    const { crop, paper } = cuts[i] ?? { crop: { x: 0, y: 0, w: 1, h: 1 }, paper: [] };
    return { id, src, crop, paper, sourceWidth: crop.w, aspect: crop.w / crop.h };
  });
};

const writeRepo = (path: string, bytes: Buffer | string): void => {
  mkdirSync(dirname(resolve(ROOT, path)), { recursive: true });
  writeFileSync(resolve(ROOT, path), bytes);
};

const derive = async (page: Page, name: string, spec: SourceSpec): Promise<void> => {
  const faces =
    spec.faces.kind === 'files'
      ? await facesFromDir(
          page,
          spec.deck,
          spec.faces.dir,
          spec.map === null ? {} : parseMap(readFileSync(resolve(ROOT, spec.map), 'utf8')),
        )
      : await facesFromSheet(
          page,
          spec.deck,
          spec.faces.file,
          spec.faces.rows,
          spec.faces.cols,
          spec.faces.grid,
        );
  if (faces.length === 0) throw new Error('no faces found');
  const ext: Ext = 'jpg';
  const aspect = median(faces.map((f) => f.aspect));
  const ratios = ratiosFor(Math.min(...faces.map((f) => f.sourceWidth)));
  if (ratios.length === 0)
    throw new Error(
      `the narrowest face is ${String(Math.min(...faces.map((f) => f.sourceWidth)))} px: under ${String(FACE_WIDTH)}, nothing to derive`,
    );
  console.log(
    `${String(faces.length)} faces, aspect ${num(aspect)}, ratios ${ratios.join(',')} (the source serves no more without upscaling)`,
  );
  const written = await faces.reduce(async (prev, face) => {
    const total = await prev;
    const masks = spec.masks.filter((m) => m.id === face.id);
    return ratios.reduce(async (p, ratio) => {
      const n = await p;
      const size = derivedSize(ratio, aspect);
      const bytes = bytesOf(
        await drawDerived(page, face.src, face.crop, [...masks, ...face.paper], size, ext),
      );
      const out = derivedFace(name, spec.deck, face.id, size.width, ext);
      writeRepo(out, bytes);
      return n + bytes.byteLength;
    }, Promise.resolve(total));
  }, Promise.resolve(0));
  const back = spec.back === null ? null : await deriveBack(page, name, spec.back);
  const ids = [...faces.map((f) => f.id)].sort(
    (a, b) => cardIds(spec.deck).indexOf(a) - cardIds(spec.deck).indexOf(b),
  );
  const manifest: Manifest = {
    name,
    deck: spec.deck,
    label: spec.label,
    ext,
    widths: ratios.map((r) => FACE_WIDTH * r),
    ids,
    aspect,
    ...(spec.card === undefined ? {} : { card: spec.card }),
    inset: 0,
    indices: 'overlay',
    back,
    attribution: {
      author: spec.author,
      sourceUrl: spec.sourceUrl,
      licence: spec.licence,
      licenceUrl: spec.licenceUrl,
      note: spec.note,
    },
  };
  writeRepo(manifestPath(name), manifestSource(manifest));
  console.log(
    `wrote ${String(faces.length * ratios.length)} faces (${String(written)} bytes) under ${publicDir(name)} and ${manifestPath(name)}`,
  );
  const missing = cardIds(spec.deck).filter((id) => !ids.includes(id));
  if (missing.length > 0)
    console.warn(
      `partial: no picture for ${missing.join(' ')} (they draw the glyph; the manifest test wants a total pack)`,
    );
  manualLines(name).forEach((line) => {
    console.log(`TODO ${line}`);
  });
};

const deriveBack = async (page: Page, name: string, file: string): Promise<Manifest['back']> => {
  const ext = extOf(file);
  if (ext === null) throw new Error(`${file}: not an image`);
  if (ext === 'svg') {
    const bytes = readFileSync(resolve(ROOT, file));
    const size = svgSize(bytes);
    if (size === null) throw new Error(`${file}: no viewBox`);
    writeRepo(derivedBack(name, 0, 'svg'), bytes);
    return { ext, widths: [0], aspect: size.width / size.height, colour: '#1e3a8a' };
  }
  const src = dataUrl(resolve(ROOT, file));
  const natural = await naturalSize(page, src);
  const aspect = natural.width / natural.height;
  const ratios = ratiosFor(natural.width);
  await ratios.reduce(async (prev, ratio) => {
    await prev;
    const size = derivedSize(ratio, aspect);
    writeRepo(
      derivedBack(name, size.width, 'jpg'),
      bytesOf(await drawDerived(page, src, null, [], size, 'jpg')),
    );
  }, Promise.resolve());
  return { ext: 'jpg', widths: ratios.map((r) => FACE_WIDTH * r), aspect, colour: '#1e3a8a' };
};

// ---- preview -------------------------------------------------------------------------------------

/**
 * The corner indices an `indices: 'overlay'` pack's stylesheet adds (docs/design/card-packs.md §3),
 * sketched at the size a table prints them, so the preview shows whether the pictures leave them
 * room: the index top-left and turned bottom-right, as cardFace.ts's two `rank` spans are placed.
 */
const indexHtml = (index: string, width: number): string => {
  const font = `position:absolute;font:700 ${String(Math.round(width * 0.14))}px/1 system-ui,sans-serif;color:#1c1c1c;`;
  const x = String(Math.round(width * 0.05));
  const y = String(Math.round(width * 0.04));
  return `<span style="${font}top:${y}px;left:${x}px">${index}</span><span style="${font}right:${x}px;bottom:${y}px;transform:rotate(180deg)">${index}</span>`;
};

/** Every face of a pack and its back, at `width` CSS px on a baize, as one PNG: what a reviewer looks at. */
const preview = async (
  page: Page,
  name: string,
  deck: DeckKind,
  width: number,
  out: string,
): Promise<void> => {
  const pack = packByName(name as (typeof CARD_PACKS)[number]);
  const faces = pack.decks[deck];
  if (faces?.kind !== 'files') throw new Error(`${name} has no files for ${deck}`);
  const height = Math.round(width / faces.aspect);
  const largest = Math.max(...faces.widths);
  const card = (url: string, index: string | null = null): string =>
    `<div style="position:relative;width:${String(width)}px;height:${String(height)}px;background:url('${dataUrl(resolve(ROOT, servedToPublic(url)))}') center/100% 100% no-repeat;margin:4px;display:inline-block;border-radius:${String(Math.round(width * DECKS[deck].radius))}px">${index === null ? '' : indexHtml(index, width)}</div>`;
  const cells = cardIds(deck).map((id) =>
    card(
      `${faces.dir}/${largest === 0 ? id : `${id}-${String(largest)}`}.${faces.ext}`,
      faces.indices === 'overlay' ? (splitId(deck, id)?.rank.index ?? null) : null,
    ),
  );
  const perRow = DECKS[deck].ranks.length;
  const rows = DECKS[deck].suits.map(
    (_, i) => `<div>${cells.slice(i * perRow, (i + 1) * perRow).join('')}</div>`,
  );
  const back =
    pack.back.kind === 'svg'
      ? card(pack.back.url)
      : pack.back.kind === 'image'
        ? card(pack.back.urls.at(-1)?.url ?? '')
        : '';
  await page.setViewportSize({
    width: (width + 8) * perRow + 16,
    height: (height + 8) * (rows.length + 1) + 16,
  });
  await page.setContent(
    `<body style="margin:8px;background:#2f5d46">${rows.join('')}<div>${back}</div></body>`,
  );
  await page.screenshot({ path: resolve(out), fullPage: true });
  console.log(
    `wrote ${out}: ${String(cells.length)} faces of ${name}/${deck} at ${String(width)} px${back === '' ? '' : ' and the back'}`,
  );
};

// ---- the command line ----------------------------------------------------------------------------

type Flags = Readonly<Record<string, ReadonlyArray<string>>>;

/** `--k v` pairs, repeatable (`--mask` may appear many times); the first free words are positional. */
type Parsed = Readonly<{ positional: ReadonlyArray<string>; flags: Flags }>;

export const parseArgs = (argv: ReadonlyArray<string>): Parsed => {
  const { positional, flags } = argv.reduce<Parsed & Readonly<{ pending: string | null }>>(
    (acc, word) => {
      if (word.startsWith('--')) return { ...acc, pending: word.slice(2) };
      if (acc.pending !== null)
        return {
          ...acc,
          flags: { ...acc.flags, [acc.pending]: [...(acc.flags[acc.pending] ?? []), word] },
          pending: null,
        };
      return { ...acc, positional: [...acc.positional, word] };
    },
    { positional: [], flags: {}, pending: null },
  );
  return { positional, flags };
};

const one = (flags: Flags, key: string): string | null => flags[key]?.at(-1) ?? null;
const need = (flags: Flags, key: string): string => {
  const value = one(flags, key);
  if (value === null) throw new Error(`--${key} is required`);
  return value;
};

/** `--card 51x83`: the printed card's width and height in mm. */
const parseCardSize = (value: string): Readonly<{ w: number; h: number }> | null => {
  const m = /^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/.exec(value);
  return m?.[1] === undefined || m[2] === undefined ? null : { w: Number(m[1]), h: Number(m[2]) };
};

const specFromFlags = (flags: Flags): SourceSpec => {
  const deck = need(flags, 'deck');
  if (!isDeckKind(deck)) throw new Error(`--deck ${deck}: not a deck kind`);
  const sheet = one(flags, 'sheet');
  const dir = one(flags, 'faces');
  if ((sheet === null) === (dir === null))
    throw new Error('one of --faces <dir> or --sheet <image>');
  const masks = (flags['mask'] ?? []).map((m) => {
    const mask = parseMask(m);
    if (mask === null) throw new Error(`--mask ${m}: expected <id>:<x>,<y>,<w>,<h>`);
    return mask;
  });
  const cardFlag = one(flags, 'card');
  const card = cardFlag === null ? null : parseCardSize(cardFlag);
  if (cardFlag !== null && card === null)
    throw new Error(`--card ${cardFlag}: expected <w>x<h>, the printed card in mm`);
  return {
    deck,
    ...(card === null ? {} : { card }),
    faces:
      sheet !== null
        ? {
            kind: 'sheet',
            file: sheet,
            rows: need(flags, 'rows').split(','),
            cols: need(flags, 'cols').split(','),
            grid: gridInset(one(flags, 'grid')),
          }
        : { kind: 'files', dir: dir ?? '' },
    back: one(flags, 'back'),
    label: need(flags, 'label'),
    author: need(flags, 'author'),
    sourceUrl: need(flags, 'source-url'),
    licence: need(flags, 'licence'),
    licenceUrl: one(flags, 'licence-url'),
    note: one(flags, 'note') ?? '',
    masks,
    map: one(flags, 'map'),
  };
};

const withBrowser = async (run: (page: Page) => Promise<void>): Promise<void> => {
  const browser = await chromium.launch();
  try {
    await run(await browser.newPage());
  } finally {
    await browser.close();
  }
};

const main = async (argv: ReadonlyArray<string>): Promise<number> => {
  const { positional, flags } = parseArgs(argv);
  const [command, name] = positional;
  switch (command ?? '') {
    case 'check':
      return check();
    case 'build':
      await withBrowser((page) =>
        Object.entries(PACK_SOURCES).reduce(async (prev, [n, spec]) => {
          await prev;
          await derive(page, n, spec);
        }, Promise.resolve()),
      );
      console.log(`${String(Object.keys(PACK_SOURCES).length)} sourced packs built`);
      return 0;
    case 'add': {
      if (name === undefined || !/^[a-z][a-z0-9-]*$/.test(name))
        throw new Error('add <name>: a lower-case name with hyphens');
      const spec = specFromFlags(flags);
      await withBrowser((page) => derive(page, name, spec));
      return 0;
    }
    case 'preview': {
      if (name === undefined || !CARD_PACKS.some((n) => n === name))
        throw new Error(`preview <name>: one of ${CARD_PACKS.join(', ')}`);
      const deck = one(flags, 'deck') ?? 'italian40';
      if (!isDeckKind(deck)) throw new Error(`--deck ${deck}: not a deck kind`);
      const width = Number(one(flags, 'width') ?? String(FACE_WIDTH));
      await withBrowser((page) =>
        preview(
          page,
          name,
          deck,
          width,
          one(flags, 'out') ?? `${name}-${deck}-${String(width)}.png`,
        ),
      );
      return 0;
    }
    default:
      console.error(
        'usage: card-packs.ts build | add <name> …flags | check | preview <name> [--deck] [--width] [--out]',
      );
      return 2;
  }
};

const runDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runDirectly) process.exitCode = await main(process.argv.slice(2));
