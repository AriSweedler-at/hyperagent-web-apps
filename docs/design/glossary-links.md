# Glossary links: jargon in About takes you to the rule

Owner (2026-09-24): "Clicking jargon in the 'about' section will take you to the 'rules' section.
This should be true for ALL of the games (including gin rummy)." Also: "No need to call the game
sephardic in the window title … You can have that in the 'about' or in the 'rules' section."

## 1. Behaviour

- Every game has an **About** panel (a few paragraphs: what the game is, how this page plays it) and
  a **Rules** panel (the rule items, each with a bold heading). Gin gains an About tab (it has
  Play / Rules / Score today); backgammon has both; fidice has Rules and gets a short About on its menu.
- A **jargon term** in About (and inside a rule that refers to another rule) is a link. Tapping it
  switches to the Rules tab, scrolls the named rule into view and flashes it (a short highlight),
  so the reader lands on the definition, not on the top of the list. The address bar may carry
  `#rule-<id>` so a rule can be linked to directly; opening the page with that hash opens the Rules
  tab at that rule.
- Terms are linked on their first occurrence per paragraph, whole words, case-insensitive, never
  inside an existing tag or link, never a term linking to the rule it sits in.

## 2. Data (per game, pure)

```ts
// A rule item: an id (the anchor), its heading and body as safe HTML (the body may contain jargon).
export type RuleItem = Readonly<{ id: string; heading: string; body: string }>;
// A glossary entry: the words that mean this rule; longest phrases first when linking.
export type GlossaryEntry = Readonly<{ rule: string; terms: ReadonlyArray<string> }>;
export type Glossary = ReadonlyArray<GlossaryEntry>;
```

Gin (`web/games/gin-rummy/src/ui/rules.ts` gains ids; `glossary.ts` beside it): `deal`, `draw` (stock,
discard pile, upcard), `melds` (meld, set, run), `deadwood`, `knock`, `gin`, `layoff` (lay off),
`undercut`, `scoring` (bonus, box), `match` (target, 100). About copy for gin: two short paragraphs
(the game in one breath; this page: pass the phone or open a room, knock or go gin, lay off).

Backgammon (`src/ui/rules.ts`, per variant): `goal`, `direction` (point, home board), `rolling`
(doubles), `blocks` (blot, hit, bar, closed point), `bearing-off` (bear off), `opening`, `scoring`
(gammon, diplo, backgammon), `match`, `cube` (double, take, pass, own the cube), `crawford`, `online`.
The About panel keeps the Sephardic paragraph (the title no longer says it) with `portes`, `gammon`,
`doubling cube`, `Crawford rule`, `bear off` linked.

Fidice (`src/view/screens/rules.ts` items get ids; the menu gets an About blurb): `bid`, `dudo`
(call), `calza` (spot on), `palifico`, `wild ones`, `losing a die`.

## 3. Shared code

- `web/shared/ui/glossary.ts` (pure, tested to 100%): `ruleAnchor(id) = 'rule-' + id`;
  `linkJargon(html, glossary, { except?: ruleId }): string` wraps terms with
  `<a class="jargon" href="#rule-<id>" data-rule="<id>">…</a>` (first occurrence per string, word
  boundaries, longest terms first, skipping text inside tags and inside existing `<a>`; `except`
  suppresses self-links inside a rule); `rulesListHtml(items, glossary)` renders
  `<li id="rule-<id>"><strong>Heading:</strong> body</li>` with the body's jargon linked;
  `ruleFromHash(hash): string | null` reads `#rule-<id>`.
- `web/shared/edge/glossary.ts`: `bindJargon(doc, onRule: (id) => void)` (one delegated click
  listener on `a.jargon` through dom.ts, `preventDefault`), `revealRule(doc, slotId, id, timing?)`
  (`scrollIntoView` on `#rule-<id>` inside the rules slot the reducer names, a frame after the
  paint that showed it, then `.rule-flash` for `FLASH_MS` = 1.2 s). Both rules slots render the
  same `<li id="rule-<id>">`s, so the slot, not the document, is searched: the home list while the
  home screen is up, the overlay's list everywhere else. A rule the slot lacks (a Western-only rule
  under Portes) is a no-op after the tab switch.
- Reducer (gin and backgammon): intent `rules/show { rule }` → on the home screen `homeTab: 'rules'`
  (persisted like `tab/set`), on any other screen `rulesOpen: true`; effect
  `revealRule { slot, rule }` (`slot` the rules list that is on screen) run by main.ts through the
  edge. Boot: `ruleFromHash(location.hash)` dispatches `rules/show`.
- Fidice: the same pure helpers produce the links; the vdom rules screen renders `id="rule-<id>"`;
  the controller handles the click (`ui.screen = 'rules'`) and calls `revealRule` after render.
- CSS (each theme): `.jargon` is an underlined link in the accent colour (dotted underline, no
  colour shout: the restraint rule); `.rule-flash` a brief background fade. Rows in CONTRACT.md.

## 4. Tests

- Pure: `linkJargon` table (no double wrap, tags untouched, case, word boundary, first only, `except`,
  longest-first), `rulesListHtml` snapshot per game, `ruleFromHash`.
- Reducer: `rules/show` sets the tab (and the overlay in game), emits the effect; the hash boot.
- Painter (page fake): the delegated click dispatches; `revealRule` toggles the class.
- E2E (page-only, both viewports, per game): About → tap "knock" (gin) / "gammon" (backgammon) /
  "dudo" (fidice) → the Rules tab is active, `#rule-<id>` is inside the viewport and flashed;
  `?…#rule-<id>` at boot opens Rules at the rule. Story baselines only where a screenshot changes.

## 5. Sequencing

After the polish PR (`bg-polish`, edits rules.ts/About) and the online PR (`bg-online`, edits
home.ts/index.html) land: one PR for the shared helpers + gin + backgammon; fidice in the same PR
if small, else a follow-up. The shared-shell extraction (P6/P7) then absorbs `rules/show`,
`bindJargon` and the About/Rules panels into the shared shell.
