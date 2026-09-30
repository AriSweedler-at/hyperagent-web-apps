# Layout buckets: one thin layer for every screen size

The owner (2026-09-28), on the space audit's largest finding (every upright game held sideways on a
phone is the shell's 480px column with 17-18% of the screen empty a side and a scrolling document):

> The briscola game can be played vertical or horizontal. Most games can be. And it shouldn't be
> that hard to make a thin layer on top to display differently for different buckets of screen
> sizing. That should be nicely done.

> There's also desktop

Not the portrait gate; the games adapt. This document is the layer: the table of buckets, why the
thresholds are what they are, how a game adopts one, the sandbox as the test bed, and desktop as a
first-class bucket. The code is `web/shared/lib/layout.ts` (pure, tested to every branch in
`layout.test.ts`), `web/shared/edge/screen.ts` (`readLayout`, `applyLayout`, `watchLayout`) and one
rule in `web/shared/styles/shell.css`.

## 1. The table

Seven buckets. The pointer picks the family, the viewport picks the bucket within it. The inputs are
the ones the media queries read: the viewport's width and height, `(any-pointer: fine)` and
`(hover: hover)`.

| Bucket                 | Family           | Predicate                                         | Who lands here                                                                                                        |
| ---------------------- | ---------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `phone-upright`        | touch            | taller than wide, width < 600                     | every catalogued phone upright (320-440px wide), in every mode                                                        |
| `phone-sideways`       | touch            | wider than tall, height ≤ 500                     | every phone sideways: the 12 class standalone (390 tall), the Pro Max in a tab (390), the Pixel (412)                 |
| `phone-sideways-short` | touch            | wider than tall, height ≤ 375                     | the SE, the X and the mini (375), the Galaxy (360), the SE1 (320), and any phone up to the XR class in a tab with the bar shown (364) |
| `tablet-upright`       | touch            | taller than wide, width ≥ 600                     | the iPads upright (768-1024 wide)                                                                                     |
| `tablet-sideways`      | touch            | wider than tall, height > 500                     | the iPads sideways (768-1024 tall); a touch screen the size of a monitor                                              |
| `desktop`              | fine or hovering | width < 1440                                      | the 1280x800 golden, the audit's 1024x768 and its narrow 900x700 window; a phone-sized window with a mouse            |
| `desktop-wide`         | fine or hovering | width ≥ 1440                                      | a 13-inch MacBook Air's 1440x900, a 1080p monitor                                                                     |

The short phone is a phone sideways too: the buckets nest, so a theme that reads `phone-sideways`
alone catches both, and one that reads `phone-sideways-short` tightens the shortest.

## 2. Why these thresholds

Each is spelled once in `layout.ts`, with a comment naming the catalogued devices
(`web/shared/lib/devices.ts`) on either side of it:

- **600 wide** (`PHONE_MAX_WIDTH`): every catalogued phone is 320-440px wide upright; the narrowest
  iPad is 768. Android's classic `sw600dp` line.
- **500 tall** (`SIDEWAYS_MAX_HEIGHT`): the same figure as `media.ts` `LANDSCAPE_PHONE`'s
  `(max-height: 500px)`, backgammon's sideways predicate since docs/design/backgammon-landscape.md
  §3.1. Sideways a phone is its upright width tall less the browser's bar (270-440); the smallest iPad
  sideways is 768 tall.
- **375 tall** (`SHORT_MAX_HEIGHT`): the SE and the X class are 375 wide, so 375 tall sideways; below
  it every layout loses a row (backgammon's SE class, docs/design/backgammon-landscape.md §3.4). A
  phone in a tab with the bar shown loses 50 more, so the 12 class (340) is short in a tab and not
  standalone: the bucket follows the viewport, as the layout must.
- **1440 wide** (`DESKTOP_WIDE_MIN_WIDTH`): the smallest common laptop at 1x, where a centred board
  has room for side panels. The 1280x800 golden lands below it.
- **The pointer, not the width, picks the family.** A touch laptop (a fine pointer that hovers, and a
  coarse one too) is a desktop; an iPad Pro at 1024x1366 is a tablet; a phone's 956px sideways is a
  phone's. A fine pointer's window narrower than the audit's smallest standard window
  (`DESKTOP_MIN_WIDTH`, 1024: a documented figure, not a threshold) is a `desktop` still: a mouse
  never gets a phone's column. `(any-pointer: fine)` rather than `(pointer: coarse)` because a mouse
  click in Chromium's touch emulation flips the primary pointer's coarseness off (media.ts's note on
  `LANDSCAPE_PHONE`), and a phone answers `any-pointer: fine` false whatever was tapped.

Backgammon's own tiers (the rail scheme from 714px, the rows scheme below, the SE class, the 900px
desktop step, the upright tight tier as a container query) are finer than these buckets and stay its
own; its `data-plays` and its frame are untouched, and its goldens are byte-identical.

## 3. How a game adopts a bucket

The bucket reaches a theme three ways; a theme uses whichever fits.

1. **The body attribute.** The boot writes `<body data-layout="phone-sideways">` on every shell page
   (`bootShell`: `applyLayout` once, then `watchLayout` on `resize` and `orientationchange`), so a
   theme writes `body[data-layout="phone-sideways"] .table { ... }` and the rule follows the phone
   as it turns. The row is in `web/shared/styles/CONTRACT.md`.
2. **The media strings.** `BUCKET_MEDIA[bucket]` is the same predicate as a `@media` query string
   for a theme that prefers pure CSS (`(any-pointer: coarse) and (hover: none) and (orientation:
   landscape) and (max-height: 500px)` for `phone-sideways`; the desktop family is a two-query list,
   `(any-pointer: fine) and ..., (hover: hover) and ...`). The two spellings agree on every catalogued
   device and on Chromium's emulation; the sandbox's readout prints both so a disagreement would
   show.
3. **The column rule.** shell.css's 480px column is a bucket rule: `phone-upright` keeps it, and every
   other bucket reads the theme's `--column-wide`:

   ```css
   :where(body[data-layout]:not([data-layout='phone-upright'])) #app {
     max-width: var(--column-wide, 480px);
   }
   ```

   A game that lays its screens out per bucket names `--column-wide: none` on `:root` (or under one
   bucket alone) and `#app` takes the full width the gutters or the frame leave; a game that has not
   adopted keeps its column everywhere, since a phone's column stretched across a laptop is worse
   than a phone's column. So adoption is one token and the goldens of every other game stand.

The worked example is briscola's sideways layout: in `phone-sideways` the opponents along the top,
the trick in the middle, the hand across the bottom, the controls in the corners, no scroll, 44px
targets; in the desktop buckets a centred table with room at the sides; upright unchanged. It lands
in the per-game row `space-audit-briscola` (docs/design/space-audit.md §5), on this layer.

## 4. The sandbox as the test bed

UI Sandbox (docs/design/ui-sandbox.md) reads the bucket out and forces one:

- The Info readout prints `layout <bucket>` (and `(forced ...)` when it is), and the seven
  `bucket <name>` media strings with their match, under the shell's two predicates.
- The preview bar's bucket switcher (`#previewLayoutSel`; the setting `layout`, `?layout=<bucket>`
  as the query's override) forces the bucket on the body and sizes the stage to that bucket's
  representative viewport (`REPRESENTATIVE`: the 12 class upright and sideways, the SE sideways, the
  9th iPad both ways, the 1280x800 golden, the 1440x900 laptop) as far as the screen allows, its edge
  dashed, so the layout examples lay out for a bucket the phone in hand is not. `auto` hands the body
  back to `applyLayout`.

## 5. Desktop as a first-class bucket

The owner: "There's also desktop." A wide fine-pointer window is a bucket a game lays out for, not a
phone column stretched: the home and the table centred with room for side panels. The space audit
(docs/design/space-audit.md §5) drives a second case type for it, the desktop windows (900x700,
1024x768, 1280x800, 1440x900, 1920x1080: a fine pointer, no touch, no insets, a browser tab),
judged by `DESKTOP_LIMITS` (a home may leave 40% empty below and beside its column; a table fills to
within a tenth on every side; no scroll, no clipping) and a 32px target (a click's size), grouped
last on the sheets and named `desktop 1280x800` in the check table. Every case, phone or window,
reports the bucket the page put itself in (`data-layout`), so a per-game row has a target per case.
