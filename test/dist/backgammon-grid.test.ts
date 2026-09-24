// The board's two `grid-template-areas` strings against their pure twin (docs/design/backgammon-board.md
// §7, §10 risk 5). web/games/backgammon/theme.css places every point, bar half, the dice and the
// trays by area name in two templates (the phone's fourteen rows, the desktop's two inside
// `@media (min-width: 900px)`); a misspelt or misplaced name there collapses the grid with no
// error, and no unit test sees a stylesheet. This suite parses both strings out of the built CSS
// (`dist/shared/assets/backgammon-<hash>.css`) and asserts that every name forms exactly one
// rectangle and that the cells and the visual row order are the ones
// web/games/backgammon/src/ui/board/layout.ts reports, which the geometry e2e and the painter
// tests take as their oracle. Runs on dist/ after the build (test:dist).
import { expect, test } from 'vitest';

import {
  FIXED_AREAS,
  POINT_AREAS,
  areaOf,
  boardLayout,
  parseAreas,
  rowOrder,
  type Area,
  type Layout,
} from '../../web/games/backgammon/src/ui/board/layout.ts';
import { describeDist, distFiles, readDist } from './dist.ts';

const THEME = /^shared\/assets\/backgammon-[\w-]+\.css$/;
const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;
/** Every `grid-template-areas: "..." "..." ...;` in source order: the phone's first, the desktop's second. */
const AREAS_DECLARATION = /grid-template-areas\s*:\s*((?:\s*(?:"[^"]*"|'[^']*'))+)\s*;/g;
const STRING = /"([^"]*)"|'([^']*)'/g;

/** The rows of one declaration: each quoted string split on whitespace. */
const rowsOf = (declaration: string): ReadonlyArray<ReadonlyArray<string>> =>
  [...declaration.matchAll(STRING)].map((m) => (m[1] ?? m[2] ?? '').trim().split(/\s+/));

/** Both templates as the built CSS states them, in source order. */
const templatesIn = (css: string): ReadonlyArray<ReadonlyArray<ReadonlyArray<string>>> =>
  [...css.replace(CSS_COMMENT, ' ').matchAll(AREAS_DECLARATION)].map((m) => rowsOf(m[1] ?? ''));

const LAYOUTS: ReadonlyArray<Layout> = ['phone', 'desktop'];

describeDist('backgammon board grid', (root) => {
  const theme = distFiles(root).filter((file) => THEME.test(file));
  const css = theme.map((file) => readDist(root, file)).join('\n');
  const templates = templatesIn(css);

  test('the built theme exists and declares exactly two templates: the phone, then the desktop', () => {
    expect(theme, 'dist/shared/assets/backgammon-<hash>.css').toHaveLength(1);
    expect(templates).toHaveLength(2);
    expect(templates[0]).toHaveLength(14);
    expect(templates[1]).toHaveLength(2);
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
