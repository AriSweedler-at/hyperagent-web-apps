// docs/MIGRATION.md step 4: the switch to a built dist/ is provably zero-diff. Each page in
// LEGACY_PAGES is byte-identical (sha256) to its legacy/ source, so is shared/ice.js, and the landing
// page is byte-identical to web/index.html (Vite leaves it alone with cssMinify off; a future Vite
// that reformats it will fail here and the owner decides). Honours the same LEGACY_PAGES override
// as vite.config.ts so the e2e `next` project can build with the passthrough disabled. Runs after
// `npm run build` (test:dist).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from 'vitest';

import { DEFAULT_LEGACY_PAGES, legacyPagesFrom } from '../../vite.config.ts';
import { DIST, REPO_ROOT, describeDist, distFiles, readDist } from './dist.ts';

const sha256 = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

const legacyPages = legacyPagesFrom(process.env['LEGACY_PAGES']);

describeDist('dist parity with legacy/ and web/', () => {
  test.each([...legacyPages])('games/%s/index.html is byte-identical to legacy/', (game) => {
    const built = resolve(DIST, 'games', game, 'index.html');
    const source = resolve(REPO_ROOT, 'legacy', game, 'index.html');
    expect(existsSync(built), built).toBe(true);
    expect(sha256(built)).toBe(sha256(source));
  });

  test.skipIf(legacyPages.length === 0)('shared/ice.js is byte-identical to legacy/', () => {
    expect(sha256(resolve(DIST, 'shared', 'ice.js'))).toBe(
      sha256(resolve(REPO_ROOT, 'legacy', 'shared', 'ice.js')),
    );
  });

  test('index.html (the landing page) is byte-identical to web/index.html', () => {
    expect(readDist('index.html')).toBe(
      readFileSync(resolve(REPO_ROOT, 'web', 'index.html'), 'utf8'),
    );
    expect(sha256(resolve(DIST, 'index.html'))).toBe(
      sha256(resolve(REPO_ROOT, 'web', 'index.html')),
    );
  });

  test('.nojekyll from web/public lands at the dist root', () => {
    expect(distFiles()).toContain('.nojekyll');
  });

  test('every default legacy page still has its legacy/ source', () => {
    DEFAULT_LEGACY_PAGES.forEach((game) => {
      expect(existsSync(resolve(REPO_ROOT, 'legacy', game, 'index.html')), game).toBe(true);
    });
  });

  test('the dist tree holds the legacy pages, the landing page and nothing stray at the root', () => {
    const files = distFiles();
    const expected = [
      '.nojekyll',
      'index.html',
      ...legacyPages.map((game) => `games/${game}/index.html`),
      ...(legacyPages.length > 0 ? ['shared/ice.js'] : []),
    ].sort();
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
