// A throwaway directory shaped like dist/ (docs/ARCHITECTURE.md "Build and serve"): the landing
// page at its root, games/<g>/index.html and shared/ice.js, assembled from web/index.html and the
// verbatim legacy/ files. The server tests mount it so `npm test` never depends on a build having
// run; the built dist/ itself is checked by test/dist/. Callers remove it in afterAll.
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

export const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

export type StagedSite = Readonly<{ root: string; remove: () => void }>;

/** [source in the repo, path inside the staged site]. */
const FILES: ReadonlyArray<readonly [string, string]> = [
  ['web/index.html', 'index.html'],
  ['legacy/gin-rummy/index.html', 'games/gin-rummy/index.html'],
  ['legacy/fidice/index.html', 'games/fidice/index.html'],
  ['legacy/shared/ice.js', 'shared/ice.js'],
];

export const stageSite = (): StagedSite => {
  const root = mkdtempSync(resolve(tmpdir(), 'hyperagent-site-'));
  FILES.forEach(([from, to]) => {
    const target = resolve(root, to);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(resolve(REPO_ROOT, from), target);
  });
  return {
    root,
    remove: () => {
      rmSync(root, { recursive: true, force: true });
    },
  };
};
