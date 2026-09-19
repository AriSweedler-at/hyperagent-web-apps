// Whole-file pins for legacy/ (docs/MIGRATION.md step 13). MANIFEST.json pins only the ranges the
// extractors cut (35% of the gin page, none of shared/ice.js), so an edit to the legacy CSS or
// markup, to the UI code between two ranges, or anywhere in ice.js passes manifest.test.ts.
// legacy/README.md promises the three files are never edited; this is the test that keeps that
// promise. There is deliberately no regenerator: a new pin is an oracle change, computed by hand
// (`shasum -a 256 <file>`) and explained in the PR.
import { readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { expect, test } from 'vitest';

import { REPO_ROOT, readRepoFile, sha256 } from '../../../tools/legacy/extract.ts';

const LEGACY_DIR = 'legacy';

const FROZEN: Readonly<Record<string, string>> = {
  'legacy/fidice/index.html': '00c9e5689806c14635a52431e926b8ac1726fc2bca0531a7483a95eb973da311',
  'legacy/gin-rummy/index.html': '1f14459e0e07dfe90864fdcb7e140108709705904694e25beb6f41a0604fa1e7',
  'legacy/shared/ice.js': '92c3472bee9ed0fee9a4af880e7eac6fdd3eae2c10c5ed00dc7d6ddd561c1ba9',
};

test.each(Object.entries(FROZEN))('%s is byte-identical to its sha256 pin', (path, pin) => {
  expect(sha256(readRepoFile(path))).toBe(pin);
});

test('legacy/ holds exactly the three frozen files and its README', () => {
  const root = resolve(REPO_ROOT, LEGACY_DIR);
  const files = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(LEGACY_DIR, relative(root, entry.parentPath), entry.name))
    .sort();
  expect(files).toEqual([...Object.keys(FROZEN), `${LEGACY_DIR}/README.md`].sort());
});
