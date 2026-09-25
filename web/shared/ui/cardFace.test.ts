// The face renderer (docs/design/card-packs.md §3): every FaceSpec shape to its markup, the alt
// text, the overlay indices, the sprite's position, the back and its CSS, the sprite of symbols.
// The byte-for-byte pin against gin's cardHtml for all 52 French cards is gin's
// (web/games/gin-rummy/src/ui/cards.test.ts): this leaf may not import a game.
import { describe, expect, test } from 'vitest';

import { cardIds, DECKS, splitId } from '../lib/cards/decks.ts';
import { packByName, type CardPack } from '../lib/cards/packs.ts';
import { relabelledId, resolveFace, type FaceSpec } from '../lib/cards/resolve.ts';
import {
  SUIT_SPRITE_SVG,
  backFallbackImageCss,
  backHtml,
  backImageCss,
  faceHtml,
} from './cardFace.ts';

const face = (pack: CardPack, kind: 'french52' | 'italian40', id: string): FaceSpec => {
  const spec = resolveFace(pack, kind, id);
  if (spec === null) throw new Error(`${id} is not a ${kind} card`);
  return spec;
};

describe('faceHtml', () => {
  test("a French glyph is gin's card markup: colour by suit, the label twice, the text symbol", () => {
    expect(faceHtml(face(packByName('default'), 'french52', 'AS'))).toBe(
      '<div class="card black" data-card="AS"><span class="rank">A</span><span class="suit">♠</span><span class="rank br">A</span></div>',
    );
    expect(
      faceHtml(face(packByName('default'), 'french52', '10H'), { extra: 'big selected' }),
    ).toBe(
      '<div class="card red big selected" data-card="10H"><span class="rank">10</span><span class="suit">♥</span><span class="rank br">10</span></div>',
    );
    // Every card renders, and the colour follows the suit for all 52.
    cardIds('french52').forEach((id) => {
      const html = faceHtml(face(packByName('empty'), 'french52', id));
      const red = id.endsWith('H') || id.endsWith('D');
      expect(html).toContain(`<div class="card ${red ? 'red' : 'black'}" data-card="${id}">`);
    });
  });

  test("an american face is the default pack's French glyph of the relabelled card, the Italian id on data-card: all forty", () => {
    const american = packByName('american');
    expect(faceHtml(face(american, 'italian40', 'FC'))).toBe(
      '<div class="card red" data-card="FC"><span class="rank">J</span><span class="suit">♥</span><span class="rank br">J</span></div>',
    );
    expect(faceHtml(face(american, 'italian40', 'RB'), { extra: 'big selected' })).toBe(
      '<div class="card black big selected" data-card="RB"><span class="rank">K</span><span class="suit">♣</span><span class="rank br">K</span></div>',
    );
    expect(faceHtml(face(american, 'italian40', 'AD'))).toBe(
      '<div class="card red" data-card="AD"><span class="rank">A</span><span class="suit">♦</span><span class="rank br">A</span></div>',
    );
    const faces = american.decks.italian40;
    if (faces?.kind !== 'glyph' || faces.relabel === undefined) throw new Error('relabelled');
    const relabel = faces.relabel;
    // The pin over the deck: byte for byte the French glyph of the mapped card, save the id.
    const pinned = cardIds('italian40').map((id) => {
      const split = splitId('italian40', id);
      const to = split === null ? null : relabelledId(relabel, split);
      if (to === null) throw new Error(id);
      const french = faceHtml(face(packByName('default'), 'french52', to));
      expect(french).toContain(`data-card="${to}"`);
      expect(faceHtml(face(american, 'italian40', id))).toBe(
        french.replace(`data-card="${to}"`, `data-card="${id}"`),
      );
      return to;
    });
    expect(new Set(pinned).size).toBe(40);
  });

  test('an Italian glyph prints the index twice and one symbol from the sprite, classed by suit', () => {
    expect(faceHtml(face(packByName('default'), 'italian40', '7S'))).toBe(
      '<div class="card face glyph suit-S" data-card="7S"><span class="rank">7</span><svg class="suit" aria-hidden="true"><use href="#suit-S"/></svg><span class="rank br">7</span></div>',
    );
    expect(faceHtml(face(packByName('default'), 'italian40', 'RB'), { extra: 'dim' })).toContain(
      '<div class="card face glyph suit-B dim" data-card="RB">',
    );
  });

  test('a files face paints the picture as the background, one url() for an SVG face, the name as its label', () => {
    expect(faceHtml(face(packByName('linea'), 'italian40', 'AD'))).toBe(
      '<div class="card face" data-card="AD" role="img" aria-label="asso di denari" style="--face-inset:0;background-image:url(../../shared/cards/linea/italian40/AD.svg)"></div>',
    );
  });

  test('a raster files face offers every ratio through image-set() after a plain 2x url(), and overlay indices when the pictures print none', () => {
    const spec: FaceSpec = {
      kind: 'image',
      id: '7S',
      index: '7',
      alt: 'sette di spade',
      urls: [
        { ratio: 1, url: '../../shared/cards/x/italian40/7S-120.jpg' },
        { ratio: 2, url: '../../shared/cards/x/italian40/7S-240.jpg' },
        { ratio: 3, url: '../../shared/cards/x/italian40/7S-360.jpg' },
      ],
      aspect: 0.606,
      inset: 0.04,
      indices: 'overlay',
    };
    expect(faceHtml(spec, { extra: 'selected' })).toBe(
      '<div class="card face selected" data-card="7S" role="img" aria-label="sette di spade" style="--face-inset:0.04;background-image:url(../../shared/cards/x/italian40/7S-240.jpg);background-image:image-set(url(../../shared/cards/x/italian40/7S-120.jpg) 1x, url(../../shared/cards/x/italian40/7S-240.jpg) 2x, url(../../shared/cards/x/italian40/7S-360.jpg) 3x)"><span class="rank">7</span><span class="rank br">7</span></div>',
    );
    // The overlay prints the rank's index, not the id's letters: a pack may index the fante `8`.
    expect(faceHtml({ ...spec, id: 'FS', index: '8', alt: 'fante di spade' })).toContain(
      'aria-label="fante di spade" style="--face-inset:0.04;background-image:url(../../shared/cards/x/italian40/7S-240.jpg);background-image:image-set(url(../../shared/cards/x/italian40/7S-120.jpg) 1x, url(../../shared/cards/x/italian40/7S-240.jpg) 2x, url(../../shared/cards/x/italian40/7S-360.jpg) 3x)"><span class="rank">8</span><span class="rank br">8</span></div>',
    );
    // A spec with no picture at all (the type allows it; a manifest never does) paints `url()`, not a crash.
    expect(faceHtml({ ...spec, urls: [], indices: 'printed' })).toContain(
      'style="--face-inset:0.04;background-image:url()"',
    );
    // Without a 2x file the plain url() is the first one listed.
    expect(
      faceHtml({
        ...spec,
        urls: [spec.urls[2] ?? spec.urls[0] ?? { ratio: 3, url: '' }],
        indices: 'printed',
      }),
    ).toBe(
      '<div class="card face" data-card="7S" role="img" aria-label="sette di spade" style="--face-inset:0.04;background-image:url(../../shared/cards/x/italian40/7S-360.jpg)"></div>',
    );
  });

  test('a sprite face sizes the sheet to the grid and positions its cell in percentages', () => {
    const spec: FaceSpec = {
      kind: 'sprite',
      id: 'AC',
      index: 'A',
      alt: 'asso di coppe',
      sheets: [
        { ratio: 1, url: '../../shared/cards/s/italian40/sheet-120.jpg' },
        { ratio: 2, url: '../../shared/cards/s/italian40/sheet-240.jpg' },
      ],
      columns: 10,
      rows: 4,
      cell: { x: 3, y: 2 },
      aspect: 0.53,
      inset: 0,
      indices: 'overlay',
    };
    expect(faceHtml(spec)).toBe(
      '<div class="card face" data-card="AC" role="img" aria-label="asso di coppe" style="--face-inset:0;background-image:url(../../shared/cards/s/italian40/sheet-240.jpg);background-image:image-set(url(../../shared/cards/s/italian40/sheet-120.jpg) 1x, url(../../shared/cards/s/italian40/sheet-240.jpg) 2x);background-size:1000% 400%;background-position:33.33333333333333% 66.66666666666666%"><span class="rank">A</span><span class="rank br">A</span></div>',
    );
    // A one-cell sheet sits at 0% 0%: no division by zero.
    expect(faceHtml({ ...spec, columns: 1, rows: 1, cell: { x: 0, y: 0 } })).toContain(
      'background-size:100% 100%;background-position:0% 0%',
    );
  });
});

describe('backHtml and the back CSS', () => {
  test("backHtml is gin's, class list included", () => {
    expect(backHtml()).toBe('<div class="card back "></div>');
    expect(backHtml('tiny')).toBe('<div class="card back tiny"></div>');
  });

  test('an svg back is one url(), a raster back an image-set() with a 2x fallback, a css back none', () => {
    const dflt = packByName('default').back;
    const yugi = packByName('yu-gi-oh').back;
    const empty = packByName('empty').back;
    if (dflt.kind === 'none' || yugi.kind === 'none' || empty.kind === 'none')
      throw new Error('painted');
    expect(backImageCss(dflt)).toBe('url(../../shared/cards/backs/default.svg)');
    expect(backFallbackImageCss(dflt)).toBe('url(../../shared/cards/backs/default.svg)');
    expect(backImageCss(yugi)).toBe(
      'image-set(url(../../shared/cards/backs/yu-gi-oh-112.jpg) 1x, url(../../shared/cards/backs/yu-gi-oh-224.jpg) 2x, url(../../shared/cards/backs/yu-gi-oh-336.jpg) 3x)',
    );
    expect(backFallbackImageCss(yugi)).toBe('url(../../shared/cards/backs/yu-gi-oh-224.jpg)');
    expect(backImageCss(empty)).toBe('none');
    expect(backFallbackImageCss(empty)).toBe('none');
  });
});

describe('SUIT_SPRITE_SVG', () => {
  test('one zero-sized svg holding a symbol per Italian suit, each with its box and its shapes', () => {
    expect(
      SUIT_SPRITE_SVG.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"'),
    ).toBe(true);
    DECKS.italian40.suits.forEach((s) => {
      expect(SUIT_SPRITE_SVG).toContain(`<symbol id="suit-${s.id}" viewBox="0 0 `);
    });
    expect(SUIT_SPRITE_SVG.match(/<symbol /g)).toHaveLength(4);
    expect(SUIT_SPRITE_SVG.endsWith('</symbol></svg>')).toBe(true);
  });
});
