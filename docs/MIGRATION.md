# Migration

Ordered, PR-sized steps from today's repo (two single-file pages, `shared/ice.js`, no build) to
the layout in `docs/ARCHITECTURE.md`. Rules that hold for every step:

- Tests land before the code they protect. A step that ports code names the suite that proves it.
- The live site works after every step on both origins. Pages not yet cut over are served
  byte-for-byte from `legacy/` by the `legacyPassthrough` plugin.
- Each PR body records: parity result, e2e result on both origins, and for any step that touches
  transport, one manual phone-to-laptop game with one side on github.io and the other on
  games.sweedler.com.
- Known legacy defects (gin `lastDrawn` leak, trapper's dependence on English log text, scorer
  `prompt()`/`confirm()` dialogs, duplicated rules markup) are preserved and named until step 15.
- Goldens and fixtures are split into files under 100 KB so the owner's template pre-commit
  big-file prompt stays quiet. The legacy page moves in step 4 will prompt once; answer `y`.

Steps 1-4 are the foundation and should be done first, in order.

## Foundation

### 1. Toolchain scaffold and hooks (no app changes)

- Goal: install the enforcement toolchain against an empty `web/` tree so every later PR is checked.
- Files: `package.json` (+ `package-lock.json`; devDependencies typescript, vite, vitest,
  @vitest/coverage-v8, eslint, typescript-eslint, eslint-plugin-functional, eslint-plugin-import-x,
  eslint-config-prettier, prettier, @types/node; dependency peerjs@1.5.4 exact), `.nvmrc`,
  `tsconfig.{json,base,web,pure,node}.json`, `eslint.config.js`, `.prettierrc`, `vitest.config.ts`,
  `.githooks/{pre-commit,pre-push}`, `.gitignore` (+dist, node_modules, playwright-report,
  test-results), `.github/workflows/ci.yml` job `check`; `infra/games-proxy/worker.js` exports
  `mapPath()` and reads `env.UPSTREAM ?? 'https://arisweedler-at.github.io'`; `worker.test.js`
  moves to vitest and covers `mapPath` for every current path shape.
- Proves: CI `check` green; `npm run hooks:verify` passes; manually, committing a file with trailing
  whitespace still triggers the template hook's prompt, and `git push` runs pre-push. `git rev-parse
  --git-dir` (not `--git-path hooks`) is what the shim uses; see ARCHITECTURE.
- Rollback: revert; nothing served changes.

### 2. Freeze legacy and record goldens

- Goal: a permanent oracle of today's behaviour before anything moves.
- Files: `test/fixtures/legacy/gin-engine.cjs` (lines 557-1196 of the gin page with the `<script>`
  tag stripped; loads via its UMD branch) and `fidice-core.cjs` (bundle through `domain/search.ts`
  plus an export line), both produced by `tools/legacy/extract-*.ts` and sha256-pinned to the
  pages; `tools/legacy/record-gin-games.ts` (1000 seeded random-legal-play games: state and both
  views per action, `ts` masked), `record-fidice-goldens.ts` (252-row ladder, seeded `apply`
  traces, `redactFor`, every strategy's `decide()` over 500 seeded views, protocol corpus); wire
  goldens captured via CDP from the live legacy pages (`test/goldens/wire/`); `web/shared/lib/rng.ts`.
  Additive page edits only: `window.__fidice` debug hook and `window.__rng` seam (~30 lines inside
  the fidice bundle; gin already has `window.__gin`).
- Proves: characterization suites in `test/parity` green against the `.cjs` cores; goldens
  regenerate identically on two runs; sha256 test ties fixtures to HEAD pages; a manual online
  fidice game because the page changed.
- Rollback: revert the fidice page edit; fixtures are inert.

### 3. Two-peer e2e against the legacy pages, both emulated origins

- Goal: the merge gate for online play exists before any code moves.
- Files: `playwright.config.ts`, `e2e/fixtures/two-players.ts`, `e2e/{gin-online,gin-local,
  gin-scorer,fidice-online}.spec.ts`, `e2e/smoke.spec.ts`, `tools/serve-dist.ts` (pointed at the
  repo root for now), `tools/proxy-dev.ts`, PeerServer (`peer` package) in `webServer`; ci.yml jobs
  `e2e` (gate) and `broker` (advisory); additive `?peer=host:port` override in both legacy pages
  (6 lines in gin `peerOptsFor`, 6 lines in fidice `deferredPeer`); visual baselines captured on
  the CI runner; computed-style goldens at two viewports.
- Proves: e2e green on projects `pages` and `proxy` in CI; a byte-compare shows the only page diffs
  are the `?peer=` branches; manual broker game to confirm the default path is untouched.
- Rollback: revert the 12 page lines; specs are inert.

### 4. Vite build in passthrough mode; Pages deployed by Actions

- Goal: `dist/` is what Pages serves, built by Actions; the root stops holding HTML; the switch is
  provably zero-diff.
- Files: `git mv games/gin-rummy/index.html legacy/gin-rummy/index.html`, same for fidice,
  `shared/ice.js` -> `legacy/shared/ice.js`, `.nojekyll` -> `web/public/.nojekyll`, root `index.html`
  -> `web/index.html` (the first Vite entry; it has no scripts); `vite.config.ts` with
  `legacyPassthrough({pages: ['gin-rummy', 'fidice']})`; `test/dist/{asset-urls,check-dist-paths,
  dist-parity}.test.ts` (dist game pages byte-identical to `legacy/`); ci.yml job `deploy`; README
  paragraph on the Pages source setting.
- Proves: dist-parity test; e2e now runs against dist on both origins; before flipping Settings >
  Pages > Source to GitHub Actions, record sha256 of both game pages on both live origins; after
  the first deploy re-check them (identical) and diff the landing page normalised (Vite reformats
  only whitespace/doctype); one manual cross-origin game.
- Rollback: flip the Pages source back to the branch deploy; the previous commit still holds the
  root pages. Do the flip immediately after merging with the workflow already green on the PR.

## Shared code

### 5. Shared TypeScript modules with tests first

- Goal: the pure and edge libraries both games will consume, not yet consumed.
- Files: `web/shared/lib/{result,json,roomCode,algorithms,clock}.ts`, `web/shared/edge/{ice,
  transport,transport.fake,clock,storage,dom,fx}.ts`, `web/shared/styles/tokens.css` (empty
  `:root`), `web/shared/styles/CONTRACT.md`, `web/shared/ui/README.md`, colocated tests.
- Proves: `ice.ts` parity with `legacy/shared/ice.js` over the same fixture responses (timeout,
  10-min cache, both payload shapes, fallback, `?ice=`); fake transport pair round-trips; a
  `transport.ts` integration test against the local PeerServer opens host/guest and exchanges a
  frame; `roomCode` constants equal the legacy literals; import-x zones pass.
- Rollback: revert; nothing served changes.

## Fidice (TypeScript originally; de-bundle, then type)

### 6. De-bundle Fidice into modules, shipped dark

- Goal: the bundle split at its 38 `// src/*.ts` markers into `web/games/fidice/src/**/*.js` with
  imports recovered from free-identifier analysis and esbuild collision renames (`h2/p2/b2/i2`,
  `turnKey2..6`, `clamp2/3`) undone only where they crossed a module; `index.html` becomes
  `<div id="app">` + module script; CSS moves verbatim to `theme.css`; stray `.ha-img-placeholder`
  block kept for now.
- Files: `tools/legacy/debundle-fidice.ts` (kept for audit), `web/games/fidice/**`; the legacy
  page stays in `LEGACY_PAGES`.
- Proves: step-2 suites run on the `current` leg and pass; parity spec deep-equals legacy vs current
  on every golden; module evaluation-order test for eager tables (`HANDS`, `GROUPS`, `RANKS`,
  `BID_LADDER`); e2e project `next` plays fidice-online on the built new page; the seeded 3-bot game
  log golden matches.
- Rollback: revert; the served page never changed.

### 7. Cut Fidice over

- Goal: the site serves the modular fidice.
- Files: remove `'fidice'` from `LEGACY_PAGES`; delete `legacy/fidice/index.html`.
- Proves: e2e `pages` + `proxy` for fidice; computed-style goldens; asset-urls and check-dist-paths;
  visual snapshots within 1%; manual mixed-origin game including token reconnect after reload.
- Rollback: revert the commit (restores the list entry and the legacy file).

### 8. Type the Fidice pure core

- Goal: `domain/**`, `bots/**`, `net/protocol` renamed `.js` -> `.ts` under `tsconfig.pure.json`,
  types recovered from usage and the existing validators; cartesian enumeration moves to
  `domain/probability.algorithms.ts`; `domain/result.ts` re-exports `@shared/lib/result`.
- Files: those modules; `test/ratchet.test.ts` (count of `.js` under `web/` never increases).
- Proves: `tsc -b` clean with `allowJs` for the edges; lint clean including functional rules;
  parity spec still deep-equals legacy; coverage thresholds enabled for domain/bots.
- Rollback: revert; behaviour lines are unchanged by construction (parity would show otherwise).

### 9. Type the Fidice edges

- Goal: `net/{host,client,session}.ts`, `net/peerjs.ts` as an adapter over `@shared/edge/transport`
  (drops the CDN `<script>` and `globalThis.Peer`), `view/**`, `app/{controller,effects}.ts`,
  `main.ts`.
- Files: those modules plus `HostSession`/`ClientSession` tests on fake transport + fake clock and
  vdom reconcile tests against DOM strings.
- Proves: protocol suite frame-by-frame equals wire goldens; e2e fidice-online and fidice-bots on
  both origins; manual broker game.
- Rollback: revert; PeerJS load-timing change is called out in the PR body.

## Gin Rummy (hand-written JS; port module by module, ship dark, flip once)

Gin's inline classic scripts depend on execution order (`window.GinEngine`, `window.__gin`,
`window.__scorer`), so the legacy page stays verbatim in passthrough while the port lands in
`web/games/gin-rummy/src`, exercised by the e2e `next` project from step 12 on.

### 10. Gin engine

- Goal: `engine/{types,cards,melds,melds.algorithms,layoff,game,view,index}.ts`, immutable and
  loop-free; the bitmask DP and node-capped DFS live in `melds.algorithms.ts` with reason comments.
- Proves: step-2 suites pass on the `current` leg; 1000-game parity (state and both views equal,
  `ts` masked, `lastDrawn` leak preserved and named); `legalActions` matches the legacy enumeration
  on every recorded view; `melds.algorithms.ts` at 100% coverage.
- Rollback: revert; nothing served changes.

### 11. Gin protocol, storage and pure UI/scorer helpers

- Goal: `protocol.ts` and `storage.ts` codecs (keys `ginRummyMP_v1`, `ginRummy_name`,
  `ginRummy_homeTab`, `ginRummy_playMode`, `ginRummy_sound`, `ginRummyScorerState_v2`,
  `ginRummy_scorerNames` frozen), `ui/{cards,cues,fit,rules}.ts`, `ui/hand/{HandView,meldGroups}.ts`,
  `scorer/{scores,voice,csv}.ts` (`computeRoundScores` takes players explicitly).
- Proves: wire goldens decode and re-encode byte-identically; rejection fuzz; storage decoders
  accept payloads captured from a real legacy session; `cardHtml`/`meldGroupsHtml` string goldens;
  scorer table tests.
- Rollback: revert; nothing served changes.

### 12. Gin UI, net, scorer screens and app, shipped dark

- Goal: `ui/{state,render,local,home}.ts`, `net/{host,guest}.ts` (netAttempt ticket, retry schedules
  and message set preserved verbatim), `scorer/main.ts`, `main.ts`, `index.html` (legacy markup
  verbatim, rules rendered from `ui/rules.ts` into both slots), `theme.css` verbatim; `window.__gin`
  kept as the documented test hook; legacy page stays in `LEGACY_PAGES`.
- Proves: DOM-snapshot parity for ~60 recorded views against the legacy page; host/guest session
  tests reproduce every sequence in the wire goldens; e2e project `next` runs gin-online,
  gin-local, gin-scorer and gin-resume on the built new page; typecheck and lint clean.
- Rollback: revert; the served page never changed.

### 13. Cut Gin Rummy over; retire `legacy/`

- Goal: the site serves the TypeScript gin; passthrough plugin and `legacy/` are deleted.
- Files: `LEGACY_PAGES` emptied then the plugin removed; `legacy/**` deleted; `?peer=` now lives only
  in `@shared/edge/transport`.
- Proves: e2e `pages` + `proxy` for every spec; computed-style goldens; asset-urls (no `../` beyond
  `../../shared/`, nothing `/`-rooted); visual snapshots within 1%; manual mixed-origin phone game
  including host reload/resume and guest rejoin.
- Rollback: revert the commit (restores the plugin and legacy file); the Pages deploy is unchanged.

## Consolidation

### 14. Hoist styles into tokens and base (values unchanged)

- Goal: shared `:root` tokens and the generic primitives both games already share move into
  `web/shared/styles/{tokens,base}.css`; each `theme.css` keeps game-specific rules, fidice's palette
  aliased onto shared token names with identical values; `test/dist/class-contract.test.ts` in CI.
- Proves: computed-style goldens equal at both viewports; visual snapshots within 1%; class
  contract passes; check-dist-paths for CSS `url()`.
- Rollback: revert; CSS only.

### 15. Tighten and pay named debts (first non-preserving step)

- Goal: remove `allowJs`; flip `functional/no-expression-statements` to error in pure dirs;
  enforce coverage thresholds; add `nightly.yml`; README rewrite (dev loop, add-a-game recipe,
  deploy story). Behaviour fixes, each with a test and a flipped golden named in the PR body:
  `dealHand` resets `lastDrawn`; single toast timer; dead `.ha-img-placeholder` CSS removed.
- Proves: CI green with zero `.js` under `web/`; all goldens except the named ones unchanged;
  nightly passes once against both live origins including the relay-forced game.
- Rollback: revert individual fixes; each is its own commit.

## After the migration (roadmap, not scheduled here)

Extract the generic host/client session and `shared/ui` screen builders from fidice and adapt gin
behind its wire goldens; restyle Fidice onto the shared tokens; alternative `HandView`
implementations; replace `fitTable` via `ui/fit.ts`. Each is a separate design under the same
parity and e2e gates.

## Deviations

- Step 1: the pre-commit shim uses `git rev-parse --git-common-dir` (not `--git-dir`) so linked
  worktrees still reach `.git/hooks/pre-commit`; see ARCHITECTURE "Deviations".
