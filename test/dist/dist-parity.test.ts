// docs/MIGRATION.md step 4: the switch to a built dist/ is provably zero-diff. Each page in
// LEGACY_PAGES is byte-identical (sha256) to its legacy/ source, so is shared/ice.js, and the landing
// page is byte-identical to web/index.html (Vite leaves it alone with cssMinify off; a future Vite
// that reformats it will fail here and the owner decides). Step 6 adds the dark fidice bundle: both
// trees carry games/fidice/app-[hash].js and its CSS under shared/assets/, and in dist-next/
// (built with `LEGACY_PAGES=`) the fidice page is Vite's, not the legacy copy. Honours the same
// LEGACY_PAGES override as vite.config.ts for dist/. Runs after the builds (test:dist).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from 'vitest';

import { DEFAULT_LEGACY_PAGES } from '../../vite.config.ts';
import { REPO_ROOT, describeDist, distFiles, readDist } from './dist.ts';

const sha256 = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

const LEGACY_FIDICE = resolve(REPO_ROOT, 'legacy', 'fidice', 'index.html');

describeDist('dist parity with legacy/ and web/', (root) => {
  test('each page in LEGACY_PAGES is byte-identical to legacy/', (context) => {
    if (root.legacyPages.length === 0) context.skip('built with LEGACY_PAGES= (no legacy pages)');
    root.legacyPages.forEach((game) => {
      const built = resolve(root.dir, 'games', game, 'index.html');
      const source = resolve(REPO_ROOT, 'legacy', game, 'index.html');
      expect(existsSync(built), built).toBe(true);
      expect(sha256(built), game).toBe(sha256(source));
    });
  });

  test('shared/ice.js is byte-identical to legacy/ (copied on every build)', () => {
    expect(sha256(resolve(root.dir, 'shared', 'ice.js'))).toBe(
      sha256(resolve(REPO_ROOT, 'legacy', 'shared', 'ice.js')),
    );
  });

  test('index.html (the landing page) is byte-identical to web/index.html', () => {
    expect(readDist(root, 'index.html')).toBe(
      readFileSync(resolve(REPO_ROOT, 'web', 'index.html'), 'utf8'),
    );
    expect(sha256(resolve(root.dir, 'index.html'))).toBe(
      sha256(resolve(REPO_ROOT, 'web', 'index.html')),
    );
  });

  test('.nojekyll from web/public lands at the root of the tree', () => {
    expect(distFiles(root)).toContain('.nojekyll');
  });

  test('every default legacy page still has its legacy/ source', () => {
    DEFAULT_LEGACY_PAGES.forEach((game) => {
      expect(existsSync(resolve(REPO_ROOT, 'legacy', game, 'index.html')), game).toBe(true);
    });
  });

  test('the dark fidice bundle is emitted: app-[hash].js with its map beside the page, CSS under shared/assets/', () => {
    const files = distFiles(root);
    const bundles = files.filter((file) => /^games\/fidice\/app-[\w-]+\.js$/.test(file));
    expect(bundles).toHaveLength(1);
    expect(files).toContain(`${bundles[0] ?? ''}.map`);
    expect(files.filter((file) => /^shared\/assets\/[\w-]+\.css$/.test(file))).toHaveLength(1);
    expect(files.filter((file) => file.startsWith('games/fidice/'))).toHaveLength(3);
  });

  test('the fidice page is the legacy copy while fidice is in LEGACY_PAGES, otherwise the built module page', () => {
    const page = resolve(root.dir, 'games', 'fidice', 'index.html');
    const html = readDist(root, 'games/fidice/index.html');
    if (root.legacyPages.includes('fidice')) {
      expect(sha256(page)).toBe(sha256(LEGACY_FIDICE));
      expect(html).toContain('"use strict";');
    } else {
      expect(sha256(page)).not.toBe(sha256(LEGACY_FIDICE));
      expect(html).toContain('<script type="module"');
      expect(html).toContain('<script src="https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js">');
      expect(html).toContain('src="../../shared/ice.js"');
      expect(html).toContain('<div id="app"></div>');
      expect(html).not.toContain('"use strict";');
      expect(html).not.toContain('vite-ignore');
    }
  });

  test('the tree holds the legacy pages, the landing page, the dark bundle and nothing stray at the root', () => {
    const files = distFiles(root);
    const expected = [
      '.nojekyll',
      'index.html',
      'shared/ice.js',
      'games/fidice/index.html',
      ...root.legacyPages.map((game) => `games/${game}/index.html`),
    ];
    expected.forEach((file) => {
      expect(files, file).toContain(file);
    });
    // Root-level files: the landing page, .nojekyll and (once it has a script) the landing's own
    // app-[hash].js with its map. Nothing else may sit beside them.
    const stray = files
      .filter((file) => !file.includes('/'))
      .filter((file) => !['.nojekyll', 'index.html'].includes(file))
      .filter((file) => !/^app-[\w-]+\.js(\.map)?$/.test(file));
    expect(stray).toEqual([]);
  });
});
