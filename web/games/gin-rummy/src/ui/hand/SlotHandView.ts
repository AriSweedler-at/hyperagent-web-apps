// The hand as eleven fixed cells (docs/design/gin-draw-ghost-slot.md §4): ten `.slot`s holding the
// melds (coloured `m0..m4`, `head`/`tail` rounding the group's ends) then the deadwood (`dead`),
// and an eleventh `.slot.ghost` where a drawn card lands before the player accepts it. Nothing
// moves on a draw: while the stage is `shown` the ten cards paint from the stage's hold (the
// picture at the moment of the draw) and the eleventh card sits in the ghost slot with the fresh
// dot (and the lock when it came off the discard pile); on accept the eleven re-meld into eleven
// card slots and the ghost cell is gone. The ghost cell is never a `.card`, so `#hand .card` keeps
// counting real cards for the fixtures and the drivers. Strings only: the DOM write is render.ts's.
import type { Card, Cards, Meld } from '../../engine/types.ts';
import { cardHtml } from '../cards.ts';
import type { DrawStage, HandHold } from './draw.ts';
import type { HandModel, HandView } from './HandView.ts';

/** The grid always has this many cells: a ten-card hand plus the ghost slot, or eleven cards. */
export const SLOT_COUNT = 11;

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
  render: (model, selection, stage = null) => {
    const hold: HandHold =
      stage?.kind === 'shown' ? stage.hold : { melds: model.me.melds, deadwood: model.me.deadwood };
    const card = (c: Card): string =>
      cardHtml(c, {
        selected: stage === null && selection === c.id,
        fresh: model.lastDrawnId === c.id,
        locked: model.drawnFromDiscard === c.id && model.phase === 'discard' && model.isMyTurn,
      });
    const slot = (c: Card, cls: string, head: boolean, tail: boolean): string =>
      `<div class="slot ${cls}${head ? ' head' : ''}${tail ? ' tail' : ''}">${card(c)}</div>`;
    const meldSlots = (m: Meld, i: number): string =>
      m.map((c, j) => slot(c, `m${String(i % 5)}`, j === 0, j === m.length - 1)).join('');
    const deadSlots = (dead: Cards): string =>
      dead.map((c) => slot(c, 'dead', false, false)).join('');
    const held = hold.melds.reduce((n, m) => n + m.length, 0) + hold.deadwood.length;
    const ghost = held < SLOT_COUNT ? ghostSlot(model, stage) : '';
    return hold.melds.map(meldSlots).join('') + deadSlots(hold.deadwood) + ghost;
  },
};
