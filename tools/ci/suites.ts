// The one place a path is assigned to a test suite (docs/design/test-partition.md). Read by
// vitest.config.ts (one project per suite, the coverage block computed from VITEST_SUITE),
// playwright.config.ts (E2E_SUITE -> testMatch), tools/ci/affected.ts (which CI jobs a diff
// selects) and the pre-push hook through tools/ci/run-affected.ts; nothing else spells a path list.
// Seven suites, decided by path alone: `shared` (web/shared unit tests, the two legacy oracles
// that read only shared code and the coin game the replay driver is proved on),
// `shared-integration` (the transport contract in Chromium; the coin game's integration tests
// through the shared shell join it), one per game (its colocated tests, its parity
// oracles, its fixture pins), `site` (guards over the built site or over every page at once) and
// `harness` (the harness testing itself). tools/ci/suites.test.ts is the accounting: every
// *.test.ts is claimed by exactly one suite and every e2e spec by exactly one, or by the suites of
// the games a shared spec drives (the shell specs: one tagged describe per game, each game's job
// playing its own), every threshold row sits under a coverage.include glob of its own suite (vitest
// passes an empty glob's row silently: an empty coverage map summarises to 100%), and the
// change -> jobs table below holds. Node builtins only, so `node --experimental-strip-types
// tools/ci/affected.ts` runs before `npm ci` in CI.
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

/**
 * A suite's Playwright half: its spec files and, for a spec file two suites share (the shell specs,
 * e2e/shell-*.spec.ts: one describe per shell game tagged `@<game>`, docs/design/shared-shell.md
 * §6.3), the suite's own tag and the other suites' tags, which playwright.config.ts puts in
 * `grepInvert` so each job plays its game's describes alone; a CLI --grep composes with that.
 */
export type E2eSpec = Readonly<{
  files: ReadonlyArray<string>;
  /** The tag this suite's describes carry inside a shared spec file; absent when it shares none. */
  tag?: string;
  /** The tags of the other suites sharing a spec file with this one: left out of this suite's run. */
  otherTags: ReadonlyArray<string>;
}>;

/**
 * The shared shell specs (docs/design/shared-shell.md D1): the home screen, the pass-and-play start,
 * the room, the relay-forced game, resume, the handoff and the sessions' liveness, written once
 * over tools/games.ts SHELL_GAMES. Both shell games' suites claim them; the tags decide which
 * describes each job plays.
 */
const SHELL_SPECS: ReadonlyArray<string> = ['**/shell-*.spec.ts'];

/**
 * The two of them written over every game (dry-round-2.md H1): the room and the relay-forced game
 * loop over tools/games.ts GAMES, fidice's row in e2e/fixtures/online-games.ts driving its legacy
 * lobby, so fidice's suite claims these two alone and each game suite inverts the other two tags.
 */
const ONLINE_SPEC_NAMES: ReadonlyArray<string> = ['shell-online.spec.ts', 'shell-relay.spec.ts'];
const ONLINE_SPECS: ReadonlyArray<string> = ONLINE_SPEC_NAMES.map((name) => `**/${name}`);

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
      include: [
        'web/shared/lib/**/*.ts',
        'web/shared/edge/**/*.ts',
        'web/shared/net/**/*.ts',
        'web/shared/ui/**/*.ts',
        'web/shared/example/**/*.ts',
      ],
      // The shared pure library stays at 100% lines, functions and statements
      // (docs/ARCHITECTURE.md "*.algorithms.ts"). Measured at the ratchet
      // (lines/functions/statements/branches): shared/lib 100/100/100/100, shared/edge
      // 99.4/98.8/98.9/94.4 (re-measured with prefs.ts (A3), cuePlayer.ts and netDeps.ts (A4), the
      // three at 100/100/100/100; again with boot.ts (shared-shell.md §5 B3: the invite link, the
      // share chain and the session adapters out of both main.ts, 100/100/100/100 over boot.test.ts),
      // the folder at 99.72/99.36/99.75/96.6). Re-measured when DRY round 2's D5 added lib/game.ts
      // (the two-seat primitives and the TwoSeatEngine contract) and json.ts's pair and taggedUnion,
      // and prefs.ts's decodeSave became a taggedUnion table: shared/lib still 100/100/100/100
      // (game.ts, json.ts and protocol.ts each 100 on every metric), the edge folder
      // 99.72/99.35/99.75/96.59 before, 99.72/99.35/99.75/96.56 after (prefs.ts still 100 on every
      // metric; the same lines uncovered elsewhere, fewer branches in the folder). Again when D3
      // (dry-round-2 E7) moved the two games' page-fake assembly into page.fake.ts `shellPage`, every
      // new branch under page.fake.test.ts: the folder 99.72/99.36/99.75/96.57 before,
      // 99.72/99.37/99.76/96.62 after (measured on main at 0b1bec3 and this branch rebased onto it).
      thresholds: {
        'web/shared/lib/**': { lines: 100, functions: 100, branches: 100, statements: 100 },
        // The shared shell's helpers and painters (docs/design/glossary-links.md §3;
        // docs/design/shared-shell.md §4.4): held at 100 like shared/lib, every module with its
        // test beside it. Re-measured when B1 moved the shell painters, the curtain, the toaster
        // and the timers here out of both games: glossary, shellPaint, curtain, toast and ids each
        // 100/100/100/100 over the fake page.
        // home.ts, the home shell both games' ui/home.ts compose (shared-shell.md §5 B2), measures
        // 100/100/100/100 through home.test.ts over the same fake page.
        // keyed.ts, the keyed slot out of shellPaint.ts (docs/design/dry-round-2.md D1), measures
        // 100/100/100/100 through keyed.test.ts over a fake element; the folder stays at 100.
        'web/shared/ui/**': { lines: 100, functions: 100, branches: 100, statements: 100 },
        // The coin game (dry-round-2.md F3): the two-seat engine the replay driver under test/shared
        // is proved on, and the shared shell's fake game to come. It exists to be exercised, so
        // every branch has a row in coin.test.ts. Measured at the move: 100/100/100/100.
        'web/shared/example/**': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'web/shared/edge/**': { lines: 94, functions: 94, statements: 93, branches: 90 },
        // The sessions gin's net/ became (docs/design/shared-shell.md A1): the 21 scenarios once
        // over a fake codec (sessions.test.ts beside them, with sessions.harness.ts), the two
        // games' byte-pinning suites through their wrappers and the gin wire-corpus replay. Measured
        // at the move (lines/functions/statements/branches): 100/100/100/97.8. Re-measured when the
        // host grew to N seats (docs/design/n-seat-sessions.md; sessions.seats.test.ts covers the
        // seat paths, three scenarios over a scripted transport for what the fake broker's FIFO
        // cannot stage, n-seat-sessions.md §6.3): 100/100/100/100, every file in the folder.
        'web/shared/net/**': { lines: 95, functions: 95, statements: 95, branches: 94 },
      },
    },
  },
  'shared-integration': {
    // The coin game's integration tests through the shared shell (docs/design/test-partition.md
    // "Not yet") land here (node, milliseconds); until then the suite is the transport contract
    // alone. The coin game itself and its unit tests are `shared`'s (web/shared/example/coin).
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
      // Re-measured when B1 moved the shell painters, the curtain's DOM half and the page-fake
      // builder into web/shared (folder totals summed over the files): ui 98.2/97.1/97.2/93.8
      // before, 98.2/96.9/97.1/93.9 after; the row stands.
      // Re-measured again when B2 moved the home shell out of ui/home.ts into web/shared/ui/home.ts:
      // ui 98.2/96.9/97.1/93.9 before, 98.1/96.8/97.0/94.0 after (the same lines uncovered, a smaller
      // folder; the wrapper itself measures 100 on every metric).
      // Re-measured when B3 moved roomCodeMsg, INVITE_COPIED_MSG and SHARE_FALLBACK_MS out of
      // ui/state.ts into web/shared/edge/boot.ts: ui 98.1/97.1/97.0/94.0 (roomCodeMsg was the one
      // function this suite never called, so functions rose; nothing went down and the row stands).
      // Re-measured when D1 (docs/design/dry-round-2.md) keyed the piles, the table melds and the
      // result body through web/shared/ui/keyed.ts: ui 98.09/97.09/97.06/94.03 before,
      // 98.08/97.13/97.05/94.16 after (the same 24 lines uncovered in a smaller folder; the row stands).
      // Re-measured when DRY round 2's D5 moved SEATS/otherPlayer/setAt, the seat/count/timestamp
      // decoders and `pair` out of the engine into web/shared/lib, made decodeAction a taggedUnion
      // table and added ENGINE (index.ts) and actorOf: engine 99.80/99.45/98.30/94.98 before,
      // 99.79/99.44/98.25/94.72 after (the same lines uncovered, a smaller folder; decode.ts and
      // index.ts measure 100 on every metric); the row stands.
      // Re-measured when D3 (dry-round-2 E7) moved the page-fake assembly out of ui/page.fake.ts into
      // web/shared/edge/page.fake.ts `shellPage`, on top of D1: ui 98.08/97.13/97.05/94.16 before,
      // 98.07/97.10/97.04/94.14 after (the same 24 lines uncovered, 1252 → 1246 lines; the wrapper
      // measures 100 on every metric).
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
    // Gin's own specs and its describes of the shell specs (`@gin-rummy`; backgammon's left out).
    e2e: {
      files: ['**/gin-*.spec.ts', ...SHELL_SPECS],
      tag: '@gin-rummy',
      otherTags: ['@backgammon', '@fidice'],
    },
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
    // Fidice's own online and relay specs folded into the two online shell specs (H1): its e2e job
    // plays their fidice describes and nothing else, until the restyle brings it the shell (§4.6).
    e2e: { files: [...ONLINE_SPECS], tag: '@fidice', otherTags: ['@gin-rummy', '@backgammon'] },
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
      // web/shared/net (100 on every metric): the row is a small file's, like protocol's. Re-measured
      // when B1 moved the shell painters, the curtain's DOM half, `ensureKeyed` and the page-fake
      // builder into web/shared (folder totals summed over the files): ui 99.6/100/98.7/91.8
      // before, 99.6/100/98.7/91.9 after; the row stands.
      // Re-measured again when B2 moved the home shell out of ui/home.ts into web/shared/ui/home.ts:
      // ui 99.6/100/98.7/91.9 before, 99.6/100/98.6/92.0 after (the same lines uncovered, a smaller
      // folder; the wrapper itself measures 100 on every metric).
      // Re-measured when B3 moved INVITE_COPIED_MSG and SHARE_FALLBACK_MS (two constants, no
      // function) out of ui/state.ts into web/shared/edge/boot.ts: still ui 99.6/100/98.6/92.0.
      // Re-measured when DRY round 2's D5 moved otherSeat/setAt/SEATS, the seat/count/timestamp
      // decoders and `pair` out of the engine into web/shared/lib, made decodeAction a taggedUnion
      // table and added ENGINE (index.ts): engine 99.17/99.46/98.94/97.14 before,
      // 99.14/99.45/98.90/97.00 after (the same lines uncovered, a smaller folder; decode.ts and
      // index.ts measure 100 on every metric); the row stands.
      // Re-measured when D3 (dry-round-2 E7) moved the page-fake assembly out of ui/page.fake.ts into
      // web/shared/edge/page.fake.ts `shellPage`: ui 99.59/100/98.68/92.53 before, 99.59/100/98.68/92.52
      // after (the same 6 lines uncovered, 1471 → 1467 lines; the wrapper measures 100 on every metric).
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
    // Backgammon's own specs and its describes of the shell specs (`@backgammon`; gin's left out).
    e2e: {
      files: ['**/backgammon-*.spec.ts', ...SHELL_SPECS],
      tag: '@backgammon',
      otherTags: ['@gin-rummy', '@fidice'],
    },
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

/**
 * A game suite: the suites whose CI jobs share one shape, so ci.yml runs them as two matrix jobs
 * (`game`: `npm run test:<suite> -- --coverage`; `e2e-game`: `npm run test:e2e:<suite>` under
 * Chromium and coturn) over the lists the `changes` job emits (dry-round-2.md I1). A fourth game
 * joins GAME_FOLDERS and its SUITES row; ci.yml is not edited.
 */
export type GameSuite = 'gin' | 'fidice' | 'backgammon';

const GAME_FOLDERS: Readonly<Record<GameSuite, string>> = {
  gin: 'gin-rummy',
  fidice: 'fidice',
  backgammon: 'backgammon',
};

export const isGameSuite = (suite: Suite): suite is GameSuite =>
  (Object.keys(GAME_FOLDERS) as ReadonlyArray<string>).includes(suite);

/** The game suites in job order: the values of the two matrix jobs' `strategy.matrix.suite`. */
export const GAME_SUITES: ReadonlyArray<GameSuite> = SUITE_NAMES.filter(isGameSuite);

/** The rows every game gets: its folder, its parity oracles, its specs and its style goldens. */
const gameRules = (game: GameSuite): ReadonlyArray<Rule> => {
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
  // Two .md files a test reads, above the prose row that would otherwise claim them for `check`.
  {
    globs: ['web/shared/styles/CONTRACT.md'],
    runs: ['site'],
    why: 'class-contract.test.ts checks every row of it against dist',
  },
  {
    globs: ['legacy/README.md'],
    runs: ['harness', 'site'],
    why: 'frozen.test.ts lists it beside the frozen pages and dist-parity.test.ts asserts it exists',
  },
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
    // The coin game (dry-round-2.md F3): imported by its own test and, later, the shared shell's
    // integration tests; no game reaches it, so it runs shared alone, not everything.
    globs: ['web/shared/example/**'],
    runs: ['shared'],
    why: 'the coin game: the replay driver self-test in shared; no game imports it',
  },
  {
    // The replay driver and the engine-test scaffolding (dry-round-2.md F3, F4): imported by the
    // coin self-test (shared) and by the two engines' replays and codec tests.
    globs: ['test/shared/**'],
    runs: ['shared', 'gin', 'backgammon'],
    why: 'the shared replay driver and test scaffolding: the coin self-test and both engines drive games through them',
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
      // Every game imports shared, the site smokes every game and a token moves every golden
      // (web/shared/example, which no game imports, has its own row above).
      'web/shared/**',
    ],
    runs: 'everything',
    why: 'the harness, the build and lint configuration, the frozen oracles and the shared code every game imports',
  },
  {
    // The two online specs loop over every game (H1): a spec change runs fidice's e2e job too, each
    // job playing its own game's describes through its tag. Above the shell rule, which would claim
    // them for the two shell games alone.
    globs: ONLINE_SPEC_NAMES.map((name) => `e2e/${name}`),
    runs: [e2eJob('gin'), e2eJob('fidice'), e2eJob('backgammon')],
    why: "the online specs: a describe per game, fidice included, each run by that game's e2e job through its tag",
  },
  {
    // One describe per shell game, each played by that game's e2e job through its tag (the gin and
    // backgammon rows claim the files, each inverting the other's tag): a spec change runs both
    // jobs, a change under web/games/<g>/** runs e2e-<g> with its describes (gameRules), and
    // web/shared/** runs everything (above). Neither game-e2e job runs the other game's describes.
    globs: ['e2e/shell-*.spec.ts'],
    runs: [e2eJob('gin'), e2eJob('backgammon')],
    why: "the shared shell specs: a describe per shell game, each run by that game's e2e job through its tag",
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
