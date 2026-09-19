// Shared helpers for the legacy extractors (docs/MIGRATION.md step 2). Each extractor exports a
// pure `extract(pageText)` that test/fixtures/legacy/manifest.test.ts re-runs against the HEAD
// pages, plus a CLI entry that writes the fixture and its MANIFEST.json entry:
//   node --experimental-strip-types tools/legacy/extract-gin-engine.ts
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FIXTURE_DIR = 'test/fixtures/legacy';
export const MANIFEST_PATH = `${FIXTURE_DIR}/MANIFEST.json`;

/** The owner's template pre-commit prompts on files over 150 KB; stay clear of it. */
export const FIXTURE_SIZE_LIMIT = 140 * 1024;

/** A 1-based, inclusive line range of a page. */
export type LineRange = Readonly<{ startLine: number; endLine: number }>;

export type Extracted = Readonly<{
  /** 1-based, inclusive line range of the page the fixture was cut from. */
  startLine: number;
  endLine: number;
  /**
   * The page text of that range, byte for byte; `sourceSha256` pins it. A fixture cut from several
   * ranges (tools/legacy/extract-gin-ui.ts) lists them in `ranges`, `startLine`/`endLine` is their
   * overall span and `source` is the ranges' text joined with newlines: a page edit inside any
   * range changes the hash, one between two ranges does not.
   */
  source: string;
  ranges?: ReadonlyArray<LineRange>;
  /** The generated CommonJS module; `fixtureSha256` pins it. */
  fixture: string;
}>;

export type ManifestEntry = Readonly<{
  page: string;
  fixture: string;
  tool: string;
  startLine: number;
  endLine: number;
  ranges?: ReadonlyArray<LineRange>;
  sourceSha256: string;
  fixtureSha256: string;
}>;

/** The text of `ranges` in a page, each range's lines joined and the ranges joined by newlines. */
export const textOfRanges = (
  lines: ReadonlyArray<string>,
  ranges: ReadonlyArray<LineRange>,
): string => ranges.map((r) => lines.slice(r.startLine - 1, r.endLine).join('\n')).join('\n');

export type Manifest = Readonly<Record<string, ManifestEntry>>;

export const sha256 = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex');

export const readRepoFile = (relativePath: string): string =>
  readFileSync(resolve(REPO_ROOT, relativePath), 'utf8');

/** Index of the first line at or after `from` for which `matches` holds; throws naming `what`. */
export const findLine = (
  lines: ReadonlyArray<string>,
  matches: (line: string) => boolean,
  what: string,
  from = 0,
): number => {
  const index = lines.findIndex((line, i) => i >= from && matches(line));
  if (index < 0) throw new Error(`marker not found: ${what}`);
  return index;
};

/** Index just past the last non-blank line before `end`. */
export const trimBlankBefore = (lines: ReadonlyArray<string>, end: number): number =>
  lines.slice(0, end).reduce((last, line, i) => (line.trim() === '' ? last : i + 1), 0);

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

const readManifest = (): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(readRepoFile(MANIFEST_PATH));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

/** True when `moduleUrl` is the script node was asked to run (not an import of it). */
export const isMain = (moduleUrl: string): boolean => {
  const entry = process.argv[1];
  return entry !== undefined && pathToFileURL(resolve(entry)).href === moduleUrl;
};

export const writeFixture = (
  key: string,
  page: string,
  fixtureName: string,
  tool: string,
  extracted: Extracted,
): void => {
  const bytes = Buffer.byteLength(extracted.fixture, 'utf8');
  if (bytes > FIXTURE_SIZE_LIMIT) {
    throw new Error(
      `${fixtureName} is ${String(bytes)} bytes; split it below ${String(FIXTURE_SIZE_LIMIT)}`,
    );
  }
  const entry: ManifestEntry = {
    page,
    fixture: fixtureName,
    tool,
    startLine: extracted.startLine,
    endLine: extracted.endLine,
    ...(extracted.ranges === undefined ? {} : { ranges: extracted.ranges }),
    sourceSha256: sha256(extracted.source),
    fixtureSha256: sha256(extracted.fixture),
  };
  const merged = { ...readManifest(), [key]: entry };
  const sorted = Object.fromEntries(
    Object.keys(merged)
      .sort()
      .map((k) => [k, merged[k]]),
  );
  mkdirSync(resolve(REPO_ROOT, FIXTURE_DIR), { recursive: true });
  writeFileSync(resolve(REPO_ROOT, FIXTURE_DIR, fixtureName), extracted.fixture);
  writeFileSync(resolve(REPO_ROOT, MANIFEST_PATH), `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(
    `${fixtureName}: ${page} lines ${String(extracted.startLine)}-${String(extracted.endLine)}, ${String(bytes)} bytes, sha256 ${entry.fixtureSha256}`,
  );
};
