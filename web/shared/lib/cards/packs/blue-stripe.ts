// Gin's `blue-stripe` back (docs/design/gin-card-backs.md §2): the diagonal stripes the page
// opened with, twelve units of a hundred, over glyph faces.
import type { CardPack } from '../packs.ts';

export const BLUE_STRIPE_PACK = {
  name: 'blue-stripe',
  label: 'Blue stripe',
  back: {
    kind: 'svg',
    url: '../../shared/cards/backs/blue-stripe.svg',
    aspect: 100 / 144,
    colour: '#1e3a8a',
  },
  decks: { french52: { kind: 'glyph' }, italian40: { kind: 'glyph' } },
  attribution: null,
} as const satisfies CardPack;
