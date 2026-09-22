// The sandbox (docs/design/gin-sandbox.md): a pass-and-play game dealt from a map the owner
// writes, so any hand, deck order and phase goes on the table in one step, for testing how a
// hand is arranged. Hidden unless the first player is named `sandbox` (`unlocksSandbox`). Pure:
// `parseMap` reads the map text, `dealMap` turns a map into an engine `State`, `mapOf` reads one
// back out of a `State` and `formatMap` prints it (the console's `__gin.sandboxMap()`),
// `randomMap` deals one from an rng, and PRESETS are the hands that exercise every way a hand can
// be arranged. Imported by ui/state.ts, stories/catalogue.ts (the card parser) and main.ts.
//
// The map is lines of `key: value`, `#` to the end of a line a comment, keys in any case:
//   p1: AS 2S 3S 7H 7D 7C 9S 10D QH KC      the first player's hand (ten; eleven in their discard phase)
//   p2: 4S 5S 6S 8H 8D 8C 9D JD QD 2C       the second player's
//   discard: 5H                            the discard pile, bottom first, top last
//   stock: 3C 4C                           the top of the stock first; every card not named
//                                          anywhere follows in deck order (AS 2S … KC)
//   turn: p1          phase: draw          p1 or p2; upcard, draw or discard (defaults)
//   drawn: KC                              in the discard phase, the card the turn player drew
//                                          from the stock: it gets the dot
//   melds: 7H 7D 7C | AS 2S 3S             p1's hand-made melds (ui/hand/arrange.ts)
//   target: 100
// Cards are the engine's ids: A 2 … 10 J Q K (T for ten) and S H D C, in any case.
import type { Err, Result } from '../../../shared/lib/result.ts';
import { err, ok } from '../../../shared/lib/result.ts';
import type { Rng } from '../../../shared/lib/rng.ts';
import {
  DEFAULT_TARGET,
  HAND_SIZE,
  idsOf,
  makeCard,
  makeDeck,
  shuffle,
  type Card,
  type Cards,
  type Pair,
  type PendingDraw,
  type PlayerInfo,
  type Rank,
  type Seat,
  type State,
  type Suit,
} from './engine/index.ts';

/** The first player's name that shows the sandbox mode. */
export const SANDBOX_NAME = 'sandbox';
export const unlocksSandbox = (p1Name: string): boolean =>
  p1Name.trim().toLowerCase() === SANDBOX_NAME;

export type SandboxPhase = 'upcard' | 'draw' | 'discard';

/** A table position as the map spells it: both hands, the piles, whose turn, which phase. */
export type SandboxMap = Readonly<{
  hands: Pair<Cards>;
  /** Bottom first, top last, as the engine keeps it. */
  discard: Cards;
  /** Top first: the next card drawn (the engine keeps its top last). */
  stock: Cards;
  turn: Seat;
  phase: SandboxPhase;
  /** The card the turn player drew from the stock this turn (`discard` phase): the fresh dot. */
  drawn: Card | null;
  /** The first player's hand-made melds. */
  melds: ReadonlyArray<Cards>;
  target: number;
}>;

// ---- cards ---------------------------------------------------------------------------------------

const RANK_OF: Readonly<Record<string, Rank>> = {
  A: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 7,
  8: 8,
  9: 9,
  10: 10,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
};
const isSuit = (s: string): s is Suit => s === 'S' || s === 'H' || s === 'D' || s === 'C';

/** The card an id names (`AS`, `10h`, `qd`, `Td`), or null. */
export const cardOfId = (id: string): Card | null => {
  const text = id.trim().toUpperCase();
  const suit = text.slice(-1);
  const rank = RANK_OF[text.slice(0, -1)];
  return isSuit(suit) && rank !== undefined ? makeCard(rank, suit) : null;
};

const words = (text: string): ReadonlyArray<string> => text.split(/\s+/).filter((w) => w !== '');

/** The cards a space-separated list names; throws on a bad id (for fixtures spelled by hand). */
export const cardsOfText = (text: string): Cards =>
  words(text).map((id) => {
    const card = cardOfId(id);
    if (card === null) throw new Error(`bad card id ${id}`);
    return card;
  });

const has = (cards: Cards, id: string): boolean => cards.some((c) => c.id === id);
const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

// ---- the map text --------------------------------------------------------------------------------

const KEYS = ['p1', 'p2', 'discard', 'stock', 'turn', 'phase', 'drawn', 'melds', 'target'] as const;
type Key = (typeof KEYS)[number];
const isKey = (k: string): k is Key => KEYS.some((x) => x === k);
const isPhase = (p: string): p is SandboxPhase => p === 'upcard' || p === 'draw' || p === 'discard';

type Line = Readonly<{ key: string; value: string }>;

/** `key: value` per line, comments and blank lines dropped; a line without a colon is its own key. */
const linesOf = (text: string): ReadonlyArray<Line> =>
  text
    .split('\n')
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter((l) => l !== '')
    .map((l) => {
      const at = l.indexOf(':');
      return at < 0
        ? { key: l.toLowerCase(), value: '' }
        : { key: l.slice(0, at).trim().toLowerCase(), value: l.slice(at + 1).trim() };
    });

const cardsIn = (field: string, text: string): Result<Cards, string> => {
  const ids = words(text);
  const bad = ids.find((id) => cardOfId(id) === null);
  return bad === undefined
    ? ok(ids.flatMap((id) => cardOfId(id) ?? []))
    : err(`${field}: "${bad}" is not a card (AS, 10H, QD…)`);
};

const firstDuplicate = (cards: Cards): Card | undefined =>
  cards.find((c, i) => cards.findIndex((d) => d.id === c.id) !== i);

const meldsIn = (text: string, hand: Cards): Result<ReadonlyArray<Cards>, string> => {
  const groups = text
    .split('|')
    .map((g) => g.trim())
    .filter((g) => g !== '')
    .map((g) => cardsIn('melds', g));
  const bad = groups.find((g): g is Err<string> => !g.ok);
  if (bad !== undefined) return bad;
  const melds = groups.flatMap((g) => (g.ok ? [g.value] : []));
  const foreign = melds.flat().find((c) => !has(hand, c.id));
  return foreign === undefined ? ok(melds) : err(`melds: "${foreign.id}" is not in p1's hand`);
};

/**
 * The map the text spells, or the first thing wrong with it. Every card not named goes to the
 * bottom of the stock in deck order, so a map names only what matters.
 */
export const parseMap = (text: string): Result<SandboxMap, string> => {
  const lines = linesOf(text);
  const unknown = lines.find((l) => !isKey(l.key));
  if (unknown !== undefined)
    return err(`Unknown line "${unknown.key}": the keys are ${KEYS.join(', ')}`);
  const twice = KEYS.find((k) => lines.filter((l) => l.key === k).length > 1);
  if (twice !== undefined) return err(`"${twice}" is given twice`);
  const get = (k: Key): string | undefined => lines.find((l) => l.key === k)?.value;

  const p1 = cardsIn('p1', get('p1') ?? '');
  if (!p1.ok) return p1;
  const p2 = cardsIn('p2', get('p2') ?? '');
  if (!p2.ok) return p2;
  const discard = cardsIn('discard', get('discard') ?? '');
  if (!discard.ok) return discard;
  const stock = cardsIn('stock', get('stock') ?? '');
  if (!stock.ok) return stock;
  const turnText = (get('turn') ?? 'p1').toLowerCase();
  if (turnText !== 'p1' && turnText !== 'p2') return err('turn: p1 or p2');
  const turn: Seat = turnText === 'p1' ? 0 : 1;
  const phase = (get('phase') ?? 'draw').toLowerCase();
  if (!isPhase(phase)) return err('phase: upcard, draw or discard');

  const named = [...p1.value, ...p2.value, ...discard.value, ...stock.value];
  const dup = firstDuplicate(named);
  if (dup !== undefined) return err(`"${dup.id}" appears twice`);
  const hands: Pair<Cards> = [p1.value, p2.value];
  const sizeOf = (seat: Seat): number => HAND_SIZE + (phase === 'discard' && turn === seat ? 1 : 0);
  const wrong = ([0, 1] as const).find((seat) => hands[seat].length !== sizeOf(seat));
  if (wrong !== undefined)
    return err(
      `p${String(wrong + 1)} needs ${String(sizeOf(wrong))} cards, has ${String(hands[wrong].length)}`,
    );
  if (phase !== 'discard' && discard.value.length === 0)
    return err('discard: the upcard and draw phases need a card on the pile');

  const drawnText = get('drawn') ?? '';
  const drawn = drawnText === '' ? null : cardOfId(drawnText);
  if (drawnText !== '' && drawn === null) return err(`drawn: "${drawnText}" is not a card`);
  if (drawn !== null && (phase !== 'discard' || !has(hands[turn], drawn.id)))
    return err(`drawn: "${drawn.id}" must be in the turn player's hand, in the discard phase`);
  const melds = meldsIn(get('melds') ?? '', p1.value);
  if (!melds.ok) return melds;
  const targetText = get('target');
  const target =
    targetText === undefined || targetText === '' ? DEFAULT_TARGET : Number(targetText);
  if (!Number.isInteger(target) || target <= 0) return err('target: a positive whole number');

  const namedIds = new Set(idsOf(named));
  const rest = makeDeck().filter((c) => !namedIds.has(c.id));
  return ok({
    hands,
    discard: discard.value,
    stock: [...stock.value, ...rest],
    turn,
    phase,
    drawn,
    melds: melds.value,
    target,
  });
};

// ---- to and from the engine ----------------------------------------------------------------------

/**
 * The engine state the map describes, hand number one of a fresh game: the dealer is the other
 * seat, so an upcard phase reads as the non-dealer's decision; a `drawn` card is a stock draw
 * (fresh, not undoable), as the story catalogue deals its hands.
 */
export const dealMap = (map: SandboxMap, players: Pair<PlayerInfo>, now: () => number): State => {
  const pendingDraw: PendingDraw | null =
    map.drawn === null
      ? null
      : {
          from: 'stock',
          cardId: map.drawn.id,
          prevPhase: 'draw',
          prevUpcardStage: null,
          prevForceStock: false,
          prevTurn: map.turn,
        };
  return {
    players: [
      { ...players[0], total: 0 },
      { ...players[1], total: 0 },
    ],
    target: map.target,
    dealer: other(map.turn),
    turn: map.turn,
    phase: map.phase,
    hands: map.hands,
    stock: [...map.stock].reverse(),
    discard: map.discard,
    upcardStage: map.phase === 'upcard' ? 'nonDealer' : null,
    drawnFromDiscard: null,
    forceStock: false,
    pendingDraw,
    meldPref: [null, null],
    lastAction: { text: 'Dealt from the sandbox map.' },
    handNumber: 1,
    rounds: [],
    result: null,
    ready: [false, false],
    winner: null,
    startedAt: now(),
    ...(map.drawn === null ? {} : { lastDrawn: { p: map.turn, id: map.drawn.id } }),
  };
};

/** The map a state in play spells (a hand over reads as its draw phase); no hand-made melds. */
export const mapOf = (state: State): SandboxMap => {
  const phase: SandboxPhase = isPhase(state.phase) ? state.phase : 'draw';
  const lastDrawn = state.lastDrawn ?? null;
  const drawn =
    lastDrawn !== null &&
    lastDrawn.p === state.turn &&
    phase === 'discard' &&
    has(state.hands[state.turn], lastDrawn.id)
      ? (cardOfId(lastDrawn.id) ?? null)
      : null;
  return {
    hands: state.hands,
    discard: state.discard,
    stock: [...state.stock].reverse(),
    turn: state.turn,
    phase,
    drawn,
    melds: [],
    target: state.target,
  };
};

const ids = (cards: Cards): string => idsOf(cards).join(' ');

/** The map as text `parseMap` reads back to the same map. */
export const formatMap = (map: SandboxMap): string =>
  [
    `p1: ${ids(map.hands[0])}`,
    `p2: ${ids(map.hands[1])}`,
    `discard: ${ids(map.discard)}`,
    `stock: ${ids(map.stock)}`,
    `turn: p${String(map.turn + 1)}`,
    `phase: ${map.phase}`,
    ...(map.drawn === null ? [] : [`drawn: ${map.drawn.id}`]),
    ...(map.melds.length === 0 ? [] : [`melds: ${map.melds.map(ids).join(' | ')}`]),
    `target: ${String(map.target)}`,
  ].join('\n');

/** A fresh deal from `rng`: ten each, the upcard on the pile, the first player to draw. */
export const randomMap = (rng: Rng): SandboxMap => {
  const deck = shuffle(makeDeck(), rng);
  return {
    hands: [deck.slice(0, HAND_SIZE), deck.slice(HAND_SIZE, 2 * HAND_SIZE)],
    discard: deck.slice(2 * HAND_SIZE, 2 * HAND_SIZE + 1),
    stock: deck.slice(2 * HAND_SIZE + 1),
    turn: 0,
    phase: 'draw',
    drawn: null,
    melds: [],
    target: DEFAULT_TARGET,
  };
};

// ---- the presets ---------------------------------------------------------------------------------

export type Preset = Readonly<{ id: string; title: string; map: string }>;

/**
 * Starting points for the arrangement UX, each exercising something the others do not: no melds,
 * one set, one run, a set and a run, a knock, a gin, a card that melds two ways with a tie, a card
 * that melds two ways without one, a run of seven that wraps on a phone, a six-run against a set
 * and a five-run, and a hand-made meld that costs deadwood. The discard pile's card is chosen to
 * matter: taking it extends or completes a meld.
 */
export const DEFAULT_PRESET: Preset = {
  id: 'no-melds',
  title: 'No melds: ten deadwood cards, sort by rank or by suit',
  map: 'p1: AS 3H 5D 7C 9S JH KD 2C 4H 8S\np2: 2D 4S 6H 8C 10S QD KH 3C 5S 7D\ndiscard: 6C',
};

export const PRESETS: ReadonlyArray<Preset> = [
  DEFAULT_PRESET,
  {
    id: 'one-set',
    title: 'One set: three sevens and seven deadwood',
    map: 'p1: 7S 7H 7D AS 3C 5H 9D JS QC KH\np2: 2S 4D 6C 8H 10D JC QS KD AH 3S\ndiscard: 7C',
  },
  {
    id: 'one-run',
    title: 'One run: 4-5-6 of spades and seven deadwood; the 3S on the pile extends it',
    map: 'p1: 4S 5S 6S AH 3D 7C 9H JD QC KS\np2: 2H 4D 6C 8S 10H JC QD KH AC 2S\ndiscard: 3S',
  },
  {
    id: 'set-and-run',
    title: 'A set of queens and a run 2-3-4 of clubs; the 5C on the pile extends the run',
    map: 'p1: QS QH QD 2C 3C 4C AS 6H 8D 10S\np2: KS KH 5D 7C 9H JS AD 3H 6S 8C\ndiscard: 5C',
  },
  {
    id: 'knock-ready',
    title: 'Three melds and one deadwood card (the 5D): knock',
    map: 'p1: AS 2S 3S 8H 8D 8C JS JH JD 5D\np2: 4H 6C 7D 9S 10H QC KD 2H 4C 6D\ndiscard: 9H',
  },
  {
    id: 'gin-in-hand',
    title: 'Eleven cards in the discard phase: knock with the 2C for gin',
    map: 'p1: 4H 5H 6H 7H 9S 9D 9C KS KH KD 2C\np2: AS 3D 5C 8S 10D JC QH AD 3S 6C\ndiscard: 10C\nphase: discard\ndrawn: 2C',
  },
  {
    id: 'two-ways-tie',
    title: '6-7-8 of spades and a pair of sevens: the 7S melds either way, both ways tie',
    map: 'p1: 6S 7S 8S 7H 7D 2C 9H JD QC KH\np2: AS 3D 4C 6H 8D 10D JC QH KD 2H\ndiscard: 5S',
  },
  {
    id: 'four-eights',
    title:
      'Four eights beside 9-10 of clubs: the 8C is better in the run; long-press it into the set',
    map: 'p1: 8S 8H 8D 8C 9C 10C AS 3H 5D QH\np2: 2S 4D 6H 7C JS KD AH 3C 5S 7H\ndiscard: JC',
  },
  {
    id: 'seven-run',
    title:
      'A run of seven spades made by hand and three kings: three rows on a phone, the wide group wraps',
    map: 'p1: 4S 5S 6S 7S 8S 9S 10S KC KD KH\np2: AH 2D 3C 5H 6D 7C 9H 10D JD QC\ndiscard: 2C\nmelds: 4S 5S 6S 7S 8S 9S 10S',
  },
  {
    id: 'six-run-or-set',
    title: '3-8 of hearts and two more threes: a six-run, or a set of threes and a five-run',
    map: 'p1: 3H 4H 5H 6H 7H 8H 3S 3D 10C KD\np2: AS 2C 4D 6C 8S 9D JS QS KS AD\ndiscard: 2H',
  },
  {
    id: 'hand-made-set',
    title: 'A hand-made set of sevens that costs deadwood: long-press a seven to break it',
    map: 'p1: 7S 7H 7D 7C 5S 6S AD 9C JH KS\np2: 2H 3D 4C 6D 8H 10S JC QD KH AC\ndiscard: 4S\nmelds: 7S 7H 7D',
  },
];

export const presetById = (id: string): Preset | null => PRESETS.find((p) => p.id === id) ?? null;
