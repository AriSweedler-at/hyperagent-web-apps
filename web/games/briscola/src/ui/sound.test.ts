// The trick-outcome table (docs/design/briscola-sound-history.md §4, §4.1, §4.2), cell by cell:
// the cartesian product of value class × winning card × briscola × steal × overtrump, pruned to
// what the arithmetic can reach, each cell heard as the winner, as a loser and on the shared phone,
// asserting the exact step ids in order, the voices and the buzz; the plan's own pointers
// (transcribed below) must sit on the ladder of every id emitted, so a font written to the plan
// still hits. Then the other events, the ids' ladders in the default font, and the table's hygiene.
import { describe, expect, test } from 'vitest';

import { SHELL_CUES, baseOf, isCueId, ladder } from '../../../../shared/lib/sound/cues.ts';
import { fontByName, resolveCue } from '../../../../shared/lib/sound/fonts.ts';
import { DEFAULT_SOUNDS } from '../../../../shared/lib/sound/fonts/default.ts';
import { schedule, sequenceOf, type Phrase } from '../../../../shared/lib/sound/phrase.ts';
import { makeCard } from '../engine/index.ts';
import type {
  EventOf,
  GameEvent,
  Played,
  Rank,
  Seat,
  Side,
  Suit,
  TrickData,
  ValueClass,
  WinningClass,
} from '../engine/index.ts';
import { BUZZ, CUES, VOICES, lossLeaf, phraseOf, victoryLeaf, type Listener } from './sound.ts';

// ---- the cells -------------------------------------------------------------------------------

const VALUES: ReadonlyArray<ValueClass> = ['pointless', 'small', 'big', 'huge'];
const CLASSES: ReadonlyArray<WinningClass> = ['pip', 'fante', 'cavallo', 're', 'asso', 'tre'];
const BOOLS: ReadonlyArray<boolean> = [false, true];

type Cell = Readonly<{
  value: ValueClass;
  cls: WinningClass;
  briscola: boolean;
  steal: boolean;
  overtrump: boolean;
}>;

/**
 * What the engine can produce (cards.ts `trickFacts`): a steal or an overtrump needs a trump to
 * have won; a figure or a carico scores, so it never takes a pointless trick; a carico is ten or
 * more, so it never takes a small one; the stolen card is a carico, so a steal is big at least.
 */
const reachable = (c: Cell): boolean =>
  (!c.steal || c.briscola) &&
  (!c.overtrump || c.briscola) &&
  !(c.value === 'pointless' && c.cls !== 'pip') &&
  !(c.value === 'small' && (c.cls === 'asso' || c.cls === 'tre')) &&
  !(c.steal && (c.value === 'pointless' || c.value === 'small'));

const CELLS: ReadonlyArray<Cell> = VALUES.flatMap((value) =>
  CLASSES.flatMap((cls) =>
    BOOLS.flatMap((briscola) =>
      BOOLS.flatMap((steal) =>
        BOOLS.map((overtrump) => ({ value, cls, briscola, steal, overtrump })),
      ),
    ),
  ),
).filter(reachable);

const cellName = (c: Cell): string =>
  `${c.value} ${c.cls}${c.briscola ? ' briscola' : ''}${c.steal ? ' steal' : ''}${c.overtrump ? ' overtrump' : ''}`;

// ---- a trick from a cell -----------------------------------------------------------------------

const TRUMP: Suit = 'B';
const LED: Suit = 'C';
const RANK_OF: Readonly<Record<WinningClass, Rank>> = {
  pip: 7,
  fante: 8,
  cavallo: 9,
  re: 10,
  asso: 1,
  tre: 3,
};
const POINTS_OF: Readonly<Record<ValueClass, number>> = {
  pointless: 0,
  small: 4,
  big: 14,
  huge: 21,
};

const play = (seat: Seat, r: Rank, s: Suit): Played => ({ seat, card: makeCard(r, s) });

/**
 * Seat 0 takes the trick with the cell's card. Seat 1 answers with a low card of the led suit, or
 * the asso of it when stolen, or a low trump when overtrumped; a stolen AND overtrumped trick
 * needs a third seat for the beaten trump.
 */
const trickOf = (c: Cell, extra: Partial<TrickData> = {}): TrickData => {
  const winning = play(0, RANK_OF[c.cls], c.briscola ? TRUMP : LED);
  const second = c.steal ? play(1, 1, LED) : c.overtrump ? play(1, 2, TRUMP) : play(1, 4, LED);
  const third = c.steal && c.overtrump ? [play(2, 2, TRUMP)] : [];
  return {
    no: 1,
    leader: 0,
    cards: [winning, second, ...third],
    winner: 0,
    winnerSide: 0,
    points: POINTS_OF[c.value],
    valueClass: c.value,
    winningCard: winning.card,
    winningClass: c.cls,
    briscola: c.briscola,
    steal: c.steal,
    overtrump: c.overtrump,
    carichiLost: c.steal ? [1] : [],
    drew: [0, 1],
    trumpTaken: null,
    ...extra,
  };
};

const trickEvent = (data: TrickData): EventOf<'trick'> => ({
  id: 3,
  kind: 'trick',
  seat: data.winner,
  at: 1000,
  data,
});

const WINNER: Listener = { idx: 0, side: 0 };
const LOSER: Listener = { idx: 1, side: 1 };
const seat = (idx: Seat, side: Side): Listener => ({ idx, side });

// ---- §4 transcribed: the winner's (W) and the loser's (L) pointer per value class × column ----

type Column = 'pip' | 'figure' | 'carico' | 'briscola' | 'steal';
type PlanCell = Readonly<{ W: ReadonlyArray<string>; L: string | null }>;
const W = (...ids: ReadonlyArray<string>): ReadonlyArray<string> => ids;

/** The grid of §4, id for id (`+` a step boundary, `—` silence); an impossible cell is absent. */
const PLAN: Readonly<Record<ValueClass, Readonly<Partial<Record<Column, PlanCell>>>>> = {
  pointless: {
    pip: { W: W('score.trick.pointless'), L: null },
    figure: { W: W('score.trick.pointless'), L: null },
    briscola: { W: W('move.briscola', 'score.trick.pointless'), L: null },
  },
  small: {
    pip: { W: W('good.trick.small'), L: null },
    figure: { W: W('good.trick.small.figure'), L: null },
    carico: { W: W('good.trick.small.carico'), L: null },
    briscola: { W: W('move.briscola', 'good.trick.small'), L: null },
    steal: { W: W('good.trick.briscola.steal.small'), L: 'bad.trick.stolen.small' },
  },
  big: {
    pip: { W: W('good.trick.big'), L: 'bad.trick.big' },
    figure: { W: W('good.trick.big.figure'), L: 'bad.trick.big' },
    carico: { W: W('good.trick.big.carico'), L: 'bad.trick.big' },
    briscola: { W: W('move.briscola', 'good.trick.big'), L: 'bad.trick.big' },
    steal: { W: W('good.trick.briscola.steal.big'), L: 'bad.trick.stolen.big' },
  },
  huge: {
    pip: { W: W('good.trick.huge'), L: 'bad.trick.huge' },
    figure: { W: W('good.trick.huge.figure'), L: 'bad.trick.huge' },
    carico: { W: W('good.trick.huge.carico'), L: 'bad.trick.huge' },
    briscola: { W: W('move.briscola', 'great.trick.huge'), L: 'bad.trick.huge' },
    steal: { W: W('great.trick.briscola.steal.huge'), L: 'bad.trick.stolen.huge' },
  },
};

const columnOf = (c: Cell): Column =>
  c.steal
    ? 'steal'
    : c.briscola
      ? 'briscola'
      : c.cls === 'pip'
        ? 'pip'
        : c.cls === 'asso' || c.cls === 'tre'
          ? 'carico'
          : 'figure';

const planCell = (c: Cell): PlanCell => {
  const cell = PLAN[c.value][columnOf(c)];
  if (cell === undefined) throw new Error(`no plan cell for ${cellName(c)}`);
  return cell;
};

// ---- the expected phrases, spelled from the plan's words a second time ------------------------

const CARD_WORDS: Readonly<Record<WinningClass, string>> = {
  pip: '',
  fante: '.figure.fante',
  cavallo: '.figure.cavallo',
  re: '.figure.re',
  asso: '.carico.asso',
  tre: '.carico.tre',
};
const VALENCE: Readonly<Record<ValueClass, string>> = {
  pointless: 'score',
  small: 'good',
  big: 'good',
  huge: 'good',
};
const VALUE_BUZZ = { pointless: BUZZ.tick, small: BUZZ.small, big: BUZZ.big, huge: BUZZ.huge };

const expectedWinner = (c: Cell): Phrase => {
  const over = c.overtrump ? '.overtrump' : '';
  const great = c.value === 'huge' ? 'great' : 'good';
  const leaf = c.steal
    ? `${great}.trick.briscola.steal.${c.value}${over}`
    : c.briscola
      ? `${c.value === 'huge' ? 'great' : VALENCE[c.value]}.trick.${c.value}.briscola${over}`
      : `${VALENCE[c.value]}.trick.${c.value}${CARD_WORDS[c.cls]}`;
  const voices = c.steal ? [VOICES.steal] : c.value === 'huge' ? [VOICES.huge] : [];
  return {
    steps: [...(c.briscola && !c.steal ? [{ cue: 'move.briscola' as const }] : []), { cue: leaf }],
    ...(voices.length === 0 ? {} : { voices }),
    buzz: c.steal
      ? BUZZ.steal
      : c.briscola && c.value === 'big'
        ? BUZZ.briscola
        : VALUE_BUZZ[c.value],
  } as Phrase;
};

/** Seat 1's loss: silence below big; stolen (their asso went with it), overtrumped (their trump was beaten) or plain. */
const expectedLoser = (c: Cell): Phrase | null => {
  if (c.value === 'pointless' || c.value === 'small') return null;
  const leaf = c.steal
    ? `bad.trick.stolen.${c.value}.carico`
    : c.overtrump
      ? 'bad.trick.overtrumped'
      : `bad.trick.${c.value}`;
  return { steps: [{ cue: leaf }], buzz: c.steal ? BUZZ.stolen : BUZZ.sad } as Phrase;
};

const stepIds = (phrase: Phrase | null): ReadonlyArray<string> =>
  phrase === null ? [] : sequenceOf(phrase).steps.map((s) => s.cue);

// ---- the cell test -----------------------------------------------------------------------------

describe('the reachable cells of §4', () => {
  test('are 75: 17 plain, 17 by a trump, 17 by a trump over a trump, 12 steals, 12 steals over a trump', () => {
    expect(CELLS).toHaveLength(75);
    const count = (f: (c: Cell) => boolean): number => CELLS.filter(f).length;
    expect(count((c) => !c.briscola)).toBe(17);
    expect(count((c) => c.briscola && !c.steal && !c.overtrump)).toBe(17);
    expect(count((c) => c.briscola && !c.steal && c.overtrump)).toBe(17);
    expect(count((c) => c.steal && !c.overtrump)).toBe(12);
    expect(count((c) => c.steal && c.overtrump)).toBe(12);
  });
});

describe.each(CELLS.map((c) => [cellName(c), c] as const))('%s', (_name, cell) => {
  const t = trickOf(cell);
  const e = trickEvent(t);
  const winner = expectedWinner(cell);
  const loser = expectedLoser(cell);
  const plan = planCell(cell);

  test('the winner hears the cell: the exact steps in order, the voices and the buzz', () => {
    expect(phraseOf(e, WINNER, 'host')).toEqual(winner);
    expect(phraseOf(e, WINNER, 'guest')).toEqual(winner);
    expect(victoryLeaf(t)).toBe(stepIds(winner).at(-1));
  });

  test('a loser hears the loss, or silence below big', () => {
    expect(phraseOf(e, LOSER, 'host')).toEqual(loser);
    expect(phraseOf(e, LOSER, 'guest')).toEqual(loser);
    expect(lossLeaf(t, LOSER)).toBe(loser === null ? null : stepIds(loser)[0]);
  });

  test("pass-and-play plays the winner's phrase, whoever holds the phone", () => {
    expect(phraseOf(e, LOSER, 'local')).toEqual(winner);
    expect(phraseOf(e, WINNER, 'local')).toEqual(winner);
  });

  test("the plan's pointers are rungs of the ids emitted", () => {
    const steps = stepIds(winner);
    expect(steps).toHaveLength(plan.W.length);
    plan.W.forEach((id, i) => {
      expect(ladder(steps[i] ?? '')).toContain(id);
    });
    // The extra cell of §4: seat 1's trump was beaten, so the loss pointer is `bad.trick.overtrumped`.
    const planLoss =
      cell.overtrump && !cell.steal && plan.L !== null ? 'bad.trick.overtrumped' : plan.L;
    if (planLoss === null) expect(loser).toBeNull();
    else expect(ladder(stepIds(loser)[0] ?? '')).toContain(planLoss);
  });

  test('every id is a row of the table and buzzes as its leaf', () => {
    [...stepIds(winner), ...stepIds(loser)].forEach((id) => {
      expect(isCueId(id)).toBe(true);
      expect(Object.keys(CUES)).toContain(id);
    });
    const leaf = stepIds(winner).at(-1) ?? '';
    expect(sequenceOf(winner).buzz).toEqual(CUES[leaf as keyof typeof CUES].buzz);
  });

  if (cell.briscola && !cell.steal) {
    test('briscola THEN victory: two steps, the sting first, the default font schedules the second after it', () => {
      const steps = stepIds(winner);
      expect(steps[0]).toBe('move.briscola');
      expect(steps).toHaveLength(2);
      const slots = schedule(fontByName('default'), winner);
      expect(slots).toHaveLength(2);
      expect(slots[1]?.atMs).toBe(slots[0]?.ms);
      expect(slots[1]?.atMs).toBeGreaterThan(0);
    });
  }

  if (cell.steal) {
    test('a steal carries voice.trick.steal and the steal buzz; the victim hears stolen', () => {
      expect(sequenceOf(winner).voices).toEqual([{ cue: 'voice.trick.steal', atMs: 0 }]);
      expect(sequenceOf(winner).buzz).toEqual(BUZZ.steal);
      expect(stepIds(winner)[0]).toMatch(/\.trick\.briscola\.steal\./);
      expect(stepIds(loser)[0]).toMatch(/^bad\.trick\.stolen\./);
      expect(sequenceOf(loser ?? winner).buzz).toEqual(BUZZ.stolen);
    });
  }

  if (cell.overtrump) {
    test("overtrump appends .overtrump to the winner's leaf", () => {
      expect(stepIds(winner).at(-1)).toMatch(/\.overtrump$/);
      const without = phraseOf(trickEvent(trickOf({ ...cell, overtrump: false })), WINNER, 'host');
      expect(`${stepIds(without).at(-1) ?? ''}.overtrump`).toBe(stepIds(winner).at(-1));
    });
  }

  test('trumpTaken appends pickup.briscola as a step for the seat that took it', () => {
    const taken = trickEvent(trickOf(cell, { trumpTaken: 0 }));
    expect(stepIds(phraseOf(taken, WINNER, 'host'))).toEqual([
      ...stepIds(winner),
      'pickup.briscola',
    ]);
    // Another seat took it: nothing appended for me online; the shared phone hears it.
    expect(phraseOf(taken, LOSER, 'host')).toEqual(loser);
    expect(stepIds(phraseOf(taken, LOSER, 'local'))).toEqual([
      ...stepIds(winner),
      'pickup.briscola',
    ]);
    // The loser took it: after their loss, or alone (with its own buzz) when the loss is silent.
    const byLoser = phraseOf(trickEvent(trickOf(cell, { trumpTaken: 1 })), LOSER, 'host');
    expect(stepIds(byLoser)).toEqual([...stepIds(loser), 'pickup.briscola']);
    expect(sequenceOf(byLoser ?? winner).buzz).toEqual(
      loser === null ? CUES['pickup.briscola'].buzz : sequenceOf(loser).buzz,
    );
  });
});

// ---- beyond the grid: carichi, partners, the plan's own examples --------------------------------

describe('carico lost, partners and the examples of §4', () => {
  const bigPip: Cell = {
    value: 'big',
    cls: 'pip',
    briscola: false,
    steal: false,
    overtrump: false,
  };

  test('a loser whose asso or tre went with a big trick hears .carico; a bystander at three does not', () => {
    const t = trickOf(bigPip, {
      cards: [play(0, 7, LED), play(1, 1, 'D'), play(2, 4, LED)],
      carichiLost: [1],
    });
    expect(phraseOf(trickEvent(t), LOSER, 'host')).toEqual({
      steps: [{ cue: 'bad.trick.big.carico' }],
      buzz: BUZZ.sad,
    });
    expect(phraseOf(trickEvent(t), seat(2, 2), 'host')).toEqual({
      steps: [{ cue: 'bad.trick.big' }],
      buzz: BUZZ.sad,
    });
  });

  test("at four players partners hear the side's outcome: the winner's partner the win, the victim's partner the carico", () => {
    const t = trickOf(bigPip, {
      cards: [play(0, 7, LED), play(1, 1, 'D'), play(2, 4, LED), play(3, 5, LED)],
      carichiLost: [1],
      drew: [0, 1, 2, 3],
    });
    expect(phraseOf(trickEvent(t), seat(2, 0), 'host')).toEqual(expectedWinner(bigPip));
    expect(stepIds(phraseOf(trickEvent(t), seat(3, 1), 'host'))).toEqual(['bad.trick.big.carico']);
    expect(stepIds(phraseOf(trickEvent(t), seat(1, 1), 'host'))).toEqual(['bad.trick.big.carico']);
  });

  test('overtrumped is the loser whose own trump was beaten; a loser who played no trump hears the plain loss', () => {
    const cell: Cell = { ...bigPip, briscola: true, overtrump: true };
    const t = trickOf(cell, { cards: [play(0, 7, TRUMP), play(1, 2, TRUMP), play(2, 4, LED)] });
    expect(stepIds(phraseOf(trickEvent(t), LOSER, 'host'))).toEqual(['bad.trick.overtrumped']);
    expect(stepIds(phraseOf(trickEvent(t), seat(2, 2), 'host'))).toEqual(['bad.trick.big']);
  });

  test("the plan's examples, id for id", () => {
    const e = (c: Cell): EventOf<'trick'> => trickEvent(trickOf(c));
    // A trump takes a big trick: the briscola sting THEN the victory, the trump's buzz.
    expect(phraseOf(e({ ...bigPip, briscola: true }), WINNER, 'host')).toEqual({
      steps: [{ cue: 'move.briscola' }, { cue: 'good.trick.big.briscola' }],
      buzz: BUZZ.briscola,
    });
    // …over another trump: `good.trick.big.briscola.overtrump` (the plan's own example).
    expect(
      stepIds(phraseOf(e({ ...bigPip, briscola: true, overtrump: true }), WINNER, 'host')),
    ).toEqual(['move.briscola', 'good.trick.big.briscola.overtrump']);
    // A trump steals a big card: one step, the announcer over it, the steal buzz.
    expect(phraseOf(e({ ...bigPip, briscola: true, steal: true }), WINNER, 'host')).toEqual({
      steps: [{ cue: 'good.trick.briscola.steal.big' }],
      voices: [{ cue: 'voice.trick.steal', atMs: 0 }],
      buzz: BUZZ.steal,
    });
    // The asso and the tre each their own sound (the owner's words), the figures too.
    expect(victoryLeaf(trickOf({ ...bigPip, cls: 'asso' }))).toBe('good.trick.big.carico.asso');
    expect(victoryLeaf(trickOf({ ...bigPip, cls: 'tre' }))).toBe('good.trick.big.carico.tre');
    expect(victoryLeaf(trickOf({ ...bigPip, cls: 're' }))).toBe('good.trick.big.figure.re');
    expect(victoryLeaf(trickOf({ ...bigPip, value: 'small', cls: 'fante' }))).toBe(
      'good.trick.small.figure.fante',
    );
    // The leader's own pip winning a pointless trick: the smallest sound in the game, a tick.
    expect(phraseOf(e({ ...bigPip, value: 'pointless' }), WINNER, 'host')).toEqual({
      steps: [{ cue: 'score.trick.pointless' }],
      buzz: BUZZ.tick,
    });
    // Losing small or pointless: silence, even with the trump taken by someone else.
    expect(phraseOf(e({ ...bigPip, value: 'small' }), LOSER, 'host')).toBeNull();
    expect(phraseOf(e({ ...bigPip, value: 'pointless' }), LOSER, 'guest')).toBeNull();
  });

  test('an unreachable cell plays the value`s plain leaf', () => {
    expect(victoryLeaf(trickOf({ ...bigPip, value: 'small', cls: 'asso' }))).toBe(
      'good.trick.small',
    );
    expect(victoryLeaf(trickOf({ ...bigPip, value: 'pointless', cls: 're' }))).toBe(
      'score.trick.pointless',
    );
    expect(victoryLeaf(trickOf({ ...bigPip, value: 'small', briscola: true, steal: true }))).toBe(
      'good.trick.small',
    );
  });
});

// ---- the other events (§4.2) -------------------------------------------------------------------

const event = <K extends GameEvent['kind']>(
  kind: K,
  data: EventOf<K>['data'],
  seatNo: Seat | null = null,
): GameEvent => ({ id: 1, kind, seat: seatNo, at: 500, data }) as GameEvent;

const result = (winner: Side | null, decided: boolean): GameEvent =>
  event('result', { winner, totals: [70, 50], draw: winner === null, decided, wins: [1, 0] });

describe('the other events', () => {
  test('a game`s opening is silent; its deal chimes with the announcer`s line over it', () => {
    expect(phraseOf(event('game', { gameNo: 1, dealer: 1 }), WINNER, 'host')).toBeNull();
    expect(
      phraseOf(event('deal', { dealer: 1, trumpCard: makeCard(7, 'B') }), WINNER, 'host'),
    ).toEqual({
      steps: [{ cue: 'start.deal' }],
      voices: [{ cue: 'voice.game.deal', atMs: 0 }],
      buzz: [30, 40, 30],
    });
  });

  test('an exchange is a plain notice for every device', () => {
    const e = event('exchange', { seat: 1, gave: makeCard(7, 'B'), took: makeCard(1, 'B') }, 1);
    const expected = { steps: [{ cue: 'neutral.exchange' }], buzz: [25, 25] };
    expect(phraseOf(e, WINNER, 'host')).toEqual(expected);
    expect(phraseOf(e, LOSER, 'guest')).toEqual(expected);
    expect(phraseOf(e, LOSER, 'local')).toEqual(expected);
  });

  test('a game`s result: the win with its line, the loss, the draw; pass-and-play hears the win', () => {
    expect(phraseOf(result(0, false), WINNER, 'host')).toEqual({
      steps: [{ cue: 'victory.game' }],
      voices: [{ cue: 'voice.game.win', atMs: 0 }],
      buzz: [60, 40, 60],
    });
    expect(phraseOf(result(0, false), LOSER, 'guest')).toEqual({
      steps: [{ cue: 'loss.game' }],
      buzz: BUZZ.sad,
    });
    expect(phraseOf(result(0, false), LOSER, 'local')).toEqual(
      phraseOf(result(0, false), WINNER, 'host'),
    );
    const draw = { steps: [{ cue: 'neutral.game.draw' }], buzz: [40, 40, 40] };
    expect(phraseOf(result(null, false), WINNER, 'host')).toEqual(draw);
    expect(phraseOf(result(null, false), LOSER, 'guest')).toEqual(draw);
  });

  test('the match decided: victory.match THEN great with the announcer, or loss.match', () => {
    expect(phraseOf(result(1, true), LOSER, 'guest')).toEqual({
      steps: [{ cue: 'victory.match' }, { cue: 'great' }],
      voices: [{ cue: 'voice.match.win', atMs: 0 }],
      buzz: SHELL_CUES.win.buzz,
    });
    expect(phraseOf(result(1, true), WINNER, 'host')).toEqual({
      steps: [{ cue: 'loss.match' }],
      buzz: [200],
    });
  });
});

// ---- the ladders in the default font, and the table's hygiene ---------------------------------

/** Every id the binding can emit: the cells (both sides, the trump taken, a carico lost), the events. */
const EMITTED: ReadonlyArray<string> = [
  ...new Set(
    CELLS.flatMap((c) => {
      const t = trickOf(c, { trumpTaken: 1 });
      const carico = trickOf(c, { carichiLost: [1] });
      const bystander = trickOf(c, {
        cards: [...trickOf(c).cards, play(2, 5, LED)],
        carichiLost: [2],
      });
      return [
        ...stepIds(phraseOf(trickEvent(bystander), LOSER, 'host')),
        ...stepIds(phraseOf(trickEvent(t), WINNER, 'host')),
        ...stepIds(phraseOf(trickEvent(t), LOSER, 'host')),
        ...stepIds(phraseOf(trickEvent(carico), LOSER, 'host')),
      ];
    }),
  ),
  'start.deal',
  'neutral.exchange',
  'victory.game',
  'loss.game',
  'neutral.game.draw',
  'victory.match',
  'great',
  'loss.match',
];

/** The rows the reducer names by `fx` (ui/state.ts): a card laid, the draw of the beat, a refused tap. */
const FX_ROWS: ReadonlyArray<string> = ['move.play', 'move.opp', 'draw.stock', 'bad.refused'];

const TRICK_BASES = ['good', 'great', 'bad', 'score', 'move', 'pickup'];

describe('the ladders and the table', () => {
  test.each(EMITTED)(
    '%s resolves in the default font to its base, one the owner asked for',
    (id) => {
      expect(isCueId(id)).toBe(true);
      if (!isCueId(id)) return;
      const base = baseOf(id);
      const { sound, ms } = resolveCue(fontByName('default'), id);
      expect(sound).toBe(DEFAULT_SOUNDS[base]);
      expect(sound.kind).toBe('synth');
      expect(ms).toBeGreaterThan(0);
      if (id.includes('.trick.') || id.endsWith('.briscola')) expect(TRICK_BASES).toContain(base);
    },
  );

  test('the two trick sounds the owner asked of a simple font are rungs of every plain small and big win', () => {
    const wins = CELLS.filter((c) => !c.steal && (c.value === 'small' || c.value === 'big'));
    wins.forEach((c) => {
      expect(ladder(victoryLeaf(trickOf(c)))).toContain(`good.trick.${c.value}`);
    });
    // A steal is its own family: `good.trick.briscola.steal` covers every steal in one row.
    CELLS.filter((c) => c.steal).forEach((c) => {
      expect(ladder(victoryLeaf(trickOf(c)))).toContain(
        `${c.value === 'huge' ? 'great' : 'good'}.trick.briscola.steal`,
      );
    });
  });

  test('every row spells its own id as its key (the shell`s three aside), and no row is dead', () => {
    const keys = Object.keys(CUES);
    keys.forEach((key) => {
      const row = CUES[key as keyof typeof CUES];
      const shellAlias = key === 'yourTurn' || key === 'win' || key === 'lose';
      expect(shellAlias ? SHELL_CUES[key].cue : key).toBe(row.cue);
      expect(isCueId(row.cue)).toBe(true);
    });
    const used = new Set([...EMITTED, ...FX_ROWS, 'tap', 'yourTurn', 'win', 'lose']);
    expect(keys.filter((k) => !used.has(k))).toEqual([]);
    EMITTED.forEach((id) => {
      expect(keys).toContain(id);
    });
  });

  test('the id inventory: 53 ids, every one a key of the table', () => {
    expect([...EMITTED, ...FX_ROWS].sort()).toEqual(INVENTORY);
    expect(
      Object.keys(CUES)
        .filter((k) => !['tap', 'yourTurn', 'win', 'lose'].includes(k))
        .sort(),
    ).toEqual(INVENTORY);
  });

  test('every voice is in the announcer namespace the default font leaves silent', () => {
    Object.values(VOICES).forEach((voice) => {
      expect(voice.cue).toMatch(/^voice\.[a-z]+\.[a-z]+$/);
      expect(voice.atMs).toBe(0);
    });
  });
});

/** Every distinct cue id the table emits, sorted: the fonts' keys to voice. */
const INVENTORY: ReadonlyArray<string> = [
  'bad.refused',
  'bad.trick.big',
  'bad.trick.big.carico',
  'bad.trick.huge',
  'bad.trick.huge.carico',
  'bad.trick.overtrumped',
  'bad.trick.overtrumped.carico',
  'bad.trick.stolen.big',
  'bad.trick.stolen.big.carico',
  'bad.trick.stolen.huge',
  'bad.trick.stolen.huge.carico',
  'draw.stock',
  'good.trick.big',
  'good.trick.big.briscola',
  'good.trick.big.briscola.overtrump',
  'good.trick.big.carico.asso',
  'good.trick.big.carico.tre',
  'good.trick.big.figure.cavallo',
  'good.trick.big.figure.fante',
  'good.trick.big.figure.re',
  'good.trick.briscola.steal.big',
  'good.trick.briscola.steal.big.overtrump',
  'good.trick.huge',
  'good.trick.huge.carico.asso',
  'good.trick.huge.carico.tre',
  'good.trick.huge.figure.cavallo',
  'good.trick.huge.figure.fante',
  'good.trick.huge.figure.re',
  'good.trick.small',
  'good.trick.small.briscola',
  'good.trick.small.briscola.overtrump',
  'good.trick.small.figure.cavallo',
  'good.trick.small.figure.fante',
  'good.trick.small.figure.re',
  'great',
  'great.trick.briscola.steal.huge',
  'great.trick.briscola.steal.huge.overtrump',
  'great.trick.huge.briscola',
  'great.trick.huge.briscola.overtrump',
  'loss.game',
  'loss.match',
  'move.briscola',
  'move.opp',
  'move.play',
  'neutral.exchange',
  'neutral.game.draw',
  'pickup.briscola',
  'score.trick.pointless',
  'score.trick.pointless.briscola',
  'score.trick.pointless.briscola.overtrump',
  'start.deal',
  'victory.game',
  'victory.match',
];
