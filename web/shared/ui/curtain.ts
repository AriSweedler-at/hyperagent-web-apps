// The pass-and-play curtain's DOM half, the same in both games (docs/design/shared-shell.md §4.4
// `curtain.ts`; §5 B1): `#curtainOverlay` and its four texts, written only while the curtain is
// up (the legacy `showCurtain` left the texts as they were when it hid the sheet, and both games
// kept that rule), and the curtain button's wiring. The copy itself is each game's `curtainText`
// (gin: who takes the phone and who looks away; backgammon: the phase's verb and the last turn),
// and what one tap does is the game's too: `onReveal` names the intents, so no App is needed
// here. Until backgammon's roll modal (#79, docs/design/backgammon-board.md §4.7) the button also
// carried a `data-rolls` promise, painted through an `attrs` field on `CurtainText` and read back
// by `onReveal(btn)`; docs/design/dry-round-2.md §3 row E10 deleted both once no game passed or
// read one. Not lint-pure: see shellPaint.ts.
import { listenId, requireId, setText, toggleClass, type DocumentLike } from '../edge/dom.ts';

import type { Dispatch } from './shellPaint.ts';

export type CurtainText = Readonly<{
  title: string;
  sub: string;
  last: string;
  button: string;
}>;

/** `#curtainOverlay` and its texts; hidden (texts untouched) when no seat is waiting (`text` null). */
export const paintCurtain = (doc: DocumentLike, text: CurtainText | null): void => {
  const overlay = requireId(doc, 'curtainOverlay');
  toggleClass(overlay, 'hidden', text === null);
  if (text === null) return;
  setText(requireId(doc, 'curtainTitle'), text.title);
  setText(requireId(doc, 'curtainSub'), text.sub);
  setText(requireId(doc, 'curtainLast'), text.last);
  setText(requireId(doc, 'curtainBtn'), text.button);
};

/**
 * `#curtainBtn`: one tap dispatches, in order, what `onReveal` returns at that moment (both
 * games: the reveal; backgammon's roll is the roll modal's, design §4.7).
 */
export const bindCurtain = <I>(
  doc: DocumentLike,
  dispatch: Dispatch<I>,
  onReveal: () => ReadonlyArray<I>,
): void => {
  listenId(doc, 'curtainBtn', 'click', () => {
    onReveal().forEach((intent) => {
      dispatch(intent);
    });
  });
};
