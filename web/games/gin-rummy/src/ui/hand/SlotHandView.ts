// The hand as eleven fixed cells (docs/design/gin-draw-ghost-slot.md §4; docs/design/gin-
// arrangement-and-discards.md §6): the picture's groups, each one `.group.nK` grid item of K
// `.slot`s (coloured `m0..m4` with `head`/`tail` rounding the ends while the group is a meld, else
// `dead`: a meld a discard broke stays in place; `human` on the slots of a meld the player made by
// hand, arrange.ts), then the loose cards as bare `.slot.dead` cells,
// and an eleventh `.slot.ghost` where a drawn card lands before the player accepts it. A group is
// one grid item, so the browser never splits a meld across two rows; the grid's dense flow lets a
// later loose card or the ghost fill a hole a meld left. The ghost cell is never a `.card`, so
// `#hand .card` keeps counting real cards for the fixtures and the drivers. The `fresh` dot marks
// the drawn card only while its holder chooses the discard: once they have discarded it is gone
// (the owner: it must not wait for the opponent's move), so a view of the opponent's turn, a
// round over or the other seat's hand carries no dot. Strings only: the DOM write is render.ts's.
import { isValidMeldGroup } from '../../engine/melds.ts';
import { HAND_SIZE, type Card, type Cards } from '../../engine/types.ts';
import { cardHtml } from '../cards.ts';
import type { DrawStage } from './draw.ts';
import type { HandModel, HandView } from './HandView.ts';
import { cardsOf, engineOf, type Picture } from './picture.ts';

/** The grid always has this many cells: a ten-card hand plus the ghost slot, or eleven cards. */
export const SLOT_COUNT = HAND_SIZE + 1;

/** `group nK`: the grid item's classes for a group of `size` cards (CONTRACT.md: template `n${len}`). */
export const groupClass = (size: number): string => `group n${String(size)}`;

/**
 * The ghost slot: the drawn card while `shown`, the pending cell while `waiting`, the open cell
 * while a draw is possible (or a `shown` stage names a card the hand no longer holds), else the
 * bare hidden cell that keeps the grid at eleven.
 */
const ghostSlot = (model: HandModel, stage: DrawStage | null): string => {
  if (stage?.kind === 'waiting') return '<div class="slot ghost pending"></div>';
  const drawn = stage === null ? undefined : model.me.hand.find((c) => c.id === stage.cardId);
  if (stage !== null && drawn !== undefined)
    return `<div class="slot ghost shown">${cardHtml(drawn, { fresh: true, locked: stage.from === 'discard' })}</div>`;
  const open =
    stage !== null || (model.isMyTurn && (model.phase === 'draw' || model.phase === 'upcard'));
  return open ? '<div class="slot ghost open"></div>' : '<div class="slot ghost"></div>';
};

export const slotHandView: HandView = {
  render: (model, selection, stage = null, picture = null) => {
    const shown: Picture = picture ?? engineOf(model, stage);
    const card = (c: Card): string =>
      cardHtml(c, {
        selected: stage === null && selection === c.id,
        fresh: model.lastDrawnId === c.id && model.isMyTurn && model.phase === 'discard',
        locked: model.drawnFromDiscard === c.id && model.phase === 'discard' && model.isMyTurn,
      });
    const slot = (c: Card, cls: string, head: boolean, tail: boolean): string =>
      `<div class="slot ${cls}${head ? ' head' : ''}${tail ? ' tail' : ''}${shown.human.includes(c.id) ? ' human' : ''}">${card(c)}</div>`;
    const group = (g: Cards, i: number): string => {
      const meld = isValidMeldGroup(g);
      const slots = g
        .map((c, j) =>
          meld
            ? slot(c, `m${String(i % 5)}`, j === 0, j === g.length - 1)
            : slot(c, 'dead', false, false),
        )
        .join('');
      return `<div class="${groupClass(g.length)}">${slots}</div>`;
    };
    const loose = shown.loose.map((c) => slot(c, 'dead', false, false)).join('');
    const ghost = cardsOf(shown).length < SLOT_COUNT ? ghostSlot(model, stage) : '';
    return shown.groups.map(group).join('') + loose + ghost;
  },
};
