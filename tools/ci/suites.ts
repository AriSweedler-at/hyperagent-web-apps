// The one place a path is assigned to a test suite (docs/design/test-partition.md). Read by
// vitest.config.ts (one project per suite, the coverage block computed from VITEST_SUITE),
// playwright.config.ts (E2E_SUITE -> testMatch), tools/ci/affected.ts (which CI jobs a diff
// selects) and the pre-push hook through tools/ci/run-affected.ts; nothing else spells a path list.
// Seven suites, decided by path alone: `shared` (web/shared unit tests and the two legacy oracles
// that read only shared code), `shared-integration` (the transport contract in Chromium; the fake
// two-seat game of the design's §4 joins it), one per game (its colocated tests, its parity
// oracles, its fixture pins), `site` (guards over the built site or over every page at once) and
// `harness` (the harness testing itself). tools/ci/suites.test.ts is the accounting: every
// *.test.ts and every e2e spec is claimed by exactly one suite, every threshold row sits under a
// coverage.include glob of its own suite (vitest passes an empty glob's row silently: an empty
// coverage map summarises to 100%), and the change -> jobs table below holds. Node builtins only,
// so `node --experimental-strip-types tools/ci/affected.ts` runs before `npm ci` in CI.
import { matchesAny } from './glob.ts';

export type Suite =
  'shared' | 'shared-integration' | 'gin' | 'fidice' | 'backgammon' | 'site' | 'harness';

/** One coverage row: vitest's `coverage.thresholds[glob]` shape. */
export type Thresholds = Readonly<{
  lines: number;
  functions: number;
  branches: number;
  statements: number;
}>;

/** A suite's Playwright half: its spec files, and the tags of the other games' describes to leave out of a shared spec file (the design's §5.2; none today). */
export type E2eSpec = Readonly<{ files: ReadonlyArray<string>; otherTags: ReadonlyArray<string> }>;

export type SuiteSpec = Readonly<{
  /** vitest include globs `npm test` runs, and `npm run test:<suite>` with them. */
  unit: ReadonlyArray<string>;
  /**
   * vitest include globs only `npm run test:<suite>` runs, never a plain `npm test`: the dist
   * guards (they read dist/, so the script builds first and a stale tree never fails an unrelated
   * run) and the transport contract (it starts Chromium).
   */
  standalone: ReadonlyArray<string>;
  /** Starts a browser: 60 s timeouts, one file at a time, and the pre-push hook leaves it to CI. */
  browser: boolean;
  /** `vite build` before the run (the `test:<suite>` script does it). */
  needsBuild: boolean;
  /** The suite's coverage.include and its threshold rows: the rows vitest.config.ts held before the partition, moved, not renumbered. */
  coverage: Readonly<{
    include: ReadonlyArray<string>;
    thresholds: Readonly<Record<string, Thresholds>>;
  }>;
  /** The e2e specs that belong to this suite; absent for a suite with none. */
  e2e?: E2eSpec;
}>;

const NO_COVERAGE = { include: [], thresholds: {} } as const;

/**
 * The rows, in job order. The threshold comments are the measurements the rows were ratcheted
 * from (docs/MIGRATION.md step 15 and the design PRs since): lines, functions and statements 5
 * points under what was measured wherever that beat the former 90% floor by 8 or more, branches
 * 3 points under, and nothing ever went down. The unit suites are seeded, so the figures are
 * deterministic. Each suite's rows are measured by that suite alone (docs/design/test-partition.md
 * "Coverage"), which is what the partition proves: a row that reached its figure only through
 * another suite's tests would have shown up there.
 */
export const SUITES: Readonly<Record<Suite, SuiteSpec>> = {
  shared: {
    unit: [
      'web/shared/**/*.test.ts',
      // The two legacy oracles that read only web/shared: ice.ts against legacy/shared/ice.js and
      // the room-code literals grepped out of the legacy pages.
      'test/parity/ice.legacy.test.ts',
      'test/parity/roomCode.legacy.test.ts',
    ],
    standalone: [],
    browser: false,
    needsBuild: false,
    coverage: {
      include: ['web/shared/lib/**/*.ts', 'web/shared/edge/**/*.ts', 'web/shared/net/**/*.ts'],
      // The shared pure library stays at 100% lines, functions and statements
      // (docs/ARCHITECTURE.md "*.algorithms.ts"). Measured at the ratchet
      // (lines/functions/statements/branches): shared/lib 100/100/100/100, shared/edge
      // 99.4/98.8/98.9/94.4 (re-measured with prefs.ts (A3), cuePlayer.ts and netDeps.ts (A4), the
      // three at 100/100/100/100).
      thresholds: {
        'web/shared/lib/**': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'web/shared/edge/**': { lines: 94, functions: 94, statements: 93, branches: 90 },
        // The two-seat sessions gin's net/ became (docs/design/shared-shell.md A1): the 21 scenarios
        // once over a fake codec (sessions.test.ts beside them, with sessions.harness.ts), the two
        // games' byte-pinning suites through their wrappers and the gin wire-corpus replay. Measured
        // at the move (lines/functions/statements/branches): 100/100/100/97.8.
        'web/shared/net/**': { lines: 95, functions: 95, statements: 95, branches: 94 },
      },
    },
  },
  'shared-integration': {
    // The fake two-seat game of docs/design/test-partition.md §4 lands here (node, milliseconds);
    // until then the suite is the transport contract alone.
    unit: [],
    // The real PeerJS transport through a local PeerServer in Chromium (test/integration/): its
    // own vitest config until the partition; the browser flag carries its timeouts now.
    standalone: ['test/integration/**/*.test.ts'],
    browser: true,
    needsBuild: false,
    coverage: NO_COVERAGE,
  },
  gin: {
    unit: [
      'web/games/gin-rummy/**/*.test.ts',
      // The legacy engine, UI, wire and storage oracles are gin's migration proof.
      'test/parity/gin.*.test.ts',
      // Re-records gin's wire corpus from the legacy page and pins it.
      'test/fixtures/legacy/gin-wire.test.ts',
      // Guards the committed rasters under web/games/gin-rummy/backs/.
      'test/card-backs.test.ts',
    ],
    standalone: [],
    browser: false,
    needsBuild: false,
    coverage: {
      include: [
        'web/games/gin-rummy/src/engine/**/*.ts',
        'web/games/gin-rummy/src/protocol.ts',
        'web/games/gin-rummy/src/storage.ts',
        'web/games/gin-rummy/src/cardBack.ts',
        'web/games/gin-rummy/src/ui/**/*.ts',
        'web/games/gin-rummy/src/stories/catalogue.ts',
        'web/games/gin-rummy/src/scorer/**/*.ts',
        'web/games/gin-rummy/src/net/**/*.ts',
        'web/games/gin-rummy/src/fx.ts',
      ],
      // Who exercises what: the engine the parity suites and the replay; the protocol, storage and
      // pure ui/ and scorer/ helpers the wire-corpus, storage-capture and string-golden suites under
      // test/parity plus the table tests beside them; the net/ wrappers the scenario tests beside
      // them and the wire-corpus replay. Measured at the ratchet (lines/functions/statements/
      // branches): engine 99.8/99.3/98.7/95.8, engine algorithms 100/100/100/100, protocol
      // 100/100/100/100, storage 100/100/100/100, ui 99.8/99.5/99.1/93.7, scorer 100/100/97.9/88.5,
      // net 100/100/99.2/96.2, fx 100/100/100/100 (since A4 the ~8-line wrapper over
      // web/shared/edge/cuePlayer.ts, no branches; its wiring test keeps the row). Since the
      // shared-shell PR A2 protocol.ts is a wrapper over web/shared/lib/protocol.ts that measures
      // two lines (the skeleton's own test holds it at 100/100/100/100 inside the shared/lib row);
      // it still measures 100/100/100/100 through the wire-corpus, golden and session suites.
      thresholds: {
        'web/games/gin-rummy/src/engine/**': {
          lines: 94,
          functions: 94,
          statements: 93,
          branches: 92,
        },
        'web/games/gin-rummy/src/engine/*.algorithms.ts': {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 97,
        },
        'web/games/gin-rummy/src/protocol.ts': {
          lines: 95,
          functions: 95,
          statements: 95,
          branches: 97,
        },
        'web/games/gin-rummy/src/storage.ts': {
          lines: 95,
          functions: 95,
          statements: 95,
          branches: 97,
        },
        'web/games/gin-rummy/src/cardBack.ts': {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        'web/games/gin-rummy/src/ui/**': { lines: 94, functions: 94, statements: 94, branches: 90 },
        // The stories catalogue (docs/design/gin-draw-ghost-slot.md §7): pure builders its own test
        // runs in full; stories/boot.ts is the page that paints them and stays out, like main.ts.
        'web/games/gin-rummy/src/stories/catalogue.ts': {
          lines: 90,
          functions: 90,
          statements: 90,
          branches: 90,
        },
        'web/games/gin-rummy/src/scorer/**': {
          lines: 95,
          functions: 95,
          statements: 92,
          branches: 85,
        },
        // Since docs/design/shared-shell.md A1 gin's net/ is the two wrappers over web/shared/net,
        // where its sessions and their measured 100/100/99.2/96.2 went; the wrappers measure 100 on
        // every metric, so the row is a small file's, like protocol's.
        'web/games/gin-rummy/src/net/**': {
          lines: 95,
          functions: 95,
          statements: 95,
          branches: 97,
        },
        'web/games/gin-rummy/src/fx.ts': { lines: 95, functions: 95, statements: 95, branches: 97 },
      },
    },
    e2e: { files: ['**/gin-*.spec.ts'], otherTags: [] },
  },
  fidice: {
    unit: [
      'web/games/fidice/**/*.test.ts',
      // The legacy core, view and sessions oracles.
      'test/parity/fidice.*.test.ts',
      // Pins web/games/fidice/** to the legacy bundle: under test/tools, but about fidice.
      'test/tools/debundle-fidice.test.ts',
    ],
    standalone: [],
    browser: false,
    needsBuild: false,
    coverage: {
      include: [
        'web/games/fidice/src/domain/**/*.ts',
        'web/games/fidice/src/bots/**/*.ts',
        'web/games/fidice/src/net/**/*.ts',
        'web/games/fidice/src/app/**/*.ts',
        'web/games/fidice/src/view/**/*.ts',
      ],
      // Who exercises what: the pure core (domain, bots, net/protocol) the parity suites; the view
      // the per-screen render tests and the view oracle; net/** (sessions over transport.fake.ts)
      // and app/** (the controller over fake effects, clock, DOM and session stubs) the tests
      // beside them, main.ts staying out as the boot that constructs the real adapters. Measured at
      // the ratchet (lines/functions/statements/branches): domain 100/100/99.1/92.6, bots
      // 98.9/97.9/98.4/89.9, net/protocol 100/100/100/96.7, net 95.9/93.2/92.2/84.4, app
      // 99.7/98.5/99.1/97.2, view 100/100/99.3/94.3, domain algorithms 100/100/100/87.5. Since the
      // shared-shell PR A2 net/protocol.ts is a wrapper over web/shared/lib/protocol.ts (two lines)
      // that still measures 100/100/100/100 through the golden and session suites.
      thresholds: {
        'web/games/fidice/src/domain/**': {
          lines: 95,
          functions: 95,
          statements: 94,
          branches: 89,
        },
        'web/games/fidice/src/bots/**': { lines: 93, functions: 92, statements: 93, branches: 86 },
        'web/games/fidice/src/net/protocol.ts': {
          lines: 95,
          functions: 95,
          statements: 95,
          branches: 93,
        },
        'web/games/fidice/src/net/**': { lines: 90, functions: 90, statements: 90, branches: 81 },
        'web/games/fidice/src/app/**': { lines: 94, functions: 93, statements: 94, branches: 94 },
        'web/games/fidice/src/view/**': { lines: 95, functions: 95, statements: 94, branches: 91 },
        'web/games/fidice/src/domain/*.algorithms.ts': {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 84,
        },
      },
    },
    e2e: { files: ['**/fidice-*.spec.ts'], otherTags: [] },
  },
  backgammon: {
    // Colocated only: no legacy leg (its oracle is engine/replay.test.ts); its wire goldens under
    // test/fixtures/backgammon-wire/ are read by protocol.test.ts beside the module.
    unit: ['web/games/backgammon/**/*.test.ts'],
    standalone: [],
    browser: false,
    needsBuild: false,
    coverage: {
      include: [
        'web/games/backgammon/src/engine/**/*.ts',
        'web/games/backgammon/src/protocol.ts',
        'web/games/backgammon/src/storage.ts',
        'web/games/backgammon/src/ui/**/*.ts',
        'web/games/backgammon/src/net/**/*.ts',
        'web/games/backgammon/src/fx.ts',
      ],
      // The engine (docs/design/backgammon-board.md §6): the table, scenario and seeded replay tests
      // beside it, the same targets as gin's engine and 100% lines for any algorithms file. The rest
      // of the page at measured minus 5/5/5/3 like gin's rows: the wire goldens and decoder tests
      // (protocol), the Map-backed store tests (storage), the reducer, builder, painter and page-fake
      // suites (ui/**), the session scenarios over transport.fake.ts (net/**) and the cue table with
      // the wrapper over the shared player (fx). Measured (lines/functions/statements/branches):
      // protocol 100/100/100/100, storage 100/100/100/100, ui 99.6/100/98.7/91.6, net
      // 100/100/98.9/94.4, fx 100/100/100/100. Re-measured when the shared-shell extraction (A3)
      // moved the readers and writers both storage.ts spelled into web/shared/edge/prefs.ts: storage
      // still 100/100/100/100 (no branch left). Since A1 its net/ is the two wrappers over
      // web/shared/net (100 on every metric): the row is a small file's, like protocol's.
      thresholds: {
        'web/games/backgammon/src/engine/**': {
          lines: 94,
          functions: 94,
          statements: 93,
          branches: 92,
        },
        'web/games/backgammon/src/engine/*.algorithms.ts': {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 92,
        },
        'web/games/backgammon/src/protocol.ts': {
          lines: 95,
          functions: 95,
          statements: 95,
          branches: 97,
        },
        'web/games/backgammon/src/storage.ts': {
          lines: 95,
          functions: 95,
          statements: 95,
          branches: 97,
        },
        'web/games/backgammon/src/ui/**': {
          lines: 94,
          functions: 95,
          statements: 93,
          branches: 88,
        },
        'web/games/backgammon/src/net/**': {
          lines: 95,
          functions: 95,
          statements: 95,
          branches: 97,
        },
        'web/games/backgammon/src/fx.ts': {
          lines: 95,
          functions: 95,
          statements: 95,
          branches: 97,
        },
      },
    },
    e2e: { files: ['**/backgammon-*.spec.ts'], otherTags: [] },
  },
  site: {
    unit: [
      // Which theme.css declares which token, across all three games.
      'test/tokens.test.ts',
      // No .js under web/.
      'test/ratchet.test.ts',
      // The games.sweedler.com Worker is how the site is served; its row is the one infra/ row.
      'infra/games-proxy/worker.test.ts',
    ],
    // The dist guards read the build output (asset URLs, both origins, the class contract, landing
    // parity, the backgammon grid); each skips with a note when dist/ is absent.
    standalone: ['test/dist/**/*.test.ts'],
    browser: false,
    needsBuild: true,
    coverage: {
      include: ['infra/games-proxy/worker.ts'],
      // The Worker's table tests over a stubbed global fetch. Measured: 100/100/100/96.7.
      thresholds: {
        'infra/games-proxy/worker.ts': { lines: 95, functions: 95, statements: 95, branches: 93 },
      },
    },
    // Every page on both origins, and the six computed-style goldens (two viewports per game).
    e2e: { files: ['**/smoke.spec.ts', '**/computed-styles.spec.ts'], otherTags: [] },
  },
  harness: {
    unit: [
      // The two emulated origins and the golden normaliser. Spelled out because
      // test/tools/debundle-fidice.test.ts is fidice's: a new harness test registers here.
      'test/tools/{serve-dist,proxy-dev,computed-styles}.test.ts',
      // The legacy pins: the frozen pages' hashes and the re-run of every extractor.
      'test/fixtures/legacy/frozen.test.ts',
      'test/fixtures/legacy/manifest.test.ts',
      // The registry and the CI tooling (this table's own accounting among them).
      'tools/**/*.test.ts',
    ],
    standalone: [],
    browser: false,
    needsBuild: false,
    coverage: NO_COVERAGE,
  },
};

/** The suites in job order: the order the CI graph lists them and `npm test` reports them. */
export const SUITE_NAMES: ReadonlyArray<Suite> = Object.keys(SUITES) as ReadonlyArray<Suite>;

export const isSuite = (name: string): name is Suite =>
  (SUITE_NAMES as ReadonlyArray<string>).includes(name);

/** The suites with an e2e half: the `E2E_SUITE` values and the `e2e-<suite>` jobs. */
export const E2E_SUITES: ReadonlyArray<Suite> = SUITE_NAMES.filter(
  (s) => SUITES[s].e2e !== undefined,
);

/** A CI job: a vitest suite, or the Playwright run over one suite's specs. */
export type Job = Suite | `e2e-${Suite}`;

export const e2eJob = (suite: Suite): Job => `e2e-${suite}`;

/** Every gated job, in the order ci.yml lists them; `check` is not one (it always runs). */
export const JOBS: ReadonlyArray<Job> = [...SUITE_NAMES, ...E2E_SUITES.map(e2eJob)];

/** What one rule selects: a list of jobs, every job, or none (the `check` job runs regardless). */
export type Selection = ReadonlyArray<Job> | 'everything' | 'nothing';

export type Rule = Readonly<{ globs: ReadonlyArray<string>; runs: Selection; why: string }>;

const GAME_FOLDERS: Readonly<Record<'gin' | 'fidice' | 'backgammon', string>> = {
  gin: 'gin-rummy',
  fidice: 'fidice',
  backgammon: 'backgammon',
};

/** The rows every game gets: its folder, its parity oracles, its specs and its style goldens. */
const gameRules = (game: 'gin' | 'fidice' | 'backgammon'): ReadonlyArray<Rule> => {
  const folder = GAME_FOLDERS[game];
  return [
    {
      globs: [`web/games/${folder}/**`],
      runs: [game, e2eJob(game), 'site', 'e2e-site', 'harness'],
      why: `the page is built into dist and smoked, tokens/ratchet/the class contract read every game, and tools/games.test.ts pins the registry against the games' storage keys`,
    },
    { globs: [`test/parity/${game}.*`], runs: [game], why: `${game}'s legacy oracles` },
    { globs: [`e2e/${game}-*.spec.ts`], runs: [e2eJob(game)], why: `${game}'s own specs` },
    {
      globs: [`test/fixtures/styles/${folder}.*`],
      runs: ['e2e-site'],
      why: 'a computed-style golden is read by e2e/computed-styles.spec.ts alone',
    },
  ];
};

/**
 * Which jobs a changed path selects: the first matching row wins, top to bottom, and a diff
 * selects the union over its paths (`everything` anywhere selects every job). The conservative
 * side is the fallback: a path no row names runs everything, so a new folder must earn its row.
 */
export const RULES: ReadonlyArray<Rule> = [
  {
    globs: [
      'docs/**',
      '**/*.md',
      'LICENSE',
      '.gitignore',
      '.claude/**',
      // hooks:verify runs in the always-on `check` job.
      '.githooks/**',
      'tools/hooks-verify.sh',
      // No test touches Cloudflare (issue #19): the TURN worker is deployed by hand.
      'infra/turn-worker/**',
    ],
    runs: 'nothing',
    why: 'prose, hooks and the hand-deployed worker: only the check job reads them',
  },
  {
    globs: [
      // The harness drives every suite: the two origins, the extractors, the drivers, the registry.
      'tools/**',
      'e2e/fixtures/**',
      'e2e/browser/**',
      // The frozen pages are the oracle of two games and the serve-dist aliases.
      'legacy/**',
      // Whatever configures, builds, lints or runs the tests.
      '.github/**',
      'package.json',
      'package-lock.json',
      '.nvmrc',
      'tsconfig*.json',
      'eslint.config.js',
      '.prettierrc*',
      '.prettierignore',
      'vite.config.ts',
      'vitest.config.ts',
      'playwright.config.ts',
      'web/raw-imports.d.ts',
      // Every game imports shared, the site smokes every game and a token moves every golden.
      'web/shared/**',
    ],
    runs: 'everything',
    why: 'the harness, the build and lint configuration, the frozen oracles and the shared code every game imports',
  },
  ...gameRules('gin'),
  {
    globs: ['test/fixtures/legacy/gin-*', 'test/fixtures/legacy/gin-*/**'],
    runs: ['gin', 'harness'],
    why: 'the gin cuts, wire frames and storage captures; manifest.test.ts re-runs every extractor',
  },
  { globs: ['test/card-backs.test.ts'], runs: ['gin'], why: 'guards gin/backs' },
  { globs: ['e2e/__screenshots__/**'], runs: [e2eJob('gin')], why: 'the stories baselines' },
  ...gameRules('fidice'),
  {
    globs: ['test/fixtures/legacy/fidice-*'],
    runs: ['fidice', 'harness'],
    why: 'the fidice cut; manifest.test.ts re-runs every extractor',
  },
  {
    globs: ['test/tools/debundle-fidice.test.ts'],
    runs: ['fidice'],
    why: 'pins web/games/fidice to the legacy bundle',
  },
  ...gameRules('backgammon'),
  {
    globs: ['test/fixtures/backgammon-wire/**'],
    runs: ['backgammon'],
    why: 'the backgammon wire goldens',
  },
  {
    globs: ['test/parity/ice.legacy.test.ts', 'test/parity/roomCode.legacy.test.ts'],
    runs: ['shared'],
    why: 'the two legacy oracles over shared code',
  },
  {
    globs: ['test/integration/**'],
    runs: ['shared-integration'],
    why: 'the transport contract',
  },
  {
    globs: ['web/index.html', 'web/games/sheshbesh/**'],
    runs: ['site', 'e2e-site'],
    why: 'the landing page and the alias stub: dist parity and the smoke',
  },
  {
    globs: ['test/dist/**', 'test/tokens.test.ts', 'test/ratchet.test.ts'],
    runs: ['site'],
    why: 'the site guards themselves',
  },
  {
    globs: ['e2e/smoke.spec.ts', 'e2e/computed-styles.spec.ts'],
    runs: ['e2e-site'],
    why: 'the site specs themselves',
  },
  {
    globs: ['infra/games-proxy/**'],
    runs: ['site', 'e2e-site', 'harness'],
    why: 'the Worker: its table tests are site, proxy-dev runs it (harness) and the proxy origin smokes through it',
  },
  {
    globs: ['test/tools/**', 'test/fixtures/legacy/**'],
    runs: ['harness'],
    why: 'the harness tests and the legacy pins (MANIFEST.json among them)',
  },
  {
    globs: ['**'],
    runs: 'everything',
    why: 'a path no row names: conservative until it earns a row',
  },
];

/** The first row that matches `path`; the last row (`**`) always does. */
export const ruleFor = (path: string): Rule =>
  RULES.find((rule) => matchesAny(path, rule.globs)) ?? {
    globs: ['**'],
    runs: 'everything',
    why: 'fallback',
  };

const selectionFor = (path: string): Selection => ruleFor(path).runs;

/** The jobs a diff selects (its paths repo-relative, as `git diff --name-only` prints them). */
export const jobsFor = (paths: ReadonlyArray<string>): ReadonlySet<Job> => {
  const selections = paths.map(selectionFor);
  if (selections.includes('everything')) return new Set(JOBS);
  return new Set(selections.flatMap((s) => (typeof s === 'string' ? [] : s)));
};
