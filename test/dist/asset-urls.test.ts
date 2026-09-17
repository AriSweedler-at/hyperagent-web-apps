// Guard 1 of docs/ARCHITECTURE.md "Two origins": every src/href/url() in dist HTML and CSS is
// `./`-relative (or bare relative), `../../shared/`-relative or `https://`; never `/`-rooted, so
// the same bytes resolve from /hyperagent-web-apps/ on github.io and from / on games.sweedler.com.
// Nothing may be emitted to a root /assets/ either. Runs after `npm run build` (test:dist).
import { expect, test } from 'vitest';

import { allReferences, classify, describeDist, distFiles, referencedFiles } from './dist.ts';

describeDist('dist asset URLs', () => {
  test('the landing page and every HTML/CSS file in dist are checked', () => {
    const files = referencedFiles();
    expect(files).toContain('index.html');
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  test('every reference is relative, shared-relative or https', () => {
    const references = allReferences();
    expect(references.length).toBeGreaterThan(0);
    const offenders = references
      .map((reference) => ({ ...reference, placement: classify(reference.value) }))
      .filter(
        ({ placement }) =>
          placement === 'rooted' || placement === 'parent-escape' || placement === 'other-scheme',
      );
    expect(offenders, 'references that break one of the two origins').toEqual([]);
  });

  test('every load of shared/ice.js uses the one mapped parent path', () => {
    const iceLoads = allReferences().filter(({ value }) => value.endsWith('/ice.js'));
    expect(iceLoads.length).toBeGreaterThan(0);
    expect(new Set(iceLoads.map(({ value }) => value))).toEqual(new Set(['../../shared/ice.js']));
  });

  test('nothing is emitted under a root assets/ directory', () => {
    expect(distFiles().filter((file) => file.startsWith('assets/'))).toEqual([]);
  });
});
