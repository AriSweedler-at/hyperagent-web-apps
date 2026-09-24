# web/shared/ui

The shared shell's UI code (docs/ARCHITECTURE.md "Seams reserved for the roadmap"). Reserved
since step 5 so the module boundaries and the class contract had a home to name; the first module
landed with the glossary links (docs/design/glossary-links.md):

| Module        | Holds                                                                                                                                                                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `glossary.ts` | `RuleItem`, `Glossary`; `ruleAnchor(id)` (`rule-<id>`), `linkJargon(html, glossary, { except })` (the first whole-word term per rule wrapped as `<a class="jargon" data-rule>`, longest terms first, never inside a tag or a link), `rulesListHtml(items, glossary)`, `ruleFromHash(hash)` |

The folder is lint-pure like `web/shared/lib` (eslint.config.js `PURE`, tsconfig.pure.json) and
held at 100% coverage (vitest.config.ts); the edge that scrolls and flashes a rule is
`web/shared/edge/glossary.ts`. Its import zone is a game's `ui/` zone: `web/shared/lib` and the
DOM edge (`dom.ts` and its fakes). A painter that lands here later carves itself out of the pure
profile the way `scorer/main.ts` does.
Three games now carry the shapes this folder is meant to hold: gin's shell (home tabs, mode
switch, waiting rooms, curtain, result sheets) was copied into `web/games/backgammon/src/ui/`
with the same field, intent and painter names on purpose (docs/design/backgammon-board.md §4), so
the shared shell reducer and painters (P6/P7 in that design's PR plan) are a mechanical lift once
both games are green; the two-seat host/guest sessions land first as `web/shared/net/` (P5).

What lands here later, and where it comes from:

| Module         | Contract                                                                      | Source                                            |
| -------------- | ----------------------------------------------------------------------------- | ------------------------------------------------- |
| `HandView.ts`  | `HandView { render(model, selection): string }`, the only way a hand is drawn | gin `ui/hand/HandView.ts` (step 11)               |
| `toast.ts`     | `toast(root, text, ms)` builder over `@shared/edge/dom` and a `Clock`         | gin `toast()` / fidice toast view (after step 13) |
| `nameEntry.ts` | name form builder (`Ari` / `Jeff` defaults preserved per game)                | both pages' home screens (after step 13)          |
| `lobby.ts`     | room-code display and join form over `@shared/lib/roomCode`                   | both pages (after step 13)                        |

The generic CSS primitives this table once reserved as `base.css` landed in
`web/shared/styles/base.css` instead (docs/MIGRATION.md step 14: the box-sizing reset,
`html, body { margin: 0 }` and `.hidden`, the only rules both themes carried identically), beside
`tokens.css` and `CONTRACT.md`; stylesheets live with the tokens, builders live here.

Rules that will apply: builders return `SafeHtml` or write through `@shared/edge/dom` only; no
`peerjs`, no `localStorage`, no timers except through an injected `Clock`; every class they toggle
is a row in `web/shared/styles/CONTRACT.md`. The backgammon page already follows them: its board
builders (`ui/board.ts`) return strings tested as strings, its painters write through
`web/shared/edge/dom.ts`, and its template-built class names are `backgammon` rows in the contract.
