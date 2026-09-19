# legacy/: frozen oracle sources

The three files beside this README are the pre-migration site exactly as it was served before
`docs/MIGRATION.md` began: the two self-contained game pages and the classic `shared/ice.js` ICE
loader they both used. They are **test fixtures**, frozen at each page's cutover (Fidice in step 7,
Gin Rummy in step 13), and they are **never edited**: `test/fixtures/legacy/manifest.test.ts`
re-runs the extractors against them on every `npm test` and fails if a pinned range or a fixture
changes (`test/fixtures/legacy/MANIFEST.json` holds the sha256 of each); lint, Prettier and the
Vite build ignore the directory.

**Nothing serves them.** Since step 13 `dist/` holds only what Vite builds from `web/`: both game
pages are the TypeScript ports, `dist/shared/ice.js` no longer exists, and the passthrough plugin
that once copied these files into `dist/` is gone. The one place a legacy page is loaded in a
browser is the DOM-parity oracle below, on the test harness alone.

| File                   | Read by                                                                                                                                                                                                                                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gin-rummy/index.html` | `tools/legacy/extract-gin-engine.ts`, `extract-gin-ui.ts` (cut `test/fixtures/legacy/gin-{engine,ui}.cjs`; `manifest.test.ts`), `record-gin-wire.ts` (`gin-wire/`, `gin-wire.test.ts`), `capture-gin-storage.ts` (`gin-storage/`), `tools/parity/gin-dom-parity.ts` + `e2e/gin-dom-parity.spec.ts` (served by serve-dist alias on the `pages` origin), `test/parity/roomCode.legacy.test.ts`, `test/tools/site-fixture.ts` |
| `fidice/index.html`    | `tools/legacy/extract-fidice-core.ts` (`test/fixtures/legacy/fidice-core.cjs`; `manifest.test.ts`), `tools/legacy/debundle-fidice.ts` (`web/games/fidice/MANIFEST.json`; `test/tools/debundle-fidice.test.ts`, `test/parity/fidice.view.test.ts`), `test/parity/roomCode.legacy.test.ts`, `test/tools/site-fixture.ts`                                              |
| `shared/ice.js`        | `test/parity/ice.legacy.test.ts` (runs the IIFE in `node:vm` beside `web/shared/edge/ice.ts`), the legacy gin page's own `<script>` (through the parity alias), `test/tools/site-fixture.ts`                                                                                                                                                                  |

The parity suites under `test/parity/` run the typed modules beside the fixtures cut from these
pages (`describe.each([legacy, current])`); `web/games/**` headers cite the page line ranges each
module was ported from. If an oracle ever has to move, regenerate with `npm run fixtures:legacy`
(and `fixtures:gin-wire`, `fixtures:gin-storage`, `debundle:fidice` as applicable) and say why in
the PR; do not touch these files.
