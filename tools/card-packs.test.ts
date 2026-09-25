// The card-pack tool's pure half (docs/design/card-packs.md §4, §7 "tools"): the id mapping from
// Commons-style names, the derived paths and sizes, the ratio cut-off, the size readers, the gutter
// finder and the cell normaliser over synthetic input, the mask and map parsers, the manifest text
// and the argument parser. The Chromium drawing is exercised by running `add` and `preview` by hand.
import { describe, expect, test } from 'vitest';

import {
  GUTTER_SHARE,
  MAX_FACE_BYTES,
  MAX_PACK_BYTES,
  PACK_SOURCES,
  RATIOS,
  constName,
  derivedBack,
  derivedFace,
  derivedSize,
  extOf,
  findCells,
  idFromFileName,
  imageSize,
  manifestSource,
  manualLines,
  normaliseCells,
  parseArgs,
  parseMap,
  parseMask,
  ratiosFor,
  servedDir,
  servedToPublic,
} from './card-packs.ts';

describe('constants', () => {
  test('three ratios, no sourced pack until a licence is accepted, the caps', () => {
    expect(RATIOS).toEqual([1, 2, 3]);
    expect(PACK_SOURCES).toEqual({});
    expect(MAX_FACE_BYTES).toBe(120_000);
    expect(MAX_PACK_BYTES).toBe(6_000_000);
    expect(GUTTER_SHARE).toBe(0.02);
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
    // A back-less pack and an SVG back.
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
        back: null,
        attribution: { author: 'a', sourceUrl: 'u', licence: 'CC0', licenceUrl: 'l', note: '' },
      }),
    ).toContain("  back: { kind: 'none' },");
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
