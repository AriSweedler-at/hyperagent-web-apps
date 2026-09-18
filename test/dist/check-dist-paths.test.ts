// Guard 2 of docs/ARCHITECTURE.md "Two origins": every relative reference in dist HTML/CSS is
// resolved from the document's URL on both origins. On the Pages origin the document sits under
// /hyperagent-web-apps/; on the proxy origin it sits at the short URL the Worker gives it
// (unmapPath), and the resolved path is fed through the Worker's real mapPath(), redirects
// followed, to reach an upstream path. Either way the target must be a file in the tree (or a
// directory holding index.html). Runs on dist/ and dist-next/ after the builds (test:dist).
import { expect, test } from 'vitest';

import { PAGES_BASE_PATH } from '../../e2e/fixtures/site.ts';
import { mapPath, unmapPath } from '../../infra/games-proxy/worker.js';
import {
  allReferences,
  classify,
  describeDist,
  distHasFile,
  isRelative,
  unbuiltPages,
  type DistRoot,
  type Reference,
} from './dist.ts';

/** Any origin: only pathnames matter here. */
const ORIGIN = 'http://dist.invalid';

/**
 * The file a site pathname (under the Pages mount) is served from, or null. A directory URL
 * serves its index.html; without the trailing slash Pages redirects to it first, so both count.
 */
const distTarget = (root: DistRoot, sitePath: string): string | null => {
  if (!sitePath.startsWith(PAGES_BASE_PATH)) return null;
  const rel = decodeURIComponent(sitePath.slice(PAGES_BASE_PATH.length));
  const candidates =
    rel === '' || rel.endsWith('/') ? [`${rel}index.html`] : [rel, `${rel}/index.html`];
  return candidates.find((candidate) => distHasFile(root, candidate)) ?? null;
};

/** What the Worker fetches upstream for a pathname on games.sweedler.com, redirects followed. */
const throughProxy = (pathname: string): string => {
  const mapped = mapPath(pathname);
  return mapped.kind === 'redirect' ? throughProxy(mapped.path) : mapped.path;
};

const resolvedPath = (base: string, value: string): string => new URL(value, base).pathname;

/** A landing link to a game page this tree does not hold (dist-next/ without gin-rummy). */
const isDeadByDesign = (root: DistRoot, reference: Reference): boolean =>
  reference.file === 'index.html' &&
  reference.kind === 'href' &&
  unbuiltPages(root).some((game) => reference.value === `games/${game}/`);

describeDist('dist paths on both origins', (root) => {
  const relative = allReferences(root).filter(({ value }) => isRelative(classify(value)));
  const checked = relative.filter((reference) => !isDeadByDesign(root, reference));

  test('there are relative references to check (landing links, the fidice bundle and CSS)', () => {
    // dist/: two landing links, the fidice bundle, its CSS and the gin page's shared/ice.js;
    // dist-next/: one landing link (gin-rummy is left out by design), the bundle and the CSS.
    expect(checked.length).toBeGreaterThanOrEqual(root.name === 'dist-next' ? 3 : 5);
  });

  test('the only references left out are landing links to pages this tree does not hold', () => {
    const leftOut = relative.filter((reference) => isDeadByDesign(root, reference));
    expect(leftOut.map(({ value }) => value)).toEqual(
      unbuiltPages(root).map((game) => `games/${game}/`),
    );
    expect(unbuiltPages(root)).toEqual(root.name === 'dist-next' ? ['gin-rummy'] : []);
  });

  test('on the Pages origin every relative reference names a file in the tree', () => {
    const missing = checked
      .map((reference) => {
        const document = `${ORIGIN}${PAGES_BASE_PATH}${reference.file}`;
        const site = resolvedPath(document, reference.value);
        return { ...reference, site, target: distTarget(root, site) };
      })
      .filter(({ target }) => target === null);
    expect(missing, 'unresolved on the Pages origin').toEqual([]);
  });

  test('on the proxy origin every relative reference maps through the Worker to a file in the tree', () => {
    const missing = checked
      .map((reference) => {
        const document = `${ORIGIN}${unmapPath(`${PAGES_BASE_PATH}${reference.file}`)}`;
        const proxyPath = resolvedPath(document, reference.value);
        const upstream = throughProxy(proxyPath);
        return { ...reference, proxyPath, upstream, target: distTarget(root, upstream) };
      })
      .filter(({ target }) => target === null);
    expect(missing, 'unresolved on the proxy origin').toEqual([]);
  });

  test('a page reaches its own bundle on the proxy origin without a redirect', () => {
    const scripts = checked.filter(
      ({ file, kind, value }) => file !== 'index.html' && kind === 'src' && value.startsWith('./'),
    );
    scripts.forEach(({ file, value }) => {
      const document = `${ORIGIN}${unmapPath(`${PAGES_BASE_PATH}${file}`)}`;
      expect(mapPath(resolvedPath(document, value)).kind, `${file} -> ${value}`).not.toBe(
        'redirect',
      );
    });
  });

  test('the landing links reach the game pages through the /games/ redirect on the proxy', () => {
    const landingLinks = relative.filter(
      ({ file, kind }) => file === 'index.html' && kind === 'href',
    );
    expect(landingLinks.map(({ value }) => value)).toEqual(['games/gin-rummy/', 'games/fidice/']);
    landingLinks.forEach((reference) => {
      const proxyPath = resolvedPath(`${ORIGIN}/`, reference.value);
      expect(mapPath(proxyPath)).toEqual({
        kind: 'redirect',
        path: `/${reference.value}`.replace('/games', ''),
      });
      if (!isDeadByDesign(root, reference))
        expect(distTarget(root, throughProxy(proxyPath))).toBe(`${reference.value}index.html`);
    });
  });
});
