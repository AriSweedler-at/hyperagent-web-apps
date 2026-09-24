// One vitest config, one project per suite of tools/ci/suites.ts (docs/design/test-partition.md
// §3). `npm test` runs every project the way the one flat config ran every file: the same tests,
// one process, the reporter prefixing each file with its suite. `VITEST_SUITE=<s>` (set by the
// `test:<s>` scripts beside `--project <s>`) narrows the run to that suite and, because vitest 5
// keeps `coverage` a root-only option (a project cannot carry its own include or thresholds),
// computes the coverage block from the suite: its include globs and its threshold rows alone, so
// `npm run test:gin -- --coverage` measures gin's rows against gin's tests and `npm test --
// --coverage` measures the union, which is byte for byte the block this file held before the
// partition. Two kinds of file run only when their suite is named: the dist guards (`site`, they
// read dist/, which `test:site` builds first, so a stale tree never fails an unrelated `npm test`)
// and the transport contract (`shared-integration`, it starts Chromium, with the 60 s timeouts and
// one-file-at-a-time its own config used to carry). The threshold figures and why they are what
// they are live beside the rows in tools/ci/suites.ts.
import { defineConfig } from 'vitest/config';

import { SUITES, SUITE_NAMES, isSuite, type Suite } from './tools/ci/suites.ts';

/** The suite `VITEST_SUITE` names, or none; a misspelling is an error, never a silent full run. */
const suiteFromEnv = (value: string | undefined): Suite | undefined => {
  if (value === undefined || value === '') return undefined;
  if (isSuite(value)) return value;
  throw new Error(`VITEST_SUITE=${value} names no suite; one of: ${SUITE_NAMES.join(', ')}`);
};

const only = suiteFromEnv(process.env['VITEST_SUITE']);
const selected: ReadonlyArray<Suite> = only === undefined ? SUITE_NAMES : [only];

/** A suite's project: its unit globs, plus its standalone globs when it is the suite named. */
const project = (suite: Suite) => {
  const spec = SUITES[suite];
  return {
    extends: true as const,
    test: {
      name: suite,
      include: [...spec.unit, ...(only === suite ? spec.standalone : [])],
      exclude: ['**/node_modules/**'],
      // A browser suite holds ports and a Chromium process: one file at a time, minutes not seconds.
      ...(spec.browser ? { testTimeout: 60_000, hookTimeout: 60_000, fileParallelism: false } : {}),
    },
  };
};

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: selected.flatMap((s) => [...SUITES[s].coverage.include]),
      exclude: ['**/*.test.ts'],
      thresholds: Object.fromEntries(
        selected.flatMap((s) => Object.entries(SUITES[s].coverage.thresholds)),
      ),
    },
    // Named: that one project (so `--project` can only agree). Unnamed: every suite with tests a
    // plain run may start; a suite whose files are all standalone (the browser contract) has no
    // project here, which is what keeps `npm test` off Chromium.
    projects: (only === undefined
      ? SUITE_NAMES.filter((s) => SUITES[s].unit.length > 0)
      : [only]
    ).map(project),
  },
});
