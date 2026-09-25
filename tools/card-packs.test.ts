// The card-pack tool's pure half (docs/design/card-packs.md §4, §7 "tools"): the id mapping from
// Commons-style names, the derived paths and sizes, the ratio cut-off, the size readers, the gutter
// finder and the cell normaliser over synthetic input, the seam grid's pure half (`--grid`: the equal
// lines, the seam picker with its two fallbacks, the cells, the equaliser that may leave the sheet,
// the shave, the paper past a card's seams), the mask and map parsers, the manifest text and the
// argument parser. The Chromium
// drawing is exercised by running `add` and `preview` by hand (napoletane's preview is read at 120
// and 240 px: every card in its cell, no ink cut, the overlay indices in clean corners).
import { describe, expect, test } from 'vitest';

import {
  GRID_SNAP,
  GUTTER_SHARE,
  MAX_FACE_BYTES,
  MAX_PACK_BYTES,
  MIN_SEAM,
  PACK_SOURCES,
  PAPER,
  RATIOS,
  SEAM_CLEAR,
  cellsFromSeams,
  constName,
  derivedBack,
  derivedFace,
  derivedSize,
  equaliseCells,
  extOf,
  findCells,
  gridInset,
  gridLines,
  idFromFileName,
  imageSize,
  manifestSource,
  manualLines,
  normaliseCells,
  paperPastSeams,
  parseArgs,
  parseMap,
  parseMask,
  ratiosFor,
  seamPositions,
  servedDir,
  servedToPublic,
  shrink,
} from './card-packs.ts';

describe('constants', () => {
  test("three ratios, the caps, the seam grid's knobs", () => {
    expect(RATIOS).toEqual([1, 2, 3]);
    expect(MAX_FACE_BYTES).toBe(120_000);
    expect(MAX_PACK_BYTES).toBe(6_000_000);
    expect(GUTTER_SHARE).toBe(0.02);
    expect(GRID_SNAP).toBe(40);
    expect(MIN_SEAM).toBe(0.4);
    expect(PAPER).toBe(245);
    expect(SEAM_CLEAR).toBe(6);
  });

  test("one sourced pack, the sheet the owner supplied: napoletane, cut as a seam grid in the sheet's own order", () => {
    expect(Object.keys(PACK_SOURCES)).toEqual(['napoletane']);
    expect(PACK_SOURCES['napoletane']).toMatchObject({
      deck: 'italian40',
      faces: {
        kind: 'sheet',
        file: 'assets/cards/napoletane/sheet.jpg',
        rows: ['D', 'C', 'B', 'S'],
        cols: ['A', '2', '3', '4', '5', '6', '7', 'F', 'C', 'R'],
        grid: 6,
      },
      back: null,
      label: 'Napoletane',
      licence: 'Public domain',
      masks: [],
      map: null,
    });
  });
});

describe('ids from file names', () => {
  test('an id, a numeric id as the scans number the deck, or Italian words in any order and case', () => {
    expect(idFromFileName('italian40', '7S.jpg')).toBe('7S');
    expect(idFromFileName('italian40', 'faces/AD.png')).toBe('AD');
    expect(idFromFileName('italian40', '1D.jpg')).toBe('AD');
    expect(idFromFileName('italian40', '8C.jpg')).toBe('FC');
    expect(idFromFileName('italian40', '9s.jpg')).toBe('CS');
    expect(idFromFileName('italian40', '10B.jpg')).toBe('RB');
    expect(idFromFileName('italian40', '05 Cinque di coppe.jpg')).toBe('5C');
    expect(idFromFileName('italian40', '40 Dieci di Bastoni.jpg')).toBe('RB');
    expect(idFromFileName('italian40', 'Asso_di_denari.jpg')).toBe('AD');
    expect(idFromFileName('italian40', 'fante-spade.png')).toBe('FS');
    expect(idFromFileName('italian40', 'Re di ori.jpg')).toBe('RD');
    expect(idFromFileName('french52', 'QH.svg')).toBe('QH');
  });

  test('nothing for a name with no rank, no suit, a stranger or a French card in Italy', () => {
    expect(idFromFileName('italian40', 'back.jpg')).toBeNull();
    expect(idFromFileName('italian40', 'Cinque.jpg')).toBeNull();
    expect(idFromFileName('italian40', 'di coppe.jpg')).toBeNull();
    expect(idFromFileName('italian40', '11D.jpg')).toBeNull();
    expect(idFromFileName('italian40', '5H.jpg')).toBeNull();
    expect(idFromFileName('italian40', 'KC.jpg')).toBeNull();
  });

  test('a --map file is tab- or wide-space-separated, comments and blanks skipped', () => {
    expect(parseMap('# file\tid\nIMG_1.jpg\tAD\n\nIMG_2.jpg   7S\nbroken\n')).toEqual({
      'IMG_1.jpg': 'AD',
      'IMG_2.jpg': '7S',
    });
  });
});

describe('paths and sizes', () => {
  test('derived files sit under web/public/shared/cards/<name>/<deck>, served at ../../shared/cards', () => {
    expect(derivedFace('bergamasche', 'italian40', 'AD', 240, 'jpg')).toBe(
      'web/public/shared/cards/bergamasche/italian40/AD-240.jpg',
    );
    expect(derivedFace('linea', 'italian40', 'AD', 0, 'svg')).toBe(
      'web/public/shared/cards/linea/italian40/AD.svg',
    );
    expect(derivedBack('napoletane', 360, 'jpg')).toBe(
      'web/public/shared/cards/napoletane/back-360.jpg',
    );
    expect(derivedBack('linea', 0, 'svg')).toBe('web/public/shared/cards/linea/back.svg');
    expect(servedDir('napoletane', 'italian40')).toBe('../../shared/cards/napoletane/italian40');
    expect(servedToPublic('../../shared/cards/linea/back.svg')).toBe(
      'web/public/shared/cards/linea/back.svg',
    );
    expect(servedToPublic('/rooted.svg')).toBe('/rooted.svg');
  });

  test('a ratio is emitted only when the source is at least that wide: 263 px yields [1, 2]', () => {
    expect(ratiosFor(263)).toEqual([1, 2]);
    expect(ratiosFor(496)).toEqual([1, 2, 3]);
    expect(ratiosFor(240)).toEqual([1, 2]);
    expect(ratiosFor(119)).toEqual([]);
  });

  test('the derived size is FACE_WIDTH × ratio by the aspect, rounded', () => {
    expect(derivedSize(1, 0.518)).toEqual({ width: 120, height: 232 });
    expect(derivedSize(2, 0.606)).toEqual({ width: 240, height: 396 });
    expect(derivedSize(3, 100 / 144)).toEqual({ width: 360, height: 518 });
  });

  test('extOf knows jpg, jpeg, png and svg, case-blind, and nothing else', () => {
    expect(['a.jpg', 'a.JPEG', 'a.png', 'a.svg', 'a.gif', 'a'].map(extOf)).toEqual([
      'jpg',
      'jpg',
      'png',
      'svg',
      null,
      null,
    ]);
  });
});

describe('imageSize', () => {
  test('a JPEG frame, a PNG header, an SVG viewBox; null for a file that is not what it claims', () => {
    // A minimal JPEG: SOI, an APP0 segment of length 4, then SOF0 with height 161 and width 112.
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0xa1,
      0x00, 0x70, 0x01,
    ]);
    expect(imageSize(jpeg, 'jpg')).toEqual({ width: 112, height: 161 });
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
      Buffer.from('IHDR'),
      Buffer.from([0, 0, 0, 120, 0, 0, 0, 232]),
    ]);
    expect(imageSize(png, 'png')).toEqual({ width: 120, height: 232 });
    expect(imageSize(Buffer.from('<svg xmlns="x" viewBox="0 0 100 193">'), 'svg')).toEqual({
      width: 100,
      height: 193,
    });
    expect(imageSize(Buffer.from('<svg viewBox="0, 0, 20, 100"/>'), 'svg')).toEqual({
      width: 20,
      height: 100,
    });
    expect(imageSize(Buffer.from('not a jpeg'), 'jpg')).toBeNull();
    expect(imageSize(png, 'jpg')).toBeNull();
    expect(imageSize(jpeg, 'png')).toBeNull();
    expect(imageSize(Buffer.from('<svg width="1"/>'), 'svg')).toBeNull();
  });
});

describe('the sheet cutter', () => {
  test('findCells: runs above the threshold, a gap under the minimum merged, the n longest in order', () => {
    // Three cards of 10 columns with 5-column gutters (a gutter is at least MIN_GUTTER wide); the
    // middle card has a 2-column white stripe inside it (a card's interior), which must not split
    // it; a 1-column speck at the end is noise.
    const profile = [
      ...Array<number>(5).fill(0),
      ...Array<number>(10).fill(0.5),
      ...Array<number>(5).fill(0),
      ...Array<number>(4).fill(0.5),
      ...Array<number>(2).fill(0.01),
      ...Array<number>(4).fill(0.5),
      ...Array<number>(5).fill(0),
      ...Array<number>(10).fill(0.5),
      ...Array<number>(5).fill(0),
      0.9,
    ];
    expect(findCells(profile, 3)).toEqual([
      [5, 15],
      [20, 30],
      [35, 45],
    ]);
    // Asked for two, the two longest (a tie: the first two, the sort being stable) in position
    // order; asked for more than exist, all of them, the speck included.
    expect(findCells(profile, 2)).toEqual([
      [5, 15],
      [20, 30],
    ]);
    expect(findCells(profile, 9)).toHaveLength(4);
    expect(findCells([], 3)).toEqual([]);
    // A profile that ends inside a run closes it at the end.
    expect(findCells([0, 0.5, 0.5], 1)).toEqual([[1, 3]]);
  });

  test('normaliseCells: every box takes the median size, centred where it was, clamped to the sheet', () => {
    const boxes = [
      { x: 0, y: 0, w: 100, h: 200 },
      { x: 120, y: 2, w: 94, h: 200 },
      { x: 240, y: 0, w: 100, h: 196 },
    ];
    expect(normaliseCells(boxes, { width: 340, height: 200 })).toEqual([
      { x: 0, y: 0, w: 100, h: 200 },
      { x: 117, y: 0, w: 100, h: 200 },
      { x: 240, y: 0, w: 100, h: 200 },
    ]);
    expect(normaliseCells([], { width: 10, height: 10 })).toEqual([]);
  });
});

describe('masks, manifests and arguments', () => {
  test('a mask is <id>:<x>,<y>,<w>,<h>; anything else is null', () => {
    expect(parseMask('AD:12,300,240,60')).toEqual({ id: 'AD', x: 12, y: 300, w: 240, h: 60 });
    expect(parseMask('AD:12,300')).toBeNull();
    expect(parseMask('ad:1,2,3,4')).toBeNull();
  });

  test('the manifest is the pack file packs.ts reads, with the constant named after the pack', () => {
    const text = manifestSource({
      name: 'napoletane',
      deck: 'italian40',
      label: 'Napoletane',
      ext: 'jpg',
      widths: [120, 240, 360],
      ids: ['AC', '2C'],
      aspect: 0.60606,
      inset: 0,
      indices: 'overlay',
      back: { ext: 'jpg', widths: [120, 240], aspect: 0.6286, colour: '#1e3a8a' },
      attribution: {
        author: 'Trocche100 (Wikimedia Commons)',
        sourceUrl: 'https://commons.wikimedia.org/wiki/Category:Naples_deck',
        licence: 'Public domain',
        licenceUrl: null,
        note: "the Neapolitan pattern, a Dal Negro print; the maker's mark masked",
      },
    });
    expect(text.split('\n')[1]).toBe(
      "// the Neapolitan pattern, a Dal Negro print; the maker's mark masked (Trocche100 (Wikimedia Commons), Public domain).",
    );
    expect(text).toContain('export const NAPOLETANE_PACK = {');
    expect(text).toContain("  name: 'napoletane',");
    expect(text).toContain(
      "  back: { kind: 'image', urls: [{ ratio: 1, url: '../../shared/cards/napoletane/back-120.jpg' }, { ratio: 2, url: '../../shared/cards/napoletane/back-240.jpg' }], aspect: 0.6286, colour: '#1e3a8a' },",
    );
    expect(text).toContain("      dir: '../../shared/cards/napoletane/italian40',");
    expect(text).toContain('      widths: [120, 240, 360],');
    expect(text).toContain("      ids: ['AC', '2C'],");
    expect(text).toContain('      aspect: 0.6061,');
    expect(text).toContain(
      "    note: 'the Neapolitan pattern, a Dal Negro print; the maker\\'s mark masked',",
    );
    expect(text).toContain('    licenceUrl: null,');
    expect(text.endsWith('} as const satisfies CardPack;\n')).toBe(true);
    // A back-less pack, whose empty note leaves no bare parenthesis in the header; an SVG back.
    const backless = manifestSource({
      name: 'x',
      deck: 'italian40',
      label: 'X',
      ext: 'png',
      widths: [120],
      ids: [],
      aspect: 0.5,
      inset: 0.04,
      indices: 'printed',
      back: null,
      attribution: { author: 'a', sourceUrl: 'u', licence: 'CC0', licenceUrl: 'l', note: '' },
    });
    expect(backless).toContain("  back: { kind: 'none' },");
    expect(backless.split('\n')[1]).toBe('// a, CC0.');
    expect(
      manifestSource({
        name: 'x',
        deck: 'italian40',
        label: 'X',
        ext: 'png',
        widths: [120],
        ids: [],
        aspect: 0.5,
        inset: 0.04,
        indices: 'printed',
        back: { ext: 'svg', widths: [0], aspect: 0.5, colour: '#fff' },
        attribution: { author: 'a', sourceUrl: 'u', licence: 'CC0', licenceUrl: 'l', note: '' },
      }),
    ).toContain(
      "  back: { kind: 'svg', url: '../../shared/cards/x/back.svg', aspect: 0.5, colour: '#fff' },",
    );
    expect(constName('blue-stripe')).toBe('BLUE_STRIPE_PACK');
    expect(manualLines('romane')).toEqual([
      "web/shared/lib/cards/packs.ts CARD_PACKS: add 'romane'",
      "web/shared/lib/cards/packs.ts PACKS: add `'romane': ROMANE_PACK,` and its import from './packs/romane.ts'",
    ]);
  });

  test('parseArgs: positionals first, --flags with one value each, a repeated flag collects', () => {
    expect(
      parseArgs([
        'add',
        'x',
        '--deck',
        'italian40',
        '--mask',
        'AD:1,2,3,4',
        '--mask',
        'AC:5,6,7,8',
        '--label',
        'X',
      ]),
    ).toEqual({
      positional: ['add', 'x'],
      flags: { deck: ['italian40'], mask: ['AD:1,2,3,4', 'AC:5,6,7,8'], label: ['X'] },
    });
    expect(parseArgs([])).toEqual({ positional: [], flags: {} });
  });
});

describe('the seam grid (--grid)', () => {
  test('gridLines cuts an extent into n equal cells: 0 first, the extent last, rounded', () => {
    expect(gridLines(3507, 10)).toEqual([
      0, 351, 701, 1052, 1403, 1754, 2104, 2455, 2806, 3156, 3507,
    ]);
    expect(gridLines(2398, 4)).toEqual([0, 600, 1199, 1799, 2398]);
    expect(gridLines(10, 1)).toEqual([0, 10]);
  });

  test('seamPositions: the best offset per row when it reaches the minimum; the median of the rows that found it otherwise; the line when none did', () => {
    // Four rows across one seam near line 1052, snap 3: scores at offsets -3 … +3.
    const rows = [
      [0, 0, 0.9, 1, 0.5, 0, 0],
      [0, 0, 0, 0, 0.3, 0.2, 0],
      [0.1, 0, 0, 0, 0, 0.7, 0.8],
      [0.5, 0, 0, 0, 0, 0, 0],
    ];
    expect(seamPositions(1052, rows, 3, 0.4)).toEqual([1052, 1052, 1055, 1049]);
    expect(seamPositions(600, [[0.1, 0.2, 0.1], []], 1, 0.4)).toEqual([600, 600]);
    expect(seamPositions(600, [], 1)).toEqual([]);
    // A plateau of equal maxima: its first offset.
    expect(seamPositions(100, [[0, 1, 1, 1, 0]], 2)).toEqual([99]);
  });

  test("cellsFromSeams: row-major cells between each row's x lines and each column's y lines", () => {
    const vertical = [
      [0, 10, 20],
      [0, 12, 20],
    ];
    const horizontal = [
      [0, 5, 9],
      [0, 6, 9],
    ];
    expect(cellsFromSeams(vertical, horizontal)).toEqual([
      { x: 0, y: 0, w: 10, h: 5 },
      { x: 10, y: 0, w: 10, h: 6 },
      { x: 0, y: 5, w: 12, h: 4 },
      { x: 12, y: 6, w: 8, h: 3 },
    ]);
    expect(cellsFromSeams([], [])).toEqual([]);
  });

  test("equaliseCells: the median size centred, but a cell on the sheet's edge keeps its seam side and may leave the sheet", () => {
    const sheet = { width: 100, height: 60 };
    const cells = [
      { x: 0, y: 0, w: 30, h: 28 },
      { x: 30, y: 0, w: 36, h: 28 },
      { x: 66, y: 0, w: 34, h: 28 },
      { x: 0, y: 28, w: 30, h: 32 },
      { x: 30, y: 28, w: 36, h: 32 },
      { x: 66, y: 28, w: 34, h: 32 },
    ];
    // The median cell is 34 × 32: the clipped left column and top row grow past 0; the right
    // column and bottom row keep their inner seam; the middle is centred.
    expect(equaliseCells(cells, sheet)).toEqual([
      { x: -4, y: -4, w: 34, h: 32 },
      { x: 31, y: -4, w: 34, h: 32 },
      { x: 66, y: -4, w: 34, h: 32 },
      { x: -4, y: 28, w: 34, h: 32 },
      { x: 31, y: 28, w: 34, h: 32 },
      { x: 66, y: 28, w: 34, h: 32 },
    ]);
    expect(equaliseCells([], sheet)).toEqual([]);
  });

  test("paperPastSeams: an interior cell narrower than the median, equalised and shaved, shows its neighbours past its own seams; those strips are paper, in the cut's pixels", () => {
    const sheet = { width: 3507, height: 2398 };
    // Napoletane's 3S as the tool found it: 332 px between its seams (686, 1018) in a row whose
    // median card is 350 wide; the median frame centred on it reaches 9 px into 2S and 4S.
    const seams = { x: 686, y: 1800, w: 332, h: 598 };
    const [cut] = equaliseCells([seams, { x: 1018, y: 1800, w: 350, h: 598 }], sheet).map((c) =>
      shrink(c, 6),
    );
    expect(cut).toEqual({ x: 683, y: 1806, w: 338, h: 586 });
    expect(paperPastSeams(cut ?? seams, seams, sheet, 6)).toEqual([
      { x: 0, y: 0, w: 9, h: 586 },
      { x: 329, y: 0, w: 9, h: 586 },
    ]);
    // A cell at least the median wide keeps `inset` px inside its seams on its own: no strip.
    const wide = { x: 1370, y: 1196, w: 360, h: 604 };
    expect(paperPastSeams(shrink(wide, 6), wide, sheet, 6)).toEqual([]);
    // Narrower than the median both ways (332 × 590 against 350 × 600): a strip on every side,
    // 9 px across and 5 px down, the sides first.
    const small = { x: 686, y: 591, w: 332, h: 590 };
    expect(paperPastSeams({ x: 683, y: 592, w: 338, h: 588 }, small, sheet, 6)).toEqual([
      { x: 0, y: 0, w: 9, h: 588 },
      { x: 329, y: 0, w: 9, h: 588 },
      { x: 0, y: 0, w: 338, h: 5 },
      { x: 0, y: 583, w: 338, h: 5 },
    ]);
    // The sheet's corner cell, clipped by the scan: equalising anchored it on its two interior
    // seams and grew it past the sheet, where there is no seam to keep off (drawDerived paints
    // past the scan), so nothing is paper here.
    const corner = { x: 0, y: 0, w: 337, h: 591 };
    expect(paperPastSeams({ x: -7, y: -3, w: 338, h: 588 }, corner, sheet, 6)).toEqual([]);
  });

  test('shrink shaves the inset from every side; gridInset reads --grid as whole px or refuses it', () => {
    expect(shrink({ x: 10, y: 20, w: 100, h: 200 }, 6)).toEqual({ x: 16, y: 26, w: 88, h: 188 });
    expect(gridInset(null)).toBeNull();
    expect(gridInset('6')).toBe(6);
    expect(gridInset('0')).toBe(0);
    expect(() => gridInset('six')).toThrow('--grid six');
    expect(() => gridInset('-2')).toThrow('--grid -2');
  });
});
