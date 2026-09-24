// The table's pure builders (scratchpad/bg/design.md §2.2.3 "Static vs painter-rebuilt", §2.4.1
// "Pure helpers in ui/board.ts", §2.7 the class list): the markup strings a painter writes into
// the keyed containers of `#board` and `#controls`, the keys that say when a container must be
// rebuilt, the selection helpers the reducer and the painter share (which places can move, what a
// tapped source reaches and with which dice), the status and result copy, the painted aria labels,
// and the flights a repaint should animate. Everything here is a function of a `View` and a few
// UI facts (the tapped source, a picked die, the open tray), tested as strings and tables like
// gin's ui/cards.ts. It imports the engine only: the reducer (ui/state.ts) imports this module,
// never the reverse, and the DOM is the painter's (render.ts over web/shared/edge/dom.ts).
import {
  CHECKERS,
  CUBE_MAX,
  POINT_INDICES,
  afterMove,
  chainsFrom as chainsOnBoard,
  diceText,
  expandDice,
  hits,
  otherSeat,
  pointsText,
  rulesOf,
  type Cube,
  type Dice,
  type Die,
  type From,
  type LogEntry,
  type Move,
  type PlayedMove,
  type PointIndex,
  type Seat,
  type Stack,
  type To,
  type View,
} from '../engine/index.ts';

// ---- places, ids and the viewer's frame ----------------------------------------------------------

/** First occurrences, in order. */
const distinct = <T>(xs: ReadonlyArray<T>): ReadonlyArray<T> =>
  xs.filter((x, i) => xs.indexOf(x) === i);

/** A source the player may tap: a point or the bar (design §2.4.1 `Place`). */
export type Place = From;
/** The id of a keyed container of `#board`: `point-N` is 1-based absolute (`data-abs`). */
export type PlaceId = `point-${number}` | 'barTop' | 'barBottom' | 'offLight' | 'offDark';
export type Side = 'near' | 'far';

/** Design §2.3.3: own 1..12 is the near half of the board, 13..24 the far half. */
export const sideOf = (own: number): Side => (own <= 12 ? 'near' : 'far');

/** The viewer's own number of an absolute point (the label `data-own` shows). */
export const ownPoint = (v: View, abs: PointIndex): number =>
  rulesOf(v.variant).ownOf(v.me.idx, abs);

/** `point-1`..`point-24`; `String()` widens the template to `point-${string}`, hence the cast. */
export const pointId = (abs: PointIndex): PlaceId => `point-${String(abs + 1)}` as PlaceId;
/** `#barTop` is always the far player's bar and `#barBottom` mine (design §2.2.1). */
export const barIdFor = (v: View, seat: Seat): PlaceId =>
  seat === v.me.idx ? 'barBottom' : 'barTop';
/** The trays are colour-fixed: Light's slabs are always in `#offLight`. */
export const offIdFor = (seat: Seat): PlaceId => (seat === 0 ? 'offLight' : 'offDark');
/** The container a checker of `seat` sits in at `place`, as the viewer's page names it. */
export const placeIdOf = (v: View, seat: Seat, place: From | To): PlaceId =>
  place === 'bar' ? barIdFor(v, seat) : place === 'off' ? offIdFor(seat) : pointId(place);

/** `barsOf(view)` (design §2.2.1): which seat's bar each half of the band shows, and how many. */
export const barsOf = (
  v: View,
): Readonly<{
  top: Readonly<{ seat: Seat; count: number }>;
  bottom: Readonly<{ seat: Seat; count: number }>;
}> => ({
  top: { seat: v.opp.idx, count: v.board.bar[v.opp.idx] },
  bottom: { seat: v.me.idx, count: v.board.bar[v.me.idx] },
});

// ---- checkers and slabs (design §2.2.3: keyed markup) ----------------------------------------------

/** Five checkers are drawn; the sixth onward is the count badge on the fifth (design §2.3.4). */
export const VISIBLE_MAX = 5;

const ownerLetter = (seat: Seat | null): string => (seat === null ? '-' : seat === 0 ? 'L' : 'D');

/** The top checker of a stack owns it (homogeneous in every shipped variant), or nobody. */
export const ownerOf = (stack: Stack): Seat | null => stack.at(-1) ?? null;

/** `${owner}${count}`: `L5`, `D2`, `-0`. A container is rebuilt only when this changes. */
export const stackKey = (stack: Stack): string =>
  `${ownerLetter(ownerOf(stack))}${String(stack.length)}`;
export const countKey = (count: number): string => String(count);

/**
 * One checker: `--i` is its index in the stack (the CSS places it along the point's axis), the
 * top visible one carries `top` and, when the stack is taller than five, the count badge.
 */
export const checkerHtml = (seat: Seat, index: number, count: number): string => {
  const top = index === Math.min(count, VISIBLE_MAX) - 1;
  const badge = top && count > VISIBLE_MAX ? ` data-count="${String(count)}"` : '';
  return `<div class="checker ${seat === 0 ? 'ck-light' : 'ck-dark'}${top ? ' top' : ''}" style="--i:${String(index)}"${badge}></div>`;
};

/** `count` checkers of `seat`; nothing for an empty place. */
export const checkersHtml = (seat: Seat | null, count: number): string =>
  seat === null
    ? ''
    : Array.from({ length: count }, (_, i) => checkerHtml(seat, i, count)).join('');

/** A point's content: its stack as checkers. */
export const pointHtml = (stack: Stack): string => checkersHtml(ownerOf(stack), stack.length);
/** A bar half's content: `count` hit checkers of `seat`. */
export const barHtml = (seat: Seat, count: number): string =>
  checkersHtml(count === 0 ? null : seat, count);

/** A borne-off checker, flattened (design §2.3.4). */
export const slabsHtml = (count: number): string =>
  Array.from({ length: count }, () => '<div class="slab"></div>').join('');
/** A tray's content. */
export const offHtml = (count: number): string => slabsHtml(count);

/** `#pipsMe`/`#pipsOpp`: the number, with the unit for screen readers only. */
export const pipHtml = (pips: number): string =>
  `${String(pips)}<span class="sr-only"> pips</span>`;

// ---- dice (design §2.2.3 `#dice`, §2.3.7 `used dead picked theirs blank`, §2.4.4 "Which die") -----

export type DieState = 'live' | 'used' | 'dead';
export type DieFace = Readonly<{ die: Die; state: DieState; picked: boolean }>;
/** What `#dice` and `#diceMini` show, with the key a painter compares before rebuilding them. */
export type DiceModel = Readonly<{ faces: ReadonlyArray<DieFace>; theirs: boolean; key: string }>;

const countOf = (dice: ReadonlyArray<Die>, die: Die): number =>
  dice.filter((d) => d === die).length;
const withoutOne = (dice: ReadonlyArray<Die>, die: Die): ReadonlyArray<Die> => {
  const i = dice.indexOf(die);
  return i < 0 ? dice : [...dice.slice(0, i), ...dice.slice(i + 1)];
};

/**
 * Design §2.4.4: a die is dead when no maximal play uses it. Per face value, the copies in
 * `movesLeft` beyond the most any play spends are dead: for a non-double the die no play
 * contains, for a double the last `movesLeft.length − plays[0].length` faces. Nothing is dead
 * for a viewer who is not moving (`plays` is empty for them).
 */
export const deadDice = (v: View): ReadonlyArray<Die> =>
  v.plays.length === 0
    ? []
    : v.movesLeft.filter((d, i) => {
        const spent = Math.max(
          0,
          ...v.plays.map((p) =>
            countOf(
              p.map((m) => m.die),
              d,
            ),
          ),
        );
        return countOf(v.movesLeft.slice(0, i + 1), d) > spent;
      });

type FaceFold = Readonly<{
  used: ReadonlyArray<Die>;
  live: ReadonlyArray<Die>;
  out: ReadonlyArray<DieState>;
}>;

/** Each face takes a played die first, then a live one; what is left is dead (a double's tail). */
const faceStates = (
  faces: ReadonlyArray<Die>,
  used: ReadonlyArray<Die>,
  live: ReadonlyArray<Die>,
): ReadonlyArray<DieState> =>
  faces.reduce<FaceFold>(
    (acc, d) =>
      acc.used.includes(d)
        ? { ...acc, used: withoutOne(acc.used, d), out: [...acc.out, 'used'] }
        : acc.live.includes(d)
          ? { ...acc, live: withoutOne(acc.live, d), out: [...acc.out, 'live'] }
          : { ...acc, out: [...acc.out, 'dead'] },
    { used, live, out: [] },
  ).out;

const BLANK: DiceModel = { faces: [], theirs: false, key: 'blank' };

/**
 * The dice to show: blank before a roll (design §2.1.1), the roll while someone moves (`theirs`
 * when it is not mine), the final roll once the game is over, and a forfeited roll (every face
 * dead) while the painter holds the R14 beat (`noMoveShown`, design §2.4.5). `picked` rings the
 * first live face of that value (`die/pick`).
 */
export const diceFor = (v: View, picked: Die | null = null, noMoveShown = false): DiceModel => {
  const noMove = noMoveShown && v.lastAction?.kind === 'noMove';
  if (v.dice === null || !(v.phase === 'moving' || v.phase === 'over' || noMove)) return BLANK;
  const roller = noMove ? (v.lastAction.seat ?? v.turn) : v.turn;
  const faces = expandDice(v.dice);
  const states: ReadonlyArray<DieState> = noMove
    ? faces.map(() => 'dead')
    : v.phase === 'over'
      ? faces.map(() => 'live')
      : faceStates(
          faces,
          v.played.map((m) => m.die),
          deadDice(v).reduce(withoutOne, v.movesLeft),
        );
  const ringed = states.findIndex((s, i) => s === 'live' && faces[i] === picked);
  const model = faces.map((die, i): DieFace => ({
    die,
    state: states[i] ?? 'live',
    picked: i === ringed,
  }));
  const key = `${diceText(v.dice)}:${states.map((s) => s[0] ?? '').join('')}:${String(picked ?? '-')}:${String(roller)}`;
  return { faces: model, theirs: roller !== v.me.idx, key };
};

const dieHtml = (f: DieFace, theirs: boolean): string => {
  const d = String(f.die);
  const classes = [
    'die',
    `die-${d}`,
    f.state === 'live' ? '' : f.state,
    f.picked ? 'picked' : '',
    theirs ? 'theirs' : '',
  ]
    .filter((c) => c !== '')
    .join(' ');
  const label =
    f.state === 'used'
      ? `die ${d}, played`
      : f.state === 'dead'
        ? `die ${d}, cannot be played`
        : `die ${d}`;
  const disabled = f.state === 'live' ? '' : ' aria-disabled="true"';
  return `<span class="${classes}" data-die="${d}" aria-label="${label}"${disabled}></span>`;
};

const BLANK_DIE = '<span class="die blank" aria-hidden="true"></span>';

/** Two blank faces, or one `.die.die-N` per face of the roll (four for a double). */
export const diceHtml = (model: DiceModel): string =>
  model.faces.length === 0
    ? `${BLANK_DIE}${BLANK_DIE}`
    : model.faces.map((f) => dieHtml(f, model.theirs)).join('');

const DIE_WORDS: ReadonlyArray<string> = ['one', 'two', 'three', 'four', 'five', 'six'];

/** `#statusDice` (design §2.5): the roll in words for screen readers, '' before a roll. */
export const diceWords = (dice: Dice | null): string =>
  dice === null ? '' : dice.map((d) => DIE_WORDS[d - 1] ?? '').join(' and ');

// ---- the cube (design §2.2.3 `#cube`: text = value, `data-owner` = none | near | far) -------------

export type CubeSide = 'none' | 'near' | 'far';

export const cubeText = (cube: Cube): string => String(cube.value);
/** The cube slides to its owner's side of the bar; `near` is the viewer's. */
export const cubeOwner = (cube: Cube, me: Seat): CubeSide =>
  cube.owner === null ? 'none' : cube.owner === me ? 'near' : 'far';

// ---- selection (design §2.4.1 chainsFrom/targetsOf, §2.4.3 the die-chip tray, §2.4.5 the sole source)

/** A same-checker chain a maximal play allows (design §2.4.1 `Chain`), in absolute points. */
export type Chain = Readonly<{
  moves: ReadonlyArray<Move>;
  to: To;
  /** The points the checker passes through (a two-order move has one, a double's chain up to three). */
  via: ReadonlyArray<PointIndex>;
  /** The blots the chain hits, in order. */
  hits: ReadonlyArray<PointIndex>;
}>;
export type TargetKind = 'target' | 'target-2';
/** A destination of the selected source: its class and its `data-die` text (design §2.3.7). */
export type Target = Readonly<{
  to: To;
  kind: TargetKind;
  /** `"3"`; `"6·5"` when either die bears off; `"3+1"`; `"6+3?"` when the tap opens the tray. */
  die: string;
  /** The tap opens the die-chip tray instead of committing (design §2.4.3). */
  opens: boolean;
  /** In chip order: the higher first die, then fewer hits; `chip/tap {index}` indexes this list. */
  chains: ReadonlyArray<Chain>;
}>;

/** The distinct sources of `v.legal`, in the engine's canonical order (the bar first). */
export const sourcesOf = (v: View): ReadonlyArray<Place> => distinct(v.legal.map((m) => m.from));

/**
 * Design §2.4.5: the tapped source while it can still move, else the sole source (the derived
 * `.selected.auto`), else nothing. A stale tap (its checker has moved) is not shown as selected.
 */
export const effectiveSelection = (selected: Place | null, v: View): Place | null => {
  const sources = sourcesOf(v);
  if (selected !== null && sources.includes(selected)) return selected;
  const [only] = sources;
  return sources.length === 1 && only !== undefined ? only : null;
};

type HitWalk = Readonly<{ board: View['board']; hits: ReadonlyArray<PointIndex> }>;

/** The engine's play as a chain: its end, its intermediate points and the blots it hits. */
const toChain = (v: View, moves: ReadonlyArray<Move>): Chain => {
  const rules = rulesOf(v.variant);
  const seat = v.me.idx;
  const walk = moves.reduce<HitWalk>(
    (acc, m) => ({
      board: afterMove(acc.board, seat, m, rules),
      hits: m.to !== 'off' && hits(acc.board, seat, m, rules) ? [...acc.hits, m.to] : acc.hits,
    }),
    { board: v.board, hits: [] },
  );
  return {
    moves,
    to: moves.at(-1)?.to ?? 'off',
    via: moves.slice(0, -1).flatMap((m) => (m.to === 'off' ? [] : [m.to])),
    hits: walk.hits,
  };
};

/**
 * The same-checker chains from `from` that a maximal play allows (design §2.4.1), exact by the
 * engine's hereditary lemma; a picked die keeps only its single steps (no combined targets).
 * Empty unless the viewer is the one moving.
 */
export const chainsFrom = (v: View, from: Place, picked: Die | null): ReadonlyArray<Chain> =>
  !v.isMyTurn || v.phase !== 'moving'
    ? []
    : chainsOnBoard(v.board, v.me.idx, v.movesLeft, from, rulesOf(v.variant))
        .filter((play) => picked === null || (play.length === 1 && play[0]?.die === picked))
        .map((play) => toChain(v, play));

const firstDie = (c: Chain): number => c.moves[0]?.die ?? 0;
/** Chip order (design §2.4.3): the higher first die, then fewer hits. */
export const compareChains = (a: Chain, b: Chain): number =>
  firstDie(b) - firstDie(a) || a.hits.length - b.hits.length;

/**
 * The dice a combined target spends, `6+3`; three or four of a double as `3×3`, `3×4` (`3+3+3+3?`
 * overflowed a 53px desktop point into its neighbours).
 */
const diceLabel = (dice: ReadonlyArray<Die>): string =>
  dice.length > 2 && dice.every((d) => d === dice[0])
    ? `${String(dice[0])}×${String(dice.length)}`
    : dice.join('+');

const targetAt = (to: To, chains: ReadonlyArray<Chain>): Target => {
  const sorted = [...chains].sort(compareChains);
  const singles = sorted.filter((c) => c.moves.length === 1);
  // One step reaches a point with exactly one die; only a bear-off can take either (design §2.4.4
  // "6·5"), and then the tap opens the tray so the player picks the die that dims.
  if (singles.length > 0)
    return {
      to,
      kind: 'target',
      die: singles.map((c) => String(firstDie(c))).join('·'),
      opens: singles.length > 1,
      chains: singles,
    };
  const opens = new Set(sorted.map((c) => c.hits.join(','))).size > 1;
  const dice = diceLabel(sorted[0]?.moves.map((m) => m.die) ?? []);
  return { to, kind: 'target-2', die: `${dice}${opens ? '?' : ''}`, opens, chains: sorted };
};

const toSlot = (to: To): number => (to === 'off' ? 24 : to);

/** The destinations of `from` grouped by end point, in board order (design §2.4.1 `targetsOf`). */
export const targetsOf = (
  v: View,
  from: Place | null,
  picked: Die | null,
): ReadonlyArray<Target> => {
  if (from === null) return [];
  const chains = chainsFrom(v, from, picked);
  const ends = distinct(chains.map((c) => c.to));
  return [
    ...ends.map((to) =>
      targetAt(
        to,
        chains.filter((c) => c.to === to),
      ),
    ),
  ].sort((a, b) => toSlot(a.to) - toSlot(b.to));
};

// ---- the die-chip tray (design §2.1.3, §2.4.3) ---------------------------------------------------

/** A chip in the player's own numbering. */
export type Chip = Readonly<{
  dice: ReadonlyArray<Die>;
  to: number | 'off';
  via: ReadonlyArray<number>;
  hits: ReadonlyArray<number>;
}>;

/** One chip per chain of the pending target, in the target's (chip) order. */
export const chipsFor = (v: View, chains: ReadonlyArray<Chain>): ReadonlyArray<Chip> =>
  chains.map((c) => ({
    dice: c.moves.map((m) => m.die),
    to: c.to === 'off' ? 'off' : ownPoint(v, c.to),
    via: c.via.map((p) => ownPoint(v, p)),
    hits: c.hits.map((p) => ownPoint(v, p)),
  }));

/** The chain's dice as digits, `6·3`: the ⚅ glyphs drew as empty boxes at chip size on phones. */
export const chipFaces = (chip: Chip): string => chip.dice.map(String).join('·');
/** Where the chain lands and what it passes: `→ 4 via 7, hits`, `→ 4 via 10`, `→ off`. */
export const chipNote = (chip: Chip): string => {
  const via = chip.via.length === 0 ? '' : ` via ${chip.via.map(String).join(', ')}`;
  return `→ ${String(chip.to)}${via}${chip.hits.length === 0 ? '' : ', hits'}`;
};
/** The chip in one breath, `6·3 → 4 via 7, hits`: its `aria-label`, and the two lines joined. */
export const chipLabel = (chip: Chip): string => `${chipFaces(chip)} ${chipNote(chip)}`;

export const chipKey = (chip: Chip): string =>
  `${chip.dice.join('+')}>${String(chip.to)}/${chip.via.join('.')}/${chip.hits.join('.')}`;
/** `#moveChips` is rebuilt when this changes (design §2.2.3). */
export const chipsKey = (chips: ReadonlyArray<Chip>): string => chips.map(chipKey).join('|');

/**
 * `.chip[data-index][data-dice][data-to][data-via][data-hit]` with the dice on one line (`.faces`)
 * and the landing on the next (`.via`, warm when the chain `hits`); `data-index` is the chain's index.
 */
export const chipsHtml = (chips: ReadonlyArray<Chip>): string =>
  chips
    .map(
      (chip, i) =>
        `<button type="button" class="chip${chip.hits.length === 0 ? '' : ' hits'}" data-index="${String(i)}" data-dice="${chip.dice.join('+')}" data-to="${String(chip.to)}" data-via="${chip.via.join('+')}" data-hit="${chip.hits.join('+')}" aria-label="${chipLabel(chip)}"><span class="faces">${chipFaces(chip)}</span><span class="via">${chipNote(chip)}</span></button>`,
    )
    .join('');

// ---- the status line (design §1 "Status line", §2.1 mockups, §2.4.5, §2.4.10) ---------------------

/** The die-chip tray as the reducer holds it (design §2.4.1 `Table.pending`). */
export type Pending = Readonly<{ from: Place; to: To; chains: ReadonlyArray<Chain> }>;
export type StatusOpts = Readonly<{
  pending: Pending | null;
  /** The painter is holding the R14 beat: the forfeited roll stays on the line (design §2.4.5). */
  noMoveShown: boolean;
  /** The die the player tapped to force (`die/pick`): the line confirms it. */
  picked?: Die | null;
}>;
export const PLAIN_STATUS: StatusOpts = { pending: null, noMoveShown: false };

const rollOf = (v: View): string => (v.dice === null ? '' : diceText(v.dice));
const COUNT_WORDS: ReadonlyArray<string> = ['none', 'one', 'two', 'three', 'four'];

/** The opponent's `canDouble` (the view carries only mine): R19 evaluated for their seat. */
const mayDouble = (v: View, seat: Seat): boolean =>
  rulesOf(v.variant).cube &&
  v.phase === 'toRoll' &&
  v.turn === seat &&
  !v.match.isCrawfordGame &&
  (v.cube.owner === null || v.cube.owner === seat) &&
  v.cube.value < CUBE_MAX;

const placeName = (v: View, place: From | To): string =>
  place === 'bar' ? 'bar' : place === 'off' ? 'off' : String(ownPoint(v, place));

/** `13 · 6+3 reaches 4 two ways` (design §2.1.3); `4 · either die bears off` (§2.1.6). */
const pendingStatus = (v: View, pending: Pending): string => {
  const from = placeName(v, pending.from);
  if (pending.chains.every((c) => c.moves.length === 1)) return `${from} · either die bears off`;
  const dice = pending.chains[0]?.moves.map((m) => String(m.die)).join('+') ?? '';
  return `${from} · ${dice} reaches ${placeName(v, pending.to)} two ways`;
};

/** Which dice are dead, said once, before the first move of the turn. */
const deadStatus = (v: View, dead: ReadonlyArray<Die>, playable: number): string =>
  v.dice !== null && v.dice[0] === v.dice[1]
    ? `only ${COUNT_WORDS[playable] ?? String(playable)} of the four can be played`
    : `the ${String(dead[0])} cannot be played`;

const movingStatus = (v: View, pending: Pending | null, picked: Die | null): string => {
  if (pending !== null) return pendingStatus(v, pending);
  const roll = rollOf(v);
  if (picked !== null) return `${roll} · playing the ${String(picked)}`;
  const dead = deadDice(v);
  const playable = v.plays[0]?.length ?? 0;
  if (v.board.bar[v.me.idx] > 0) return `${roll} · enter from the bar`;
  if (dead.length > 0 && v.played.length === 0) return `${roll} · ${deadStatus(v, dead, playable)}`;
  if (playable === 1) return 'Last move: the turn ends when you play it';
  if (v.canBearOff[v.me.idx]) return `${roll} · bear off`;
  if (v.played.length === 0)
    return `${roll} · play ${v.movesLeft.length === 2 ? 'both dice' : 'all four'}`;
  return `${roll} · ${String(playable)} moves left`;
};

/** The forfeited roll (R14): `6-6 · no move — turn passes`, `4-2 · no entry — turn passes`. */
const noMoveStatus = (v: View): string => {
  const roller = v.lastAction?.seat ?? null;
  const entering = roller !== null && v.board.bar[roller] > 0;
  return `${rollOf(v)} · ${entering ? 'no entry' : 'no move'} — turn passes`;
};

/** `#statusText`: what is left to do, pinned strings (design §2.6). */
export const statusText = (v: View, opts: StatusOpts = PLAIN_STATUS): string => {
  const opp = v.opp.name;
  if (v.phase === 'over') return resultText(v).title;
  if (opts.noMoveShown && v.lastAction?.kind === 'noMove' && v.dice !== null)
    return noMoveStatus(v);
  if (!v.isMyTurn) {
    switch (v.phase) {
      case 'toRoll':
        return mayDouble(v, v.opp.idx) ? `${opp} may double` : `${opp} is rolling…`;
      case 'moving':
        return `${opp} to move · ${rollOf(v)}`;
      case 'cubeOffered':
        return `${opp} is answering the double`;
      case 'opening':
        return '';
    }
  }
  switch (v.phase) {
    case 'toRoll':
      return v.canDouble ? 'Your turn. Double or roll' : 'Your turn. Buen mazal!';
    case 'moving':
      return movingStatus(v, opts.pending, opts.picked ?? null);
    case 'cubeOffered':
      return `${opp} doubles to ${String(v.cube.value * 2)}. Take or pass?`;
    case 'opening':
      return '';
  }
};

// ---- the turn just finished: the curtain's line and the hit toast -----------------------------------

/** The turn just finished as the log names it (a `move` or `noMove` line), or null before the first. */
export const lastTurnEntry = (v: View): LogEntry | null =>
  [...v.log].reverse().find((e) => e.kind === 'move' || e.kind === 'noMove') ?? null;

/**
 * The points where `seat` was hit in the turn just finished, in `seat`'s own numbering. The log's
 * hit lines are written in the mover's numbering (rules R28), so the points come from the moves
 * instead: `lastPlay` is that turn's play whenever the last turn line is a `move` (a forfeited
 * roll leaves `lastPlay` empty). Nothing when the last turn was `seat`'s own, or before any turn.
 */
export const hitsAgainst = (v: View, seat: Seat): ReadonlyArray<number> => {
  const last = lastTurnEntry(v);
  if (last?.kind !== 'move' || last.seat === seat) return [];
  const rules = rulesOf(v.variant);
  return v.lastPlay.flatMap((m) => (m.hit && m.to !== 'off' ? [rules.ownOf(seat, m.to)] : []));
};

// ---- the result sheet (design §2.4.11) -----------------------------------------------------------

export type ResultCopy = Readonly<{ title: string; sub: string; score: string }>;

/** `Ari 2 – 0 Jeff · match to 5`, seats in order. */
export const scoreText = (v: View): string =>
  `${v.players[0].name} ${String(v.match.score[0])} – ${String(v.match.score[1])} ${v.players[1].name} · match to ${String(v.match.length)}`;

/**
 * `#rsTitle`, `#rsSub`, `#rsScore`: "Ari wins 2 points · gammon", "Jeff passed · Ari wins 1 point";
 * "Jeff had 4 checkers left · 61 pips" or "Jeff passed the double". Empty titles before `over`.
 */
export const resultText = (v: View): ResultCopy => {
  const r = v.result;
  if (r === null) return { title: '', sub: '', score: scoreText(v) };
  const loserSeat = otherSeat(r.winner);
  const winner = v.players[r.winner].name;
  const loser = v.players[loserSeat].name;
  const kind = r.multiplier === 2 ? ' · gammon' : r.multiplier === 3 ? ' · backgammon' : '';
  const cube = r.cube === 1 ? '' : `${kind === '' ? ' ·' : ','} cube ${String(r.cube)}`;
  const points = pointsText(r.points);
  const left = CHECKERS - v.board.off[loserSeat];
  return r.reason === 'passed'
    ? {
        title: `${loser} passed · ${winner} wins ${points}`,
        sub: `${loser} passed the double`,
        score: scoreText(v),
      }
    : {
        title: `${winner} wins ${points}${kind}${cube}`,
        sub: `${loser} had ${String(left)} checker${left === 1 ? '' : 's'} left · ${String(v.pips[loserSeat])} pips`,
        score: scoreText(v),
      };
};

// ---- painted aria labels (design §2.2.3 `placeAria`, §2.5) ------------------------------------------

/** The highlight a place wears this paint; only one word of it is spoken. */
export type Highlight = Readonly<{ canMove: boolean; selected: boolean; die: string | null }>;
export const NO_HIGHLIGHT: Highlight = { canMove: false, selected: false, die: null };

const plural = (n: number, noun: string): string => `${String(n)} ${noun}${n === 1 ? '' : 's'}`;
/** `3×3` spoken as `three 3s`; the tray's `?` is not read. */
const spokenDie = (die: string): string =>
  die
    .replace(/(\d)×(\d)/, (_m, d: string, n: string) => `${COUNT_WORDS[Number(n)] ?? n} ${d}s`)
    .replace('?', '');
const highlightSuffix = (hl: Highlight): string =>
  hl.selected
    ? ', selected'
    : hl.die !== null
      ? `, target with the ${spokenDie(hl.die)}`
      : hl.canMove
        ? ', can move'
        : '';

/** The absolute point of a `point-N` id, null for the bars and trays. */
export const absOfId = (id: PlaceId): PointIndex | null =>
  POINT_INDICES.find((abs) => pointId(abs) === id) ?? null;

/**
 * "Your 8-point, 3 checkers, can move", "Jeff's 13-point, 5 checkers", "Point 5, empty, target
 * with the 3", "Your bar, 1 checker, selected", "Your tray, 3 off, target with the 6".
 */
export const placeAria = (v: View, id: PlaceId, hl: Highlight = NO_HIGHLIGHT): string => {
  const whose = (seat: Seat): string => (seat === v.me.idx ? 'Your' : `${v.opp.name}'s`);
  if (id === 'barTop' || id === 'barBottom') {
    const seat = id === 'barBottom' ? v.me.idx : v.opp.idx;
    const n = v.board.bar[seat];
    return `${whose(seat)} bar, ${n === 0 ? 'empty' : plural(n, 'checker')}${highlightSuffix(hl)}`;
  }
  if (id === 'offLight' || id === 'offDark') {
    const seat: Seat = id === 'offLight' ? 0 : 1;
    return `${whose(seat)} tray, ${String(v.board.off[seat])} off${highlightSuffix(hl)}`;
  }
  const abs = absOfId(id);
  if (abs === null) return '';
  const stack = v.board.points[abs] ?? [];
  const owner = ownerOf(stack);
  const own = String(ownPoint(v, abs));
  return owner === null
    ? `Point ${own}, empty${highlightSuffix(hl)}`
    : `${whose(owner)} ${own}-point, ${plural(stack.length, 'checker')}${highlightSuffix(hl)}`;
};

// ---- flights (design §2.3.9 `flightsBetween`) -------------------------------------------------------

/** A checker's trip between two containers; `slab` when it lands as a slab, `hit` for a blot sent to the bar. */
export type Flight = Readonly<{
  fromContainer: PlaceId;
  toContainer: PlaceId;
  slab?: true;
  hit?: true;
}>;
/** More than this many flights in one repaint and the board repaints cold (design §2.3.9). */
export const MAX_FLIGHTS = 4;

const sameMove = (a: PlayedMove, b: PlayedMove): boolean =>
  a.from === b.from && a.to === b.to && a.die === b.die && a.hit === b.hit;
/** `longer` begins with every move of `prefix`. */
const extendsPlay = (
  longer: ReadonlyArray<PlayedMove>,
  prefix: ReadonlyArray<PlayedMove>,
): boolean =>
  longer.length >= prefix.length &&
  prefix.every((m, i) => {
    const other = longer[i];
    return other !== undefined && sameMove(m, other);
  });

/** A move as played: the checker, then (80ms later in fly.ts) the blot it hit. */
const forward = (v: View, seat: Seat, m: PlayedMove): ReadonlyArray<Flight> => [
  m.to === 'off'
    ? { fromContainer: placeIdOf(v, seat, m.from), toContainer: offIdFor(seat), slab: true }
    : { fromContainer: placeIdOf(v, seat, m.from), toContainer: pointId(m.to) },
  ...(m.hit && m.to !== 'off'
    ? [
        {
          fromContainer: pointId(m.to),
          toContainer: barIdFor(v, otherSeat(seat)),
          hit: true,
        } as const,
      ]
    : []),
];
/** A move undone: the blot comes back from the bar, the checker returns to where it stood. */
const backward = (v: View, seat: Seat, m: PlayedMove): ReadonlyArray<Flight> => [
  ...(m.hit && m.to !== 'off'
    ? [{ fromContainer: barIdFor(v, otherSeat(seat)), toContainer: pointId(m.to) }]
    : []),
  { fromContainer: placeIdOf(v, seat, m.to), toContainer: placeIdOf(v, seat, m.from) },
];

const capped = (flights: ReadonlyArray<Flight>): ReadonlyArray<Flight> =>
  flights.length > MAX_FLIGHTS ? [] : flights;

/**
 * What moved between two paints of the same game: the moves added to this turn (mine as I tap,
 * the opponent's as frames arrive), an undo's removed tail reversed, or, once the turn (or the
 * game) has ended, the previous mover's finished play beyond what was already shown. Anything
 * else (a new game, a roll, a cube action, a frame that skipped a turn) animates nothing.
 */
export const flightsBetween = (prev: View, next: View): ReadonlyArray<Flight> => {
  if (prev.gameNo !== next.gameNo || prev.startedAt !== next.startedAt) return [];
  const sameTurn = prev.turn === next.turn;
  if (
    sameTurn &&
    next.phase === 'moving' &&
    next.played.length > prev.played.length &&
    extendsPlay(next.played, prev.played)
  )
    return capped(
      next.played.slice(prev.played.length).flatMap((m) => forward(next, next.turn, m)),
    );
  if (
    sameTurn &&
    next.phase === 'moving' &&
    prev.phase === 'moving' &&
    next.played.length < prev.played.length &&
    extendsPlay(prev.played, next.played)
  )
    return capped(
      [...prev.played.slice(next.played.length)]
        .reverse()
        .flatMap((m) => backward(next, next.turn, m)),
    );
  const ended =
    (prev.phase === 'moving' || prev.phase === 'toRoll') &&
    next.played.length === 0 &&
    (!sameTurn || next.phase === 'over');
  return ended && extendsPlay(next.lastPlay, prev.played)
    ? capped(next.lastPlay.slice(prev.played.length).flatMap((m) => forward(next, prev.turn, m)))
    : [];
};
