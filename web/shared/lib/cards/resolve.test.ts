// Resolution (docs/design/card-packs.md §2.3): the picture or the glyph for one card, the three
// silent fallbacks (no faces for the kind, a missing id, no back), the aspect and the About line,
// over the shipped packs and two synthetic ones (a partial `files` pack, a `sprite` pack: no
// shipped pack is either, and the shapes must still resolve).
import { describe, expect, test } from 'vitest';

import { DECKS, cardIds, splitId } from './decks.ts';
import { packByName, type CardPack, type Relabel } from './packs.ts';
import {
  attributionLine,
  relabelledId,
  resolveAspect,
  resolveBack,
  resolveFace,
} from './resolve.ts';

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
    expect(resolveFace(packByName('napoletane'), 'italian40', 'AD')).toEqual({
      kind: 'image',
      id: 'AD',
      index: 'A',
      alt: 'asso di denari',
      urls: [
        { ratio: 1, url: '../../shared/cards/napoletane/italian40/AD-120.jpg' },
        { ratio: 2, url: '../../shared/cards/napoletane/italian40/AD-240.jpg' },
      ],
      aspect: 0.577,
      inset: 0,
      indices: 'overlay',
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

/** The american table with a hole and a stranger: bastoni unmapped, the re sent to a rank no French deck has. */
const HOLED: Relabel = {
  deck: 'french52',
  suits: { C: 'H', D: 'D', S: 'S' },
  ranks: { F: 'J', C: 'Q', R: 'X' },
};
const holed = (relabel: Relabel): CardPack => ({
  ...packByName('american'),
  decks: { italian40: { kind: 'glyph', relabel } },
});

describe('the relabelled glyph (the american pack)', () => {
  test("an Italian card resolves to the French glyph of its relabel, keeping its own id: the fante di coppe is gin's J♥ under data-card FC", () => {
    const american = packByName('american');
    expect(resolveFace(american, 'italian40', 'FC')).toEqual({
      kind: 'glyph',
      deck: 'french52',
      id: 'FC',
      rank: DECKS.french52.ranks[10],
      suit: DECKS.french52.suits[1],
    });
    // The ace keeps its index; denari are diamonds, spade spades, bastoni clubs; cavallo Q, re K.
    expect(resolveFace(american, 'italian40', 'AD')).toMatchObject({
      id: 'AD',
      rank: { index: 'A' },
      suit: { id: 'D', symbol: '♦', colour: 'red' },
    });
    expect(resolveFace(american, 'italian40', '7S')).toMatchObject({
      id: '7S',
      rank: { index: '7' },
      suit: { id: 'S', symbol: '♠', colour: 'black' },
    });
    expect(resolveFace(american, 'italian40', 'CB')).toMatchObject({
      id: 'CB',
      rank: { index: 'Q' },
      suit: { id: 'C', symbol: '♣', colour: 'black' },
    });
    expect(resolveFace(american, 'italian40', 'RB')).toMatchObject({
      id: 'RB',
      rank: { index: 'K' },
      suit: { id: 'C', symbol: '♣' },
    });
    expect(resolveFace(american, 'italian40', 'KC')).toBeNull();
    // A French card asked of it draws the plain French glyph: the pack has no faces for that kind.
    expect(resolveFace(american, 'french52', 'AS')).toEqual(
      resolveFace(packByName('default'), 'french52', 'AS'),
    );
  });

  test('relabelledId maps all forty onto forty distinct French cards; every id, rank and suit lands', () => {
    const faces = packByName('american').decks.italian40;
    if (faces?.kind !== 'glyph' || faces.relabel === undefined) throw new Error('relabelled');
    const table = faces.relabel;
    const mapped = cardIds('italian40').map((id) => {
      const split = splitId('italian40', id);
      if (split === null) throw new Error(id);
      return relabelledId(table, split);
    });
    expect(new Set(mapped).size).toBe(40);
    mapped.forEach((to) => {
      expect(to === null ? [] : cardIds('french52')).toContain(to);
    });
    expect(mapped.slice(0, 10)).toEqual([
      'AH',
      '2H',
      '3H',
      '4H',
      '5H',
      '6H',
      '7H',
      'JH',
      'QH',
      'KH',
    ]);
    expect(mapped.slice(30)).toEqual(['AC', '2C', '3C', '4C', '5C', '6C', '7C', 'JC', 'QC', 'KC']);
  });

  test("a hole in the table draws this deck's own glyph for that card alone, silently: an unmapped suit, a rank sent to a stranger", () => {
    const pack = holed(HOLED);
    const split = (id: string) => {
      const s = splitId('italian40', id);
      if (s === null) throw new Error(id);
      return s;
    };
    expect(relabelledId(HOLED, split('AB'))).toBeNull();
    expect(relabelledId(HOLED, split('RC'))).toBe('XH');
    expect(relabelledId(HOLED, split('FC'))).toBe('JH');
    // Bastoni: no French suit, so the Italian glyph (the sprite's baton), id and all.
    expect(resolveFace(pack, 'italian40', 'AB')).toEqual({
      kind: 'glyph',
      deck: 'italian40',
      id: 'AB',
      rank: DECKS.italian40.ranks[0],
      suit: DECKS.italian40.suits[3],
    });
    // The re: `XH` is no French card, so the Italian glyph too.
    expect(resolveFace(pack, 'italian40', 'RC')).toMatchObject({
      kind: 'glyph',
      deck: 'italian40',
      id: 'RC',
    });
    // The rest still relabel.
    expect(resolveFace(pack, 'italian40', 'FC')).toMatchObject({
      deck: 'french52',
      id: 'FC',
      rank: { index: 'J' },
    });
  });
});

describe('resolveBack, resolveAspect, attributionLine', () => {
  test("a pack's own back stands; `none` takes the fallback's; two `none`s give the bare navy field", () => {
    const dflt = packByName('default');
    expect(resolveBack(packByName('yu-gi-oh'), dflt)).toBe(packByName('yu-gi-oh').back);
    expect(resolveBack(PARTIAL, dflt)).toBe(dflt.back);
    // The Napoletane sheet has no back: an Italian table paints the default's behind it.
    expect(resolveBack(packByName('napoletane'), dflt)).toBe(dflt.back);
    // American carries gin's default back as its own: it stands whatever the fallback is.
    expect(resolveBack(packByName('american'), SPRITE)).toBe(dflt.back);
    expect(resolveBack(PARTIAL, SPRITE)).toEqual({ kind: 'css', colour: '#1e3a8a' });
  });

  test("the aspect is the pictures' own for a files or sprite pack, the printed deck's for a relabelled glyph, else the deck kind's nominal", () => {
    expect(resolveAspect(packByName('linea'), 'italian40')).toBe(100 / 193);
    expect(resolveAspect(packByName('linea'), 'french52')).toBe(DECKS.french52.aspect);
    expect(resolveAspect(packByName('napoletane'), 'italian40')).toBe(0.577);
    expect(resolveAspect(packByName('yu-gi-oh'), 'italian40')).toBe(0.518);
    // Gin's card at an Italian table is gin's 100 × 144, not the long thin Italian cut.
    expect(resolveAspect(packByName('american'), 'italian40')).toBe(100 / 144);
    expect(resolveAspect(packByName('american'), 'french52')).toBe(100 / 144);
    expect(resolveAspect(PARTIAL, 'italian40')).toBe(0.53);
    expect(resolveAspect(SPRITE, 'italian40')).toBe(0.53);
  });

  test('the About line names the pack, the author and the licence; a drawn pack has none', () => {
    expect(attributionLine(PARTIAL)).toBe(
      'Cards: Romane — Marteau i Georges (Wikimedia Commons), CC0',
    );
    expect(attributionLine(packByName('napoletane'))).toBe(
      'Cards: Napoletane — Florixc (Wikimedia Commons), Public domain',
    );
    expect(attributionLine(packByName('linea'))).toBeNull();
    expect(attributionLine(packByName('yu-gi-oh'))).toBeNull();
    expect(attributionLine(packByName('american'))).toBeNull();
  });
});
