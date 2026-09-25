// English (docs/design/language-packs.md §2): the French deck's own words ("ace of spades"), and
// the Italian deck in the English of the card literature: cups, coins, swords, batons; knave,
// knight, king ("king of coins"). English has more than one word for denari (coins, plates,
// money): `coins` is this pack's; `en-plates` says "plates", the owner's word.
import type { LanguagePack } from '../packs.ts';

export const EN_PACK = {
  name: 'en',
  label: 'English',
  decks: {
    italian40: {
      suits: { C: 'cups', D: 'coins', S: 'swords', B: 'batons' },
      ranks: {
        A: 'ace',
        '2': 'two',
        '3': 'three',
        '4': 'four',
        '5': 'five',
        '6': 'six',
        '7': 'seven',
        F: 'knave',
        C: 'knight',
        R: 'king',
      },
      join: 'of',
    },
    french52: {
      suits: { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' },
      ranks: {
        A: 'ace',
        '2': 'two',
        '3': 'three',
        '4': 'four',
        '5': 'five',
        '6': 'six',
        '7': 'seven',
        '8': 'eight',
        '9': 'nine',
        '10': 'ten',
        J: 'jack',
        Q: 'queen',
        K: 'king',
      },
      join: 'of',
    },
  },
  notes: 'Denari are "coins" here; the en-plates pack says "plates".',
} as const satisfies LanguagePack;
