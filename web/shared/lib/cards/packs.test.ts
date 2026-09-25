// The packs (docs/design/card-packs.md §2): names unique and matching their files, labels, the
// per-deck-kind lists (gin's four names in gin's order for `french52`: the legacy literal of
// src/cardBack.ts), the defaults, the guards and the refusal line. What needs the files on disk
// (sizes, URLs, totality) is test/card-packs.test.ts, which reads web/public/.
import { describe, expect, test } from 'vitest';

import { DECK_KINDS } from './decks.ts';
import {
  CARD_PACKS,
  DEFAULT_CARD_PACKS,
  FACE_WIDTH,
  badCardPackMsg,
  defaultPackFor,
  isCardPack,
  isCardPackFor,
  packByName,
  packsFor,
} from './packs.ts';

describe('the card packs', () => {
  test("five packs: gin's four backs in gin's order, then the drawn Italian deck; names unique and self-consistent", () => {
    expect(CARD_PACKS).toEqual(['default', 'blue-stripe', 'yu-gi-oh', 'empty', 'linea']);
    expect(new Set(CARD_PACKS).size).toBe(CARD_PACKS.length);
    CARD_PACKS.forEach((name) => {
      const pack = packByName(name);
      expect(pack.name).toBe(name);
      expect(pack.label).not.toBe('');
      expect(Object.keys(pack.decks).length).toBeGreaterThan(0);
      // A drawn pack carries no attribution; a sourced one must (test/card-packs.test.ts).
      expect(pack.attribution).toBeNull();
    });
    expect(FACE_WIDTH).toBe(120);
  });

  test("packsFor: gin's four for french52 (the legacy literal); the four glyph packs and linea for italian40", () => {
    expect(packsFor('french52')).toEqual(['default', 'blue-stripe', 'yu-gi-oh', 'empty']);
    expect(packsFor('italian40')).toEqual(['default', 'blue-stripe', 'yu-gi-oh', 'empty', 'linea']);
    DECK_KINDS.forEach((kind) => {
      packsFor(kind).forEach((name) => {
        expect(packByName(name).decks[kind]).toBeDefined();
      });
    });
  });

  test("gin's four packs keep gin's pictures and colours; linea has files for italian40 alone and a drawn back", () => {
    expect(packByName('default').back).toEqual({
      kind: 'svg',
      url: '../../shared/cards/backs/default.svg',
      aspect: 100 / 144,
      colour: '#1e3a8a',
    });
    expect(packByName('blue-stripe').back).toMatchObject({ kind: 'svg', colour: '#1e3a8a' });
    expect(packByName('yu-gi-oh').back).toMatchObject({
      kind: 'image',
      colour: '#2a0d04',
      urls: [
        { ratio: 1, url: '../../shared/cards/backs/yu-gi-oh-112.jpg' },
        { ratio: 2, url: '../../shared/cards/backs/yu-gi-oh-224.jpg' },
        { ratio: 3, url: '../../shared/cards/backs/yu-gi-oh-336.jpg' },
      ],
    });
    expect(packByName('empty').back).toEqual({ kind: 'css', colour: '#1e3a8a' });
    const linea = packByName('linea');
    expect(linea.decks.french52).toBeUndefined();
    expect(linea.decks.italian40).toMatchObject({
      kind: 'files',
      ext: 'svg',
      widths: [0],
      indices: 'printed',
      inset: 0,
    });
    expect(linea.back.kind).toBe('svg');
  });

  test('the defaults: gin starts on `default`, an Italian table on `linea`; each is a pack for its kind', () => {
    expect(DEFAULT_CARD_PACKS).toEqual({ french52: 'default', italian40: 'linea' });
    DECK_KINDS.forEach((kind) => {
      expect(isCardPackFor(kind, defaultPackFor(kind))).toBe(true);
      // The default's back is painted, never `none`: it is what a back-less pack falls back to.
      expect(packByName(defaultPackFor(kind)).back.kind).not.toBe('none');
    });
  });

  test('isCardPack and isCardPackFor accept exact names and nothing else', () => {
    CARD_PACKS.forEach((name) => {
      expect(isCardPack(name)).toBe(true);
    });
    ['', 'Default', 'blue_stripe', 'plaid', 'linea '].forEach((v) => {
      expect(isCardPack(v)).toBe(false);
      expect(isCardPackFor('french52', v)).toBe(false);
    });
    expect(isCardPackFor('french52', 'linea')).toBe(false);
    expect(isCardPackFor('italian40', 'linea')).toBe(true);
    expect(isCardPackFor('italian40', 'yu-gi-oh')).toBe(true);
  });

  test("the refusal names the key, quotes the value, keeps the current pack and lists the deck's packs", () => {
    expect(badCardPackMsg('ginRummy_cardPack', 'french52', 'plaid')).toBe(
      'ginRummy_cardPack: "plaid" is not a card pack for this deck; kept the current one. One of: default, blue-stripe, yu-gi-oh, empty.',
    );
    expect(badCardPackMsg('briscola_cardPack', 'italian40', 'tartan')).toBe(
      'briscola_cardPack: "tartan" is not a card pack for this deck; kept the current one. One of: default, blue-stripe, yu-gi-oh, empty, linea.',
    );
  });
});
