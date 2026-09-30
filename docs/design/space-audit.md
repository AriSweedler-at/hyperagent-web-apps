# The space audit

Status: implemented 2026-09-30 (the PR "The space audit: every page on every phone, six rules, a
check table and dark sheets"). Follows docs/design/devices.md (the catalogue and the emulator),
docs/design/screen-frame.md (the frame backgammon alone carries) and docs/design/ui-sandbox.md (the
design language the sheets borrow).

## 1. The ask

The owner, 2026-09-30: "now that we have a better story around the shell bordering stuff, audit
all games. Only backgammon gets a border. But just check each game in its own subagent to make sure
it looks reasonable and doesn't waste space. Dispatch a subagent to find a deterministic way to
accomplish this. Utilize the design language that the shell has developed in making this UI
playground."

So: a tool, not a reading. `tools/space-audit.ts` stands every page on every catalogued phone and
measures it; `tools/space-audit/judge.ts` says pass or fail by one table of thresholds; the sheets
under `shots/space-audit/<page>/` show what was measured so the owner can look, then decide. The
per-game rows (`space-audit-gin`, `-fidice`, `-briscola`, `-rps`) act on §5.

## 2. The method

**Cases.** Every supported phone in `web/shared/lib/devices.ts` (the iPads reach the audit through
`--device`) x both orientations x the display modes `emulationsOf` names (a browser tab twice, bar
shown and hidden; standalone; fullscreen): 14 phones x 8 = 112 cases per page. Each is a Playwright
Chromium context at the device's viewport, screen and pixel ratio (`isMobile`, `hasTouch`), the
case's insets fed through the shell's seam (`tools/shell-emulate.ts` `seamScript`: the root's
`--frame-inset-*` and `#app`'s `--inset-*`; headless reads every `env()` as 0 and no CDP call sets
them), and one seed for every deal (`SEED_SCRIPT`), so a sheet compares phones, not shuffles.

**Screens.** Two per page, in the order the drive reaches them: the home (the page loaded, its
documented hook up, the animations settled) and the second screen: the table through the shell's
pass-and-play start (the switch, two names, Start, the curtain lifted; backgammon's turn gate kept,
its roll modal rolled, the dice still) for gin, fidice (the shell path, `?shell=1`), briscola and
backgammon; the armed round after Go for rps; the preview screen around example (a) for UI Sandbox
(its home is the Info screen). A screen the drive cannot reach fails every column with the reason
and stops the case. A page that plays one way (`<body data-plays>`, `ShellConfig.orientation`;
backgammon plays sideways) held the other way stops at the shell's turn gate: that is its `table`
screen upright, judged as a gate (below). Backgammon then adds a third screen upright only, `kept`:
the gate dismissed with "Play upright" and the board rolled, the player's opt-out, judged as a table
with the tier the theme intends (a second run since 2026-09-30; 56 more screens on its 224).

**Measurement** (one page-side script, `measureScript`): the viewport and the document's size; the
body's `fixed-screen` and `data-frame`; `#app`'s computed padding and its `--gutter` where a theme
declares one; the union of the content boxes under `#app`, clipped to the viewport (a box counts
when it is visible, not clipped away as an `sr-only` span is, over a pixel each way, and paints
something: a text node of its own, media or a control, a fill, an image, a shadow or a border; a
surface covering 95% of the viewport both ways is a backdrop, not content); every `white-space:
nowrap` element wider than its box; every control's box (`button`, `a[href]`, inputs, selects,
`[role=button]`, the shell's `.btn .icon-btn .tab-btn .mode-btn .chip`); every text-bearing box
crossing one of the case's inset bands; the body's `data-plays`; whether a `fixed-screen` body's
computed `overflow-y` is `visible` (`lifted`: the theme's own scroll tier took the fixed screen
away, as gin's and backgammon's theme.css do under their short-viewport queries); whether the turn
gate (`#turnGate`) is shown.

**The room.** Per side, what the shell's padding or the inset takes, whichever is more
(`roomOf`). Content may end at the room and waste nothing. The empty screen per side is the gap
from the viewport's edge to the used union's edge beyond the room, never negative (`emptyOf`), as
px and as a fraction of the viewport's height (top, bottom) or width (left, right).

**The judge** (`judge`, pure over one record: the page, the screen, the emulation, the
measurement), six checks, one column each in the `check` table. Each column's outcome is one of
four: `ok` and `FAIL` count; `tier` and `gate` pass and print grey on the sheet: the page means it.

| column    | rule                                                                                                                                                                                                                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `used`    | every side's empty fraction within the screen kind's limit (§3); under a gate (below), that the turn gate stands                                                                                                                                                                                                                                       |
| `scroll`  | the document never wider than the viewport; taller only on a screen kind that may scroll and a body that is not `fixed-screen` (one px is rounding); taller where the page's tier means it is `tier`: backgammon's twin (`twinOf(e).scrolls`: §3.10's upright tier at most 805px tall, the landscape floor sideways) or a `lifted` fixed-screen body |
| `clip`    | no nowrap element wider than its box                                                                                                                                                                                                                                                                                                                   |
| `targets` | every control at least 44px each way (the shell's `.icon-btn` and `.btn-sm` floor)                                                                                                                                                                                                                                                                     |
| `frame`   | `data-frame` on backgammon and on UI Sandbox (the frame's own demo), on no other page                                                                                                                                                                                                                                                                  |
| `gutter`  | on an unframed page the content at least 4px (the theme's `--gutter` where one exists; none does today) off every edge that has no inset (a framed page's clearance is shell-emulate's `clear`); on every page no text box under an inset band; while the document scrolls the bottom edge and band are skipped (below the fold is not under the glass) |

**The gate** (`gatedOf`): the body's `data-plays` names the other orientation, the screen is past
the home and the player did not keep the phone (`Screen.kept`). The turn gate is the screen: `used`
is the gate standing (a missing gate is the failure, there), `frame` is judged as ever, and
`scroll`, `clip`, `targets` and `gutter` are `gate`. A gate standing the way the page plays fails
`used` on a plain screen: the audit is looking at a sheet, not a table.

**Output.** Per page under `shots/space-audit/<page>/` (gitignored with the rest of `shots/`): a PNG
per case x screen at the device's pixel ratio, `index.html` (the contact sheet: one card per case in
`npm run shots`'s layout in the sandbox's dark palette; per screen the picture, the empty px and
fraction per side, the room and `#app`'s padding, the document against the viewport, the six checks,
red where one fails, grey with a `tier` or `gate` badge where the page means it; the device line
under each card) and `report.json` (every record, every verdict with its outcomes, the totals). On
stdout one `check` table per page (`tools/space-audit/rows.ts` `checkTable`: one row per case x
screen, the six columns, `ok`/`FAIL`/`tier`/`gate`, `pass`/`FAIL` last), the totals per page and a
combined `shots/space-audit/report.json`. Exit 1 on any failure.

**Running it.** `npm run build`, then `npm run audit:space` (all six pages, one after another;
minutes: four cases run at once, `--jobs`; six processes with `--game` and distinct `--port`s run
the pages side by side in about four minutes), or `npm run audit:space -- --game gin-rummy --device
iphone-390x844 --mode standalone`. `--url <site>` audits a served site instead of dist/; `--port`
fixes the local server's port (0, a free one, by default); `--out` moves the folder. `--baseline
<page report.json>` (an earlier run's, the first run's `pass`-only checks included) prints, instead
of the check table, only the rows whose outcome moved in any column (`scroll FAIL→tier`), so a
per-game lane sees what its change moved and nothing else. The pure parts (the judge, the room
arithmetic, the tiers and the gate, the command line, the cases, the sheet, the rows, the diff, the
totals) are `tools/space-audit/judge.test.ts`'s, in the harness suite; the drive is proved by
running it.

## 3. The thresholds and why

`LIMITS` in `tools/space-audit/judge.ts`, a comment per number:

| screen kind                    | top | right | bottom | left | may scroll | why                                                                                                                                                                                 |
| ------------------------------ | --- | ----- | ------ | ---- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `home`                         | 10% | 25%   | 30%    | 25%  | yes        | the masthead sits at the top; the shell's 480px column centred sideways leaves (956 - 480) / 2 = 24.9% a side on the widest phone; the owner's allowance of 30% under the last card |
| `table` (and rps's play)       | 8%  | 8%    | 8%     | 8%   | no         | the owner's brief: a table fills its room, at most 8% empty on any side                                                                                                             |
| `tool` (the sandbox's preview) | 2%  | 2%    | 2%     | 2%   | no         | example (a) is one box at the room's edge within `FILL_SLACK` (1px): 2% is that slack's rounding on a 50px side                                                                     |

Constants: `TOL` 0.5px (the rounding between two reads of one layout), `TARGET_MIN` 44, `GUTTER`
4 (shell.css's `--frame-gap`: the air the frame keeps; an unframed page keeps the same off the
glass), `SCROLL_SLACK` 1px.

What the emulation cannot see: a theme that reads `env(safe-area-inset-*)` directly (gin's and
briscola's `#app` bottom padding, rps's `#app` padding on all four sides) reads 0 under the seam,
which feeds the shell's `--frame-inset-*` and `--inset-*` alone. A `gutter` failure on such a side
is UNVERIFIED on a phone; the fix that makes it visible to the audit and the emulator alike is to
read the shell's variables instead of `env()`.

What the judge reads of the page's intent (the second pass, 2026-09-30): the scroll tiers, through
backgammon's twin (`twinOf(e).scrolls`: theme.css §3.10, at most 805px tall upright; the landscape
floor sideways, under which no catalogued phone falls) and through the measured `lifted` (a
`fixed-screen` body whose theme set `overflow: visible`: gin's `(max-height: 661px)` and its
three-row `(max-height: 736px)` tiers, backgammon's two), both `tier`; and the way the page plays,
through `data-plays`, so the orientation it gates against is judged by its gate (§2). The tier
read is the page's own CSS as applied, not a table that could drift from it; the twin is the model
the emulator already checks the page against.

## 4. The first run

2026-09-30, over dist/ built from 74fd551a (before #193 and #194 landed on main; a re-run after
the rebase is the per-game rows' first step), 14 phones x 8 cases x 2 screens per page:

| page       | cases pass | screens pass | failures per column (of 224 screens)                        |
| ---------- | ---------- | ------------ | ----------------------------------------------------------- |
| gin-rummy  | 0 of 112   | 0 of 224     | used 60, scroll 60, clip 0, targets 224, frame 0, gutter 84 |
| fidice     | 0 of 112   | 0 of 224     | used 0, scroll 0, clip 0, targets 224, frame 0, gutter 224  |
| briscola   | 9 of 112   | 97 of 224    | used 36, scroll 57, clip 0, targets 0, frame 0, gutter 87   |
| backgammon | 73 of 112  | 185 of 224   | used 0, scroll 26, clip 24, targets 9, frame 0, gutter 0    |
| rps        | 5 of 112   | 74 of 224    | used 60, scroll 74, clip 0, targets 0, frame 0, gutter 129  |
| ui-sandbox | 0 of 112   | 112 of 224   | used 0, scroll 0, clip 0, targets 112, frame 0, gutter 0    |

The `frame` column is clean everywhere: backgammon and the sandbox carry `data-frame`, no other
page does. No screen failed to be reached.

### 4.1 The second run

2026-09-30, over dist/ built from 0b92447b (#193's tight tier and #194's sandbox in), with the
judge as §2 now describes it (the tiers, the gate, the Android lock), each page run with
`--baseline` the first run's report. `tier` and `gate` are outcomes, not failures, and are counted
apart; backgammon has a third screen upright (`kept`), so 280 screens.

| page       | cases pass | screens pass | failures per column                          | by design                        |
| ---------- | ---------- | ------------ | -------------------------------------------- | -------------------------------- |
| gin-rummy  | 0 of 112   | 0 of 224     | used 60, targets 224, gutter 84              | scroll tier 60 (was FAIL 60)     |
| fidice     | 0 of 112   | 0 of 224     | targets 224, gutter 224                      | none (no change)                 |
| briscola   | 13 of 112  | 101 of 224   | used 36, gutter 87                           | scroll tier 57 (was FAIL 57)     |
| backgammon | 92 of 112  | 260 of 280   | clip 20, targets 4                           | gate 56 + 8 kept, scroll tier 22 |
| rps        | 5 of 112   | 74 of 224    | used 60, scroll 74, gutter 129               | none (no change)                 |
| ui-sandbox | 0 of 112   | 112 of 224   | targets 112                                  | none (no change)                 |

What moved against the first run: gin's and briscola's `scroll` columns are clean (every one of
their scrolls is a theme's tier, read as `lifted`); backgammon's upright `table` rows are the gate's
(and on the Android rows the lock's), its `kept` rows carry the §3.10 tier and the upright board's
real findings; nothing else changed, the sandbox's `targets` after #194 included. The `--baseline`
diff printed exactly those rows and no other.

## 5. Findings per game

The list the per-game rows act on. "Real" is a finding the emulation stands behind; "env()" is one
the seam cannot verify (§3), to settle on a phone or by reading the shell's variables; "tier" is a
scroll the page's own theme intends (§3).

**Shell-wide** (gin, fidice and briscola share these; one fix each in the shell):

- The unframed shell pads `#app` for no inset (shell.css pads by the insets under `body[data-frame]`
  alone). Upright standalone and fullscreen on every notched phone the `h1` sits under the notch
  (`gutter`: `h1 (top)`, 24 home cases per game), and at the table so do the topbar's controls
  (`#leaveBtn`, `#handoffBtn`, `#soundBtn`, `#rulesBtnGame`, `#historyBtn`, `#roundBadge`;
  briscola's `#menuBtn`, `#trumpName`). Real. The fix: an unframed `#app` padded by
  `max(<its gutter>, var(--frame-inset-*))`, which the seam then feeds and the audit then sees.
- The shell's tab bar and mode switch are under 44px (`.tab-btn` 37-42px tall, `.mode-btn` 38-39px)
  on every home screen (`targets`, gin 112 and fidice 112 cases). Real; briscola's are 44.
- Sideways, every upright game is the shell's 480px column centred in an 812-956px viewport: the
  table leaves 17-18% empty a side (`used`, 36 cases each for gin and briscola, 56 for rps) and the
  column runs 612-828px tall in a 375-440px viewport (`scroll`, 56 sideways cases each). The second
  run reads the scroll as the themes mean it: gin's `(max-height: 661px)` and briscola's
  `(max-height: 638px) and (max-width: 899px)` tiers lift the fixed screen there, so their 56 are
  `tier`; rps has no fixed screen and no tier, so its 56 stand. The empty sides are Real either
  way, and the largest finding: an upright game held sideways either gates and locks as backgammon
  does (`ShellConfig.orientation: 'portrait'`, the sandbox's mirror) or lays its table out for
  landscape.

**gin-rummy** (0 of 112):

- Home: the column ends 30.8-34.8% above the bottom on 10 phones upright standalone and fullscreen
  (24 cases; the XR/XS Max 34.8%, the 12 30.8%): over the owner's 30% by 1-5 points, so either
  the last card sits higher than it need or the allowance is a point low. Real, marginal.
- Table controls under 44px: `#discardsBtn` 36x36, `#arrangeBtn` 67x20, every case. Real.
- Table `scroll` 60: 56 sideways (above) and 4 upright (the SE in a tab, bar shown and hidden; the
  X and the mini in a tab with the bar shown, at the three-row tier), where gin's own short-phone
  tiers lift `fixed-screen` (theme.css `body.fixed-screen { height: auto; overflow: visible }`).
  Tier: the second run marks all 60 `tier` (`lifted`); gin's `scroll` column is clean.
- Table `gutter` 60: 44 upright with the topbar under the notch (shell-wide, Real) and 20 with the
  actions row (`button.btn (bottom)`) under the home indicator. env(): gin pads the bottom
  `calc(16px + env(safe-area-inset-bottom))`, which the seam cannot feed.

**fidice** (the shell path; 0 of 112, `targets` and `gutter` on every screen):

- The home hugs the glass: fidice's theme sets `#app { max-width: none; margin: 0 }` with no
  padding, so the brand, the subtitle and the tabs sit within 4px of the top (every case), sideways
  within 4px of the left and right too (24 cases) and under the side notches on every notched
  phone (`h1.brand`, `span.cup`, `div.subtitle`, `#tabPlayBtn`, `#tabAboutBtn`, `.mode-btn`; 44
  cases). Real: the restyle (docs/design/fidice-shell-adoption.md §4.6) gives the page the shell's
  column and the inset padding.
- The legacy table (`#screen-game` in `#fidiceTable`) sits within 4px of the top on every case and
  under the side insets sideways (`#leaveBtn`, `#ladderBtn`, `div.nm`, `div.turnbar`, the status
  and the ladder rows), under the home indicator upright (`#btnPlaceBid`, the ghost button, `h3`).
  Real.
- Legacy controls under 44px, every case: `#rollCupCb` (a 13x13 checkbox), `#btnRoll` 62x42,
  `#btnPlaceBid` 96x40, the `.btn-ghost` 119x30, `#btnLeaveGame` 32px tall; on the home `#nameInput`
  42px tall and `#btnConfigSolo` 36px wide. Real (the restyle's list).
- `used` and `scroll` pass on every case: the full-width legacy layout fills both ways.

**briscola** (9 of 112 in the first run; 13 of 112 in the second):

- Table `gutter` 63: `#playBtn` and `#deckBtn` under the home indicator on every notched phone
  upright and sideways (env(): briscola pads `calc(12px + env(safe-area-inset-bottom))`), and the
  topbar under the notch upright standalone and fullscreen (shell-wide, Real).
- Table `used` 36 (sideways: shell-wide) and `scroll` 57 (56 sideways; 1 upright on the SE in a
  tab with the bar shown, 375x553). Tier, all 57: briscola's theme scrolls by design under 638px
  tall on a phone ("the document scrolls instead of clipping the actions row"; `--card-w` floored
  at 72px makes a 639px column), which the second run reads as `lifted`. The SE's 553px is that
  tier, not a budget miss.
- Every control is 44px; nothing clips. The passing cases are the notch-free Galaxy and the SE in a
  tab upright, plus the four the tier read freed.

**backgammon** (73 of 112 in the first run; 92 of 112 in the second, 260 of 280 screens; the
framed page, the one that plays sideways):

- Upright the `table` screen is the turn gate (§2): it stands on every iPhone row (48 cases; the
  drive drops `screen.orientation.lock` there, as no iPhone browser has one) and on the Android
  rows the shell's lock is held instead (8 cases, `locked`: the page turned the phone, which the
  emulated viewport cannot follow), so `used` passes on all 56 and the four other columns are
  `gate`. The 8 Android `kept` rows are the lock's too.
- `scroll` 26 upright in the first run: now `tier` 22 on the `kept` board (the twin's §3.10 tier
  at most 805px tall: every iPhone tab, the SE in every mode), the 4 Galaxy rows under the lock.
  Clean.
- `clip` 24 → 20: `#oppName` on the kept board by 25px on the 375-wide phones upright (the X, the
  mini, the SE: 12 cases) and by 10px on the 390-wide 12 (4 cases, new against 74fd551a: the tight
  tier's narrower chrome), and `#statusLine` by 7px sideways on the mini in every mode (4 cases; 4px
  in a tab before). Real: the seat's name slot is short of "Ethan" at 375-390px, the status line a
  word over at the narrowest sideways viewport.
- `targets` 9 → 4: #193's tight tier reaches 44px on the 12, the 14 Pro class and the Air; the X
  (41.8) and the mini (41.3) standalone and fullscreen are still short, the 375-wide room under the
  notch being 12px less than the tier's arithmetic assumes. Real.
- `used`, `frame` and `gutter` pass on every case: the framed board fills its room both ways.

**rps** (5 of 112):

- Play `scroll` 74: 56 sideways (the 480px column, shell-wide) and 18 upright on the SE, the
  Galaxy and every tab with the bar shown, where the page (buddy, tally, table, hands, controls,
  foot) is taller than the viewport with no `fixed-screen` and no short tier. Real: the play
  screen needs a height budget as the tables have.
- Play and home `used` sideways: 17.9% empty a side (56 play cases), and on the Pixel's 915px
  viewport the home's column reaches 25.1-25.5% (4 cases): the shell-wide finding, plus a
  threshold sitting exactly at the widest Android's column. Real; the limit may move to 26%.
- `gutter` 129: upright standalone and fullscreen `h1`, `p.sub` and `#soundBtn` under the notch
  and `#resetBtn` under the home indicator (44 cases; env(): rps pads `#app` by `env()` on all four
  sides, unreadable under the seam), and sideways the header within 4px of the top in 57 cases
  (Real: sideways the top inset is 0 on a phone too, so the bar meets the glass; a 4px gutter).
- Every control is 44px; nothing clips.

**ui-sandbox** (0 of 112; one finding, unchanged after #194):

- The preview's controls (`#previewExampleSel`, `#previewNextBtn`, `#previewInfoBtn`) are 32px
  tall (`targets`, every case). Real, a tool's: 44px, or exempt tooling from the rule.
- `used`, `scroll`, `frame` and `gutter` pass on every case: example (a) fills the room within 2%
  on every phone, both ways.

**Closed by shell-unframed-insets** (the shell's inset rule; docs/design/shared-shell.md §6.7):

- The unframed shell's inset padding: `:where(body:not([data-frame])) #app` pads the top and the foot
  by the theme's `--gutter` (gin and briscola 12px, gin's foot 16, briscola 16 from 900px; fidice 0)
  or the safe-area inset where that is more, and `body:not([data-frame])` carries the side insets,
  so the `h1` and the topbar clear the notch installed and fullscreen on every shell page and the
  sideways column keeps its width (a side inset padded into a 480px column centred in 812-956px
  would take 70-100px of it for a notch it never reaches). Fidice's home and legacy table clear
  the insets with it; its column stays the restyle's.
- The `env()` findings: gin's and briscola's foot rows, briscola's raised toast and watermark, gin's
  voice button and rps's four sides now read the shell's `--frame-inset-*` (rps declares the four on
  its own `:root`), so the seam feeds them and the audit judges them as Real; the shell's own toast
  reads the same. `test/tokens.test.ts` holds that no other `env(safe-area-inset-*)` read exists
  in the shell or the four unframed themes.
- `.tab-btn` and `.mode-btn` reach 44px under `(any-pointer: coarse)`; the goldens (a fine pointer)
  record the type's height as before.
- Still open from the shell-wide list: the sideways 480px column (`used` and `scroll` sideways on
  every upright game), the owner's decision between the shell's portrait gate and a landscape
  layout; and rps's sideways header within 4px of the top (its gutter is 0 by design).

**The audit itself.** The second pass (this document's §2-§3 as they stand) taught it the pages'
scroll tiers, the way a page plays and the turn gate, the Android lock in the gate's place, and a
`--baseline` diff. Left: desktop cases (the owner, 2026-09-30: "There's also desktop": fine-pointer
windows of 900x700, 1024x768, 1280x800, 1440x900 and 1920x1080 in `browser` mode with no insets,
both screens, their own `LIMITS` rows (a home may leave 40% below its last card, a table at most
10% a side, targets 32px with a fine pointer) and a `desktop` group on the sheets; an `Emulation`
needs a catalogued `Device`, so this is a second case type through the judge, the drive, the sheet
and the rows); the sandbox's other examples; the iPads by default once a desktop layout has its
own limits.
