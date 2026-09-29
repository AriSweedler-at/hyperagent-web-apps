# The device catalogue, the emulator and the screenshot sheet

Status: implemented 2026-09-29 (the PR "The device catalogue, the shell-emulate CLI and the
screenshot sheet"). Follows docs/design/backgammon-board.md §3.6 (the corner table this grew from)
and precedes the screen-frame design (which takes `reachOf` and the per-corner radii from here).

## 1. The ask

The owner, 2026-09-28: "Add 'border sizing' into the shell. The application should just be able to
put the border in without considering anything else. This should all be dynamic so that as my
users get different phones it doesn't cause issues." / "You do not need my phone model and you do
not need the probe numbers. You must be able to figure this information out yourself (or,,, the
shell must. And there should be a CLI to interact with the shell engine in order to validate this
and emulate)" / "add unit tests to make sure that the board fills up the right amount of space.
Part of the tests should create screenshots of the app in an emulator. I should be able to peruse
those locally and decide for myself if they all look good before shipping to customers." And, on
Safari: in a tab the bar's height matters twice, shown and hidden.

## 2. The catalogue (`web/shared/lib/devices.ts`, pure)

One row per device class: the phones that share a screen in CSS points share a row. A row holds
`id` (`iphone-390x844`, `android-412x915-pixel`), `models`, `kind` (iphone, ipad, android), the
portrait `screen`, `dpr`, the safe-area `insets` upright (top, bottom) and sideways (left, right,
bottom), an Android `cutout` (fullscreen alone), the display's `corner` radius in points, the
browser bar's `toolbar` range per orientation (min hidden, max shown), `verified` (every number
published) and `supported` (the SE 1st gen is catalogued but its last iOS cannot run the theme's
container queries). Eighteen rows: thirteen iPhone classes (375x812 twice and 414x896 twice, the
notch and the pixel ratio telling the classes apart), three iPads, the Pixel 7/8 and the Galaxy S23.

The functions, each pure and table-tested (devices.test.ts, one `test.each` over the rows):

- `deviceOf({ screen, dpr, notch })`: the class off what a page can read (`screen` normalised to
  portrait, since iOS reports it upright in either orientation); on a shared screen the row whose
  notch and dpr both match, else the dpr's (a hardware constant), else the notch's, else the first;
  null for a screen no row names.
- `cornerRadius(inputs)`: the display's radius the frame's corners take where they are the
  screen's (docs/design/screen-frame.md): the class's radius, the notch itself for an unknown
  screen, null where no notch was read (the corners are square: headless, a portrait tab, an SE,
  an iPad). `reachOf` and `cornersOf` turn it into the four `--frame-corner-*`.
- `deviceLabel(inputs)`: the id, or `unknown (heuristic)`; the `?probe=1` readout prints it.
- `insetsFor(device, orientation, mode)`, `viewportFor(device, orientation, mode, bar)`,
  `emulationFor(...)`, `emulationsOf(device)`: the eight cases a device stands in (two orientations
  x browser bar shown, browser bar hidden, standalone, fullscreen), each with the viewport the bar
  leaves, the insets, the notch the theme's fallback would compute, the corner the boot writes and
  the reach.
- `reachOf(orientation, mode, insets)`: the screen-frame design's edge-reach rule as data: every
  corner is the screen's standalone and fullscreen; in a tab only where both of a corner's edges
  have an inset, the top edge sideways counting as reached over a home indicator (UNVERIFIED).

### 2.1 Sources and the UNVERIFIED marks

Screens, pixel ratios and insets: Apple's Human Interface Guidelines "Layout" device table and the
per-class `safeAreaInsets` (44/34, 47/34, 59/34, 62/34 upright; the notch on both short edges and
21 below sideways), as theme.css §3.6 measured them. Corner radii: iOS's private
`_displayCornerRadius` per screen as the ScreenCorners survey publishes it (39, 41.5, 44, 47.33,
53.33, 55, 62). Browser bars: Apple, "Configuring the Viewport" (the bars are outside the layout
viewport); Chrome, "URL bar resizing" (2016; the URL bar is chrome and `innerHeight` grows when it
hides); Koch, "Toolbars, keyboards, and the viewports" (quirksmode.org, 2017; "about 60px"). No
source publishes a height per model, so every `toolbar` range is UNVERIFIED and recorded as a range:
Safari sideways 0-50, upright 94-180 on a notched phone and 40-114 on a home-button one; iPad Safari
50-70; Chrome Android 0-56 sideways and 24-80 upright (the 56dp toolbar over the 24dp status bar).
Also UNVERIFIED (`verified: false`): the iPhone 17 line and the Air (screens announced 2025-09;
insets and radii assumed the 16 Pro's), the iPads (0 insets in a tab, radius 0, 18 on Pro models),
the Pixel and Galaxy rows (0 insets in a tab, a cutout of 28-30 fullscreen, radii 30-32), and the
0 top inset in a portrait Safari tab. A real phone settles each through `?probe=1`.

## 3. The runtime

`bootShell` calls `applyFrame` (web/shared/edge/screen.ts) on a framed page, which reads `screen`,
`devicePixelRatio`, the viewport, the display mode and the four insets off shell.css's
`--frame-inset-*`, and writes the class's radius at each corner the edge-reach rule says is the
screen's as `--frame-corner-{tl,tr,br,bl}` on the root, again on every resize, turn, visual
viewport resize and fullscreen change (docs/design/screen-frame.md §4). The probe prints the
matched id or `unknown (heuristic)` and the four corners. Nothing is asked of the player; a new
phone is one catalogue row.

## 4. The emulator (`tools/shell-emulate.ts`)

`node --experimental-strip-types tools/shell-emulate.ts <list | explain | render | check>`; the
header spells every option. `explain` prints, from the same modules the page runs (the catalogue
and backgammon's `ui/board/layout.ts` twin), the match, the corner and which corners are the
screen's, the viewport the bar leaves, `edgeOf`/`chromeWidth`/`pointWidth`, `paddingOf`/
`chromeHeight`/`boardRoom`/`pointLength`, the floor and whether the case scrolls, and the other bar
state. `render` and `check` launch Playwright Chromium with `viewport`, `screen`, `deviceScaleFactor`,
`isMobile` and `hasTouch` from the case and drive pass and play (the turn gate dismissed with "Play
upright" where it shows) to the rolled board. The `check` invariants, pure in `judge`: the trim's
computed `border-radius` equals the catalogue's corner; sideways where the viewport fits, the
board's top and bottom edges sit exactly `boardRoom` from the viewport's (half a pixel); every frame
box and the board are 11px (the band, the hairline and 4px of air) off every edge; the document
scrolls exactly where the twin says the viewport is under the floor; every tap target is 44px on a
phone layout.

The seam. Headless Chromium reads every `env(safe-area-inset-*)` as 0, `Emulation.setSafeAreaInsetsOverride`
(Chromium 153) refuses every parameter shape tried, and `display-mode` cannot be emulated through
Playwright. So an init script writes the case's insets on `#app` as `--inset-l`, `--inset-r`,
`--inset-b` (the theme's own variables; theme.css names them "the seam a measurement overrides", and
this PR routes the portrait bottom padding through `--inset-b` too) and the notch on the root's
inline `--frame-inset-*` (what shell.css's `env()` would read), which the boot reads and turns into
the four corners exactly as on a phone. No stylesheet reads `display-mode`; the mode drives the
viewport and the insets alone. Documented under "Documented test hooks" in docs/ARCHITECTURE.md.

## 5. The tests

- `layout.test.ts` "the device sweep": every row x landscape x (browser bar shown, browser bar
  hidden, standalone, fullscreen) through the twin: two point rows and the frame fill the room to
  half a pixel where the viewport fits; the floor (and the scroll fallback) holds only under the
  floor's own height, so a phone at its full height never scrolls; every point is at least 44px
  wide (the unsupported SE 1st gen excepted); the room is the chrome's own numbers. The iPads take
  the desktop template sideways by design (over 500px tall).
- `devices.test.ts`: the rows, the match, the corner table, the cases, the reach.
- `tools/shell-emulate.test.ts`: the command line, the case list, the explain text, the verdict's
  five checks each failing on its own fault, the seam script, the sheet, the summary.
- `e2e/backgammon-devices.spec.ts` (page-only, backgammon's suite through its `backgammon-*` glob):
  the supported phones sideways in a tab with the bar up and fullscreen, one context each, the
  geometry oracle (`expectFillsRoom` among it) and `judge`'s verdict, the board attached to the
  report.

## 6. The sheet (`npm run shots`)

Build, serve `dist/` on a free port, render every case (17 supported rows x 8 = 136 cards, four
pictures each; the SE 1st gen, held to no promise, by `--device` alone) into `shots/<yyyymmdd-hhmm>/` with an `index.html`: one card per case (the tab's two bar
states adjacent) with the device, orientation, mode, viewport, insets, the board's box, the gaps
above and below against the twin's room, the corner against the catalogue's and each check's
verdict. `shots/` is gitignored. README "Look before you ship" says: run it, open it, decide.

## 7. Left

Every UNVERIFIED number above (a real phone's `?probe=1` reading per row); `display-mode` in the
emulator once Playwright or CDP allows it; the per-corner variables and the frame's opt-in (the
screen-frame design takes `reachOf` from here); the `check` sweep as a CI job (today: the unit
sweep and the e2e sweep gate, the tool runs by hand).
