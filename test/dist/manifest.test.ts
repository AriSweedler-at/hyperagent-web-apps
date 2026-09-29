// The installable manifest (docs/design/backgammon-landscape.md §5C, §6 item 4): a game in
// tools/icons.ts MANIFEST_GAMES links web/public/games/<g>/manifest.webmanifest from its head, and
// the manifest is what makes an installed Android app (a WebAPK) open fullscreen and sideways with
// no JS: `display: fullscreen`, `orientation: landscape` (iOS ignores both members). Everything the
// manifest names is `./`-relative to the manifest itself, so start_url, scope and every icon resolve
// on both origins (docs/ARCHITECTURE.md "Two origins"): under /hyperagent-web-apps/games/<g>/ on
// github.io and, through the Worker's real mapPath, under /<g>/ and the game's alias on
// games.sweedler.com. Each icon is the PNG tools/icons.ts rendered, at the size its `sizes` row
// declares (the IHDR is read, so a re-rendered icon of another size fails here), one of them
// maskable; the colours are the theme's `--bg` and `--accent`; the head's theme-color is the
// manifest's. Vite copies public/ verbatim and leaves the head's relative href as written (the
// favicon links are the precedent), which the first test pins. Runs on dist/ after the build
// (npm run test:site).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from 'vitest';

import { PAGES_BASE_PATH } from '../../e2e/fixtures/site.ts';
import { mapPath, metaContent } from '../../infra/games-proxy/worker.ts';
import { ALIASES, type ShellGame } from '../../tools/games.ts';
import { ICONS, MANIFEST_GAMES, iconFile } from '../../tools/icons.ts';
import { REPO_ROOT, describeDist, distHasFile, readDist, referencesIn } from './dist.ts';

/** Any origin: only pathnames matter on the Pages side. */
const ORIGIN = 'http://dist.invalid';
const PROXY_ORIGIN = 'https://games.sweedler.com';

/** The members this site's manifests carry, as the parsed JSON. */
type ManifestIcon = Readonly<{ src: string; sizes: string; type: string; purpose: string }>;
type Manifest = Readonly<{
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  orientation: string;
  background_color: string;
  theme_color: string;
  icons: ReadonlyArray<ManifestIcon>;
}>;

const manifestFile = (game: ShellGame): string => `games/${game}/manifest.webmanifest`;
const pageFile = (game: ShellGame): string => `games/${game}/index.html`;
const HREF = './manifest.webmanifest';

/** A PNG's IHDR: width and height, big-endian, right after the 8-byte signature and the chunk header. */
const pngSize = (bytes: Buffer): Readonly<{ width: number; height: number }> => ({
  width: bytes.readUInt32BE(16),
  height: bytes.readUInt32BE(20),
});
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A `:root` token's hex value in the game's theme.css (the manifest's colours are the theme's). */
const themeToken = (game: ShellGame, name: string): string => {
  const css = readFileSync(resolve(REPO_ROOT, `web/games/${game}/theme.css`), 'utf8');
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css);
  expect(match, `--${name} in ${game}'s theme.css`).not.toBeNull();
  return match?.[1] ?? '';
};

/** The dist-relative file the Worker fetches for a proxy-origin pathname: mapPath's upstream path minus the site prefix. */
const distPathFor = (pathname: string): string => {
  const mapped = mapPath(pathname);
  expect(mapped, pathname).toMatchObject({ kind: 'fetch' });
  return mapped.path.split('/').slice(2).join('/');
};

/** The dist-relative file a Pages-origin pathname serves: the file itself, or a directory's index.html. */
const pagesFileFor = (pathname: string): string => {
  expect(pathname.startsWith(PAGES_BASE_PATH), pathname).toBe(true);
  const rel = pathname.slice(PAGES_BASE_PATH.length);
  return rel.endsWith('/') ? `${rel}index.html` : rel;
};

/** A pathname resolved against a base URL, as the browser resolves the manifest's members. */
const resolvedPath = (base: string, value: string): string => new URL(value, base).pathname;

/** The manifest's URL on the proxy origin under each name the game has there: its own and its aliases'. */
const proxyNames = (game: ShellGame): ReadonlyArray<string> => [
  game,
  ...Object.entries(ALIASES)
    .filter(([, target]) => target === game)
    .map(([alias]) => alias),
];

describeDist('the installable manifest', (root) => {
  MANIFEST_GAMES.forEach((game) => {
    const readManifest = (): Manifest => JSON.parse(readDist(root, manifestFile(game))) as Manifest;

    test(`${game}: the head links ${HREF} once, as written, and the build ships it`, () => {
      const page = readDist(root, pageFile(game));
      const links = referencesIn(pageFile(game), page).filter(({ value }) => value === HREF);
      expect(links).toEqual([{ file: pageFile(game), kind: 'href', value: HREF }]);
      expect(page).toContain(`<link rel="manifest" href="${HREF}" />`);
      expect(distHasFile(root, manifestFile(game))).toBe(true);
    });

    test(`${game}: fullscreen and landscape, the page's name, ./-relative start and scope, the theme's colours, the rendered icons`, () => {
      const page = readDist(root, pageFile(game));
      const name = metaContent(page, 'og:title') ?? '';
      expect(name).not.toBe('');
      const icons = ICONS.filter((icon) => icon.game === game);
      expect(icons.map(({ purpose }) => purpose)).toContain('maskable');
      expect(readManifest()).toEqual({
        name,
        short_name: name,
        start_url: './',
        scope: './',
        display: 'fullscreen',
        orientation: 'landscape',
        background_color: themeToken(game, 'bg'),
        theme_color: themeToken(game, 'accent'),
        icons: icons.map((icon) => ({
          src: `./icons/${iconFile(icon)}`,
          sizes: `${String(icon.size)}x${String(icon.size)}`,
          type: 'image/png',
          purpose: icon.purpose,
        })),
      });
    });

    test(`${game}: the head's theme-color is the manifest's`, () => {
      const page = readDist(root, pageFile(game));
      expect(metaContent(page, 'theme-color')).toBe(readManifest().theme_color);
    });

    test(`${game}: every icon is a PNG the build ships at the size its row declares`, () => {
      readManifest().icons.forEach(({ src, sizes, type }) => {
        expect(type).toBe('image/png');
        const file = resolvedPath(`${ORIGIN}/${manifestFile(game)}`, src).slice(1);
        expect(distHasFile(root, file), file).toBe(true);
        const bytes = readFileSync(resolve(root.dir, file));
        expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE), `${file} is a PNG`).toBe(true);
        const [width, height] = sizes.split('x').map(Number);
        expect(pngSize(bytes), file).toEqual({ width, height });
      });
    });

    test(`${game}: start_url, scope and every icon resolve on the Pages origin`, () => {
      const manifest = readManifest();
      const base = `${ORIGIN}${PAGES_BASE_PATH}${manifestFile(game)}`;
      const page = `${PAGES_BASE_PATH}games/${game}/`;
      expect(resolvedPath(base, manifest.start_url)).toBe(page);
      expect(resolvedPath(base, manifest.scope)).toBe(page);
      expect(distHasFile(root, pagesFileFor(page))).toBe(true);
      manifest.icons.forEach(({ src }) => {
        const file = pagesFileFor(resolvedPath(base, src));
        expect(distHasFile(root, file), file).toBe(true);
      });
    });

    test(`${game}: the manifest, start_url, scope and every icon map through the Worker under the game's name and its alias`, () => {
      const manifest = readManifest();
      const names = proxyNames(game);
      expect(names.length).toBeGreaterThanOrEqual(2);
      names.forEach((name) => {
        const base = `${PROXY_ORIGIN}/${name}/manifest.webmanifest`;
        expect(distPathFor(new URL(base).pathname)).toBe(manifestFile(game));
        // The page itself is a fetch of the game's folder, never a redirect (one round trip).
        [manifest.start_url, manifest.scope].forEach((member) => {
          expect(resolvedPath(base, member)).toBe(`/${name}/`);
          expect(distPathFor(`/${name}/`)).toBe(`games/${game}/`);
          expect(distHasFile(root, pageFile(game))).toBe(true);
        });
        manifest.icons.forEach(({ src }) => {
          const file = distPathFor(resolvedPath(base, src));
          expect(distHasFile(root, file), `${name}: ${src}`).toBe(true);
        });
      });
    });
  });
});
