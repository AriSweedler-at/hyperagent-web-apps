// Italian (docs/design/language-packs.md §2): the deck's own words for the Italian deck ("re di
// denari", "asso di coppe", "fante di bastoni", "cavallo di spade"), and the French deck as an
// Italian table calls it (picche, cuori, quadri, fiori; fante, donna, re; "asso di picche").
import type { LanguagePack } from '../packs.ts';

export const IT_PACK = {
  name: 'it',
  label: 'Italiano',
  decks: {
    italian40: {
      suits: { C: 'coppe', D: 'denari', S: 'spade', B: 'bastoni' },
      ranks: {
        A: 'asso',
        '2': 'due',
        '3': 'tre',
        '4': 'quattro',
        '5': 'cinque',
        '6': 'sei',
        '7': 'sette',
        F: 'fante',
        C: 'cavallo',
        R: 're',
      },
      join: 'di',
    },
    french52: {
      suits: { S: 'picche', H: 'cuori', D: 'quadri', C: 'fiori' },
      ranks: {
        A: 'asso',
        '2': 'due',
        '3': 'tre',
        '4': 'quattro',
        '5': 'cinque',
        '6': 'sei',
        '7': 'sette',
        '8': 'otto',
        '9': 'nove',
        '10': 'dieci',
        J: 'fante',
        Q: 'donna',
        K: 're',
      },
      join: 'di',
    },
  },
} as const satisfies LanguagePack;
