// Guard 2 of docs/ARCHITECTURE.md "Two origins": every relative reference in dist HTML/CSS is
// resolved from the document's URL on both origins. On the Pages origin the document sits under
// /hyperagent-web-apps/; on the proxy origin it sits at the short URL the Worker gives it
// (unmapPath), and the resolved path is fed through the Worker's real mapPath(), redirects
// followed, to reach an upstream path. Either way the target must be a file in dist/ (or a
// directory holding index.html). Runs after `npm run build` (test:dist).
import { expect, test } from 'vitest';

import { PAGES_BASE_PATH } from '../../e2e/fixtures/site.ts';
import { mapPath, unmapPath } from '../../infra/games-proxy/worker.js';
import { allReferences, classify, describeDist, distHasFile, isRelative } from './dist.ts';

/** Any origin: only pathnames matter here. */
const ORIGIN = 'http://dist.invalid';

/**
 * The dist file a site pathname (under the Pages mount) is served from, or null. A directory URL
 * serves its index.html; without the trailing slash Pages redirects to it first, so both count.
 */
const distTarget = (sitePath: string): string | null => {
  if (!sitePath.startsWith(PAGES_BASE_PATH)) return null;
  const rel = decodeURIComponent(sitePath.slice(PAGES_BASE_PATH.length));
  const candidates =
    rel === '' || rel.endsWith('/') ? [`${rel}index.html`] : [rel, `${rel}/index.html`];
  return candidates.find(distHasFile) ?? null;
};

/** What the Worker fetches upstream for a pathname on games.sweedler.com, redirects followed. */
const throughProxy = (pathname: string): string => {
  const mapped = mapPath(pathname);
  return mapped.kind === 'redirect' ? throughProxy(mapped.path) : mapped.path;
};

const resolvedPath = (base: string, value: string): string => new URL(value, base).pathname;

describeDist('dist paths on both origins', () => {
  const relative = allReferences().filter(({ value }) => isRelative(classify(value)));

  test('there are relative references to check (landing links, shared/ice.js)', () => {
    expect(relative.length).toBeGreaterThanOrEqual(4);
  });

  test('on the Pages origin every relative reference names a file in dist', () => {
    const missing = relative
      .map((reference) => {
        const document = `${ORIGIN}${PAGES_BASE_PATH}${reference.file}`;
        const site = resolvedPath(document, reference.value);
        return { ...reference, site, target: distTarget(site) };
      })
      .filter(({ target }) => target === null);
    expect(missing, 'unresolved on the Pages origin').toEqual([]);
  });

  test('on the proxy origin every relative reference maps through the Worker to a file in dist', () => {
    const missing = relative
      .map((reference) => {
        const document = `${ORIGIN}${unmapPath(`${PAGES_BASE_PATH}${reference.file}`)}`;
        const proxyPath = resolvedPath(document, reference.value);
        const upstream = throughProxy(proxyPath);
        return { ...reference, proxyPath, upstream, target: distTarget(upstream) };
      })
      .filter(({ target }) => target === null);
    expect(missing, 'unresolved on the proxy origin').toEqual([]);
  });

  test('the landing links reach the game pages through the /games/ redirect on the proxy', () => {
    const landingLinks = relative.filter(
      ({ file, kind }) => file === 'index.html' && kind === 'href',
    );
    expect(landingLinks.map(({ value }) => value)).toEqual(['games/gin-rummy/', 'games/fidice/']);
    landingLinks.forEach(({ value }) => {
      const proxyPath = resolvedPath(`${ORIGIN}/`, value);
      expect(mapPath(proxyPath)).toEqual({
        kind: 'redirect',
        path: `/${value}`.replace('/games', ''),
      });
      expect(distTarget(throughProxy(proxyPath))).toBe(`${value}index.html`);
    });
  });
});
