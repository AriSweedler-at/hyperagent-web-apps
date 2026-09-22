// The hand as markup (docs/MIGRATION.md step 11; docs/ARCHITECTURE.md "Seams reserved":
// swappable hand display). `HandView.render(model, selection)` is the only way a hand is drawn;
// `defaultHandView` reproduces the `#hand` markup of the legacy `render()`
// (legacy/gin-rummy/index.html, pinned in test/fixtures/legacy/gin-ui.cjs) character for
// character: one `.meld-group.mN` per meld, then `.meld-group.dead` for the deadwood when there is
// any; a card is `selected` when it is the selection, `fresh` when it was the last drawn, `locked`
// when it came off the discard pile this turn and may not go back. The second view is
// SlotHandView.ts (the ghost draw slot, docs/design/gin-draw-ghost-slot.md), main.ts's choice
// since PR A of that design; this one stays for its legacy string golden
// (test/parity/gin.ui.test.ts) until the design's PR D retires it. The optional `stage` is the
// draw slot's and `picture` the kept arrangement (docs/design/gin-arrangement-and-discards.md
// §5); the default view ignores both.
import type { View } from '../../engine/types.ts';
import { cardHtml } from '../cards.ts';
import type { Selection } from '../cues.ts';
import type { DrawStage } from './draw.ts';
import { meldGroupClass } from './meldGroups.ts';
import type { Picture } from './picture.ts';

/** What a hand view reads: a `View` satisfies it. */
export type HandModel = Pick<
  View,
  'me' | 'phase' | 'isMyTurn' | 'lastDrawnId' | 'drawnFromDiscard'
>;

export type HandView = Readonly<{
  render: (
    model: HandModel,
    selection: Selection,
    stage?: DrawStage | null,
    picture?: Picture | null,
  ) => string;
}>;

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
