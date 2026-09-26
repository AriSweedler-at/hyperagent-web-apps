// The manifest test (docs/design/card-packs.md §7): every shipped pack is whole on disk. The
// derived files under web/public/shared/cards/ are committed (the deploying build has no browser),
// so this reads each one back through the tool's own `checkPack` (the `check` command's body): it
// exists, its frame size or viewBox agrees with the manifest, the URLs are `../../shared/`-relative,
// a `files` pack is total and attributed, no face is over the cap and no pack's tree over the
// budget. Three pins keep the vocabulary honest against the engines: `cardIds('french52')` is gin's
// `makeDeck` in gin's order (this file may import a game; web/shared may not),
// `packsFor('french52')` is the legacy literal of gin's src/cardBack.ts, and the `american` pack's
// forty faces are gin's `cardHtml` of the relabelled card (docs/design/card-packs.md §3). In the
// `shared` suite (tools/ci/suites.ts) because it reads nothing a game builds.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  MAX_PACK_BYTES,
  checkPack,
  packBytes,
  publicDir,
  type ReadBytes,
} from '../tools/card-packs.ts';
import { makeDeck } from '../web/games/gin-rummy/src/engine/cards.ts';
import { cardHtml } from '../web/games/gin-rummy/src/ui/cards.ts';
import { cardIds, splitId } from '../web/shared/lib/cards/decks.ts';
import { CARD_PACKS, packByName, packsFor } from '../web/shared/lib/cards/packs.ts';
import { relabelledId, resolveFace } from '../web/shared/lib/cards/resolve.ts';
import { faceHtml } from '../web/shared/ui/cardFace.ts';

const ROOT = resolve(import.meta.dirname, '..');
const read: ReadBytes = (path) =>
  existsSync(resolve(ROOT, path)) ? readFileSync(resolve(ROOT, path)) : null;

describe('the vocabulary against the engines', () => {
  test("cardIds('french52') is gin's makeDeck, id for id, in gin's order", () => {
    expect(cardIds('french52')).toEqual(makeDeck().map((c) => c.id));
  });

  test("packsFor('french52') is gin's legacy card-back literal, in order", () => {
    expect(packsFor('french52')).toEqual(['default', 'blue-stripe', 'yu-gi-oh', 'empty']);
  });

  test("the american pack's forty faces are gin's cardHtml of forty distinct French cards, the Italian id on data-card", () => {
    const american = packByName('american');
    const faces = american.decks.italian40;
    if (faces?.kind !== 'glyph' || faces.relabel === undefined) throw new Error('relabelled');
    const relabel = faces.relabel;
    const gin = makeDeck();
    const pinned = cardIds('italian40').map((id) => {
      const split = splitId('italian40', id);
      const to = split === null ? null : relabelledId(relabel, split);
      const card = gin.find((c) => c.id === to);
      const spec = resolveFace(american, 'italian40', id);
      if (to === null || card === undefined || spec === null) throw new Error(id);
      // Byte for byte gin's markup, save `data-card`, which stays the card the briscola engine deals.
      expect(cardHtml(card)).toContain(`data-card="${to}"`);
      expect(faceHtml(spec)).toBe(cardHtml(card).replace(`data-card="${to}"`, `data-card="${id}"`));
      expect(faceHtml(spec, { extra: 'big selected' })).toBe(
        cardHtml(card, { big: true, selected: true }).replace(
          `data-card="${to}"`,
          `data-card="${id}"`,
        ),
      );
      return to;
    });
    expect(pinned).toHaveLength(40);
    expect(new Set(pinned).size).toBe(40);
  });
});

describe('every pack is whole on disk', () => {
  test.each(CARD_PACKS)('%s: its back and faces exist at their declared sizes and URLs', (name) => {
    expect(checkPack(packByName(name), read)).toEqual([]);
  });

  test('the derived trees fit the budget; linea is forty faces and a back of a few KB each; napoletane eighty JPEGs', () => {
    const files = (dir: string): ReadonlyArray<Readonly<{ path: string; bytes: number }>> =>
      existsSync(resolve(ROOT, dir))
        ? cardIds('italian40')
            .map((id) => `${dir}/italian40/${id}.svg`)
            .concat(`${dir}/back.svg`)
            .filter((p) => existsSync(resolve(ROOT, p)))
            .map((p) => ({ path: p, bytes: readFileSync(resolve(ROOT, p)).byteLength }))
        : [];
    const linea = packBytes('linea', files);
    expect(linea).toBeGreaterThan(40 * 500);
    expect(linea).toBeLessThan(MAX_PACK_BYTES);
    expect(publicDir('linea')).toBe('web/public/shared/cards/linea');
    // Napoletane: eighty JPEGs (forty faces at 120 and 240 px) of a few to thirty KB each, and no back.
    const jpegs = (dir: string): ReadonlyArray<Readonly<{ path: string; bytes: number }>> =>
      cardIds('italian40')
        .flatMap((id) => [120, 240].map((w) => `${dir}/italian40/${id}-${String(w)}.jpg`))
        .filter((p) => existsSync(resolve(ROOT, p)))
        .map((p) => ({ path: p, bytes: readFileSync(resolve(ROOT, p)).byteLength }));
    const napoletane = packBytes('napoletane', jpegs);
    expect(jpegs(publicDir('napoletane'))).toHaveLength(80);
    expect(napoletane).toBeGreaterThan(80 * 2_000);
    expect(napoletane).toBeLessThan(MAX_PACK_BYTES);
    expect(existsSync(resolve(ROOT, 'web/public/shared/cards/napoletane/back-120.jpg'))).toBe(
      false,
    );
  });

  test('checkPack names what is wrong: a missing file, a wrong size, a rooted URL, a partial or unattributed pack', () => {
    const linea = packByName('linea');
    const gone: ReadBytes = () => null;
    expect(checkPack(linea, gone)).toContain('web/public/shared/cards/linea/back.svg: missing');
    expect(checkPack(linea, gone)).toContain(
      'web/public/shared/cards/linea/italian40/AD.svg: missing',
    );
    const wrongBox: ReadBytes = () => Buffer.from('<svg viewBox="0 0 100 144"/>');
    expect(checkPack(linea, wrongBox)[0]).toMatch(/back\.svg: aspect 0\.6944, declared 0\.5181/);
    const notSvg: ReadBytes = () => Buffer.from('<html>');
    expect(checkPack(linea, notSvg)[0]).toBe('web/public/shared/cards/linea/back.svg: not a svg');
    const italian = linea.decks.italian40;
    if (italian?.kind !== 'files') throw new Error('linea has files');
    expect(
      checkPack(
        {
          ...linea,
          back: {
            kind: 'svg',
            url: '/cards/linea/back.svg',
            aspect: 100 / 193,
            colour: '#fff',
          },
          decks: {
            italian40: {
              ...italian,
              dir: '/cards/linea/italian40',
              ids: [...italian.ids.slice(1), 'KC'],
              widths: [0, 130],
            },
          },
        },
        read,
      ),
    ).toEqual(
      expect.arrayContaining([
        '/cards/linea/back.svg: not ../../shared/-relative',
        '/cards/linea/italian40: not ../../shared/-relative',
        'linea/italian40: KC is not a card',
        'linea/italian40: a shipped pack is total; missing AC',
        'linea/italian40: width 130 is not 120 × a ratio',
      ]),
    );
    expect(checkPack({ ...linea, attribution: null, decks: { italian40: italian } }, read)).toEqual(
      [],
    );
    // A printed size (`card`) the picture sits far from would letterbox under `contain`: the tool
    // says so. Napoletane's 51 × 83 is 0.037 from its scan, inside the tolerance.
    const napoletane = packByName('napoletane');
    const pictures = napoletane.decks.italian40;
    if (pictures?.kind !== 'files') throw new Error('napoletane has files');
    expect(pictures.card).toEqual({ w: 51, h: 83 });
    expect(
      checkPack(
        { ...napoletane, decks: { italian40: { ...pictures, card: { w: 50, h: 100 } } } },
        read,
      ),
    ).toEqual([
      'napoletane/italian40: the picture aspect 0.577 is 0.077 off its printed box 0.5 (50 × 100): over 0.05, contain would letterbox it',
    ]);
    expect(
      checkPack(
        {
          ...linea,
          decks: {
            italian40: {
              kind: 'sprite',
              sheets: [{ ratio: 1, url: '/sheet.jpg' }],
              cell: { width: 120, height: 232 },
              cells: { AD: { x: 0, y: 0 }, KC: { x: 1, y: 0 } },
              aspect: 0.9,
              inset: 0,
              indices: 'overlay',
            },
          },
        },
        read,
      ),
    ).toEqual(['linea: a sprite pack needs an attribution']);
    expect(
      checkPack(
        {
          ...linea,
          attribution: { author: 'a', sourceUrl: 'u', licence: 'CC0', licenceUrl: null, note: '' },
          decks: {
            italian40: {
              kind: 'sprite',
              sheets: [{ ratio: 1, url: '/sheet.jpg' }],
              cell: { width: 120, height: 232 },
              cells: { AD: { x: 0, y: 0 }, KC: { x: 1, y: 0 } },
              aspect: 0.9,
              inset: 0,
              indices: 'overlay',
            },
          },
        },
        read,
      ),
    ).toEqual([
      'linea/italian40: aspect 0.9 outside [0.45, 0.8]',
      'linea/italian40: KC is not a card',
      '/sheet.jpg: not ../../shared/-relative',
    ]);
    // A relabel with a hole (bastoni unmapped), a stranger (the re sent to `X`) and a collision
    // (denari onto hearts, where coppe already are): each card named once per fault.
    const american = packByName('american');
    expect(
      checkPack(
        {
          ...american,
          decks: {
            italian40: {
              kind: 'glyph',
              relabel: {
                deck: 'french52',
                suits: { C: 'H', D: 'H', S: 'S' },
                ranks: { F: 'J', C: 'Q', R: 'X' },
              },
            },
          },
        },
        read,
      ),
    ).toEqual(
      expect.arrayContaining([
        'american/italian40: AB has no french52 suit in the relabel',
        'american/italian40: RB has no french52 suit in the relabel',
        'american/italian40: RC relabels to XH, not a french52 card',
        'american/italian40: RS relabels to XS, not a french52 card',
        'american/italian40: AD relabels to AH, as AC does',
        'american/italian40: CD relabels to QH, as CC does',
      ]),
    );
    // A raster back whose files are the wrong picture, and one with an unknown extension.
    const yugi = packByName('yu-gi-oh');
    expect(checkPack(yugi, () => Buffer.from('<svg viewBox="0 0 100 144"/>'))).toEqual([
      'web/public/shared/cards/backs/yu-gi-oh-112.jpg: not a jpg',
      'web/public/shared/cards/backs/yu-gi-oh-224.jpg: not a jpg',
      'web/public/shared/cards/backs/yu-gi-oh-336.jpg: not a jpg',
    ]);
    expect(
      checkPack(
        {
          ...yugi,
          back: {
            kind: 'image',
            urls: [{ ratio: 1, url: '../../shared/cards/backs/x.gif' }],
            aspect: 0.7,
            colour: '#000',
          },
        },
        read,
      ),
    ).toEqual(['../../shared/cards/backs/x.gif: unknown extension']);
  });
});
