// The hand as markup (docs/MIGRATION.md step 11; docs/ARCHITECTURE.md "Seams reserved":
// swappable hand display). `HandView.render(model, selection)` is the only way a hand is drawn;
// `defaultHandView` reproduces the `#hand` markup of the legacy `render()`
// (legacy/gin-rummy/index.html, pinned in test/fixtures/legacy/gin-ui.cjs) character for
// character: one `.meld-group.mN` per meld, then `.meld-group.dead` for the deadwood when there is
// any; a card is `selected` when it is the selection, `fresh` when it was the last drawn, `locked`
// when it came off the discard pile this turn and may not go back. A second view is another module
// and a main.ts choice, gated by the same DOM-snapshot parity.
import type { View } from '../../engine/types.ts';
import { cardHtml } from '../cards.ts';
import type { Selection } from '../cues.ts';
import { meldGroupClass } from './meldGroups.ts';

/** What a hand view reads: a `View` satisfies it. */
export type HandModel = Pick<
  View,
  'me' | 'phase' | 'isMyTurn' | 'lastDrawnId' | 'drawnFromDiscard'
>;

export type HandView = Readonly<{ render: (model: HandModel, selection: Selection) => string }>;

export const defaultHandView: HandView = {
  render: (model, selection) => {
    const card = (c: HandModel['me']['hand'][number]): string =>
      cardHtml(c, {
        selected: selection === c.id,
        fresh: model.lastDrawnId === c.id,
        locked: model.drawnFromDiscard === c.id && model.phase === 'discard' && model.isMyTurn,
      });
    const melds = model.me.melds
      .map((m, i) => `<div class="${meldGroupClass(i)}">${m.map(card).join('')}</div>`)
      .join('');
    const dead =
      model.me.deadwood.length > 0
        ? `<div class="meld-group dead">${model.me.deadwood.map(card).join('')}</div>`
        : '';
    return melds + dead;
  },
};
