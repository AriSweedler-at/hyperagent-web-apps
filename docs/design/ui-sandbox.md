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

Orientation mode: `auto` (nothing), `landscape` (the shell's `orientation: 'landscape'`
behaviour on this page: the gate "Turn your phone sideways" on `PORTRAIT_PHONE`, "Go sideways"
where the device can lock, the rotation hint when the lock fails), `portrait` (the mirror: the gate
on `LANDSCAPE_PHONE`, a lock to `portrait`). The frame on or off with its three tokens (band 0-12px,
colour, hairline) written on the root live; the layout example; the flip. Stored under
`uiSandbox_mode`, `_frame`, `_band`, `_color`, `_hairline`, `_example`, `_flip`. The query overrides
a run without storing: `?example=rail&frame=off&mode=portrait&flip=on&band=3`, `?screen=preview`,
`?type=landscape-secondary` (the orientation type no emulator can set).

`ShellConfig.orientation` is not generalised in this PR (the sandbox gates itself); the
`createOrientationLock` adapter gained the `which` parameter the portrait lock needs.

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

`e2e/ui-sandbox.spec.ts` (the `site` suite, `pages` only): every supported phone sideways in a tab
with the bar up in both landscapes, sideways filling the screen, and upright in a tab, one context
each at the device's viewport, screen, pixel ratio and insets (`seamScript`). Per case: the frame's
four corners equal the catalogue's per the reach rule; `__uiSandbox.device()` equals the emulated
row; `__uiSandbox.map()` deep-equals `safeAreaMap` over the case; example (a) fits without scroll
and keeps 11px (band + hairline + gap) inside every edge; (g)'s three buttons sit in the free side's
segment; (h) shows exactly as many ears as the map holds, none over an arc or the cut. A screenshot
of (h) is attached per case.

### From a user's screenshot to a passing test

1. Read the readout they pasted: `device`, `screen`, `dpr`, `insets`, `type`, the corners.
2. `unknown: heuristic`: add a row to `DEVICES` in `web/shared/lib/devices.ts` with the screen, the
   pixel ratio, the insets, the radius (kylebshr/ScreenCorners) and the cut; cite the source in the
   row's comment, UNVERIFIED where the readout is the only one. A wrong number on a known row:
   correct it there.
3. `node --experimental-strip-types tools/shell-emulate.ts explain --device <id> --orientation
   landscape --mode browser` prints what the page will compute; `npm run shots` renders backgammon
   on the row; the sandbox spec at your offset runs the new row's four cases.
4. Fix what the screenshot shows differently (a wrong cut length moves the ears; a wrong radius
   moves the arcs), until the sweep is green.

Open: `tools/shell-emulate.ts --game ui-sandbox` (render the sandbox's states into the contact
sheet beside backgammon's) is not in this PR; the spec above is the regression sweep.
