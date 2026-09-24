// Which CI jobs a diff selects (docs/design/test-partition.md §6.2): the changed paths of
// `<base>...HEAD` through the change -> jobs table of tools/ci/suites.ts, printed as the `changes`
// job's outputs (`--github`: one `<job>=true|false` line per job plus `everything=`), as JSON
// (`--json`) or for a human (the default: each path with the row that claimed it, then the jobs).
// `--all` selects every job without diffing (a push to main, a workflow_dispatch); `--base` defaults
// to origin/main, which is what the pre-push hook has. Node builtins only, so the `changes` job runs
// it before `npm ci`. The rules themselves live in suites.ts and are tested there; this file only
// diffs, formats and parses its arguments (tools/ci/affected.test.ts).
//
//   node --experimental-strip-types tools/ci/affected.ts [--base <ref>] [--all] [--github | --json]
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { JOBS, jobsFor, ruleFor, type Job } from './suites.ts';

export type Format = 'human' | 'github' | 'json';

export type Args = Readonly<{ base: string; all: boolean; format: Format }>;

export const DEFAULT_BASE = 'origin/main';

const USAGE =
  'usage: affected.ts [--base <ref>] [--all] [--github | --json]  (base defaults to origin/main)';

/** The flags, in any order; an unknown flag or a `--base` with no ref is an error. */
export const parseArgs = (argv: ReadonlyArray<string>): Args => {
  const step = (args: Args, i: number): Args => {
    const flag = argv[i];
    if (flag === undefined) return args;
    if (flag === '--all') return step({ ...args, all: true }, i + 1);
    if (flag === '--github') return step({ ...args, format: 'github' }, i + 1);
    if (flag === '--json') return step({ ...args, format: 'json' }, i + 1);
    if (flag === '--base') {
      const ref = argv[i + 1];
      if (ref === undefined || ref.startsWith('--'))
        throw new Error(`--base needs a ref\n${USAGE}`);
      return step({ ...args, base: ref }, i + 2);
    }
    throw new Error(`unknown argument ${flag}\n${USAGE}`);
  };
  return step({ base: DEFAULT_BASE, all: false, format: 'human' }, 0);
};

/** The paths `<base>...HEAD` changed (merge base to HEAD), repo-relative, as git prints them. */
export const changedPaths = (base: string): ReadonlyArray<string> =>
  execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line !== '');

/** What a run reports: the paths it diffed (null for `--all`) and the jobs they select. */
export type Report = Readonly<{ paths: ReadonlyArray<string> | null; jobs: ReadonlySet<Job> }>;

export const reportFor = (paths: ReadonlyArray<string> | null): Report => ({
  paths,
  jobs: paths === null ? new Set(JOBS) : jobsFor(paths),
});

const everything = (jobs: ReadonlySet<Job>): boolean => JOBS.every((job) => jobs.has(job));

/** `$GITHUB_OUTPUT` lines: every job, true or false, then `everything`. */
export const formatGithub = ({ jobs }: Report): string =>
  [
    ...JOBS.map((job) => `${job}=${String(jobs.has(job))}`),
    `everything=${String(everything(jobs))}`,
  ].join('\n');

export const formatJson = ({ paths, jobs }: Report): string =>
  JSON.stringify(
    {
      paths,
      jobs: Object.fromEntries(JOBS.map((job) => [job, jobs.has(job)])),
      everything: everything(jobs),
    },
    null,
    2,
  );

/** Each path with the row that claimed it, then the jobs in graph order. */
export const formatHuman = ({ paths, jobs }: Report): string => {
  const selected = JOBS.filter((job) => jobs.has(job));
  const head =
    paths === null
      ? ['--all: every job']
      : paths.length === 0
        ? ['no changed paths']
        : paths.map((path) => {
            const rule = ruleFor(path);
            const runs =
              rule.runs === 'everything' || rule.runs === 'nothing'
                ? rule.runs
                : rule.runs.join(', ');
            return `${path}\n    -> ${runs} (${rule.why})`;
          });
  return [
    ...head,
    '',
    `jobs: ${selected.length === 0 ? 'none (check only)' : selected.join(', ')}`,
  ].join('\n');
};

export const format = (report: Report, kind: Format): string =>
  kind === 'github'
    ? formatGithub(report)
    : kind === 'json'
      ? formatJson(report)
      : formatHuman(report);

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const report = reportFor(args.all ? null : changedPaths(args.base));
  console.log(format(report, args.format));
}
