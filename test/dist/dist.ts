// Shared plumbing for the dist guards (docs/ARCHITECTURE.md "Two origins"): where dist/ is, how to
// list it, and how to pull every URL reference out of the HTML and CSS Vite wrote. These suites run
// from `npm run test:dist` after `npm run build` (vitest.dist.config.ts); without a build they skip
// with a note instead of failing, so a checkout without dist/ is never mistaken for a broken site.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

import { describe, test } from 'vitest';

export const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
export const DIST = resolve(REPO_ROOT, 'dist');
export const SKIP_NOTE =
  'dist/ is absent: run `npm run build` first (CI runs `npm run test:dist` after the build)';

export const distPresent = (): boolean => existsSync(resolve(DIST, 'index.html'));

/** `describe` that runs `body` when dist/ exists and otherwise records one skipped test with SKIP_NOTE. */
export const describeDist = (name: string, body: () => void): void => {
  if (distPresent()) {
    describe(name, body);
    return;
  }
  describe(name, () => {
    test('skipped: no dist/', (context) => {
      context.skip(SKIP_NOTE);
    });
  });
};

/** Every regular file under dist/, as posix paths relative to it, sorted. */
export const distFiles = (): ReadonlyArray<string> =>
  readdirSync(DIST, { recursive: true, encoding: 'utf8' })
    .map((path) => path.split(sep).join('/'))
    .filter((path) => statSync(resolve(DIST, path)).isFile())
    .sort();

export const readDist = (relPath: string): string => readFileSync(resolve(DIST, relPath), 'utf8');

/** True when `relPath` names a regular file inside dist/. */
export const distHasFile = (relPath: string): boolean => {
  const abs = resolve(DIST, relPath);
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

/** The dist files whose references are checked: everything written as HTML or CSS. */
export const referencedFiles = (): ReadonlyArray<string> =>
  distFiles().filter((file) => file.endsWith('.html') || file.endsWith('.css'));

export const allReferences = (): ReadonlyArray<Reference> =>
  referencedFiles().flatMap((file) => referencesIn(file, readDist(file)));

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
