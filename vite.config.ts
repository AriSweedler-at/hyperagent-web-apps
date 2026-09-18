// Build (docs/ARCHITECTURE.md "Build and serve", "Two origins"). `web/` is the Vite root and the
// public URL tree; every page is an entry found by globbing web/**/index.html, so a new game is
// picked up by its folder. `base: './'` makes every emitted URL document-relative, which is what
// lets the same dist serve from /hyperagent-web-apps/ on github.io and from / on
// games.sweedler.com. Output naming keeps a page's own JS beside it and everything shared under
// shared/assets/, the prefix the proxy Worker already maps.
//
// Vite 8 is Rolldown-based: `build.rolldownOptions` is the supported key and `build.rollupOptions`
// is a deprecated alias of it (node_modules/vite/dist/node/index.d.ts), so this file uses the former.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, dirname, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, type Plugin } from 'vite';

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(REPO_ROOT, 'web');
const DIST = resolve(REPO_ROOT, 'dist');
const LEGACY = resolve(REPO_ROOT, 'legacy');

/**
 * Pages served byte-for-byte from legacy/ until their port is cut over (docs/MIGRATION.md).
 * Cutting a page over is deleting it from this list (step 7 did so for fidice; its legacy file
 * stays as the frozen source of the oracle fixtures until step 13 retires legacy/).
 */
export const DEFAULT_LEGACY_PAGES: ReadonlyArray<string> = ['gin-rummy'];

/**
 * `LEGACY_PAGES=gin-rummy` overrides the list; `LEGACY_PAGES=` (empty) disables the passthrough
 * so a ported page can be exercised end-to-end before it is flipped (e2e project `next`).
 */
export const legacyPagesFrom = (env: string | undefined): ReadonlyArray<string> =>
  env === undefined
    ? DEFAULT_LEGACY_PAGES
    : env
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name !== '');

/** Entry name of a page: `index` for web/index.html, else its folder (`fidice` for games/fidice/). */
const entryNameFor = (relativeHtml: string): string =>
  relativeHtml === 'index.html' ? 'index' : basename(dirname(relativeHtml));

/** Multi-page input: every index.html under web/ (outside public/), keyed by entry name. */
const pageInputs = (): Readonly<Record<string, string>> =>
  Object.fromEntries(
    readdirSync(WEB, { recursive: true, encoding: 'utf8' })
      .map((path) => path.split(sep).join('/'))
      .filter((path) => basename(path) === 'index.html' && !path.startsWith('public/'))
      .sort()
      .map((relativeHtml) => [entryNameFor(relativeHtml), resolve(WEB, relativeHtml)]),
  );

/**
 * After the bundle is written, copy each legacy page over Vite's output for that path, so dist
 * serves exactly the bytes in legacy/. legacy/shared/ice.js is copied on every build, even with
 * `LEGACY_PAGES=`: the legacy gin page loads it as a classic script (fidice stopped in
 * docs/MIGRATION.md step 9; the copy goes with legacy/ in step 13). The output directory is read
 * from the resolved config, so `vite build --outDir ../dist-next` (npm run build:next) is honoured.
 */
const legacyPassthrough = (pages: ReadonlyArray<string>): Plugin => {
  let outDir = DIST;
  return {
    name: 'legacy-passthrough',
    apply: 'build',
    enforce: 'post',
    configResolved: (config) => {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle: () => {
      const pageCopies = pages.map(
        (game) =>
          [
            resolve(LEGACY, game, 'index.html'),
            resolve(outDir, 'games', game, 'index.html'),
          ] as const,
      );
      const sharedCopies = [
        [resolve(LEGACY, 'shared', 'ice.js'), resolve(outDir, 'shared', 'ice.js')] as const,
      ];
      [...pageCopies, ...sharedCopies].forEach(([from, to]) => {
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(from, to);
      });
    },
  };
};

/** `./app-x.js` or `../../shared/assets/x.css`: the path from the page's directory to the file. */
const documentRelative = (fromFile: string, toFile: string): string => {
  const rel = posix.relative(posix.dirname(fromFile), toFile);
  return rel.startsWith('.') ? rel : `./${rel}`;
};

export default defineConfig({
  root: WEB,
  base: './',
  plugins: [legacyPassthrough(legacyPagesFrom(process.env['LEGACY_PAGES']))],
  experimental: {
    // With a relative base Vite prefixes every URL in a page with the path back to the site root
    // (`../../games/fidice/app-x.js` from games/fidice/index.html), which the proxy origin can only
    // reach through its /games/ redirect. Pages get true document-relative URLs instead: the
    // page's own bundle as `./app-x.js`, shared output as `../../shared/assets/x` (docs/ARCHITECTURE.md
    // "Two origins"). URLs inside JS and CSS keep Vite's own handling (import.meta.url-relative).
    renderBuiltUrl: (filename, { hostId, hostType }) =>
      hostType === 'html' ? documentRelative(hostId, filename) : undefined,
  },
  build: {
    outDir: DIST,
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    // The landing page's inline <style> is legacy markup compared against web/index.html by
    // test/dist/dist-parity.test.ts; minification would reorder its declarations.
    cssMinify: false,
    modulePreload: { polyfill: false },
    rolldownOptions: {
      input: pageInputs(),
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'index' ? 'app-[hash].js' : 'games/[name]/app-[hash].js',
        chunkFileNames: 'shared/assets/[name]-[hash].js',
        assetFileNames: 'shared/assets/[name]-[hash][extname]',
      },
    },
  },
});
