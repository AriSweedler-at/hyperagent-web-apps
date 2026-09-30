// The mock dice of example (j) (docs/design/ui-sandbox.md §7): a die is a 3x3 grid of pips, one
// `<i>` per pip placed by its cell, so the two faces in the ears read as dice with no image and no
// font. Pure: markup as data over a face; the boot (main.ts) swaps the faces on a roll. The pips
// are the standard faces: 1 the centre; 2 and 3 the diagonal; 4 the corners; 5 the corners and the
// centre; 6 the two columns.
import { safeHtml, type SafeHtml } from '../../../shared/edge/dom.ts';
import type { Die } from '../../../shared/lib/appClip.ts';

/** A cell of the 3x3 grid: row and column, 1 to 3. */
export type Cell = readonly [row: number, col: number];
const TL: Cell = [1, 1];
const TR: Cell = [1, 3];
const ML: Cell = [2, 1];
const C: Cell = [2, 2];
const MR: Cell = [2, 3];
const BL: Cell = [3, 1];
const BR: Cell = [3, 3];

/** The pips per face, as a die is printed. */
export const PIPS: Readonly<Record<Die, ReadonlyArray<Cell>>> = {
  1: [C],
  2: [TR, BL],
  3: [TR, C, BL],
  4: [TL, TR, BL, BR],
  5: [TL, TR, C, BL, BR],
  6: [TL, ML, BL, TR, MR, BR],
};

/** The pips of a face: one `<i class="pip">` per cell, placed by `grid-area`. */
export const pipsMarkup = (face: Die): SafeHtml =>
  safeHtml`${PIPS[face].map(
    ([row, col]) =>
      safeHtml`<i class="pip" style="grid-area: ${String(row)} / ${String(col)}"></i>`,
  )}`;

/** A die as a 36px grid, `data-face` for the eye and the tests. */
export const dieMarkup = (name: string, face: Die): SafeHtml =>
  safeHtml`<span class="die" data-die="${name}" data-face="${String(face)}" aria-label="${`die ${name} shows ${String(face)}`}">${pipsMarkup(face)}</span>`;
