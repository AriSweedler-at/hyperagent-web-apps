// Pass-and-play on one phone (design §4.9 "The curtain and the hit toast", §2.4 "The copy"): the
// translucent curtain that names whose turn it is while the phone changes hands. The two-seat
// turn flow itself is the reducer's (ui/state.ts `localBroadcast`: whose view is shown, when the
// curtain comes up, who has revealed); this is its DOM half, written only while the curtain is up
// (gin's rule: the texts are left as they were when it hides), and the curtain button's wiring.
// One tap on the button reveals; the roll is the roll modal's, which comes up for the revealed
// seat (design §4.7; until 2026-09-24 the button rolled too, `data-rolls`). The DOM half is the
// shared shell's since docs/design/shared-shell.md §5 B1 (web/shared/ui/curtain.ts); the copy
// stays here.
import { listenId, type PageLike } from '../../../../shared/edge/dom.ts';
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

/** The button's copy by phase (design §4.9): one tap reveals; what the seat then does is named. */
const buttonFor = (v: View, name: string): string => {
  switch (v.phase) {
    case 'toRoll':
      return `${name} — your turn`;
    case 'moving':
      return `${name} — play ${v.dice === null ? '' : diceText(v.dice)}`;
    case 'cubeOffered':
      return `${name} — answer`;
    case 'over':
    case 'opening':
      return `${name} — look`;
  }
};

/** The sub line by phase: what waits behind the curtain (the roll modal, the opening dice, the cube). */
const subFor = (v: View, other: string): string => {
  switch (v.phase) {
    case 'toRoll':
      return v.canDouble
        ? 'Your turn. Double, or roll.'
        : 'Your turn. Roll when you have the phone.';
    case 'cubeOffered':
      return `${other} doubles to ${String(v.cube.value * 2)}`;
    case 'moving':
    case 'over':
    case 'opening':
      return 'Your turn.';
  }
};

/**
 * The curtain for the seat the phone is handed to (design §2.4 "The copy", the curtain row), read
 * from that seat's own view (`localBroadcast` shows the incoming actor's): `toRoll` hands over to
 * the roll modal (design §4.7), the Western opening plays the dice already rolled, a cube offer
 * is answered.
 */
export const curtainText = (v: View, incoming: Seat): CurtainText => {
  const name = v.players[incoming].name;
  const other = v.players[incoming === 0 ? 1 : 0].name;
  return {
    title: `Pass the phone to ${name}`,
    sub: subFor(v, other),
    last: lastTurnText(v, incoming),
    button: buttonFor(v, name),
  };
};

/** `#curtainOverlay` and its texts from the App; hidden (texts untouched) when no seat is waiting. */
export const paintCurtain = (doc: PageLike, app: App): void => {
  const seat = app.table.curtain;
  const v = app.shell.view;
  const text: ShellCurtainText | null = seat === null || v === null ? null : curtainText(v, seat);
  paintShellCurtain(doc, text);
};

/** `#curtainBtn`: the incoming seat reveals (the roll modal then asks for the roll); `#curtainHandoffBtn` hands off. */
export const bindLocal = (doc: PageLike, dispatch: (intent: Intent) => void): void => {
  bindCurtain(doc, dispatch, (): ReadonlyArray<Intent> => [{ type: 'curtain/reveal' }]);
  listenId(doc, 'curtainHandoffBtn', 'click', () => {
    dispatch({ type: 'handoff/click' });
  });
};
