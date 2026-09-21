# hyperagent-web-apps

Two browser games, Gin Rummy and Fidice (one-cup liar's dice), written in strict functional
TypeScript, built by Vite into static pages and served from two origins: GitHub Pages and a
Cloudflare Worker in front of it. Online play is peer-to-peer over WebRTC (PeerJS brokers the
handshake; a Cloudflare TURN relay carries the game when NAT blocks a direct path). Every push to
`main` and every PR is gated by typecheck, lint, unit and parity tests, dist guards and a two-peer
Playwright game on both emulated origins; a nightly plays the deployed pages for real.
`docs/ARCHITECTURE.md` is the layout and its rules; `docs/MIGRATION.md` records how two single-file
pages got here.

## Play

| Game                         | GitHub Pages                                                          | games.sweedler.com                    | Source                 |
| ---------------------------- | --------------------------------------------------------------------- | ------------------------------------- | ---------------------- |
| Gin Rummy                    | https://arisweedler-at.github.io/hyperagent-web-apps/games/gin-rummy/ | https://games.sweedler.com/gin-rummy/ | `web/games/gin-rummy/` |
| Fidice (one-cup liar's dice) | https://arisweedler-at.github.io/hyperagent-web-apps/games/fidice/    | https://games.sweedler.com/fidice/    | `web/games/fidice/`    |

Both origins serve the same `dist/`. `games.sweedler.com` is the Cloudflare Worker in
`infra/games-proxy/`: `/gin-rummy/` and `/fidice/` are the short URLs, `/games/<name>/` redirects to
them and `/shared/...` maps to the site's `shared/` directory. A host on one origin and a guest on
the other still meet: peer ids carry no origin.

Online play works on one network, or behind friendly NATs, with STUN alone. Two devices both behind
NAT (a phone on cellular and a laptop on office Wi-Fi) need the TURN relay: the pages fetch
short-lived credentials from `https://turn.sweedler.com` (see "Online play"). Without them the
host's wait screen warns that no relay is configured and a cross-network join can fail. Once
connected, a toast says "Connected directly" or "Connected via relay".

## Develop

Node 22 (`.nvmrc`). TypeScript, ESLint (typescript-eslint strict, eslint-plugin-functional, import-x
boundaries), Prettier, vitest and Playwright, all pinned exactly in `package.json`.

```
npm ci            # install; the `prepare` script also installs the git hooks
npm run check     # typecheck + lint + unit tests + build + dist guards: what CI and pre-push run
```

| Script                                               | What it does                                                                                                   |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                      | `typecheck`, `lint`, `test`, `build`, `test:dist`, in that order; CI job `check` and the pre-push hook         |
| `npm run typecheck`                                  | `tsc -b` over the web, pure and node projects                                                                  |
| `npm run lint`                                       | `eslint . --max-warnings 0`, then `prettier --check .`                                                         |
| `npm run lint:fix` / `npm run format`                | `eslint --fix` / `prettier --write` on everything they check                                                   |
| `npm test`                                           | vitest over `web/`, `test/`, `infra/` `*.test.ts` bar `test/dist/`, `test/integration/`; `-- --coverage` gates |
| `npm run test:watch`                                 | vitest, watching                                                                                               |
| `npm run build`                                      | `vite build` -> `dist/` (`web/` is the root; every `web/**/index.html` is an entry)                            |
| `npm run test:dist`                                  | the guards on `dist/` (see "Tests"); needs a build first                                                       |
| `npm run test:integration`                           | the real PeerJS transport through a local PeerServer in Chromium; skips where loopback WebRTC is blocked       |
| `npm run test:e2e`                                   | build, then Playwright: every spec in `e2e/` on both emulated origins                                          |
| `npm run test:live`                                  | the `@online` and `@relay` specs against the two live origins; what nightly runs                               |
| `npm run serve`                                      | GitHub Pages emulation: `dist/` at http://127.0.0.1:4173/hyperagent-web-apps/                                  |
| `npm run preview`                                    | build, then serve                                                                                              |
| `npm run proxy:dev`                                  | games.sweedler.com emulation: the real Worker at http://127.0.0.1:8787/ over :4173                             |
| `npm run fixtures:legacy`                            | re-cut `test/fixtures/legacy/*.cjs` from the frozen pages and re-pin `MANIFEST.json`                           |
| `npm run fixtures:gin-wire` / `fixtures:gin-storage` | re-record the gin wire frames / localStorage captures from the legacy page                                     |
| `npm run debundle:fidice`                            | re-split the legacy fidice bundle into `web/games/fidice/src/**` and re-pin its `MANIFEST.json`                |
| `npm run hooks` / `npm run hooks:verify`             | `git config core.hooksPath .githooks` / confirm the wiring                                                     |

Git hooks are plain files in `.githooks/`: `pre-commit` chains to the owner's template hook in
`.git/hooks/pre-commit` (big-file and trailing-whitespace prompts; it resolves the hook through
`--git-common-dir`, so linked worktrees reach it too) and `pre-push` runs `npm run check`. `npm ci`
installs them through `prepare`; run `npm run hooks` again if `core.hooksPath` was changed.

`package-lock.json` is written behind Airtable's Socket Firewall registry and is committed exactly
as npm produces it; never rewrite it. CI installs through `.github/actions/npm-ci`, which points the
runner's copy of the lockfile at the public registry, installs through Socket Firewall Free (`sfw
npm ci`) so CI installs are scanned, and restores the file; the integrity hashes are verified either
way.

Prettier leaves alone what must keep its bytes (`.prettierignore`): `legacy/**`, `web/index.html`
(dist parity compares against it verbatim), both games' `index.html` and `theme.css` (the legacy
layout, so a diff against `legacy/` reads as the hoist alone), the generated fixtures, `docs/` and
`infra/turn-worker/`.

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
   the extractors on every run and `frozen.test.ts` pins the whole files. 1000 seeded gin games and
   12 seeded fidice bot games (`SEEDS` in `test/parity/fidice.legacy.test.ts`) replay through both
   legs with states deep-equal; recorded wire frames and localStorage captures decode and re-encode
   byte for byte. Known legacy defects the port fixes are named and pinned on the legacy leg only.
   Test hooks on the pages: `window.__gin`, `window.__fidice`, and `window.__rng` as the rng when
   installed before boot.
3. **Dist guards** (`npm run build && npm run test:dist`, `test/dist/`): every URL in dist HTML and
   CSS is relative and resolves on both origins through the Worker's real `mapPath()`; both game
   pages are Vite module pages that preload one shared chunk and link the shared stylesheet;
   `dist/index.html` is byte-identical to `web/index.html`. The **class contract**
   (`class-contract.test.ts`): every class the game's TypeScript names has a rule in a stylesheet
   the page links and vice versa, with what the extraction cannot see tabled in
   `web/shared/styles/CONTRACT.md` (each row is checked against the tree, so it cannot go stale).
4. **Computed-style goldens** (`e2e/computed-styles.spec.ts`, `pages` project):
   `tools/parity/computed-styles.ts` drives each page through its screens at 390x844 and 1280x800
   and reads `getComputedStyle` for ~60 selectors; `test/fixtures/styles/<game>.<viewport>.json`
   are the goldens. A CSS move that changes a computed value fails with one line per
   screen/selector/property.
5. **Transport integration** (`npm run test:integration`): the real PeerJS adapter through a local
   PeerServer in Chromium runs the same contract scenario as `transport.fake.ts` and must produce
   the same log.
6. **Hermetic two-peer e2e** (`npm run test:e2e`; first time `npx playwright install chromium`):
   builds `dist/`, starts `tools/serve-dist.ts` (:4173), `tools/proxy-dev.ts` (:8787, the real
   Worker over :4173) and a PeerServer (:9000), then runs every spec in `e2e/` on projects `pages`
   and `proxy`: smoke on every page (zero uncaught exceptions, zero failed requests outside an
   allowlist), gin local and scorer, and the `@online` specs (gin join/deal/turns, host reload and
   guest rejoin, fidice lobby/start) in a host and a guest context that meet through `?peer=` and
   take a STUN-only ICE list through `?ice=`; fonts and CDNs are answered from local copies and
   `Math.random` is seeded. `e2e/gin-dom-parity.spec.ts` plays the same game on the served gin page
   and on the frozen legacy page (aliased in by the harness) and compares 84 checkpoints. The report
   lands in `playwright-report/` (`npx playwright show-report`). The two contexts connect over the
   machine's own addresses: a Cloudflare WARP-style tunnel that drops loopback UDP times them out.
7. **Advisory broker** (CI job `broker`, `continue-on-error`):
   `E2E_BROKER=cloud npm run test:e2e -- --grep @online` plays the same specs through 0.peerjs.com,
   so a signalling regression is visible at review without a third party blocking a merge.
8. **Nightly** (`.github/workflows/nightly.yml`, 09:23 UTC or `gh workflow run nightly.yml`):
   `npm run test:live` aims both projects at the live origins with nothing local started and runs
   the `@online` specs through the real broker and `turn.sweedler.com`, plus
   `e2e/gin-relay.spec.ts`: a gin game opened with `?ice-policy=relay`, so every candidate must
   cross the Cloudflare relay and "Connected via relay" must show on both pages. A failure
   comments the run URL on the open issue labelled `nightly` (creating it when missing); a green
   run closes it.

**Moving a golden.** A PR that changes what a golden pins says so in its body and touches only that
golden. Computed styles: `npm run build`, then
`node --experimental-strip-types tools/parity/computed-styles.ts` rewrites the four files
(`--check` compares without writing; a `--token` the golden never recorded is a note, not a failure,
until re-recorded). Legacy cuts: `npm run fixtures:legacy`, and the PR says why the oracle moved
(`legacy/**` itself is never edited). Gin wire frames and storage captures:
`npm run fixtures:gin-wire`, `npm run fixtures:gin-storage`. The class contract: edit the row in
`CONTRACT.md`.

## Add a game

A game is a folder; nothing under `web/shared` changes and the proxy needs nothing
(`docs/ARCHITECTURE.md` "Conventions for small diffs" and "Module boundaries").

1. `web/games/<g>/index.html`: the markup, `<link rel="stylesheet">` to
   `../../shared/styles/tokens.css`, `../../shared/styles/base.css` and `./theme.css` in that order,
   and `<script type="module" src="./main.ts">`. Vite's input glob (`web/**/index.html`) picks the
   folder up and builds `dist/games/<g>/index.html` with `app-[hash].js` beside it; the shared chunk
   and every CSS file land under `dist/shared/assets/`. Never a `/`-rooted URL: guard 1 fails.
2. `web/games/<g>/theme.css`: the game's rules over the eleven tokens `tokens.css` declares (to use
   another palette, override them on `:root` as fidice does; `CONTRACT.md` "Tokens").
3. `web/games/<g>/main.ts`: the boot and no logic. Construct the adapters (`realTransport`,
   `createIce(browserIceDeps())`, `browserStore`, `realClock`, `Math.random` or `window.__rng`) and
   inject them; expose `window.__<g>` as the page's test hook.
4. `web/games/<g>/src/`: the layers `eslint.config.js` and `tsconfig.pure.json` recognise by path.
   `engine/` or `domain/` and `bots/` are pure (no DOM lib, no loops, no `let`, no throw, no
   classes; a reducer such as gin's `applyAction(state, seat, action, rng)` returns a new state
   as a `Result` and never mutates). `protocol.ts` (at `src/` or `src/net/`) is pure and the trust
   boundary: every inbound frame through a `Result` decoder. `net/{host,guest}.ts` are edges that
   take a `Transport` and never import `peerjs`. `ui/` or `view/` render to strings or VNodes with
   DOM writes in one module. `storage.ts` (or `app/effects.ts`, fidice's shape; both are the eslint
   storage zone) is the only localStorage reader, through `@shared/edge/storage` with a decoder on
   every read. A loop goes into `*.algorithms.ts` with a reason comment and 100% line coverage.
   `Math.random` is banned outside `main.ts` and `web/shared/edge`; the pure layers (`engine/`,
   `domain/`, `bots/`, `protocol.ts`, the scorer maths, `*.algorithms.ts`) also ban `Date.now`:
   inject a clock.
5. Tests beside each module. Add the new folders to `coverage.include` and one `thresholds` entry
   per group in `vitest.config.ts` (measured minus a margin; nothing existing goes down).
6. A class TypeScript builds in a way the extraction cannot see, a hook with no rule, or dead CSS
   gets a row in `web/shared/styles/CONTRACT.md`; otherwise `class-contract.test.ts` fails after the
   build.
7. Join the per-game lists the harness enumerates: `GAMES` in `test/dist/classes.ts`,
   `test/dist/dist-parity.test.ts` and `tools/parity/computed-styles.ts` (then record the game's two
   goldens), and `PAGES` with `EXPECTED_TITLES` in `e2e/fixtures/site.ts` so smoke covers the page.
   Add a card to `web/index.html`.
8. One e2e spec per mode: `e2e/<g>-local.spec.ts` and `e2e/<g>-online.spec.ts` tagged `@online`
   (host and guest through `e2e/fixtures/two-players.ts`; `expectPeerOptions` on the recorded
   `new Peer` call). Both run on both projects, and the online one live in nightly, for free.
9. The proxy needs nothing: the Worker's catch-all maps `games.sweedler.com/<g>/` to
   `/hyperagent-web-apps/games/<g>/`.

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

**Nightly.** `.github/workflows/nightly.yml` plays the deployed pages every night (see "Tests");
`gh workflow run nightly.yml` runs it after a deploy you want checked now.

## Online play (TURN relay)

**Why.** Online play is peer-to-peer over WebRTC; PeerJS only brokers the handshake. When both
devices sit behind NAT a direct path cannot be punched and a TURN relay is mandatory. The free
anonymous relays the games used to rely on are gone (PeerJS's `*.turn.peerjs.com` hosts no longer
resolve; `openrelay.metered.ca` rejects the old shared credentials). With no relay configured the
games fall back to STUN-only and the host's wait screen shows a warning.

**Where to configure.** One constant, `ICE_CONFIG_URL` in `web/shared/edge/ice.ts` (bundled into
both games), points at `https://turn.sweedler.com`, the Worker below. For a test, `?ice=<url>` on a
game URL overrides it without editing the file, and `?ice-policy=relay` forces
`iceTransportPolicy: 'relay'` so only relayed candidates are used (the nightly's relay-forced
game). The URL must return JSON, a bare array of ICE servers or `{"iceServers":[...]}`, with CORS
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
- `npm run test:live` plays both live origins, including the relay-forced game.

## Layout

```
web/index.html               landing page, the first Vite entry (no scripts); dist/index.html is byte-identical
web/public/.nojekyll         copied to dist/ so Pages serves dotfiles and folders untouched
web/shared/lib/              shared pure TypeScript: result, rng, json decoders, roomCode, clock types
web/shared/edge/             shared effects: ice, transport (the only importer of peerjs) + fake, clock, storage, dom, fx, share
web/shared/styles/           tokens.css (the shared palette, :root only), base.css (shared primitives), CONTRACT.md
web/shared/ui/               reserved for the roadmap's shared screen builders (README only)
web/games/gin-rummy/         index.html, theme.css, main.ts, src/{engine,protocol.ts,storage.ts,net,ui,scorer}
web/games/fidice/            index.html, theme.css, main.ts, MANIFEST.json, src/{assets,domain,bots,net,view,app}
legacy/                      the pre-migration pages and shared/ice.js, verbatim; never served, never edited (legacy/README.md)
test/fixtures/legacy/        sha256-pinned cuts of the legacy cores, the gin wire frames and storage captures
test/fixtures/styles/        computed-style goldens, <game>.<viewport>.json
test/parity/                 describe.each([legacy, current]) suites and the seeded replays
test/dist/                   the dist guards and the class contract (npm run test:dist)
test/integration/            the real transport through a local PeerServer in Chromium
test/tools/                  tests of the tools below
e2e/                         Playwright specs; fixtures/ (site, player, two-players, offline, seed); browser/ init scripts
tools/                       serve-dist, proxy-dev, hooks-verify; legacy/ extractors and recorders; parity/ drivers
infra/games-proxy/           Cloudflare Worker (TypeScript) serving the site at games.sweedler.com
infra/turn-worker/           Cloudflare Worker (plain JS) minting TURN credentials at turn.sweedler.com
docs/                        ARCHITECTURE.md (the layout and its rules), MIGRATION.md (the plan and its Deviations)
.github/workflows/           ci.yml (check, e2e, broker, deploy), nightly.yml (the live run)
.github/actions/npm-ci/      the scanned install that rewrites the runner's lockfile copy (see "Develop")
.githooks/                   pre-commit (chains the template hook), pre-push (npm run check)
vite.config.ts               root web/, base './', input = every web/**/index.html
vitest.config.ts             unit config and coverage thresholds; vitest.dist / vitest.integration configs beside it
playwright.config.ts         projects pages and proxy; E2E_BROKER=cloud, E2E_TARGET=live
dist/                        build output (gitignored): what both origins serve
```

There is no `stories/` and no Storybook: the UI is pinned by the class contract, the computed-style
goldens and the e2e specs (see "Tests").
