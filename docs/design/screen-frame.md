# The screen frame

A band along the edge of the screen, drawn by the shell for any game that asks, with corners that
follow the glass. The owner (2026-09-28): "Add 'border sizing' into the shell. The application
should just be able to put the border in without considering anything else. This should all be
dynamic so that as my users get different phones it doesn't cause issues. Figure out how other
people accomplish this and follow suit." And on backgammon's trim: "the outer corners of the green
border don't match the edge of my screen perfectly ... The backgammon border is sized perfectly
when the toolbar at the top is down. Although then the border's top corners should be square
instead of circular to reflect the actual viewport."

Sources are cited with the date read (2026-09-28) and marked VERIFIED where the page was fetched
and read, UNVERIFIED where only a search result named it.

## 1. What other people do

Nobody draws a frame that follows the corners; everybody pads. The web's answer to a phone's
notch, home indicator and rounded corners is the safe area: `<meta name="viewport"
content="viewport-fit=cover">` lets the page under the hardware, and four CSS environment
variables say how far in the content must stay.

- WebKit, "Designing Websites for iPhone X" (webkit.org/blog/7929, 2017-09-22, updated
  2017-10-31; VERIFIED). Introduces `viewport-fit=cover` and `env(safe-area-inset-*)`, names
  the rounded corners as the reason for the insets, and offers nothing that measures them.
- MDN, `env()` (developer.mozilla.org/en-US/docs/Web/CSS/env, last changed 2026-09-12;
  VERIFIED). The four `safe-area-inset-*` and the newer static `safe-area-max-inset-*`. All four
  are rectangular distances; none is a radius.
- MDN, `@media (display-mode)` (developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/display-mode,
  2026-04-20; VERIFIED). `browser`, `minimal-ui`, `standalone`, `fullscreen`,
  `window-controls-overlay`, `picture-in-picture`: how the page is shown, from the manifest's
  `display` or the browser's own choice. That an iOS Home Screen web app reports `standalone` is
  what several secondary guides say (UNVERIFIED against Apple's own text).
- The safe-area tutorials the search turns up (web.dev "Screen configurations", UNVERIFIED; the
  Flackr and 1440px demos, UNVERIFIED) all pad a rectangle. No mobile web game or installed page
  drawing a corner-following bezel came up; this repo's own PRs #167 and #172 (VERIFIED) are the
  one example found, which is the point of writing the rule down.

## 2. What the platforms allow

- iOS knows the radius and does not say. `UIScreen._displayCornerRadius` is private; the
  kylebshr/ScreenCorners survey (github.com/kylebshr/ScreenCorners, VERIFIED) reads it through an
  obscured selector and publishes the values per model, in points: X/XS/XS Max/11 Pro/11 Pro Max
  39; XR/11 41.5; 12 mini/13 mini 44; 12/12 Pro/13/13 Pro/14/16e 47.33; 12 Pro Max/13 Pro Max/14
  Plus 53.33; 14 Pro/14 Pro Max/15/15 Plus/15 Pro/15 Pro Max/16/16 Plus 55; 16 Pro/16 Pro Max/17/17
  Pro/17 Pro Max/Air 62; iPad Air/Pro 18. Kyle Bashour's "Finding the real iPhone X corner radius"
  (kylebashour.com, UNVERIFIED) is the technique's origin. Apple's HIG "Layout" page gives the
  safe areas per model and no radius (the numeric table could not be fetched: UNVERIFIED).
- Android knows the radius and says so natively only: `android.view.RoundedCorner` (API 31) and
  `WindowInsets.getRoundedCorner(position)`; the cutout through `WindowInsets.getDisplayCutout()`
  (API 28) (developer.android.com, UNVERIFIED: consistent search results, not fetched). Neither
  reaches web content, not even a WebView; Chrome's answer is the same four CSS insets.
- The web has no radius and no "my edge is the screen's edge" boolean, as of 2026. CSS Round
  Display Level 1 (w3.org/TR/css-round-display-1, Working Draft 2016-12-22; VERIFIED) has a
  `shape` media feature and `border-boundary`, and no browser ships it. The Viewport Segments
  and Device Posture APIs are about hinges; Window Controls Overlay's `titlebar-area-*` about a
  desktop title bar; `screen.isExtended` about a second monitor (all UNVERIFIED, all beside the
  point). `safe-area-max-inset-*` is specified and, per the search, unshipped (UNVERIFIED).
- Which edges of the page are the screen's is not exposed either. In a tab the browser's bar sits
  on one edge; the page cannot ask which. What it can read: the four insets (a non-zero inset
  proves the page reaches that edge), `innerWidth`/`innerHeight` against `screen.width`/`height`
  (on iOS the screen reports its portrait size in either orientation), the display mode, and
  `document.fullscreenElement`. On iOS Safari `innerHeight` follows the visual viewport and grows
  as the bar tucks away; `visualViewport`'s `resize` fires as it does (gist by claus, quirksmode
  2017 "Toolbars, keyboards, and the viewports"; UNVERIFIED secondary sources). Chrome froze
  `innerHeight` to the layout viewport in Chrome 56 (bokand/URLBarSizing, quirksmode 2016-02 and
  2017-09; UNVERIFIED) and moved the live number to `visualViewport`.

## 3. The rule this shell follows

Pad like everyone, and draw the frame from a table. The shell owns both.

1. The band is the shell's (`web/shared/styles/shell.css` "the screen frame"): `body[data-frame]::before`,
   `position: fixed; inset: 0; pointer-events: none; z-index: 0`, a border of `--frame-band` in
   `--frame-color` with an inset hairline in `--frame-hairline`. It paints under every positioned
   thing (overlays 50, flyers 60, the toast 100).
2. The clearance is the shell's: `#app` is padded per side by
   `max(--frame-band + 1px + --frame-gap, env(safe-area-inset-<side>))`, so nothing a game puts
   in `#app` touches the band and nothing hides under a notch or the home indicator. A theme may
   still set `#app { padding }` after it for a layout of its own (backgammon's sideways table: one
   symmetric `--edge` for both sides, its own vertical budget); the shell's rule is written at
   `#app`'s own specificity (`:where(body[data-frame]) #app`) so the theme's wins.
3. The corners are the catalogue's, not the insets'. `web/shared/lib/devices.ts` keeps one row per
   class of phone (screen in points, pixel ratio, insets, the radius from §2), and the boot reads
   `screen`, `devicePixelRatio` and the insets, matches the row (`deviceOf`) and takes its radius
   (`cornerRadius`); the notch's depth stands in for an unknown phone with one, 0 for no notch.
4. Each corner rounds only where both its edges are the screen's (§4 below). The boot writes the
   four `--frame-corner-{tl,tr,br,bl}` on the root, and again as the bar shows and hides, the phone
   turns, or fullscreen comes and goes (`web/shared/edge/screen.ts` `applyFrame`, `watchFrame`).
5. Until the boot has written, and on a page without the boot, shell.css's fallback stands:
   `--frame-corner: max(env(safe-area-inset-top), -left, -right)`, which tracks the radius on a
   notched iPhone within a few px and is 0 wherever the corners are the browser's.

Why a table and not a measurement: nothing measures (§2), and the insets are a coarse proxy (the
X's 44pt inset over a 39pt radius; the 15's 59 over 55). Why the shell and not the theme: the
owner's ask is that a game "put the border in without considering anything else", and the
padding, the seams and the corner logic are the same for every game that wants a band. Why the
reach rule: the owner saw the frame fit sideways under Safari's bar with round top corners cut off
by the bar's square ones.

## 4. The edge-reach rule

`reachOf` in `web/shared/lib/devices.ts`, pure over `{ mode, insets, viewport, full }` where
`full` is the whole screen turned for the orientation:

- `standalone` or `fullscreen` (the manifest's, or `document.fullscreenElement`: the Android
  lock): all four corners.
- A tab whose viewport is the whole screen (`innerWidth`/`innerHeight` equal the screen's points
  for the orientation): all four. Safari sideways with the bar hidden.
- Otherwise a corner rounds only where both its edges are proven:
  - a non-zero inset on a side proves that side (sideways the notch on both short edges, the home
    indicator below; upright the notch above once installed);
  - the edges no inset speaks for (the top and the bottom sideways; the top upright in a tab) are
    read off the height: as tall as the screen, no bar, both reach; shorter, a bar takes one of
    them: the top where the bottom inset is non-zero (the bottom edge is the screen's), else the
    bottom (UNVERIFIED for Chrome Android, whose bar is at the top; its side insets are 0 in a
    tab, so no corner rounds there either way);
  - no height to read (a fake), only the insets speak.
- Everything else is square: the corner is the browser's.

Cases (unit-tested in `devices.test.ts` and `web/shared/edge/screen.test.ts`):

| Case                                         | Insets t/r/b/l | Viewport vs screen | Corners tl/tr/br/bl |
| -------------------------------------------- | -------------- | ------------------ | ------------------- |
| iPhone 15, Safari tab, upright               | 0/0/34/0       | 672 < 852          | 0/0/0/0             |
| iPhone 15, Safari tab sideways, bar up       | 0/59/21/59     | 343 < 393          | 0/0/55/55           |
| iPhone 15, Safari tab sideways, bar hidden   | 0/59/21/59     | 393 = 393          | 55/55/55/55         |
| iPhone 15, installed, upright                | 59/0/34/0      | standalone         | 55/55/55/55         |
| Pixel, Android lock (fullscreen), sideways   | 0/0/0/28       | fullscreen         | 32/32/32/32         |
| SE, installed                                | 0/0/0/0        | standalone         | 0/0/0/0             |
| Desktop window                               | 0/0/0/0        | 800 < 900          | 0/0/0/0             |
| Unknown phone, installed, 40px notch         | 40/0/30/0      | standalone         | 40/40/40/40         |

## 5. The opt-in for a game

One flag and three tokens.

- `web/games/<g>/page.ts`: `frame: true` on the `ShellPage`. The composer
  (`web/shared/markup/shell.ts` `bodyAttrsOf`) puts `data-frame` on the composed `<body>`; a page
  without it is untouched byte for byte (gin, briscola, fidice).
- `web/games/<g>/theme.css`, on `:root`: `--frame-band` (the band's width; the shell's default
  6px), `--frame-color` (the band; the shell's `--accent`), `--frame-hairline` (the inner
  hairline's colour; `transparent` for none). Optional: `--frame-gap`, the air between the
  hairline and the content (4px unless the theme says).
- Nothing else: no `body::before`, no padding arithmetic, no corner rule. Backgammon (the trim,
  docs/design/backgammon-board.md §3.6): `--frame-band: 6px` (10px from 900px),
  `--frame-color: var(--olive)`, `--frame-hairline: var(--gold)`, `--frame-gap: 5px` (so its
  gutters stay the 12px and 16px its board arithmetic counts). Its upright table fits whatever the
  rule leaves: `#app` is a size container at the table and the board reads the room as `100cqh`
  (backgammon-board.md §3.1), so a notch of any depth, or a phone the catalogue has never seen,
  costs the game no arithmetic.

## 6. Validation

- `node --experimental-strip-types tools/shell-emulate.ts explain --device <id> ...` prints a
  case's insets, match, radius and the four corners; `check --all` stands the page on every
  catalogued phone (Playwright, the insets through `seamScript` on the root's `--frame-inset-*`)
  and judges the four measured radii of `body::before` against the rule, the clearance and the
  rest (`judge`).
- `e2e/backgammon-devices.spec.ts`: the same sweep in CI, plus the frame probe: the iPhone 12
  class upright installed (four round corners, `#app` padded past the notch and the indicator) and
  sideways in a tab with the bar up (the top pair square, the bottom pair round).
- `?probe=1` on the page draws the reading on a real phone: the viewport and the screen, the
  insets, the mode, the match, the radius and each corner (`square` where a bar owns it).
- `web/shared/edge/screen.test.ts` holds the table of §4 over fakes; `devices.test.ts` the rule.

## 7. Open

- The Safari bar's height per model, the iPhone 17 line's insets and radii, the iPads' and the
  Androids' rows are UNVERIFIED in the catalogue (docs/design/devices.md); the probe on a real
  phone settles each.
- Chrome Android's bar is at the top; the rule's "else the bottom" arm is wrong for it and
  harmless (no side inset in a tab). If Android ever reports side insets in a tab, the arm needs
  a `kind` check.
- `safe-area-max-inset-*` and any future radius API: swap the fallback and the table's role when
  one ships.
- The rule stands on every side of every game, and a game's floors are its own to fit under it:
  backgammon upright measures the room (§5) and its 44px point floor holds only in its scroll
  tier, so the four smallest notched iPhones installed get 39.8-43.7px rows (backgammon-board.md
  §3.1, §3.10). A scroll tier that read the room would need a threshold no media query can spell
  (`env()` is not a media feature): a compact chrome tier under the notch, or a class the boot
  sets, is the follow-up if those rows must be 44.
