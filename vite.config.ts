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
import { basename, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, type Plugin } from 'vite';

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(REPO_ROOT, 'web');
const DIST = resolve(REPO_ROOT, 'dist');
const LEGACY = resolve(REPO_ROOT, 'legacy');

/**
 * Pages served byte-for-byte from legacy/ until their port is cut over (docs/MIGRATION.md).
 * Cutting a page over is deleting it from this list and deleting its legacy file.
 */
export const DEFAULT_LEGACY_PAGES: ReadonlyArray<string> = ['gin-rummy', 'fidice'];

/**
 * `LEGACY_PAGES=gin-rummy,fidice` overrides the list; `LEGACY_PAGES=` (empty) disables the
 * passthrough so a ported page can be exercised end-to-end before it is flipped (e2e project `next`).
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
 * After the bundle is written, copy each legacy page over Vite's output for that path (and the
 * legacy ICE loader beside them), so dist serves exactly the bytes in legacy/.
 */
const legacyPassthrough = (pages: ReadonlyArray<string>): Plugin => ({
  name: 'legacy-passthrough',
  apply: 'build',
  enforce: 'post',
  closeBundle: () => {
    const pageCopies = pages.map(
      (game) =>
        [resolve(LEGACY, game, 'index.html'), resolve(DIST, 'games', game, 'index.html')] as const,
    );
    const sharedCopies =
      pages.length > 0
        ? [[resolve(LEGACY, 'shared', 'ice.js'), resolve(DIST, 'shared', 'ice.js')] as const]
        : [];
    [...pageCopies, ...sharedCopies].forEach(([from, to]) => {
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
    });
  },
});

export default defineConfig({
  root: WEB,
  base: './',
  plugins: [legacyPassthrough(legacyPagesFrom(process.env['LEGACY_PAGES']))],
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
