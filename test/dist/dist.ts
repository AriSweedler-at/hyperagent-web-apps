// Shared plumbing for the dist guards (docs/ARCHITECTURE.md "Two origins"): which build trees
// exist, how to list one, and how to pull every URL reference out of the HTML and CSS Vite wrote.
// Two trees are guarded: dist/ (`npm run build`, the legacy pages copied over Vite's output) and
// dist-next/ (`npm run build:next`, `LEGACY_PAGES=` so a ported page is served as built; the e2e
// project `next` runs against it). These suites run from `npm run test:dist` after the builds
// (vitest.dist.config.ts); a tree that is absent is recorded as one skipped test with a note, so a
// checkout without a build is never mistaken for a broken site.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

import { describe, test } from 'vitest';

import { DEFAULT_LEGACY_PAGES, legacyPagesFrom } from '../../vite.config.ts';

export const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

export type DistRoot = Readonly<{
  name: 'dist' | 'dist-next';
  dir: string;
  /** The pages this tree serves from legacy/ (the passthrough list the build ran with). */
  legacyPages: ReadonlyArray<string>;
  build: string;
}>;

export const DIST_ROOTS: ReadonlyArray<DistRoot> = [
  {
    name: 'dist',
    dir: resolve(REPO_ROOT, 'dist'),
    legacyPages: legacyPagesFrom(process.env['LEGACY_PAGES']),
    build: 'npm run build',
  },
  {
    name: 'dist-next',
    dir: resolve(REPO_ROOT, 'dist-next'),
    legacyPages: [],
    build: 'npm run build:next',
  },
];

export const distPresent = (root: DistRoot): boolean => existsSync(resolve(root.dir, 'index.html'));

export const skipNote = (root: DistRoot): string =>
  `${root.name}/ is absent: run \`${root.build}\` first (CI runs \`npm run test:dist\` after the builds)`;

/**
 * `describe` per build tree: runs `body(root)` for each tree that exists and records one skipped
 * test with the build command for each that does not.
 */
export const describeDist = (name: string, body: (root: DistRoot) => void): void => {
  DIST_ROOTS.forEach((root) => {
    if (distPresent(root)) {
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
  });
};

/**
 * Game pages the landing page links to that this tree does not hold: a legacy page not copied in
 * (`LEGACY_PAGES=`) whose port has no web/games/<g>/index.html yet. Their links are dead in this
 * tree by design and the path guards leave them out (and say which ones).
 */
export const unbuiltPages = (root: DistRoot): ReadonlyArray<string> =>
  DEFAULT_LEGACY_PAGES.filter(
    (game) =>
      !root.legacyPages.includes(game) &&
      !existsSync(resolve(REPO_ROOT, 'web', 'games', game, 'index.html')),
  );

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
