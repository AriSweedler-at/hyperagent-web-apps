// Pass-and-play on one phone (design §4.9 "The curtain and the hit toast", §2.4 "The copy"): the
// translucent curtain that names whose turn it is while the phone changes hands. The two-seat
// turn flow itself is the reducer's (ui/state.ts `localBroadcast`: whose view is shown, when the
// curtain comes up, who has revealed); this is its DOM half, written only while the curtain is up
// (gin's rule: the texts are left as they were when it hides), and the curtain button's wiring.
// One tap on the button reveals and, when the button promised a roll, rolls: the promise is
// painted onto the button as `data-rolls`, so the binder needs no App of its own. The DOM half is
// the shared shell's since docs/design/shared-shell.md §5 B1 (web/shared/ui/curtain.ts); the copy
// and the roll promise stay here.
import { dataOf, listenId, type PageLike } from '../../../../shared/edge/dom.ts';
import {
  bindCurtain,
  paintCurtain as paintShellCurtain,
  type CurtainText as ShellCurtainText,
} from '../../../../shared/ui/curtain.ts';
import { diceText, type Seat, type View } from '../engine/index.ts';
import { hitsAgainst, lastTurnEntry } from './board.ts';
import type { App, Intent } from './state.ts';

export type CurtainText = Readonly<{
  title: string;
  sub: string;
  /** The last `move`/`noMove` log line with its hits, or the opening roll before any turn. */
  last: string;
  button: string;
  /** The button rolls as well as reveals (portes `toRoll` without a double to consider). */
  rolls: boolean;
}>;

/**
 * `#curtainLast` for the seat taking the phone: the turn just finished as one line, its hits in
 * the incoming player's own numbering because the board beneath is drawn in it (`Ari moved 8/5*
 * 6/5 · Ari hit you on your 20-point`; the notation stays the mover's, as notation does). A
 * forfeited roll reads as logged; the incoming player's own hits (a double offered after their
 * turn) keep the log's lines, already in their numbering. Before any turn, the opening roll
 * (`Ari rolled 4, Jeff rolled 2 — Ari starts`, or `— Ari plays 4-2` in Western).
 */
export const lastTurnText = (v: View, incoming: Seat): string => {
  const last = lastTurnEntry(v);
  if (last === null) return [...v.log].reverse().find((e) => e.kind === 'opening')?.text ?? '';
  const mover = last.seat;
  if (mover === null) return last.text;
  const against = hitsAgainst(v, incoming);
  if (against.length > 0) {
    const by = v.players[mover].name;
    return [last.text, ...against.map((p) => `${by} hit you on your ${String(p)}-point`)].join(
      ' · ',
    );
  }
  const at = v.log.lastIndexOf(last);
  const own = v.log.slice(at + 1).filter((e) => e.kind === 'hit' && e.seat === mover);
  return [last, ...own].map((e) => e.text).join(' · ');
};

/** The button's copy by phase (design §4.9) and whether one tap also rolls. */
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
 * The curtain for the seat the phone is handed to (design §2.4 "The copy", the curtain row), read
 * from that seat's own view (`localBroadcast` shows the incoming actor's): `toRoll` rolls at once
 * unless a double is on offer, the Western opening plays the dice already rolled, a cube offer
 * is answered.
 */
export const curtainText = (v: View, incoming: Seat): CurtainText => {
  const name = v.players[incoming].name;
  const other = v.players[incoming === 0 ? 1 : 0].name;
  const sub =
    v.phase === 'cubeOffered' ? `${other} doubles to ${String(v.cube.value * 2)}` : 'Your turn.';
  return {
    title: `Pass the phone to ${name}`,
    sub,
    last: lastTurnText(v, incoming),
    ...buttonFor(v, name),
  };
};

/** The shared curtain's text, the roll promise painted onto the button as `data-rolls`. */
const withRolls = ({ rolls, ...text }: CurtainText): ShellCurtainText => ({
  ...text,
  attrs: { 'data-rolls': rolls ? '1' : null },
});

/** `#curtainOverlay` and its texts from the App; hidden (texts untouched) when no seat is waiting. */
export const paintCurtain = (doc: PageLike, app: App): void => {
  const seat = app.table.curtain;
  const v = app.shell.view;
  paintShellCurtain(doc, seat === null || v === null ? null : withRolls(curtainText(v, seat)));
};

/** `#curtainBtn`: the incoming seat reveals, and rolls when the button said so; `#curtainHandoffBtn` hands off. */
export const bindLocal = (doc: PageLike, dispatch: (intent: Intent) => void): void => {
  bindCurtain(doc, dispatch, (btn): ReadonlyArray<Intent> =>
    dataOf(btn, 'rolls') === '1'
      ? [{ type: 'curtain/reveal' }, { type: 'roll/click' }]
      : [{ type: 'curtain/reveal' }],
  );
  listenId(doc, 'curtainHandoffBtn', 'click', () => {
    dispatch({ type: 'handoff/click' });
  });
};
