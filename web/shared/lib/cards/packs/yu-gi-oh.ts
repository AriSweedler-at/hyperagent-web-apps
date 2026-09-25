// Gin's `yu-gi-oh` back (docs/design/gin-card-backs.md §1b): the picture the owner supplied
// (web/games/gin-rummy/assets/yu-gi-oh-back.jpg), drawn at the three device-pixel ratios by
// tools/card-backs.ts, over glyph faces. The owner's own picture, so no attribution line.
import type { CardPack } from '../packs.ts';

export const YU_GI_OH_PACK = {
  name: 'yu-gi-oh',
  label: 'Yu-Gi-Oh!',
  back: {
    kind: 'image',
    urls: [
      { ratio: 1, url: '../../shared/cards/backs/yu-gi-oh-112.jpg' },
      { ratio: 2, url: '../../shared/cards/backs/yu-gi-oh-224.jpg' },
      { ratio: 3, url: '../../shared/cards/backs/yu-gi-oh-336.jpg' },
    ],
    aspect: 100 / 144,
    colour: '#2a0d04',
  },
  decks: { french52: { kind: 'glyph' }, italian40: { kind: 'glyph' } },
  attribution: null,
} as const satisfies CardPack;
