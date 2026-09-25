// The manifest test (docs/design/card-packs.md §7): every shipped pack is whole on disk. The
// derived files under web/public/shared/cards/ are committed (the deploying build has no browser),
// so this reads each one back through the tool's own `checkPack` (the `check` command's body): it
// exists, its frame size or viewBox agrees with the manifest, the URLs are `../../shared/`-relative,
// a `files` pack is total and attributed, no face is over the cap and no pack's tree over the
// budget. Two pins keep the vocabulary honest against the engines: `cardIds('french52')` is gin's
// `makeDeck` in gin's order (this file may import a game; web/shared may not), and
// `packsFor('french52')` is the legacy literal of gin's src/cardBack.ts. In the `shared` suite
// (tools/ci/suites.ts) because it reads nothing a game builds.
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
import { cardIds } from '../web/shared/lib/cards/decks.ts';
import { CARD_PACKS, packByName, packsFor } from '../web/shared/lib/cards/packs.ts';

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
});

describe('every pack is whole on disk', () => {
  test.each(CARD_PACKS)('%s: its back and faces exist at their declared sizes and URLs', (name) => {
    expect(checkPack(packByName(name), read)).toEqual([]);
  });

  test('the derived trees fit the budget; linea is forty faces and a back of a few KB each', () => {
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
