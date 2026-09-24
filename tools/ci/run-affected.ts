// The pre-push hook's fast loop (`npm run test:affected`, inside `npm run check:affected`): the
// suites tools/ci/affected.ts selects from the diff against origin/main, run one after another
// through their own `npm run test:<suite>` scripts, stopping at the first failure. Sequential on
// purpose: two vitest runs at once would each want every core. The browser suite and the e2e jobs
// are left to CI, as `npm run check` never ran them either; they are listed so the push knows
// what CI will add. Same flags as affected.ts (`--base <ref>`, `--all`).
import { spawnSync } from 'node:child_process';

import { changedPaths, parseArgs, reportFor } from './affected.ts';
import { JOBS, SUITES, SUITE_NAMES, type Job, type Suite } from './suites.ts';

const args = parseArgs(process.argv.slice(2));
const report = reportFor(args.all ? null : changedPaths(args.base));

/** The suites this machine runs: selected, and not a browser suite. */
const local: ReadonlyArray<Suite> = SUITE_NAMES.filter(
  (suite) => report.jobs.has(suite) && !SUITES[suite].browser,
);
/** What CI runs on top: the browser suite and the e2e jobs, when selected. */
const deferred: ReadonlyArray<Job> = JOBS.filter(
  (job) => report.jobs.has(job) && !(local as ReadonlyArray<Job>).includes(job),
);

const paths = report.paths;
console.log(
  paths === null
    ? 'test:affected: every suite (--all)'
    : `test:affected: ${String(paths.length)} changed path(s) against ${args.base}`,
);
console.log(`  here: ${local.length === 0 ? 'nothing to run' : local.join(', ')}`);
if (deferred.length > 0) console.log(`  CI adds: ${deferred.join(', ')}`);

const run = (suite: Suite): number => {
  console.log(`\n== npm run test:${suite}`);
  return spawnSync('npm', ['run', `test:${suite}`], { stdio: 'inherit' }).status ?? 1;
};

// `find` runs the suites in order and stops at the first non-zero status.
const failed = local.find((suite) => run(suite) !== 0);
if (failed !== undefined) {
  console.error(`\ntest:affected: test:${failed} failed`);
  process.exit(1);
}
console.log(`\ntest:affected: ok (${String(local.length)} suite(s))`);
