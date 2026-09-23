// The shared token vocabulary (docs/MIGRATION.md step 14 Deviations; web/shared/styles/CONTRACT.md
// "Tokens"). web/shared/styles/tokens.css declares gin's palette under the shared names, gin's
// theme.css declares none of them (tokens.css is the single source of gin's values) and fidice's
// theme.css, linked last, redeclares every one so the shared names resolve to its own palette until
// the Fidice restyle drops the overrides. Backgammon's theme.css does the same on purpose (its
// whitewash-and-aegean palette is not a restyle target; docs/design/backgammon-board.md §3): a
// partial override would inherit gin's green felt for the names it forgot. The computed-style
// goldens pin the resolved values; this test pins where each name is declared, which the goldens
// cannot see.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from 'vitest';

const WEB = resolve(import.meta.dirname, '..', 'web');
const TOKENS = resolve(WEB, 'shared', 'styles', 'tokens.css');
const GIN_THEME = resolve(WEB, 'games', 'gin-rummy', 'theme.css');
const FIDICE_THEME = resolve(WEB, 'games', 'fidice', 'theme.css');
const BACKGAMMON_THEME = resolve(WEB, 'games', 'backgammon', 'theme.css');

/** The shared vocabulary: gin's palette names, in tokens.css order. */
const SHARED: ReadonlyArray<string> = [
  '--bg',
  '--card',
  '--card-2',
  '--accent',
  '--accent-dark',
  '--gold',
  '--text',
  '--muted',
  '--danger',
  '--radius',
  '--felt',
];

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The declaration blocks of every `:root` rule (both themes write one, tokens.css one). A block
 * ends at the first `}`: none of these files nests a rule inside `:root`, and `var(...)` values
 * carry no braces, so `[^}]*` is the whole body.
 */
const rootBlocks = (css: string): ReadonlyArray<string> =>
  [...stripComments(css).matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1] ?? '');

/** Property names declared in a block: what precedes each `:`, statement by statement. */
const declaredNames = (block: string): ReadonlyArray<string> =>
  block
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '')
    .map((statement) => statement.slice(0, statement.indexOf(':')).trim());

const rootNames = (path: string): ReadonlyArray<string> =>
  rootBlocks(readFileSync(path, 'utf8')).flatMap(declaredNames);

test('tokens.css declares exactly the shared vocabulary', () => {
  expect([...rootNames(TOKENS)].sort()).toEqual([...SHARED].sort());
});

test('tokens.css is a single :root of custom properties and nothing else', () => {
  const css = stripComments(readFileSync(TOKENS, 'utf8'));
  const blocks = rootBlocks(css);
  expect(blocks).toHaveLength(1);
  expect(css.replace(/:root\s*\{[^}]*\}/, '').trim(), 'outside :root').toBe('');
  const names = declaredNames(blocks[0] ?? '');
  expect(
    names.filter((name) => !name.startsWith('--')),
    'non-custom properties',
  ).toEqual([]);
});

test('gin theme.css redeclares no shared name: tokens.css is the single source of its palette', () => {
  const gin = rootNames(GIN_THEME);
  expect(gin.filter((name) => SHARED.includes(name))).toEqual([]);
  expect(gin, 'the gin-only layout tokens stay').toEqual([
    '--card-w',
    '--mini-w',
    '--pile-w',
    '--tiny-w',
  ]);
});

test('fidice theme.css redeclares every shared name: its look holds until the restyle', () => {
  const fidice = new Set(rootNames(FIDICE_THEME));
  expect(SHARED.filter((name) => !fidice.has(name))).toEqual([]);
});

test('backgammon theme.css redeclares every shared name: its palette never inherits gin felt', () => {
  const backgammon = new Set(rootNames(BACKGAMMON_THEME));
  expect(SHARED.filter((name) => !backgammon.has(name))).toEqual([]);
});
