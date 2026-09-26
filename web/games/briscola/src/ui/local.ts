// Pass-and-play on one phone (docs/design/briscola.md D17, §5.4 "Pass-and-play"): the curtain that
// names whose turn it is while the phone changes hands and tells every other player to look away.
// The turn flow itself is the reducer's (ui/state.ts `viewer`: whose view is shown, when the
// curtain comes up, who has revealed; the settle beat finishes before it rises); this is its DOM
// half, written only while the curtain is up (gin's rule: the texts are left as they were when it
// hides), and the curtain button's wiring. The DOM half is the shared shell's
// (web/shared/ui/curtain.ts); the copy stays here. The view under the curtain is the incoming
// player's own (`viewer` shows the actor's), so "you" in the last line is them.
import { listenId, requireId, toggleClass, type PageLike } from '../../../../shared/edge/dom.ts';
import {
  bindCurtain,
  paintCurtain as paintShellCurtain,
  type CurtainText as ShellCurtainText,
} from '../../../../shared/ui/curtain.ts';
import { dealText, nameOf, type Seat, type View } from '../engine/index.ts';
import { listNames, type App, type Intent } from './state.ts';

export type CurtainText = Readonly<{
  title: string;
  /** Everyone but the incoming player, told to look away. */
  sub: string;
  /** The trick just taken, the deal before any, the result once the game is over. */
  last: string;
  button: string;
}>;

/** `#curtainBtn`: what one tap does (the page's `revealLabel`). */
export const REVEAL_LABEL = 'Show my cards';

/** "Ann", "Ann and Cara", "Ann, Cara and Dan": the reducer's list (the pause names the seats down the same way). */
export { listNames } from './state.ts';

/** `#curtainSub`: "Bob, look away" / "Ann, Cara and Dan, look away" (D17). */
export const lookAwayText = (v: View, incoming: Seat): string =>
  `${listNames(v.players.filter((_, seat) => seat !== incoming).map((p) => p.name))}, look away`;

/**
 * `#curtainLast` for the seat taking the phone: the trick just taken ("Ann took the trick · 14
 * points", "You took the trick · 14 points" when the incoming player won it), the deal before any
 * trick ("Ann dealt · the briscola is the sette di coppe").
 */
export const lastLineText = (v: View, incoming: Seat): string => {
  const t = v.lastTrick;
  if (t === null) return dealText(nameOf(v.players, v.dealer), v.trumpCard);
  const who = t.winner === incoming ? 'You' : nameOf(v.players, t.winner);
  return `${who} took the trick · ${String(t.points)} points`;
};

/** The curtain for the seat the phone is handed to, read from that seat's own view. */
export const curtainText = (v: View, incoming: Seat): CurtainText => ({
  title: `Pass the phone to ${nameOf(v.players, incoming)}`,
  sub: lookAwayText(v, incoming),
  last: lastLineText(v, incoming),
  button: REVEAL_LABEL,
});

/**
 * `#curtainOverlay` and its texts from the App; hidden (texts untouched) when no seat is waiting.
 * `#curtainHandoffBtn` ("Continue online") shows at two players alone: the handoff is a two-seat
 * room (D17).
 */
export const paintCurtain = (doc: PageLike, app: App): void => {
  const seat = app.table.curtain;
  const v = app.shell.view;
  const text: ShellCurtainText | null = seat === null || v === null ? null : curtainText(v, seat);
  paintShellCurtain(doc, text);
  toggleClass(requireId(doc, 'curtainHandoffBtn'), 'hidden', v?.options.seatCount !== 2);
};

/** `#curtainBtn`: the incoming seat reveals; `#curtainHandoffBtn` hands off. */
export const bindLocal = (doc: PageLike, dispatch: (intent: Intent) => void): void => {
  bindCurtain(doc, dispatch, (): ReadonlyArray<Intent> => [{ type: 'curtain/reveal' }]);
  listenId(doc, 'curtainHandoffBtn', 'click', () => {
    dispatch({ type: 'handoff/click' });
  });
};
