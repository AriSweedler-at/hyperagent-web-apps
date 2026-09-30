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
and stops the case.

**Measurement** (one page-side script, `measureScript`): the viewport and the document's size; the
body's `fixed-screen` and `data-frame`; `#app`'s computed padding and its `--gutter` where a theme
declares one; the union of the content boxes under `#app`, clipped to the viewport (a box counts
when it is visible, not clipped away as an `sr-only` span is, over a pixel each way, and paints
something: a text node of its own, media or a control, a fill, an image, a shadow or a border; a
surface covering 95% of the viewport both ways is a backdrop, not content); every `white-space:
nowrap` element wider than its box; every control's box (`button`, `a[href]`, inputs, selects,
`[role=button]`, the shell's `.btn .icon-btn .tab-btn .mode-btn .chip`); every text-bearing box
crossing one of the case's inset bands.

**The room.** Per side, what the shell's padding or the inset takes, whichever is more
(`roomOf`). Content may end at the room and waste nothing. The empty screen per side is the gap
from the viewport's edge to the used union's edge beyond the room, never negative (`emptyOf`), as
px and as a fraction of the viewport's height (top, bottom) or width (left, right).

**The judge** (`judge`, pure over one record: the page, the screen, the emulation, the
measurement), six checks, one column each in the `check` table:

| column    | rule                                                                                                                                                                                                                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `used`    | every side's empty fraction within the screen kind's limit (§3)                                                                                                                                                                                                                                                                                        |
| `scroll`  | the document never wider than the viewport; taller only on a screen kind that may scroll and a body that is not `fixed-screen` (one px is rounding)                                                                                                                                                                                                    |
| `clip`    | no nowrap element wider than its box                                                                                                                                                                                                                                                                                                                   |
| `targets` | every control at least 44px each way (the shell's `.icon-btn` and `.btn-sm` floor)                                                                                                                                                                                                                                                                     |
| `frame`   | `data-frame` on backgammon and on UI Sandbox (the frame's own demo), on no other page                                                                                                                                                                                                                                                                  |
| `gutter`  | on an unframed page the content at least 4px (the theme's `--gutter` where one exists; none does today) off every edge that has no inset (a framed page's clearance is shell-emulate's `clear`); on every page no text box under an inset band; while the document scrolls the bottom edge and band are skipped (below the fold is not under the glass) |

**Output.** Per page under `shots/space-audit/<page>/` (gitignored with the rest of `shots/`): a PNG
per case x screen at the device's pixel ratio, `index.html` (the contact sheet: one card per case in
`npm run shots`'s layout in the sandbox's dark palette; per screen the picture, the empty px and
fraction per side, the room and `#app`'s padding, the document against the viewport, the six checks,
red where one fails; the device line under each card) and `report.json` (every record, every
verdict, the totals). On stdout one `check` table per page (shell-emulate's `summaryTable`: one row
per case x screen, the six columns, `pass`/`FAIL`), the totals per page and a combined
`shots/space-audit/report.json`. Exit 1 on any failure.

**Running it.** `npm run build`, then `npm run audit:space` (all six pages, one after another;
minutes: four cases run at once, `--jobs`; six processes with `--game` and distinct `--port`s run
the pages side by side in about four minutes), or `npm run audit:space -- --game gin-rummy --device
iphone-390x844 --mode standalone`. `--url <site>` audits a served site instead of dist/; `--port`
fixes the local server's port (0, a free one, by default); `--out` moves the folder. The pure parts
(the judge, the room arithmetic, the command line, the cases, the sheet, the totals) are
`tools/space-audit/judge.test.ts`'s, in the harness suite; the drive is proved by running it.

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

What the judge does not know: a page's own scroll tiers. Backgammon's theme scrolls upright by
design under 806px tall (theme.css §3.10; shell-emulate's twin says `scrolls`), gin's under its
short-phone tier (theme.css: `body.fixed-screen { height: auto }` where two rows and the piles do
not fit); the audit's `scroll` column reads `fixed-screen` alone and flags both. A second pass
should read each page's tier (backgammon's through `twinOf(e).scrolls`) before failing the row.

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
  column runs 612-828px tall in a 375-440px viewport on a `fixed-screen` body (`scroll`, 56 sideways
  cases each). Real, and the largest finding: an upright game held sideways either gates and locks
  as backgammon does (`ShellConfig.orientation: 'portrait'`, the sandbox's mirror) or lays its
  table out for landscape.

**gin-rummy** (0 of 112):

- Home: the column ends 30.8-34.8% above the bottom on 10 phones upright standalone and fullscreen
  (24 cases; the XR/XS Max 34.8%, the 12 30.8%): over the owner's 30% by 1-5 points, so either
  the last card sits higher than it need or the allowance is a point low. Real, marginal.
- Table controls under 44px: `#discardsBtn` 36x36, `#arrangeBtn` 67x20, every case. Real.
- Table `scroll` 60: 56 sideways (above) and 4 upright on the SE and the Galaxy, where gin's own
  short-phone tier lifts `fixed-screen` (theme.css `body.fixed-screen { height: auto }`). Tier.
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

**briscola** (9 of 112):

- Table `gutter` 63: `#playBtn` and `#deckBtn` under the home indicator on every notched phone
  upright and sideways (env(): briscola pads `calc(12px + env(safe-area-inset-bottom))`), and the
  topbar under the notch upright standalone and fullscreen (shell-wide, Real).
- Table `used` 36 and `scroll` 57 (56 sideways: shell-wide; 1 upright on the SE in a tab with the
  bar shown, 375x553, where three cards and the trick do not fit: Real, the short-phone budget).
- Every control is 44px; nothing clips. The nine passing cases are the notch-free Galaxy and the
  SE in a tab upright.

**backgammon** (73 of 112; the framed page):

- `scroll` 26, all upright, every viewport 805px tall or less (the tabs on every iPhone, the SE
  and the Galaxy in every mode): the §3.10 tier the theme intends. Tier; the judge should read the
  twin (§3).
- `clip` 24: `#oppName` by 25px on the 375-wide phones upright (the X, the mini: 16 cases) and
  `#statusLine` by 4px sideways in a tab (4 cases). Real: the seat's name slot is 25px short of
  "Ethan" at 375px, and the status line one word over at the narrowest sideways viewport.
- `targets` 9 upright: the points 39.3-43px tall on the X (39.8), the mini (39.3), the 12 (42.3),
  the 14 Pro class (41.9) standalone and fullscreen, and the Air with the bar hidden (43). Real
  against 74fd551a; #193 ("upright under the notch the chrome tightens so the rows reach 44px")
  landed after this run and may close it: re-run first.
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

**ui-sandbox** (0 of 112; one finding):

- The preview's controls (`#previewExampleSel`, `#previewNextBtn`, `#previewInfoBtn`) are 32px
  tall (`targets`, every case). Real, a tool's: 44px, or exempt tooling from the rule.
- `used`, `scroll`, `frame` and `gutter` pass on every case: example (a) fills the room within 2%
  on every phone, both ways.

**The audit itself** (what the second pass teaches it): the pages' scroll tiers (§3); a
`ShellConfig.orientation` read so a gated orientation is judged by its gate and not its table;
the sandbox's other examples; the iPads by default once a desktop layout has its own limits.
