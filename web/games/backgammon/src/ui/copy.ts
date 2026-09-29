// The status line's building blocks (design §2.4 "The copy budget"; the owner, 2026-09-28: "if
// there is a status line that interpolates information, cap the width of interpolated information
// & use that as a building block"). A status line is a template: literal text and blocks. A block
// is an interpolated value with a cap, the widest it can be in characters, derived from the
// engine's constants (a roll is `6-6`, the cube tops at CUBE_MAX, a game pays at most a
// backgammon on the cube's top) or, for a name, chosen per template: the shell stores up to
// NAME_MAX characters, a template gives the name the room its literals leave, and `name` clips
// it there with one `…`. `render` writes the line and `worstCase` sums the literals and the caps,
// so a template never renders longer than its worst case, and copy-budget.test.ts holds every
// template's worst case to the strip's budget with no runtime input at all.
import {
  CUBE_MAX,
  diceText,
  expandDice,
  POINT_INDICES,
  type Dice,
  type Die,
  type Multiplier,
} from '../engine/index.ts';

/** An interpolated value at most `cap` characters wide; `kind` names it in a failure message. */
export type Block = Readonly<{ kind: string; cap: number; text: string }>;
export type Piece = string | Block;
/** A status line: literal text and blocks, rendered by `render`, bounded by `worstCase`. */
export type Template = ReadonlyArray<Piece>;

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
/** The graphemes of `text`: what a cut must not split (an accented letter, a flag, a joined emoji). */
const graphemes = (text: string): ReadonlyArray<string> =>
  Array.from(segmenter.segment(text), (s: Readonly<Intl.SegmentData>) => s.segment);

/** The longest prefix of whole `parts` within `room` characters. */
const prefixWithin = (parts: ReadonlyArray<string>, room: number): string =>
  parts.reduce<Readonly<{ text: string; open: boolean }>>(
    (acc, part) =>
      acc.open && acc.text.length + part.length <= room
        ? { text: acc.text + part, open: true }
        : { text: acc.text, open: false },
    { text: '', open: true },
  ).text;

/**
 * `text` at most `cap` characters: whole when it fits, else its first graphemes and one `…`
 * inside the cap, never a space before the ellipsis. A cap under 1 leaves nothing.
 */
export const clip = (text: string, cap: number): string => {
  if (cap < 1) return '';
  if (text.length <= cap) return text;
  return `${prefixWithin(graphemes(text), cap - 1).trimEnd()}…`;
};

/** A count in words, `none` to `four`: the status line and the aria labels. */
export const COUNT_WORDS: ReadonlyArray<string> = ['none', 'one', 'two', 'three', 'four'];
/** The engine's `Multiplier` is 1 | 2 | 3: a backgammon triples the cube. */
const MULTIPLIER_MAX: Multiplier = 3;

/** The widest each block gets, in characters, from the engine's constants. */
export const CAPS = {
  /** `6-6` (`diceText`). */
  roll: diceText([6, 6]).length,
  /** One face. */
  die: String(6).length,
  /** The most moves a roll holds: a double's four (`expandDice`). */
  count: String(expandDice([6, 6]).length).length,
  /** The count in words, `none` to `four` (`three` the widest). */
  countWord: Math.max(...COUNT_WORDS.map((w) => w.length)),
  /** `64` (`CUBE_MAX`). */
  cube: String(CUBE_MAX).length,
  /** The points a game pays at most: a backgammon on the cube's top. */
  points: String(MULTIPLIER_MAX * CUBE_MAX).length,
  /** A place in the player's own numbering: a point (`24`), `bar` or `off`. */
  place: Math.max(String(POINT_INDICES.length).length, 'bar'.length, 'off'.length),
  /** `6+3`: the two dice of a non-double roll a two-order move spends (a double has one order). */
  pair: expandDice([6, 5]).map(String).join('+').length,
} as const;

const block = (kind: string, cap: number, text: string): Block => ({
  kind,
  cap,
  text: clip(text, cap),
});

/** The roll as `diceText` writes it, `6-5`; '' before a roll. */
export const roll = (dice: Dice | null): Block =>
  block('roll', CAPS.roll, dice === null ? '' : diceText(dice));
export const die = (d: Die): Block => block('die', CAPS.die, String(d));
/** A count of moves, `2`. */
export const count = (n: number): Block => block('count', CAPS.count, String(n));
/** A count of moves in words, `three`; a digit past `four`. */
export const countWord = (n: number): Block =>
  block('countWord', CAPS.countWord, COUNT_WORDS[n] ?? String(n));
/** A cube value, `64`. */
export const cube = (value: number): Block => block('cube', CAPS.cube, String(value));
/** Points won, as a number: `2`. */
export const points = (n: number): Block => block('points', CAPS.points, String(n));
/** A place in the player's own numbering, `13`, `bar`, `off`. */
export const place = (p: string): Block => block('place', CAPS.place, p);
/** The dice a chain spends, `6+3`. */
export const pair = (dice: ReadonlyArray<Die>): Block =>
  block('pair', CAPS.pair, dice.map(String).join('+'));
/** A player's name in `cap` characters: whole when it fits, else clipped with `…`. */
export const name = (cap: number, n: string): Block => block('name', cap, n);

/** The line a template writes. */
export const render = (t: Template): string =>
  t.map((p) => (typeof p === 'string' ? p : p.text)).join('');

/** The longest line a template can write: its literals plus every block's cap. */
export const worstCase = (t: Template): number =>
  t.reduce<number>((n, p) => n + (typeof p === 'string' ? p.length : p.cap), 0);

/** The template spelled for a message: its literals, and `{kind:cap}` for each block. */
export const shape = (t: Template): string =>
  t.map((p) => (typeof p === 'string' ? p : `{${p.kind}:${String(p.cap)}}`)).join('');
