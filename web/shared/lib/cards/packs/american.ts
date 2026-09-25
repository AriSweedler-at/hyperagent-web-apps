// The owner's `american` pack (docs/design/card-packs.md §3, §7.2): "the regular cards that you use
// for gin rummy" at an Italian table. No pictures of its own: briscola's forty cards are gin's glyphs
// relabelled (coppe hearts, denari diamonds, spade swords-to-spades, bastoni clubs; fante J,
// cavallo Q, re K; A and 2 … 7 keep their index), so a face is gin's `cardHtml` markup with the
// Italian id on `data-card`. The back is gin's `default` (the navy lattice with a spade medallion):
// the back a gin player sees first, French-suited like the faces; no new picture.
import type { CardPack } from '../packs.ts';
import { DEFAULT_PACK } from './default.ts';

export const AMERICAN_PACK = {
  name: 'american',
  label: 'American',
  back: DEFAULT_PACK.back,
  decks: {
    italian40: {
      kind: 'glyph',
      relabel: {
        deck: 'french52',
        suits: { C: 'H', D: 'D', S: 'S', B: 'C' },
        ranks: { F: 'J', C: 'Q', R: 'K' },
      },
    },
  },
  attribution: null,
} as const satisfies CardPack;
