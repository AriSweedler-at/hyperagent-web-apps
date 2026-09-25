// Briscola's one sound table and its bindings (docs/design/briscola.md §5.8 "Cues";
// docs/design/briscola-sound-history.md §4, §4.1, §4.2; docs/design/sound-fonts.md §2.1, §5): every
// cue id the game ever spells, beside the vibration pattern it carries, and `phraseOf`, the pure
// binding from one engine event (`GameEvent`, the same event the history panel paints) to the
// phrase it plays on the device that sees it. The ids are qualified (web/shared/lib/sound/cues.ts):
// the base cue the default font voices, then this game's words, so a font voices as many rungs as
// it likes and `resolveCue` walks the ladder down to the base; every id of the plan's grid is a
// rung of the id emitted here, so a font written to the grid still hits. No notes live here: the
// fonts (web/shared/lib/sound/fonts/*.ts) voice each cue, src/fx.ts plays a row through the shared
// edge with the App's font, and ui/state.ts `rendered` emits one `phrases` effect per paint.
// Nothing else in the game names a sound.
//
// The trick-outcome table (§4), from the facts the engine stores on the `trick` event (`TrickData`:
// the value class of the points, the class of the card that took it, `briscola`, `steal`,
// `overtrump`, `carichiLost`, `trumpTaken`). The side that took the trick hears the winner's cell,
// every other side the loser's; pass-and-play hears the winner's (the winner leads next and holds
// the phone); partners hear the side's outcome.
//   winner  [move.briscola, when a trump took it and did not steal] + the victory leaf [+ pickup.briscola]
//     leaf  <valence>.trick.<value>                 a pip took it: score.trick.pointless,
//                                                   good.trick.small, good.trick.big, good.trick.huge
//           …<value>.figure.<fante|cavallo|re>      a figure took it (the owner: each its own sound)
//           …<value>.carico.<asso|tre>              an asso or a tre took it
//           …<value>.briscola                       a trump took it; `great.` for a huge trick
//           <good|great>.trick.briscola.steal.<value>  a trump stole a carico of the led suit
//                                                   (& voice.trick.steal); `great.` when huge
//           + .overtrump                            the trump beat another trump
//   loser   silence for a pointless or small trick (the owner's "no sound"); else bad.trick.<value>,
//           bad.trick.stolen.<value> after a steal, bad.trick.overtrumped when their own trump was
//           beaten, + .carico when an asso or tre of theirs went with the trick.
//   haptics (§4.1) one buzz per phrase, the leaf's row: tick · small · big (briscola for a trump's
//           big trick) · huge · steal; sad for a loss, stolen for a stolen one.
// A cell the arithmetic never reaches (a figure taking a pointless trick, a carico taking a small
// one, a steal below big) plays the value's plain leaf.
import {
  SHELL_CUES,
  type Buzz,
  type CueId,
  type CueSpec,
} from '../../../../shared/lib/sound/cues.ts';
import type { Phrase, Sequence, Step, Voice } from '../../../../shared/lib/sound/phrase.ts';
import type { Role } from '../../../../shared/ui/shell.ts';
import { sideOf } from '../engine/index.ts';
import type {
  EventOf,
  GameEvent,
  Played,
  Seat,
  SeatCount,
  Side,
  TrickData,
  ValueClass,
  WinningClass,
} from '../engine/index.ts';

export type { CueSpec, Phrase, Step };

// ---- the haptic patterns (§4.1) ----------------------------------------------------------------

export const BUZZ = {
  tick: 10,
  small: [20, 30, 20],
  big: [30, 40, 30, 40, 60],
  briscola: [15, 25, 15, 25, 90],
  steal: [10, 20, 10, 20, 10, 20, 140],
  huge: [50, 50, 50, 50, 120],
  sad: [180],
  stolen: [60, 40, 160],
} as const satisfies Readonly<Record<string, Buzz>>;

const row = (cue: CueId, buzz: Buzz): CueSpec => ({ cue, buzz });

// ---- the table: every id the game spells, with the buzz it carries as a phrase's leaf -----------

export const CUES = {
  // The shell's four rows (tap, yourTurn, win, lose), the same in every game (dry-round-2.md E9).
  ...SHELL_CUES,
  // The deal (§4.2), a card laid (mine, theirs), a draw from the stock, the trump card taken off
  // the table at the last draw, the trump's sting before a trump's victory.
  'start.deal': row('start.deal', [30, 40, 30]),
  'move.play': row('move.play', 15),
  'move.opp': row('move.opp', 15),
  'draw.stock': row('draw.stock', 12),
  'pickup.briscola': row('pickup.briscola', [20, 30, 60]),
  'move.briscola': row('move.briscola', BUZZ.briscola),
  // The winner's leaves, by value class (§4): pointless, the smallest sound in the game.
  'score.trick.pointless': row('score.trick.pointless', BUZZ.tick),
  'score.trick.pointless.briscola': row('score.trick.pointless.briscola', BUZZ.tick),
  'score.trick.pointless.briscola.overtrump': row(
    'score.trick.pointless.briscola.overtrump',
    BUZZ.tick,
  ),
  // Small (1–9).
  'good.trick.small': row('good.trick.small', BUZZ.small),
  'good.trick.small.figure.fante': row('good.trick.small.figure.fante', BUZZ.small),
  'good.trick.small.figure.cavallo': row('good.trick.small.figure.cavallo', BUZZ.small),
  'good.trick.small.figure.re': row('good.trick.small.figure.re', BUZZ.small),
  'good.trick.small.briscola': row('good.trick.small.briscola', BUZZ.small),
  'good.trick.small.briscola.overtrump': row('good.trick.small.briscola.overtrump', BUZZ.small),
  // Big (10–19): the trump's win buzzes as the trump, a steal as a steal.
  'good.trick.big': row('good.trick.big', BUZZ.big),
  'good.trick.big.figure.fante': row('good.trick.big.figure.fante', BUZZ.big),
  'good.trick.big.figure.cavallo': row('good.trick.big.figure.cavallo', BUZZ.big),
  'good.trick.big.figure.re': row('good.trick.big.figure.re', BUZZ.big),
  'good.trick.big.carico.asso': row('good.trick.big.carico.asso', BUZZ.big),
  'good.trick.big.carico.tre': row('good.trick.big.carico.tre', BUZZ.big),
  'good.trick.big.briscola': row('good.trick.big.briscola', BUZZ.briscola),
  'good.trick.big.briscola.overtrump': row('good.trick.big.briscola.overtrump', BUZZ.briscola),
  'good.trick.briscola.steal.big': row('good.trick.briscola.steal.big', BUZZ.steal),
  'good.trick.briscola.steal.big.overtrump': row(
    'good.trick.briscola.steal.big.overtrump',
    BUZZ.steal,
  ),
  // Huge (20+): two carichi in one trick; `great` when a trump took it.
  'good.trick.huge': row('good.trick.huge', BUZZ.huge),
  'good.trick.huge.figure.fante': row('good.trick.huge.figure.fante', BUZZ.huge),
  'good.trick.huge.figure.cavallo': row('good.trick.huge.figure.cavallo', BUZZ.huge),
  'good.trick.huge.figure.re': row('good.trick.huge.figure.re', BUZZ.huge),
  'good.trick.huge.carico.asso': row('good.trick.huge.carico.asso', BUZZ.huge),
  'good.trick.huge.carico.tre': row('good.trick.huge.carico.tre', BUZZ.huge),
  'great.trick.huge.briscola': row('great.trick.huge.briscola', BUZZ.huge),
  'great.trick.huge.briscola.overtrump': row('great.trick.huge.briscola.overtrump', BUZZ.huge),
  'great.trick.briscola.steal.huge': row('great.trick.briscola.steal.huge', BUZZ.steal),
  'great.trick.briscola.steal.huge.overtrump': row(
    'great.trick.briscola.steal.huge.overtrump',
    BUZZ.steal,
  ),
  // The loser's leaves: a big or huge trick lost, stolen, or lost with their own trump beaten;
  // `.carico` when an asso or tre of theirs went with it.
  'bad.trick.big': row('bad.trick.big', BUZZ.sad),
  'bad.trick.big.carico': row('bad.trick.big.carico', BUZZ.sad),
  'bad.trick.huge': row('bad.trick.huge', BUZZ.sad),
  'bad.trick.huge.carico': row('bad.trick.huge.carico', BUZZ.sad),
  'bad.trick.overtrumped': row('bad.trick.overtrumped', BUZZ.sad),
  'bad.trick.overtrumped.carico': row('bad.trick.overtrumped.carico', BUZZ.sad),
  'bad.trick.stolen.big': row('bad.trick.stolen.big', BUZZ.stolen),
  'bad.trick.stolen.big.carico': row('bad.trick.stolen.big.carico', BUZZ.stolen),
  'bad.trick.stolen.huge': row('bad.trick.stolen.huge', BUZZ.stolen),
  'bad.trick.stolen.huge.carico': row('bad.trick.stolen.huge.carico', BUZZ.stolen),
  // The exchange, the game's and the match's ends (the match's win is `victory.match` THEN
  // `great`), a refused tap.
  'neutral.exchange': row('neutral.exchange', [25, 25]),
  'victory.game': row('victory.game', [60, 40, 60]),
  'loss.game': row('loss.game', BUZZ.sad),
  'neutral.game.draw': row('neutral.game.draw', [40, 40, 40]),
  'victory.match': row('victory.match', [80, 50, 80, 50, 200]),
  great: row('great', BUZZ.huge),
  'loss.match': row('loss.match', [200]),
  'bad.refused': row('bad.refused', [40]),
} as const satisfies Readonly<Record<string, CueSpec>>;

/** The events of the table: every row but the tap (the shell's `Cue<G>` adds `tap` and `yourTurn`). */
export type Cue = Exclude<keyof typeof CUES, 'tap'>;
/** A row's id: the qualified cue it spells, the same text as its key. */
export type CueName = keyof typeof CUES;

/** The announcer lines (§4, §4.2) a font may voice over a phrase; the default font leaves them silent. */
export const VOICES = {
  deal: { cue: 'voice.game.deal', atMs: 0 },
  steal: { cue: 'voice.trick.steal', atMs: 0 },
  huge: { cue: 'voice.trick.huge', atMs: 0 },
  gameWin: { cue: 'voice.game.win', atMs: 0 },
  matchWin: { cue: 'voice.match.win', atMs: 0 },
} as const satisfies Readonly<Record<string, Voice>>;

/**
 * The cue machine's memory (ui/state.ts `rendered`): the view the last cues were played for, keyed
 * on the last event's id (and the game it belongs to), so a re-sent frame plays nothing. Here
 * rather than in state.ts because the shell config starts the shell with it.
 */
export type CueState = Readonly<{ key: string | null }>;
export const INITIAL_CUES: CueState = { key: null };

/** The device's seat and side (`View.me`), null before a view; pass-and-play hears the winner's side (§4 "who hears what"). */
export type Listener = Readonly<{ idx: Seat; side: Side }>;

// ---- phrases from rows -------------------------------------------------------------------------

/** A row as a step: its cue id (the key, except the shell's `yourTurn`, `win` and `lose`). */
const step = (name: CueName): Step => ({ cue: CUES[name].cue });

/** A phrase whose buzz is its leaf's row: `before` the leaf and `after` it, and the voices over it. */
const phrase = (
  leaf: CueName,
  parts: Readonly<{
    before?: ReadonlyArray<CueName>;
    after?: ReadonlyArray<CueName>;
    voices?: ReadonlyArray<Voice>;
  }> = {},
): Sequence => ({
  steps: [...(parts.before ?? []).map(step), step(leaf), ...(parts.after ?? []).map(step)],
  ...(parts.voices === undefined || parts.voices.length === 0 ? {} : { voices: parts.voices }),
  buzz: CUES[leaf].buzz,
});

// ---- the trick (§4) ----------------------------------------------------------------------------

const isCueName = (id: string): id is CueName => Object.hasOwn(CUES, id);

/** The row `id` names when the table has it, else the value's plain leaf (an unreachable cell). */
const known = (id: string, fallback: CueName): CueName => (isCueName(id) ? id : fallback);

/** The card's words after the value: nothing for a pip, the figure's or the carico's name. */
const CARD_WORDS: Readonly<Record<WinningClass, string>> = {
  pip: '',
  fante: '.figure.fante',
  cavallo: '.figure.cavallo',
  re: '.figure.re',
  asso: '.carico.asso',
  tre: '.carico.tre',
};

const PLAIN_LEAF: Readonly<Record<ValueClass, CueName>> = {
  pointless: 'score.trick.pointless',
  small: 'good.trick.small',
  big: 'good.trick.big',
  huge: 'good.trick.huge',
};

const overtrumpWord = (t: TrickData): string => (t.overtrump ? '.overtrump' : '');

/** The winner's leaf (§4, the winner's column of each cell): a steal, a trump's victory or a plain one by the card. */
export const victoryLeaf = (t: TrickData): CueName => {
  const v = t.valueClass;
  const plain = PLAIN_LEAF[v];
  if (t.steal) {
    const valence = v === 'huge' ? 'great' : 'good';
    return known(`${valence}.trick.briscola.steal.${v}${overtrumpWord(t)}`, plain);
  }
  if (t.briscola) {
    const valence = v === 'pointless' ? 'score' : v === 'huge' ? 'great' : 'good';
    return known(`${valence}.trick.${v}.briscola${overtrumpWord(t)}`, plain);
  }
  return known(`${plain}${CARD_WORDS[t.winningClass]}`, plain);
};

/** A complete trick is one card per seat, so the table's size is its length. */
const seatCountOf = (cards: ReadonlyArray<Played>): SeatCount =>
  cards.length === 3 ? 3 : cards.length === 4 ? 4 : 2;

/** The listener's side's plays in the trick (their own at two and three players, the partner's too at four). */
const sidePlays = (t: TrickData, me: Listener): ReadonlyArray<Played> => {
  const n = seatCountOf(t.cards);
  return t.cards.filter((p) => sideOf(n, p.seat) === me.side);
};

/** An asso or tre of the listener's side went with the trick (§4 "carico lost"). */
const lostCarico = (t: TrickData, me: Listener): boolean =>
  sidePlays(t, me).some((p) => t.carichiLost.includes(p.seat));

/** The listener's side played a trump the winning trump beat (§4 "their briscola was beaten"). */
const overtrumped = (t: TrickData, me: Listener): boolean =>
  t.overtrump && sidePlays(t, me).some((p) => p.card.s === t.winningCard.s);

/** The loser's leaf (§4, the loser's column), or null: a pointless or small trick lost is silence. */
export const lossLeaf = (t: TrickData, me: Listener | null): CueName | null => {
  const v = t.valueClass;
  if (v === 'pointless' || v === 'small') return null;
  const plain: CueName = v === 'big' ? 'bad.trick.big' : 'bad.trick.huge';
  const leaf = t.steal
    ? `bad.trick.stolen.${v}`
    : me !== null && overtrumped(t, me)
      ? 'bad.trick.overtrumped'
      : plain;
  return known(`${leaf}${me !== null && lostCarico(t, me) ? '.carico' : ''}`, plain);
};

/** Pass-and-play hears the winner's side; online, the device's side against the winner's. */
const heardAsWinner = (winnerSide: Side, me: Listener | null, role: Role | null): boolean =>
  role === 'local' || me?.side === winnerSide;

/** `pickup.briscola` after the trick's phrase for the seat that took the trump card off the table; the shared phone hears it for whoever did. */
const pickupSteps = (
  t: TrickData,
  me: Listener | null,
  role: Role | null,
): ReadonlyArray<CueName> =>
  t.trumpTaken !== null && (role === 'local' || t.trumpTaken === me?.idx)
    ? ['pickup.briscola']
    : [];

const trickPhrase = (t: TrickData, me: Listener | null, role: Role | null): Phrase | null => {
  const after = pickupSteps(t, me, role);
  if (heardAsWinner(t.winnerSide, me, role)) {
    const voices = t.steal ? [VOICES.steal] : t.valueClass === 'huge' ? [VOICES.huge] : [];
    return phrase(victoryLeaf(t), {
      before: t.briscola && !t.steal ? ['move.briscola'] : [],
      after,
      voices,
    });
  }
  const leaf = lossLeaf(t, me);
  if (leaf !== null) return phrase(leaf, { after });
  const [pickup] = after;
  return pickup === undefined ? null : phrase(pickup);
};

// ---- the other events (§4.2) -------------------------------------------------------------------

const resultPhrase = (e: EventOf<'result'>, me: Listener | null, role: Role | null): Phrase => {
  if (e.data.winner === null) return phrase('neutral.game.draw');
  const won = heardAsWinner(e.data.winner, me, role);
  if (e.data.decided)
    return won
      ? phrase('victory.match', { after: ['great'], voices: [VOICES.matchWin] })
      : phrase('loss.match');
  return won ? phrase('victory.game', { voices: [VOICES.gameWin] }) : phrase('loss.game');
};

/**
 * The phrase one event plays on this device, or null for silence: the deal chimes, a trick plays
 * the winner's or the loser's cell (pass-and-play plays the winner's: the winner leads next and
 * holds the phone), an exchange a plain notice, a result the win, the loss or the draw (the match's
 * win is `victory.match` THEN `great`), and a game's opening nothing (its deal follows). Pure;
 * ui/state.ts `rendered` gathers one paint's phrases into one `phrases` effect.
 */
export const phraseOf = (
  event: GameEvent,
  me: Listener | null,
  role: Role | null,
): Phrase | null => {
  switch (event.kind) {
    case 'game':
      return null;
    case 'deal':
      return phrase('start.deal', { voices: [VOICES.deal] });
    case 'trick':
      return trickPhrase(event.data, me, role);
    case 'exchange':
      return phrase('neutral.exchange');
    case 'result':
      return resultPhrase(event, me, role);
  }
};
