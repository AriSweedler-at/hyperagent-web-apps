// Every status line fits its slot (copy-budget.ts, copy.ts; design §2.4 "The copy budget"), two
// ways. Statically: every template in `STATUS_TEMPLATES` (board.ts) has a worst case, its literals
// plus its blocks' caps, and each is held to the strip's budget sideways with no runtime input at
// all, so a copywriter's longer line, or a wider cap, fails here naming the template. Then by
// enumeration: the producers' inputs with the engine's own positions (every branch of `statusText`,
// both seats, names at the shell's NAME_MAX), the mover's lines and the opponent's alike, each
// measured against the strip (sideways `#statusLine` is one element online and pass-and-play, so the
// opponent's lines land in the same 20 characters). A line over budget fails with the slot, the
// text, the numbers, the producer and the input, and what to do.
import { describe, expect, test } from 'vitest';

import { now } from '../../../../../test/shared/engine-helpers.ts';
import { NAME_MAX } from '../../../../shared/lib/protocol.ts';
import {
  applyAction,
  createGame,
  CUBE_MAX,
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
import {
  PLAIN_STATUS,
  ROLLING_STATUS,
  STATUS_TEMPLATES,
  statusText,
  targetsOf,
  type Pending,
} from './board.ts';
import { name, render, worstCase, type Template } from './copy.ts';
import {
  BADGE_MAX_WIDTH,
  budget,
  overBudget,
  overBudgetMessage,
  SLOTS,
  templateOverBudgetMessage,
  templatesOverBudget,
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

const T = STATUS_TEMPLATES;
const LONG_NAME = LONG[0].name;
/**
 * Every template at its widest input: a name at NAME_MAX, a double, the cube's top, the most
 * points a game pays. The record's keys are the templates', so a new template must be sampled here.
 */
const SAMPLES: Readonly<Record<keyof typeof STATUS_TEMPLATES, Template>> = {
  rolling: T.rolling(),
  yourRoll: T.yourRoll(),
  yourDoubleOrRoll: T.yourDoubleOrRoll(),
  oppToRoll: T.oppToRoll(LONG_NAME),
  oppMayDouble: T.oppMayDouble(LONG_NAME),
  oppToMove: T.oppToMove(LONG_NAME, [6, 6]),
  oppToAnswer: T.oppToAnswer(LONG_NAME),
  offered: T.offered(LONG_NAME, CUBE_MAX),
  won: T.won(LONG_NAME, 3 * CUBE_MAX),
  passes: T.passes([6, 6]),
  playing: T.playing([6, 6], 6),
  enter: T.enter([6, 6]),
  dead: T.dead([6, 5], 6),
  partlyDead: T.partlyDead([4, 4], 3),
  lastMove: T.lastMove([6, 6]),
  bearOff: T.bearOff([6, 6]),
  playBoth: T.playBoth([6, 5]),
  playAllFour: T.playAllFour([6, 6]),
  movesLeft: T.movesLeft([6, 6], 3),
  diceUsed: T.diceUsed(),
  heldDead: T.heldDead(6),
  twoWays: T.twoWays([6, 5], 'off'),
};

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

  test("a template's message names it, spells its shape and its worst case, and says what to do", () => {
    const wordy: Template = [name(8, LONG_NAME), ' is answering the double'];
    expect(templateOverBudgetMessage(SLOTS.stripStatus, 'oppToAnswer', wordy)).toBe(
      `#statusLine template "oppToAnswer" ({name:8} is answering the double) can reach 32 characters; the slot holds 20 at its narrowest (sideways, the rail at its 780x304 floor with the badge at its widest (140px): 142px at 7.1px per character). Shorten its words or a block's cap in src/ui/board.ts (STATUS_TEMPLATES), or widen the slot in theme.css and the budget table (src/ui/copy-budget.ts).`,
    );
    expect(
      templatesOverBudget(SLOTS.stripStatus, { wordy, fits: T.oppToAnswer(LONG_NAME) }).map(
        (o) => o.name,
      ),
    ).toEqual(['wordy']);
  });
});

describe('every status template fits the strip', () => {
  test("each template's worst case is within the strip's 20 characters, with no input at all", () => {
    const over = templatesOverBudget(SLOTS.stripStatus, SAMPLES);
    expect(over.map((o) => o.message).join('\n\n')).toBe('');
  });

  test('at the widest input every template renders within its worst case, and a clipped name ends in …', () => {
    Object.entries(SAMPLES).forEach(([key, t]) => {
      expect(render(t).length, `${key}: "${render(t)}"`).toBeLessThanOrEqual(worstCase(t));
    });
    expect(render(SAMPLES.oppToMove)).toBe('Konst… to move · 6-6');
    expect(render(SAMPLES.oppToRoll)).toBe('Konstantino… to roll');
    expect(render(SAMPLES.offered)).toBe('Konst… doubles to 64');
    expect(render(SAMPLES.won)).toBe('Konstantin… wins 192');
    expect(render(SAMPLES.twoWays)).toBe('6+5 to off, two ways');
  });
});

describe('every status line fits the strip sideways', () => {
  test("the mover's lines, the owner's last-move line among them", () => {
    const lines = moverLines();
    expect(lines.length).toBe(26);
    const over = overBudget(SLOTS.stripStatus, lines);
    expect(over.map((o) => o.message).join('\n\n')).toBe('');
    // The line the owner saw cut: `3-1 · last move`, in every mode and for both seats.
    lines
      .filter((l) => l.input.startsWith("phase 'moving', one die left"))
      .forEach((l) => {
        expect(l.text).toMatch(/^\d-\d · last move$/u);
      });
    // The forfeited roll says the roll and that the turn passes.
    lines
      .filter((l) => l.input.startsWith('the forfeited roll'))
      .forEach((l) => {
        expect(l.text).toMatch(/^\d-\d · turn passes$/u);
      });
  });

  test("the opponent's lines with a 20-character name fit the strip too (the name clipped), and the portrait line", () => {
    const lines = namedLines();
    expect(lines.length).toBe(11);
    expect(lines.every((l) => l.text.startsWith('Konst'))).toBe(true);
    expect(lines.every((l) => l.text.includes('…'))).toBe(true);
    expect(
      overBudget(SLOTS.stripStatus, lines)
        .map((o) => o.message)
        .join('\n\n'),
    ).toBe('');
    expect(overBudget(SLOTS.portraitStatus, lines)).toEqual([]);
  });
});
