// The board's two `grid-template-areas` strings against their pure twin (docs/design/backgammon-board.md
// §7, §10 risk 5). web/games/backgammon/theme.css places every point, bar half, the dice and the
// trays by area name in two templates (the phone's fourteen rows, the desktop's two inside
// `@media (min-width: 900px)`, a query list a phone held sideways joins); a misspelt or misplaced
// name there collapses the grid with no error, and no unit test sees a stylesheet. This suite
// parses the board's strings out of the built CSS (`dist/shared/assets/backgammon-<hash>.css`)
// and asserts that every name forms exactly one rectangle and that the cells and the visual row
// order are the ones web/games/backgammon/src/ui/board/layout.ts reports, which the geometry e2e
// and the painter tests take as their oracle. The file holds a third `grid-template-areas`: the
// chrome grid a phone held sideways lays the table screen in (the strip, the board, the rail),
// which names no place; the board's templates are the declarations that name `barTop`, and the
// chrome grid is the one that does not, pinned here cell by cell (`CHROME_CELLS`) since a misspelt
// or moved name there tears the sideways table just as silently (a `board` that is no rectangle
// drops the whole declaration; `satus` for `status` slides the board off the left edge). Runs on
// dist/ after the build (npm run test:site).
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
/** The chrome grid a phone held sideways lays `#tableScreen` in (theme.css, `(min-width: 714px)` sideways). */
const chromeIn = (css: string): ReadonlyArray<Rows> =>
  declarationsIn(css).filter((rows) => !isBoard(rows));

/**
 * The chrome grid's cells as designed (design §3.1 landscape; 1-based, as `parseAreas` reports
 * them): five rows of six; one strip over the board holding the opponent's strip, the badge, the
 * status line, my strip and the roll slot; the board four rows by five columns under it; the
 * rail's four slots down the last column, the first two rows tall (the menu reaches up into the
 * strip's row), Undo at the board's foot.
 */
const CHROME_CELLS: Readonly<Record<string, Cell>> = {
  opp: { row: 1, col: 1, rowSpan: 1, colSpan: 1 },
  badge: { row: 1, col: 2, rowSpan: 1, colSpan: 1 },
  status: { row: 1, col: 3, rowSpan: 1, colSpan: 1 },
  me: { row: 1, col: 4, rowSpan: 1, colSpan: 1 },
  slot: { row: 1, col: 5, rowSpan: 1, colSpan: 1 },
  rail1: { row: 1, col: 6, rowSpan: 2, colSpan: 1 },
  board: { row: 2, col: 1, rowSpan: 4, colSpan: 5 },
  rail2: { row: 3, col: 6, rowSpan: 1, colSpan: 1 },
  rail3: { row: 4, col: 6, rowSpan: 1, colSpan: 1 },
  rail4: { row: 5, col: 6, rowSpan: 1, colSpan: 1 },
};

const LAYOUTS: ReadonlyArray<Layout> = ['phone', 'desktop'];

describeDist('backgammon board grid', (root) => {
  const theme = distFiles(root).filter((file) => THEME.test(file));
  const css = theme.map((file) => readDist(root, file)).join('\n');
  const templates = templatesIn(css);
  const chrome = chromeIn(css);

  test('the built theme exists and declares exactly two board templates (the chrome grid names no place): the phone, then the desktop', () => {
    expect(theme, 'dist/shared/assets/backgammon-<hash>.css').toHaveLength(1);
    expect(templates).toHaveLength(2);
    expect(templates[0]).toHaveLength(14);
    expect(templates[1]).toHaveLength(2);
  });

  test('the sideways chrome grid: one declaration, five rows of six, every name one rectangle, the cells as designed', () => {
    expect(chrome).toHaveLength(1);
    const rows = chrome[0] ?? [];
    expect(rows).toHaveLength(5);
    rows.forEach((row) => {
      expect(row).toHaveLength(6);
    });
    const parsed = parseAreas(rows);
    expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual(CHROME_CELLS);
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
