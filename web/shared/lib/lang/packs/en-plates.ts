// English with "plates" for denari (docs/design/language-packs.md §2): the owner's word for the
// coin suit (2026-09-25: "with the english language pack, it would be 'ace of plates'"). Every
// other word is the `en` pack's.
import type { LanguagePack } from '../packs.ts';
import { EN_PACK } from './en.ts';

export const EN_PLATES_PACK = {
  name: 'en-plates',
  label: 'English (plates)',
  decks: {
    italian40: {
      ...EN_PACK.decks.italian40,
      suits: { ...EN_PACK.decks.italian40.suits, D: 'plates' },
    },
    french52: EN_PACK.decks.french52,
  },
  notes: 'The owner\'s English for denari: "ace of plates".',
} as const satisfies LanguagePack;
