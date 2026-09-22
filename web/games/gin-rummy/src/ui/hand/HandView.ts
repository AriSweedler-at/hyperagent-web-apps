// The hand as markup (docs/MIGRATION.md step 11; docs/ARCHITECTURE.md "Seams reserved":
// swappable hand display). `HandView.render(model, selection, stage?, picture?)` is the only way a
// hand is drawn; SlotHandView.ts (the ghost draw slot and the kept picture) is its one
// implementation since the ghost-slot design's PR A, and main.ts chooses it. The legacy
// `defaultHandView` and its string golden were retired in the simplification pass.
import type { View } from '../../engine/types.ts';
import type { Selection } from '../cues.ts';
import type { DrawStage } from './draw.ts';
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
    /** The loose card being dragged (ui/hand/dragger.ts): its cell is emptied for the ghost. */
    dragging?: string | null,
  ) => string;
}>;
