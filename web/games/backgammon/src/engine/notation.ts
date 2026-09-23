// The engine's text (understand.md §5 R28; panel E1 §3 "Log and lastAction" and §4's notation):
// moves in the mover's own numbering (`8/5*`, `bar/20`, `6/off`), a turn's moves with adjacent
// repeats collapsed (`13/7(2)`), and the position notation the test table and a sandbox share:
// `L: 24:2 13:5 8:3 6:5 | D: 24:2 13:5 8:3 6:5 | bar 0/0 | off 0/0`, each side in its own numbering.
// The parsers return `Result`s: the text may come from a person.
import { err, ok, type Result } from '../../../../shared/lib/result.ts';
import { emptyBoard, hits, POINT_INDICES, stackAt } from './board.ts';
import {
  BAR_PIPS,
  POINTS,
  type Board,
  type Dice,
  type Die,
  type From,
  type Move,
  type Pair,
  type PlayedMove,
  type PointIndex,
  type Seat,
  type To,
  type VariantRules,
} from './types.ts';

export const pointName = (seat: Seat, place: From | To, rules: VariantRules): string =>
  place === 'bar' ? 'bar' : place === 'off' ? 'off' : String(rules.ownOf(seat, place));

/** Standard notation: `from/to`, `*` for a hit; the die is never written. */
export const moveText = (seat: Seat, move: PlayedMove, rules: VariantRules): string =>
  `${pointName(seat, move.from, rules)}/${pointName(seat, move.to, rules)}${move.hit ? '*' : ''}`;

/** Own pips a move covers: 25 from the bar, to 0 when bearing off. */
const distance = (seat: Seat, move: Move, rules: VariantRules): number =>
  (move.from === 'bar' ? BAR_PIPS : rules.ownOf(seat, move.from)) -
  (move.to === 'off' ? 0 : rules.ownOf(seat, move.to));

/**
 * `moveText` for a move not yet played, the hit read off `board`, plus `(die)` when the die is
 * not the pip distance (a higher-die bear-off): the test table's spelling of a legal move.
 */
export const moveLabel = (board: Board, seat: Seat, move: Move, rules: VariantRules): string => {
  const text = moveText(seat, { ...move, hit: hits(board, seat, move, rules) }, rules);
  return distance(seat, move, rules) === move.die ? text : `${text}(${String(move.die)})`;
};

type Run = Readonly<{ text: string; n: number }>;
/** One own point and how many of the seat's checkers sit on it. */
type Entry = Readonly<{ own: number; n: number }>;

/** A turn's moves in order, adjacent repeats collapsed: `Ari moved 13/7(2)`. */
export const playText = (
  seat: Seat,
  played: ReadonlyArray<PlayedMove>,
  rules: VariantRules,
): string =>
  played
    .map((m) => moveText(seat, m, rules))
    .reduce<ReadonlyArray<Run>>((runs, text) => {
      const last = runs.at(-1);
      return last?.text === text
        ? [...runs.slice(0, -1), { text, n: last.n + 1 }]
        : [...runs, { text, n: 1 }];
    }, [])
    .map((r) => (r.n === 1 ? r.text : `${r.text}(${String(r.n)})`))
    .join(' ');

export const diceText = ([a, b]: Dice): string => `${String(a)}-${String(b)}`;

export const pointsText = (n: number): string => (n === 1 ? '1 point' : `${String(n)} points`);

const isDie = (n: number): n is Die => Number.isInteger(n) && n >= 1 && n <= 6;
const isOwn = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= POINTS;

const MOVE = /^(bar|\d{1,2})\/(off|\d{1,2})\*?(?:\((\d)\))?$/;

/** `8/5*`, `bar/20`, `4/off(6)` in the mover's own numbering: die = pips unless `(n)` says otherwise. */
export const parseMove = (seat: Seat, text: string, rules: VariantRules): Result<Move, string> => {
  const m = MOVE.exec(text);
  if (m === null) return err(`bad move "${text}"`);
  const [, fromText = '', toText = '', dieText] = m;
  const fromOwn = fromText === 'bar' ? BAR_PIPS : Number(fromText);
  const toOwn = toText === 'off' ? 0 : Number(toText);
  const die = dieText === undefined ? fromOwn - toOwn : Number(dieText);
  if ((fromText !== 'bar' && !isOwn(fromOwn)) || (toText !== 'off' && !isOwn(toOwn)))
    return err(`point out of range in "${text}"`);
  if (!isDie(die)) return err(`die out of range in "${text}"`);
  const from: From = fromText === 'bar' ? 'bar' : rules.absOf(seat, fromOwn);
  const to: To = toText === 'off' ? 'off' : rules.absOf(seat, toOwn);
  return ok({ from, to, die });
};

type Placement = Readonly<{ seat: Seat; abs: PointIndex; count: number }>;
const ENTRY = /^(\d{1,2}):(\d{1,2})$/;
const COUNTS = /^(\d{1,2})\/(\d{1,2})$/;

const parseSide = (
  seat: Seat,
  text: string,
  rules: VariantRules,
): Result<ReadonlyArray<Placement>, string> => {
  const label = seat === 0 ? 'L:' : 'D:';
  if (!text.startsWith(label)) return err(`expected "${label}" in "${text}"`);
  const tokens = text
    .slice(label.length)
    .trim()
    .split(/\s+/)
    .filter((t) => t !== '');
  return tokens.reduce<Result<ReadonlyArray<Placement>, string>>((acc, token) => {
    if (!acc.ok) return acc;
    const m = ENTRY.exec(token);
    const [, ownText = '', countText = ''] = m ?? [];
    const own = Number(ownText);
    if (m === null || !isOwn(own)) return err(`bad checker entry "${token}"`);
    return ok([...acc.value, { seat, abs: rules.absOf(seat, own), count: Number(countText) }]);
  }, ok([]));
};

const parseCounts = (label: string, text: string): Result<Pair<number>, string> => {
  const m = text.startsWith(label) ? COUNTS.exec(text.slice(label.length).trim()) : null;
  const [, a = '', b = ''] = m ?? [];
  return m === null ? err(`expected "${label} a/b" in "${text}"`) : ok([Number(a), Number(b)]);
};

/** The position notation above; structural only (a sandbox may want fewer than 15 checkers). */
export const parsePosition = (text: string, rules: VariantRules): Result<Board, string> => {
  const [l, d, bar, off, ...extra] = text.split('|').map((p) => p.trim());
  if (
    l === undefined ||
    d === undefined ||
    bar === undefined ||
    off === undefined ||
    extra.length > 0
  )
    return err('expected "L: … | D: … | bar a/b | off a/b"');
  const light = parseSide(0, l, rules);
  if (!light.ok) return light;
  const dark = parseSide(1, d, rules);
  if (!dark.ok) return dark;
  const bars = parseCounts('bar', bar);
  if (!bars.ok) return bars;
  const offs = parseCounts('off', off);
  if (!offs.ok) return offs;
  const points = [...light.value, ...dark.value].reduce(
    (pts, p) =>
      pts.map((st, i) =>
        i === p.abs ? [...st, ...Array.from({ length: p.count }, () => p.seat)] : st,
      ),
    emptyBoard().points,
  );
  return ok({ points, bar: bars.value, off: offs.value });
};

/** The inverse of `parsePosition`: each side's points in descending own order. */
export const formatPosition = (board: Board, rules: VariantRules): string => {
  const side = (seat: Seat, label: string): string =>
    [
      label,
      ...POINT_INDICES.map((abs): Entry => ({
        own: rules.ownOf(seat, abs),
        n: stackAt(board, abs).filter((s) => s === seat).length,
      }))
        .filter((e) => e.n > 0)
        .sort((a, b) => b.own - a.own)
        .map((e) => `${String(e.own)}:${String(e.n)}`),
    ].join(' ');
  return `${side(0, 'L:')} | ${side(1, 'D:')} | bar ${board.bar.join('/')} | off ${board.off.join('/')}`;
};
