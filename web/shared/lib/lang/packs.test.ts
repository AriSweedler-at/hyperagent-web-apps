// The language packs (docs/design/language-packs.md): every pack names every card of both deck
// kinds, distinctly; the Italian pack speaks the Italian deck's own language and the English pack
// the French deck's; the owner's examples hold; a pack without a kind or a word falls back to the
// deck's language card by card; the refusal message has the other packs' shape.
import { describe, expect, test } from 'vitest';

import { DECK_KINDS, cardIds, cardName as deckName, DECKS } from '../cards/decks.ts';
import {
  LANGUAGE_PACKS,
  badLanguageMsg,
  cardName,
  isLanguagePack,
  langByName,
  resolveLang,
  type LanguagePack,
} from './packs.ts';

describe('the language packs', () => {
  test('three packs, each naming itself, with a label; isLanguagePack knows them alone', () => {
    expect(LANGUAGE_PACKS).toEqual(['it', 'en', 'en-plates']);
    LANGUAGE_PACKS.forEach((name) => {
      expect(isLanguagePack(name)).toBe(true);
      const pack = langByName(name);
      expect(pack.name).toBe(name);
      expect(pack.label).not.toBe('');
    });
    expect(isLanguagePack('fr')).toBe(false);
    expect(isLanguagePack('')).toBe(false);
  });

  test('every pack names every card of every deck kind, no two cards alike, every name carrying the join word', () => {
    LANGUAGE_PACKS.forEach((name) => {
      const pack = langByName(name);
      DECK_KINDS.forEach((kind) => {
        const words = pack.decks[kind];
        if (words === undefined) throw new Error(`${name} lacks ${kind}`);
        const names = cardIds(kind).map((id) => cardName(pack, kind, id));
        expect(names.every((n) => n?.includes(` ${words.join} `) === true)).toBe(true);
        expect(new Set(names).size).toBe(names.length);
        // The pack's own words, never the deck's fallback: each word is in the table.
        expect(Object.keys(words.suits).sort()).toEqual(DECKS[kind].suits.map((s) => s.id).sort());
        expect(Object.keys(words.ranks).sort()).toEqual(DECKS[kind].ranks.map((r) => r.id).sort());
      });
    });
  });

  test("the Italian pack is the Italian deck's own language; the English pack the French deck's; en on the Italian deck uses the deck's English words", () => {
    const it = langByName('it');
    const en = langByName('en');
    cardIds('italian40').forEach((id) => {
      expect(cardName(it, 'italian40', id)).toBe(deckName('italian40', id));
    });
    cardIds('french52').forEach((id) => {
      expect(cardName(en, 'french52', id)).toBe(deckName('french52', id));
    });
    DECKS.italian40.suits.forEach((s) => {
      expect(en.decks.italian40?.suits[s.id]).toBe(s.english);
    });
    DECKS.italian40.ranks.forEach((r) => {
      expect(en.decks.italian40?.ranks[r.id]).toBe(r.english);
    });
  });

  test("the owner's examples: re di denari, king of coins, ace of plates, ace of spades, asso di picche", () => {
    const it = langByName('it');
    const en = langByName('en');
    const plates = langByName('en-plates');
    expect(cardName(it, 'italian40', 'RD')).toBe('re di denari');
    expect(cardName(it, 'italian40', 'AC')).toBe('asso di coppe');
    expect(cardName(it, 'italian40', 'FB')).toBe('fante di bastoni');
    expect(cardName(it, 'italian40', 'CS')).toBe('cavallo di spade');
    expect(cardName(it, 'italian40', '7D')).toBe('sette di denari');
    expect(cardName(en, 'italian40', 'RD')).toBe('king of coins');
    expect(cardName(en, 'italian40', 'AD')).toBe('ace of coins');
    expect(cardName(en, 'italian40', 'CS')).toBe('knight of swords');
    expect(cardName(en, 'italian40', 'FB')).toBe('knave of batons');
    expect(cardName(plates, 'italian40', 'AD')).toBe('ace of plates');
    expect(cardName(plates, 'italian40', 'RD')).toBe('king of plates');
    // Every other word of en-plates is en's.
    cardIds('italian40')
      .filter((id) => !id.endsWith('D'))
      .forEach((id) => {
        expect(cardName(plates, 'italian40', id)).toBe(cardName(en, 'italian40', id));
      });
    cardIds('french52').forEach((id) => {
      expect(cardName(plates, 'french52', id)).toBe(cardName(en, 'french52', id));
    });
    expect(cardName(en, 'french52', 'AS')).toBe('ace of spades');
    expect(cardName(en, 'french52', 'QH')).toBe('queen of hearts');
    expect(cardName(en, 'french52', '10D')).toBe('ten of diamonds');
    expect(cardName(it, 'french52', 'AS')).toBe('asso di picche');
    expect(cardName(it, 'french52', 'QH')).toBe('donna di cuori');
    expect(cardName(it, 'french52', 'JC')).toBe('fante di fiori');
    expect(cardName(it, 'french52', '10D')).toBe('dieci di quadri');
    expect(langByName('en').notes).toContain('plates');
    expect(plates.notes).toContain('plates');
  });

  test("a pack without the deck kind, or missing a word, falls back to the deck's own language card by card; a stranger is null", () => {
    const partial: LanguagePack = {
      name: 'en',
      label: 'Partial',
      decks: {
        italian40: { suits: { C: 'cups' }, ranks: { A: 'ace' }, join: 'of' },
      },
    };
    expect(cardName(partial, 'italian40', 'AC')).toBe('ace of cups');
    expect(cardName(partial, 'italian40', 'AD')).toBe('asso di denari');
    expect(cardName(partial, 'italian40', '7C')).toBe('sette di coppe');
    expect(cardName(partial, 'french52', 'AS')).toBe('ace of spades');
    expect(cardName(partial, 'french52', 'ZZ')).toBeNull();
    expect(cardName(langByName('it'), 'italian40', 'AZ')).toBeNull();
  });

  test('resolveLang gives the pack a value names, else the fallback; the refusal names the key, quotes the value and lists the packs', () => {
    expect(resolveLang('en', 'it').name).toBe('en');
    expect(resolveLang('en-plates', 'it').name).toBe('en-plates');
    expect(resolveLang('fr', 'it').name).toBe('it');
    expect(resolveLang(null, 'en').name).toBe('en');
    expect(resolveLang(undefined, 'it').name).toBe('it');
    expect(badLanguageMsg('briscola_lang', 'fr')).toBe(
      'briscola_lang: "fr" is not a language pack; kept the current one. One of: it, en, en-plates.',
    );
  });
});
