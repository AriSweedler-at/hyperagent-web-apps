// Pass-and-play on one phone (design §2.4.9 "The curtain cue", §2.1.8, §4 "Curtain"): the
// translucent curtain that names whose turn it is while the phone changes hands. The two-seat
// turn flow itself is the reducer's (ui/state.ts `localBroadcast`: whose view is shown, when the
// curtain comes up, who has revealed); this is its DOM half, written only while the curtain is up
// (gin's rule: the texts are left as they were when it hides), and the curtain button's wiring.
// One tap on the button reveals and, when the button promised a roll, rolls: the promise is
// painted onto the button as `data-rolls`, so the binder needs no App of its own.
import {
  dataOf,
  listenId,
  requireId,
  setAttr,
  setText,
  toggleClass,
  type PageLike,
} from '../../../../shared/edge/dom.ts';
import { diceText, type Seat, type View } from '../engine/index.ts';
import { ONLINE_MODE_SHOWN, type App, type Intent } from './state.ts';

export type CurtainText = Readonly<{
  title: string;
  sub: string;
  /** The last `move`/`noMove` log line, with the hit lines after it; '' at a game's start. */
  last: string;
  button: string;
  /** The button rolls as well as reveals (portes `toRoll` without a double to consider). */
  rolls: boolean;
}>;

/** The log's last completed turn as one line: `Ari moved 8/5* 6/5 · Ari hit Jeff on the 5-point`. */
export const lastTurnText = (v: View): string => {
  const last = [...v.log].reverse().find((e) => e.kind === 'move' || e.kind === 'noMove');
  if (last === undefined) return '';
  const at = v.log.lastIndexOf(last);
  const hits = v.log.slice(at + 1).filter((e) => e.kind === 'hit' && e.seat === last.seat);
  return [last, ...hits].map((e) => e.text).join(' · ');
};

/** The button's copy by phase (design §2.1.8) and whether one tap also rolls. */
const buttonFor = (v: View, name: string): Readonly<{ button: string; rolls: boolean }> => {
  switch (v.phase) {
    case 'toRoll':
      return v.canDouble
        ? { button: `${name} — your turn`, rolls: false }
        : { button: `${name} — roll`, rolls: true };
    case 'moving':
      return { button: `${name} — play ${v.dice === null ? '' : diceText(v.dice)}`, rolls: false };
    case 'cubeOffered':
      return { button: `${name} — answer`, rolls: false };
    case 'over':
    case 'opening':
      return { button: `${name} — look`, rolls: false };
  }
};

/**
 * The curtain for the seat the phone is handed to (design §2.1.8 "Button copy by phase"), read
 * from that seat's own view (`localBroadcast` shows the incoming actor's): `toRoll` rolls at once
 * unless a double is on offer, the Western opening plays the dice already rolled, a cube offer
 * is answered.
 */
export const curtainText = (v: View, incoming: Seat): CurtainText => {
  const name = v.players[incoming].name;
  const other = v.players[incoming === 0 ? 1 : 0].name;
  const sub =
    v.phase === 'cubeOffered' ? `${other} doubles to ${String(v.cube.value * 2)}` : 'Your turn.';
  return { title: `Pass the phone to ${name}`, sub, last: lastTurnText(v), ...buttonFor(v, name) };
};

/** `#curtainOverlay` and its texts from the App; hidden (texts untouched) when no seat is waiting. */
export const paintCurtain = (doc: PageLike, app: App): void => {
  const overlay = requireId(doc, 'curtainOverlay');
  const seat = app.table.curtain;
  const v = app.shell.view;
  const up = seat !== null && v !== null;
  toggleClass(overlay, 'hidden', !up);
  // The handoff to an online room ships with online play (design §6 PR-D).
  toggleClass(requireId(doc, 'curtainHandoffBtn'), 'hidden', !ONLINE_MODE_SHOWN);
  if (seat === null || v === null) return;
  const text = curtainText(v, seat);
  setText(requireId(doc, 'curtainTitle'), text.title);
  setText(requireId(doc, 'curtainSub'), text.sub);
  setText(requireId(doc, 'curtainLast'), text.last);
  const btn = requireId(doc, 'curtainBtn');
  setText(btn, text.button);
  setAttr(btn, 'data-rolls', text.rolls ? '1' : null);
};

/** `#curtainBtn`: the incoming seat reveals, and rolls when the button said so; `#curtainHandoffBtn` hands off. */
export const bindLocal = (doc: PageLike, dispatch: (intent: Intent) => void): void => {
  const btn = requireId(doc, 'curtainBtn');
  listenId(doc, 'curtainBtn', 'click', () => {
    const rolls = dataOf(btn, 'rolls') === '1';
    dispatch({ type: 'curtain/reveal' });
    if (rolls) dispatch({ type: 'roll/click' });
  });
  listenId(doc, 'curtainHandoffBtn', 'click', () => {
    dispatch({ type: 'handoff/click' });
  });
};
