# UI Sandbox

A tool page, no game: `web/games/ui-sandbox/`, served at games.sweedler.com/ui-sandbox/ and under
games/ui-sandbox/ on the Pages origin. The owner (2026-09-28): "make a standalone app that is merely
a demo of all this sizing stuff ... it will display your phone's information, as well as all the
viewport settings. It should work and do the right thing on ANY of my devices ... I can use this as a
sandbox to test stuff without having to worry about messing with real game code." And: "This will
ofc be hosted on games.sweedler.com and the 'game' will be called 'ui-sandbox'."

## 1. What it is

A plain page on the shell's frame (`<body data-frame>`, `web/shared/styles/shell.css`) and the
shell's edge modules, with no engine, no reducer and no sessions: `main.ts` reads the frame
(`web/shared/edge/screen.ts` `applyFrame`, `watchFrame`), computes the safe-area map
(`web/shared/lib/safeArea.ts`) and writes it on the root, spells the readout (`src/readout.ts`),
keeps the settings (`src/settings.ts`, the shell's prefs under `uiSandbox_*`), gates and locks the
orientation in either direction (`web/shared/edge/orientation.ts`, its `which` parameter) and lays
out the examples (`src/examples.ts`). Three screens from its menu: Info (the readout, the Copy
button, the map drawn), Settings, and "Preview screen with border" (the frame exactly as a game gets
it, around the chosen example).

Registered in `tools/games.ts` as a `TOOLS` row (a title and a hook, `window.__uiSandbox`), which
puts it in the smoke test's pages, the landing page's tools line and this table's README row; the
`site` suite claims its unit tests and its spec (`tools/ci/suites.ts`). The Worker maps any
`/<name>/` to `games/<name>/`, so no infra change.

## 2. The information panel

Live on `resize`, `orientationchange`, the visual viewport's `resize`, `fullscreenchange`, every
media query's `change` and `screen.orientation`'s `change`. One fact per line: the matched catalogue
row (id, models, UNVERIFIED where the row is) or "unknown: heuristic"; the corner radius and the
cut; `screen`, `devicePixelRatio`, the whole screen turned; `innerWidth x innerHeight` and the
visual viewport with its scale; `100svh/dvh/lvh/vw` in px (measured off four hidden rulers); the four
safe-area insets; the display mode, the orientation and `screen.orientation.type`; the browser bar's
state as the reach rule's corners imply it (`barOf`: every corner the screen's, hidden; the top pair
square, a bar at the top; the bottom pair, at the bottom); each corner's radius or `square`; the
frame and flip flags; the cut's side and span, the ear; every edge's usable segments; then every
media query the shell uses and the common ones with its match. Copy puts the block on the clipboard
for a bug report beside a screenshot.

## 3. The safe-area map

`web/shared/lib/safeArea.ts`, pure, 100% branches. Inputs: the frame's four radii as drawn, the
catalogue's cut (`Device.cut`: its length along the edge and whether it is an island), the
orientation type, the insets, the viewport and the whole screen. Rule:

1. An edge's span is its length less each rounded corner's arc plus 4px (a square corner spares
   nothing: it is the browser's).
2. The cut sits centred on one edge. Sideways: the one side whose inset alone is non-zero (an
   Android cutout fullscreen), else `landscape-primary` puts it on the LEFT and
   `landscape-secondary` on the right. Source: the Screen Orientation spec's "current orientation
   angle" is the counter-clockwise rotation from the natural (portrait) orientation, and
   landscape-primary is 90° (w3c.github.io/screen-orientation, read 2026-09-29, VERIFIED): the top
   edge, the cut's, ends on the left. That iOS 16.4+ follows the spec's table is UNVERIFIED on a
   phone; the readout shows the type, so one screenshot settles it. Upright: the top
   (`portrait-secondary` the bottom, Android alone).
3. The cut is on the page only where the page reaches its edge (a non-zero inset there). Under a
   browser bar (upright in a Safari tab: the top inset reads 0) the edge is the browser's, one plain
   span. Sideways in a tab with the bar at the top, the cut's centre is the screen's middle shifted
   up by the bar (the viewport shorter than the screen with the bottom edge proven by its inset).
4. The cut's edge splits in two ears, each kept only when at least 44px long (a tap target). An
   island phone at 393pt: two ears of 68.5px. An old-notch phone at 390pt: 33px each, none kept.
5. A half turn of the content (`body[data-flip]`) reads `flipMap`: every edge swapped for its
   opposite, every span mirrored through the viewport's centre.

The boot writes `safeAreaVars` on the root: `--notch-side`, `--ear-height`, per edge
`--safe-<edge>-count`, `--safe-<edge>-from`/`-to` and `--safe-<edge>-2-from`/`-2-to`, the owner's
`--safe-left-top`/`-bottom` and `--safe-right-top`/`-bottom`, `--safe-free-side` with
`--safe-free-from`/`-to` (the vertical side without the cut), `--safe-cut-from`/`-to`; and three
root attributes for CSS to branch on: `data-notch-side`, `data-free-side`, `data-ears`.

Cut lengths (`devices.ts`, every one UNVERIFIED, the larger of a row's classes): the X-class notch
209pt (the 12's the same; the 13's and 14's 162pt); the XR's 230pt at 2x; the Dynamic Island 126pt
x 37pt (14 Pro and every Pro since, the 15 and 16 lines, the 17s, the Air); a Pixel's or Galaxy's
hole ≈ 40dp. Apple publishes none (the HIG's Layout page gives safe areas, not the cut:
developer.apple.com/design/human-interface-guidelines/layout, UNVERIFIED for the numbers); the
figures are the design community's (the paintcodeapp and Wikipedia pages were fetched 2026-09-29
and carry no cut dimensions, so they stand on designer templates alone). "Write TO the notch":
no. Nothing renders under a notch or an island; the hardware is opaque.

## 4. Settings

Orientation mode: `auto` (nothing), `landscape` (the shell's `orientation: 'landscape'` behaviour
on this page: the gate "Turn your phone sideways" on `PORTRAIT_PHONE`, "Go sideways" where the
device can lock, the rotation hint when the lock fails), `portrait` (the mirror: the gate "Turn your
phone upright" on `LANDSCAPE_PHONE`, "Go upright", a lock to `portrait`). The frame on or off with
its three tokens (band 0-12px, colour, hairline) written on the root live; the layout example; the
flip. Stored under `uiSandbox_mode`, `_frame`, `_band`, `_color`, `_hairline`, `_example`, `_flip`.
The query overrides a run without storing: `?example=rail&frame=off&mode=portrait&flip=on&band=3`,
`?screen=preview`, `?type=landscape-secondary` (the orientation type no emulator can set).

The gate is the shell's, not the page's own: the markup is `gateMarkup`'s block (the same ids and
classes, shell.css's z-index and glyph, the texts shipped empty), the decision is
`web/shared/ui/shell.ts` `wrongWay(orientation, { portraitPhone, landscapePhone })` (the predicate
`gateOpen` reads), the paint is `web/shared/ui/shellPaint.ts` `paintGate(doc, open, canLock,
GATE_COPY[orientation])` (`inert` on `#app`, focus to the first control, the four texts for the way
asked), and the lock is `createOrientationLock(doc, screen, which)`. `ShellConfig.orientation` is
`'landscape' | 'portrait' | 'any'` (docs/design/shared-shell.md §6.6): backgammon's page carries
its own words in its markup; this page passes `GATE_COPY`'s row on every paint because the setting
changes live. What the page keeps of its own: the dismissal for the run, the lock's toast.

## 5. The layout examples

Each a plain flex or grid of coloured boxes with their measured size, inside the shell-padded
`#app`: (a) one box; (b) a 44px side bar + content; (c) two side bars + content; (d) a 22px top
strip + content; (e) two strips; (f) backgammon's shape (strip + 13-column grid + 44px rail); (g) a
rail of three 44px buttons on the free side, at the glass inside the band, between the arcs
(`--safe-free-*`); (h) one 44px button in each ear of the cut's side (`--safe-<side>-*`), shown
only where an ear fits, the note saying why otherwise; (i) today's symmetric gutters. The Report
button prints whether the example fits without scroll, its gaps to the frame and which map
segments its fixed boxes use (`OVER AN ARC OR THE CUT` where one is misplaced). A half turn of the
phone (landscape-primary to -secondary) moves (g) and (h) across live: the `change` of
`screen.orientation` repaints.

## 6. Emulation and regression

Two nets over the same cases, so a phone that fails one fails the other:

`e2e/ui-sandbox.spec.ts` (the `site` suite, `pages` only): every supported phone sideways in a tab
with the bar up in both landscapes, sideways filling the screen, and upright in a tab, one context
each at the device's viewport, screen, pixel ratio and insets (`seamScript`): 14 phones x 4 = 56
cases. Per case: the frame's four corners equal the catalogue's per the reach rule;
`__uiSandbox.device()` equals the emulated row; `__uiSandbox.map()` deep-equals `safeAreaMap` over
the case; example (a) fits without scroll and keeps 11px (band + hairline + gap) inside every edge;
(g)'s three buttons sit in the free side's segment; (h) shows exactly as many ears as the map
holds, none over an arc or the cut. A screenshot of (h) is attached per case.

`tools/shell-emulate.ts --game ui-sandbox` (`list`, `explain`, `render`, `check`; a sweep without
`--game` takes backgammon and the sandbox both, so `npm run shots` renders the two into one contact
sheet under gitignored `shots/<stamp>/index.html`): the same phones x every emulation (both
orientations x the three display modes, the tab twice) x the orientation types (both landscapes,
the one portrait) = 168 cases, the spec's 56 among them. `render` shoots the preview screen around
examples (a), (f), (g), (h) and (i) per case and puts the readout's device line under the shots;
`check` (`judgeSandbox`, pure, tools/shell-emulate.test.ts) asserts what the spec asserts: `corner`,
`device`, `map`, `fits`, `rail`, `ears`, `scroll`, one summary table per game, `--json` for the
report, exit 1 on any failure. `explain --game ui-sandbox` prints the map a case must produce (the
cut's side and span, the ear, every edge's segments, where (g) and (h) land) with no browser.

### From a user's screenshot to a passing test

The input is the readout's Copy text beside the screenshot (Info screen, "Copy readout"), for example:

```
device iphone-393x852  iPhone 14 Pro, 15, 15 Pro, 16
corner radius 55px  cut 126pt island
screen 393x852  dpr 3  full 852x393
inner 852x343  visualViewport 852x343 @1
insets top 0  right 59  bottom 21  left 59
display-mode browser  orientation landscape  type landscape-primary
browser bar at the top (the top corners are its)
reaches tl square  tr square  br 55  bl 55
cut side left  at 83.5-209.5 (126)  ear 68.5
safe left: 0-77.5 (77.5), 215.5-284 (68.5)
```

1. The `device` line. `unknown: heuristic`: add a row to `DEVICES` in `web/shared/lib/devices.ts`
   with the `screen`, the `dpr`, the `insets` (upright and sideways: two screenshots, or the
   readout twice), the radius (kylebshr/ScreenCorners) and the cut; cite the source in the row's
   comment, UNVERIFIED where the readout is the only one. A known row whose numbers differ from the
   readout's: correct the row.
2. `node --experimental-strip-types tools/shell-emulate.ts explain --device <id> --game ui-sandbox
   --orientation landscape --mode browser` prints the map the page will compute for the row under
   both landscape types; compare its `cut side ... at ...` and `safe <edge>` lines with the
   readout's. A difference is a wrong `cut` (its length moves the ears and the cut's span), a
   wrong `corner` (moves the arcs), or a wrong inset.
3. `node --experimental-strip-types tools/shell-emulate.ts check --device <id> --game ui-sandbox
   --serve` drives the row (after `npm run build`); `npm run shots` puts it on the sheet;
   `E2E_PORT_OFFSET=<n> npx playwright test e2e/ui-sandbox.spec.ts --project=pages` runs the row's
   four cases.
4. Fix until the check and the spec are green, then compare the sheet's (h) with the screenshot:
   the buttons sit where the phone's ears are.

### UNVERIFIED, and the one screenshot that settles each

1. iOS's `landscape-primary` is the notch on the LEFT (the Screen Orientation spec's angle table,
   which the map follows; that iOS follows it is the open part). The screenshot: an iPhone held
   sideways with the notch on the left, the Info screen; its `type` line must read
   `landscape-primary`. `landscape-secondary` with the notch on the left means the map's
   `cutEdgeOf` must swap the two.
2. The cut lengths per model (`Device.cut`: 209pt X-class, 230pt XR, 126pt island, 40dp hole).
   The screenshot: the Preview screen on example (h) sideways; the two buttons must clear the
   notch or the island with the 6px `CUT_MARGIN` of air, neither under it nor far from it. The
   readout's `cut side ... at a-b` gives the span the page assumed; the distance in the screenshot
   gives the correction.
3. The 375x812 pair (the X and the 12 mini) is indistinguishable upright in a tab (the notch reads
   0, both are 3x, the first row stands). The screenshot: a 12 mini upright in a Safari tab, the
   Info screen; the `device` line reads `iphone-375x812-x`. If the corner radius in the
   screenshot's frame is the mini's 44 and not the X's 39, the match needs a second input (the
   `visualViewport` height or `100lvh` under the bar differ by the models' toolbar heights: the
   `toolbar` ranges are UNVERIFIED too, and one screenshot per model with the bar up gives both).
