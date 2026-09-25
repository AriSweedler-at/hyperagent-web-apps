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
a path list. `tools/ci/suites.test.ts` is the accounting: every `*.test.ts` is claimed by exactly
one suite and every `e2e/*.spec.ts` by exactly one, or by the suites of the games a shared spec
drives (the shell specs, below), every glob names a file, every coverage row sits under its own
suite's `coverage.include` (vitest passes an empty row silently), the 28 rows of the former flat
config are present at or above their figures, the scripts spell the same names as the table, and
`ci.yml` carries one gated job per shared entry and the two matrix jobs the game entries expand
into (dry-round-2 I1). A new test file no row claims fails there, which is how a fourth game learns
it must register.

| Suite | vitest `unit` (in `npm test`) | `standalone` (only `test:<suite>`) | Coverage rows | e2e specs |
|---|---|---|---|---|
| `shared` | `web/shared/**/*.test.ts`, `test/parity/{ice,roomCode}.legacy.test.ts` | | `web/shared/{lib,edge,net}/**` | |
| `shared-integration` | (the fake two-seat game, when it lands) | `test/integration/**` (Chromium; `browser: true`) | | |
| `gin` | `web/games/gin-rummy/**/*.test.ts`, `test/parity/gin.*`, `test/fixtures/legacy/gin-wire.test.ts`, `test/card-backs.test.ts` | | the 10 gin rows | `**/gin-*.spec.ts`; `**/shell-*.spec.ts` tagged `@gin-rummy` (`@backgammon` inverted) |
| `fidice` | `web/games/fidice/**/*.test.ts`, `test/parity/fidice.*`, `test/tools/debundle-fidice.test.ts` | | the 7 fidice rows | `**/fidice-*.spec.ts` |
| `backgammon` | `web/games/backgammon/**/*.test.ts` | | the 7 backgammon rows | `**/backgammon-*.spec.ts`; `**/shell-*.spec.ts` tagged `@backgammon` (`@gin-rummy` inverted) |
| `site` | `test/tokens.test.ts`, `test/ratchet.test.ts`, `infra/games-proxy/worker.test.ts` | `test/dist/**` (`needsBuild: true`) | `infra/games-proxy/worker.ts` | `**/smoke.spec.ts`, `**/computed-styles.spec.ts` |
| `harness` | `test/tools/{serve-dist,proxy-dev,computed-styles}.test.ts`, `test/fixtures/legacy/{frozen,manifest}.test.ts`, `tools/**/*.test.ts` | | | |

Counts on this branch: 30 + 1 + 44 + 17 + 21 + 8 + 9 = 130 test files (the harness row holds the
three new `tools/ci` tests, shared the new `dom.fake.test.ts`); 245 Playwright tests in 30 files =
gin 161/22 + fidice 4/2 + backgammon 62/11 + site 18/2, the seven shell files counted in both
game suites (`E2E_SUITE=<suite> playwright test --list` is the source).

The shell specs (`e2e/shell-{home,local,online,relay,resume,handoff,liveness}.spec.ts`,
`docs/design/shared-shell.md` D1) drive both shell games from one file each: a `SHELL_GAMES.forEach`
over `tools/games.ts`, one `test.describe(game, { tag: '@<game>' })` per game. Both game suites
list the files (`e2e.files`) with their own tag (`e2e.tag`) and the other's in `e2e.otherTags`,
which `playwright.config.ts` turns into `grepInvert`, so `e2e-gin` plays gin's describes and
`e2e-backgammon` backgammon's, each once, and a CLI `--grep` (`@online|@relay`, `@gin-rummy`)
composes with it. The accounting allows a spec file several claimants only when every claimant
carries a tag and inverts exactly the others', and pins the seven files and the idiom (the liveness
spec was `site`'s cross-game file until the tags could split it). Why not a
suite of their own: an `e2e-shell` job would need its own coturn (four of the six relay through
it), its own ci.yml entry and script, and would run for a fidice-only change too; under `site` the
relay spec would have to install coturn there. The game jobs already run for a change to their game
or to shared, and a shell describe is that game's flow.

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
| `web/shared/styles/CONTRACT.md` | `site` (class-contract.test.ts checks every row) |
| `legacy/README.md` | `harness`, `site` (frozen.test.ts and dist-parity.test.ts pin it) |
| `docs/**`, `**/*.md`, `.claude/**`, `.githooks/**`, `tools/hooks-verify.sh`, `infra/turn-worker/**` | none (check only) |
| `tools/**`, `e2e/fixtures/**`, `e2e/browser/**`, `legacy/**`, `.github/**`, `package*.json`, `.nvmrc`, `tsconfig*.json`, `eslint.config.js`, `.prettierrc*`, `.prettierignore`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `web/raw-imports.d.ts`, `web/shared/**` | everything |
| `web/games/<g>/**` | `<g>`, `e2e-<g>`, `site`, `e2e-site`, `harness` |
| `test/parity/<g>.*` | `<g>` |
| `e2e/<g>-*.spec.ts` (and `e2e/__screenshots__/**` for gin) | `e2e-<g>` |
| `e2e/shell-*.spec.ts` | `e2e-gin`, `e2e-backgammon` (each plays its game's describes) |
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
changes ──┬── shared ─────────────────────────────┐
(15 s,    ├── shared-integration ─────────────────┤
 diff ->  ├── game [gin | fidice | backgammon] ───┤   matrix over `games`
 jobs +   ├── site (build, dist ↑) ───────────────┼── ci-ok ── deploy (push to main)
 lists)   ├── harness ────────────────────────────┤   always(); needs changes too; green on
          ├── e2e-game [gin | fidice | backgammon]┤   success or skipped, red on failure or cancelled
          └── e2e-site ───────────────────────────┤   matrix over `e2e-games`
check (typecheck, lint, hooks) ───────────────────┘        broker (advisory, outside ci-ok)
```

Each shared, site or harness job is `needs: changes` + `if: needs.changes.outputs.<job> ==
'true'`. The game suites are two matrix jobs (dry-round-2 I1): `game` and `e2e-game` take
`strategy.matrix.suite` from `fromJSON(needs.changes.outputs.games)` / `e2e-games`, the JSON
lists `tools/ci/affected.ts --github` prints beside the booleans (`GAME_SUITES` in job order,
filtered to the selected jobs), with `fail-fast: false` (one game's failure cancels no other) and
`if: ... != '[]'` (GitHub refuses an empty matrix, so an empty list skips the job whole; the checks
read `game (gin)` and `e2e-game (gin)`, with no `name:` override, since a job skipped before its
matrix expands would show the raw expression as its name). A fourth game registers in
`suites.ts` alone. The unit suites run once, instrumented, against their own rows. `site` builds
and uploads `dist/`, which `deploy` downloads. The game e2e matrix installs Chromium and coturn
(every game has a relay spec); `e2e-site` runs with `E2E_TURN=off`. A push to main or a
`workflow_dispatch` selects everything. GitHub skips a job whose `needs` were skipped unless it
says `always()`, so `deploy` needs `ci-ok` alone. `ci-ok` needs `changes` as well: skipped is
green there, so a crash in the selector must show as a failed need, not as a row of skips; a
matrix job reports one aggregate result, so the two stand for six. `nightly.yml` and `stories-baselines.yml` do not use `changes`: the nightly's two 1000-game
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
- `test:dist` and `test:integration` go after one release.
