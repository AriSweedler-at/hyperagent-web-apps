// Guard 2 of docs/ARCHITECTURE.md "Two origins": every relative reference in dist HTML/CSS is
// resolved from the document's URL on both origins. On the Pages origin the document sits under
// /hyperagent-web-apps/; on the proxy origin it sits at the short URL the Worker gives it
// (unmapPath), and the resolved path is fed through the Worker's real mapPath(), redirects
// followed, to reach an upstream path. Either way the target must be a file in the tree (or a
// directory holding index.html). Runs on dist/ after the build (test:dist).
import { expect, test } from 'vitest';

import { PAGES_BASE_PATH } from '../../e2e/fixtures/site.ts';
import { mapPath, unmapPath } from '../../infra/games-proxy/worker.ts';
import { GAMES, LANDING_HREFS } from '../../tools/games.ts';
import {
  ALIAS_PAGES,
  allReferences,
  classify,
  describeDist,
  distHasFile,
  isRelative,
  type DistRoot,
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

describeDist('dist paths on both origins', (root) => {
  const relative = allReferences(root).filter(({ value }) => isRelative(classify(value)));
  const checked = relative;

  test('there are relative references to check (landing links, the bundles and CSS)', () => {
    // Two landing links and, per game page, its bundle, the preloaded shared chunk and its CSS.
    expect(checked.length).toBeGreaterThanOrEqual(8);
  });

  test('every game page is built', () => {
    GAMES.forEach((game) => {
      expect(distHasFile(root, `games/${game}/index.html`), game).toBe(true);
    });
  });

  test('each alias reaches its game page on both origins: the stub forwards on Pages, the Worker serves it in place', () => {
    ALIAS_PAGES.forEach(({ alias, game, page }) => {
      const gamePage = `${PAGES_BASE_PATH}games/${game}/`;
      // Pages: the stub is built, and `../<game>/` from it is the game's directory URL.
      expect(distHasFile(root, page), page).toBe(true);
      expect(resolvedPath(`${ORIGIN}${PAGES_BASE_PATH}${page}`, `../${game}/`)).toBe(gamePage);
      // Proxy: /<alias>/ is the game page itself, never the stub; /<alias> and /games/<alias>/
      // redirect there; and the stub's link, were it served, would map to the same page.
      expect(throughProxy(`/${alias}/`)).toBe(gamePage);
      expect(throughProxy(`/${alias}`)).toBe(gamePage);
      expect(throughProxy(`/games/${alias}/`)).toBe(gamePage);
      const stubOnProxy = `${ORIGIN}${unmapPath(`${PAGES_BASE_PATH}${page}`)}`;
      expect(throughProxy(resolvedPath(stubOnProxy, `../${game}/`))).toBe(gamePage);
      // The alias's page and bundle URLs on the proxy are fetches, not redirects (one round trip).
      expect(mapPath(`/${alias}/`).kind).toBe('fetch');
      expect(mapPath(`/${alias}/app-abc.js`).kind).toBe('fetch');
    });
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
    const landingHrefs = relative.filter(
      ({ file, kind }) => file === 'index.html' && kind === 'href',
    );
    // The site's icon (web/public/shared/favicon.*) is fetched, not redirected, on the proxy.
    const icons = landingHrefs.filter(({ value }) => value.startsWith('./shared/favicon.'));
    expect(icons.map(({ value }) => value)).toEqual([
      './shared/favicon.svg',
      './shared/favicon.ico',
    ]);
    icons.forEach(({ value }) => {
      const proxyPath = resolvedPath(`${ORIGIN}/`, value);
      expect(mapPath(proxyPath)).toEqual({
        kind: 'fetch',
        path: `${PAGES_BASE_PATH}${value.slice(2)}`,
      });
      expect(distTarget(root, throughProxy(proxyPath))).toBe(value.slice(2));
    });
    const landingLinks = landingHrefs.filter((reference) => !icons.includes(reference));
    expect(landingLinks.map(({ value }) => value)).toEqual(LANDING_HREFS);
    landingLinks.forEach((reference) => {
      const proxyPath = resolvedPath(`${ORIGIN}/`, reference.value);
      expect(mapPath(proxyPath)).toEqual({
        kind: 'redirect',
        path: `/${reference.value}`.replace('/games', ''),
      });
      expect(distTarget(root, throughProxy(proxyPath))).toBe(`${reference.value}index.html`);
    });
  });
});
