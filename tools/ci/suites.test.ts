// The accounting behind the partition (docs/design/test-partition.md): the suites must add up to
// every test in the repo, every coverage row must be measurable by its own suite, and the
// change -> jobs table must hold. A new test file no rule claims fails here, which is how a
// fourth game learns it must register a row in tools/ci/suites.ts.
import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

import { SHELL_GAMES } from '../games.ts';
import { matchesAny } from './glob.ts';
import {
  E2E_SUITES,
  JOBS,
  RULES,
  SUITES,
  SUITE_NAMES,
  e2eJob,
  jobsFor,
  type Job,
  type Suite,
  type Thresholds,
} from './suites.ts';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
/** Top-level generated trees and the dependency symlink: never test sources (test/dist is a source tree). */
const SKIPPED_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  'coverage',
  'playwright-report',
  'test-results',
  '.git',
  '.wrangler',
]);

/** Every regular file under the repo, repo-relative with forward slashes, generated trees left out. */
const repoFiles = (): ReadonlyArray<string> =>
  readdirSync(REPO_ROOT, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(REPO_ROOT, resolve(entry.parentPath, entry.name)).split('\\').join('/'),
    )
    .filter((path) => !SKIPPED_DIRS.has(path.split('/')[0] ?? ''))
    .sort();

const FILES = repoFiles();
const TEST_FILES = FILES.filter((f) => f.endsWith('.test.ts'));
const SPEC_FILES = FILES.filter((f) => f.startsWith('e2e/') && f.endsWith('.spec.ts'));
/** The sources coverage can measure: TypeScript under web/ and infra/ that is not a test. */
const SOURCE_FILES = FILES.filter(
  (f) =>
    (f.startsWith('web/') || f.startsWith('infra/')) &&
    f.endsWith('.ts') &&
    !f.endsWith('.test.ts'),
);

const vitestGlobs = (suite: Suite): ReadonlyArray<string> => [
  ...SUITES[suite].unit,
  ...SUITES[suite].standalone,
];
const claimants = (file: string): ReadonlyArray<Suite> =>
  SUITE_NAMES.filter((s) => matchesAny(file, vitestGlobs(s)));
const e2eClaimants = (file: string): ReadonlyArray<Suite> =>
  E2E_SUITES.filter((s) => matchesAny(file, SUITES[s].e2e?.files ?? []));

describe('every test file belongs to exactly one suite', () => {
  test('the repo has the tests this table was cut over (a floor, not a pin)', () => {
    expect(TEST_FILES.length).toBeGreaterThanOrEqual(126);
    expect(SPEC_FILES.length).toBeGreaterThanOrEqual(28);
  });

  test('every *.test.ts is claimed by exactly one vitest suite', () => {
    const orphans = TEST_FILES.filter((f) => claimants(f).length === 0);
    const doubles = TEST_FILES.filter((f) => claimants(f).length > 1).map(
      (f) => `${f} -> ${claimants(f).join(', ')}`,
    );
    expect(orphans, 'unclaimed test files: add a row in tools/ci/suites.ts').toEqual([]);
    expect(doubles, 'test files claimed twice').toEqual([]);
  });

  test('every e2e spec is claimed by exactly one e2e suite, or shared by suites that each tag their describes', () => {
    const orphans = SPEC_FILES.filter((f) => e2eClaimants(f).length === 0);
    expect(orphans, 'unclaimed specs: add the glob to a suite e2e row').toEqual([]);
    // A shared spec file (the shell specs alone) is claimed by the suites of the games it drives,
    // each with its own tag and the others' in otherTags, so every describe runs in exactly one job.
    const shared = SPEC_FILES.filter((f) => e2eClaimants(f).length > 1);
    expect(shared).toEqual(SPEC_FILES.filter((f) => f.startsWith('e2e/shell-')));
    shared.forEach((f) => {
      const claimants = e2eClaimants(f);
      claimants.forEach((s) => {
        const e2e = SUITES[s].e2e;
        expect(e2e?.tag, `${f}: ${s} shares a spec file and needs a tag`).toBeDefined();
        const others = claimants.filter((o) => o !== s).map((o) => SUITES[o].e2e?.tag);
        expect([...(e2e?.otherTags ?? [])].sort(), `${f}: ${s}'s otherTags`).toEqual(
          [...others].sort(),
        );
      });
    });
    // A tag or an otherTags entry with nothing shared would silently narrow a suite's run.
    E2E_SUITES.filter((s) => SUITES[s].e2e?.tag !== undefined).forEach((s) => {
      expect(
        shared.some((f) => e2eClaimants(f).includes(s)),
        `${s} names a tag but shares no spec file`,
      ).toBe(true);
    });
  });

  test('the shell specs: one describe per shell game, tagged by game, the two game suites claiming them', () => {
    const shellSpecs = SPEC_FILES.filter((f) => f.startsWith('e2e/shell-'));
    expect(shellSpecs).toEqual([
      'e2e/shell-handoff.spec.ts',
      'e2e/shell-home.spec.ts',
      'e2e/shell-liveness.spec.ts',
      'e2e/shell-local.spec.ts',
      'e2e/shell-online.spec.ts',
      'e2e/shell-relay.spec.ts',
      'e2e/shell-resume.spec.ts',
    ]);
    const tags = E2E_SUITES.flatMap((s) => {
      const tag = SUITES[s].e2e?.tag;
      return tag === undefined ? [] : [tag];
    });
    expect([...tags].sort()).toEqual(SHELL_GAMES.map((g) => `@${g}`).sort());
    shellSpecs.forEach((f) => {
      const source = readFileSync(resolve(REPO_ROOT, f), 'utf8');
      // The repo idiom (docs/design/shared-shell.md §6.3): a forEach over the registry, the
      // describe titled and tagged by the game, so --grep @<game> and the suites' grepInvert compose.
      expect(source, f).toContain('SHELL_GAMES.forEach((game) => {');
      expect(source, f).toContain('test.describe(game, { tag: `@${game}` }, () => {');
    });
    // The row for a shell spec runs the e2e jobs of exactly the suites that claim it.
    shellSpecs.forEach((f) => {
      expect([...jobsFor([f])].sort(), f).toEqual(e2eClaimants(f).map(e2eJob).sort());
    });
  });

  test('no test file is both a unit and a standalone glob of its suite', () => {
    SUITE_NAMES.forEach((s) => {
      const both = TEST_FILES.filter(
        (f) => matchesAny(f, SUITES[s].unit) && matchesAny(f, SUITES[s].standalone),
      );
      expect(both, s).toEqual([]);
    });
  });

  test('every glob in the table names at least one file (a typo matches nothing)', () => {
    SUITE_NAMES.forEach((s) => {
      vitestGlobs(s).forEach((glob) => {
        expect(
          TEST_FILES.some((f) => matchesAny(f, [glob])),
          `${s}: ${glob}`,
        ).toBe(true);
      });
      (SUITES[s].e2e?.files ?? []).forEach((glob) => {
        expect(
          SPEC_FILES.some((f) => matchesAny(f, [glob])),
          `${s}: ${glob}`,
        ).toBe(true);
      });
    });
  });

  test('the suites and their e2e halves, in job order', () => {
    expect(SUITE_NAMES).toEqual([
      'shared',
      'shared-integration',
      'gin',
      'fidice',
      'backgammon',
      'site',
      'harness',
    ]);
    expect(E2E_SUITES).toEqual(['gin', 'fidice', 'backgammon', 'site']);
    expect(JOBS).toEqual([...SUITE_NAMES, 'e2e-gin', 'e2e-fidice', 'e2e-backgammon', 'e2e-site']);
    // The browser suite is the only one `npm test` leaves out, the built one the only one that builds.
    expect(SUITE_NAMES.filter((s) => SUITES[s].browser)).toEqual(['shared-integration']);
    expect(SUITE_NAMES.filter((s) => SUITES[s].needsBuild)).toEqual(['site']);
  });

  test('the per-suite file counts as cut over (the table of the design, re-counted on main)', () => {
    const counts = Object.fromEntries(
      SUITE_NAMES.map((s) => [s, TEST_FILES.filter((f) => claimants(f)[0] === s).length]),
    );
    // Floors: a suite may grow, never shrink below what it held at the cut.
    expect(counts['shared']).toBeGreaterThanOrEqual(29);
    expect(counts['shared-integration']).toBeGreaterThanOrEqual(1);
    expect(counts['gin']).toBeGreaterThanOrEqual(44);
    expect(counts['fidice']).toBeGreaterThanOrEqual(17);
    expect(counts['backgammon']).toBeGreaterThanOrEqual(21);
    expect(counts['site']).toBeGreaterThanOrEqual(8);
    expect(counts['harness']).toBeGreaterThanOrEqual(6);
  });
});

/**
 * The rows of vitest.config.ts the day before the partition (commit 21b085e), glob -> the suite
 * that owns it now and the figures. A row may ratchet up (edit both places), never down or out.
 */
const ROWS_BEFORE: ReadonlyArray<readonly [string, Suite, Thresholds]> = [
  ['web/shared/lib/**', 'shared', { lines: 100, functions: 100, branches: 100, statements: 100 }],
  // Added after the partition (docs/design/glossary-links.md §3): held at 100 like shared/lib.
  ['web/shared/ui/**', 'shared', { lines: 100, functions: 100, branches: 100, statements: 100 }],
  ['web/shared/edge/**', 'shared', { lines: 94, functions: 94, statements: 93, branches: 90 }],
  ['web/shared/net/**', 'shared', { lines: 95, functions: 95, statements: 95, branches: 94 }],
  [
    'web/games/fidice/src/domain/**',
    'fidice',
    { lines: 95, functions: 95, statements: 94, branches: 89 },
  ],
  [
    'web/games/fidice/src/bots/**',
    'fidice',
    { lines: 93, functions: 92, statements: 93, branches: 86 },
  ],
  [
    'web/games/fidice/src/net/protocol.ts',
    'fidice',
    { lines: 95, functions: 95, statements: 95, branches: 93 },
  ],
  [
    'web/games/fidice/src/net/**',
    'fidice',
    { lines: 90, functions: 90, statements: 90, branches: 81 },
  ],
  [
    'web/games/fidice/src/app/**',
    'fidice',
    { lines: 94, functions: 93, statements: 94, branches: 94 },
  ],
  [
    'web/games/fidice/src/view/**',
    'fidice',
    { lines: 95, functions: 95, statements: 94, branches: 91 },
  ],
  [
    'web/games/fidice/src/domain/*.algorithms.ts',
    'fidice',
    { lines: 100, functions: 100, statements: 100, branches: 84 },
  ],
  [
    'web/games/gin-rummy/src/engine/**',
    'gin',
    { lines: 94, functions: 94, statements: 93, branches: 92 },
  ],
  [
    'web/games/gin-rummy/src/engine/*.algorithms.ts',
    'gin',
    { lines: 100, functions: 100, statements: 100, branches: 97 },
  ],
  [
    'web/games/backgammon/src/engine/**',
    'backgammon',
    { lines: 94, functions: 94, statements: 93, branches: 92 },
  ],
  [
    'web/games/backgammon/src/engine/*.algorithms.ts',
    'backgammon',
    { lines: 100, functions: 100, statements: 100, branches: 92 },
  ],
  [
    'web/games/backgammon/src/protocol.ts',
    'backgammon',
    { lines: 95, functions: 95, statements: 95, branches: 97 },
  ],
  [
    'web/games/backgammon/src/storage.ts',
    'backgammon',
    { lines: 95, functions: 95, statements: 95, branches: 97 },
  ],
  [
    'web/games/backgammon/src/ui/**',
    'backgammon',
    { lines: 94, functions: 95, statements: 93, branches: 88 },
  ],
  [
    'web/games/backgammon/src/net/**',
    'backgammon',
    { lines: 95, functions: 95, statements: 95, branches: 97 },
  ],
  [
    'web/games/backgammon/src/fx.ts',
    'backgammon',
    { lines: 95, functions: 95, statements: 95, branches: 97 },
  ],
  [
    'web/games/gin-rummy/src/protocol.ts',
    'gin',
    { lines: 95, functions: 95, statements: 95, branches: 97 },
  ],
  [
    'web/games/gin-rummy/src/storage.ts',
    'gin',
    { lines: 95, functions: 95, statements: 95, branches: 97 },
  ],
  [
    'web/games/gin-rummy/src/cardBack.ts',
    'gin',
    { lines: 100, functions: 100, statements: 100, branches: 100 },
  ],
  [
    'web/games/gin-rummy/src/ui/**',
    'gin',
    { lines: 94, functions: 94, statements: 94, branches: 90 },
  ],
  [
    'web/games/gin-rummy/src/stories/catalogue.ts',
    'gin',
    { lines: 90, functions: 90, statements: 90, branches: 90 },
  ],
  [
    'web/games/gin-rummy/src/scorer/**',
    'gin',
    { lines: 95, functions: 95, statements: 92, branches: 85 },
  ],
  [
    'web/games/gin-rummy/src/net/**',
    'gin',
    { lines: 95, functions: 95, statements: 95, branches: 97 },
  ],
  [
    'web/games/gin-rummy/src/fx.ts',
    'gin',
    { lines: 95, functions: 95, statements: 95, branches: 97 },
  ],
  [
    'infra/games-proxy/worker.ts',
    'site',
    { lines: 95, functions: 95, statements: 95, branches: 93 },
  ],
];

const INCLUDE_BEFORE: ReadonlyArray<string> = [
  'web/shared/lib/**/*.ts',
  'web/shared/edge/**/*.ts',
  'web/shared/net/**/*.ts',
  // Added after the partition (docs/design/glossary-links.md §3): the shared shell's pure helpers.
  'web/shared/ui/**/*.ts',
  'web/games/fidice/src/domain/**/*.ts',
  'web/games/fidice/src/bots/**/*.ts',
  'web/games/fidice/src/net/**/*.ts',
  'web/games/fidice/src/app/**/*.ts',
  'web/games/fidice/src/view/**/*.ts',
  'web/games/gin-rummy/src/engine/**/*.ts',
  'web/games/backgammon/src/engine/**/*.ts',
  'web/games/backgammon/src/protocol.ts',
  'web/games/backgammon/src/storage.ts',
  'web/games/backgammon/src/ui/**/*.ts',
  'web/games/backgammon/src/net/**/*.ts',
  'web/games/backgammon/src/fx.ts',
  'web/games/gin-rummy/src/protocol.ts',
  'web/games/gin-rummy/src/storage.ts',
  'web/games/gin-rummy/src/cardBack.ts',
  'web/games/gin-rummy/src/ui/**/*.ts',
  'web/games/gin-rummy/src/stories/catalogue.ts',
  'web/games/gin-rummy/src/scorer/**/*.ts',
  'web/games/gin-rummy/src/net/**/*.ts',
  'web/games/gin-rummy/src/fx.ts',
  'infra/games-proxy/worker.ts',
];

describe('the coverage rows moved, not renumbered', () => {
  const METRICS = ['lines', 'functions', 'statements', 'branches'] as const;

  test.each(ROWS_BEFORE)('%s is a row of %s at or above its figures', (glob, suite, before) => {
    const row = SUITES[suite].coverage.thresholds[glob];
    expect(row, `${glob} left ${suite}'s rows`).toBeDefined();
    METRICS.forEach((metric) => {
      expect(row?.[metric], metric).toBeGreaterThanOrEqual(before[metric]);
    });
  });

  test('no row was added to a suite outside this pin without a line here', () => {
    const now = SUITE_NAMES.flatMap((s) => Object.keys(SUITES[s].coverage.thresholds)).sort();
    expect(now).toEqual(ROWS_BEFORE.map(([glob]) => glob).sort());
  });

  test('the union of the include globs is what the one config listed', () => {
    const now = SUITE_NAMES.flatMap((s) => SUITES[s].coverage.include).sort();
    expect(now).toEqual([...INCLUDE_BEFORE].sort());
  });

  /**
   * Rows that bind files not written yet: backgammon has no *.algorithms.ts today, so its 100% row
   * is a rule for the first one rather than a measurement, and vitest passes it vacuously (an empty
   * coverage map summarises to 100%). Listed here so the assertion below still catches a row that
   * drifts out of its suite's include by accident; a forward row must at least sit under one.
   */
  const FORWARD_ROWS: ReadonlyArray<string> = ['web/games/backgammon/src/engine/*.algorithms.ts'];

  test('every row names sources its own suite measures (vitest passes an empty row silently)', () => {
    SUITE_NAMES.forEach((s) => {
      const measured = SOURCE_FILES.filter((f) => matchesAny(f, SUITES[s].coverage.include));
      Object.keys(SUITES[s].coverage.thresholds).forEach((glob) => {
        const under = SOURCE_FILES.filter((f) => matchesAny(f, [glob]));
        if (FORWARD_ROWS.includes(glob)) {
          const dir = glob.slice(0, glob.lastIndexOf('/') + 1);
          expect(under, `${glob} is a forward row: drop it from FORWARD_ROWS`).toEqual([]);
          expect(
            SUITES[s].coverage.include.some((include) => include.startsWith(dir)),
            `${s}: forward row ${glob} sits under no coverage.include glob`,
          ).toBe(true);
          return;
        }
        expect(under.length, `${s}: ${glob} matches no source file`).toBeGreaterThan(0);
        expect(
          under.filter((f) => !measured.includes(f)),
          `${s}: ${glob} reaches files outside the suite's coverage.include`,
        ).toEqual([]);
      });
    });
  });

  test('no source file is measured by two suites', () => {
    const owners = (f: string): ReadonlyArray<Suite> =>
      SUITE_NAMES.filter((s) => matchesAny(f, SUITES[s].coverage.include));
    expect(SOURCE_FILES.filter((f) => owners(f).length > 1)).toEqual([]);
  });
});

/** The design's §6.4 table and the cases it argues from, as (changed paths -> jobs). */
const EVERYTHING: ReadonlyArray<Job> = JOBS;
const CHANGES: ReadonlyArray<readonly [string, ReadonlyArray<string>, ReadonlyArray<Job>]> = [
  [
    'a gin source file',
    ['web/games/gin-rummy/src/engine/game.ts'],
    ['gin', 'e2e-gin', 'site', 'e2e-site', 'harness'],
  ],
  [
    'a gin test file alone',
    ['web/games/gin-rummy/src/engine/game.test.ts'],
    ['gin', 'e2e-gin', 'site', 'e2e-site', 'harness'],
  ],
  [
    'a fidice screen',
    ['web/games/fidice/src/view/screens/lobby.ts'],
    ['fidice', 'e2e-fidice', 'site', 'e2e-site', 'harness'],
  ],
  [
    'the backgammon page',
    ['web/games/backgammon/index.html', 'web/games/backgammon/theme.css'],
    ['backgammon', 'e2e-backgammon', 'site', 'e2e-site', 'harness'],
  ],
  ['a gin parity oracle', ['test/parity/gin.replay.2.test.ts'], ['gin']],
  ['a fidice parity oracle', ['test/parity/fidice.view.test.ts'], ['fidice']],
  [
    'the two shared oracles',
    ['test/parity/ice.legacy.test.ts', 'test/parity/roomCode.legacy.test.ts'],
    ['shared'],
  ],
  [
    'the gin wire corpus',
    ['test/fixtures/legacy/gin-wire/state.3.json', 'test/fixtures/legacy/gin-wire.test.ts'],
    ['gin', 'harness'],
  ],
  ['a gin legacy cut', ['test/fixtures/legacy/gin-engine.cjs'], ['gin', 'harness']],
  ['the fidice legacy cut', ['test/fixtures/legacy/fidice-core.cjs'], ['fidice', 'harness']],
  [
    'the legacy manifest',
    ['test/fixtures/legacy/MANIFEST.json', 'test/fixtures/legacy/manifest.test.ts'],
    ['harness'],
  ],
  ['the backgammon wire goldens', ['test/fixtures/backgammon-wire/state.json'], ['backgammon']],
  ['a backgammon style golden', ['test/fixtures/styles/backgammon.390x844.json'], ['e2e-site']],
  ['a gin style golden', ['test/fixtures/styles/gin-rummy.1280x800.json'], ['e2e-site']],
  ['the card-back rasters guard', ['test/card-backs.test.ts'], ['gin']],
  [
    'the stories baselines',
    ['e2e/__screenshots__/gin-stories.spec.ts/x--390x844-linux.png'],
    ['e2e-gin'],
  ],
  ['a gin spec', ['e2e/gin-online.spec.ts'], ['e2e-gin']],
  ['a backgammon spec', ['e2e/backgammon-online.spec.ts'], ['e2e-backgammon']],
  ['a shell spec', ['e2e/shell-online.spec.ts'], ['e2e-gin', 'e2e-backgammon']],
  [
    'a shell spec beside a backgammon change',
    ['e2e/shell-handoff.spec.ts', 'web/games/backgammon/src/ui/state.ts'],
    ['e2e-gin', 'backgammon', 'e2e-backgammon', 'site', 'e2e-site', 'harness'],
  ],
  ['the smoke and style specs', ['e2e/smoke.spec.ts', 'e2e/computed-styles.spec.ts'], ['e2e-site']],
  [
    "the shared shell's liveness spec",
    ['e2e/shell-liveness.spec.ts'],
    ['e2e-gin', 'e2e-backgammon'],
  ],
  ['the landing page', ['web/index.html'], ['site', 'e2e-site']],
  ['the alias stub', ['web/games/sheshbesh/index.html'], ['site', 'e2e-site']],
  ['the Worker', ['infra/games-proxy/worker.ts'], ['site', 'e2e-site', 'harness']],
  ['the TURN worker', ['infra/turn-worker/worker.js', 'infra/turn-worker/wrangler.toml'], []],
  [
    'the transport contract',
    ['test/integration/transport.integration.test.ts', 'test/integration/harness.html'],
    ['shared-integration'],
  ],
  ['a dist guard', ['test/dist/asset-urls.test.ts', 'test/dist/dist.ts'], ['site']],
  ['the tokens and ratchet guards', ['test/tokens.test.ts', 'test/ratchet.test.ts'], ['site']],
  ['a harness test', ['test/tools/serve-dist.test.ts'], ['harness']],
  ['the fidice debundle pin', ['test/tools/debundle-fidice.test.ts'], ['fidice']],
  ['docs only', ['docs/ARCHITECTURE.md', 'README.md', 'docs/design/test-partition.md'], []],
  // Two .md files tests read: they sit above the prose row, or a PR editing one would merge unrun.
  ['the class contract', ['web/shared/styles/CONTRACT.md'], ['site']],
  ['the legacy README', ['legacy/README.md'], ['harness', 'site']],
  ['the hooks', ['.githooks/pre-push', 'tools/hooks-verify.sh'], []],
  ['a Claude settings file', ['.claude/settings.json'], []],
  ['shared code', ['web/shared/lib/rng.ts'], EVERYTHING],
  ['a shared stylesheet', ['web/shared/styles/tokens.css'], EVERYTHING],
  ['a shared test alone', ['web/shared/edge/prefs.test.ts'], EVERYTHING],
  ['a harness tool', ['tools/serve-dist.ts'], EVERYTHING],
  ['the registry', ['tools/games.ts'], EVERYTHING],
  ['this table', ['tools/ci/suites.ts'], EVERYTHING],
  ['a shared e2e fixture', ['e2e/fixtures/two-players.ts'], EVERYTHING],
  ['the shell fixtures', ['e2e/fixtures/shell.ts', 'e2e/fixtures/shell-games.ts'], EVERYTHING],
  ['a page-side recorder', ['e2e/browser/record-pc.js'], EVERYTHING],
  ['a frozen legacy page', ['legacy/gin-rummy/index.html'], EVERYTHING],
  ['a workflow', ['.github/workflows/ci.yml'], EVERYTHING],
  ['the lockfile', ['package-lock.json'], EVERYTHING],
  ['a tsconfig', ['tsconfig.node.json'], EVERYTHING],
  ['the lint config', ['eslint.config.js', '.prettierrc'], EVERYTHING],
  ['the vitest config', ['vitest.config.ts'], EVERYTHING],
  ['the Playwright config', ['playwright.config.ts'], EVERYTHING],
  ['the raw-import declaration', ['web/raw-imports.d.ts'], EVERYTHING],
  ['an unknown top-level file', ['some-new-tool.mjs'], EVERYTHING],
  ['a fourth game before it has a row', ['web/games/chess/src/engine.ts'], EVERYTHING],
  ['a spec no rule names', ['e2e/chess-local.spec.ts'], EVERYTHING],
  ['a fixture folder no rule names', ['test/fixtures/chess/x.json'], EVERYTHING],
  ['nothing at all', [], []],
  [
    'a gin change beside a docs change',
    ['web/games/gin-rummy/src/fx.ts', 'README.md'],
    ['gin', 'e2e-gin', 'site', 'e2e-site', 'harness'],
  ],
  [
    'two games',
    ['web/games/gin-rummy/src/fx.ts', 'web/games/fidice/src/fx.ts'],
    ['gin', 'e2e-gin', 'site', 'e2e-site', 'harness', 'fidice', 'e2e-fidice'],
  ],
];

describe('which change runs what', () => {
  test.each(CHANGES)('%s', (_name, paths, jobs) => {
    expect([...jobsFor(paths)].sort()).toEqual([...jobs].sort());
  });

  test('the last rule is the conservative fallback', () => {
    const last = RULES.at(-1);
    expect(last?.globs).toEqual(['**']);
    expect(last?.runs).toBe('everything');
    RULES.forEach((rule) => {
      expect(rule.globs.length, rule.why).toBeGreaterThan(0);
      expect(rule.why.length).toBeGreaterThan(0);
    });
  });

  test('every rule that names jobs names only registered ones', () => {
    RULES.forEach((rule) => {
      if (typeof rule.runs === 'string') return;
      rule.runs.forEach((job) => {
        expect(JOBS, `${rule.why}: ${job}`).toContain(job);
      });
    });
  });
});

/** package.json as the scripts pin needs it. */
const SCRIPTS = (
  JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8')) as Readonly<{
    scripts: Readonly<Record<string, string>>;
  }>
).scripts;

describe('the scripts agree with the table', () => {
  test.each(SUITE_NAMES)('test:%s names its suite twice: VITEST_SUITE and --project', (suite) => {
    // The env var computes the coverage block and the project list; --project is the label that
    // can only agree (vitest refuses a project the list does not hold). Both spell the same name.
    const script = SCRIPTS[`test:${suite}`];
    expect(script, `no test:${suite} script`).toBeDefined();
    expect(script).toContain(`VITEST_SUITE=${suite} vitest run --project ${suite}`);
    // A suite that needs the build builds first; the others never do.
    expect(script?.startsWith('npm run build && ')).toBe(SUITES[suite].needsBuild);
  });

  test('the two aliases of the folded configs point at their suites (one release, then gone)', () => {
    expect(SCRIPTS['test:dist']).toBe('npm run test:site');
    expect(SCRIPTS['test:integration']).toBe('npm run test:shared-integration');
  });

  test('npm test and the full gate keep their meaning', () => {
    expect(SCRIPTS['test']).toBe('vitest run');
    expect(SCRIPTS['check']).toBe(
      'npm run typecheck && npm run lint && npm test && npm run test:site',
    );
  });
});

describe('the e2e scripts agree with the table', () => {
  test.each(E2E_SUITES)(
    'test:e2e:%s sets E2E_SUITE and defers to test:e2e (build, then Playwright)',
    (suite) => {
      expect(SCRIPTS[`test:e2e:${suite}`]).toBe(`E2E_SUITE=${suite} npm run test:e2e`);
    },
  );

  test('a suite with no e2e half has no e2e script, and test:e2e itself is unchanged', () => {
    SUITE_NAMES.filter((s) => SUITES[s].e2e === undefined).forEach((s) => {
      expect(SCRIPTS[`test:e2e:${s}`], s).toBeUndefined();
    });
    expect(SCRIPTS['test:e2e']).toBe('npm run build && playwright test');
  });
});

describe('the affected scripts the hook runs', () => {
  test('check:affected is the gate minus the unaffected suites; affected prints the selection', () => {
    expect(SCRIPTS['check:affected']).toBe(
      'npm run typecheck && npm run lint && npm run test:affected',
    );
    expect(SCRIPTS['test:affected']).toBe(
      'node --experimental-strip-types tools/ci/run-affected.ts',
    );
    expect(SCRIPTS['affected']).toBe('node --experimental-strip-types tools/ci/affected.ts');
  });
});

/** ci.yml as the graph pin needs it: text, since no YAML parser is a dependency here. */
const CI_YML = readFileSync(resolve(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');

describe('ci.yml carries the graph the table describes', () => {
  test.each(JOBS)('%s is a job gated on its changes output, and ci-ok needs it', (job) => {
    expect(CI_YML).toContain(
      `\n  ${job}:\n    needs: changes\n    if: needs.changes.outputs.${job} == 'true'\n`,
    );
    expect(CI_YML).toContain(`      ${job}: \${{ steps.affected.outputs.${job} }}\n`);
    const ciOk = CI_YML.slice(CI_YML.indexOf('\n  ci-ok:'), CI_YML.indexOf('\n  deploy:'));
    expect(ciOk, 'ci-ok needs').toContain(`\n      - ${job}\n`);
  });

  test('check is always on, ci-ok needs changes and is always(), deploy needs ci-ok alone and only on main', () => {
    const check = CI_YML.slice(CI_YML.indexOf('\n  check:'), CI_YML.indexOf('\n  shared:'));
    expect(check).not.toContain('needs:');
    expect(check).not.toContain('\n    if:');
    const ciOk = CI_YML.slice(CI_YML.indexOf('\n  ci-ok:'), CI_YML.indexOf('\n  deploy:'));
    expect(ciOk).toContain('\n      - check\n');
    // Skipped is green in ci-ok, so a failed `changes` must be a failed need, not eleven skips.
    expect(ciOk).toContain('\n      - changes\n');
    expect(ciOk).toContain('\n    if: always()\n');
    expect(ciOk).not.toContain('- broker');
    const deploy = CI_YML.slice(CI_YML.indexOf('\n  deploy:'));
    expect(deploy).toContain('\n    needs: [ci-ok]\n');
    expect(deploy).toContain("github.ref == 'refs/heads/main' && needs.ci-ok.result == 'success'");
  });

  test('the changes job selects everything off a pull request and diffs against the base on one', () => {
    expect(CI_YML).toContain('--base "origin/$BASE" --github | tee -a "$GITHUB_OUTPUT"');
    expect(CI_YML).toContain('--all --github | tee -a "$GITHUB_OUTPUT"');
    expect(CI_YML).toContain('fetch-depth: 0');
  });
});
