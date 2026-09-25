# hyperagent-web-apps

Three browser games, Gin Rummy, Fidice (one-cup liar's dice) and Sheshbesh (backgammon: portes
or Western rules), written in strict functional
TypeScript, built by Vite into static pages and served from two origins: GitHub Pages and a
Cloudflare Worker in front of it. Online play is peer-to-peer over WebRTC (PeerJS brokers the
handshake; a Cloudflare TURN relay carries the game when NAT blocks a direct path). Every push to
`main` and every PR is gated by typecheck, lint, unit and parity tests, dist guards and a two-peer
Playwright game on both emulated origins; a nightly plays the deployed pages for real.
`docs/ARCHITECTURE.md` is the layout and its rules; `docs/MIGRATION.md` records how two single-file
pages got here.

## Play

| Game                         | GitHub Pages                                                           | games.sweedler.com                                                               | Source                  |
| ---------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------- |
| Gin Rummy                    | https://arisweedler-at.github.io/hyperagent-web-apps/games/gin-rummy/  | https://games.sweedler.com/gin-rummy/                                            | `web/games/gin-rummy/`  |
| Fidice (one-cup liar's dice) | https://arisweedler-at.github.io/hyperagent-web-apps/games/fidice/     | https://games.sweedler.com/fidice/                                               | `web/games/fidice/`     |
| Sheshbesh (backgammon)       | https://arisweedler-at.github.io/hyperagent-web-apps/games/backgammon/ | https://games.sweedler.com/backgammon/ and https://games.sweedler.com/sheshbesh/ | `web/games/backgammon/` |

Both origins serve the same `dist/`. `games.sweedler.com` is the Cloudflare Worker in
`infra/games-proxy/`: `/gin-rummy/`, `/fidice/` and `/backgammon/` are the short URLs, `/games/<name>/`
redirects to them and `/shared/...` maps to the site's `shared/` directory. Sheshbesh answers to two
names: `/sheshbesh/` is the backgammon page served in place by the Worker, and on GitHub Pages
`games/sheshbesh/` forwards to `games/backgammon/`; only `/backgammon/` is linked from the landing
page. A host on one origin and a guest on the other still meet: peer ids carry no origin.

Sheshbesh plays portes (the Greek set's first game: no doubling cube, a gammon doubles) or Western
backgammon (the cube, the triple game, the Crawford rule) as a match to 1, 3, 5 or 7 points, on one
phone passed between two players or online, host-authoritative over the same peer sessions as gin
(`docs/design/backgammon-rules.md`, `docs/design/backgammon-board.md`).

Online play works on one network, or behind friendly NATs, with STUN alone. Two devices both behind
NAT (a phone on cellular and a laptop on office Wi-Fi) need the TURN relay: the pages fetch
short-lived credentials from `https://turn.sweedler.com` (see "Online play"). Without them the
host's wait screen warns that no relay is configured and a cross-network join can fail. Once
connected, a toast says "Connected directly" or "Connected via relay".

## Develop

Node 22 (`.nvmrc`). TypeScript, ESLint (typescript-eslint strict, eslint-plugin-functional, import-x
boundaries), Prettier, vitest and Playwright, all pinned exactly in `package.json`.

```
npm ci                  # install; the `prepare` script also installs the git hooks
npm run check           # typecheck + lint + every unit suite + build + the site guards: the full gate
npm run check:affected  # typecheck + lint + only the suites your commits touch: what pre-push runs
npm run test:gin        # one suite (shared, shared-integration, gin, fidice, backgammon, briscola, site, harness)
```

| Script                                               | What it does                                                                                                                                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                      | `typecheck`, `lint`, `test`, `test:site`, in that order: the full gate (what main proves)                                                                                                               |
| `npm run check:affected`                             | `typecheck`, `lint`, then only the suites `tools/ci/affected.ts` selects from the diff against `origin/main`; the pre-push hook (`PRE_PUSH=full` for the whole gate)                                    |
| `npm run affected`                                   | print that selection, per path and why; `-- --github`, `-- --json`, `-- --all`, `-- --base <ref>`                                                                                                       |
| `npm run typecheck`                                  | `tsc -b` over the web, pure and node projects                                                                                                                                                           |
| `npm run lint`                                       | `eslint . --max-warnings 0`, then `prettier --check .`                                                                                                                                                  |
| `npm run lint:fix` / `npm run format`                | `eslint --fix` / `prettier --write` on everything they check                                                                                                                                            |
| `npm test`                                           | vitest, every suite as one run (the `*.test.ts` under `web/`, `test/`, `infra/`, `tools/` bar the dist guards and the browser contract); `-- --coverage` gates the union of the rows                    |
| `npm run test:<suite>`                               | one suite: `shared`, `shared-integration` (Chromium), `gin`, `fidice`, `backgammon`, `briscola`, `site` (builds first), `harness`; `-- --coverage` gates that suite's rows alone (`tools/ci/suites.ts`) |
| `npm run test:watch`                                 | vitest, watching                                                                                                                                                                                        |
| `npm run build`                                      | `vite build` -> `dist/` (`web/` is the root; every `web/**/index.html` is an entry)                                                                                                                     |
| `npm run test:site`                                  | build, then the guards on `dist/` (see "Tests"), the token and ratchet pins and the Worker's tests; `test:dist` is its alias for one release                                                            |
| `npm run test:shared-integration`                    | the real PeerJS transport through a local PeerServer in Chromium; skips where loopback WebRTC is blocked; `test:integration` is its alias for one release                                               |
| `npm run test:e2e`                                   | build, then Playwright: every spec in `e2e/` on both emulated origins                                                                                                                                   |
| `npm run test:e2e:<suite>`                           | one suite's specs (`gin`, `fidice`, `backgammon`, `site`), both origins; extra arguments pass through                                                                                                   |
| `npm run test:deployed`                              | the `@online` and `@relay` specs with the deployed Pages page as the subject, every server local; nightly                                                                                               |
| `npm run serve`                                      | GitHub Pages emulation: `dist/` at http://127.0.0.1:4173/hyperagent-web-apps/                                                                                                                           |
| `npm run preview`                                    | build, then serve                                                                                                                                                                                       |
| `npm run proxy:dev`                                  | games.sweedler.com emulation: the real Worker at http://127.0.0.1:8787/ over :4173                                                                                                                      |
| `npm run fixtures:legacy`                            | re-cut `test/fixtures/legacy/*.cjs` from the frozen pages and re-pin `MANIFEST.json`                                                                                                                    |
| `npm run fixtures:gin-wire` / `fixtures:gin-storage` | re-record the gin wire frames / localStorage captures from the legacy page                                                                                                                              |
| `npm run debundle:fidice`                            | re-split the legacy fidice bundle into `web/games/fidice/src/**` and re-pin its `MANIFEST.json`                                                                                                         |
| `npm run hooks` / `npm run hooks:verify`             | `git config core.hooksPath .githooks` / confirm the wiring                                                                                                                                              |

Git hooks are plain files in `.githooks/`: `pre-commit` chains to the owner's template hook in
`.git/hooks/pre-commit` (big-file and trailing-whitespace prompts; it resolves the hook through
`--git-common-dir`, so linked worktrees reach it too) and `pre-push` runs `npm run check:affected`
(typecheck, lint, then the suites the pushed commits touch; `PRE_PUSH=full git push` runs the whole
`npm run check`, as does a checkout with no `origin/main`). `npm ci` installs them through
`prepare`; run `npm run hooks` again if `core.hooksPath` was changed.

`package-lock.json` is written behind Airtable's Socket Firewall registry and is committed exactly
as npm produces it; never rewrite it. CI installs through `.github/actions/npm-ci`, which points the
runner's copy of the lockfile at the public registry, installs through Socket Firewall Free (`sfw
npm ci`) so CI installs are scanned, and restores the file; the integrity hashes are verified either
way.

Prettier leaves alone what must keep its bytes (`.prettierignore`): `legacy/**`, `web/index.html`
(dist parity compares against it verbatim), the gin and fidice `index.html` and `theme.css` (the
legacy layout, so a diff against `legacy/` reads as the hoist alone; backgammon's, with no legacy
twin, are formatted), the generated fixtures, `docs/` and `infra/turn-worker/`.

## Tests

The pyramid, bottom up (`docs/ARCHITECTURE.md` "Testing pyramid" has the full lists):

1. **Unit** (`npm test`): vitest on the colocated `*.test.ts`: engine and domain table tests,
   property tests through `legalActions`, protocol decoders against malformed and hostile frames,
   the pure UI and scorer helpers, the shared edges with fakes. Everything is seeded
   (`web/shared/lib/rng.ts`, mulberry32), so the coverage figures are deterministic and
   `vitest.config.ts` pins a threshold per folder.
2. **Parity oracles** (in `npm test`): `test/parity/*.legacy.test.ts` run each assertion with
   `describe.each` on the frozen legacy code and on the port. The legacy side is cut verbatim out of
   the never-edited pages under `legacy/` into `test/fixtures/legacy/*.cjs` by
   `tools/legacy/extract-*.ts` and pinned by sha256 in `MANIFEST.json`; `manifest.test.ts` re-runs
   the extractors on every run and `frozen.test.ts` pins the whole files. 400 seeded gin games (1000 nightly) and
   12 seeded fidice bot games (`SEEDS` in `test/parity/fidice.legacy.test.ts`) replay through both
   legs with states deep-equal; recorded wire frames and localStorage captures decode and re-encode
   byte for byte. Known legacy defects the port fixes are named and pinned on the legacy leg only.
   Test hooks on the pages: `window.__gin`, `window.__fidice`, `window.__backgammon`, and
   `window.__rng` as the rng when installed before boot. The backgammon engine has no legacy twin:
   its oracle is the seeded replay beside it (`web/games/backgammon/src/engine/replay.test.ts`, 91
   matches per push and `BG_REPLAY_GAMES=1000` nightly) asserting every invariant on every step,
   with the enumeration of maximal plays as the oracle of the legal-move list.
3. **Dist guards** (`npm run test:site`, which builds first; `test/dist/`, the `site` suite): every URL in dist HTML and
   CSS is relative and resolves on both origins through the Worker's real `mapPath()`; every game
   page is a Vite module page that preloads the shared chunks (one common to all; the DOM edge is
   a second one gin and backgammon share) and links the one shared stylesheet;
   `dist/index.html` is byte-identical to `web/index.html`; the backgammon board's two
   `grid-template-areas` strings agree with their pure twin (`backgammon-grid.test.ts`). The **class contract**
   (`class-contract.test.ts`): every class the game's TypeScript names has a rule in a stylesheet
   the page links and vice versa, with what the extraction cannot see tabled in
   `web/shared/styles/CONTRACT.md` (each row is checked against the tree, so it cannot go stale).
4. **Computed-style goldens** (`e2e/computed-styles.spec.ts`, `pages` project):
   `tools/parity/computed-styles.ts` drives each page through its screens at 390x844 and 1280x800
   and reads `getComputedStyle` for 60-110 selectors; `test/fixtures/styles/<game>.<viewport>.json`
   are the goldens. A CSS move that changes a computed value fails with one line per
   screen/selector/property.
5. **Transport integration** (`npm run test:shared-integration`, the `shared-integration` suite; never part of `npm test`): the real PeerJS adapter through a local
   PeerServer in Chromium runs the same contract scenario as `transport.fake.ts` and must produce
   the same log.
6. **Hermetic two-peer e2e** (`npm run test:e2e`; first time `npx playwright install chromium`):
   builds `dist/`, starts `tools/serve-dist.ts` (:4173), `tools/proxy-dev.ts` (:8787, the real
   Worker over :4173), a PeerServer (:9000) and, when `turnserver` is on PATH, a coturn TURN relay
   (:3478, static credentials, loopback only), then runs every spec in `e2e/` on projects `pages`
   and `proxy`: smoke on every page (zero uncaught exceptions, zero failed requests outside an
   allowlist), gin local and scorer, backgammon pass-and-play and its board geometry, the shared
   shell once for both (`e2e/shell-*.spec.ts`: the home screen, the pass-and-play start, the room,
   host reload and guest rejoin, the handoff; `docs/design/shared-shell.md` D1), and the `@online`
   specs (gin's deal and turns, fidice lobby/start, backgammon roll/move) in a host and a guest context that meet through `?peer=` and
   take a STUN-only ICE list through `?ice=`; fonts and CDNs are answered from local copies and
   `Math.random` is seeded. The `@relay` spec (`e2e/shell-relay.spec.ts`, one describe per game,
   fidice included)
   opens both pages with `?ice-policy=relay` and an ICE list naming that relay (written per run under
   `e2e/fixtures/.generated/`, since its port follows the offset), so every candidate must cross it:
   every game still joins and plays, "Connected via relay" shows, and the selected candidate pair read
   off each `RTCPeerConnection` is a relay one. Without coturn they skip with the install line
   (`brew install coturn` / `apt-get install coturn`); `E2E_TURN=off` leaves the relay out on
   purpose. `e2e/gin-dom-parity.spec.ts` plays the same game on the served gin page
   and on the frozen legacy page (aliased in by the harness) and compares 84 checkpoints. The report
   lands in `playwright-report/` (`npx playwright show-report`). The two contexts connect over the
   machine's own addresses: a Cloudflare WARP-style tunnel that drops loopback UDP times them out.
   Every harness port is a base plus `E2E_PORT_OFFSET` (default 0; `e2e/fixtures/site.ts` `PORTS`):
   pages 4173+o, proxy 8787+o, PeerServer 9000+o, TURN 3478+o. To run a second e2e beside one
   that holds the defaults (another worktree, a lingering `npm run serve`), set the offset once and
   the servers, readiness URLs and `?peer=`/`?ice=` hooks all follow:
   `E2E_PORT_OFFSET=1000 npm run test:e2e -- e2e/smoke.spec.ts` binds 5173/9787/10000.
7. **Stories** (`e2e/gin-stories.spec.ts`, `pages` project; `docs/design/gin-draw-ghost-slot.md`
   §7-§8): sixteen catalogued table states of the gin page
   (`web/games/gin-rummy/src/stories/catalogue.ts`, one seeded deal played through the engine),
   each opened through the page's `?story=<id>` hook at 390x844, 1280x800 and 375x667 and checked
   against facts derived from the engine (what is tappable, fresh, locked, selected, enabled), the
   fixed geometry (no scroll, eleven same-size cells, two rows on a phone) and the owner's rule that
   a draw moves no card; at the first two viewports a screenshot is compared against the committed
   per-platform baseline in `e2e/__screenshots__/` (`maxDiffPixelRatio: 0.002`; a missing baseline
   fails). `?story=` alone lists the stories in the browser. After a named visual change re-record
   both platforms and say so in the PR:

   ```sh
   npm run test:e2e -- e2e/gin-stories.spec.ts --project pages --update-snapshots   # the -darwin.png files, locally
   gh workflow run stories-baselines.yml --ref <branch> && gh run download -n stories-baselines-linux -D e2e/__screenshots__   # the -linux.png files
   ```

8. **Advisory broker** (CI job `broker`, `continue-on-error`):
   `E2E_BROKER=cloud npm run test:e2e -- --grep "@online|@relay"` plays the same specs through
   0.peerjs.com (the TURN relay stays the local coturn), so a signalling regression is visible at
   review without a third party blocking a merge.
9. **Nightly** (`.github/workflows/nightly.yml`, 09:23 UTC or `gh workflow run nightly.yml`):
   `npm run test:deployed` (`E2E_TARGET=deployed`) runs the same `@online` and `@relay` specs with
   the deployed page, https://arisweedler-at.github.io/hyperagent-web-apps/, as the subject: the
   `pages` project's baseURL is that origin, and the page is opened with the same `?peer=` and
   `?ice=` hooks, naming the PeerServer, ICE lists and coturn the harness started on the runner
   (the build only feeds the serve-dist that hosts the lists). A public https page reaching
   127.0.0.1 needs Chromium's Local Network Access permission, which the player fixture grants to
   its context. There is no `proxy` project in that run and nothing fetches `turn.sweedler.com`:
   games.sweedler.com and the credential Worker are Cloudflare, whose bot protection challenged the
   runner once (issue #19), and no test depends on Cloudflare. What it proves is that the bytes
   Pages serves still play a two-peer game and a relay-forced one; the deployed relay credentials
   are checked by hand (see "Online play", "Verify"). A failure comments the run URL on the open
   issue labelled `nightly` (creating it when missing); a green run closes it.

**Moving a golden.** A PR that changes what a golden pins says so in its body and touches only that
golden. Computed styles: `npm run build`, then
`node --experimental-strip-types tools/parity/computed-styles.ts` rewrites the six files
(`--check` compares without writing; a `--token` the golden never recorded is a note, not a failure,
until re-recorded). Legacy cuts: `npm run fixtures:legacy`, and the PR says why the oracle moved
(`legacy/**` itself is never edited). Gin wire frames and storage captures:
`npm run fixtures:gin-wire`, `npm run fixtures:gin-storage`. The class contract: edit the row in
`CONTRACT.md`.

## Add a game

A game is a folder; under `web/shared` only the `Game` row in `web/shared/lib/roomCode.ts`
changes, and the proxy needs nothing (`docs/ARCHITECTURE.md` "Conventions for small diffs" and
"Module boundaries").

1. `web/games/<g>/index.html`: the markup, `<link rel="stylesheet">` to
   `../../shared/styles/tokens.css`, `../../shared/styles/base.css` and `./theme.css` in that order,
   and `<script type="module" src="./main.ts">`. Vite's input glob (`web/**/index.html`) picks the
   folder up and builds `dist/games/<g>/index.html` with `app-[hash].js` beside it; the shared chunk
   and every CSS file land under `dist/shared/assets/`. Never a `/`-rooted URL: guard 1 fails.
2. `web/games/<g>/theme.css`: the game's rules over the thirteen tokens `tokens.css` declares (to use
   another palette, override them on `:root` as fidice does; `CONTRACT.md` "Tokens").
3. `web/games/<g>/main.ts`: the boot and no logic. Construct the adapters (`realTransport`,
   `createIce(browserIceDeps())`, `browserStore`, `realClock`, `Math.random` or `window.__rng`) and
   inject them; expose `window.__<g>` as the page's test hook.
4. `web/games/<g>/src/`: the layers `eslint.config.js` and `tsconfig.pure.json` recognise by path.
   `engine/` or `domain/` and `bots/` are pure (no DOM lib, no loops, no `let`, no throw, no
   classes; a reducer such as gin's `applyAction(state, seat, action, rng)` returns a new state
   as a `Result` and never mutates; a two-seat engine takes `Seat`, `Pair`, `Player`, `Now` and
   `RuleError` from `web/shared/lib/game.ts` and publishes `ENGINE: TwoSeatEngine<…>` from its
   `engine/index.ts`, the one surface the shared shell types against). `protocol.ts` (at `src/`
   or `src/net/`) is pure and the trust
   boundary: every inbound frame through a `Result` decoder. `net/{host,guest}.ts` are edges that
   take a `Transport` and never import `peerjs`. `ui/` or `view/` render to strings or VNodes with
   DOM writes in one module. `storage.ts` (or `app/effects.ts`, fidice's shape; both are the eslint
   storage zone) is the only localStorage reader, through `web/shared/edge/storage.ts` with a
   decoder on every read. Imports are relative with an explicit `.ts`
   (`../../../../shared/edge/storage.ts`); no `@shared` alias is wired. A loop goes into
   `*.algorithms.ts` with a reason comment and 100% line coverage.
   `Math.random` is banned outside `main.ts` and `web/shared/edge`; the pure layers (`engine/`,
   `domain/`, `bots/`, `protocol.ts`, the scorer maths, `*.algorithms.ts`) also ban `Date.now`:
   inject a clock.
5. Tests beside each module, and a suite row for the game in `tools/ci/suites.ts`: its `unit`
   globs (`web/games/<g>/**/*.test.ts` and any `test/parity/<g>.*` oracles), its `coverage.include`
   folders with one threshold row per group (measured minus a margin; nothing existing goes down),
   its e2e half `gameE2e('<g>')` and a `gameRules('<g>')` entry, both read off the game's `REGISTRY`
   row (step 7: `suite` names the `test/parity/<g>.*` prefix and the folder, `specs` its own e2e
   globs, `shell` adds the shell specs with the tag), so a change under `web/games/<g>/**` runs `<g>`,
   `e2e-<g>`, `site`, `e2e-site` and `harness`. `tools/ci/suites.test.ts`
   fails until every new test file is claimed by exactly one suite; `npm run test:<g>` is then the
   game's own loop and CI's two matrix jobs (`game`, `e2e-game`) pick `<g>` up from `GAME_SUITES`
   through `tools/ci/affected.ts`: `.github/workflows/ci.yml` is not edited (the same test pins
   that no game is spelled there).
6. A class TypeScript builds in a way the extraction cannot see, a hook with no rule, or dead CSS
   gets a row in `web/shared/styles/CONTRACT.md`; otherwise `class-contract.test.ts` fails after the
   build.
7. Join the registry the harness enumerates: add the game to the `Game` union in
   `web/shared/lib/roomCode.ts` (with its room-code row), then a row to `REGISTRY` in
   `tools/games.ts` (title, hook, its suite name and own spec globs for step 5, storage keys, PeerJS
   debug level, page shape, class-contract floors; `LEGACY_GAMES` only if it has a frozen
   `legacy/<g>/index.html`); `GAMES`, `PAGE_TITLES` and `HOOKS` are read off the rows, and the e2e
   fixtures, the dist guards and
   `tools/parity/computed-styles.ts` enumerate from them (then record the game's two goldens). Add a
   card to `web/index.html`.
8. One e2e spec per mode: `e2e/<g>-local.spec.ts` and `e2e/<g>-online.spec.ts` tagged `@online`
   (host and guest through `e2e/fixtures/two-players.ts`; `expectPeerOptions` on the recorded
   `new Peer` call). Both run on both projects (`npm run test:e2e:<g>` runs the game's specs alone),
   and the online one against the deployed page in nightly, for free. A game built on the shared
   shell (the home screen, the waiting rooms, the curtain: `docs/design/shared-shell.md` §3.1) joins
   `SHELL_GAMES` and `SHELL` in `tools/games.ts` and gets a `ShellDriver` row in
   `e2e/fixtures/online-games.ts` instead: `e2e/shell-*.spec.ts` then drive its shell, and `gameE2e`
   lists them on its suite row with the tag, off the `shell` row. A game with its own lobby (fidice
   today) gets an `OnlineDriver` row there instead of an online spec of its own:
   `e2e/shell-online.spec.ts` and `shell-relay.spec.ts` loop over every game, and `gameE2e` lists
   those two on a row without `shell`; the game's own specs are its row's `specs`.
9. The proxy needs nothing: the Worker's catch-all maps `games.sweedler.com/<g>/` to
   `/hyperagent-web-apps/games/<g>/`.

A second URL name for a game (`sheshbesh` for backgammon) is an alias, not a game: one row in
`ALIASES` in `tools/games.ts` and the same row in `infra/games-proxy/worker.ts` (its test pins the
two equal), plus the stub `web/games/<alias>/index.html` copied from `web/games/sheshbesh/`. No
landing card, no `GAMES`, room-code, title or hook row (`docs/ARCHITECTURE.md` "Two origins",
Aliases). The Worker must be redeployed for the alias to answer on games.sweedler.com.

## Deploy

**GitHub Pages.** The `deploy` job in `.github/workflows/ci.yml` runs on a push to `main` once
`check` (which built, guarded and uploaded `dist/`) and `e2e` pass: it downloads that artifact and
runs `actions/configure-pages`, `actions/upload-pages-artifact` and `actions/deploy-pages`, then
prints both served URLs in its summary. Nothing generated is committed. One-time console setting:
**Settings > Pages > Build and deployment > Source: GitHub Actions**. Roll a bad deploy back by
reverting the commit on `main`; the same job redeploys the previous `dist/`.

Cache window: a game page is an unhashed `index.html` referencing hashed sub-resources, and both
origins send `cache-control: max-age=600` on it. A deploy that changes a hash (a revert included)
can leave a browser holding the cached page 404ing on the previous `app-[hash].js` or shared chunk,
an empty page, for up to 10 minutes until it reloads.

**games.sweedler.com.** `infra/games-proxy/worker.ts` (TypeScript; wrangler bundles it as is) with
its `wrangler.toml` (custom domain route). Deploy by hand, wrangler is not a dependency of this
repo:

```
cd infra/games-proxy
npx wrangler deploy
```

The path mapping is the table at the top of `worker.ts`; `worker.test.ts` pins every row and
`tools/proxy-dev.ts` runs the same handler locally.

**turn.sweedler.com.** `infra/turn-worker/worker.js`, plain JavaScript deployed by hand: see
"Online play".

**Nightly.** `.github/workflows/nightly.yml` plays the deployed Pages page every night through the
harness's own local servers (see "Tests" 9; nothing Cloudflare is in the loop, so
games.sweedler.com is not played by any test); `gh workflow run nightly.yml` runs it after a deploy
you want checked now.

## Online play (TURN relay)

**Why.** Online play is peer-to-peer over WebRTC; PeerJS only brokers the handshake. When both
devices sit behind NAT a direct path cannot be punched and a TURN relay is mandatory. The free
anonymous relays the games used to rely on are gone (PeerJS's `*.turn.peerjs.com` hosts no longer
resolve; `openrelay.metered.ca` rejects the old shared credentials). With no relay configured the
games fall back to STUN-only and the host's wait screen shows a warning.

**Where to configure.** One constant, `ICE_CONFIG_URL` in `web/shared/edge/ice.ts` (bundled into
both games), points at `https://turn.sweedler.com`, the Worker below. For a test, `?ice=<url>` on a
game URL overrides it without editing the file, and `?ice-policy=relay` forces
`iceTransportPolicy: 'relay'` so only relayed candidates are used (the `@relay` specs' relay-forced
games). The URL must return JSON, a bare array of ICE servers or `{"iceServers":[...]}`, with CORS
headers that allow both site origins. Results are cached for 10 minutes; a fetch failure falls back
to STUN-only.

**The Worker (Cloudflare Realtime TURN).** 1000 GB/month free, and the key stays secret because
`infra/turn-worker/` mints short-lived credentials on demand.

1. dash.cloudflare.com -> Realtime -> TURN -> Create key. Copy the Key ID and the API token (the
   token is shown once).
2. Put the Key ID in `TURN_KEY_ID` under `[vars]` in `infra/turn-worker/wrangler.toml` (it is not
   secret), then:
   ```
   cd infra/turn-worker
   npx wrangler login
   npx wrangler deploy
   npx wrangler secret put TURN_KEY_API_TOKEN
   ```
   Deploy before the secret put so the Worker exists.
3. `wrangler.toml` routes the Worker at `turn.sweedler.com` (custom domain on the sweedler.com
   zone); it also answers on the account's `*.workers.dev` URL. `ICE_CONFIG_URL` names the former.

The other vars: `ALLOWED_ORIGINS` (comma-separated browser origins allowed to fetch credentials;
both site origins are listed; empty allows any; requests with no Origin header, such as curl,
always pass) and `TTL_SECONDS` (credential lifetime, default 7200; a game session should fit inside
it). To test with `?ice=` from a local dev server, add its origin (for example
`http://localhost:8765`) or leave the list empty.

**Alternative: Metered.ca** (no server). Create a free account and app at https://www.metered.ca/
and set `ICE_CONFIG_URL` to `https://<app>.metered.live/api/v1/turn/credentials?apiKey=<key>`. The
key is visible in page source, acceptable for a free-tier hobby quota (0.5 GB/month at the time of
writing) that is ample for text-only game traffic.

**Verify.**

- `curl https://turn.sweedler.com` prints JSON containing `turn:` and/or `turns:` entries.
- Open a game (with `?ice=<url>` to test another endpoint) and host a room. The wait screen shows
  a relay hint only when no relay is configured.
- Connect a second device. A toast says "Connected via relay" or "Connected directly".
- No test fetches `turn.sweedler.com` (the harness relays through its own coturn), so the deployed
  credentials are checked here, by hand: `curl` above, then a game with `?ice-policy=relay` and no
  `?ice=` that toasts "Connected via relay".

## Layout

```
web/index.html               landing page, the first Vite entry (no scripts); dist/index.html is byte-identical
web/public/.nojekyll         copied to dist/ so Pages serves dotfiles and folders untouched
web/shared/lib/              shared pure TypeScript: result, rng, json decoders, roomCode, clock types
web/shared/edge/             shared effects: ice, transport (the only importer of peerjs) + fake, clock, storage, dom, fx, share
web/shared/styles/           tokens.css (the shared palette, :root only), base.css (shared primitives), CONTRACT.md
web/shared/ui/               reserved for the roadmap's shared screen builders (README only)
web/shared/example/coin/     the coin game: the two-seat engine the shared replay driver is proved on (100% row; the shell's future fake)
web/games/gin-rummy/         index.html, theme.css, main.ts, src/{engine,protocol.ts,storage.ts,net,ui,scorer}
web/games/fidice/            index.html, theme.css, main.ts, MANIFEST.json, src/{assets,domain,bots,net,view,app}
web/games/backgammon/        index.html, theme.css, main.ts, src/{engine,protocol.ts,storage.ts,fx.ts,net,ui,ui/board}
web/games/briscola/          src/engine only so far (docs/design/briscola-rules.md): the N-seat engine for 2, 3 and 4
                             players, its tests and the seeded replay; the page follows (docs/design/briscola.md)
legacy/                      the pre-migration pages and shared/ice.js, verbatim; never served, never edited (legacy/README.md)
test/fixtures/legacy/        sha256-pinned cuts of the legacy cores, the gin wire frames and storage captures
test/fixtures/styles/        computed-style goldens, <game>.<viewport>.json
test/parity/                 describe.each([legacy, current]) suites and the seeded replays
test/shared/                 replay.ts (the seeded driver: dice, picks, shards, the env knob, round trips) and engine-helpers.ts (PLAYERS, now, viaJson, must, countingRng, runIntents)
test/dist/                   the dist guards and the class contract (the site suite: npm run test:site)
test/integration/            the real transport through a local PeerServer in Chromium (npm run test:shared-integration)
test/tools/                  tests of the tools below
e2e/                         Playwright specs; fixtures/ (site, player, two-players, offline, seed); browser/ init scripts
tools/                       serve-dist, proxy-dev, hooks-verify; legacy/ extractors and recorders; parity/ drivers;
tools/ci/                    suites.ts (the one table: suite -> tests, coverage rows, specs, and change -> jobs), affected.ts, run-affected.ts
infra/games-proxy/           Cloudflare Worker (TypeScript) serving the site at games.sweedler.com
infra/turn-worker/           Cloudflare Worker (plain JS) minting TURN credentials at turn.sweedler.com
docs/                        ARCHITECTURE.md (the layout and its rules), MIGRATION.md (the plan and its Deviations), design/ (per-feature designs)
.github/workflows/           ci.yml (changes -> check + one job per shared suite and a matrix per game side -> ci-ok -> deploy), nightly.yml (the deployed page through local servers)
.github/actions/npm-ci/      the scanned install that rewrites the runner's lockfile copy (see "Develop")
.githooks/                   pre-commit (chains the template hook), pre-push (npm run check:affected)
vite.config.ts               root web/, base './', input = every web/**/index.html
vitest.config.ts             one project per suite of tools/ci/suites.ts; the coverage block computed from VITEST_SUITE
playwright.config.ts         projects pages and proxy; E2E_BROKER=cloud, E2E_TARGET=deployed, E2E_PORT_OFFSET, E2E_TURN
dist/                        build output (gitignored): what both origins serve
```

There is no `stories/` and no Storybook: the UI is pinned by the class contract, the computed-style
goldens and the e2e specs (see "Tests").
