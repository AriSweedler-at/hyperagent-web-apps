# Gin Rummy sandbox: any position on the table in one step

Owner's ask (2026-09-22): "There should be a 3rd game mode, 'sandbox', which lets you arrange the
deck and the hands - or type in a map into the console to set it all like that instantly. …
keep it hidden unless P1 is named 'sandbox' … give a random hand and a random deck ordering …
Have a 'help' modal … give a dropdown of a series of interesting starting points … this is to
make sure the UX is perfect."

## 1. What it is

A third play mode beside Online and Pass & Play, shown only while the first player's name
(`ginRummy_name`, typed into any of its inputs) is `sandbox`. Its panel holds a dropdown of
starting points, an editor with the **map** of the position, Random / Copy / Help buttons, and
"Deal the map", which starts a pass-and-play game dealt exactly as the map says. The same map
deals from the console: `__gin.sandbox(map)`; `__gin.sandboxMap()` prints the current table as
a map to paste back.

## 2. The map

Lines of `key: value`; `#` starts a comment; keys in any case. Cards are the engine's ids
(`AS 10H JD KC`, `T` for ten, any case), space-separated.

| key       | value                                                                              |
| --------- | ---------------------------------------------------------------------------------- |
| `p1`      | the first player's hand: ten cards, eleven in their discard phase                  |
| `p2`      | the second player's hand, likewise                                                 |
| `discard` | the discard pile, bottom first, top last; at least one card outside the discard phase |
| `stock`   | the top of the stock first; every card not named anywhere follows in deck order   |
| `turn`    | `p1` (default) or `p2`                                                             |
| `phase`   | `upcard`, `draw` (default) or `discard`                                            |
| `drawn`   | discard phase: the card the turn player just drew from the stock (the dot, no undo) |
| `melds`   | p1's hand-made melds (ui/hand/arrange.ts), groups separated by `\|`                |
| `target`  | points to win, 100 by default                                                      |

`parseMap` (src/sandbox.ts) reports the first thing wrong, in the panel under the editor. Every
card is dealt once: the named cards must be distinct, and the rest fill the stock. `dealMap`
builds hand number one of a fresh game: the dealer is the other seat (so an upcard phase reads as
the non-dealer's decision), `drawn` is a stock draw with `pendingDraw` and `lastDrawn` set as the
story catalogue sets them. `mapOf(state)` reads a state back (hand-made melds excepted), and
`formatMap(parseMap(text))` reproduces `text`'s meaning.

## 3. The presets (src/sandbox.ts `PRESETS`)

Each exercises something the others do not; the discard pile's card is chosen to matter.

| id               | exercises                                                                         |
| ---------------- | --------------------------------------------------------------------------------- |
| `no-melds`       | ten deadwood cards: sort by rank / by suit, nothing groups                        |
| `one-set`        | one set (7-7-7) beside seven deadwood                                             |
| `one-run`        | one run (4-5-6♠); the 3♠ on the pile extends it                                   |
| `set-and-run`    | a set of queens and 2-3-4♣; the 5♣ on the pile extends the run                    |
| `knock-ready`    | three melds and the 5♦: knock                                                     |
| `gin-in-hand`    | eleven cards in the discard phase, `drawn: 2C`: knock with it for gin             |
| `two-ways-tie`   | 6-7-8♠ with 7♥ 7♦: the 7♠ melds either way and both tie, so the chooser offers both |
| `four-eights`    | 8-8-8-8 beside 9-10♣: the run wins; long-press the 8♣ into the set of four         |
| `seven-run`      | 4…10♠ made by hand (the solver would split it) and K-K-K: three rows on a phone    |
| `six-run-or-set` | 3…8♥ with 3♠ 3♦: the set and a five-run beat the six-run                          |
| `hand-made-set`  | `melds: 7S 7H 7D` costs deadwood (5-6-7♠ broken): long-press a seven to dissolve it |

Random (`randomMap(rng)`) shuffles a deck: ten each, the upcard, the first player to draw.

## 4. UI

- `#playModeSwitch` and `#playSubmenu` each get a third button, `data-mode="sandbox"`, hidden
  unless `App.p1Name` unlocks it (`sandboxUnlocked`). `mode/set sandbox` is refused while
  locked and never written to `ginRummy_playMode`: a reload lands on the stored mode. A name
  typed away from `sandbox` while in the mode falls back to pass-and-play.
- `#sandboxModeContent`: `#sbPreset` (options rendered once from PRESETS plus `random`), `#sbMap`
  (the editor, monospaced), `#sbRandomBtn`, `#sbCopyBtn` (the map as `__gin.sandbox(\`…\`)` to
  the clipboard, a toast), `#sbHelpBtn` (`#sandboxHelpOverlay`), `#sbError`, `#sbStartBtn`.
- `App.sandbox = { preset, map, error, helpOpen }`; intents `sandbox/preset|typed|random|help|
  copy|start`; effect `copy`. `sandbox/start` deals through `startLocal` with the map's
  hand-made melds as `App.human`.

## 5. Oracles

- `src/sandbox.test.ts`: the parser's happy paths and every error, the deal plays through the
  engine, round trips, the random deal, and each preset's claim.
- `ui/state.test.ts`, `ui/home.test.ts`: the unlock, the mode, the editor, the deal, the paint
  and the bindings.
- `e2e/gin-sandbox.spec.ts` (page-only): the unlock by name, the help sheet, a refused map, a
  preset dealt exactly, the console deal drawing the named stock top, the table read back.
- DOM parity normalises the sandbox markup away (`tools/parity/gin-dom-parity.ts`); the
  computed-style goldens pin `#sbPreset`, `#sbMap` and `.sb-help`.

## Status

Landed 2026-09-22.
