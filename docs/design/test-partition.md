# Test-suite partition and CI layout

The owner's rule: "when developing on one game only, JUST the game-specific code should be
testable; all shared module code should be thoroughly unit tested and integration tested with
minimal examples; these run in separate suites that can be invoked separately; CI parallelizes
them and, if possible, updates only to games or only to shared libraries do not run the tests
that have stuff unaffected." This is the distilled record of how the repo does that; the full
design with its measurements is the session document it came from (2026-09-24).

## One table

`tools/ci/suites.ts` is the one place a path is assigned to a suite. `vitest.config.ts`,
`playwright.config.ts`, `tools/ci/affected.ts` and the pre-push hook read it; nothing else spells
a path list. `tools/ci/suites.test.ts` is the accounting: every `*.test.ts` and every `e2e/*.spec.ts`
is claimed by exactly one suite, every glob names a file, every coverage row sits under its own
suite's `coverage.include` (vitest passes an empty row silently), the 28 rows of the former flat
config are present at or above their figures, the scripts spell the same names as the table, and
`ci.yml` carries one gated job per entry. A new test file no row claims fails there, which is how
a fourth game learns it must register.

| Suite | vitest `unit` (in `npm test`) | `standalone` (only `test:<suite>`) | Coverage rows | e2e specs |
|---|---|---|---|---|
| `shared` | `web/shared/**/*.test.ts`, `test/parity/{ice,roomCode}.legacy.test.ts` | | `web/shared/{lib,edge,net}/**` | |
| `shared-integration` | (the fake two-seat game, when it lands) | `test/integration/**` (Chromium; `browser: true`) | | |
| `gin` | `web/games/gin-rummy/**/*.test.ts`, `test/parity/gin.*`, `test/fixtures/legacy/gin-wire.test.ts`, `test/card-backs.test.ts` | | the 10 gin rows | `**/gin-*.spec.ts` |
| `fidice` | `web/games/fidice/**/*.test.ts`, `test/parity/fidice.*`, `test/tools/debundle-fidice.test.ts` | | the 7 fidice rows | `**/fidice-*.spec.ts` |
| `backgammon` | `web/games/backgammon/**/*.test.ts` | | the 7 backgammon rows | `**/backgammon-*.spec.ts` |
| `site` | `test/tokens.test.ts`, `test/ratchet.test.ts`, `infra/games-proxy/worker.test.ts` | `test/dist/**` (`needsBuild: true`) | `infra/games-proxy/worker.ts` | `**/smoke.spec.ts`, `**/computed-styles.spec.ts` |
| `harness` | `test/tools/{serve-dist,proxy-dev,computed-styles}.test.ts`, `test/fixtures/legacy/{frozen,manifest}.test.ts`, `tools/**/*.test.ts` | | | |

Counts at the cut (main 21b085e): 29 + 1 + 44 + 17 + 21 + 8 + 9 = 129 test files (the harness
row holds the four new `tools/ci` tests); 210 Playwright tests in 28 files = gin 142/18 + fidice
4/2 + backgammon 46/6 + site 18/2.

## Running one suite

```
npm test                              every project (the same files as the flat config, prefixed by suite)
npm test -- --coverage                every project against the union of the rows (the former block, byte for byte)
npm run test:<suite>                  VITEST_SUITE=<suite> vitest run --project <suite>; -- --coverage scopes the rows
npm run test:site                     build, then the dist guards, tokens, ratchet, the Worker
npm run test:shared-integration       the transport contract in Chromium (never part of npm test)
npm run test:e2e                      build, then every spec (E2E_SUITE unset)
npm run test:e2e:<gin|fidice|backgammon|site>   E2E_SUITE=<suite>: that suite's specs, both origins
npm run check                         typecheck, lint, test, test:site: the full gate
npm run check:affected                typecheck, lint, then only the suites the diff against origin/main selects (pre-push)
npm run affected [-- --github|--json|--all|--base <ref>]   the selection, and why, per path
```

vitest 5 keeps `coverage` a root-only option, so `vitest.config.ts` computes the coverage block
from `VITEST_SUITE`: the named suite's include and rows, or the union when unset. The scripts set
the variable and `--project` alike; a misspelt name is an error and a `--project` that disagrees
matches no project. `standalone` globs (the dist guards, the transport contract) join a project
only when their suite is named, so `npm test` never reads `dist/` and never starts Chromium.
`test:dist` and `test:integration` are aliases of `test:site` and `test:shared-integration` for one
release.

## Which change runs what

The rows of `RULES` in `tools/ci/suites.ts`, first match wins; a diff selects the union over its
paths and `everything` anywhere selects every job. `check` (typecheck, lint, hooks) always runs.

| Changed path | Jobs |
|---|---|
| `docs/**`, `**/*.md`, `.claude/**`, `.githooks/**`, `tools/hooks-verify.sh`, `infra/turn-worker/**` | none (check only) |
| `tools/**`, `e2e/fixtures/**`, `e2e/browser/**`, `legacy/**`, `.github/**`, `package*.json`, `.nvmrc`, `tsconfig*.json`, `eslint.config.js`, `.prettierrc*`, `.prettierignore`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `web/raw-imports.d.ts`, `web/shared/**` | everything |
| `web/games/<g>/**` | `<g>`, `e2e-<g>`, `site`, `e2e-site`, `harness` |
| `test/parity/<g>.*` | `<g>` |
| `e2e/<g>-*.spec.ts` (and `e2e/__screenshots__/**` for gin) | `e2e-<g>` |
| `test/fixtures/styles/<g>.*` | `e2e-site` |
| `test/fixtures/legacy/gin-*`, `test/fixtures/legacy/fidice-*` | `<g>`, `harness` |
| `test/card-backs.test.ts` | `gin` |
| `test/fixtures/backgammon-wire/**` | `backgammon` |
| `test/parity/{ice,roomCode}.legacy.test.ts` | `shared` |
| `test/integration/**` | `shared-integration` |
| `web/index.html`, `web/games/sheshbesh/**` | `site`, `e2e-site` |
| `test/dist/**`, `test/tokens.test.ts`, `test/ratchet.test.ts` | `site` |
| `e2e/smoke.spec.ts`, `e2e/computed-styles.spec.ts` | `e2e-site` |
| `infra/games-proxy/**` | `site`, `e2e-site`, `harness` |
| `test/tools/**`, `test/fixtures/legacy/**` | `harness` |
| anything else | everything (a new folder earns its row) |

`web/shared/**` runs everything on purpose: every game imports shared, the site smokes every game,
a token moves every golden, and `tools/games.test.ts` (harness) reads the games' storage keys. A
game's folder runs the harness for that last reason too. `harness` and `site` are the cheap jobs;
the win is in what a game-only or docs-only change leaves out.

## The CI graph

```
changes ──┬── shared ────────────────┐
(15 s,    ├── shared-integration ────┤
 diff ->  ├── gin ───────────────────┤
 jobs)    ├── fidice ────────────────┤
          ├── backgammon ────────────┤
          ├── site (build, dist ↑) ──┼── ci-ok ── deploy (push to main)
          ├── harness ───────────────┤   always(); green on success or skipped,
          ├── e2e-gin ───────────────┤   red on failure or cancelled
          ├── e2e-fidice ────────────┤
          ├── e2e-backgammon ────────┤
          └── e2e-site ──────────────┤
check (typecheck, lint, hooks) ──────┘        broker (advisory, outside ci-ok)
```

Each suite job is `needs: changes` + `if: needs.changes.outputs.<job> == 'true'`. The unit suites
run once, instrumented, against their own rows. `site` builds and uploads `dist/`, which `deploy`
downloads. The three game e2e jobs install Chromium and coturn (every game has a relay spec);
`e2e-site` runs with `E2E_TURN=off`. A push to main or a `workflow_dispatch` selects everything.
GitHub skips a job whose `needs` were skipped unless it says `always()`, so `deploy` needs `ci-ok`
alone. `nightly.yml` and `stories-baselines.yml` do not use `changes`: the nightly's two 1000-game
replays go through `npm run test:gin -- test/parity/gin.replay` and `npm run test:backgammon --
web/games/backgammon/src/engine/replay` (the file filter applies inside a project); the baselines
job keeps `npm run test:e2e -- e2e/gin-stories.spec.ts --project pages --update-snapshots=all`.

Critical paths: docs-only ~ `check`; a backgammon- or fidice-only PR ~ `changes` -> `e2e-<g>`;
a gin or shared PR ~ `changes` -> `e2e-gin` (the stories spec at three viewports is the long
pole; `--shard` on `e2e-gin` is the lever if it ever needs one); main runs everything, then
`ci-ok`, then `deploy`.

## Coverage, measured per suite

Every row is measured by its own suite alone (`npm run test:<suite> -- --coverage`). At the cut:
gin, fidice, backgammon and site reproduced their rows exactly (their tests were never shared with
another game). `shared` did not: `web/shared/edge/**` read 85.6/84.0/85.2/83.1
(lines/functions/statements/branches) against 94/94/93/90, because `dom.fake.ts` had no test of its
own (unlike the other fakes) and the drag/FLIP helpers of `dom.ts` were exercised only by the
games' painter tests. The row was not lowered: the shared suite gained `dom.fake.test.ts`, the
geometry/frames/pointers block of `dom.test.ts`, the page fake's remaining members and two `ice.ts`
branches, and reads 99.6/97.0/99.3/99.7 there now. The one forward row is backgammon's
`engine/*.algorithms.ts` (no such file yet; it binds the first one to 100% and vitest passes it
vacuously until then; `suites.test.ts` lists it as such).

## Local loop

`.githooks/pre-push` runs `npm run check:affected`: typecheck, lint, then
`tools/ci/run-affected.ts` runs the selected non-browser suites one after another through their own
scripts, stopping at the first failure and listing what CI adds (the browser suite, the e2e jobs).
`PRE_PUSH=full`, or a checkout with no `origin/main`, runs the whole `npm run check`.

## Not yet

- The fake two-seat game (`web/shared/example/coin`) and its integration tests join
  `shared-integration.unit` with the shared shell (the design's §4 and P3); `test:shared` then runs
  both projects so shared's rows see a real consumer.
- A spec file shared by two games (the shell specs of Wave D) carries a Playwright tag per game's
  describe; its suite lists the file and the other games' tags go into `grepInvert` (`e2e.otherTags`,
  wired, empty today).
- `test:dist` and `test:integration` go after one release.
