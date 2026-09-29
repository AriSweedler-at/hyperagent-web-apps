// The board's two `grid-template-areas` strings against their pure twin (docs/design/backgammon-board.md
// §7, §10 risk 5). web/games/backgammon/theme.css places every point, bar half, the dice and the
// trays by area name in two templates (the phone's fourteen rows, the desktop's two inside
// `@media (min-width: 900px)`, a query list a phone held sideways joins); a misspelt or misplaced
// name there collapses the grid with no error, and no unit test sees a stylesheet. This suite
// parses the board's strings out of the built CSS (`dist/shared/assets/backgammon-<hash>.css`)
// and asserts that every name forms exactly one rectangle and that the cells and the visual row
// order are the ones web/games/backgammon/src/ui/board/layout.ts reports, which the geometry e2e
// and the painter tests take as their oracle. The file holds a third and a fourth
// `grid-template-areas`: the two chrome grids a phone held sideways lays the table screen in (the
// strip, the board and the rail from 714px wide; the strip, the board and a button row under it),
// which name no place; the board's templates are the declarations that name `barTop`, and the
// chrome grids are the ones that do not, pinned here cell by cell (`RAIL_CELLS`, `ROWS_CELLS`)
// since a misspelt or moved name there tears the sideways table just as silently (a `board` that
// is no rectangle drops the whole declaration; `satus` for `status` slides the board off the left
// edge). Runs on dist/ after the build (npm run test:site).
import { expect, test } from 'vitest';

import {
  FIXED_AREAS,
  POINT_AREAS,
  areaOf,
  boardLayout,
  parseAreas,
  rowOrder,
  type Area,
  type Cell,
  type Layout,
} from '../../web/games/backgammon/src/ui/board/layout.ts';
import { describeDist, distFiles, readDist } from './dist.ts';

const THEME = /^shared\/assets\/backgammon-[\w-]+\.css$/;
const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;
/** Every `grid-template-areas: "..." "..." ...;` in source order. */
const AREAS_DECLARATION = /grid-template-areas\s*:\s*((?:\s*(?:"[^"]*"|'[^']*'))+)\s*;/g;
const STRING = /"([^"]*)"|'([^']*)'/g;

/** The rows of one declaration: each quoted string split on whitespace. */
const rowsOf = (declaration: string): ReadonlyArray<ReadonlyArray<string>> =>
  [...declaration.matchAll(STRING)].map((m) => (m[1] ?? m[2] ?? '').trim().split(/\s+/));

type Rows = ReadonlyArray<ReadonlyArray<string>>;
/** A board template names `barTop`; the landscape chrome grid (`opp badge status rail1` and so on) does not. */
const isBoard = (rows: Rows): boolean => rows.some((row) => row.includes('barTop'));
/** Every `grid-template-areas` declaration of the built CSS, in source order. */
const declarationsIn = (css: string): ReadonlyArray<Rows> =>
  [...css.replace(CSS_COMMENT, ' ').matchAll(AREAS_DECLARATION)].map((m) => rowsOf(m[1] ?? ''));
/** The board's templates in source order: the phone's first, the desktop's second. */
const templatesIn = (css: string): ReadonlyArray<Rows> => declarationsIn(css).filter(isBoard);
/** The chrome grids a phone held sideways lays `#tableScreen` in (theme.css: the rail's from 714px wide, then the rows' under it), in source order. */
const chromeIn = (css: string): ReadonlyArray<Rows> =>
  declarationsIn(css).filter((rows) => !isBoard(rows));

/**
 * The rail's chrome grid as designed (design §3.1 landscape; 1-based, as `parseAreas` reports
 * the cells): six rows of six; one strip over the board holding the opponent's strip, the badge,
 * the status line, my strip and the roll slot; the board five rows by five columns under it; the
 * rail's five slots down the last column, the first two rows tall (the menu reaches up into the
 * strip's row), End turn (rail4, an empty row while the button is hidden; design §1 "Turn end")
 * over Undo at the board's foot.
 */
const RAIL_CELLS: Readonly<Record<string, Cell>> = {
  opp: { row: 1, col: 1, rowSpan: 1, colSpan: 1 },
  badge: { row: 1, col: 2, rowSpan: 1, colSpan: 1 },
  status: { row: 1, col: 3, rowSpan: 1, colSpan: 1 },
  me: { row: 1, col: 4, rowSpan: 1, colSpan: 1 },
  slot: { row: 1, col: 5, rowSpan: 1, colSpan: 1 },
  rail1: { row: 1, col: 6, rowSpan: 2, colSpan: 1 },
  board: { row: 2, col: 1, rowSpan: 5, colSpan: 5 },
  rail2: { row: 3, col: 6, rowSpan: 1, colSpan: 1 },
  rail3: { row: 4, col: 6, rowSpan: 1, colSpan: 1 },
  rail4: { row: 5, col: 6, rowSpan: 1, colSpan: 1 },
  rail5: { row: 6, col: 6, rowSpan: 1, colSpan: 1 },
};
/**
 * The rows' chrome grid, under 714px wide: three rows of six; the same strip, the opponent's strip
 * spanning the first two columns (the menu's 44px and the rest of its width); the board the whole
 * second row; the button row under it with the menu, the sound button, two free cells (CSS's `.`,
 * one rectangle to `parseAreas`), Undo ending my strip's column and End turn ending the slot's.
 */
const ROWS_CELLS: Readonly<Record<string, Cell>> = {
  opp: { row: 1, col: 1, rowSpan: 1, colSpan: 2 },
  badge: { row: 1, col: 3, rowSpan: 1, colSpan: 1 },
  status: { row: 1, col: 4, rowSpan: 1, colSpan: 1 },
  me: { row: 1, col: 5, rowSpan: 1, colSpan: 1 },
  slot: { row: 1, col: 6, rowSpan: 1, colSpan: 1 },
  board: { row: 2, col: 1, rowSpan: 1, colSpan: 6 },
  menu: { row: 3, col: 1, rowSpan: 1, colSpan: 1 },
  sound: { row: 3, col: 2, rowSpan: 1, colSpan: 1 },
  '.': { row: 3, col: 3, rowSpan: 1, colSpan: 2 },
  undo: { row: 3, col: 5, rowSpan: 1, colSpan: 1 },
  done: { row: 3, col: 6, rowSpan: 1, colSpan: 1 },
};
/** The two chrome grids in source order, each with its row count and its cells. */
const CHROME_GRIDS: ReadonlyArray<
  readonly [name: string, rows: number, cells: Readonly<Record<string, Cell>>]
> = [
  ['the rail', 6, RAIL_CELLS],
  ['the rows', 3, ROWS_CELLS],
];

const LAYOUTS: ReadonlyArray<Layout> = ['phone', 'desktop'];

describeDist('backgammon board grid', (root) => {
  const theme = distFiles(root).filter((file) => THEME.test(file));
  const css = theme.map((file) => readDist(root, file)).join('\n');
  const templates = templatesIn(css);
  const chrome = chromeIn(css);

  test('the built theme exists and declares exactly two board templates (the chrome grids name no place): the phone, then the desktop', () => {
    expect(theme, 'dist/shared/assets/backgammon-<hash>.css').toHaveLength(1);
    expect(templates).toHaveLength(2);
    expect(templates[0]).toHaveLength(14);
    expect(templates[1]).toHaveLength(2);
  });

  test('the sideways chrome grids: two declarations, the rail (six rows of six) then the rows (three of six), every name one rectangle, the cells as designed', () => {
    expect(chrome).toHaveLength(CHROME_GRIDS.length);
    CHROME_GRIDS.forEach(([name, rowCount, cells], index) => {
      const rows = chrome[index] ?? [];
      expect(rows, name).toHaveLength(rowCount);
      rows.forEach((row) => {
        expect(row, name).toHaveLength(6);
      });
      const parsed = parseAreas(rows);
      expect(parsed.ok, parsed.ok ? name : `${name}: ${parsed.error}`).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.value, name).toEqual(cells);
    });
  });

  LAYOUTS.forEach((layout, index) => {
    const rows = templates[index] ?? [];

    test(`${layout}: every area is one rectangle and the names are the 24 points, the bars, the trays${layout === 'phone' ? ' and the dice' : ''}`, () => {
      const parsed = parseAreas(rows);
      expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true);
      if (!parsed.ok) return;
      const expected = [...POINT_AREAS, ...FIXED_AREAS, ...(layout === 'phone' ? ['dice'] : [])];
      expect(Object.keys(parsed.value).sort()).toEqual([...expected].sort());
    });

    test(`${layout}: the cells are the ones boardLayout reports, for both seats`, () => {
      const parsed = parseAreas(rows);
      if (!parsed.ok) return;
      ([0, 1] as const).forEach((seat) => {
        const cells = boardLayout(layout, seat);
        (Object.keys(cells) as ReadonlyArray<Area>)
          // The desktop's dice are not a template area: #dice overrides its area to the bar column.
          .filter((place) => layout === 'phone' || place !== 'dice')
          .forEach((place) => {
            expect(cells[place], `${place} for seat ${String(seat)}`).toEqual(
              parsed.value[areaOf(place, seat)],
            );
          });
      });
    });

    test(`${layout}: the visual row order is rowOrder's`, () => {
      const seen = rows.map((row) =>
        row
          .filter((name, i) => row.indexOf(name) === i)
          .map((name) => {
            // A template name back to seat 0's place: `oN` is `point-N`, the trays are Light near.
            const point = /^o(\d+)$/.exec(name);
            if (point !== null) return `point-${point[1] ?? ''}`;
            if (name === 'offNear') return 'offLight';
            if (name === 'offFar') return 'offDark';
            return name;
          }),
      );
      expect(seen).toEqual(rowOrder(layout, 0));
    });
  });
});
