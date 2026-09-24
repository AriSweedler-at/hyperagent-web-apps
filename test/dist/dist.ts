// Shared plumbing for the dist guards (docs/ARCHITECTURE.md "Two origins"): whether the build
// tree exists, how to list it, and how to pull every URL reference out of the HTML and CSS Vite
// wrote. One tree is guarded, dist/ (`npm run build`): since docs/MIGRATION.md step 13 every page
// is Vite's and the dark dist-next/ build is gone. These suites are the `site` suite's standalone half
// (tools/ci/suites.ts): `npm run test:site` builds and runs them, `npm test` never does; an absent tree
// is recorded as one skipped test with a note, so a checkout without a build is never mistaken for a broken site.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

import { describe, test } from 'vitest';

import { ALIASES, GAMES } from '../../tools/games.ts';

export const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

/** The stub an alias (tools/games.ts ALIASES) builds to: games/<alias>/index.html, forwarding to ../<game>/. */
export const aliasPage = (alias: string): string => `games/${alias}/index.html`;

/** Every alias stub in the tree, alias -> game; the file each is checked for is aliasPage(alias). */
export const ALIAS_PAGES: ReadonlyArray<Readonly<{ alias: string; game: string; page: string }>> =
  Object.entries(ALIASES).map(([alias, game]) => ({ alias, game, page: aliasPage(alias) }));

/** True for an alias stub: its one `../<game>/` link is checked by the alias tests, not the generic ones. */
export const isAliasPage = (file: string): boolean => ALIAS_PAGES.some(({ page }) => page === file);

export type DistRoot = Readonly<{ name: 'dist'; dir: string; build: string }>;

/** `DIST_DIR` points the guards at a scratch copy of the tree, to show that one of them bites. */
export const DIST_ROOT: DistRoot = {
  name: 'dist',
  dir: process.env['DIST_DIR'] ?? resolve(REPO_ROOT, 'dist'),
  build: 'npm run build',
};

export const distPresent = (root: DistRoot): boolean => existsSync(resolve(root.dir, 'index.html'));

export const skipNote = (root: DistRoot): string =>
  `${root.name}/ is absent: run \`${root.build}\` first (CI runs \`npm run test:site\`, which builds first)`;

/**
 * The game pages a build must carry; a tree that has some but not all is a STALE build (a checkout
 * pulled past a new game without rebuilding), and the guards would otherwise fail seventeen ways
 * that all mean "rebuild". The alias stubs are not required: they are guarded separately.
 */
export const missingPages = (root: DistRoot): ReadonlyArray<string> =>
  GAMES.map((game) => `games/${game}/index.html`).filter(
    (page) => !existsSync(resolve(root.dir, page)),
  );

export const staleNote = (root: DistRoot, missing: ReadonlyArray<string>): string =>
  `${root.name}/ is stale (missing ${missing.join(', ')}): run \`${root.build}\` again (or \`npm run test:site\`, which builds first)`;

/**
 * `describe` over the build tree: runs `body(root)` when dist/ exists and records one skipped test
 * with the build command when it does not.
 */
export const describeDist = (name: string, body: (root: DistRoot) => void): void => {
  const root = DIST_ROOT;
  if (distPresent(root)) {
    const missing = missingPages(root);
    if (missing.length > 0) {
      describe(`${name} [${root.name}]`, () => {
        test(`stale ${root.name}/`, () => {
          throw new Error(staleNote(root, missing));
        });
      });
      return;
    }
    describe(`${name} [${root.name}]`, () => {
      body(root);
    });
    return;
  }
  describe(`${name} [${root.name}]`, () => {
    test(`skipped: no ${root.name}/`, (context) => {
      context.skip(skipNote(root));
    });
  });
};

/** Every regular file under the tree, as posix paths relative to it, sorted. */
export const distFiles = (root: DistRoot): ReadonlyArray<string> =>
  readdirSync(root.dir, { recursive: true, encoding: 'utf8' })
    .map((path) => path.split(sep).join('/'))
    .filter((path) => statSync(resolve(root.dir, path)).isFile())
    .sort();

export const readDist = (root: DistRoot, relPath: string): string =>
  readFileSync(resolve(root.dir, relPath), 'utf8');

/** True when `relPath` names a regular file inside the tree. */
export const distHasFile = (root: DistRoot, relPath: string): boolean => {
  const abs = resolve(root.dir, relPath);
  return existsSync(abs) && statSync(abs).isFile();
};

export type Reference = Readonly<{ file: string; kind: 'src' | 'href' | 'url()'; value: string }>;

const ATTRIBUTE = /\b(src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^"')]*))\s*\)/g;
/** An inline script body is code, not markup; keep its opening tag (whose src= is a reference). */
const SCRIPT_BODY = /(<script\b[^>]*>)[\s\S]*?<\/script>/gi;

const firstDefined = (...values: ReadonlyArray<string | undefined>): string =>
  values.find((value) => value !== undefined) ?? '';

/** Every src/href attribute in an HTML file and every url() in HTML (inline styles) or CSS. */
export const referencesIn = (file: string, text: string): ReadonlyArray<Reference> => {
  const isHtml = file.endsWith('.html');
  const markup = isHtml ? text.replace(SCRIPT_BODY, '$1') : text;
  const attributes = isHtml
    ? [...markup.matchAll(ATTRIBUTE)].map((match): Reference => ({
        file,
        kind: match[1] === 'src' ? 'src' : 'href',
        value: firstDefined(match[2], match[3], match[4]),
      }))
    : [];
  const urls =
    isHtml || file.endsWith('.css')
      ? [...markup.matchAll(CSS_URL)].map((match): Reference => ({
          file,
          kind: 'url()',
          value: firstDefined(match[1], match[2], match[3]).trim(),
        }))
      : [];
  return [...attributes, ...urls];
};

/** The files whose references are checked: everything written as HTML or CSS. */
export const referencedFiles = (root: DistRoot): ReadonlyArray<string> =>
  distFiles(root).filter((file) => file.endsWith('.html') || file.endsWith('.css'));

export const allReferences = (root: DistRoot): ReadonlyArray<Reference> =>
  referencedFiles(root).flatMap((file) => referencesIn(file, readDist(root, file)));

export type Placement =
  | 'https'
  | 'inline'
  | 'document-relative'
  | 'shared-relative'
  | 'rooted'
  | 'parent-escape'
  | 'other-scheme';

/**
 * Where a reference points. Allowed: `https://`, inline data/fragments, `./x` or bare `x/y`
 * (document-relative) and `../../shared/...` (the one parent path the proxy maps). Everything else
 * breaks one of the two origins: `/`-rooted (including protocol-relative `//`), any other `..`,
 * any other scheme.
 */
export const classify = (value: string): Placement => {
  if (value.startsWith('https://')) return 'https';
  if (value === '' || value.startsWith('data:') || value.startsWith('#')) return 'inline';
  if (value.startsWith('/')) return 'rooted';
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return 'other-scheme';
  if (value.startsWith('../../shared/')) return 'shared-relative';
  if (value.split('/').includes('..')) return 'parent-escape';
  return 'document-relative';
};

export const isRelative = (placement: Placement): boolean =>
  placement === 'document-relative' || placement === 'shared-relative';
