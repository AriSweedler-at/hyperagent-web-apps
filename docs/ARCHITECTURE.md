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
├── package.json / .nvmrc        scripts: build, preview, serve, proxy:dev, typecheck, lint, lint:fix, format,
│                                test, test:watch, test:dist, test:integration, test:e2e, test:live,
│                                check (= typecheck+lint+test+build+test:dist), fixtures:*, debundle:fidice,
│                                hooks, hooks:verify (README "Develop" has the table)
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
│   │   ├── ui/                  RESERVED (README only): HandView slot, toast/name-entry/lobby builders
│   │   └── styles/              tokens.css (:root tokens only), base.css (shared primitives), CONTRACT.md
│   │                            (CSS<->TS class contract + the two palettes' token table); both pages link them
│   └── games/
│       ├── gin-rummy/           index.html (legacy markup + module script), main.ts, theme.css (legacy CSS), src/
│       │   └── src/             engine/ (types, cards, melds, melds.algorithms, layoff, game, view, index),
│       │                        protocol.ts, storage.ts, net/{host,guest}.ts, ui/{state,render,cards,cues,fit,
│       │                        local,home,rules}.ts, ui/hand/{HandView,meldGroups}.ts, scorer/{scores,voice,csv,format,main}.ts
│       └── fidice/              index.html, main.ts, theme.css, src/ = the 38 modules at their // src/<path>.ts
│                                marker paths (assets, domain (+probability.algorithms), bots, net, view, app)
├── legacy/                      MIGRATION ONLY: verbatim pages + shared/ice.js, copied into dist by the plugin
├── test/                        fixtures/legacy (sha256-pinned .cjs cores), goldens/ (JSON files < 100 KB each),
│                                parity/ (describe.each([legacy, current])), dist/ (asset-urls, check-dist-paths,
│                                class-contract)
├── e2e/                         Playwright specs + fixtures/two-players.ts
├── tools/                       serve-dist, proxy-dev, replay-goldens, legacy/{extract,debundle,record}-*
└── infra/                       games-proxy/ (worker.ts: mapPath exported, UPSTREAM from env), turn-worker/ (plain JS, unchanged)
```

`dist/` is gitignored. The repo root holds no HTML once `web/` exists.

## Module boundaries and contracts

Enforced by `eslint-plugin-import-x` `no-restricted-paths` zones, `import-x/no-cycle`, and
`tsconfig.pure.json`, which compiles `**/engine`, `**/domain`, `**/bots`, `web/shared/lib`,
both `protocol.ts` files and `scorer/` (except `scorer/main.ts`) with `lib: ["ES2023"]` and no
DOM, so `window`, `document` and `HTMLElement` are unnameable there by the compiler.

| Layer | May import | Contract |
|---|---|---|
| `web/shared/lib` | itself | Leaf modules. `Result<T,E>` (`ok/err/map/andThen`), `Rng = () => number`, `mulberry32`, JSON decoders, `roomCode` constants (`'ginrummy-ari-'`, `'fidice-'`, alphabets). |
| `engine` / `domain` / `bots` | shared/lib, siblings | Pure. `applyAction(state, seat, action, rng): Result<State, RuleError>` (gin), `apply(s, actor, action, rng): Result` (fidice). Return new state; never mutate. `viewFor` / `redactFor` are the only redaction. |
| `protocol.ts` | engine/domain types, shared/lib | Trust boundary. Every inbound frame passes a decoder returning `Result`; outbound frames are built here. Shapes frozen by wire goldens; a future change adds a version field here. |
| `scorer/` (not `main.ts`) | engine types, shared/lib, siblings | Pure maths under the pure profile: the Score Counter's `computeRoundScores`, standings, voice parser, CSV text and `fmtDuration` (which `ui/cues.ts` re-exports). `scorer/main.ts` is its screen, an edge. |
| `net/` | protocol, engine/domain, `@shared/edge/transport`, `@shared/edge/clock` | Never imports `peerjs`. `Transport`, `Clock`, `Rng`, `NewId` are injected so protocol tests run on `transport.fake.ts`. |
| `ui/` / `view/` | engine/domain types, shared/lib, `@shared/edge/dom` | Render a view to strings/VNodes; DOM writes only in `render.ts` / `vdom.ts`. `HandView { render(model, selection): string }` is the only way a hand is drawn. |
| `storage.ts` / `app/effects.ts` | shared/lib, `@shared/edge/storage` | Only modules that touch localStorage; every read goes through a decoder. |
| `ui/state.ts` / `app/controller.ts` | everything below | Reducer over intents; imported only by `main.ts` and tests. |
| `main.ts` | everything | Constructs adapters (PeerJS, Web Audio, storage, clock, `Math.random`). No logic. Module scripts are deferred, so it boots directly. |
| `*.algorithms.ts` | shared/lib | The only files where loops, `let` and local mutation are allowed. Pure, functions only, 100% line coverage, and each export carries a comment saying why the functional form is unfit (hot DP, node-capped DFS, cartesian enumeration). |

Games never import each other. `infra/` shares only the pure `mapPath()` with tests.

Documented test hooks that are part of the contract: `window.__gin`, `window.__fidice`,
`window.__rng` (a seeded rng installed before boot), `?peer=host:port` (PeerServer override),
`?ice=<url>` (ICE config override), `?ice-policy=relay` (port-only: `iceTransportPolicy: 'relay'`
inside the Peer `config`, for the nightly's relay-forced game), and `globalThis.__peerCalls`:
`web/shared/edge/transport.ts`
pushes the arguments of every `new Peer(...)` it makes (`[id, options]` for a host, `[options]` for
a guest, `options` the exact object handed to PeerJS) onto that array, creating it if absent, so a
page that no longer exposes `window.Peer` can still be checked for the ICE config and broker
override it used (the same shape `e2e/browser/record-peer.js` records for the legacy pages).

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

A cut-over page is an unhashed `index.html` referencing hashed sub-resources, both origins send
`cache-control: max-age=600` on it, and `emptyOutDir: true` removes the previous hashes on every
build. A deploy that changes a page's hash (the rollback revert included) therefore leaves a viewer
with the cached page requesting an `app-[hash].js` that 404s, an empty page, for up to 10 minutes
until they reload. A self-contained legacy page has no such window.

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
   proxy-origin path through `mapPath()` exported from `infra/games-proxy/worker.ts`, and asserts
   the target exists in dist.
3. `no-restricted-syntax` bans string literals starting with `/hyperagent-web-apps` or `/shared`.
4. Playwright runs every spec on project `pages` (`tools/serve-dist.ts`, dist mounted at
   `/hyperagent-web-apps/` on :4173) and project `proxy` (`tools/proxy-dev.ts` on :8787 running the
   real `worker.ts` fetch handler with `UPSTREAM=http://127.0.0.1:4173`).

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
pure: ES2023; node: ES2023 + `types: ["node"]`), `noEmit`, `skipLibCheck`. No project sets
`allowJs`: the migration-only `allowJs: true, checkJs: false` (in `tsconfig.web.json` for the
de-bundled fidice modules, in `tsconfig.node.json` for the games-proxy Worker) left in step 15, when
the Worker became `infra/games-proxy/worker.ts`; `test/ratchet.test.ts` asserts that no `.js`
file exists under `web/` (it ratcheted the count down to zero during the migration).

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

`eslint-plugin-functional` v7. ON everywhere under `web/` and in `infra/games-proxy/`: `no-loop-statements` (redundant with
the syntax ban on purpose: two messages, one intent), `no-let: [error, {allowInForLoopInit: false}]`,
`immutable-data: [error, {ignoreImmediateMutation: true, ignoreClasses: false}]` (lets
`[...xs].sort()` through), `prefer-immutable-types` (`ReadonlyShallow` for parameters,
`None` for return types and variables to keep inference readable), `type-declaration-immutability`
(`ReadonlyShallow`, `AtLeast`, all identifiers), `prefer-property-signatures`, `readonly-type: generic`.
ON only in pure dirs (`engine`, `domain`, `bots`, `web/shared/lib`, both `protocol.ts`):
`no-throw-statements`, `no-try-statements`, `no-classes`, `no-this-expressions`,
`no-expression-statements: [error, {ignoreVoid: true}]` (`error` from step 1 on: with
`--max-warnings 0` a warning fails lint anyway, and no ratchet on a warning count was ever needed),
`no-return-void`. OFF with reasons: `no-conditional-statements`
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
`eslint-config-prettier` last; Prettier formats. Lint runs with `--max-warnings 0`: every rule
above is `error` or `off`, nothing is a warning.

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
authenticate to the firewall, so the action rewrites the runner's checked-out copy of the lockfile
to the public registry (host and the firewall's `/npm/` path prefix; npm's `replace-registry-host`
swaps only the hostname), installs through Socket Firewall Free (`sfw npm ci`) so CI installs are
scanned too, and restores the pristine lockfile afterwards. The lockfile's integrity hashes are
verified against what is downloaded either way. `nightly.yml` (`cron 23 9 * * *` and
`workflow_dispatch`; by hand `gh workflow run nightly.yml`) runs `npm run test:live`
(`E2E_TARGET=live E2E_BROKER=cloud playwright test --grep "@online|@relay"`, no build): the online
specs against both live origins through the real broker and `turn.sweedler.com`, plus one gin game
with `iceTransportPolicy: 'relay'` forced via the `?ice-policy=relay` hook (`e2e/gin-relay.spec.ts`;
hermetic runs skip that game and assert only that the hook reaches `new Peer`). On failure it
uploads the report and comments the run URL on the open issue labelled `nightly`, creating
"Nightly live run failed" when none is open; a green run closes it.

## Testing pyramid

1. Unit (vitest, colocated `*.test.ts`): engine/domain table tests (the 22-deadwood two-arrangement
   hand, chained 6S/10S/QS layoff, every `applyAction` branch, tie-at-target -> seat 0; the 252-row
   ladder, `apply` phase gates, `redactFor`, `survivalFor` spot values, every strategy's `decide()`
   over seeded views), property tests via `legalActions` (300 seeded games: 52-card conservation,
   hand sizes 10/11, totals monotone, termination), pure UI helpers, scorer maths, `ice.ts` with a
   fetch parameter. Coverage (`vitest.config.ts` thresholds, ratcheted in step 15 from the measured
   numbers: lines, functions and statements 5 points under measured wherever that beat the former
   90% floor by 8 or more, branches 3 points under, nothing lowered): 100% on `web/shared/lib` and
   on both `*.algorithms.ts` (with direct tests of the 300k node cap and the 400-entry cache
   eviction; branches 84% on fidice's, 97% on gin's); lines/functions/statements 94-95% on the gin
   engine, the fidice domain and view, the gin ui/, net/ and scorer maths, the gin protocol, storage
   and fx, the shared edges and the games-proxy Worker; 92-93% on the fidice bots; 90% on the
   fidice net/ sessions; branches 81-97% per group. The unit suites are seeded, so the figures are
   deterministic.
2. Protocol: decoders reject malformed and hostile frames (wrong `t`, out-of-range rank/die,
   oversized names, prototype-pollution keys) with the strings fidice already echoes; wire goldens
   recorded from the legacy pages decode AND re-encode byte-for-byte after `ts` masking; host/guest
   sessions over `transport.fake.ts` + `fakeClock` replay every recorded sequence; frozen-constant
   tests for prefixes, alphabets, storage keys and `t` tags.
3. Parity (permanent): `describe.each([['legacy', gin-engine.cjs], ['current', engine]])` runs the
   same assertions on both; 1000 seeded gin games and 12 seeded fidice bot games replay through both
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

- New game: `web/games/<g>/{index.html, main.ts, theme.css, src/}` plus tests, a coverage entry,
  `CONTRACT.md` rows and its name in the harness lists (`GAMES`, `PAGES`); nothing in `web/shared`
  changes. Vite picks up the folder; the proxy needs no change; e2e gets one spec per mode. The
  README's "Add a game" is the step-by-step version.
- New rule or action: add the variant to the `Action` union in `engine/types.ts`, the reducer branch
  in `game.ts` (exhaustiveness check fails until every switch handles it), the codec case in
  `protocol.ts`, a table test and a recorded golden. Wire-visible changes add a version field.
- New screen or CSS class: add it to `CONTRACT.md`; `class-contract.test.ts` fails when a class
  toggled in TS has no CSS rule or vice versa.
- Behaviour change: a PR that flips a golden says so in its body and touches only that golden.
- Anything needing a loop goes into the game's `*.algorithms.ts` with a reason comment and a test.

## Seams reserved for the roadmap (not implemented now)

- Shared design tokens / UI kit: `web/shared/styles/tokens.css` (linked by both pages since step 14;
  it declares gin's palette under the eleven shared names, fidice's `theme.css` overrides every one
  onto its own palette; `CONTRACT.md` "Tokens" tables both) and `web/shared/ui/` (README only). The
  Fidice restyle drops those overrides, points fidice's rules at the shared names and re-records the
  goldens, then moves screen builders into `shared/ui`; computed-style goldens and the class
  contract gate it.
- Swappable hand display: `ui/hand/HandView.ts` is the interface `render.ts` consumes; a new view is
  a second module and a `main.ts` choice. Landed: `ui/hand/SlotHandView.ts`, the eleven fixed
  cells with the ghost draw slot (docs/design/gin-draw-ghost-slot.md, PR A), is what `main.ts`
  paints; `render.ts` hands it the App's `draw` stage as the interface's optional third argument.
  `defaultHandView` stays as test-only code for its legacy string golden until the design's PR D,
  and `#tableScreen` left the DOM-snapshot oracle's scope (the table diverges by design; every
  sheet and overlay it opens still compares). The fixed-geometry proof is `e2e/gin-draw.spec.ts`.
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
  core `recommended` rules for the JS-only config on the plain JavaScript that remains (since step
  15: `infra/turn-worker/worker.js`, the harness scripts under `e2e/browser/` and
  `test/integration/`, the `.mjs` shim under `.github/actions/npm-ci/` and `eslint.config.js`).
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
  `checkJs` stays off (the JS lint config covers it). Step 15 ported the Worker to `worker.ts` and
  dropped `allowJs` from every project.
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

Step 4 (Vite build in passthrough mode; Pages deployed by Actions):

- Vite is 8.3.0 (Rolldown): the config uses `build.rolldownOptions` (`rollupOptions` is a
  deprecated alias in the installed types); `entryFileNames` is a function so the landing entry
  (`index`) gets `app-[hash].js` and every other page `games/[name]/app-[hash].js`.
- `build.cssMinify: false`: lightningcss reorders the declarations of the landing page's inline
  `<style>`, and with it off `dist/index.html` is byte-identical to `web/index.html`. The parity
  test is sha256 on all four files; nothing is normalised.
- The multi-page input comes from a recursive `readdirSync` of `web/` filtered to `index.html`
  outside `public/` (node 22's `fs.globSync` prints an experimental warning on every build).
- `legacyPassthrough` copies `legacy/shared/ice.js` only while `LEGACY_PAGES` is non-empty; the
  loader exists for the legacy pages alone.
- `npm run test:e2e` builds first (`npm run build && playwright test`), so jobs `e2e` and `broker`
  rebuild dist rather than download it; the build is deterministic. `deploy` downloads the `dist`
  artifact `check` uploaded (with `include-hidden-files: true`, or `.nojekyll` would be dropped) and
  installs nothing.
- `test/dist/**` is excluded from `vitest.config.ts` and run by `vitest.dist.config.ts` via
  `npm run test:dist`, which `npm run check` runs after `npm run build`; a missing dist/ skips with a
  note. `.gitignore` anchors `/dist/` so `test/dist/` is tracked.
- `tools/serve-dist.ts` defaults `--root` to `dist` and resolves `--alias` targets against the
  working directory (route kind `alias`), since the e2e ICE fixture is not in dist. Its node tests and
  the proxy's mount a temp directory staged from `legacy/` and `web/index.html`
  (`test/tools/site-fixture.ts`) instead of the repo root.
- Moving the pages changed the `// GENERATED ... from <page>` header of both fixtures, so
  `fixtureSha256` was re-pinned by `npm run fixtures:legacy`; `sourceSha256` is unchanged for both.
- `web/index.html` joins `.prettierignore`: it is the verbatim root page and dist parity compares
  against it byte for byte.

Step 5 (shared TypeScript modules with tests first):

- `web/shared/lib/clock.ts` holds `Clock` and an opaque `Timer` type only; `web/shared/edge/clock.ts`
  is the real one and `clock.fake.ts` the hand-driven fake (a timer queue is state, so it is an edge).
  `algorithms.ts` is reserved, not created: no step-5 helper needs a loop.
- `web/shared/edge/ice.ts` is a behaviour-for-behaviour port of `legacy/shared/ice.js` with `fetch`,
  `Clock`, `location.search` and the endpoint injected; `test/parity/ice.legacy.test.ts` evaluates the
  legacy IIFE in `node:vm` with the same fakes and deep-equals every documented case. The port and
  the two clock modules are written against structural types (no DOM lib) and are listed in
  `tsconfig.node.json` for that test; `tsconfig.web.json` still owns `web/shared/edge`.
- `transport.ts` exposes `Transport { open(id?) -> PeerHandle }`, `PeerHandle` (on, connect,
  reconnect, destroy, flags) and `Connection` (send, onOpen/onMessage/onClose/onError, open(),
  peerConnection()). `transport.fake.ts` is an in-memory broker with one FIFO queue (auto or manual
  delivery, structured-cloned frames). `transport.contract.ts` is one scripted scenario whose log
  (`transport.contract.log.ts`) the fake test and the browser integration test both must reproduce.
- The integration test lives in `test/integration/` and runs from `npm run test:integration`
  (`vitest.integration.config.ts`): PeerServer, Vite dev server and Chromium are started
  programmatically on free ports; it skips with a note where loopback WebRTC is blocked and runs for
  real in the CI `check` job, which now installs Chromium.
- `dom.ts` takes `Readonly<HTMLElement>` and mutates through methods only, so the edge profile's
  readonly-parameter rule needs no exception; the escaping template tag is `safeHtml` (Prettier
  reformats `html`-tagged templates). Its tests use a structural fake: jsdom is not installed.
- `vitest.config.ts` covers `web/shared/edge/**` with a 90% threshold on lines, functions and
  statements (lib stays at 100% on all four); `test/integration/**` is excluded from `npm test`.

Step 5 follow-up (review findings on the transport and room codes):

- `transport.fake.ts` frames are not structured-cloned: they round-trip through PeerJS's BinaryPack
  (`wireClone`, exported by `transport.ts`, the one `peerjs` importer), so the fake shows the real
  wire's rewrites (`undefined` -> `null`, `Date` -> string) and throws (`Infinity`, `Map`, `Set`,
  `BigInt`); `transport.contract.log.ts` pins `wire: undefined->null date->string` for both.
- `PeerHandle.connect` returns an inert Connection when PeerJS refuses (disconnected peer) and
  `PeerHandle.reconnect` is guarded like legacy `keepPeerAlive`; the fake refuses `connect` while
  disconnected, emits `error(network)` then `disconnected` on a dropped socket with `id()` null in
  between, emits `disconnected` before `close` on destroy, and emits a channel's `close` only if it
  had opened, all as PeerJS 1.5.4 does.
- `roomCode.sanitiseCode` is the legacy input handler per game (gin: `A-Z` only, four at most;
  fidice: upper-case only), not a filter to the alphabet; `test/parity/roomCode.legacy.test.ts`
  runs the captured legacy expressions beside it.
- `test/integration/transport.integration.test.ts` skips on "signalling worked, no channel" only
  outside `CI`; the script runs with `--reporter=verbose` so the skip note is visible.

Step 6 (de-bundle Fidice into modules, shipped dark):

- esbuild's collision renames (`h2/p2/b2/i2`, `turnKey2..6`, `clamp2/3`) are kept in every module:
  they are unique across the bundle, so no import can collide, and each module body is the page text
  at the same scope depth (two-space indentation included), so shadowing is unchanged. Exports are
  one trailing `export { ... }` line per module, so every body line is byte-identical to the page.
  Step 8 renames and de-indents when it types the modules.
- `tools/legacy/debundle-fidice.ts` finds declarations and free identifiers with ESLint's scope
  manager (a one-off rule under `Linter.verify`; eslint is a devDependency already). The recovered
  graph is a DAG in bundle order (no cycles, no forward references) and `main.js` imports all 38
  modules in bundle order, so the ESM evaluation order equals the bundle order; the tool refuses
  cross-module writes, duplicate top-level names and eager reads of a later module. It also cuts
  `index.html` and `theme.css` from the page; `web/games/fidice/MANIFEST.json` pins the range and
  every file, and `test/tools/debundle-fidice.test.ts` re-runs the tool on HEAD.
- The classic `../../shared/ice.js` script carries Vite's `vite-ignore` attribute (stripped from
  the output) so the build neither bundles nor warns about it; `legacyPassthrough` always copies
  `legacy/shared/ice.js` and reads `build.outDir` from the resolved config (`npm run build:next` is
  `LEGACY_PAGES= vite build --outDir ../dist-next`, gitignored; `check` and `test:e2e` build both).
- `experimental.renderBuiltUrl` makes HTML URLs document-relative: with the relative base alone
  Vite writes `../../games/fidice/app-x.js` (a parent escape for the asset-URL guard, and a
  `/games/` redirect per load on the proxy origin); pages now get `./app-x.js` and
  `../../shared/assets/x.css` as "Two origins" specifies. The entry's CSS is named after the entry
  (`shared/assets/fidice-[hash].css`).
- The dist guards run per tree (`describeDist` in `test/dist/dist.ts`, dist/ and dist-next/) and
  leave out the landing link to gin-rummy in dist-next/, which that tree does not hold yet. The
  Playwright project `next` serves dist-next/ on :4174 with `smoke.spec.ts` (landing and fidice) and
  `fidice-online.spec.ts`; `e2e/fixtures/site.ts` gains `pagesOn(project)`.
- The parity `current` leg is the 25 modules of the fixture range (`assets/diceImages` through
  `domain/search`, in bundle order from MANIFEST.json) merged into one object; all of them evaluate in
  node, the four `net/` modules included, since `Peer` and `HyperIce` are reached only inside
  functions. `test/parity/fidice.modules.test.ts` imports each one on a fresh registry and compares
  every export with the fixture's binding; the seeded 3-bot game is replayed on both legs and
  deep-equalled instead of a stored golden.
- A JS-only lint block for the generated files turns off `no-var`, `no-unused-vars` and `no-empty`
  and names the nine browser globals the bundle uses under `no-undef`; import-x zones and `no-cycle`
  stay on and pass. `test/ratchet.test.ts` (listed under step 8 in MIGRATION) lands here and pins
  the `.js` count under `web/` at 39: the count exists from the first `.js` file.

Step 7 (cut Fidice over):

- `DEFAULT_LEGACY_PAGES` is `['gin-rummy']`; `legacy/fidice/index.html` is kept in place, unserved,
  as the frozen source the oracle manifest, `extract-fidice-core.ts` and `debundle-fidice.ts` read
  (and the generated module headers name). "Cutting a page over is deleting it from that list and
  deleting its legacy file" therefore splits in two: the list entry goes at the flip, the file goes
  in step 13 with the rest of `legacy/`.
- The cutover introduces the up-to-10-minute cache window described in "Build and serve" (cached
  `games/fidice/index.html` asking for a dropped `app-[hash].js` after a hash-changing deploy or the
  revert). It is documented, not closed; a retained-assets copy in the deploy job (or dropping
  `emptyOutDir`) is noted for step 13.
- `test/dist/dist-parity.test.ts` asserts the served fidice page is Vite's (module script beside the
  page, `shared/assets/fidice-[hash].css`, no inline bundle), that every relative asset it references
  is a file in the tree, that the legacy file is still present, and that the fidice output in dist/
  and dist-next/ is byte-identical; `asset-urls` and `check-dist-paths` cover the fidice page in
  both trees with no skips.
- The Playwright project `next` runs `smoke.spec.ts` only: with fidice flipped, dist-next/ differs
  from dist/ by the absence of gin-rummy alone, so fidice-online there duplicated `pages`/`proxy`.
  The project and `npm run build:next` stay for the gin port (step 12).

Step 8 (type the Fidice pure core), phase 1: `domain/**`:

- The `@shared/*` alias named in "Module boundaries" is not wired (Vite `resolve.alias`, vitest,
  the import-x resolver, the tsconfigs), so `domain/result.ts` imports `web/shared/lib/result.ts`
  by relative path. Wiring it is deferred until a second game imports the shared lib.
- Two throws remain in the domain, each behind a commented `eslint-disable-next-line
  functional/no-throw-statements`: `expect` in `domain/result.ts` (the host's unwrap of Err paths a
  player cannot reach; it moves out with `net/host` in step 9) and `asRank` in `domain/hands.ts`
  (the `RangeError` the parity suite pins). Neither is reachable from `apply`.
- `domain/probability.algorithms.ts` holds `cartesian`, `survivalFor` and the memo `cache`: module
  state the bundle kept and the oracle reads. The density is summed in a `for..of` over a local
  array so the floating-point additions happen in the legacy order (a bot's choice can turn on the
  last bit); `probability.ts` re-exports all three under the legacy names.
- `tools/legacy/debundle-fidice.ts` takes an `IsPorted` predicate. A ported section is not
  written; the remaining generated modules import it with a `.ts` specifier and `MANIFEST.json`
  pins its provenance as `{ section, startLine, endLine, typed: true }` with no sha256.
- `tsconfig.web.json` includes `domain/**` again: the `.js` view, bots and net modules import the
  `.ts` domain, and a composite project must list every `.ts` its files import. The pure project
  stays the guard (`lib: ES2023`, no DOM).
- `JS_FILE_COUNT` is 31. Coverage thresholds: `web/games/fidice/src/domain/**` at 90% lines,
  functions and statements; `*.algorithms.ts` there at 100%.

Step 8 (type the Fidice pure core), phase 2: `bots/**` and `net/protocol.ts`:

- The bots' shared shapes live in `bots/types.ts` next to two type guards (`hasRound`, `hasBid`),
  as `domain/types.ts` holds its two counts: a module the manifest does not list may add runtime
  exports, a typed legacy module may not (fidice.modules.test.ts checks every export against the
  fixture). `Strategy<M>` is generic in its memory; `anyStrategy` erases it with a cast for the
  registry's pool, as the bundle's name says it did.
- `toolkit.readSeat` and `raisesBy` accept `Seat | null` because trapper passes `r.bidder`
  unchecked; a `null` reads as an empty dossier, which is what the bundle computed.
- `net/protocol.ts` uses the `web/shared/lib/json` leaf decoders (`integer`, `boolean`, `arrayOf`)
  for field checks and keeps its own frame walk, `isRecord` (arrays included) and refusal texts:
  the parity suite pins the texts, and `json.object` differs on inherited keys and wording. The
  `state` of a server frame is cast to `PublicState` on the shape check alone, as before.
- `tsconfig.web.json` no longer excludes `bots/**` or `net/protocol.ts` (same reason as `domain/**`
  in phase 1). `JS_FILE_COUNT` is 19. Coverage thresholds: `bots/**` and `net/protocol.ts` at 90%
  lines, functions and statements.
- `.prettierignore` still skips `/web/games/fidice/src/` as a whole; the typed `.ts` files there
  are formatted with Prettier by hand until the ignore is narrowed to the generated `.js`.

Step 9 (type the Fidice edges), phase 1: `net/**`, `app/**`, `main.ts`:

- `net/session.ts` keeps the session-level transport shapes the legacy classes were written
  against (`HostTransport`, `ClientTransport`, with `onInfo` optional) over the shared `Connection`;
  `net/peerjs.ts` builds them from an injected `(ice) => Transport` factory, the ICE loader (or null)
  and the Clock, and names the ICE types through `transport.ts` (`RealTransportOptions['ice']`,
  `Connection['peerConnection']`) so `net/` still imports only the transport and clock edges. It is
  in the `EDGES` lint glob (`net/{host,guest,client,session,peerjs}.ts`): it holds the deferred Peer.
- PeerJS and the ICE loader load with the module bundle instead of as two classic `<script>`s
  before it: the fidice page defines neither `window.Peer` nor `window.HyperIce` and no longer
  requests unpkg or `../../shared/ice.js` (still copied for the legacy gin page). The ICE fetch
  still starts on create/join and the Peer is created once `ice.load()` resolves, as before.
- `globalThis.__peerCalls` records the argument list of every `new Peer(...)` (`[id, options]` /
  `[options]`), the shape `e2e/browser/record-peer.js` already produced, so `peer-calls.ts` needs
  no branch and fidice-online keeps its id assertion. The smoke spec checks `HyperIce`/`Peer`/
  `shared/ice.js` on the legacy gin page only, and on fidice that `window.__fidice` booted and no
  classic script was requested.
- The protocol suite's "frame-by-frame equals wire goldens" is the differential oracle
  `test/parity/fidice.sessions.test.ts`: legacy and typed sessions on one fake broker, traces
  deep-equal (frames after `wireClone`, events, final state). `tsconfig.node.json` lists
  `web/shared/edge/transport{,.fake}.ts` and the fidice `domain/`, `bots/`, `net/` for it.
- `expect` stays in `domain/result.ts`, imported by `net/host.ts`: `test/parity/fidice.legacy.test.ts`
  pins it on both legs. `view/types.ts` is a types-only module (not in the manifest) for `Ui` and
  `Intent`; the controller binds the generated view's exports to those types until phase 2 types
  `view/**`. `JS_FILE_COUNT` is 12.

Step 9 (type the Fidice edges), phase 2: `view/**` and `assets/diceImages`:

- `view/vdom.ts` owns the tree types (`VNode`, `Props`, `Child`, `Handlers`) and the reconciler;
  `view/types.ts` stays the types-only module for `Ui` and `Intent` (the types did not move into
  `view/ui.ts` as phase 1 announced: beside `domain/types.ts` and `bots/types.ts` is the smaller
  diff). Handlers receive `Readonly<Event>`s; the `e.target` casts sit in vdom's `targetValue`,
  `targetChecked` and `blurTarget`, so the screens hold no casts.
- `domain/game.ts` `keepsScore`, `isOut` and `standings` take `PublicState` (type only): the view
  calls them on the redacted state a guest holds, and a `State` is a `PublicState`.
- No jsdom: `web/shared/edge/dom.fake.ts` is the structural DOM the view tests render into (the
  members the reconciler touches, bubbling listeners, `value`/`checked`/`disabled`/`selected` on
  the tags a browser gives them, a deterministic `serialize`). The `ui/`/`view/` import zone excepts
  it, as the `net/` zone excepts `transport.fake.ts`. The per-screen tests live beside the screens
  (the web project has the DOM lib); the oracle `test/parity/fidice.view.test.ts` imports the typed
  view dynamically by path, as `fidice.modules.test.ts` does, and evaluates the legacy `src/view/*`
  sections with node:vm over the pinned legacy core. `tsconfig.node.json` lists `dom.fake.ts` and
  the DOM-free `view/{types,ui,scenarios}.ts` for it.
- `view/scenarios.ts` is the one catalogue of representative states (built through the domain with
  a seeded rng) that both the render tests and the oracle use; `view/render.fake.ts` mounts a state
  and records intents. Coverage threshold: `web/games/fidice/src/view/**` at 90% lines, functions
  and statements. Follow-up: `net/**` and `app/**` join `coverage.include` with the same 90%
  threshold each (`main.ts` stays out: it constructs the real adapters); `app/effects.test.ts` pins
  the storage fallback rules and `app/controller.test.ts` drives the reducer over fake effects, a
  `fakeClock`, `dom.fake.ts` and recording session stubs (the reducer's `handle` is reached through
  a test-only cast; the screens' render tests own the handler wiring). It pinned two legacy defects
  by name, the single toast timer (queued since step 15) and `ladder.showBid` keeping the current
  tab when there is a bid; only `showBid` is still pinned.
- `JS_FILE_COUNT` is 0; the debundle tool writes the page, the stylesheet and the manifest only
  and remains the audit of the bundle-to-module map. `allowJs` leaves `tsconfig.web.json` in
  step 15, as planned.

Step 10 (gin engine): `web/games/gin-rummy/src/engine/**`:

- `createGame(opts, rng, now)` and `applyAction(state, seat, action, rng, now)` take a `Now`
  (`() => number`) beside the `Rng`: the legacy read `Date.now()` for `startedAt` and each round's
  `ts`, which the UI turns into durations, so the clock is a required injection, not an optional
  one. `dealHand(state, rng)` requires its rng. A stock draw's `privateCard` is not part of the
  `Result`; it is `state.pendingDraw.cardId`.
- The PURE globs also ban `Date.now` (`no-restricted-syntax`, the same shape as the `Math.random`
  ban), `*.algorithms.ts` included; tests beside pure modules are exempt.
- `melds.algorithms.ts` imports `melds.ts` (`allMelds`, `meldSig`) rather than the reverse, so the
  wrappers `bestMelding` and `allOptimalMeldings` are exported from the algorithms file with the DP
  and the DFS they wrap, and `engine/index.ts` presents the one surface; the memo `altCache` is
  module state, as the legacy `_altCache` was. Two unreachable guards of the legacy DFS are dropped
  (commented in place) so the 100% statement threshold holds.
- `tsconfig.web.json` no longer excludes `engine/**`; `tsconfig.node.json` lists the gin engine for
  the parity suites. Coverage: `engine/**` at 90% lines, functions and statements,
  `melds.algorithms.ts` at 100%. The 1000-game replay runs as four 250-game shards
  (`test/parity/gin.replay.{1..4}.test.ts`, one line each over `gin.replay.ts`) so vitest spreads
  it across workers: ~15 s wall on a 16-core laptop instead of ~55 s in one worker;
  `GIN_REPLAY_GAMES=<n>` shortens a local run.

Step 11 (gin protocol, storage and pure UI/scorer helpers): `web/games/gin-rummy/src/`:

- `engine/decode.ts` is a new engine module: the `State`, `View` and `Action` decoders in the
  engine's literal key order, shared by `protocol.ts` (views, actions) and `storage.ts` (the save
  carries a `State`), so both promise byte-identical re-encoding without knowing the shapes.
- `web/shared/lib/json`: `object()` leaves an absent optional key out of its output and types it
  optional (`Shape<F>`); `record()` decodes id-keyed maps, refusing the three prototype-chain keys.
- `protocol.ts` caps a join name at 20 characters and a toast at 500 rather than coercing as the
  legacy host did; `guestNameFor` applies the host's normalisation after the decode.
- `storage.ts` imports the engine decoder and the scorer's types beside `web/shared/lib` and
  `@shared/edge/storage`; its `ui/`, `net/`, `view/` and edge bans are unchanged.
- `ui/cues.ts` holds the sound-cue machine (`nextCue`) beside the status strings and re-exports
  `fmtDuration` from `scorer/format.ts`, so `scorer/csv.ts` never imports `ui/`; `scorer/` (except
  `main.ts`) is a pure layer in the layer table, `PURE` glob, `tsconfig.pure.json` and its own
  import zone, and `protocol.ts` may not import it. `scorer/voice.ts` is the spoken-entry parser.
- `tsconfig.node.json` lists the whole gin `src/` tree and `web/shared/edge/storage.ts` for the
  parity suites; `tsconfig.web.json` no longer excludes `protocol.ts`. Coverage: `protocol.ts`,
  `storage.ts`, `ui/**` and `scorer/**` at 90% lines, functions and statements.
- Fixtures: `MANIFEST.json` entries may carry `ranges` (a fixture cut from several page ranges);
  `test/fixtures/legacy/{gin-wire,gin-storage}` hold the recorded wire corpus and the captured
  localStorage payloads (README there).

Step 12, phase 1 (gin page, net, state, boot): `web/games/gin-rummy/`:

- `net/peerjs.ts` joins `net/{host,guest}.ts` as the third gin net module (the edge glob already
  named it): the peer plumbing both sessions share, over `@shared/edge/transport` and the Clock.
- The sessions take `read()` (the app fields the legacy handlers read) and an events record (status,
  toast, wake lock, persist, decoded frames, gone/lost) instead of touching the page; `ui/state.ts`
  turns the events into intents through main.ts's wiring.
- `ui/state.ts` returns `Effect`s as data and exports `runEffect(app, effect, deps)`; the mutable
  `app` and session cells live in `main.ts` (the edge), which paints after every intent.
- `ui/render.ts` is where the gin DOM writes live; it is excluded from `tsconfig.node.json` (DOM).
  `ui/sound.ts` holds the cue tables; `src/fx.ts` (audio, vibration, the `ginRummy_sound` key) is
  the legacy `fx` object over `@shared/edge/fx`, whose `AudioCues` gained `warm()`.
- Import zones: net/ may import `clock.fake.ts` (tests beside the sessions); the ui/ zone's target
  leaves `*.test.ts` out. Coverage: gin `net/**` and `fx.ts` at 90% lines, functions and statements.
- `index.html` adds `id="rulesList"` / `id="rulesOverlayList"` to the two rules slots; every other
  id and class is the legacy's. dist/ carries the unreferenced gin bundle beside the legacy page.
- Two module pages: the modules both import are one `shared/assets/[name]-[hash].js` chunk,
  preloaded by both pages (`<link rel="modulepreload">`), the layout `chunkFileNames` reserved.

Step 12, phase 2 (gin paint, wiring, scorer screen, oracle):

- `ui/render.ts` composes the whole paint (`paint(doc, app, handView)`): screens, statuses, the
  home screen (`ui/home.ts`), the curtain (`ui/local.ts`), the table, the sheets, the endgame and
  the overlays, each from the App alone; the HandView is main.ts's choice and `fitTable` measures
  while `ui/fit.ts` decides. Each module also binds its controls to intents (`bindAll`).
- The App gained what the legacy kept in the DOM or in closures (rules/history overlays, the
  long-press submenu, the code draft); named timers, the sound toggle, the share and the two input
  writes are effects. `scorer/main.ts` (an edge) holds the Score Counter's state in a closure over
  the pure scorer modules, with the dialogs, screens, download and SpeechRecognition injected.
- `@shared/edge/dom` grew listeners, values, styles, queries, the `e.target` casts and
  `PageLike`; `@shared/edge/page.fake` is a string-backed static-page fake (the ui zone may import
  it); `@shared/edge/share` the Web Share / clipboard chain. `web/raw-imports.d.ts` declares Vite's
  `?raw` import for the tests that build the fake from `index.html`; ambient `.d.ts` files are
  exempt from the erasable-syntax ban.
- The DOM-snapshot oracle is `tools/parity/gin-dom-parity.ts`, run locally by hand and in CI as
  `e2e/gin-dom-parity.spec.ts` on the `next` project; `e2e/gin-resume.spec.ts` covers host resume
  and guest rejoin on every project; `PORTED_PAGES` lists gin-rummy, so the `next` project runs
  every gin spec against dist-next/.
- `RNG_ALLOWED` is `web/games/*/main.ts` (the page boots) plus `web/shared/edge/**`: gin's
  `scorer/main.ts` is an edge for `let`/`try` but keeps the `Math.random` ban (`ScorerDeps.rng`).
- The `ui/state.ts` row reads "imported by `main.ts`, the `ui/` painters `render`, `home` and
  `local` (the `App`/`Intent` types and the screen and tab lists only) and tests"; a zone refuses
  every other `ui/`, `ui/*/` and `view/` importer of `ui/state.ts` / `app/controller.ts`.

Step 13 (cut Gin Rummy over; retire the passthrough):

- `dist/games/gin-rummy/index.html` is Vite's module page on both origins; `DEFAULT_LEGACY_PAGES`,
  `legacyPagesFrom`, the `legacyPassthrough` plugin and the `LEGACY_PAGES` env are deleted from
  `vite.config.ts`, which now only globs `web/**/index.html` and names the output. dist/ holds no
  `shared/ice.js`: the proxy's `/shared/` rule now serves Vite's `shared/assets/` alone.
- `legacy/` is kept, not deleted as "Build and serve" and the layout tree say: it is MIGRATION ONLY
  in the sense of test fixtures (the frozen, sha256-pinned oracle sources; `legacy/README.md` lists
  every reader). "Pinned" means whole files: `test/fixtures/legacy/frozen.test.ts` holds each
  file's sha256 beside the range pins in `MANIFEST.json`, which cover only the extracted cuts.
  Nothing copies it into dist and no page loads it; the one browser that opens a legacy page is the
  DOM-parity oracle, through serve-dist aliases on the harness's pages origin (`LEGACY_ALIASES` in
  `e2e/fixtures/site.ts`, mounted at `legacy/games/gin-rummy/index.html` so its
  `../../shared/ice.js` resolves to the aliased `legacy/shared/ice.js`).
- `npm run build:next`, `dist-next/` and the Playwright project `next` are retired: nothing is dark
  any more, so `test:e2e` is `npm run build && playwright test` on `pages` and `proxy` with every
  spec, and `check` builds once. `test/dist/dist.ts` guards the single tree (`DIST_ROOT`,
  `describeDist` without a per-tree loop, no `unbuiltPages`); `dist-parity` asserts both game pages
  are module pages with resolvable assets preloading the same shared chunk, the landing page
  byte-identical to `web/index.html`, and `legacy/` present.
- The 10-minute cache window in "Build and serve" now applies to both game pages and the shared
  chunk; closing it (retained assets in the deploy job) is still deferred.
- Step 14, phase 1: the computed-style goldens run as `e2e/computed-styles.spec.ts` on `pages`
  (a browser capture, so an e2e spec, not a dist test), and `test/dist/class-contract.test.ts`
  checks the class contract by extraction (`test/dist/classes.ts`), so `CONTRACT.md` lists the
  exceptions the extraction cannot see, not every class. `DIST_DIR` redirects the dist guards.
- Step 14, phase 2 (the hoist): both pages link `web/shared/styles/tokens.css` and `base.css`
  before `./theme.css`. `tokens.css` landed empty, then the follow-up filled it with gin's palette
  under the eleven shared names (`--bg --card --card-2 --accent --accent-dark --gold --text --muted
  --danger --radius --felt`): gin is the look the roadmap restyles Fidice towards, so its values are
  canonical and its `theme.css` no longer declares them (`test/tokens.test.ts`), while fidice's
  `theme.css` redeclares all eleven, aliasing the four it lacked onto `--mist --cream-2 --ink --red`,
  so its look is unchanged until the restyle. Because the goldens pin every declared custom property
  and its `:root` value, a new shared name used to fail the check at every screen; the comparison in
  `tools/parity/computed-styles.ts` is now additive for custom properties only (a token the golden
  never recorded on a selector is a note, a missing or changed token or any property change a
  difference), which let the fidice goldens be re-recorded with the gin goldens byte-identical.
  `base.css` holds the box-sizing reset, `html, body { margin: 0 }` and `.hidden`, the only rules
  the themes carried identically. Vite attaches the shared sheets to the shared chunk, so a built
  page links `shared/assets/roomCode-<hash>.css` then `shared/assets/<game>-<hash>.css` (the dist
  guards assert the pair, the order and that both pages link the same shared file; the cache window
  in "Build and serve" covers it too). `web/games/fidice/{index.html,theme.css}` are hand-owned, no
  longer cut or pinned by `tools/legacy/debundle-fidice.ts`; `web/shared/ui/README.md`'s `base.css`
  row moved to `web/shared/styles`.

Step 15, part A (tighten: `allowJs` out, the lint story as it stands, coverage ratcheted):

- `infra/games-proxy/worker.{js,test.js}` are `worker.{ts,test.ts}` (`git mv`, then the JSDoc types
  written as TypeScript: `Env`, `Mapped`, a `Handler` type over the WHATWG globals `@types/node`
  declares) so `tsconfig.node.json` needs no `allowJs`; `wrangler.toml` points `main` at
  `worker.ts`, which wrangler bundles natively. Behaviour is identical and the table tests are the
  same rows; the functional profile now covers `infra/games-proxy/**/*.ts` too, while the
  absolute-site-path ban does not: the Worker is the one place that spells those paths, to map them
  between the origins, and its table tests list them. The deployed JS keeps
  serving until the owner runs `npx wrangler deploy` from that directory at leisure (wrangler is not
  a devDependency, so the port was not dry-run built here). `infra/turn-worker/worker.js` stays
  plain JavaScript on purpose: it is deployed by hand and "unchanged" throughout this document, and
  it keeps its `.prettierignore` entry. The import-x block lints `**/*.ts` only: no remaining `.js`
  takes part in a zone.
- `test/ratchet.test.ts` is one test: no `.js` file under `web/`. `JS_FILE_COUNT` and the
  fidice-only allow-list are gone with `allowJs`; a `.js` under `web/` would now escape the
  compiler, so the test refuses it outright.
- The lint story is stated as it stands: `functional/no-expression-statements` has been `error` in
  the pure dirs since step 1 (step 8 never needed the `warn`-plus-ratchet fallback), and lint runs
  with `--max-warnings 0` and no exceptions. The "warn until the tightening step" and "except the
  tracked warnings during migration" wording in "eslint.config.js" is gone.
- Coverage thresholds are ratcheted, not merely "enforced" (they were enforced from step 5 on):
  `npm test -- --coverage` was run once for the per-group figures (aggregated over each glob's
  files from `coverage-summary.json`, the way vitest evaluates a glob threshold), every group
  gained a `branches` floor at `floor(measured) - 3` (the lowest measured branches was 84.4%, on
  the fidice net/ sessions, so none was omitted), and lines/functions/statements rose to
  `floor(measured) - 5` where the measured number beat the old threshold by 8 or more points; the
  fidice net/ group (95.9/93.2/92.2) stays at 90. Nothing went down. A second run passed against
  the new numbers, which are listed in the `vitest.config.ts` comment and summarised under
  "Testing pyramid".
- Step 15, behaviour fixes: the three named debts landed as one commit each, before the step's
  tightening. Gin `dealHand` resets `lastDrawn` (null once the key exists; still absent until the
  first draw, so the wire and storage shapes are unchanged), and the parity suites split on it:
  `gin.legacy.test.ts` pins the leak on the legacy leg only and the reset on the current one, and
  `gin.replay.ts` normalises the legacy state after each redeal and asserts legacy leaks > 0,
  current leaks == 0 per shard. The DOM oracle `tools/parity/gin-dom-parity.ts` read 84 checkpoints,
  0 mismatches against the frozen legacy page with no mask: its seeded game has no void hand, so the
  only redeal it drives is the rematch, which redeals over a state whose `lastDrawn` key exists
  (the legacy keeps the stale draw, the current engine has null); with SEED 12 no card came back
  fresh there, so no mask, and a SEED that hands the last-drawn card back at the rematch or void
  checkpoint needs a named `fresh` mask. Fidice's controller queues toasts FIFO, each for
  TOAST_MS, instead of restarting one timer, drops a repeat of the toast showing or last queued,
  and drops the queue (not the toast showing) when a table is torn down; `controller.test.ts` pins
  each and now names only `ladder.showBid` as a legacy defect. The dead `.ha-img-placeholder` block
  is gone from both themes and from `CONTRACT.md`; the computed-style goldens did not move.
