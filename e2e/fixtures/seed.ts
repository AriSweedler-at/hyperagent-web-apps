// Deterministic randomness for the browser harness. Each browser context gets its own seed derived
// from the project, the test and the role, so two contexts in one test (host, guest) draw different
// codes and tokens, the same test on the two projects never collides on the broker, and every run
// repeats the last one. The page-side installer is e2e/browser/seed-random.js.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SEED_SCRIPT = readFileSync(
  resolve(import.meta.dirname, '..', 'browser', 'seed-random.js'),
  'utf8',
);
export const RECORD_PEER_SCRIPT = resolve(import.meta.dirname, '..', 'browser', 'record-peer.js');

/** FNV-1a over code points: a stable 32-bit hash of a label. */
export const fnv1a = (text: string): number =>
  Array.from(text, (char) => char.codePointAt(0) ?? 0).reduce(
    (hash, point) => Math.imul(hash ^ point, 16777619) >>> 0,
    0x811c9dc5,
  );

export const seedFor = (parts: ReadonlyArray<string>): number => fnv1a(parts.join(' :: '));

/** The init-script source that seeds `Math.random` in a page with `seed`. */
export const seedScript = (seed: number): string =>
  `window.__e2eSeed = ${String(seed)};\n${SEED_SCRIPT}`;
