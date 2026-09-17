# Architecture

Target shape for this repo: two browser games (Gin Rummy, Fidice) as strict, functional
TypeScript, built by Vite, tested by vitest and Playwright, deployed to GitHub Pages by
GitHub Actions, reachable at both `https://arisweedler-at.github.io/hyperagent-web-apps/`
and `https://games.sweedler.com/`. `docs/MIGRATION.md` is the ordered path from today's
two single-file pages to this layout. The refactor is behaviour-preserving: wire messages,
peer-id prefixes, room-code alphabets, localStorage keys and rendered DOM stay identical,
and tests that prove it land before the code they protect.

## Goals

1. Small diffs: adding a game is a folder; adding a feature touches one module and its test.
2. Breakage is caught mechanically: typecheck, lint, unit, protocol, parity and two-peer e2e
   run on every push and PR, and the same typecheck+lint+unit run before every push locally.
3. Online play never regresses: the merge gate plays a real host/guest game in two browser
   contexts through a local PeerServer on both emulated origins; a real-broker game runs on
   every PR (advisory) and nightly against both live origins including a relay-forced game.
4. Engine and domain code is pure, immutable, loop-free and exception-free by tooling, not
   convention.

## Directory layout

```
.
├── package.json / .nvmrc        scripts: dev, build, preview, typecheck, lint, test, test:e2e, test:live,
│                                replay, check (= typecheck+lint+test), hooks, hooks:verify
├── tsconfig.json                solution -> tsconfig.{base,web,pure,node}.json
├── vite.config.ts               root web/, base './', input = glob web/**/index.html, legacyPassthrough plugin
├── vitest.config.ts             node env; jsdom only for *.dom.test.ts; v8 coverage thresholds
├── playwright.config.ts         projects: pages, proxy, next (hermetic); broker (real 0.peerjs.com, advisory)
├── eslint.config.js             flat config (below)
├── .githooks/{pre-commit,pre-push}   shim chaining the owner's template hook; npm run check
├── .github/workflows/{ci,nightly}.yml
├── web/                         Vite root == public URL tree
│   ├── index.html               landing page
│   ├── public/.nojekyll
│   ├── shared/                  the only code both games may import (alias @shared/*)
│   │   ├── lib/                 PURE: result, rng, json (decoders), roomCode (alphabets, prefixes, sanitiser),
│   │   │                        algorithms (the loop escape hatch), clock (types)
│   │   ├── edge/                EFFECTS: ice, transport (only importer of 'peerjs'; ?peer= override),
│   │   │                        transport.fake, clock, storage, dom, fx
│   │   ├── ui/                  RESERVED (README only): HandView slot, toast/name-entry/lobby builders, base.css
│   │   └── styles/              tokens.css (:root tokens only), CONTRACT.md (CSS<->TS class contract)
│   └── games/
│       ├── gin-rummy/           index.html (legacy markup + module script), main.ts, theme.css (legacy CSS), src/
│       │   └── src/             engine/ (types, cards, melds, melds.algorithms, layoff, game, view, index),
│       │                        protocol.ts, storage.ts, net/{host,guest}.ts, ui/{state,render,cards,cues,fit,
│       │                        local,home,rules}.ts, ui/hand/{HandView,meldGroups}.ts, scorer/{scores,voice,csv,main}.ts
│       └── fidice/              index.html, main.ts, theme.css, src/ = the 38 modules at their // src/<path>.ts
│                                marker paths (assets, domain (+probability.algorithms), bots, net, view, app)
├── legacy/                      MIGRATION ONLY: verbatim pages + shared/ice.js, copied into dist by the plugin
├── test/                        fixtures/legacy (sha256-pinned .cjs cores), goldens/ (JSON files < 100 KB each),
│                                parity/ (describe.each([legacy, current])), dist/ (asset-urls, check-dist-paths,
│                                class-contract)
├── e2e/                         Playwright specs + fixtures/two-players.ts
├── tools/                       serve-dist, proxy-dev, replay-goldens, legacy/{extract,debundle,record}-*
└── infra/                       games-proxy/ (mapPath exported, UPSTREAM from env), turn-worker/ (unchanged)
```

`dist/` is gitignored. The repo root holds no HTML once `web/` exists.

## Module boundaries and contracts

Enforced by `eslint-plugin-import-x` `no-restricted-paths` zones, `import-x/no-cycle`, and
`tsconfig.pure.json`, which compiles `**/engine`, `**/domain`, `**/bots`, `web/shared/lib` and
both `protocol.ts` files with `lib: ["ES2023"]` and no DOM, so `window`, `document` and
`HTMLElement` are unnameable there by the compiler.

| Layer | May import | Contract |
|---|---|---|
| `web/shared/lib` | itself | Leaf modules. `Result<T,E>` (`ok/err/map/andThen`), `Rng = () => number`, `mulberry32`, JSON decoders, `roomCode` constants (`'ginrummy-ari-'`, `'fidice-'`, alphabets). |
| `engine` / `domain` / `bots` | shared/lib, siblings | Pure. `applyAction(state, seat, action, rng): Result<State, RuleError>` (gin), `apply(s, actor, action, rng): Result` (fidice). Return new state; never mutate. `viewFor` / `redactFor` are the only redaction. |
| `protocol.ts` | engine/domain types, shared/lib | Trust boundary. Every inbound frame passes a decoder returning `Result`; outbound frames are built here. Shapes frozen by wire goldens; a future change adds a version field here. |
| `net/` | protocol, engine/domain, `@shared/edge/transport`, `@shared/edge/clock` | Never imports `peerjs`. `Transport`, `Clock`, `Rng`, `NewId` are injected so protocol tests run on `transport.fake.ts`. |
| `ui/` / `view/` | engine/domain types, shared/lib, `@shared/edge/dom` | Render a view to strings/VNodes; DOM writes only in `render.ts` / `vdom.ts`. `HandView { render(model, selection): string }` is the only way a hand is drawn. |
| `storage.ts` / `app/effects.ts` | shared/lib, `@shared/edge/storage` | Only modules that touch localStorage; every read goes through a decoder. |
| `ui/state.ts` / `app/controller.ts` | everything below | Reducer over intents; imported only by `main.ts` and tests. |
| `main.ts` | everything | Constructs adapters (PeerJS, Web Audio, storage, clock, `Math.random`). No logic. Module scripts are deferred, so it boots directly. |
| `*.algorithms.ts` | shared/lib | The only files where loops, `let` and local mutation are allowed. Pure, functions only, 100% line coverage, and each export carries a comment saying why the functional form is unfit (hot DP, node-capped DFS, cartesian enumeration). |

Games never import each other. `infra/` shares only the pure `mapPath()` with tests.

Documented test hooks that are part of the contract: `window.__gin`, `window.__fidice`,
`window.__rng` (a seeded rng installed before boot), `?peer=host:port` (PeerServer override),
`?ice=<url>` (ICE config override).

## Build and serve

Vite 6, `root: 'web'`, `base: './'`, `build.outDir: '../dist'`, `build.target: 'es2022'`,
`build.sourcemap: true`, `modulePreload.polyfill: false`. `rollupOptions.input` is a glob of
`web/**/index.html`, so a new game is picked up by its folder. Output naming keeps each page
self-contained where Rollup allows it and puts anything shared where the proxy already maps it:
`entryFileNames: 'games/[name]/app-[hash].js'` (landing: `app-[hash].js`),
`chunkFileNames` and `assetFileNames`: `'shared/assets/[name]-[hash][extname]'`.
`peerjs@1.5.4` is pinned exactly and bundled from npm; the CDN loaders and `typeof Peer`
polling disappear at each game's cutover.

`legacyPassthrough` (a 30-line plugin in `vite.config.ts`) copies `legacy/<g>/index.html` and
`legacy/shared/ice.js` into `dist` after the bundle for every page listed in `LEGACY_PAGES`,
overwriting Vite's output for that path. Cutting a page over is deleting it from that list and
deleting its legacy file; rollback is reverting that commit. The e2e `next` project builds
with `LEGACY_PAGES=` so a ported page is exercised end-to-end before it is flipped.

Deploy: `.github/workflows/ci.yml` job `deploy` runs only on push to `main`, `needs: [check, e2e]`,
`permissions: {contents: read, pages: write, id-token: write}`, `concurrency: {group: pages}`,
steps `actions/configure-pages@v5`, `actions/upload-pages-artifact@v3 {path: dist}`,
`actions/deploy-pages@v4`, and prints both served URLs in the job summary. One-time console
setting: Settings > Pages > Source = GitHub Actions. Nothing generated is committed.

## Two origins

Every URL Vite writes is document-relative because `base` is `'./'`. From
`/hyperagent-web-apps/games/fidice/` a page requests `./app-x.js` and `../../shared/assets/y.js`;
from `/fidice/` on games.sweedler.com the same strings resolve to `/fidice/app-x.js` (mapped by
the Worker's catch-all to `/hyperagent-web-apps/games/fidice/app-x.js`) and `/shared/assets/y.js`
(mapped by its `/shared/` rule). No JS computes a base path; share links already use
`location.origin + location.pathname`. Nothing may be emitted to a root `/assets/`. Guards:

1. `test/dist/asset-urls.test.ts`: every `src`/`href`/`url()` in dist HTML and CSS is
   `./`-relative, `../../shared/`-relative or `https://`; never `/`-rooted.
2. `test/dist/check-dist-paths.test.ts`: resolves each reference against both bases, feeds the
   proxy-origin path through `mapPath()` exported from `infra/games-proxy/worker.js`, and asserts
   the target exists in dist.
3. `no-restricted-syntax` bans string literals starting with `/hyperagent-web-apps` or `/shared`.
4. Playwright runs every spec on project `pages` (`tools/serve-dist.ts`, dist mounted at
   `/hyperagent-web-apps/` on :4173) and project `proxy` (`tools/proxy-dev.ts` on :8787 running the
   real `worker.js` fetch handler with `UPSTREAM=http://127.0.0.1:4173`).

localStorage stays per-origin (unchanged). Peer ids are origin-independent, so a github.io host
and a games.sweedler.com guest still meet on the broker.

## Enforcement toolchain

### tsconfig.base.json

`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`,
`noPropertyAccessFromIndexSignature`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`,
`isolatedModules`, `noImplicitReturns`, `noUnusedLocals`, `noUnusedParameters`,
`allowUnreachableCode: false`, `allowUnusedLabels: false`, `useUnknownInCatchVariables`,
`forceConsistentCasingInFileNames`, `module: ESNext`, `moduleResolution: Bundler`,
`allowImportingTsExtensions` (imports use explicit `.ts` specifiers so `node --experimental-strip-types`
can run `tools/*.ts` unchanged), `target: ES2022`, `lib` per project (web: ES2023+DOM+DOM.Iterable;
pure: ES2023; node: ES2023 + `types: ["node"]`), `noEmit`, `skipLibCheck`. During migration only:
`allowJs: true, checkJs: false` in `tsconfig.web.json`, removed in the last step; a ratchet test
asserts the count of `.js` files under `web/` never increases.

### eslint.config.js

Base for all `.ts`: `tseslint.configs.strictTypeChecked` + `stylisticTypeChecked` with
`parserOptions.projectService`. Added: `@typescript-eslint/no-explicit-any: error`,
`switch-exhaustiveness-check: [error, {requireDefaultForNonUnion: true}]`,
`consistent-type-definitions: [error, 'type']`, `no-non-null-assertion: error`,
`explicit-module-boundary-types: error`, `consistent-type-imports: error`; core
`prefer-const`, `no-var`, `no-param-reassign: [error, {props: true}]`.

`no-restricted-syntax: error` entries: `ForStatement`, `ForInStatement`, `ForOfStatement`,
`WhileStatement`, `DoWhileStatement` ("no raw loops: use map/filter/reduce/flatMap/Array.from or
a named algorithm in *.algorithms.ts"); `TSEnumDeclaration`, `TSParameterProperty`,
`TSModuleDeclaration` (unsupported by Node type stripping, and enums are not erasable);
`LabeledStatement`; `Literal[value=/^\/(hyperagent-web-apps|shared)\//]` ("no absolute site paths");
`MemberExpression[object.name=Math][property.name=random]` outside `main.ts` and `web/shared/edge`
("inject Rng").

`eslint-plugin-functional` v7. ON everywhere under `web/`: `no-loop-statements` (redundant with
the syntax ban on purpose: two messages, one intent), `no-let: [error, {allowInForLoopInit: false}]`,
`immutable-data: [error, {ignoreImmediateMutation: true, ignoreClasses: false}]` (lets
`[...xs].sort()` through), `prefer-immutable-types` (`ReadonlyShallow` for parameters,
`None` for return types and variables to keep inference readable), `type-declaration-immutability`
(`ReadonlyShallow`, `AtLeast`, all identifiers), `prefer-property-signatures`, `readonly-type: generic`.
ON only in pure dirs (`engine`, `domain`, `bots`, `web/shared/lib`, both `protocol.ts`):
`no-throw-statements`, `no-try-statements`, `no-classes`, `no-this-expressions`,
`no-expression-statements: [error, {ignoreVoid: true}]` (warn until the tightening step, tracked by
a ratchet on the warning count), `no-return-void`. OFF with reasons: `no-conditional-statements`
(the owner asked for no raw loops, not no branches; early returns beat nested ternaries in
reducers), `functional-parameters` (bans zero-arity thunks that DOM callbacks need),
`prefer-tacit` (collides with `unbound-method`, hurts stack traces), `no-mixed-types` (VNode and
deps records mix data and callbacks legitimately), `no-promise-reject` (ICE and transport loaders
reject). Overrides: `**/*.algorithms.ts` turns off the loop ban, `no-let`, `immutable-data`,
`prefer-immutable-types`; edges (`main.ts`, `**/app/**`, `**/net/{host,guest,client,session}.ts`,
`**/view/vdom.ts`, `web/shared/edge/**`) keep the loop ban and readonly types but turn off
`no-classes`, `no-this-expressions`, `no-let`, `immutable-data`, `no-expression-statements`,
`no-return-void`, `no-throw-statements`, `no-try-statements`; `**/*.test.ts`, `e2e/**`, `tools/**`
get `strictTypeChecked` only plus `no-console: off`; `legacy/**` and `test/fixtures/legacy/**` are
ignored. `eslint-plugin-import-x`: `no-restricted-paths` zones per the table above, `no-cycle`.
`eslint-config-prettier` last; Prettier formats. Lint runs with `--max-warnings 0` except the
tracked `no-expression-statements` warnings during migration.

### Git hooks

Plain files under `.githooks/`, installed by `npm run hooks` (= `git config core.hooksPath .githooks`),
also wired as the `prepare` script so `npm ci` installs them. No husky, no lefthook: both flip
`core.hooksPath` or overwrite `.git/hooks/*`, and the owner's template pre-commit must keep running.
Verified on git 2.55 in this repo: with `core.hooksPath` set, `git rev-parse --git-path hooks`
returns `.githooks`, so the shim must use `--git-dir`:

```sh
#!/bin/sh
# .githooks/pre-commit: chain the template hook (big-file + trailing-whitespace checks).
t="$(git rev-parse --git-dir)/hooks/pre-commit"
[ -x "$t" ] && exec "$t" "$@" </dev/tty
exit 0
```

`exec` with `/dev/tty` on stdin because the template hook uses `read -n 1` prompts.
`.githooks/pre-push` runs `npm run check` (typecheck, lint, unit; same commands as CI job `check`)
and prints `npm ci` if `node_modules` is missing. `npm run hooks:verify` fails if `core.hooksPath`
is not `.githooks` or `.git/hooks/pre-commit` is missing, and runs in CI as a repo-local sanity check
of the shim script itself (`sh -n`).

### GitHub Actions

`ci.yml` on `push` and `pull_request`. Job `check`: checkout, `setup-node@v4 {node-version-file:
.nvmrc, cache: npm}`, `npm ci`, `npm run typecheck` (`tsc -b`), `npm run lint` (eslint + prettier
--check), `npm test -- --coverage`, `npm run build`, dist tests, upload `dist`. Job `e2e` (needs
check): download dist, `npx playwright install --with-deps chromium`, `npm run test:e2e`
(projects pages + proxy + next; PeerServer from the `peer` package on :9000; retries 1; trace on
first retry; report uploaded). Job `broker` (needs check, `continue-on-error: true`): the two-peer
specs without `?peer=` through 0.peerjs.com, so signalling regressions surface at review without
blocking on a third party. Job `deploy` as above. Branch protection on `main` requires `check` and
`e2e`. Installs in every job use the composite action `.github/actions/npm-ci`. The owner's npm registry is
Airtable's Socket Firewall in registry mode, so `package-lock.json` records that host in every
`resolved` URL and is committed exactly as written; it is never rewritten. Runners cannot
authenticate to the firewall, so the action sets npm's `replace-registry-host=always`, which makes
`npm ci` fetch each entry from the runner's configured (public) registry while still verifying the
lockfile's integrity hashes, and wraps the install in Socket Firewall Free (`sfw npm ci`) so CI
installs are scanned too. `nightly.yml` runs the online specs against both live origins through the real broker and
`turn.sweedler.com`, plus one game with `iceTransportPolicy: 'relay'` forced via `?ice=`, and opens
or updates a pinned issue on failure.

## Testing pyramid

1. Unit (vitest, colocated `*.test.ts`): engine/domain table tests (the 22-deadwood two-arrangement
   hand, chained 6S/10S/QS layoff, every `applyAction` branch, tie-at-target -> seat 0; the 252-row
   ladder, `apply` phase gates, `redactFor`, `survivalFor` spot values, every strategy's `decide()`
   over seeded views), property tests via `legalActions` (300 seeded games: 52-card conservation,
   hand sizes 10/11, totals monotone, termination), pure UI helpers, scorer maths, `ice.ts` with a
   fetch parameter. Coverage: 90% lines on engine/domain/bots, 100% on `*.algorithms.ts` (with
   direct tests of the 300k node cap and the 400-entry cache eviction).
2. Protocol: decoders reject malformed and hostile frames (wrong `t`, out-of-range rank/die,
   oversized names, prototype-pollution keys) with the strings fidice already echoes; wire goldens
   recorded from the legacy pages decode AND re-encode byte-for-byte after `ts` masking; host/guest
   sessions over `transport.fake.ts` + `fakeClock` replay every recorded sequence; frozen-constant
   tests for prefixes, alphabets, storage keys and `t` tags.
3. Parity (permanent): `describe.each([['legacy', gin-engine.cjs], ['current', engine]])` runs the
   same assertions on both; 1000 seeded gin games and 200 seeded fidice games replay through both
   with state and views deep-equal (known defects preserved and named); DOM-snapshot parity
   (normalised innerHTML of `#hand`, `#actions`, `#statusBanner`, `#oppCards`, `#rrBody`, `#app` over
   ~60 recorded views); computed-style goldens (~60 selectors at 390x844 and 1280x800) recorded
   before any CSS moves; a seeded 3-bot fidice game log golden. `npm run replay`
   (`node --experimental-strip-types tools/replay-goldens.ts`) runs the replays without npm.
4. E2E (Playwright, two contexts, Chromium with `--disable-features=WebRtcHideLocalIpsWithMdns
   --no-first-run`, `window.__rng` seeded via `addInitScript`): gin online (join, deal, scripted
   turns, both DOMs agree, host reload -> resume, guest rejoin), gin local (curtain to a knock),
   gin scorer (CSV blob), fidice online (lobby, hello, seeded bots, redaction, spectator), fidice
   bots to `over`; smoke on every page: zero uncaught exceptions, zero failed requests outside an
   allowlist, and the Peer constructor received the `?ice=` config. Visual `toHaveScreenshot`
   baselines captured on the CI runner from the legacy pages.

## Conventions for small diffs

- New game: `web/games/<g>/{index.html, main.ts, theme.css, src/}` plus tests; nothing in `web/shared`
  changes. Vite picks up the folder; the proxy needs no change; e2e gets one spec per mode.
- New rule or action: add the variant to the `Action` union in `engine/types.ts`, the reducer branch
  in `game.ts` (exhaustiveness check fails until every switch handles it), the codec case in
  `protocol.ts`, a table test and a recorded golden. Wire-visible changes add a version field.
- New screen or CSS class: add it to `CONTRACT.md`; `class-contract.test.ts` fails when a class
  toggled in TS has no CSS rule or vice versa.
- Behaviour change: a PR that flips a golden says so in its body and touches only that golden.
- Anything needing a loop goes into the game's `*.algorithms.ts` with a reason comment and a test.

## Seams reserved for the roadmap (not implemented now)

- Shared design tokens / UI kit: `web/shared/styles/tokens.css` (nearly empty now; the two games'
  `:root` blocks disagree on `--felt`) and `web/shared/ui/` (README only). The Fidice restyle maps
  its palette onto shared token names in `theme.css`, then moves screen builders into `shared/ui`;
  computed-style goldens and the class contract gate it.
- Swappable hand display: `ui/hand/HandView.ts` is the interface `render.ts` consumes; a new view is
  a second module and a `main.ts` choice, gated by DOM-snapshot parity of the default.
- Phone layout stability: `ui/fit.ts` isolates `nextScale()` as a pure function over measured sizes
  so the layout-thrash loop can be replaced without touching `render.ts`.
- Generic host/client session and code-entry/toast/lobby builders: extracted from fidice's
  `HostSession`/`ClientSession` into `web/shared` only after both games are typed and parity-locked,
  behind the existing wire goldens.

## Deviations (recorded as the steps land)

Step 1 (toolchain scaffold), against the versions on the registry at the time:

- TypeScript is pinned at 5.9.3, not 7.x: typescript-eslint 8.70 accepts `typescript >=4.8.4 <6.1.0`.
  Vite is 8.3.0 (Rolldown) and vitest 5.0.0; the `rollupOptions` key names are verified in step 4.
- `@eslint/js` is an extra exact devDependency: ESLint 10 no longer bundles it, and it supplies the
  core `recommended` rules for the JS-only config on `infra/**/*.js`.
- `@typescript-eslint/array-type` is set to `{default: 'array', readonly: 'generic'}` so it agrees
  with `functional/readonly-type: generic`; the stylistic default (`readonly T[]`) contradicts it.
- `import-x/extensions` is set to include `.ts`: without it ExportMap follows only `.js` dependencies
  and `no-cycle` stays silent on a TypeScript cycle (verified with a throwaway lib/edge cycle).
- `tsconfig.web.json` also includes `web/shared/lib` (the pure project remains the guard) so the
  project never has zero inputs before the first DOM module lands.
- `npm run hooks:verify` treats a missing `.git/hooks/pre-commit` as a failure locally and as a
  note under `CI`, since CI checkouts have no template hook.
- `package-lock.json` is lockfileVersion 3 (112 KB); the npm 8 default v2 file was 192 KB, above the
  template hook's 150 KB prompt. npm 8.4.1 `npm ci` reads it unchanged.
- The proxy Worker compares redirect `Location` hosts against the configured upstream host rather
  than the literal GitHub host; identical for the default, and correct for `tools/proxy-dev.ts`.

Step 1 follow-up (review findings on the scaffold):

- The pure layer names fidice's protocol at `web/games/*/src/net/protocol.ts` too (MIGRATION step 8
  puts it at `net/protocol`): the PURE lint glob, `tsconfig.pure.json` include, `tsconfig.web.json`
  exclude and the protocol zone all list both paths; the `net/` zone targets `net/!(protocol).ts`.
- `ui/state.ts` and `app/controller.ts` have their own zone ("everything below": only
  `web/shared/edge/**` and `main.ts` are forbidden); the `ui/`/`view/` zone targets `ui/!(state).ts`.
- `functional/no-expression-statements` is `error` now, not `warn`: with `--max-warnings 0` a warning
  already failed lint, and no pure module exists to ratchet. Step 8 may reintroduce `warn` behind a
  ratchet on the count if the ported code needs it.
- `.prettierignore` anchors the root-only entries (`/index.html`, `/games/`, `/shared/`, `/legacy/`);
  unanchored `shared/` and `games/` also matched `web/shared/**` and `web/games/**`, so Prettier
  skipped the whole new tree.
- The pre-commit shim and `hooks:verify` use `git rev-parse --git-common-dir`, not `--git-dir` as
  written above: in a linked worktree `--git-dir` is `.git/worktrees/<name>`, which has no `hooks/`,
  so the template hook silently stopped running there. Both print `.git` in a normal checkout.

Step 2 (freeze legacy and record goldens):

- Executable oracles instead of recorded goldens. The legacy cores live in the repo as sha256-pinned
  fixtures, so the parity suites recompute legacy behaviour at test time over seeded inputs
  (`mulberry32`) and there is no `tools/legacy/record-*.ts` and no `test/goldens/` yet. Goldens are
  reserved for what node cannot recompute: wire frames captured via CDP and DOM/computed-style
  snapshots land with the Playwright harness in step 3. Suites are `describe.each` over
  `[['legacy', fixture]]`; steps 6 and 10 add the `current` leg without rewriting them.
- `test/fixtures/legacy/manifest.test.ts` sits beside the fixtures and is linted, type-checked and
  formatted, so the ignores narrowed from `test/fixtures/legacy/**` to `test/fixtures/legacy/*.cjs`
  (eslint.config.js, tsconfig.node.json, .prettierignore). MANIFEST.json records page, fixture, tool,
  1-based line range, sha256 of the page range and sha256 of the fixture.
- The `*.algorithms.ts` override also turns off `functional/no-expression-statements`: the rule
  flags `a = step(a)` (verified on `web/shared/lib/rng.algorithms.ts`), so "local mutation" was not
  in fact allowed there. `mulberry32` lives in `rng.algorithms.ts` and `rng.ts` re-exports it next to
  `type Rng`.
- The fidice fixture is the bundle from `"use strict"` through the `domain/search.ts` section
  (lines 371-2333, 109 KB, under the 140 KB ceiling without splitting). `net/client.ts`, `net/host.ts`,
  `net/peerjs.ts` and `net/session.ts` are inside that range and come along; they touch
  `globalThis.Peer` and `HyperIce` only inside functions, so the fixture loads without a DOM. The
  export line is generated from every top-level `var` of the range (299 names) rather than
  hand-listed, so nothing the tests may need is missing.
- The fidice page edit is two lines, not ~30: `HostSession` already takes `rng` by injection, so
  `rng: globalThis.__rng ?? Math.random` and `window.__fidice = { controller }` in `boot()` suffice.
  Guests keep `Math.random` (only the host rolls dice).
- The seeded gin play in `test/parity/gin.legacy.test.ts` is not uniform over `legalActions`: a
  uniform policy almost never knocks, every hand ends void when the stock runs out, void hands score
  nothing and the target is never reached. It knocks whenever legal and discards the least-deadwood
  card three times in four; every choice is still an element of `legalActions(view)`. 300 games take
  about three seconds.

Step 3 (two-peer e2e against the legacy pages):

- Playwright is 1.63.0 and the PeerServer is `peer` 1.0.2, both exact. The PeerServer runs from
  the package's `peerjs` CLI as a `webServer` entry (`--host 127.0.0.1 --port 9000 --path /`);
  `E2E_BROKER=cloud` leaves it out and drops `?peer=` so the `broker` job meets on 0.peerjs.com.
- `tools/serve-dist.ts` takes `--base` and `--alias` on the command line instead of hard-coding
  `/hyperagent-web-apps/`: the lint ban on absolute site paths applies to tools too, and the one
  place the harness names the mount point is `e2e/fixtures/site.ts`.
- `tsconfig.node.json` sets `allowJs` and lists `infra/games-proxy/worker.js` so
  `tools/proxy-dev.ts` imports the Worker's default export with the types its JSDoc declares;
  `checkJs` stays off (the JS lint config covers it).
- Page-side harness code (`e2e/browser/*.js`: seeded `Math.random`, the Peer recorder) is plain
  JavaScript injected with `addInitScript`, and specs read page state through locators and string
  `page.evaluate` expressions, so the node project keeps `lib: ["ES2023"]` with no DOM types.
- The harness is offline: the pages' CDN request for `peerjs@1.5.4/dist/peerjs.min.js` is
  fulfilled from the identical bundle pinned in `node_modules` (same sha256) and Google Fonts with
  an empty stylesheet; the smoke allowlist is therefore just `favicon.ico`.
- Each browser context's seed is a hash of project, test title and role, so host and guest differ,
  and the same spec on `pages` and `proxy` never holds the same room code on the broker at once.
- `tools/serve-dist.ts` and `tools/proxy-dev.ts` have node-level tests in `test/tools/` (routing,
  slash redirects, CORS, the Worker's redirect rewriting, byte-identical bodies through the proxy).
