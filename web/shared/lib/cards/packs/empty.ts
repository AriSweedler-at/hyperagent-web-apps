// Gin's `empty` back (docs/design/gin-card-backs.md §2): a plain navy field with the border and no
// picture, over glyph faces.
import type { CardPack } from '../packs.ts';

export const EMPTY_PACK = {
  name: 'empty',
  label: 'Empty',
  back: { kind: 'css', colour: '#1e3a8a' },
  decks: { french52: { kind: 'glyph' }, italian40: { kind: 'glyph' } },
  attribution: null,
} as const satisfies CardPack;
