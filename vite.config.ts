// Build (docs/ARCHITECTURE.md "Build and serve", "Two origins"). `web/` is the Vite root and the
// public URL tree; every page is an entry found by globbing web/**/index.html, so a new game is
// picked up by its folder. `base: './'` makes every emitted URL document-relative, which is what
// lets the same dist serve from /hyperagent-web-apps/ on github.io and from / on
// games.sweedler.com. Output naming keeps a page's own JS beside it and everything shared under
// shared/assets/, the prefix the proxy Worker already maps. Every page is Vite's since
// docs/MIGRATION.md step 13 cut the last legacy page over; legacy/ is test fixtures only
// (legacy/README.md) and nothing here reads it.
//
// Vite 8 is Rolldown-based: `build.rolldownOptions` is the supported key and `build.rollupOptions`
// is a deprecated alias of it (node_modules/vite/dist/node/index.d.ts), so this file uses the former.
import { readdirSync } from 'node:fs';
import { basename, dirname, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(REPO_ROOT, 'web');
const DIST = resolve(REPO_ROOT, 'dist');

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

/** `./app-x.js` or `../../shared/assets/x.css`: the path from the page's directory to the file. */
const documentRelative = (fromFile: string, toFile: string): string => {
  const rel = posix.relative(posix.dirname(fromFile), toFile);
  return rel.startsWith('.') ? rel : `./${rel}`;
};

export default defineConfig({
  root: WEB,
  base: './',
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
