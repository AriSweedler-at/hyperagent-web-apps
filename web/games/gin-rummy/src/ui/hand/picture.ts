// The hand's arrangement as the cells show it (docs/design/gin-arrangement-and-discards.md §5):
// groups in order, then the loose cards, and which cards sit in a meld the player made by hand
// (arrange.ts). The engine's melding (`View.me.melds`/`deadwood`) is recomputed on every move, so
// painting it directly rearranged the hand on an accept and on a discard; the owner asked that
// cards move only at the start of their turn, on an Arrange choice, on a long press or on a
// chooser pick. `settlePicture` is that rule: a kept picture survives every view whose on-table
// cards are the same, gains an accepted card at its end and loses a discarded card in place.
// `rowsOf` mirrors the grid's dense auto-placement (§6) so the paint can say how many rows the
// phone lays the hand in. Pure; imported by ui/state.ts, ui/hand/SlotHandView.ts, ui/render.ts
// and stories/catalogue.ts. Not saved, not on the wire.
import { idsOf } from '../../engine/cards.ts';
import { isValidMeldGroup } from '../../engine/melds.ts';
import { HAND_SIZE, type Cards } from '../../engine/types.ts';
import type { DrawStage } from './draw.ts';
import type { HandModel } from './HandView.ts';

export type Picture = Readonly<{
  groups: ReadonlyArray<Cards>;
  loose: Cards;
  /** The ids of the cards in the groups the player made by hand (arrange.ts). */
  human: ReadonlyArray<string>;
}>;

/** The hand grid's columns: six on a phone, eleven from 900px (theme.css). */
export const PHONE_COLUMNS = 6;
export const DESKTOP_COLUMNS = 11;

export const cardsOf = (p: Picture): Cards => [...p.groups.flat(), ...p.loose];

/** The cards the ten slots hold: the drawn card sits in the ghost cell, not on the table, while `shown`. */
export const onTable = (v: HandModel, stage: DrawStage | null): Cards =>
  stage?.kind === 'shown' ? v.me.hand.filter((c) => c.id !== stage.cardId) : v.me.hand;

/**
 * The engine's melding over the on-table cards, nothing made by hand. While `shown` the view
 * melds eleven cards; the drawn card leaves its meld, and what remains is a group only where it
 * is still a meld.
 */
export const engineOf = (v: HandModel, stage: DrawStage | null): Picture => {
  const off = stage?.kind === 'shown' ? stage.cardId : null;
  const melds: ReadonlyArray<Cards> = v.me.melds.map((m) => m.filter((c) => c.id !== off));
  const broken = melds.filter((m) => !isValidMeldGroup(m)).flat();
  return {
    groups: melds.filter(isValidMeldGroup),
    loose: [...v.me.deadwood.filter((c) => c.id !== off), ...broken],
    human: [],
  };
};

const sameIds = (a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/** Group by group, then the loose cards, then the hand-made marks: the same ids in the same order. */
export const samePicture = (a: Picture, b: Picture): boolean =>
  a.groups.length === b.groups.length &&
  a.groups.every((g, i) => sameIds(idsOf(g), idsOf(b.groups[i] ?? []))) &&
  sameIds(idsOf(a.loose), idsOf(b.loose)) &&
  sameIds([...a.human].sort(), [...b.human].sort());

/** `p` without the card `id`: it leaves its group or the loose cards, nothing else moves. */
const without = (p: Picture, id: string): Picture => ({
  groups: p.groups.map((g): Cards => g.filter((c) => c.id !== id)).filter((g) => g.length > 0),
  loose: p.loose.filter((c) => c.id !== id),
  human: p.human.filter((h) => h !== id),
});

/**
 * The picture for a freshly painted view, from the one on screen; `fresh` is the arrangement the
 * player asked for (arrange.ts), computed only when a rule needs it. (a) No picture yet, or my
 * upcard or draw phase: `fresh` (the turn-start arrangement; deterministic, so an undo, a guest's
 * re-render and a resume land on the same picture). (b) The same cards on the table: the picture
 * is kept (a selection, the opponent's moves, a draw while the ghost cell holds the card). (c)
 * One card more: it is appended loose (an accept takes the ghost cell's hole). (d) One card
 * fewer: it leaves in place (a discard or a knock; a group left under three paints loose). (e)
 * Anything else (a deal, a resume, a pass-and-play seat switch): `fresh`.
 */
export const settlePicture = (
  prev: Picture | null,
  v: HandModel,
  stage: DrawStage | null,
  fresh: () => Picture,
): Picture => {
  const table = onTable(v, stage);
  const turnStart = v.isMyTurn && (v.phase === 'draw' || v.phase === 'upcard');
  if (prev === null || turnStart) return fresh();
  const before = cardsOf(prev);
  const tableIds = new Set(idsOf(table));
  const beforeIds = new Set(idsOf(before));
  const added = table.filter((c) => !beforeIds.has(c.id));
  const gone = before.filter((c) => !tableIds.has(c.id));
  if (added.length === 0 && gone.length === 0) return prev;
  const [one] = added;
  const [lost] = gone;
  if (one !== undefined && added.length === 1 && gone.length === 0)
    return { ...prev, loose: [...prev.loose, one] };
  if (lost !== undefined && gone.length === 1 && added.length === 0) return without(prev, lost.id);
  return fresh();
};

/**
 * The grid items' widths in DOM order: each group's length, one per loose card, and one for the
 * ghost cell, which the grid keeps while the table holds ten cards or fewer.
 */
export const spansOf = (p: Picture): ReadonlyArray<number> => [
  ...p.groups.map((g) => g.length),
  ...p.loose.map(() => 1),
  ...(cardsOf(p).length <= HAND_SIZE ? [1] : []),
];

type Placed = Readonly<{ taken: ReadonlySet<string>; rows: ReadonlyArray<number> }>;
const key = (row: number, col: number): string => `${String(row)}:${String(col)}`;
const range = (n: number): ReadonlyArray<number> => Array.from({ length: n }, (_, i) => i);
const free = (taken: ReadonlySet<string>, row: number, cols: ReadonlyArray<number>): boolean =>
  cols.every((c) => !taken.has(key(row, c)));

/** The first row, top-down, where `cols` are free in `rows` consecutive rows. */
const firstRow = (
  taken: ReadonlySet<string>,
  cols: ReadonlyArray<number>,
  rows: number,
  row = 0,
): number =>
  range(rows).every((r) => free(taken, row + r, cols)) ? row : firstRow(taken, cols, rows, row + 1);

/** The first column, left to right, of `span` free cells in `row`, or null when none fits. */
const firstCol = (
  taken: ReadonlySet<string>,
  row: number,
  span: number,
  cols: number,
): number | null =>
  range(cols - span + 1).find((c) =>
    free(
      taken,
      row,
      range(span).map((k) => c + k),
    ),
  ) ?? null;

const withCells = (
  rows: ReadonlyArray<number>,
  row: number,
  count: number,
): ReadonlyArray<number> =>
  range(Math.max(rows.length, row + 1)).map((r) => (rows[r] ?? 0) + (r === row ? count : 0));

/**
 * Place one item where the grid's dense flow would: the first (row, column), rows top-down and
 * columns left to right, where its span fits inside one row. An item wider than the grid (a run
 * of seven or more on a phone) takes every column of the first two free rows and wraps inside.
 */
const place = (acc: Placed, span: number, cols: number): Placed => {
  if (span > cols) {
    const row = firstRow(acc.taken, range(cols), 2);
    const cells = range(2).flatMap((r) => range(cols).map((c) => key(row + r, c)));
    return {
      taken: new Set([...acc.taken, ...cells]),
      rows: withCells(withCells(acc.rows, row, cols), row + 1, span - cols),
    };
  }
  const fit = (row: number): Readonly<{ row: number; col: number }> => {
    const col = firstCol(acc.taken, row, span, cols);
    return col === null ? fit(row + 1) : { row, col };
  };
  const at = fit(0);
  return {
    taken: new Set([...acc.taken, ...range(span).map((k) => key(at.row, at.col + k))]),
    rows: withCells(acc.rows, at.row, span),
  };
};

/**
 * The cells in each row when `spans` (DOM order) are laid out in `cols` columns under dense
 * auto-placement: the oracle e2e/gin-stories.spec.ts compares with the browser on every story.
 */
export const rowsOf = (spans: ReadonlyArray<number>, cols: number): ReadonlyArray<number> =>
  spans.reduce<Placed>((acc, span) => place(acc, span, cols), { taken: new Set(), rows: [] }).rows;

/** The rows a phone lays `p` in: the `#hand[data-rows]` value. */
export const phoneRows = (p: Picture): number => rowsOf(spansOf(p), PHONE_COLUMNS).length;
