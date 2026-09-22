// The ghost draw slot's state (docs/design/gin-draw-ghost-slot.md §3): while the player draws, the
// ten cards on screen must not move until they act, so the App holds the picture painted at the
// moment of the draw (`HandHold`) and a stage: `waiting` between the tap and the view that carries
// the drawn card (a guest's round trip; host and pass-and-play settle inside one dispatch), then
// `shown` while the eleventh card sits in the ghost slot. Pure and imported by ui/state.ts (which
// sets and settles it) and ui/hand/SlotHandView.ts (which paints it): no cycle. Not in the save and
// not on the wire: only the engine `State` survives a reload (a game resumed mid-draw paints the
// accepted eleven cards, a documented degradation).
import type { Action, Cards, Meld, View } from '../../engine/types.ts';

export type DrawSource = 'stock' | 'discard';

/** The ten-card picture on screen when the player drew: painted until they accept. */
export type HandHold = Readonly<{ melds: ReadonlyArray<Meld>; deadwood: Cards }>;

export type DrawStage =
  | Readonly<{ kind: 'waiting'; from: DrawSource; hold: HandHold }>
  | Readonly<{ kind: 'shown'; from: DrawSource; cardId: string; hold: HandHold }>;

export const holdOf = (me: View['me']): HandHold => ({ melds: me.melds, deadwood: me.deadwood });

/** Where an action draws from, or null for an action that is not a draw. */
export const drawSource = (a: Action): DrawSource | null =>
  a.type === 'drawStock'
    ? 'stock'
    : a.type === 'drawDiscard' || a.type === 'takeUpcard'
      ? 'discard'
      : null;

/**
 * Settle a stage against a freshly painted view: a view that carries my draw (`lastDrawnId`: mine,
 * in hand, cleared by an undo and by a deal) shows it (the same stage when it already does); a
 * `waiting` stage survives a view that still awaits the draw (a re-render during a guest's round
 * trip); anything else (an accept, an undo, a refusal that repainted, the opponent's turn) clears
 * it. Not keyed on `canUndo`: a stock draw cannot be undone and still sits in the ghost cell
 * (docs/design/gin-arrangement-and-discards.md §4).
 */
export const settleDraw = (stage: DrawStage | null, v: View): DrawStage | null => {
  if (stage === null) return null;
  const drawnId = v.isMyTurn && v.phase === 'discard' ? v.lastDrawnId : null;
  if (drawnId !== null)
    return stage.kind === 'shown' && stage.cardId === drawnId
      ? stage
      : { kind: 'shown', from: stage.from, cardId: drawnId, hold: stage.hold };
  const untouched =
    stage.kind === 'waiting' && v.isMyTurn && (v.phase === 'draw' || v.phase === 'upcard');
  return untouched ? stage : null;
};
