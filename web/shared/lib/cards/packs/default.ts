// Gin's `default` back (docs/design/gin-card-backs.md §2) as a pack: a navy lattice with a spade
// medallion over glyph faces for both deck kinds. Every deck kind's glyph-only fallback shape.
import type { CardPack } from '../packs.ts';

export const DEFAULT_PACK = {
  name: 'default',
  label: 'Default',
  back: {
    kind: 'svg',
    url: '../../shared/cards/backs/default.svg',
    aspect: 100 / 144,
    colour: '#1e3a8a',
  },
  decks: { french52: { kind: 'glyph' }, italian40: { kind: 'glyph' } },
  attribution: null,
} as const satisfies CardPack;
