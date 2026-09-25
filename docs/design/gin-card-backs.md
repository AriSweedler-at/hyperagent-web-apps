# Gin Rummy card backs: one picture, scaled, from a few presets

Owner's ask (2026-09-22): "The card backs should be consistent sizes. Right now it's just stripes,
but when looking at the back of the deck and the back of the opponents cards, the card sizes are
different but the card back patterns are the same size. This is a mistake. The card back should be
an image and it should be scaled up and down to have the same pattern or image no matter what.
Also, the pattern should be configurable … ONLY be accessible from local storage for now … there
should be a 'card back' theme and it can be empty, default, blue-stripe, or yu-gi-oh. … If you set
the value to something bad then it should just be a console log error and it should refuse to
change the value you tried to set."

## 1. The picture

`.card.back` was `repeating-linear-gradient(45deg, … 6px … 12px)`: a 12px period whatever the
card's width, so the stock (84px) showed seven stripes and the opponent's strip (22px) two. Now the
back is an SVG with a fixed viewBox (100 × 144, the card's aspect) drawn as `background-image …
center / 100% 100%`, so every face-down card, at any of the four sizes `--card-w` takes, shows the
same picture. The SVGs live in `web/games/gin-rummy/backs/` and are under a kilobyte each, so the
build inlines them (Vite's 4KB limit) and the stylesheet carries no URL (the computed-style goldens
hash long values and see no port).

### 1b. A raster back

A back the owner supplies as a picture is committed once, as supplied
(`web/games/gin-rummy/assets/<name>-back.jpg`), and `tools/card-backs.ts` draws it at the widths a
face-down card is painted at (112px, the widest card, at 1x, 2x and 3x device pixels) into
`backs/<name>-{112,224,336}.jpg`, which theme.css offers through `image-set()` (a plain `url()` of
the 2x file stands where `image-set()` is unknown). The derived files are committed too, because the
dist that deploys is the one CI's check job builds and that job has no browser or image library (the
tool draws with Playwright's Chromium); `test/card-backs.test.ts` reads each file's JPEG frame size
and fails until the tool is re-run after a change to a source or to the width list.

## 2. The presets (src/cardBack.ts)

| name          | picture                                                                          |
| ------------- | -------------------------------------------------------------------------------- |
| `default`     | a navy field, a lattice of small diamonds, a light border, a spade medallion      |
| `blue-stripe` | the diagonal stripes the page opened with, twelve units of a hundred, so ~8 across |
| `yu-gi-oh`    | the Yu-Gi-Oh! card back the owner supplied (2026-09-22), a raster (§1b), on a near-black brown |
| `empty`       | a plain navy back with the border                                                |

`CARD_BACKS`, `CardBack`, `DEFAULT_CARD_BACK`, `isCardBack`, `badCardBackMsg` sit at the src/ root
(like sort.ts) because storage.ts and ui/ both read them and the lint zones let neither import the
other.

## 3. Choosing one

- `ginRummy_cardBack` in localStorage (this page's own key; storage.ts `readCardBack` /
  `writeCardBack`, decoded by `literal(...CARD_BACKS)`). For now the only ways to set it are the
  console: `localStorage.setItem('ginRummy_cardBack', 'yu-gi-oh')` then a reload, or
  `__gin.cardBack('yu-gi-oh')`, which shows it at once and remembers it.
- `App.cardBack` (read at `home/init` from `HomeSnapshot.cardBack`); `paintScreen` writes it to
  `body[data-card-back]`; theme.css selects the picture per value, `default` being the base rule.
- A bad value is refused: `__gin.cardBack('x')` logs `badCardBackMsg` (`ginRummy_cardBack: "x" is
  not a card back; kept the current one. One of: default, blue-stripe, yu-gi-oh, empty.`) and
  changes nothing; a bad value found in storage when the home screen is read (main.ts
  `homeSnapshot`: at boot and on every return home) is logged the same way and dropped from
  storage, so the default stands and a reload does not log it again.

The sound font (docs/design/sound-fonts.md §6) is chosen the same way: its own key
(`ginRummy_soundFont`), `App.soundFont` read at `home/init`, `soundFont/set` → `writeSoundFont`,
`__gin.soundFont(name)` and the same boot drop in `homeSnapshot`; a settings panel later paints both.

### 3b. Since the card packs (docs/design/card-packs.md §4.1)

The four presets are the shared card packs that draw `french52` (`web/shared/lib/cards/packs.ts`):
`src/cardBack.ts` is a view over them (`CARD_BACKS = packsFor('french52')`, the same four names in
the same order), the key is `ginRummy_cardPack` (a value under the retired `ginRummy_cardBack`
moves over once at boot through `storage.ts` `migrateCardBack`), the refusal line reads
`ginRummy_cardPack: "x" is not a card pack for this deck; kept the current one. One of: default,
blue-stripe, yu-gi-oh, empty.`, and the console hook is `__gin.cardPack(name)` /
`__gin.cardPackName()` with `__gin.cardBack(name)` kept as an alias for one release. The pictures,
`body[data-card-back]` and its values, theme.css and every golden did not move; the back files are
also served at `../../shared/cards/backs/` for the other card games.

## 4. Oracles

- `test/card-backs.test.ts`: the derived raster files exist at the tool's sizes (§1b).
- `storage.test.ts`: the vocabulary and the decoder; `state.test.ts`: `cardBack/set` writes and
  paints, `home/init` reads it; `render.test.ts`: the body attribute.
- `e2e/gin-card-back.spec.ts` (page-only): the stock's back and the opponent's strip's backs share
  one `background-image` at `100% 100%`; the key set to `yu-gi-oh` and a reload switch the picture
  on both; `__gin.cardBack('blue-stripe')` switches it live and stores it; a bad value in storage
  logs the message, is dropped and leaves the default; `__gin.cardBack('nope')` logs and refuses.
- Every table story's screenshot changes (the stock and the opponent's strip carry the new default
  picture): darwin re-recorded, linux from the stories-baselines workflow on the branch. The
  computed-style goldens re-recorded (`.card.back`'s `background-image`).
