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
  test("six packs: gin's four backs in gin's order, the drawn Italian deck, the owner's Napoletane sheet; names unique and self-consistent", () => {
    expect(CARD_PACKS).toEqual([
      'default',
      'blue-stripe',
      'yu-gi-oh',
      'empty',
      'linea',
      'napoletane',
    ]);
    expect(new Set(CARD_PACKS).size).toBe(CARD_PACKS.length);
    CARD_PACKS.forEach((name) => {
      const pack = packByName(name);
      expect(pack.name).toBe(name);
      expect(pack.label).not.toBe('');
      expect(Object.keys(pack.decks).length).toBeGreaterThan(0);
      // A drawn pack carries no attribution; the sourced sheet must (test/card-packs.test.ts).
      expect(pack.attribution === null).toBe(name !== 'napoletane');
    });
    expect(FACE_WIDTH).toBe(120);
  });

  test("packsFor: gin's four for french52 (the legacy literal); the four glyph packs, linea and napoletane for italian40", () => {
    expect(packsFor('french52')).toEqual(['default', 'blue-stripe', 'yu-gi-oh', 'empty']);
    expect(packsFor('italian40')).toEqual([
      'default',
      'blue-stripe',
      'yu-gi-oh',
      'empty',
      'linea',
      'napoletane',
    ]);
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

  test("napoletane: forty JPEG faces for italian40 at 1x and 2x (the 338 px cells serve no 3x), no printed indices, no back of its own, the sheet's attribution", () => {
    const napoletane = packByName('napoletane');
    expect(napoletane.label).toBe('Napoletane');
    expect(napoletane.decks.french52).toBeUndefined();
    expect(napoletane.decks.italian40).toMatchObject({
      kind: 'files',
      dir: '../../shared/cards/napoletane/italian40',
      ext: 'jpg',
      widths: [120, 240],
      indices: 'overlay',
      inset: 0,
    });
    if (napoletane.decks.italian40?.kind !== 'files') throw new Error('napoletane has files');
    expect(napoletane.decks.italian40.ids).toHaveLength(40);
    // The Neapolitan card's own proportion, long and thin (the sheet's cells are 338 × 586).
    expect(napoletane.decks.italian40.aspect).toBeCloseTo(0.577, 3);
    // No back on the sheet: the default pack's back is painted (resolve.ts).
    expect(napoletane.back).toEqual({ kind: 'none' });
    expect(napoletane.attribution).toEqual({
      author: 'Florixc (Wikimedia Commons)',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Carte_napoletane_al_completo.jpg',
      licence: 'Public domain',
      licenceUrl: 'https://commons.wikimedia.org/wiki/Template:PD-self',
      note: 'Supplied by the owner on 2026-09-25; the Neapolitan pattern, one sheet of 40',
    });
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
    expect(isCardPackFor('french52', 'napoletane')).toBe(false);
    expect(isCardPackFor('italian40', 'linea')).toBe(true);
    expect(isCardPackFor('italian40', 'napoletane')).toBe(true);
    expect(isCardPackFor('italian40', 'yu-gi-oh')).toBe(true);
  });

  test("the refusal names the key, quotes the value, keeps the current pack and lists the deck's packs", () => {
    expect(badCardPackMsg('ginRummy_cardPack', 'french52', 'plaid')).toBe(
      'ginRummy_cardPack: "plaid" is not a card pack for this deck; kept the current one. One of: default, blue-stripe, yu-gi-oh, empty.',
    );
    expect(badCardPackMsg('briscola_cardPack', 'italian40', 'tartan')).toBe(
      'briscola_cardPack: "tartan" is not a card pack for this deck; kept the current one. One of: default, blue-stripe, yu-gi-oh, empty, linea, napoletane.',
    );
  });
});
