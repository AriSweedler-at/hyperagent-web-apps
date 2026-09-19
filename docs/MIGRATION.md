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
  `scorer/{scores,voice,csv,format}.ts` (`computeRoundScores` takes players explicitly).
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
- Step 2: executable oracles instead of recorded goldens. `tools/legacy/record-*.ts` and
  `test/goldens/` were not created: with the cores pinned in `test/fixtures/legacy/`, the parity
  suites recompute legacy behaviour over seeded inputs at test time. The CDP wire-golden capture
  moves to step 3, where the browser harness lands. The fidice page edit is 2 lines (the
  `HostSession` already took `rng` by injection). See ARCHITECTURE "Deviations".
- Step 3: the fidice `?peer=` branch sits inside `deferredPeer`, which is inside the fixture range
  pinned in step 2, so `test/fixtures/legacy/fidice-core.cjs` and `MANIFEST.json` were re-cut
  (`npm run fixtures:legacy`; the range is now lines 371-2337 and the parity suites are unchanged).
  The page edits are 7 added lines in gin and 6 in fidice (plus 2 changed construction lines) rather
  than 6 and 6. Determinism comes from a seeded `Math.random` installed by `addInitScript` rather
  than the `window.__rng` seam, so no further page edit was needed. Visual baselines and
  computed-style goldens are not captured yet: they belong on the CI runner once the `e2e` job runs
  there, and the harness in this step is what captures them. See ARCHITECTURE "Deviations".
- Step 4: Vite 8.3.0 is Rolldown-based, so `vite.config.ts` uses `build.rolldownOptions`
  (`build.rollupOptions` is a deprecated alias in the installed types). `build.cssMinify` is off:
  with it on, Vite minifies and reorders the landing page's inline `<style>`; with it off
  `dist/index.html` is byte-identical to `web/index.html`, so `test/dist/dist-parity.test.ts`
  compares all four served files by sha256 and no normalised diff is needed. `npm run test:e2e` is
  `npm run build && playwright test`, so the `e2e` and `broker` jobs rebuild dist instead of
  downloading the `check` artifact; `deploy` downloads it. `test/dist/**` runs from
  `npm run test:dist` (its own `vitest.dist.config.ts`) after the build, also inside `npm run check`,
  and skips with a note when dist/ is absent; with `LEGACY_PAGES=` only the parity suite is
  meaningful until a page is ported. The generated fixture headers name the page they were cut
  from, so moving the pages re-pinned `fixtureSha256` by that one comment line each; both
  `sourceSha256` values are unchanged. `tools/serve-dist.ts` mounts `dist/` by default and resolves
  `--alias` targets against the working directory (the ICE fixture lives outside dist); its node
  tests mount a temp directory staged from `legacy/` and `web/index.html`
  (`test/tools/site-fixture.ts`) so `npm test` needs no build. See ARCHITECTURE "Deviations".
  The post-flip proof cannot be a raw sha256 of HTML fetched from games.sweedler.com: Cloudflare
  appends a challenge-platform `<script>` with a per-request ray id before `</body>`, so that
  origin's HTML hash differs from github.io and between two fetches (before this step too;
  `shared/ice.js` is unaffected). Hash the github.io URLs, which the Worker proxies byte for byte
  (`test/tools/proxy-dev.test.ts`), or strip the trailing block first:
  `curl -sL "$u" | perl -0pe 's/<script>\(function\(\)\{function c\(\).*?<\/script><\/body>/<\/body>/s' | shasum -a 256`.
- Step 5: `fakeClock` lives in `web/shared/edge/clock.fake.ts`, not `lib`: a usable fake keeps a
  timer queue between calls. `lib/clock.ts` is types only and disables `functional/no-return-void`
  for its two `void` members with a comment. `algorithms.ts` is not created (nothing needs a loop);
  `web/shared/lib/README.md` reserves it. `ice.ts`, `clock.ts`, `clock.fake.ts` and
  `transport.contract.log.ts` are written against structural types and are also listed in
  `tsconfig.node.json`, so `test/parity/ice.legacy.test.ts` can run the legacy IIFE (node:vm, fake
  clock, scripted fetch) beside the port and deep-equal the results; `ice.ts` takes an `endpoint`
  dep so the empty-URL branch is reachable in both. The DOM edge takes `Readonly<HTMLElement>` and
  writes through methods (`replaceChildren`, `insertAdjacentHTML`, `toggleAttribute`, `classList`)
  so the readonly-parameter rule stays on; its template tag is `safeHtml`, not `html`, because
  Prettier reformats markup inside `html` templates. jsdom is not installed, so `dom.test.ts` runs on
  a structural fake (no `*.dom.test.ts`). The transport integration test needs WebRTC, which node
  lacks, so `test/integration/transport.integration.test.ts` starts a PeerServer, a Vite dev server
  and Chromium itself (`npm run test:integration`, `vitest.integration.config.ts`; the CI `check` job
  installs Chromium and runs it after the unit tests). On this laptop it skips with a note (signalling
  completes, no data channel opens: Cloudflare WARP). Edge coverage threshold is 90% lines,
  functions and statements (branches uncounted: the fakes' defensive arms). See ARCHITECTURE "Deviations".
- Step 5 follow-up (review findings on the transport and room codes): the fake clones frames through
  PeerJS's own BinaryPack codec (`wireClone` in `transport.ts`, via the re-exported `util.pack` /
  `util.unpack`), not `structuredClone`, so `undefined` arrives as `null` and a `Date` as a string
  on both Transports; the contract log pins that. The adapter carries the legacy guards (`connect`
  on a disconnected peer returns an inert Connection; `reconnect` is a no-op unless disconnected and
  not destroyed) and the fake mirrors PeerJS's `error(network)` before `disconnected`, a null id
  while disconnected, `disconnected` before `close` on destroy, and `close` only for a channel that
  opened. `sanitiseCode` reproduces the legacy input handlers per game (gin keeps any A-Z, fidice
  only upper-cases) instead of filtering to the alphabet. The integration test's heuristic skip is
  off under `CI` (a channel that never opens fails there). See ARCHITECTURE "Deviations".
- Step 6: renames are kept (unique across the bundle) and bodies stay at their bundle indentation,
  exported by a trailing `export { ... }` line, so every body line is byte-identical to the page;
  `main.js` imports all 38 modules in bundle order and the recovered graph has no cycles or forward
  references. The tool also generates `index.html` and `theme.css` and pins everything in
  `web/games/fidice/MANIFEST.json`. `vite.config.ts` gains `experimental.renderBuiltUrl` (Vite's
  relative base wrote `../../games/fidice/app-x.js`; pages now get `./app-x.js`) and the passthrough
  always copies `shared/ice.js`; `npm run build:next` writes dist-next/ for the e2e project `next`
  and the dist guards run on both trees. `test/ratchet.test.ts` lands here rather than in step 8.
  See ARCHITECTURE "Deviations".
- Step 7: `legacy/fidice/index.html` is retained, not deleted: it is the frozen source that the
  sha256 oracle (`test/fixtures/legacy/MANIFEST.json`), `tools/legacy/extract-fidice-core.ts` and
  `tools/legacy/debundle-fidice.ts` read, and the generated modules' headers name it; moving it would
  churn 40 generated files for no behaviour gain. It is no longer served: `'fidice'` left
  `DEFAULT_LEGACY_PAGES` and `dist/games/fidice/index.html` is Vite's module page on both origins
  (`test/dist/dist-parity.test.ts` asserts that, that every asset it references exists, and that the
  fidice output is byte-identical in dist/ and dist-next/). Its delete is deferred to step 13 with
  the rest of `legacy/`. The e2e project `next` keeps only `smoke.spec.ts` (fidice-online there would
  replay the same bytes `pages` and `proxy` now cover); it stays for the gin port. Rollback is still
  one revert, with one window the legacy page did not have: the served `games/fidice/index.html` is
  unhashed and references `./app-[hash].js` and `../../shared/assets/fidice-[hash].css`, both origins
  send `cache-control: max-age=600` on it, and `emptyOutDir: true` drops the previous hashes on
  every build, so after a deploy that changes the hash (or the revert) a viewer holding the cached
  page can get a 404 for the old module script and see an empty page for up to 10 minutes until they
  reload. Closing it (carrying the previous deploy's `app-*.js` and `fidice-*.css` into `dist/`
  before publishing) is deferred to step 13. The computed-style goldens and visual snapshots named
  above are not captured (see step 3). See ARCHITECTURE "Deviations".
- Step 8, phase 1 (`domain/**`; `bots/**` and `net/protocol` follow): the eight domain modules are
  typed in place (`git mv` `.js` -> `.ts`) with the shared shapes in `domain/types.ts` and the
  cartesian enumeration plus its memo in `domain/probability.algorithms.ts`, re-exported from
  `probability.ts` under the legacy names (`cache` included: the parity oracle reads it).
  `domain/result.ts` re-exports `ok`/`err`/`Result` from `web/shared/lib/result.ts` by relative
  path, since the `@shared/*` alias is not wired for Vite, vitest or the import-x resolver yet. Two
  throws stay, each behind a commented `eslint-disable-next-line functional/no-throw-statements`:
  `result.ts` `expect` (the host session's unwrap of impossible-Err paths; it leaves the domain with
  `net/host` in step 9) and `hands.ts` `asRank` (the `RangeError` the parity suite pins). The hand
  tables' totality (`HANDS[rank]`, `GROUP_BY_KEY.get`) is asserted once through `present<T>()` in
  `hands.ts` instead of threading `| undefined` to every caller; runtime is unchanged. The debundle
  tool takes an `IsPorted` predicate (`portedOnDisk`: a `.ts` beside where the `.js` would go): it
  stops emitting that module, points the still-generated consumers at the `.ts` specifier and pins
  only provenance (`typed: true`, no sha256) in `MANIFEST.json`; its test still checks every
  generated file byte for byte and that no `.js` imports a missing module. The parity loader reads
  the module list from the manifest, so the `current` leg imports the `.ts` files and the fixture
  leg is untouched. `tsconfig.web.json` no longer excludes `domain/**` (a composite project must
  list every `.ts` its `.js` edges import), so the domain is checked by both projects.
  `JS_FILE_COUNT` is 31; coverage thresholds for `web/games/fidice/src/domain` are 90% lines,
  functions and statements, 100% for its `*.algorithms.ts`. See ARCHITECTURE "Deviations".
- Step 8, phase 2 (`bots/**` and `net/protocol`): the eleven bots modules and `net/protocol` are
  typed in place (`git mv` `.js` -> `.ts`); `JS_FILE_COUNT` is 19 (`main.js`, `assets`,
  `net/{client,host,peerjs,session}`, `view/**`, `app/**` remain for step 9). `bots/types.ts` holds
  the shared shapes (`BotView` with a non-null round, `BidRound`, `Step`, `Decision<M>`,
  `Strategy<M>`, `AnyStrategy`) and the guards `hasRound`/`hasBid` that narrow to them;
  `strategy.ts` keeps `anyStrategy` as the memory-erasing identity it was (a cast). Four
  behaviour-neutral edits, each commented in place: `toolkit.readSeat`/`raisesBy` take
  `Seat | null` (trapper passes `r.bidder` as is); gambler's `cupPlans` drops the two locals
  (`keepers`, `junk`) the bundle computed and never read (both pure, both still exported);
  learner's plan builder checks `best === null` before the roll scorer instead of after it (the same
  short-circuit); `brain.decide` narrows the redacted state through `hasRound` (never taken:
  `redactFor` keeps the round the host state has). gambler's memory type is `GamblerMemory | null`
  so the bundle's `memory ?? freshMemory()` stays. `net/protocol.ts` checks `die`, `cup`, `table`
  and `intoCup` with `web/shared/lib/json` leaf decoders (`integer(0, 4)`, `boolean`, `arrayOf`),
  whose acceptance matches the bundle's `Number.isInteger`/`typeof` checks for every input; the
  frame walk, `isRecord` (arrays included) and the refusal texts stay the bundle's because the
  parity suite pins them, and `json.object` is not used (its own-property rule and `'object'`
  message differ). A server frame's `state` still passes through on the shape check alone, cast to
  `PublicState`: a field-by-field decoder is deferred to step 9 or 15. The eslint PURE globs and
  `tsconfig.pure.json` already covered `bots/**` and `net/protocol.ts` (checked with
  `--print-config`); `tsconfig.web.json` no longer excludes them. Coverage thresholds: `bots/**`
  and `net/protocol.ts` at 90% lines, functions and statements (actual 100/100/97 and 100/100/100);
  one characterization test for the registry's menu helpers runs on both legs. `.prettierignore`
  still skips `/web/games/fidice/src/` whole, so the typed `.ts` there are formatted by running
  Prettier on them by hand; narrowing the ignore to the generated `.js` means reformatting four
  phase 1 domain files and is left for step 9. See ARCHITECTURE "Deviations".
- Step 9, phase 1 (`net/**`, `app/**`, `main.ts`; `view/**` follows): the five edge modules and the
  entry are typed in place (`git mv` `.js` -> `.ts`, `JS_FILE_COUNT` 12). `net/session.ts` holds the
  session-level shapes (`HostTransport`, `ClientTransport`, `SessionEvents`, `Me`) over the shared
  `Connection`, and keeps `realClock` as a re-export of `web/shared/edge/clock.ts` (the legacy
  section's one binding; `main.ts` imports the clock from the edge directly). `net/peerjs.ts` is the
  adapter over `web/shared/edge/transport.ts`: it takes a Transport factory `(ice) => Transport` and
  the ICE loader (or null) by injection, so `main.ts` constructs `realTransport({ ice, search,
  debug: 1 })` and `createIce(browserIceDeps())`; it names the ICE types through `transport.ts`
  rather than importing `ice.ts`, so the `net/` import zone is unchanged, and it joins the edge lint
  profile (`EDGES` now lists `net/{host,guest,client,session,peerjs}.ts`) because it holds the
  deferred Peer. The load-timing change: PeerJS and the ICE loader arrive with the module bundle
  (`./main.ts`, 216 KB minified) instead of as two classic `<script>`s ahead of it, so
  `index.html` drops the unpkg CDN request and `../../shared/ice.js`, defines neither `window.Peer`
  nor `window.HyperIce`, and paints without waiting on unpkg; the ICE fetch still starts when a
  table is created or joined, and the Peer is still created only once `ice.load()` resolves.
  `legacy/shared/ice.js` is still copied into dist for the legacy gin page. `expect` stays in
  `domain/result.ts` (the parity suite pins it on both legs) and `net/host.ts` imports it;
  `protocol.ts` types `You.seat` as `Seat | null` (same runtime check). The e2e hook for the ICE
  assertion is `globalThis.__peerCalls` (see ARCHITECTURE "Documented test hooks"); it records the
  argument list of each `new Peer(...)`, not the options object alone, so `e2e/fixtures/peer-calls.ts`
  decodes both pages without a branch and fidice-online keeps asserting the host's id; the smoke spec
  checks the legacy globals on gin only and, on fidice, that `window.__fidice` booted and no classic
  script was requested. The differential oracle `test/parity/fidice.sessions.test.ts` replaces the
  never-recorded wire goldens: both legs run over `transport.fake.ts` (the legacy leg with
  `globalThis.Peer`/`HyperIce` shimmed onto it), and their frames, events and final state are
  deep-equal across a full table (open, player and spectator hello, five refusals incl. two
  malformed frames, start, roll/bid/peek/pull/roll/bid/call, auto-next, token reconnect, refused
  addBot, close), lobby management, a four-bot autostart game to `over`, ICE with and without a
  relay (and the `onError` fallback), and two failures (unknown code, 12 s connect timeout); two
  legacy quirks it names: a guest closing its own session hears "The host closed the table.", and
  a wrong code reports `onClosed` twice. `tsconfig.node.json` lists the transport edge and the
  fidice pure core plus `net/` so that test imports statically. `view/types.ts` (types only, not
  in the manifest) holds `Ui`, `Intent` and friends; `app/controller.ts` binds the still-generated
  view exports to them at its import boundary (typed consts; `initialUi` alone is cast). Fidice
  used no wake lock, vibration or audio, so `fx.ts` is not wired. `tools/legacy/debundle-fidice.ts`
  treats the entry as typed when `main.ts` exists and emits the page accordingly (no classic
  scripts, `./main.ts`); the dist guards follow (dist-next/ has no ice.js load at all). The manual
  broker game and the CI two-peer run are the remaining gates for the PR body. See ARCHITECTURE
  "Deviations".
- Step 9, phase 2 (`view/**`, `assets/diceImages`): the eleven view modules and the dice images
  are typed in place (`git mv` `.js` -> `.ts`); `JS_FILE_COUNT` is 0, every `MANIFEST.json` entry
  is `typed: true`, and `tools/legacy/debundle-fidice.ts` now writes `index.html`, `theme.css` and
  the manifest only (still the audit that maps each module to its bundle lines and recovers the
  legacy import graph; `test/tools/debundle-fidice.test.ts` asserts every section is ported). The
  eslint override for the generated `.js` and the two `.prettierignore` entries are retired;
  `allowJs` stays in `tsconfig.web.json` until step 15 as planned. `view/types.ts` stays the
  types-only module (phase 1 said the types would move into `view/ui.ts`; keeping them beside
  `domain/types.ts` and `bots/types.ts` is the smaller diff); `VNode`, `Props`, `Child` and the
  `Handlers` map live in `view/vdom.ts`, whose three `target*` helpers hold the `e.target` casts
  so every handler is written against a `Readonly<Event>`. Four type-driven edits, each commented
  in place and unreachable in the bundle's states: `botConfig`'s seat title reads `ui.game` through
  an optional chain, the minimum raise is `asRank(current + 1)`, `menu`'s `titleFor` is an if-chain
  over the pending kind, and `domain/game.ts` `keepsScore`/`isOut`/`standings` accept `PublicState`
  (a `State` is one; the view calls them on redacted state). esbuild's suffixed names (`nameAt2`,
  `bidCard2`, `i2`, `p2`, `title2`) are tidied. Tests: `web/shared/edge/dom.fake.ts` is a
  structural DOM (parent, live children, attributes, bubbling listeners, the four form properties
  on the tags a browser gives them, a deterministic `serialize`); `view/vdom.test.ts` pins the
  reconciler; `view/scenarios.ts` (DOM-free, listed in `tsconfig.node.json` with `view/types.ts`,
  `view/ui.ts` and `dom.fake.ts`) builds 41 representative states through the domain itself and
  the per-screen tests beside the screens render them through `view/render.fake.ts` and pin the
  ids, classes, text and intents the e2e specs and `theme.css` rely on; the oracle
  `test/parity/fidice.view.test.ts` evaluates the page's own `src/view/*` sections (node:vm, bound
  to the pinned legacy core) beside the typed view, imported dynamically by path as the pure
  modules are (the node project has no DOM lib), and deep-equals the serialized trees and, for
  every listener of every element, the dispatched intents, `preventDefault` and `stopPropagation`;
  a re-render walk through nine states patches to the same trees on both legs. The `ui/`/`view/`
  eslint zone excepts `dom.fake.ts` as `net/` excepts `transport.fake.ts`. Coverage: `view/**` at
  90% lines, functions and statements (actual 99.6/99.6/98); as a follow-up, `net/**` and `app/**`
  are included and gated at 90% too (`app/{effects,controller}.test.ts`; actual net 95.9/93.2/92.2,
  app 99.7/98.5/99.1), `main.ts` excluded as the boot. The PeerJS load-timing change and the
  remaining gates are as phase 1 recorded. See ARCHITECTURE "Deviations".
- Step 10 (gin engine): `web/games/gin-rummy/src/engine/**` is ported from the pinned
  `test/fixtures/legacy/gin-engine.cjs`; no page imports it and dist is unchanged. Signatures that
  gained an injected parameter: `createGame(opts, rng, now)` (the legacy read `opts.rng`,
  defaulting to `Math.random`, and `Date.now()`), `dealHand(state, rng)` (rng required) and
  `applyAction(state, seat, action, rng, now)`, where `Now = () => number` is required rather than
  optional because the UI turns `startedAt` and every round's `ts` into durations. `applyAction`
  returns `Result<State, RuleError>` and never mutates; the legacy `privateCard` of a stock draw is
  `state.pendingDraw.cardId` (the parity adapter derives it). `legalActions(view)` keeps the legacy
  signature. `lastDrawn` is an optional key that appears at the first draw, as the legacy key did,
  and `dealHand` leaves it alone (the named leak, asserted on both legs and counted in the replay
  corpus). Small type-driven edits, each commented in place: three legacy TypeErrors on impossible
  states are `RuleError`s (`takeUpcard`/`drawDiscard` on an empty pile, `drawStock` on an empty
  stock), the `'Unknown phase.'` fallthrough is gone (exhaustive switch), and two dead guards of the
  DFS (`dead !== minValue` at a full mask, the `seen` signature set) are dropped since pruning and
  the canonical meld order make them unreachable and the 100% statement threshold could not be met
  with them; the meld differential is unchanged either way. `melds.algorithms.ts` imports `melds.ts`
  (not the reverse), so `bestMelding` and `allOptimalMeldings` are exported from the algorithms file
  with the DP and the DFS they wrap, and `index.ts` presents the 26 legacy names. `meldingFromGroups`
  decodes `groups` with `web/shared/lib/json` `arrayOf(arrayOf(string))`, which accepts exactly
  what the legacy `Array.isArray`/`typeof` checks did. Toolchain: `tsconfig.web.json` no longer
  excludes `engine/**`, `tsconfig.node.json` lists the gin engine so test/parity imports it
  statically, and eslint bans `Date.now` in the PURE globs and `*.algorithms.ts` (verified with
  `--print-config` and a throwaway violation). Tests: `gin.legacy.test.ts` runs both legs through
  `loadCurrentGin()` (gin.api.ts copies the returned State onto the test's object); `gin.policy.ts`
  holds the shared seeded policy; `gin.replay.test.ts` plays 1000 seeded games on both legs (one
  mulberry32 stream each, the same action choices) and compares state, both views and both
  legal-action lists after every action as JSON text with `ts`/`startedAt` masked, so key order is
  pinned too (`GIN_REPLAY_GAMES=<n>` for a quicker local run; ~53 s at 1000 on this laptop);
  `gin.melds.test.ts` compares every meld helper over 2000 seeded 10/11-card hands from three pools
  plus the node-cap truncation case (26 cards, 187 arrangements); `engine/melds.algorithms.test.ts`
  covers the memo eviction and the empty/limit edges. Coverage: `engine/**` at 90% lines, functions
  and statements (actual 99.7/99.3/98.1), `melds.algorithms.ts` at 100%. See ARCHITECTURE
  "Deviations".
- Step 10 follow-up (review findings on the engine and its oracle): `setMelds` without a `melds`
  key is refused as an unfit arrangement ("That meld arrangement doesn't fit your hand."); the
  legacy read `action.melds || []` and treated it as an empty declaration (accepted when the hand
  has no melds, else the deadwood refusal). The typed `Action` requires the key and the legacy UI
  always sends it, so step 12's protocol decoder makes that call knowingly. `gin.policy.ts`
  declares one of the view's optimal arrangements one time in ten when there is more than one, so
  the seeded corpora (the 300 characterization games and the 1000-game replay) cover `meldPref`,
  the knock with a declared arrangement, `activeMeldSig` and `me.melds` on both legs; the replay
  is `gin.replay.ts` (the driver) plus four one-line shard files `gin.replay.{1..4}.test.ts` of 250
  seeds each, asserting outcome coverage and the lastDrawn leak per shard, so vitest runs them on
  four workers (~15 s wall instead of ~55 s). `engine/index.ts` no longer re-exports the memo
  `altCache` (its test imports it from `melds.algorithms.ts`); the header names the four
  non-legacy exports. See ARCHITECTURE "Deviations".
- Step 11 (gin protocol, storage and pure UI/scorer helpers): everything ships dark under
  `web/games/gin-rummy/src/`; no page imports it and dist is unchanged. Oracles first:
  `tools/legacy/extract-gin-ui.ts` cuts the pure helpers of the two UI IIFEs function by function
  into `test/fixtures/legacy/gin-ui.cjs` (a factory over the free variables the page supplied;
  blocks cut from inside `render()` get a generated wrapper), pinned in `MANIFEST.json` with a new
  `ranges` list for multi-range fixtures; `tools/legacy/record-gin-wire.ts` records the wire corpus
  `test/fixtures/legacy/gin-wire/*.json` from 40 seeded legacy games with `Date.now` pinned (one
  file per tag, `state` split; `gin-wire.test.ts` re-records and compares); and
  `tools/legacy/capture-gin-storage.ts` drives the legacy page in headless Chromium (served through
  serve-dist aliases, PeerJS from node_modules, a local PeerServer for the broker) and dumps every
  `ginRummy*` key to `test/fixtures/legacy/gin-storage/<key>.<variant>.json`. Two saves could not
  come from the DOM alone: the host mid-hand save goes through the page's own `window.__gin` hook
  (the persist path is the page's), and the guest save is derived from `persist()` and marked so
  (both need a second peer; a live two-peer capture is CI-only and lands with step 12's
  differential net test). Shapes: `engine/decode.ts` holds the `State`, `View` and `Action`
  decoders (the engine's literal key order, so a decoded value re-encodes byte for byte) that both
  `protocol.ts` and `storage.ts` use, since the save carries a `State`; `web/shared/lib/json`
  `object()` now leaves an absent optional key out (typed optional) instead of setting `undefined`,
  and gained `record()` (own keys in input order; `__proto__`/`constructor`/`prototype` refused).
  Protocol: the join `name` must be a string of at most 20 characters (the legacy coerced and cut
  any value; a legacy guest never sends more) and a toast at most 500; `guestNameFor` is the host's
  normalisation; `decodeGuestFrame`/`decodeHostFrame` refuse the other side's tags. Storage: the
  four bare-string keys are decoded as such; garbage under `ginRummy_playMode` is refused (the
  legacy would have hidden both mode panels) and `soundEnabled` keeps `!== 'off'`; the scorer's
  `void` CSV branches are not ported (a scorer round never carries `void`); a knocker who is not a
  player is not reproduced (`NaN` in the legacy). UI: `ui/cues.ts` holds the cue machine as
  `nextCue(state, view, role)` and re-exports `fmtDuration` from `scorer/format.ts` (the CSV export
  shares it and the scorer may not import `ui/`); `ui/rules.ts` equals both legacy copies up to the
  page's indentation. `scorer/voice.ts` is the spoken-entry parser (the legacy has voice entry, not
  announcements). Toolchain: `scorer/` (except `main.ts`) joins the pure layers (`PURE` glob,
  `tsconfig.pure.json`, an import zone of its own; `protocol.ts` may not import it);
  `tsconfig.web.json` no longer excludes `protocol.ts`, `tsconfig.node.json` lists the whole gin
  `src/` tree (DOM-free by design) and `web/shared/edge/storage.ts`; coverage gates `protocol.ts`,
  `storage.ts`, `ui/**` and `scorer/**` at 90% lines, functions and statements (actual
  100/100/100). See ARCHITECTURE "Deviations".
