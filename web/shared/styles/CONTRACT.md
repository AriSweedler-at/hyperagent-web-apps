# CSS <-> TS class contract

Every class a game's TypeScript names has a rule in the stylesheet its page links, and every class
that stylesheet styles is named by TypeScript or carried by the page markup.
`test/dist/class-contract.test.ts` (docs/MIGRATION.md step 14; from `npm run test:dist`, after the
build) enforces both directions on dist/ for each game, reading three sources through
`test/dist/classes.ts`:

- TS-named: the quoted names passed to `toggleClass`/`addClass`/`removeClass`/`hasClass`
  (`web/shared/edge/dom.ts`), the fidice vdom's `class:` props and the quoted arguments of its
  `cls(...)`, and the words of every `class="..."` attribute in a template string (plus the quoted
  words of a `${...}` ternary inside it), over `web/games/<g>/**` and `web/shared/**` (`.ts`, not
  tests).
- Markup: the `class="..."` attributes of the served `games/<g>/index.html`.
- CSS: every `.name` in the stylesheets the page links (the shared chunk's
  `dist/shared/assets/<chunk>-<hash>.css`, which is `web/shared/styles/{tokens,base}.css`, then
  `dist/shared/assets/<g>-<hash>.css`, its theme), with comments and strings blanked first.

The extraction is a few documented regular expressions, not a parser. Everything it cannot see is a
row below, and the test checks each row against the tree so a row cannot go stale (a class whose
rule is gone, a "dead" rule TS started naming). Adding a screen or a class means keeping this table
true (docs/ARCHITECTURE.md "Conventions for small diffs"); a class named literally and styled needs
no row.

| Owner     | Kind  | Name                                                                             | Toggled by (TS)                                                    | Styled in (CSS)                 | Notes                                                                                                                   |
| --------- | ----- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| gin-rummy | class | `card red mini big selected dim fresh locked`                                    | `web/games/gin-rummy/src/ui/cards.ts` (`cardClass`)                | `web/games/gin-rummy/theme.css` | Built from `CardOptions`; the extraction sees `card`, `big`, `dim` elsewhere and none of the rest.                      |
| gin-rummy | class | `black`                                                                          | `web/games/gin-rummy/src/ui/cards.ts` (`cardClass`)                |                                 | The default card colour: only `.card.red` has a rule.                                                                   |
| gin-rummy | class | `tiny`                                                                           | `web/games/gin-rummy/src/ui/render.ts` (`backHtml('tiny')`)        | `web/games/gin-rummy/theme.css` | Passed as `backHtml`'s argument, not in a `class="..."`.                                                                |
| gin-rummy | class | `m0 m1 m2 m3 m4`                                                                 | `web/games/gin-rummy/src/ui/hand/meldGroups.ts` (`meldGroupClass`) | `web/games/gin-rummy/theme.css` | Template `m${index % 5}`.                                                                                               |
| gin-rummy | class | `on off`                                                                         | `web/games/gin-rummy/src/ui/render.ts` (`connDotClass`)            | `web/games/gin-rummy/theme.css` | `#connDot`'s whole class attribute is a template written with `setAttr`.                                                |
| gin-rummy | class | `dec inc`                                                                        | `web/games/gin-rummy/src/scorer/main.ts`                           |                                 | Click hooks on the stepper's buttons; styled as `.stepper button`.                                                      |
| gin-rummy | class | `history-meta`                                                                   | `web/games/gin-rummy/src/ui/render.ts`, `src/scorer/main.ts`       |                                 | Layout wrapper of a history row; no rule (legacy markup, kept for DOM parity).                                          |
| gin-rummy | class | `divider`                                                                        |                                                                    | `web/games/gin-rummy/theme.css` | Nothing carries it: the legacy home screen's "or" rule. Dead, removal is step 15's.                                     |
| fidice    | class | `abs-blank abs-kayak abs-pine abs-step1 abs-step2 abs-step3 abs-step4 abs-step5` | `web/games/fidice/src/view/components.ts` (`shapeDie`)             | `web/games/fidice/theme.css`    | Template `abs-${sym}` over `ShapeSym`.                                                                                  |
| fidice    | class | `sm xs`                                                                          | `web/games/fidice/src/view/components.ts` (`die`, `size`)          | `web/games/fidice/theme.css`    | Die sizes arrive as the `size` argument (`diceRow(dice, 'xs')`, `shapeDie(sym, 'sm')`).                                 |
| fidice    | class | `app`                                                                            | `web/games/fidice/src/view/app.ts`                                 |                                 | The root's class; the rules use `#app-root`.                                                                            |
| fidice    | class | `shape`                                                                          | `web/games/fidice/src/view/components.ts` (`shapeRow`)             |                                 | `.dice.shape` marks a shape row; no rule.                                                                               |
| fidice    | class | `remove-bot`                                                                     | `web/games/fidice/src/view/components.ts`                          |                                 | Marks the lobby's remove button beside `btn-ghost small`; no rule.                                                      |
| fidice    | class | `lobby`                                                                          | `web/games/fidice/src/view/components.ts`                          |                                 | False positive: the phase literal in `game.phase !== 'lobby' && 'out'` inside a `cls(...)`. Not a class.                |
| fidice    | class | `blurb cat`                                                                      |                                                                    | `web/games/fidice/theme.css`    | `.ladder .cat .blurb`: the legacy ladder's category rows; the typed ladder builds `catrow`. Dead, removal is step 15's. |
| fidice    | class | `bot-pick`                                                                       |                                                                    | `web/games/fidice/theme.css`    | The legacy lobby's strategy `<select>`; the typed lobby builds `bot-strategy`. Dead, removal is step 15's.              |
| fidice    | class | `hidden`                                                                         |                                                                    | `web/shared/styles/base.css`    | Fidice never toggles it (the vdom omits a node instead); the rule is shared with gin, which does. Dead here.            |
| fidice    | class | `in-range rolling`                                                               |                                                                    | `web/games/fidice/theme.css`    | `.lrow.in-range`, `.die.rolling`: nothing sets either since the port. Dead, removal is step 15's.                       |
| fidice    | class | `kbd ladder-wrap or scene`                                                       |                                                                    | `web/games/fidice/theme.css`    | Rules for markup the legacy page had and the typed screens do not build. Dead, removal is step 15's.                    |
| shared    | class | `ha-img-placeholder ha-failed`                                                   |                                                                    | `web/games/*/theme.css`         | The stray image-placeholder block both pages carry (docs/MIGRATION.md step 6). Dead, removed in step 15.                |

Rules of the table:

- `Owner` is `gin-rummy`, `fidice` or `shared` (a `shared` row applies to both games).
- `Kind` is `class`; `id` and `attr` rows are not checked yet.
- `Name` is one class or several separated by spaces (`m0 m1 m2 m3 m4`).
- `Toggled by` names the TS module that produces the name; `Styled in` the stylesheet with the rule.
- Both filled: TS builds the name in a way the extraction cannot see, and the rule must exist.
- `Styled in` empty: a behaviour-only hook (no rule may exist for it, or the row is stale).
- `Toggled by` empty: markup-only or dead CSS (nothing in TS may name it, or the row is stale).

## Tokens

The shared vocabulary (docs/MIGRATION.md step 14 Deviations) is gin's palette: the roadmap
restyles Fidice to look like Gin, so `web/shared/styles/tokens.css` declares the eleven names below
with gin's values and gin's `theme.css` declares none of them (`test/tokens.test.ts` holds both).
Fidice's `theme.css`, linked last, redeclares every one of them so the names resolve to its own
palette until the restyle: the seven it always declared under the same name keep their values, and
the four it lacked are aliased onto its role equivalents. The computed-style goldens pin every
declared custom property and its `:root` value; a new shared name is a note in
`tools/parity/computed-styles.ts --check` until the goldens are re-recorded, a changed value a
difference. Columns are four on purpose: `test/dist/classes.ts` reads the six-column class table
above and nothing else.

| Shared name     | Canonical value (tokens.css, gin)                                            | Fidice override (theme.css)  | Notes                                                                       |
| --------------- | ---------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------- |
| `--bg`          | `#0f2318`                                                                    | `var(--mist)` (`#dcecf5`)    | Alias. `--mist` is the top stop of the sky gradient fidice's `body` paints. |
| `--card`        | `#163526`                                                                    | `var(--birch)` (`#fbf7ef`)   | Dark panel vs. light birch card.                                            |
| `--card-2`      | `#1c4030`                                                                    | `var(--cream-2)` (`#ece1cc`) | Alias. Fidice's secondary surface (`.btn-secondary`).                       |
| `--accent`      | `#4ade80`                                                                    | `#d9782f`                    | Green vs. orange.                                                           |
| `--accent-dark` | `#22c55e`                                                                    | `#a9561d`                    |                                                                             |
| `--gold`        | `#fbbf24`                                                                    | `#e6a93c`                    |                                                                             |
| `--text`        | `#f2fdf6`                                                                    | `var(--ink)` (`#22302a`)     | Alias. Light on dark vs. dark on light; fidice rules still read `--ink`.    |
| `--muted`       | `#9cc9ac`                                                                    | `#66746c`                    |                                                                             |
| `--danger`      | `#f87171`                                                                    | `var(--red)` (`#b8433a`)     | Alias. Fidice rules still read `--red`.                                     |
| `--radius`      | `18px`                                                                       | `16px`                       |                                                                             |
| `--felt`        | `radial-gradient(ellipse at 50% 30%, #1f5a3a 0%, #123a26 55%, #0b2418 100%)` | `#1f4d3a`                    | Gin paints the body with it; fidice uses it as a flat pine green.           |

No fidice rule reads the four aliases yet (`--bg --card-2 --text --danger`): they exist so the
vocabulary resolves everywhere, and the restyle is what points fidice's rules at the shared names.
Not tokens in either game: gin's `.card-box` shadow is inline (`0 4px 14px rgba(0,0,0,0.25)`) while
fidice has `--shadow: 0 8px 26px rgba(21,54,39,.16)`; neither names its body font stack
(`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif` vs.
`'Nunito', system-ui, sans-serif`).

Game-only tokens, unchanged and not shared: gin `--card-w --mini-w --pile-w --tiny-w` (the card
sizes, rescaled per element by `--tscale` and `--pile-base` on `#tableScreen`), still in its
`theme.css`; fidice `--felt-dark --felt-light --pine --pine-light --moss --lake --lake-deep
--lake-light --mist --wood --wood-dark --wood-light --timber --cream --cream-2 --birch --ink --red
--blue --line --shadow`.
