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

The `:root` custom properties of the two themes, side by side (docs/MIGRATION.md step 14). A name
both themes declare is the shared vocabulary; `web/shared/styles/tokens.css` holds a value only
when both games agree on it, and today none do, so its `:root` is empty and every value below lives
in the game's `theme.css`. The computed-style goldens pin each page's declared custom properties
and their `:root` values, so this table is the input to the Fidice restyle (the roadmap step that
re-records them), not a plan for this step. Columns are five on purpose: `test/dist/classes.ts`
reads the six-column class table above and nothing else.

| Shared name     | gin-rummy                                                                             | fidice                            | Status   | Notes                                                                    |
| --------------- | ------------------------------------------------------------------------------------- | --------------------------------- | -------- | ------------------------------------------------------------------------ |
| `--felt`        | `radial-gradient(ellipse at 50% 30%, #1f5a3a 0%, #123a26 55%, #0b2418 100%)`          | `#1f4d3a`                         | per-game | gin paints the body with it; fidice uses it as a flat pine green.        |
| `--card`        | `#163526`                                                                             | `var(--birch)` (`#fbf7ef`)        | per-game | Dark panel vs. light birch card.                                         |
| `--accent`      | `#4ade80`                                                                             | `#d9782f`                         | per-game | Green vs. orange.                                                        |
| `--accent-dark` | `#22c55e`                                                                             | `#a9561d`                         | per-game |                                                                          |
| `--gold`        | `#fbbf24`                                                                             | `#e6a93c`                         | per-game |                                                                          |
| `--muted`       | `#9cc9ac`                                                                             | `#66746c`                         | per-game | Light on dark vs. dark on light.                                         |
| `--radius`      | `18px`                                                                                | `16px`                            | per-game |                                                                          |
| `--text`        | `#f2fdf6`                                                                             | `--ink: #22302a`                  | per-game | Same role, different name: the restyle aliases fidice's `--ink` onto it. |
| `--danger`      | `#f87171`                                                                             | `--red: #b8433a`                  | per-game | Same role, different name (`--red`).                                     |
| `--shadow`      | `0 4px 14px rgba(0,0,0,0.25)` (inline in `.card-box`)                                 | `0 8px 26px rgba(21,54,39,.16)`   | per-game | Not a gin token yet.                                                     |
| body font       | `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif` | `'Nunito', system-ui, sans-serif` | per-game | Neither game names its font stack as a token.                            |

Game-only tokens, unchanged and not shared: gin `--bg --card-2 --card-w --mini-w --pile-w --tiny-w`
(the card sizes are rescaled per element by `--tscale` and `--pile-base` on `#tableScreen`); fidice
`--felt-dark --felt-light --pine --pine-light --moss --lake --lake-deep --lake-light --mist --wood
--wood-dark --wood-light --timber --cream --cream-2 --birch --blue --line`.
