// Every status line fits its slot (copy-budget.ts; design §2.4 "The copy"): the producers'
// inputs are enumerated with the engine's own positions (every branch of `statusText`, both
// seats, names at the shell's NAME_MAX) and each line is measured against the strip's budget
// sideways (the mover's own lines: the roll modal, the moves, the tray, the held turn, the
// forfeited roll) or the portrait line's (the lines that carry the opponent's name, which the
// strip beside them shows anyway: their sideways brief is a follow-up). A line over budget fails
// with the slot, the text, the numbers, the producer and the input, and what to do. `STRIP_DEBT`
// is the ratchet: the lines that overflowed the strip when the budget was introduced, spelled
// exactly, so a copywriter's new line or a longer edit of one of these fails, and one that comes
// under budget must leave the list.
import { describe, expect, test } from 'vitest';

import { now } from '../../../../../test/shared/engine-helpers.ts';
import { NAME_MAX } from '../../../../shared/lib/protocol.ts';
import {
  applyAction,
  createGame,
  viewFor,
  withPosition,
  type Action,
  type Dice,
  type From,
  type Seat,
  type ShippedVariant,
  type State,
  type To,
  type View,
} from '../engine/index.ts';
import { mv, pos, scripted, START } from '../engine/test-helpers.ts';
import { PLAIN_STATUS, ROLLING_STATUS, statusText, targetsOf, type Pending } from './board.ts';
import {
  BADGE_MAX_WIDTH,
  budget,
  overBudget,
  overBudgetMessage,
  SLOTS,
  type CopyLine,
} from './copy-budget.ts';

/** Names at the shell's cap (NAME_MAX, 20): the widest a name-bearing line gets. */
const LONG = [
  { id: 'a', name: 'Konstantinopoulos XX' },
  { id: 'b', name: 'Konstantinopoulos YY' },
] as const;
const PRODUCER = 'src/ui/board.ts (statusText)';

const stateAt = (
  text: string,
  turn: Seat,
  dice: Dice | null,
  variant: ShippedVariant = 'portes',
  manualTurnEnd = false,
): State =>
  withPosition(
    createGame(LONG, { matchLength: 5, rotation: [variant], manualTurnEnd }, scripted(3, 1), now),
    pos(text),
    turn,
    dice,
  );
const step = (state: State, seat: Seat, action: Action): State => {
  const r = applyAction(state, seat, action, scripted(6, 6), now);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const move = (state: State, text: string): State =>
  step(state, state.turn, { type: 'move', ...mv(state.turn, text) });
const line = (input: string, text: string): CopyLine => ({ text, producer: PRODUCER, input });
const status = (input: string, v: View, opts = PLAIN_STATUS): CopyLine =>
  line(input, statusText(v, opts));

const BLOT_ON_7 = 'L: 24:2 13:5 8:3 6:5 | D: 24:2 13:5 8:3 6:4 18:1 | bar 0/0 | off 0/0';
const T5 = 'L: 24:1 13:5 8:3 6:5 | D: 24:2 13:5 8:3 6:5 | bar 1/0 | off 0/0';
const T9 = 'L: 24:1 10:1 9:1 8:1 | D: 5:2 23:2 24:2 13:9 | bar 0/0 | off 11/0';
const T10 = 'L: 6:2 5:2 4:2 3:2 2:2 1:2 | D: 13:15 | bar 0/0 | off 3/0';
const T12 = 'L: 4:1 2:1 | D: 13:15 | bar 0/0 | off 13/0';
const T15 = 'L: 24:2 6:3 5:3 4:3 3:2 2:2 | D: 2:2 3:2 4:2 5:2 6:2 7:2 13:3 | bar 0/0 | off 0/0';
const T25 = 'L: 1:1 | D: 13:15 | bar 0/0 | off 14/0';
const NO_ENTRY = 'L: 13:14 | D: 1:2 2:2 3:2 4:2 5:2 6:2 13:3 | bar 1/0 | off 0/0';

const pendingFor = (v: View, from: From, to: To): Pending => {
  const target = targetsOf(v, from, null).find((x) => x.to === to);
  return { from, to, chains: target?.chains ?? [] };
};

/** The seat-free lines from the start position, for `seat`: the roll, the first moves, the last move, the held turn. */
const startLines = (seat: Seat): ReadonlyArray<CopyLine> => {
  const at = (dice: Dice | null, variant?: ShippedVariant, manual?: boolean): View =>
    viewFor(stateAt(START, seat, dice, variant, manual), seat);
  const lastAuto = move(stateAt(START, seat, [3, 1]), '8/5');
  const lastManual = move(stateAt(START, seat, [3, 1], 'portes', true), '8/5');
  const held = move(lastManual, '6/5');
  const s = `seat ${String(seat)}`;
  return [
    status(`phase 'toRoll', portes, ${s}`, at(null)),
    status(`phase 'toRoll', Western with the cube, ${s}`, at(null, 'backgammon')),
    status(`phase 'moving', both dice to play, ${s}`, at([3, 1])),
    status(`phase 'moving', a double, all four to play, ${s}`, at([6, 6])),
    status(`phase 'moving', one die left, the turn ends by itself, ${s}`, viewFor(lastAuto, seat)),
    status(
      `phase 'moving', one die left, pass-and-play holds the turn, ${s}`,
      viewFor(lastManual, seat),
    ),
    status(`phase 'moving', a die picked, ${s}`, at([6, 4]), { ...PLAIN_STATUS, picked: 6 }),
    status(`phase 'moving', the turn held, dice used, ${s}`, viewFor(held, seat)),
  ];
};

/** The mover's own lines, one per branch of `statusText` on my turn: Light through the engine's test positions (they are written from Light's side), both seats from the start. */
const moverLines = (): ReadonlyArray<CopyLine> => {
  const at = (text: string, dice: Dice | null): View => viewFor(stateAt(text, 0, dice), 0);
  const tray = at(BLOT_ON_7, [6, 3]);
  const off = at(T12, [6, 5]);
  const heldDead = move(stateAt(T15, 0, [6, 5], 'portes', true), '6/1');
  const noMove = step(stateAt(T15, 0, null), 0, { type: 'roll' });
  const noEntry = step(stateAt(NO_ENTRY, 0, null), 0, { type: 'roll' });
  return [
    ...startLines(0),
    ...startLines(1),
    line('the dice tumbling (ROLLING_STATUS)', ROLLING_STATUS),
    status("phase 'moving', a checker on the bar", at(T5, [6, 1])),
    status("phase 'moving', a dead die", at(T15, [6, 5])),
    status("phase 'moving', a double partly dead", at(T9, [4, 4])),
    status("phase 'moving', moves left after one", viewFor(move(stateAt(T9, 0, [4, 4]), '8/4'), 0)),
    status("phase 'moving', bearing off", at(T10, [6, 5])),
    status("phase 'moving', the tray open, two ways", tray, {
      pending: pendingFor(tray, 12, 3),
      noMoveShown: false,
    }),
    status("phase 'moving', the tray open, either die bears off", off, {
      pending: pendingFor(off, 3, 'off'),
      noMoveShown: false,
    }),
    status("phase 'moving', the turn held, a die dead", viewFor(heldDead, 0)),
    status('the forfeited roll, no move', viewFor(noMove, 0), { pending: null, noMoveShown: true }),
    status('the forfeited roll, no entry', viewFor(noEntry, 0), {
      pending: null,
      noMoveShown: true,
    }),
  ];
};

/** The lines that name the opponent (their turn, the cube, the result), names at NAME_MAX, both seats as the opponent. */
const namedLines = (): ReadonlyArray<CopyLine> =>
  ([0, 1] as const).flatMap((seat) => {
    const other: Seat = seat === 0 ? 1 : 0;
    const s = `viewer seat ${String(other)}, a ${String(NAME_MAX)}-character name`;
    const offered = step(stateAt(START, seat, null, 'backgammon'), seat, { type: 'double' });
    return [
      status(`the opponent to roll, ${s}`, viewFor(stateAt(START, seat, null), other)),
      status(
        `the opponent may double, ${s}`,
        viewFor(stateAt(START, seat, null, 'backgammon'), other),
      ),
      status(`the opponent moving, ${s}`, viewFor(stateAt(START, seat, [3, 1]), other)),
      status(`the cube offered to me, ${s}`, viewFor(offered, other)),
      status(`the cube offered by me, ${s}`, viewFor(offered, seat)),
      ...(seat === 0
        ? [
            status(
              `the game over, a gammon, ${s}`,
              viewFor(move(stateAt(T25, 0, [1, 4]), '1/off(4)'), 1),
            ),
          ]
        : []),
    ];
  });

/**
 * The strip's debt when the budget was introduced (2026-09-28): the mover's lines that were over
 * it, kept exactly as they read. Shorten one and remove it here; lengthen one and the test fails.
 */
const STRIP_DEBT: ReadonlySet<string> = new Set([
  'Your turn. Buen mazal!',
  'Your turn. Double or roll',
  '6-1 · enter from the bar',
  '6-5 · the 6 cannot be played',
  '4-4 · only three of the four can be played',
  '13 · 6+3 reaches 4 two ways',
  '4 · either die bears off',
  'Dice used — End turn, or Undo',
  '6-5 · the 6 cannot be played — End turn, or Undo',
  '6-6 · no move — turn passes',
  '6-6 · no entry — turn passes',
]);

describe('the budget table', () => {
  test('the strip holds 20 characters at its narrowest, the portrait line 49; the badge at its widest is 140px', () => {
    expect(BADGE_MAX_WIDTH).toBe(140);
    expect(SLOTS.stripStatus.widthPx).toBe(142);
    expect(budget(SLOTS.stripStatus)).toBe(20);
    expect(budget(SLOTS.portraitStatus)).toBe(49);
  });

  test('the message names the slot, the text and its length, the budget and its derivation, the producer, the input and what to do', () => {
    const msg = overBudgetMessage(
      SLOTS.stripStatus,
      line("phase 'moving', one die left", 'Last move: the turn ends when you play it'),
    );
    expect(msg).toBe(
      `#statusLine copy "Last move: the turn ends when you play it" is 41 characters; the slot holds 20 at its narrowest (sideways, the rail at its 780x304 floor with the badge at its widest (140px): 142px at 7.1px per character). Shorten it in src/ui/board.ts (statusText) (phase 'moving', one die left) or widen the slot in theme.css and the budget table (src/ui/copy-budget.ts).`,
    );
    expect(overBudget(SLOTS.stripStatus, [line('x', '5-2 · last move')])).toEqual([]);
  });
});

describe('every status line fits its slot', () => {
  test("the mover's lines fit the strip sideways (the owner's last-move line among them); the debt list is exact", () => {
    const lines = moverLines();
    expect(lines.length).toBe(27);
    const over = overBudget(SLOTS.stripStatus, lines);
    const fresh = over.filter((o) => !STRIP_DEBT.has(o.line.text));
    expect(fresh.map((o) => o.message).join('\n\n')).toBe('');
    // The ratchet: a debt line that fits now, or that no producer makes any more, leaves the list.
    const seen = new Set(over.map((o) => o.line.text));
    const stale = [...STRIP_DEBT].filter((t) => !seen.has(t));
    expect(
      stale
        .map(
          (t) =>
            `"${t}" is in STRIP_DEBT but no longer over the strip's budget: remove it from copy-budget.test.ts`,
        )
        .join('\n'),
    ).toBe('');
    // The line the owner saw cut: `3-1 · last move`, in every mode and for both seats.
    lines
      .filter((l) => l.input.startsWith("phase 'moving', one die left"))
      .forEach((l) => {
        expect(l.text).toMatch(/^\d-\d · last move$/u);
      });
  });

  test("the opponent's lines with a 20-character name fit the portrait status line", () => {
    const lines = namedLines();
    expect(lines.length).toBe(11);
    expect(lines.every((l) => l.text.includes('Konstantinopoulos'))).toBe(true);
    const over = overBudget(SLOTS.portraitStatus, lines);
    expect(over.map((o) => o.message).join('\n\n')).toBe('');
  });
});
