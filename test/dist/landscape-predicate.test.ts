// The one landscape predicate (docs/design/backgammon-landscape.md §3.1; docs/design/shared-shell.md
// "Playing sideways"): web/shared/edge/media.ts spells `LANDSCAPE_PHONE` once, the boot watches it
// into the App, and every `@media` list in a theme or the shell sheet that keys on a landscape
// phone copies it verbatim, alone or with a width bound after it (`... and (min-width: 714px)`).
// A height tier tighter than 500px (the short-phone fallbacks) nests under it instead of spelling
// its own orientation query, so this pin reads one predicate per landscape block and the board's
// layout can never drift from the gate's watcher; a brace-depth walk holds each tier under a
// predicate block, not merely free of an orientation query of its own. Read off the source sheets,
// not dist/, so it needs
// no build: the sheets are copied through as they are. The predicate is read off media.ts as text
// too (tsconfig.node.json compiles no web/shared/edge module), and pinned letter for letter beside
// media.test.ts's pin. In the `site` suite beside the other guards.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

import { GAMES } from '../../tools/games.ts';
import { REPO_ROOT } from './dist.ts';

const source = (rel: string): string => readFileSync(resolve(REPO_ROOT, rel), 'utf8');

/** `LANDSCAPE_PHONE` as web/shared/edge/media.ts exports it (its one single-quoted string). */
const LANDSCAPE_PHONE: string =
  /export const LANDSCAPE_PHONE =\s*'([^']+)'/.exec(source('web/shared/edge/media.ts'))?.[1] ?? '';

/** The sheets read: every game's theme and the shell sheet. */
const SHEETS: ReadonlyArray<string> = [
  ...GAMES.map((game) => `web/games/${game}/theme.css`),
  'web/shared/styles/shell.css',
];

/** The sheet with its comments blanked, so a query quoted in prose is not read as a rule. */
const stripped = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every `@media` list in the sheet, whitespace folded, in order. */
const mediaLists = (css: string): ReadonlyArray<string> =>
  [...stripped(css).matchAll(/@media\s+([^{]+)\{/g)].map((m: ReadonlyArray<string>) =>
    (m[1] ?? '').replace(/\s+/g, ' ').trim(),
  );

/** The lists that key on a landscape phone: any query of the list names the orientation. */
const landscapeLists = (css: string): ReadonlyArray<string> =>
  mediaLists(css).filter((list) => list.includes('orientation: landscape'));

/** A query is the predicate, or the predicate with a width bound after it. */
const isPhonePredicate = (query: string): boolean =>
  query === LANDSCAPE_PHONE || query.startsWith(`${LANDSCAPE_PHONE} and (`);

/** A list keys on a landscape phone alone: every query of it is the predicate, or it with a width bound. */
const isPhoneList = (list: string): boolean =>
  list.split(',').every((q) => isPhonePredicate(q.trim()));

/** An `@media` list with the `@media` lists enclosing it, outermost first. */
type NestedList = Readonly<{ list: string; enclosing: ReadonlyArray<string> }>;

/** The walk's state: the open frames (a list for an `@media`, null for any other rule) and the lists seen. */
type Walk = Readonly<{ stack: ReadonlyArray<string | null>; found: ReadonlyArray<NestedList> }>;

/**
 * Every `@media` list with its enclosing `@media` lists, by a brace-depth walk over the stripped
 * sheet: `@media … {` opens a frame that names its list, any other `{` (`@supports`, a selector)
 * a frame that names none, and `}` closes the innermost frame.
 */
const nestedMediaLists = (css: string): ReadonlyArray<NestedList> =>
  [...stripped(css).matchAll(/@media\s+([^{]+)\{|[{}]/g)].reduce<Walk>(
    (walk, m: ReadonlyArray<string>) => {
      if (m[0] === '}') return { ...walk, stack: walk.stack.slice(0, -1) };
      if (m[0] === '{') return { ...walk, stack: [...walk.stack, null] };
      const list = (m[1] ?? '').replace(/\s+/g, ' ').trim();
      const enclosing = walk.stack.filter((frame): frame is string => frame !== null);
      return { stack: [...walk.stack, list], found: [...walk.found, { list, enclosing }] };
    },
    { stack: [], found: [] },
  ).found;

describe('the landscape predicate is spelled once', () => {
  test('LANDSCAPE_PHONE names a coarse pointer, landscape and a height under 500px', () => {
    expect(LANDSCAPE_PHONE).toBe(
      '(any-pointer: coarse) and (orientation: landscape) and (max-height: 500px)',
    );
  });

  test.each(SHEETS)(
    '%s: every landscape @media query is LANDSCAPE_PHONE verbatim, or it with a width bound',
    (sheet) => {
      const css = source(sheet);
      const lists = landscapeLists(css);
      const queries = lists.flatMap((list) =>
        list
          .split(',')
          .map((q) => q.trim())
          .filter((q) => q.includes('orientation: landscape')),
      );
      const strays = queries.filter((q) => !isPhonePredicate(q));
      expect(strays, `${sheet}: ${strays.join(' | ')}`).toEqual([]);
    },
  );

  test('backgammon (the flat board) keys its layout on it in at least a dozen blocks; the shell sheet in one (the sideways home)', () => {
    const bg = source('web/games/backgammon/theme.css');
    expect(landscapeLists(bg).length).toBeGreaterThanOrEqual(12);
    // The two short-phone tiers nest under it: no list of their own names the orientation, and
    // the innermost @media enclosing each is a LANDSCAPE_PHONE list, so a tier flattened to the
    // top level (a height bound alone fits an upright phone too) fails here, not only one that
    // spelled its own orientation.
    expect(mediaLists(bg).filter((l) => l.includes('273px') && l.includes('orientation'))).toEqual(
      [],
    );
    const nested = nestedMediaLists(bg);
    expect(nested.map((n) => n.list)).toEqual(mediaLists(bg));
    const tiers = nested.filter((n) => n.list.includes('273px') || n.list.includes('295px'));
    expect(tiers.length).toBeGreaterThanOrEqual(1);
    tiers.forEach((tier) => {
      const inner = tier.enclosing.at(-1) ?? '';
      expect(isPhoneList(inner) && inner !== '', `${tier.list} sits under ${inner}`).toBe(true);
    });
    const shell = source('web/shared/styles/shell.css');
    expect(landscapeLists(shell)).toEqual([LANDSCAPE_PHONE]);
  });
});
