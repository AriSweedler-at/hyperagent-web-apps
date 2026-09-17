// Ties the sha256-pinned legacy fixtures to the pages at HEAD (docs/MIGRATION.md step 2): each
// extractor is re-run against the live page text and its output must equal the fixture on disk,
// and MANIFEST.json must pin both the page range and the fixture. A page edit inside a range, or a
// hand edit of a fixture, fails here; the fix is to re-run `npm run fixtures:legacy` (and to say
// why the oracle changed).
import { createRequire } from 'node:module';

import { describe, expect, test } from 'vitest';

import {
  FIDICE_FIXTURE,
  FIDICE_KEY,
  FIDICE_PAGE,
  extractFidiceCore,
} from '../../../tools/legacy/extract-fidice-core.ts';
import {
  GIN_FIXTURE,
  GIN_KEY,
  GIN_PAGE,
  extractGinEngine,
} from '../../../tools/legacy/extract-gin-engine.ts';
import {
  FIXTURE_DIR,
  FIXTURE_SIZE_LIMIT,
  MANIFEST_PATH,
  readRepoFile,
  sha256,
  type Extracted,
  type Manifest,
} from '../../../tools/legacy/extract.ts';

const load = createRequire(import.meta.url);
const manifest = JSON.parse(readRepoFile(MANIFEST_PATH)) as Manifest;

const cases: ReadonlyArray<readonly [string, string, string, (page: string) => Extracted]> = [
  [GIN_KEY, GIN_PAGE, GIN_FIXTURE, extractGinEngine],
  [FIDICE_KEY, FIDICE_PAGE, FIDICE_FIXTURE, extractFidiceCore],
];

test('the manifest lists exactly the two fixtures', () => {
  expect(Object.keys(manifest).sort()).toEqual([FIDICE_KEY, GIN_KEY].sort());
});

describe.each(cases)('%s', (key, page, fixtureName, extract) => {
  const entry = manifest[key];
  const extracted = extract(readRepoFile(page));
  const onDisk = readRepoFile(`${FIXTURE_DIR}/${fixtureName}`);

  test('the fixture on disk is what the extractor cuts from the HEAD page', () => {
    expect(onDisk).toBe(extracted.fixture);
  });

  test('MANIFEST.json pins the page range', () => {
    expect(entry).toBeDefined();
    expect(entry?.page).toBe(page);
    expect(entry?.fixture).toBe(fixtureName);
    expect(entry?.startLine).toBe(extracted.startLine);
    expect(entry?.endLine).toBe(extracted.endLine);
    expect(entry?.sourceSha256).toBe(sha256(extracted.source));
  });

  test('MANIFEST.json pins the fixture', () => {
    expect(entry?.fixtureSha256).toBe(sha256(onDisk));
  });

  test('the pinned range is the page text at those lines', () => {
    const lines = readRepoFile(page).split('\n');
    expect(lines.slice(extracted.startLine - 1, extracted.endLine).join('\n')).toBe(
      extracted.source,
    );
  });

  test('the fixture loads in node through require()', () => {
    const mod: unknown = load(`./${fixtureName}`);
    expect(typeof mod).toBe('object');
    expect(mod).not.toBeNull();
    expect(Object.keys(mod as object).length).toBeGreaterThan(20);
  });

  test('the fixture stays clear of the template pre-commit size prompt', () => {
    expect(Buffer.byteLength(onDisk, 'utf8')).toBeLessThan(FIXTURE_SIZE_LIMIT);
  });

  test('the fixture carries no trailing whitespace (the template pre-commit rejects it)', () => {
    expect(onDisk.split('\n').filter((line) => /\s$/.test(line))).toEqual([]);
  });
});
