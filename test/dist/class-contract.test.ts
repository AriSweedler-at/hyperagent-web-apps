// The CSS <-> TS class contract (docs/MIGRATION.md step 14; docs/ARCHITECTURE.md "Conventions for
// small diffs"): every class a game's TypeScript names has a rule in the stylesheet its page links,
// and every class that stylesheet styles is named by TypeScript or carried by the page markup. What
// the extraction in test/dist/classes.ts cannot see (names a helper builds), what is a hook with no
// rule, and what is dead CSS awaiting step 15 is a row in web/shared/styles/CONTRACT.md, and each
// row is checked against the tree so it cannot go stale. Runs on dist/ after the build (test:dist).
import { expect, test } from 'vitest';

import { REGISTRY } from '../../tools/games.ts';
import {
  GAMES,
  cssClasses,
  markupClasses,
  readContract,
  rowsFor,
  stylesheets,
  tsClasses,
  type Row,
} from './classes.ts';
import { describeDist } from './dist.ts';

const names = (rows: ReadonlyArray<Row>): ReadonlyArray<string> => rows.flatMap((r) => r.names);
/**
 * How many class names the built CSS must yield; the per-game TypeScript and markup floors are
 * each game's `contractFloors` row in tools/games.ts (why a floor: so an extraction that silently
 * finds nothing fails here rather than passing the two orphan tests vacuously).
 */
const CSS_FLOOR = 100;
/** Rows with a `Toggled by` and no `Styled in`: TS names the class, no rule is expected. */
const behaviourOnly = (rows: ReadonlyArray<Row>): ReadonlyArray<Row> =>
  rows.filter((r) => r.toggledBy !== '' && r.styledIn === '');
/** Rows with a `Styled in`: the class has a rule, whether TS builds its name or nothing names it. */
const styled = (rows: ReadonlyArray<Row>): ReadonlyArray<Row> =>
  rows.filter((r) => r.styledIn !== '');

describeDist('CSS <-> TS class contract', (root) => {
  const contract = readContract();

  test('CONTRACT.md has rows, each with an owner the tree knows and one or more names', () => {
    expect(contract.length).toBeGreaterThan(0);
    contract.forEach((row) => {
      expect([...GAMES, 'shared']).toContain(row.owner);
      expect(row.kind).toBe('class');
      expect(row.names.length).toBeGreaterThan(0);
      expect(row.toggledBy !== '' || row.styledIn !== '', `${row.names.join(' ')}: empty row`).toBe(
        true,
      );
    });
  });

  GAMES.forEach((game) => {
    const rows = rowsFor(contract, game);
    const floors = REGISTRY[game].contractFloors;
    const ts = tsClasses(game);
    const tsNames = ts.map(({ name }) => name);
    const markup = markupClasses(root, game);
    const css = cssClasses(root, game);

    test(`${game}: the page links the shared stylesheet then its own, and the three sources are non-empty`, () => {
      expect(stylesheets(root, game)).toEqual([
        expect.stringMatching(/^shared\/assets\/[\w-]+\.css$/) as string,
        expect.stringMatching(new RegExp(`^shared/assets/${game}-[\\w-]+\\.css$`)) as string,
      ]);
      expect(tsNames.length).toBeGreaterThan(floors.ts);
      expect(css.length).toBeGreaterThan(CSS_FLOOR);
      expect(markup.length).toBeGreaterThan(floors.markup);
    });

    test(`${game}: every class TS names has a rule in the built CSS or is a behaviour-only row`, () => {
      const excused = names(behaviourOnly(rows));
      const orphans = ts
        .filter(({ name }) => !css.includes(name) && !excused.includes(name))
        .map(({ name, files }) => `${name} (${files.join(', ')})`);
      expect(
        orphans,
        'TS names these classes but the built stylesheet has no rule for them: add the rule, or a behaviour-only row to web/shared/styles/CONTRACT.md',
      ).toEqual([]);
    });

    test(`${game}: every class the built CSS styles is named in TS or the markup, or is a row`, () => {
      const excused = names(styled(rows));
      const orphans = css.filter(
        (name) => !tsNames.includes(name) && !markup.includes(name) && !excused.includes(name),
      );
      expect(
        orphans,
        'the built stylesheet styles these classes but nothing names them: a helper builds the name (add a row), or the rule is dead (add a row saying so)',
      ).toEqual([]);
    });

    test(`${game}: every CONTRACT.md row still describes the tree`, () => {
      const stale = rows.flatMap((row) =>
        row.names.flatMap((name) => {
          if (row.styledIn !== '' && !css.includes(name))
            return [`${name}: the row says ${row.styledIn} styles it, but no rule does`];
          if (row.styledIn === '' && css.includes(name))
            return [`${name}: the row says behaviour-only, but the built CSS has a rule for it`];
          if (row.toggledBy === '' && tsNames.includes(name))
            return [`${name}: the row says nothing in TS names it, but TS does`];
          // A `Toggled by` cannot be checked: the rows exist because the extraction misses it.
          return [];
        }),
      );
      expect(stale, 'rows to drop or correct').toEqual([]);
    });
  });
});
