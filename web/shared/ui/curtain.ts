// The pass-and-play curtain's DOM half, the same in both games (docs/design/shared-shell.md §4.4
// `curtain.ts`; §5 B1): `#curtainOverlay` and its four texts, written only while the curtain is
// up (the legacy `showCurtain` left the texts as they were when it hid the sheet, and both games
// kept that rule), and the curtain button's wiring. The copy itself is each game's `curtainText`
// (gin: who takes the phone and who looks away; backgammon: the phase's verb and the last turn),
// and what one tap does is the game's too: `onReveal` reads it off the button, so backgammon's
// `data-rolls` promise (painted through `attrs`) needs no App here. Not lint-pure: see
// shellPaint.ts.
import {
  listenId,
  requireId,
  setAttr,
  setText,
  toggleClass,
  type DocumentLike,
  type Element,
} from '../edge/dom.ts';

import type { Dispatch } from './shellPaint.ts';

export type CurtainText = Readonly<{
  title: string;
  sub: string;
  last: string;
  button: string;
  /** Attributes painted onto `#curtainBtn` beside its label (backgammon's `data-rolls`); null removes one. */
  attrs?: Readonly<Record<string, string | null>>;
}>;

/** `#curtainOverlay` and its texts; hidden (texts untouched) when no seat is waiting (`text` null). */
export const paintCurtain = (doc: DocumentLike, text: CurtainText | null): void => {
  const overlay = requireId(doc, 'curtainOverlay');
  toggleClass(overlay, 'hidden', text === null);
  if (text === null) return;
  setText(requireId(doc, 'curtainTitle'), text.title);
  setText(requireId(doc, 'curtainSub'), text.sub);
  setText(requireId(doc, 'curtainLast'), text.last);
  const btn = requireId(doc, 'curtainBtn');
  setText(btn, text.button);
  Object.entries(text.attrs ?? {}).forEach((attr: readonly [string, string | null]) => {
    setAttr(btn, attr[0], attr[1]);
  });
};

/**
 * `#curtainBtn`: one tap dispatches, in order, what `onReveal` reads off the button at that
 * moment (gin: the reveal; backgammon: the reveal, then the roll when `data-rolls` says so).
 */
export const bindCurtain = <I>(
  doc: DocumentLike,
  dispatch: Dispatch<I>,
  onReveal: (btn: Element) => ReadonlyArray<I>,
): void => {
  const btn = requireId(doc, 'curtainBtn');
  listenId(doc, 'curtainBtn', 'click', () => {
    onReveal(btn).forEach((intent) => {
      dispatch(intent);
    });
  });
};
