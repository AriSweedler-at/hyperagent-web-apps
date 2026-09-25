// Resolution (docs/design/card-packs.md §2.3): the picture or the glyph for one card, the three
// silent fallbacks (no faces for the kind, a missing id, no back), the aspect and the About line,
// over the shipped packs and two synthetic ones (a partial `files` pack, a `sprite` pack: no
// shipped pack is either, and the shapes must still resolve).
import { describe, expect, test } from 'vitest';

import { DECKS, cardIds } from './decks.ts';
import { packByName, type CardPack } from './packs.ts';
import { attributionLine, resolveAspect, resolveBack, resolveFace } from './resolve.ts';

/** A sourced pack two cards short, with no back of its own: what the Romane CC0 set would be. */
const PARTIAL: CardPack = {
  name: 'linea',
  label: 'Romane',
  back: { kind: 'none' },
  decks: {
    italian40: {
      kind: 'files',
      dir: '../../shared/cards/romane/italian40',
      ext: 'png',
      widths: [120, 240, 360],
      ids: cardIds('italian40').filter((id) => id !== 'RB' && id !== 'RD'),
      aspect: 0.53,
      inset: 0.04,
      indices: 'overlay',
    },
  },
  attribution: {
    author: 'Marteau i Georges (Wikimedia Commons)',
    sourceUrl: 'https://commons.wikimedia.org/wiki/Category:Romagna_deck',
    licence: 'CC0',
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    note: 'the Roman pattern',
  },
};

/** One sheet of 10 × 4 cells at two ratios, missing the last card. */
const SPRITE: CardPack = {
  name: 'linea',
  label: 'Sheet',
  back: { kind: 'none' },
  decks: {
    italian40: {
      kind: 'sprite',
      sheets: [
        { ratio: 1, url: '../../shared/cards/sheet/italian40/sheet-120.jpg' },
        { ratio: 2, url: '../../shared/cards/sheet/italian40/sheet-240.jpg' },
      ],
      cell: { width: 120, height: 226 },
      cells: Object.fromEntries(
        cardIds('italian40')
          .slice(0, 39)
          .map((id, i) => [id, { x: i % 10, y: Math.floor(i / 10) }]),
      ),
      aspect: 0.53,
      inset: 0,
      indices: 'overlay',
    },
  },
  attribution: {
    author: 'Someone',
    sourceUrl: 'https://example.test/sheet',
    licence: 'Public domain',
    licenceUrl: null,
    note: 'a sheet',
  },
};

describe('resolveFace', () => {
  test('a glyph pack gives the glyph with the rank and suit specs; a stranger is null', () => {
    expect(resolveFace(packByName('default'), 'french52', 'QH')).toEqual({
      kind: 'glyph',
      deck: 'french52',
      id: 'QH',
      rank: DECKS.french52.ranks[11],
      suit: DECKS.french52.suits[1],
    });
    expect(resolveFace(packByName('empty'), 'italian40', '7B')).toMatchObject({
      kind: 'glyph',
      deck: 'italian40',
      id: '7B',
    });
    expect(resolveFace(packByName('default'), 'italian40', 'KC')).toBeNull();
  });

  test('a pack without faces for the kind draws the glyph (a linea card at a French table)', () => {
    expect(resolveFace(packByName('linea'), 'french52', 'AS')).toMatchObject({
      kind: 'glyph',
      deck: 'french52',
      id: 'AS',
    });
  });

  test('a files pack gives the picture at each width, `<id>.<ext>` for an SVG face, the alt in the deck language', () => {
    expect(resolveFace(packByName('linea'), 'italian40', '7S')).toEqual({
      kind: 'image',
      id: '7S',
      index: '7',
      alt: 'sette di spade',
      urls: [{ ratio: 1, url: '../../shared/cards/linea/italian40/7S.svg' }],
      aspect: 100 / 193,
      inset: 0,
      indices: 'printed',
    });
    expect(resolveFace(PARTIAL, 'italian40', 'AD')).toEqual({
      kind: 'image',
      id: 'AD',
      index: 'A',
      alt: 'asso di denari',
      urls: [
        { ratio: 1, url: '../../shared/cards/romane/italian40/AD-120.png' },
        { ratio: 2, url: '../../shared/cards/romane/italian40/AD-240.png' },
        { ratio: 3, url: '../../shared/cards/romane/italian40/AD-360.png' },
      ],
      aspect: 0.53,
      inset: 0.04,
      indices: 'overlay',
    });
  });

  test('a files pack missing the id draws the glyph for that card alone, silently', () => {
    expect(resolveFace(PARTIAL, 'italian40', 'RB')).toMatchObject({ kind: 'glyph', id: 'RB' });
    expect(resolveFace(PARTIAL, 'italian40', 'RD')).toMatchObject({ kind: 'glyph', id: 'RD' });
    expect(resolveFace(PARTIAL, 'italian40', 'CB')?.kind).toBe('image');
  });

  test('a sprite pack gives the sheets, the grid, the cell and the alt; a missing cell is the glyph', () => {
    expect(resolveFace(SPRITE, 'italian40', 'AD')).toEqual({
      kind: 'sprite',
      id: 'AD',
      index: 'A',
      alt: 'asso di denari',
      sheets: SPRITE.decks.italian40?.kind === 'sprite' ? SPRITE.decks.italian40.sheets : [],
      columns: 10,
      rows: 4,
      cell: { x: 0, y: 1 },
      aspect: 0.53,
      inset: 0,
      indices: 'overlay',
    });
    expect(resolveFace(SPRITE, 'italian40', 'RB')).toMatchObject({ kind: 'glyph', id: 'RB' });
  });
});

describe('resolveBack, resolveAspect, attributionLine', () => {
  test("a pack's own back stands; `none` takes the fallback's; two `none`s give the bare navy field", () => {
    const dflt = packByName('default');
    expect(resolveBack(packByName('yu-gi-oh'), dflt)).toBe(packByName('yu-gi-oh').back);
    expect(resolveBack(PARTIAL, dflt)).toBe(dflt.back);
    expect(resolveBack(PARTIAL, SPRITE)).toEqual({ kind: 'css', colour: '#1e3a8a' });
  });

  test("the aspect is the pictures' own for a files or sprite pack, else the deck kind's nominal", () => {
    expect(resolveAspect(packByName('linea'), 'italian40')).toBe(100 / 193);
    expect(resolveAspect(packByName('linea'), 'french52')).toBe(DECKS.french52.aspect);
    expect(resolveAspect(packByName('yu-gi-oh'), 'italian40')).toBe(0.518);
    expect(resolveAspect(PARTIAL, 'italian40')).toBe(0.53);
    expect(resolveAspect(SPRITE, 'italian40')).toBe(0.53);
  });

  test('the About line names the pack, the author and the licence; a drawn pack has none', () => {
    expect(attributionLine(PARTIAL)).toBe(
      'Cards: Romane — Marteau i Georges (Wikimedia Commons), CC0',
    );
    expect(attributionLine(packByName('linea'))).toBeNull();
    expect(attributionLine(packByName('yu-gi-oh'))).toBeNull();
  });
});
