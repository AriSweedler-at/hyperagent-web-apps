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
