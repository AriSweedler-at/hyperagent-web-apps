# Card packs: one vocabulary of cards, many packs, a choice per game

The sound-font pattern (docs/design/sound-fonts.md) applied to pictures of cards, for the fourth
game. The owner (2026-09-25): "make sure the cards look long and thin and have the cups swords etc.
that look classically italian. And we should be able to use card style packs (front AND back) just
how we use packs for sound fonts as well. I'll share a pic later." This is the briscola design's §3
as it landed (PR-1 of its plan), corrected where implementation taught something; the sibling
`card-packs.md` in the design scratchpad holds the longer argument.

## 1. Deck kinds (`web/shared/lib/cards/decks.ts`)

Two vocabularies of cards. `french52` is gin's deck, spelled from gin's engine literals and pinned
equal to `makeDeck().map((c) => c.id)` in gin's order by `test/card-packs.test.ts`; gin's engine
keeps its own `Card` type and never imports the shared module. `italian40` is briscola's (later
scopa's and tressette's): ids `LABEL + suit` with ranks `A 2 3 4 5 6 7 F C R` (fante, cavallo, re)
over suits `C D S B` (coppe, denari, spade, bastoni), suit-major: `AC … RC, AD … RD, AS … RS, AB …
RB`, the briscola design's D10. Briscola's engine builds its deck from `cardIds('italian40')`.

A `DeckSpec` carries `suits` and `ranks` in display order (a rank's `index` is what the glyph
renderer prints; its `label` is the deck's own language, "asso", "sette", for the `alt` text and
the About line), a nominal `aspect` (0.694 for gin's 100 × 144 backs; 0.518 for the Italian deck,
the Bergamo cut the owner's "long and thin" asked for), a `border` and a corner `radius` fraction.
`cardIds`, `isCardId`, `splitId` (the suit is the last letter, the rank the rest: `10H` splits) and
`cardName` ("sette di spade", "seven of spades"). Points and strength are never here: they are each
game's.

`suits.ts` holds the four Italian suit symbols as data (a chalice, a coin with an eight-point star,
a straight sword, a knotted baton; each a few filled shapes with a dark outline in the print colours
coppe red `#c81e1e`, denari gold `#d3a12a`, spade blue `#1d4ed8`, bastoni green `#2f7d32`), drawn
once so the glyph face's symbol, linea's pips and a table's trump badge agree. The long two are 1:5
boxes; swords and batons are parallel verticals, an honest simplification of the interlaced arcs.

## 2. Packs (`web/shared/lib/cards/packs.ts` + `packs/<name>.ts`)

```ts
CARD_PACKS = ['default', 'blue-stripe', 'yu-gi-oh', 'empty', 'linea', 'napoletane']
Back  = svg { url, aspect, colour } | image { urls: {ratio, url}[], aspect, colour } | css { colour } | none
Faces = glyph | files { dir, ext, widths, ids, aspect, inset, indices } | sprite { sheets, cell, cells, aspect, inset, indices }
CardPack = { name, label, back, decks: Partial<Record<DeckKind, Faces>>, attribution: Attribution | null }
packByName, isCardPack, packsFor(kind), isCardPackFor(kind, v), DEFAULT_CARD_PACKS, defaultPackFor(kind)
badCardPackMsg(key, kind, value)   // `<key>: "<value>" is not a card pack for this deck; kept the current one. One of: …`
```

| Pack | Back | `french52` | `italian40` | Attribution |
| --- | --- | --- | --- | --- |
| `default`, `blue-stripe`, `yu-gi-oh`, `empty` | gin's four, as pack data pointing at `../../shared/cards/backs/` | glyph | glyph | none (drawn; the owner's own picture) |
| `linea` | `svg`, a terracotta lattice with a four-suit medallion | — | `files`, 40 svg, `widths: [0]`, aspect 100/193 (0.518), `indices: 'printed'` | none (generated) |
| `napoletane` | `none` (the default's is painted) | — | `files`, 40 jpg, `widths: [120, 240]`, aspect 0.577, `indices: 'overlay'` | Florixc (Wikimedia Commons), Public domain: the sheet the owner supplied (§7.1) |

Each pack file is `as const satisfies CardPack`, so `CardPackFor<K>` is read off the table's literal
types: `packsFor('french52')` is typed and pinned as gin's legacy literal `['default', 'blue-stripe',
'yu-gi-oh', 'empty']` in order, and `packsFor('italian40')` adds `linea` and `napoletane` (a glyph
pack draws every deck kind; a pictures-only pack draws its own). `DEFAULT_CARD_PACKS` is per deck
kind: `default` for `french52`, `napoletane` for `italian40` (the owner's sheet, §7.1; `linea` stays
the drawn fallback every clone has and the stories' pack), the first per-game default
sound-fonts.md §11 deferred.

**Resolution** (`resolve.ts`): `resolveFace(pack, kind, id)` gives a `FaceSpec` (`glyph` with the
rank and suit specs; `image` with the URLs per device-pixel ratio, the alt, aspect, inset and
indices; `sprite` with the sheets, grid and cell), or null for an id that names no card of the
deck. `resolveBack(pack, fallback)` resolves `none` to the fallback pack's back (and a double
`none` to a bare navy field, never shipped). `resolveAspect(pack, kind)` is the pictures' own
aspect for a `files`/`sprite` pack, else the deck's nominal. `attributionLine(pack)` is the About
panel's line for a sourced pack, null for a drawn one. Three silent fallbacks, card by card: a pack
without the deck kind cannot be chosen at all (`packsFor`); a `files`/`sprite` pack missing an id
draws the glyph for that id alone; a `none` back takes the default's.

## 3. Drawing (`web/shared/ui/cardFace.ts`, strings in, strings out)

`faceHtml(spec, { extra })`: a `french52` glyph is gin's `cardHtml(card)` byte for byte (the rank
label, gin's text symbol, the label again as `rank br`, `red`/`black` by suit; gin's
`ui/cards.test.ts` pins all 52 under all four packs, so gin can adopt it with no golden moving); an
`italian40` glyph prints the index twice and one `<use href="#suit-<id>">` into the shared sprite
under `card face glyph suit-<id>`; a `files` or `sprite` face is a `card face` box with `role="img"`,
the card's name as its label, `--face-inset` and the picture painted as its `background-image` from
the pack's document-relative URLs (a plain `url()` of the 2x file first, then `image-set()` with
every ratio, so a browser without `image-set()` keeps the first), a sprite adding `background-size`
and `background-position` for its cell; a face whose pack prints no indices (`indices: 'overlay'`)
carries the two `rank` spans for the stylesheet to place. `backHtml(cls)` is gin's `backHtml`.
`backImageCss(back)` / `backFallbackImageCss(back)` are the `background-image` values a painter
writes for a resolved back. `SUIT_SPRITE_SVG` is the zero-sized `<svg>` of the four `<symbol>`s a
page that shows Italian glyph cards inlines once.

Class names are spelled through constants, never a `class="…"` literal, so the class-contract
extraction (test/dist/classes.ts) does not read them into every game's list; the names no
stylesheet styles yet are a `shared` behaviour-only row in web/shared/styles/CONTRACT.md, and the
briscola page's rows arrive with its stylesheet.

## 4. Choosing a pack: per game, no conflicts

| Game | Key | Deck kind | Default |
| --- | --- | --- | --- |
| gin-rummy | `ginRummy_cardPack` (was `ginRummy_cardBack`) | `french52` | `default` |
| briscola | `briscola_cardPack` | `italian40` | `napoletane` (the owner's sheet, §7.1) |

`web/shared/edge/prefs.ts` builds the readers: `decodeCardPackFor(kind) = literal(...packsFor(kind))`
and `cardPackPref(key, kind)` beside `decodeSoundFont`, so a stored `linea` is refused under gin's
key and accepted under briscola's. The flow is the card back's and the sound font's
(gin-card-backs.md §3, sound-fonts.md §6): `App.table.cardPack` read at `home/init`, an intent to
set it, an effect to write it, the painter writing `body[data-card-pack]` (gin keeps
`data-card-back`), `--aspect` and `data-indices` on the table, the boot logging `badCardPackMsg` for
a stored stranger and dropping it, a console hook `__<game>.cardPack(name)` / `cardPackName()`.

### 4.1 The gin migration (behaviour-preserving)

`src/cardBack.ts` is a view over the shared packs: `CARD_BACKS = packsFor('french52')` (pinned to
the legacy literal), `CardBack = CardPackFor<'french52'>`, `DEFAULT_CARD_BACK`, `isCardBack`,
`badCardBackMsg(v) = badCardPackMsg('ginRummy_cardPack', 'french52', v)`. `storage.ts` renames the
key to `ginRummy_cardPack`, decodes through `cardPackPref`, keeps the retired name under
`RETIRED_KEYS.cardBack` and adds `migrateCardBack(store)`: a preset under the retired key moves to
the new key when the new key is empty, the retired key goes either way, a stranger is returned for
the boot to log under the new key's message. `main.ts` runs it once before the first home read and
exposes `__gin.cardPack(name)`, `__gin.cardPackName()`, with `__gin.cardBack(name)` kept as an alias
for one release. `body[data-card-back]`, its four values, `cardHtml`/`backHtml`, theme.css and every
golden are untouched: `git diff --stat web/games/gin-rummy/` is `cardBack.ts`, `storage.ts`,
`main.ts` and their tests plus the glyph pin in `ui/cards.test.ts`; the parity storage suite lists
the new key as this page's own; `e2e/gin-card-back.spec.ts` carries the new key, the new message,
the `linea` refusal and the migration case.

## 5. The tool (`tools/card-packs.ts`, Playwright, the shape of `tools/card-backs.ts`)

```
node --experimental-strip-types tools/card-packs.ts build                    # every PACK_SOURCES entry (napoletane); idempotent
node --experimental-strip-types tools/card-packs.ts add <name> --deck italian40 --faces <dir> [--back <img>] --label … --author … --source-url … --licence … [--licence-url …] [--note …] [--mask <id>:<x>,<y>,<w>,<h>]… [--map <file>]
node --experimental-strip-types tools/card-packs.ts add <name> --deck italian40 --sheet <img> --rows C,D,S,B --cols A,2,3,4,5,6,7,F,C,R [--grid <inset>] [--back <img>] …
node --experimental-strip-types tools/card-packs.ts check                    # the manifest test as a CLI
node --experimental-strip-types tools/card-packs.ts preview <name> [--deck italian40] [--width 120] [--out <png>]
```

- Sources are committed once as supplied under `assets/cards/<name>/` with a `SOURCES.txt`; derived
  files land under `web/public/shared/cards/<name>/<deck>/<id>-<width>.<ext>` (`<id>.<ext>` for an
  SVG) and `back-<width>.<ext>`, served at `../../shared/cards/<name>/…` from every game page on both
  origins (the sound-font convention; `test/dist/asset-urls` holds it); the manifest
  `web/shared/lib/cards/packs/<name>.ts` is generated with a "do not edit" header.
- Face ids: `<id>.<ext>`; the decks' own numbering (`1D`, `8C`, `10B` → `AD`, `FC`, `RB`);
  Commons-style Italian names ("05 Cinque di coppe.jpg" → `5C`, "40 Dieci di Bastoni" → `RB`); else
  `--map file.txt` (`<file>\t<id>` per line).
- Sheet mode: the share of non-white pixels per column and row; a run under 2% is a gutter; the
  `cols × rows` longest runs between gutters are the cells (runs split by a gap under 4 px merged);
  each cell trimmed to its ink box plus 6 px, then every cell normalised to the grid's median size
  centred on its ink box. The tool prints the grid it found and refuses on a wrong count. That
  wants a printed border and a white gutter.
- Grid mode (`--grid <inset>`), for a sheet of borderless cards laid edge to edge on the scanner
  bed (the owner's Napoletane sheet: to the ink cutter its white margins are gutters and a six's two
  pip columns two cards): `cols × rows` equal cells; each interior grid line snapped, row by row, to
  the seam between two cards, scored within `GRID_SNAP` (40 px) as the share of the row's middle
  80 % where a 3 px window is darker than `PAPER` (245) with paper `SEAM_CLEAR` (6 px) either side
  (a card's scan shadow is a thin grey line; a sword's edge fails, its blade being there); a row that
  shows no seam over `MIN_SEAM` (0.4) takes the median of the rows that did, a seam no row shows
  the grid line; every cell equalised to the median card, a cell on the sheet's edge anchored on
  its seam and grown outward past the sheet (the scan clipped the outer margins; what lies outside
  is drawn as paper); then `inset` px shaved. No ink trimming: the card's own margins are the
  picture. The tool prints the seams it found.
- Derivation: `FACE_WIDTH = 120` CSS px, `RATIOS = [1, 2, 3]`, a ratio only when the source is at
  least that wide (a 263 px source yields `[1, 2]`), height = `round(width / aspect)`, JPEG at 0.86.
  `--mask` paints a white rectangle over a region of one face before deriving: a maker's mark.
- `check`: the body of `test/card-packs.test.ts` (`checkPack`): every URL `../../shared/`-relative,
  every derived file present with its frame size (JPEG SOF, PNG IHDR, SVG viewBox within 1%) and
  aspect, `widths` multiples of `FACE_WIDTH`, a shipped `files` pack total, a raster or sprite pack
  attributed, a face under 120 KB, a pack's tree under 6 MB.
- Two manual lines: `add` prints the name to add to `CARD_PACKS` and the row for `PACKS`; `check`
  fails until both are done.
- `preview` sketches the two corner indices on an `overlay` pack's faces at the size a table prints
  them (top-left, and turned bottom-right, as cardFace.ts places its two `rank` spans), so a
  reviewer sees whether the pictures leave them room.

## 6. The fallback pack, `linea` (`tools/linea.ts`, node, no browser)

Forty SVG faces (`viewBox 0 0 100 193`, aspect 0.518; a `#fdfdf7` field, a thin `#c9b98a` frame,
the index top-left and turned bottom-right with a small suit under it, the suit symbol defined once
under `<defs>` and `<use>`d for every pip so a seven stays under 2 KB; coins and cups on the classic
two-column grid, swords and batons as parallel verticals, up to three full height and two rows from
four; courts as silhouettes in the suit colour on a pale ground holding their symbol, with a large
translucent `F`/`C`/`R` behind them; the ace of coins in a green laurel ring) and one back (a 45°
terracotta lattice with a medallion of the four suits, 2.2 KB). `tools/linea.test.ts` regenerates
the forty-two strings and compares them to the committed files. It is the fallback and the stories'
pack, not the deck the owner is expected to keep; `tools/card-packs.ts preview linea` renders the
sheet a reviewer looks at (read at 120 px: every pip count, colour and index is legible).

## 7. Licences: what was found, and why no sourced deck ships in this PR

The design's PR-1 named two sourced decks from Wikimedia Commons as non-default packs. Both were
downloaded and examined; both carry a licence statement that is the uploader's and the Commons
community's, not a lawyer's, and both are scans of modern commercial reprints of 19th-century
patterns, with the maker's mark on the ace of coins:

| Deck | Commons | Licence as stated | What the pictures show | Verdict |
| --- | --- | --- | --- | --- |
| Bergamasche, `File:Carte_bergamasche.jpg` | one 4 × 10 sheet 3089 × 2229, "the firm of Pietro Masenghini, late 19th century, scanned by Luigi Chiesa, 2006" | Public domain (PD-old + Public Domain Mark) | the ace of coins reads MASENGHINI BERGAMO, MADE IN ITALY and a trade logo: a 20th-century reprint of the pattern; cells ~263 × 508 (aspect 0.518), each card keeping its own border; no back | not shipped: the claim is strong for the pattern and unproven for this redraw and trade dress; never the default |
| Napoletane, `Category:Naples_deck`, Trocche100 (2014) | 40 per-card scans 1324 × 2188 and a back 1383 × 2201 | "Public domain" (PD-self: released by the uploader) | the ace of coins reads T. DAL NEGRO TREVISO, MADE IN ITALY, 531: a Dal Negro print the uploader did not draw; aspect 0.606, trimmed to the printed area | not shipped: an uploader cannot release a maker's redraw; PD-self over a commercial print is the weaker claim |
| Romane, `Category:Romagna_deck`, "Marteau i Georges" | 38 of 40 faces + a back | CC0 | two kings missing (both absent on Commons); completable from the CC0 `Romane Sheet.svg` | the cleanest licence found; listed for the owner |
| Piacentine sheet, Florixc 2009 | one 4 × 10 sheet | PD-self | maker not named | one `add --sheet` away, the same caveat |

The PR's rule was to ship a sourced deck only under a licence that is unambiguously public domain
or CC0/CC-BY. Neither downloaded deck meets it, so this PR ships `linea` as the Italian default and
leaves the decision to the owner, with everything ready: the tool cuts the Bergamasche sheet
(`add bergamasche --deck italian40 --sheet assets/cards/bergamasche/sheet.jpg --rows B,S,C,D --cols
A,2,3,4,5,6,7,F,C,R --mask AD:<x>,<y>,<w>,<h> …`, the rows in the sheet's own order) and takes the
Napoletane folder as is (`add napoletane --deck italian40 --faces assets/cards/napoletane --back
assets/cards/napoletane/back.jpg --mask AD:… …`), masks the ace of coins, writes the manifest and
prints the two lines. If the owner accepts a deck: copy its download folder (with its
`SOURCES.txt`) under `assets/cards/<name>/`, run `add`, add the two lines, run `check`, look at
`preview`, commit sources, derived files and manifest together, and record the decision here. If
not, the Romane CC0 set is the one worth completing, and the owner's own picture goes through the
same `add`.

### 7.1 The Napoletane sheet the owner supplied (2026-09-25)

The owner sent `File:Carte_napoletane_al_completo.jpg` from Wikimedia Commons (uploader and artist
Florixc, "Own work", 2009-09-06; licence Public domain, Commons `pd`, Copyrighted False, attribution
not required; 3507 × 2398, 2,038,168 bytes, sha256 `7f192cb10e81cfdc3f63817988998984f80f7751a717c519dac3fef5de03fc5d`)
with the words "This is the briscola card pack full scan. You will need to dispatch a workflow to
cut out each individual card, which will be an image and overlayed on the cards. […] I want to have
a napoletane card pack, american card pack, and eventually a tuscany card pack (but I will share the
tuscany scan(s) later, so just implement what you can for now and remember this for later)". The
owner supplied it, so the rule above is lifted for this file alone; its facts are here and in
`assets/cards/napoletane/SOURCES.txt`, the file itself committed unchanged as `sheet.jpg`. The sheet
is 4 × 10 in its own order, rows denari, coppe, bastoni, spade and columns A 2 3 4 5 6 7 fante
cavallo re (`--rows D,C,B,S --cols A,2,3,4,5,6,7,F,C,R`; the preview confirms the eagle ace is `AD`
and the amphora ace `AC`). Nothing is masked: the eagle on the ace of coins and the arms on the four
are the pattern's art, and no card names a maker. The cards are borderless and butted edge to edge
(3507 ≈ 10 × 351, 2398 ≈ 4 × 600, hand-laid up to 32 px off an equal grid, the outer margins
clipped by the scan, each edge a faint 160–240 grey shadow), which the ink cutter cannot cut, so
grid mode (§5) was written for it: `build` (`PACK_SOURCES.napoletane`, `--grid 6`) finds the seams
(row 1: 337 691 1036 1386 1741 2095 2451 2808 3153; rows at ≈ 590 1195 1798), cuts forty 338 × 586
cells, aspect 0.577, at 120 and 240 px (a 338 px cell serves no 3x without upscaling): 80 JPEGs,
1.12 MB, `indices: 'overlay'` (the pattern prints none; the corners are clean at 120 px), no back
(the sheet has none; the default's is painted). It is the `italian40` default; `linea` stays the
fallback and the stories' pack. The Trocche100 per-card scans in the table above remain unshipped:
the owner's supply covers this file, not that maker's redraw. The owner's `american` pack ("the
regular cards that you use for gin rummy … just hearts clubs diamonds spades") and the `tuscany`
pack (its scan to come; a sheet with printed borders and gutters takes the ink cutter, one laid edge
to edge `--grid`) are the next two entries of this section.

## 8. Module map, boundaries, tests

| Module | Zone | Holds |
| --- | --- | --- |
| `web/shared/lib/cards/decks.ts` | pure | `DECK_KINDS`, `DeckSpec`, `DECKS`, `cardIds`, `isCardId`, `splitId`, `cardName` |
| `web/shared/lib/cards/suits.ts` | pure | `ITALIAN_SUIT_SYMBOLS`, `suitSymbol`, `suitSymbolId`, `placedSymbol`, `fmt` |
| `web/shared/lib/cards/packs.ts` | pure | `CARD_PACKS`, the types, `FACE_WIDTH`, `packByName`, `isCardPack`, `packsFor`, `isCardPackFor`, `CardPackFor<K>`, `DEFAULT_CARD_PACKS`, `defaultPackFor`, `badCardPackMsg` |
| `web/shared/lib/cards/packs/<name>.ts` | pure data | gin's four, hand-written; `linea` and `napoletane`, generated (in .prettierignore) |
| `web/shared/lib/cards/resolve.ts` | pure | `FaceSpec`, `PaintedBack`, `resolveFace`, `resolveBack`, `resolveAspect`, `attributionLine` |
| `web/shared/ui/cardFace.ts` | ui, lint-pure | `faceHtml`, `backHtml`, `backImageCss`, `backFallbackImageCss`, `SUIT_SPRITE_SVG` |
| `web/shared/edge/prefs.ts` | edge | `decodeCardPackFor(kind)`, `cardPackPref(key, kind)` |
| `web/public/shared/cards/backs/` | served | copies of gin's five back files with a `SOURCES.txt` (a Vite build serves only `public/` as files, so the pack data cannot point into the gin folder; gin's own copies stay for its theme) |
| `web/public/shared/cards/linea/` | served | the forty faces and the back |
| `assets/cards/napoletane/` | source | the owner's sheet as supplied (`sheet.jpg`) and its `SOURCES.txt` (§7.1) |
| `web/public/shared/cards/napoletane/` | served | the eighty derived faces under `italian40/` and a `SOURCES.txt` naming the tool run |
| `tools/card-packs.ts`, `tools/linea.ts` | tools | §5, §6 |
| `test/card-packs.test.ts` | `shared` suite | the manifest test and the two engine pins (under `test/`: the pure tsconfig compiling `web/shared/lib` has no node types) |

Lint: `web/shared/lib/cards/**` imports nothing outside `web/shared/lib`; `cardFace.ts` imports
lib only and no DOM; `web/shared/lib/**` and `web/shared/ui/**` measure 100/100/100/100 with these
modules (the shared suite's rows hold); `web/shared/edge/**` at 99.75/96.6/99.4/99.7. Tests beside
every module (`decks`, `suits`, `packs`, `resolve`, `cardFace`, `prefs`), `tools/card-packs.test.ts`
(the id mapping, paths, the ratio cut-off, the size readers, the gutter finder and the cell
normaliser over synthetic input, the seam grid's pure half, masks, the manifest text, the argument
parser),
`tools/linea.test.ts`, gin's `cardBack`, `storage` (the round trip and `migrateCardBack`) and
`ui/cards` (the glyph pin) tests, `e2e/gin-card-back.spec.ts`.

## 9. Corrected at implementation

- A `files` face paints its picture as the card box's `background-image` (the PR's brief), not an
  `<img>` with `srcset` as the design sketched; the label is `aria-label` on a `role="img"` box.
- `badCardPackMsg(key, kind, value)`: the list of accepted names is per deck kind, so the message
  takes the kind.
- Gin's back files are copied under `web/public/shared/cards/backs/` rather than referenced in
  place: `dist/games/gin-rummy/backs/` does not exist after a build (the theme inlines the SVGs and
  hashes the JPEGs into `shared/assets/`), so a URL into the gin folder would resolve to nothing.
- The Italian nominal aspect is 0.518 (the Bergamo cut the layout was designed on), not 0.53; linea
  draws at 100 × 193. A face defines its suit symbol once and `<use>`s it, so the largest face is
  under 2 KB rather than the 5 KB seven inline pips gave.
- The manifest test sits at `test/card-packs.test.ts` in the `shared` suite (a suites.ts row) because
  `web/shared/lib` is compiled by the DOM-less, node-less pure tsconfig and cannot read the disk.
- A drawn SVG `files` pack needs no attribution; a raster or sprite pack does (the test's rule).
- The `glyphs?: Record<suit, url>` field was dropped: the sprite is inline markup, not files.
- `preview` joined the tool's commands: the sheet a reviewer reads is how a pack is judged.
- The ink cutter assumes a printed border and a white gutter; the owner's Napoletane sheet has
  neither, so `--grid <inset>` (the seam grid, §5) joined sheet mode, with `equaliseCells` allowed
  past the sheet where `normaliseCells` clamps, and the draw clipping the source rectangle itself
  so what lies outside the scan is paper.
- `preview` sketches the overlay indices on an `overlay` pack's faces: legibility on the picture is
  part of judging a pack.
- One sourced deck ships after all, because the owner supplied it (§7.1): `PACK_SOURCES` holds
  `napoletane` and its test pins that one entry; the `italian40` default is `napoletane`, not
  `linea`.
