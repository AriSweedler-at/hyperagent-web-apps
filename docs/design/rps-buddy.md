# The RPS buddy: pixel frames for the island and the page

Owner (2026-09-28): "the floating island will show a little animated smiley face that will turn
colors (blue for sad, pale yellow for neutral, bright yellow for happy) with differing sized smiles
for the different faces displayed [...] you will need to animate the face moving around in
different levels of emotion (bouncing, walking, sulking) and animate the transitions between. Use
pixel art to do so. Keep it super simple, or reuse wikimedia free animations if possible. See what
other people do for their little 'pets in the notch' apps."

This doc is the frames' contract: where they live, what each set holds, how they were chosen and
how to change one. The island's Live Activity (docs/design/rps-island.md, the clip lane) and the web
page (the `rps-web-entry` lane) read `web/public/games/rps/buddy/buddy.json` and draw from the
sheets; nothing here knows about the game.

## 1. Research: pets in the notch (2026-09-29)

| Finding                                                                                                                                                                                                                                                                    | Source                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pixel Pals (Christian Selig, from Apollo, 2022; 2.0 in Sept 2023) runs each pet as a Live Activity so it shows "an animated glyph around the Dynamic Island"; the pet has a small set of named loops (running, sleeping, "chillin'"), a hold on the activity feeds or plays. Frame specs are not published. | [Fueled, 2023-08-30](https://fueled.com/blog/pixel-pals/), [TechCrunch, 2023-09-22](https://techcrunch.com/2023/09/22/pixepixel-pals-delivers-a-cute-and-clever-update-that-takes-advantage-of-new-ios-features/), [MacRumors, 2022-09-16](https://www.macrumors.com/2022/09/16/apollo-pixel-pal-dynamic-island/) |
| The same pattern is now a category: Pixel Pets ("Lock Screen, Dynamic Island and even Live Notifications"), NotiSprite (a widget pet that "appears in your Dynamic Island"), Notch Pet and Notchy on the Mac (a pixel cat or dog walking along the notch). All pixel art, all a handful of short loops per mood or state, none published as sprite sheets. | [App Store: Pixel Pets](https://apps.apple.com/us/app/pixel-pets-dynamic-widgets/id1661627600), [NotiSprite](https://apps.apple.com/us/app/notisprite-smart-desktop-pet/id6752292657), [Notch Pet](https://apps.apple.com/us/app/notch-pet/id6455990267), [Notchy](https://notchy.dev/mac-desktop-pet/) |
| A Live Activity cannot run free animation: the system ignores `withAnimation` and `.animation`, and only `Text(timerInterval:)` / `ProgressView(timerInterval:)` are interpolated between updates; everything else is a static snapshot until the next `activity.update()` or push. So an animated pet is a timer-driven trick (a glyph font whose digits are frames, or a frame sequence stepped by the timer) or a run of updates. The clip lane owns the technique; this lane gives it frames with a known count and hold time per mood. | [Apple: Displaying live data with Live Activities](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities), [oleb.net, 2022](https://oleb.net/2022/live-activity/), [Riff Tech](https://www.riff-tech.com/blog/live-activity-andand-widgetkit-fun) |
| Sizes: the compact island regions are about 36 pt tall, so a pet is drawn at 16 to 24 px and shown at an integer scale with nearest-neighbour sampling (`.interpolation(.none)`); 4 to 8 frames per loop at 8 to 12 fps is the common range for tiny idle loops.                                                | [Sprite frames guide](https://www.sprite-ai.art/blog/sprite-animation-frames), [Apple HIG: Live Activities](https://developer.apple.com/design/human-interface-guidelines/live-activities)                       |

Free pixel-art animations that were checked against the five moods:

| Asset                                                                       | Licence   | Size, frames                                       | Verdict                                                                                                       |
| --------------------------------------------------------------------------- | --------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [Animated Slime, Calciumtrice (OpenGameArt, 2015)](https://opengameart.org/content/animated-slime) | CC BY 3.0 | 32x32, ten frames each of idle, gesture, walk, attack, death; four colours | The right body (a blob) and a good bounce reference, but fixed colours, no face moods, 32 px, combat loops; recolouring and redrawing faces for five moods is more work than drawing the blob, and CC BY needs attribution in the iOS bundle too. |
| [Emotes Pack, Kenney (2018)](https://kenney.nl/assets/emotes-pack)          | CC0 1.0   | 480x480 vector emote balloons, pixel variants      | Faces in balloons, no body to move; the reference for how much mouth a tiny face needs.                        |
| [Blob Sprite (OpenGameArt)](https://opengameart.org/content/blob-sprite)    | CC0 1.0   | move, attack, idle, death                          | One colour, no ladder of moods.                                                                               |
| Wikimedia Commons                                                           | various   | animated pixel GIFs exist, none a mood ladder      | Nothing found that is a small pet with more than one emotion under CC0/CC BY; a GIF also needs cutting into frames. |

## 2. The choice

Original art, drawn procedurally. The five moods need five body colours and five mouths on one
body, three motions and four transitions: 44 frames that must agree with each other pixel for
pixel. No free asset offers that; adapting one means redrawing most of it and carrying its
attribution into the iOS asset catalogue. A pose table in `tools/buddy-frames.ts` (a body ellipse,
two eyes, a mouth curve, feet, a tear, a sparkle) rasterised on a 24x24 grid gives pixel art by
construction, one colour per mood from a five-entry palette, and a hop between moods whose colour
and mouth interpolate. The whole set regenerates in under a second, so a change to the palette or a
motion is one edit and one run, and the licence question is closed: nothing third-party.

The reference points taken from the research: a blob body like the slime (bounce reads as squash
and stretch), 24 px with an integer scale for the island, 4 to 6 frames per loop at 90 to 240 ms
per frame, a blink during the transition so the face swap is not seen.

## 3. What the frames are

24x24 px, transparent background, the body sitting on row 21 with two rows under it for feet.
Every frame is `web/public/games/rps/buddy/<set>/<nn>.png` (`nn` from `00`), every set also a
CSS-ready sheet `web/public/games/rps/buddy/<set>.png` (frames side by side, `frames x 24` wide,
24 tall). Served on both origins at `games/rps/buddy/...` (Vite copies `web/public/` verbatim).

| Set                   | Counter  | Colour    | Motion                                                    | Frames | ms/frame | Loop    |
| --------------------- | -------- | --------- | --------------------------------------------------------- | ------ | -------- | ------- |
| `very-sad`            | −5       | `#3b6fd6` | sulk: a slow droop and rise, eyes low, a tear sliding down | 6      | 220      | 1320 ms |
| `sad`                 | −4..−2   | `#6c9bea` | sulk: a milder droop, a small frown                        | 6      | 240      | 1440 ms |
| `neutral`             | −1..1    | `#f2e6a8` | walk: feet alternate, the body bobs one pixel             | 4      | 160      | 640 ms  |
| `happy`               | 2..4     | `#f5cd3b` | bounce: squash, stretch up, top, stretch down, land       | 6      | 110      | 660 ms  |
| `very-happy`          | 5        | `#ffd200` | bounce, higher, an open smile, a sparkle                   | 6      | 90       | 540 ms  |
| `very-sad-to-sad`     | −5 ↔ −4  | mixed     | hop: squash, blink up, land as the new face               | 4      | 120      | once    |
| `sad-to-neutral`      | −2 ↔ −1  | mixed     | hop                                                       | 4      | 120      | once    |
| `neutral-to-happy`    | 1 ↔ 2    | mixed     | hop                                                       | 4      | 120      | once    |
| `happy-to-very-happy` | 4 ↔ 5    | mixed     | hop                                                       | 4      | 120      | once    |

The colours are the clip model's `Mood.fill` and each mood's `band` is its wire name (`verySad`, `sad`, `neutral`, `happy`, `veryHappy`; docs/design/rps-island.md §4, §8), so the island and the page agree without a lookup.

A hop is drawn upward (from the sadder mood to the happier); the way down plays it backwards (CSS
`animation-direction: reverse`; on iOS, the frames in reverse order). The two counter steps inside
a band (−4 to −3, say) change nothing: the mood loop keeps playing.

`buddy.json` beside the sheets is the machine-readable form of this table:

```json
{
  "size": 24,
  "moods": {
    "happy": { "frames": 6, "ms": 110, "sheet": "happy.png", "w": 24, "h": 24, "motion": "bounce", "band": "happy", "colour": "#f5cd3b", "min": 2, "max": 4 }
  },
  "transitions": {
    "neutral-to-happy": { "frames": 4, "ms": 120, "sheet": "neutral-to-happy.png", "w": 24, "h": 24, "motion": "hop", "from": "neutral", "to": "happy" }
  },
  "license": { "name": "original", "author": "...", "source": "...", "note": "..." }
}
```

Playing a sheet in CSS: a box `w x h`, `background-image: url(<sheet>)`, `background-size:
calc(frames * w) h`, `image-rendering: pixelated`, and `animation: <frames * ms>ms steps(frames)
infinite` from `background-position: 0 0` to `calc(frames * -w) 0`. `preview.html` does exactly
this for every set and runs the ladder (−5 up to +5 and back with the hops between) at the
island's size; open it from the served folder or as a file.

On the island, show one frame at a time from `<set>/<nn>.png` at an integer scale (24 or 48 pt)
with nearest-neighbour sampling; the frame count and `ms` come from `buddy.json`, so a timer-driven
glyph or frame index steps `frames` positions every `frames x ms` milliseconds.

## 4. Licence and attribution

All frames, sheets and the preview are original work generated in this repository by
`tools/buddy-frames.ts`; no third-party asset is used. `web/public/games/rps/buddy/LICENSES.md`
records this with the assets that were consulted and not used. The repository publishes no
licence of its own, so the buddy is under the repository's terms; if the owner wants it reusable
(the iOS catalogue, a friend's app), CC0 1.0 is the line to add there and in `buddy.json`'s
`license` block.

Attribution text (for a credits screen, should one ever exist): "RPS buddy pixel art: original,
drawn in the hyperagent-web-apps repository."

## 5. Changing a frame

The source of truth is the pose table in `tools/buddy-frames.ts`: `PALETTE` (one colour per mood),
`rest(mood)` (the mouth's bend and width, the eyes' drop, an open mouth), `sulk`, `walk`, `bounce`
and `hop` (each a list of poses), `MOOD_MS` and the hop's 120 ms. Edit, then

```
node --experimental-strip-types tools/buddy-frames.ts
node node_modules/prettier/bin/prettier.cjs --write web/public/games/rps/buddy
node node_modules/vitest/vitest.mjs run tools/buddy-frames.test.ts
```

The run rewrites the SVGs under `tools/buddy/<set>/<nn>.svg`, the PNGs and sheets under
`web/public/games/rps/buddy/`, `buddy.json` and `preview.html`; commit all of them. To replace one
frame with a hand-drawn one, draw it as a 24x24 SVG of integer `1x1` rects (open a generated one
and move pixels), save it over `tools/buddy/<set>/<nn>.svg` and render the SVGs on disk as they are:

```
node --experimental-strip-types tools/buddy-frames.ts --from-svg
```

A new frame in a set means one more pose in its list (the count and the sheet's width follow); a
new set means one more `SETS` row and a row in the table above. `tools/buddy-frames.test.ts`
(harness suite) holds `buddy.json` to the table and every file to its size: a missing frame, a
sheet of the wrong width or a stale manifest fails there. The files under `web/public/games/**`
also run the `site` and `e2e-site` jobs (tools/ci/suites.ts, "a page's served files"): the dist
guards see them copied into `dist/games/rps/buddy/` and the smoke serves them on both origins.

## 6. Moving in the island (2026-09-29)

A Live Activity runs no free animation (rps-island.md §7): `withAnimation` and `.animation` are
ignored, and only `Text(timerInterval:)` and `ProgressView(timerInterval:)` tick on their own. So
the buddy moves by the **timer-font trick**: each mood has a TrueType font whose ten digit glyphs
are its frames, the island shows a running timer in that font, and the seconds' units digit,
clipped to one em, is a sprite loop at 1 fps for the activity's whole life with no push.

### What was checked (fifteen minutes; URLs and dates as the pages give them)

| Source                                                                                                                                        | What it says                                                                                                                                                                                                                            | Date                  | Status                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------ |
| [Apple Developer Forums 715159, "Use a Custom Font in a Live Activity"](https://developer.apple.com/forums/thread/715159)                     | A custom font shows in a Live Activity once the `.ttf` is in the widget extension's Copy Bundle Resources and listed in the **extension's own** Info.plist under `UIAppFonts`; then `Font.custom(_:size:)`.                              | 2022-09 to 2023-03    | VERIFIED                                                     |
| [Apple Developer Forums 723316, "Text view with .timer style expands"](https://developer.apple.com/forums/thread/723316)                      | `Text(timerInterval:)` in the compact island grows to the width it may need; the fix is a fixed-width frame. Our one-em frame is that fix.                                                                                              | 2023-01 to 2024-08    | VERIFIED (the quirk; not the trick)                          |
| [Apple Developer Forums 722412, "Live Activity animate"](https://developer.apple.com/forums/thread/722412)                                    | "The system ignores any animation modifiers … and uses the system's animation timing instead"; text, images and SF Symbols animate content changes only.                                                                                | undated               | VERIFIED                                                     |
| iOS SDK on this Mac (`SwiftUI.swiftmodule/arm64e-apple-ios.swiftinterface`, Xcode 27.0)                                                       | `Text.init(timerInterval:pauseTime:countsDown:showsHours:)` and `ProgressView.init(timerInterval:countsDown:)` are `@available(iOS 16.0, *)`; the clip's deployment target is 17.0.                                                    | read 2026-09-29       | VERIFIED                                                     |
| Fueled, [Pixel Pals is What Dynamic Island Needed](https://fueled.com/blog/pixel-pals/); TechCrunch 2023-09-22; MacRumors 2022-09-16          | Christian Selig's Pixel Pals runs each pet as a Live Activity that "shows some sort of animated glyph around the Dynamic Island", "with some clever dev work around Apple's limitations". No post, interview or repo names the mechanism. | 2022-09 to 2023-09    | UNVERIFIED that Pixel Pals (or Pixel Pets, NotiSprite, Notch Pet) uses a timer font; the trick is inferred from what the platform allows |
| dev.to, Y. Hirokawa, "Adding Live Activities to a Pomodoro timer: what the docs don't tell you"                                               | `Text(timerInterval:)` is the way to a display that changes every second with no pushes: "you only push an update when something semantic changes".                                                                                     | 2026-06               | VERIFIED (the mechanism's appeal; no sprite font)            |
| Apple, [Displaying live data with Live Activities](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities) | The animation rules quoted in rps-island.md §7; the timer text and the timer progress view are the running exceptions.                                                                                                                | current               | VERIFIED (via §7)                                            |

So: the platform mechanics are documented (custom fonts in the extension, the timer text running
on its own, its width quirk); that a shipping notch pet uses a glyph font is not documented
anywhere primary that the search found, and this doc does not claim it. The clip ships the trick on
its own merits and the owner sees it on a phone (README, owner checklist step 11).

### The fonts

`tools/buddy-font.ts` writes `Buddy-VerySad.ttf`, `Buddy-Sad.ttf`, `Buddy-Neutral.ttf`,
`Buddy-Happy.ttf`, `Buddy-VeryHappy.ttf` (the family, full and PostScript name is the file's stem)
into `ios/DiceClip/Config/Fonts/` and `web/public/games/rps/buddy/fonts/`, byte-identical, from the
mood's `<set>/<nn>.png` frames and `buddy.json`'s frame counts. No font library and no PNG library:
the PNG's IDAT is inflated with node's `zlib.inflateSync` and the five scanline filters are undone
by hand (8-bit RGBA only); a TrueType file is ten tables (`head`, `hhea`, `maxp`, `OS/2`, `hmtx`,
`cmap`, `loca`, `glyf`, `name`, `post`) with a directory of checksums and the head's
`checkSumAdjustment` closing the file's sum to `0xB1B0AFBA`.

- **The glyph is a mask.** A pixel is lit when it is opaque and not the ink (`#2a2622`, the eyes and
  the mouth). The lit pixels fill in the view's `foregroundStyle`, the mood's colour, so one font
  per mood is the frames and the colour is the view's; the ink pixels are holes the island's black
  shows through, which is what draws the face. The body's outline shade, the highlight, the tear and
  the sparkle flatten into the one colour.
- **Grid to em.** 24 pixels map to 1024 units per em: a grid edge `n` is `round(n · 1024 / 24)`, so
  neighbouring pixels share an integer edge exactly (a pixel is 42 or 43 units). One closed
  clockwise contour per horizontal run of lit pixels per row; TrueType's non-zero fill makes the
  union seamless. The grid's bottom is the baseline, its top the ascender (1024); descender 0.
- **Metrics.** Every digit advances exactly one em, its left side bearing its `xMin`; space and
  colon are empty glyphs with zero advance; `.notdef` too, so any other character the timer might
  emit (a grouping separator, a letter) takes no room. `cmap` is one format 4 subtable for
  U+0020, U+0030–U+0039 and U+003A, reached from both the (0,3) and the (3,1) records.
- **The cycle.** Digit `d` shows frame `d mod N`: a 4-frame walk is `0 1 2 3 0 1 2 3 0 1`, a 6-frame
  bounce `0 1 2 3 4 5 0 1 2 3`. Once every ten seconds the loop skips (frame 3 back to frame 0);
  a ping-pong (`0 1 2 3 4 5 4 3 2 1`) would be seamless for six frames and is one line to try in
  `frameForDigit`.
- **Reproducible.** `head.created` and `modified` are the constant `FONT_DATE`, so
  `node --experimental-strip-types tools/buddy-font.ts` regenerates the same bytes;
  `tools/buddy-font.test.ts` (harness suite) reads the fonts back with a reader of its own and holds
  the committed files to the writer's output. The frames regenerate with `tools/buddy-frames.ts`
  first, then the fonts, then `prettier --write web/public/games/rps/buddy`.

### The view (`ios/DiceClip/Shared/BuddySprite.swift`)

```swift
Text(timerInterval: start ... start.addingTimeInterval(24 * 60 * 60), countsDown: false, showsHours: false)
    .font(.custom("Buddy-Happy", size: size))
    .monospacedDigit()
    .lineLimit(1).minimumScaleFactor(1).fixedSize()
    .frame(width: size, height: size, alignment: .trailing)
    .clipped()
    .foregroundStyle(Color(band.fill))
```

The timer counts up from the activity's `startedAt` (the same origin on every surface, so the
compact, minimal, expanded and Lock Screen buddies show the same frame) toward a far end past the
eight-hour ceiling. The text is laid out at its own width (`fixedSize`: every digit one em, the
colon nothing) and aligned trailing in a one-em frame, so the minutes and the tens of seconds hang
out of the clip on the left by `(glyphs − 1) · size` points and only the last glyph shows. One em is
`size` points (32 compact, 28 minimal, 56 expanded, 60 on the Lock Screen, 96 on the clip's
screen). The fonts are registered in `Config/Activity-Info.plist` (`UIAppFonts`, both extension
targets share it) and copied by the two extensions' Resources build phase. `BuddyFont.isAvailable`
(`UIFont(name:size:) != nil`) chooses the timer view; when a font is missing the view falls back to
the code-drawn 8 × 8 frames at `at mod N` per push (rps-island.md §7, option 3). The band change
keeps its spring morph (`.id(band)`, a scale-and-fade transition).

Not verified on a device (no simulator runtime and no signing team on this Mac): that the system's
renderer honours the custom font and the trailing clip for a timer in the compact region. The
built `.appex` bundles carry the five `.ttf` files and the `UIAppFonts` key (checked in the build
products). If the island shows a digit, the font did not register; if it shows the code-drawn
buddy, `UIFont(name:)` was nil in the extension.

### The web preview

`preview.html` has a row (between `<!-- buddy-font -->` markers the tool maintains) with the five
fonts through `@font-face` and a JS clock writing the seconds' units digit into each: the exact
glyphs the island shows at that second, in the mood's colour. `tools/buddy-font.test.ts` also
loads `Buddy-Happy` in Chromium and measures a digit at one em (32 px at 32 px), a colon at 0 and
`12:37` at 4 em.
