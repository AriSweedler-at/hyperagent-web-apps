// Pass-and-play on one phone (docs/MIGRATION.md step 12): the curtain that hides the table while
// the phone changes hands. The two-seat turn flow itself is the reducer's (ui/state.ts
// `localBroadcast`: whose view is shown, when the curtain comes up, who has revealed); this is its
// DOM half, the legacy `showCurtain` (legacy/gin-rummy/index.html) text for text, written only
// while the curtain is up (the legacy left the texts as they were when it hid the sheet), and the
// curtain button's wiring. The DOM half is the shared shell's since docs/design/shared-shell.md
// §5 B1 (web/shared/ui/curtain.ts); the copy stays here.
import type { PageLike } from '../../../../shared/edge/dom.ts';
import {
  bindCurtain,
  paintCurtain as paintShellCurtain,
  type CurtainText,
} from '../../../../shared/ui/curtain.ts';
import type { State } from '../engine/types.ts';
import type { App, Intent } from './state.ts';

export type { CurtainText };

/** `showCurtain(turnIdx)`: who takes the phone, who looks away, the last move, the button. */
export const curtainText = (game: State, turn: 0 | 1): CurtainText => {
  const p = game.players[turn];
  const o = game.players[turn === 0 ? 1 : 0];
  return {
    title: `Pass the phone to ${p.name}`,
    sub: `${o.name}, look away 👀`,
    last: game.lastAction?.text ?? '',
    button: `I'm ${p.name} — show my cards`,
  };
};

/** `#curtainOverlay` and its texts from the App; hidden (texts untouched) when no seat is waiting. */
export const paintCurtain = (doc: PageLike, app: App): void => {
  paintShellCurtain(
    doc,
    app.table.curtain === null || app.shell.game === null
      ? null
      : curtainText(app.shell.game, app.table.curtain),
  );
};

/** `#curtainBtn`: the seat whose turn it is reveals its cards. */
export const bindLocal = (doc: PageLike, dispatch: (intent: Intent) => void): void => {
  bindCurtain(doc, dispatch, (): ReadonlyArray<Intent> => [{ type: 'curtain/reveal' }]);
};
