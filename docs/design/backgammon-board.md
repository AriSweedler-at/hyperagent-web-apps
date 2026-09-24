# Sheshbesh: the table screen and its shell

The design `web/games/backgammon/` is built from, distilled to what a reader of the code needs:
the decisions, the one DOM that serves both viewports and both seats, the CSS plan, the
interaction model, the shell, accessibility, testability, the harness registration and the risks
carried. The rules the table plays are `docs/design/backgammon-rules.md`; the engine is
`src/engine/`. Conventions follow gin: static ids in `index.html`, a pure `reduce`/`runEffect`
(`ui/state.ts`), painters over `web/shared/edge/dom.ts`, markup builders tested as strings,
`body.fixed-screen` with no page scroll. Seat 0 = Light (host), seat 1 = Dark (guest); "own N" is
the viewer's own numbering. The code's comments cite this document by section (`design §4.3`) and
the rules by rule (`rules R13`).

## 1. Decisions

| # | Question | Decision |
|---|---|---|
| Q4 | Pass-and-play cover | Gin's `'local'` role, no Peer. A one-tap turn cue on a translucent curtain (`#curtainOverlay`, the position readable beneath) whose button also rolls; a setting `curtainMode: 'always' \| 'never'` under `backgammon_curtain` (nothing is hidden in backgammon, so the curtain is a courtesy). Western opening: the starter already holds the opening dice, so the button reads "{name} — play 6-3" and only reveals. |
| Q5 | Names | Display name `Sheshbesh`; `<title>` `Sheshbesh — backgammon` (`tools/games.ts PAGE_TITLES`); folder and `Game` literal `backgammon`; hook `window.__backgammon`; room codes 4 letters from gin's alphabet with `peerPrefix 'sheshbesh-'` and gin's length error. |
| Q6 | Rejoin | Gin's name-based rejoin. |
| Q7 | Invite | `?join=<code>` through `web/shared/lib/invite.ts` and `web/shared/edge/invite.ts`. |
| Q11 | Copy | Plain English, with exactly three non-English strings anywhere: the name `Sheshbesh`, `Buen mazal!` on the roll button, `Kapará.` opening the hit toast. |
| Q12 | Toast | Gin's: `TOAST_MS 2600`, one restarting timer, `#toast` last in the body. |
| Board | One DOM: 24 direct children `#point-1..#point-24` of `#board` in absolute order plus `#barTop #dice #cube #barBottom #offLight #offDark`; placement by two `grid-template-areas` strings (phone, desktop) whose area names are own numbers; the seat perspective is `data-own` on each point and `data-seat` on `#board`. |
| Chirality | Home bottom-right on the phone (own checkers run clockwise there, counter-clockwise on the desktop). The alternative is one grid string and two selectors. |
| Geometry | `--point-w` 47px at 390x844, checkers 40px, a 27.6px coin step; below 806px tall the document scrolls instead of clipping; `touch-action: none` on `.checker` only. |
| Input | Tap-to-move, one tap per move, the sole legal source auto-selected (`.selected.auto`, ring without lift); drag through gin's dragger reshaped (`ui/board/dragger.ts`). |
| Ambiguity | A die-chip tray in the controls row (`#moveChips`, 56px chips labelled with the dice as digits and the destination) only when a choice exists: a bear-off both dice suffice for, or two orders of a combined move whose intermediates differ. The trays always name the die they will spend (`data-die` "6", "6·5"). |
| Which die | `.die.dead` when no maximal play uses a die; tap a die to force it (`die/pick`, targets recomputed for that die alone, the status line confirms "playing the 6"). |
| Status line | Always names what is left ("3-1 · play both dice", "6-5 · the 6 cannot be played", "6-1 · enter from the bar", "Last move: the turn ends when you play it"), the dice in words in a visually hidden span. |
| Stacks | Five checkers drawn; a count badge on the top visible checker from the sixth on; the point label stays. |
| Turn end | No `done` action: the turn ends by itself when no maximal play extends what was played (rules R13); `#doneBtn` is reserved and hidden in every state. |
| Hit toast | "Kapará. {name} hit you on your {n}-point." for the player hit, in their own numbering, from the moves (`played[i].hit`, `lastPlay`), never from log text. Online it fires as the opponent's hit moves arrive; in pass-and-play when the phone reaches the player hit (§4.9). |
| Accessibility | Every tap target ≥ 44px on the phone (the geometry e2e asserts it), a painted `aria-label` per place, Enter/Space on a focused place is its tap, Escape closes the sheet or the tray. |
| Online | Gin's flow, the default mode: the Online panel (name, match length, rules, "Open a table" / "Sit down" by code), `#hostWaitScreen` with the 4-letter code, "Share invite" and "Start the match", `#guestWaitScreen`; the host applies both seats' actions (`hostDispatch`) and broadcasts the guest's `View`, a refusal is a `toast` frame, the guest's Roll is an `action` frame the host rolls; the table's 🌐 and the curtain's "Continue online" hand a pass-and-play game to a fresh room (`handoff/click`); saves per role drive "Resume hosting room X" / "Rejoin room X". |
| Online | Hidden in the page PR (`ui/state.ts ONLINE_MODE_SHOWN = false`: the mode switch, the Online panel and the curtain's "Continue online" are hidden and pass-and-play is the default); the sessions, protocol and storage shapes are in place for the online PR (§5.3). |

## 2. The one DOM

### 2.1 The table screen

`#tableScreen`: `.topbar` (`#menuBtn`, the opponent strip `#oppName #oppDot #pipsOpp`,
`#gameBadge` "Game 3 · 2–1 · to 5", `#rulesBtnGame #historyBtn` on the desktop, `#soundBtn` with
`aria-pressed`), `#statusLine` (`#statusText`, `#statusDice.sr-only`), `#board`, `.controls`
(`#myName #pipsMe`, `#undoBtn` disabled rather than hidden, `#doubleBtn`, the reserved hidden
`#doneBtn`, the roll slot holding `#rollBtn` "Buen mazal! roll" / `#diceMini` / `#waitNote` /
`#resultChipBtn`, then `#moveChips` and `#chipCancelBtn`). Points carry `data-abs` (static),
`data-own`, `pt-a`/`pt-b` (absolute parity, the two triangle shades) and `pt-near`/`pt-far` (own
1..12 near). `#barTop` is always the far player's bar and `#barBottom` mine; `#offLight`/`#offDark`
are colour-fixed and CSS places them near or far by `#board[data-seat]`. `paintSeat` rewrites
`data-own`, `pt-near`/`pt-far` and `data-seat` only when the seat differs, so the markup ships seat
0's and the page fake and the goldens see a whole board before any paint. The opponent's name
pulses (`.opp-strip.to-move`) while they are to move.

### 2.2 Keys, highlights and flights

Static vs. rebuilt: each place has a `data-key` (`L5`, `D2`, `-0` for the points and bars; the
count for the trays; dice `6-5:dl:-:0`, faces plus used/dead/picked/roller) and its children are
rebuilt only when the key changes (`checkersHtml`, `slabsHtml`, `diceHtml`, `chipsHtml` in
`ui/board.ts`, string-tested). Highlights (`can-move selected auto target target-2 only hit shake
drop`), `data-die` and the `aria-label`s are toggled outside the key, so a selection never rebuilds
a stack and the `.selected` lift transitions. A move changes the key of exactly two containers
(three with a hit). `#dice` pulses `rolling` for the one paint that brings new faces. Flights are
§3.9's.

### 2.3 The other screens and sheets

Gin's ids: `#homeScreen` (`#topTabbar` Play/Rules/About with the long-press mode submenu,
`#playModeSwitch`, `#onlineModeContent` with `#nameInput #matchLengthSel #variantSel #hostBtn
#codeInput #joinBtn`, `#localModeContent` with `#p1NameInput #p2NameInput #localMatchLengthSel
#localVariantSel #localBtn`, `#resumeBox`), `#hostWaitScreen`, `#guestWaitScreen`,
`#endgameScreen` (`#resultTitle #resultSub #matchScore #nextGameBtn #leaveBtn`),
`#curtainOverlay` (`#curtainTitle #curtainSub #curtainLast #curtainBtn #curtainHandoffBtn`),
`#resultOverlay` (`#rsTitle #rsSub #rsScore #rsNextBtn #rsPeekBtn`), `#cubeOverlay`
(`#cubeOfferText #takeBtn #passBtn`), `#rulesOverlay`, `#historyOverlay`, `#menuOverlay`
(`#menuRulesBtn #menuHistoryBtn #menuCurtainToggle #menuLeaveBtn`), the reserved hidden
`#resignOverlay`, and `#toast` last.

### 2.4 The copy

Plain English except the three strings (Q11).

| Element | Copy |
|---|---|
| `<title>` / masthead | `Sheshbesh — Sephardic backgammon` / `Sheshbesh` (GFS Didot), subtitle "Backgammon" (Cardo) |
| Landing card (`web/index.html`) | `Sheshbesh` / "Backgammon, portes or Western rules — pass the phone or play online" |
| Mode switch | Online · Pass the phone |
| Host / Join / Local buttons | Open a table · Sit down · Start |
| Host waiting (`#hostWaitStatus`) | Waiting for your opponent to join · code **ABCD**; `#startGameBtn` "Start the match" |
| Guest waiting | Joining ABCD… / Connected — waiting for Ari to start |
| Roll button | Buen mazal! `<small>roll</small>`; with the curtain off, "{incoming} — Buen mazal! roll" |
| Status line | §1 "Status line"; the tray open: "13 · 6+3 reaches 4 two ways", "4 · either die bears off"; a die picked: "6-4 · playing the 6"; a forfeited roll: "6-6 · no move — turn passes", "4-2 · no entry — turn passes" |
| Target discs | one die: `3`; a combined move: `6+3`, `3+3`, three or four of a double `3×3`, `3×4`; `?` when the tap opens the tray; both dice bearing off: `6·5` |
| Die chips | line one the dice as digits `6·3`, line two the landing `→ 4 via 7, hits` / `→ 4 via 10` / `→ off`; the whole as the chip's `aria-label` |
| Curtain | title "Pass the phone to {name}", sub "Your turn." / "{doubler} doubles to {v}"; `#curtainLast` the turn just finished ("Ari moved 8/5* 6/5 · Ari hit you on your 20-point": the hits in the incoming player's own numbering, the notation the mover's), a forfeited roll as logged, or before any turn the opening roll ("Ari rolled 6, Jeff rolled 4 — Ari starts"; "— Ari plays 6-4" in Western); button by phase: `toRoll` and not `canDouble` → "{name} — roll" (reveals and rolls), `toRoll` and `canDouble` → "{name} — your turn", `moving` (the Western opening) → "{name} — play 6-3", `cubeOffered` → "{name} — answer", `over` → "{name} — look"; handoff "Continue online" |
| Hit toast | Kapará. {name} hit you on your {n}-point. · two hits in one turn: "… on your 20-point and your 5-point." |
| Double offered | {name} doubles to {v}. Take or pass? · Take · Pass ({name} wins {p}); the doubler's roll slot: "{name} is thinking about the cube" |
| Game over | {name} wins 1 point / {name} wins 2 points · gammon / {name} wins 3 points · backgammon / {name} wins 4 points · gammon, cube 2 / {name} passed · {name} wins {p}; sub "{loser} had N checkers left · P pips" or "{loser} passed the double"; "Ari 2 – 0 Jeff · match to 5"; Next game · Look at the table |
| Match won | {name} takes the match {a}–{b} · "6 games" · one row per game "Game 3 · Ari · gammon · 2" · Rematch · Leave |
| Empty tray | `off` (small caps) |
| Share title | Sheshbesh |
| Leave confirms | gin's `LEAVE_LOCAL_MSG`/`LEAVE_ONLINE_MSG` texts |
| Resume labels | Resume hosting room {code} · Rejoin room {code} · Resume pass & play: {a} vs {b} |

## 3. CSS

### 3.1 Tokens and geometry

The eleven shared names are redeclared on this palette (a partial override would inherit gin's
green felt; `test/tokens.test.ts` and `CONTRACT.md` "Tokens" hold it): `--bg #e7d7be` (the
parchment tile's rendered mean, §3.11), `--card #efe8dc`, `--card-2 #e4dac4`, `--accent #0b3c5d`
(aegean, the one accent), `--accent-dark #06253d` (the dark checker, the curtain wash), `--gold
#c9a227` (hairlines only), `--text #2a1a12`, `--muted #685745` (a step darker than the first
cut's `#7a6a58`, which fell to 3.7:1 on the parchment), `--danger #b7472a`, `--radius 12px`,
`--felt` the olive-wood gradient. Game tokens, only the ones a rule reads: `--olivewood-dark
--stone --olive (#5f7133, the dark triangles and the trim) --olive-leaf --nazar --nazar-pale
--walnut --nacre-sheen --serif-display --serif-text`, and the shell's (§3.11) `--panel --nacre
--nacre-dim --hair --parchment-cream`. Geometry lives on `#tableScreen` like gin's `--card-w`:

- phone: `--chrome-h 172px` (#app padding 24, topbar 44, status 22, controls 56, three 8px gaps,
  2px slack), `--bar-w 48px`, `--off-h 44px`, `--point-w clamp(44px, (100dvh - chrome - bar - off
  - 16px) / 12, 64px)` (47px at 390x844), `--point-len min((100vw - 40px) / 2, 220px)`,
  `--checker-d 0.86 point-w`, `--stack-step min(checker-d, (point-len - checker-d - 20px) / 4)`
  (five coins fit with the label corner spared), `--die-s bar-w - 4px` (a 44px hit box, the face
  2px inside);
- desktop (from 900px): `--chrome-h 190px`, `--bar-w = --point-w`, `--off-h 0`, `--point-w
  clamp(40px, min((100vw - 64px) / 14.5, (100dvh - chrome) / 11.4), 72px)` (53px at 1280x800),
  `--point-len 5.2 point-w`, `--stack-step = --checker-d` (touching), `--die-s clamp(32px, 0.8
  point-w, 44px)`, `--off-w clamp(36px, 0.8 point-w, 56px)`; `#app` 1000px wide at the table.

### 3.2 The screen's vertical structure

`body.fixed-screen` and `#app` are the viewport's height with `overflow: hidden`; `#tableScreen` a
column flex with 8px gaps; `.topbar` 44px; `.status-line` 22px with `min-height: 1.35em` so it
never collapses; `#board { flex: 0 0 auto }`; `.controls` 56px with `.roll-slot { min-width:
168px; min-height: 54px }` so the roll button, the mini dice, the wait note and the result chip
share one box (one height in every phase, gin's rule). `.desk-only` hides below 900px (rules and
history live in `#menuOverlay` on the phone). `#controls.choosing` hides the me-strip, Undo,
Double and the roll slot and shows `#moveChips` and `#chipCancelBtn`: the tray takes the row
without changing its height.

### 3.3 The two grid templates and the seat mapping

`#board` is one grid with two `grid-template-areas` templates whose area names are own numbers
(`o1..o24`, `barTop`, `dice`, `barBottom`, `offFar`, `offNear`). The phone template is fourteen rows
(six points a side, the bar band, six more, the off row) in six columns, every point spanning three
so the band names three areas; the desktop template two rows of fourteen columns with `#dice` and
`#cube` overriding their area to span the bar column. `.point[data-own="N"] { grid-area: oN }` (24
one-liners) and `#board[data-seat]` for the trays are the whole seat mapping: for seat 0 `own =
abs + 1`, for seat 1 `own = 24 − abs`. `ui/board/layout.ts` is the pure twin of the two strings and
`test/dist/backgammon-grid.test.ts` parses them out of the built CSS and holds the two together
(a typo in either string is otherwise silent). On the phone the centred cube sits at the dice
area's inner end (two 44px dice and the 26px cube fill the 116px area, so the dice start flush) and
an owned cube moves into its owner's bar half; on the desktop `#cube` spans the bar column and
`align-self` follows `data-owner="far|none|near"`, clearing two bar checkers.

### 3.4 A point: triangle, label, stacking axis

`.point::before` is the triangle (`--stone` for `pt-a`, `--olive` for `pt-b`, `clip-path`
polygons: the phone's far column points at the seam from the left and the near column from the
right; the desktop's far points hang from the top edge and the near ones rise from the bottom).
`.point::after` is the own number, 700 0.7rem Cardo (11.2px): `--text` at .8 on stone (6.5:1),
`--bg` on olive (4.7:1), in the base corner. A checker's place is a pure function of its index
`--i` (0..4, set inline by `checkersHtml`), the side (`--sx/--sy`) and `--stack-step`, so the same
markup lays out sideways on the phone and vertically on the desktop; the sixth checker on is
`display: none` and the count badge sits on the top visible one. The bars stack inward from the
band's outer ends with `--stack-step: 0.45 checker-d` so five fit in a half. The whole cell is the
tap target, never the checker.

### 3.5 Checkers as CSS

`.ck-light`: the nacre sheen, a hairline gold ring, a soft inset shade. `.ck-dark`: a plain
deep-blue disc, a 1px nazar ring at its edge and a second `--nazar-pale` hairline at 60% of the
diameter (the eye motif as a subtle inner ring, never a literal eye). Shape tells them apart without
colour: only the dark one has the inner ring. On the walnut band the dark disc had no edge (1.3:1):
`.bar .ck-dark` adds a 1.5px `--nazar-pale` ring outside it (6.6:1 against the band). Borne-off
checkers are `.slab`s (phone 7 x 26px in a row from the tray's outer edge, desktop 26 x 7px in a
column). An empty `.off` wears a faint slot outline and the word `off` (`:empty::before`), which
the die disc replaces while the tray is a target.

### 3.6 The frame, the meander, the trim

The frame is `#board`'s 8px padding over `--felt` with one gold inset hairline; the meander is
`#board::before`, a 3px Greek key along the frame's inner edge as two half-phase
`repeating-linear-gradient`s in `--gold` at 35% opacity, and nothing else on the frame (no
pinstripes, no watermark). The phone's centre seam is a 1px `--card` line painted into `#board`'s
background so the band and the trays interrupt it. `.bar` and `#dice` sit on `--walnut` so the
band reads as one. The trim (the owner: "green style trim in the background at the border of the
window") is `body::before`: a fixed, inert `--olive` band along the viewport's edge, 6px on a phone
and 10px from 900px, with one `--gold` hairline on its inner side, at `z-index: 0` under every
positioned thing (overlays 50, flyers 60, the toast 100); `#app`'s gutters (12px, 16px from 900px)
keep the board and every control clear of it. No pattern: the meander stays the frame's alone.

### 3.7 Highlight states

| Class / attr | On | Rule |
|---|---|---|
| `can-move` | a `.point`/`.bar` that has a legal move from it | `.can-move .checker.top { outline: 3px solid var(--olive-leaf) }` plus a 1.6 s `glow` pulse of `outline-color`. Outlines, never box-shadows: the checker's own rings stay under the cue |
| `selected` | the chosen source | a 3px `--gold` outline, a 4px lift toward the tip (`transform`) and the lift's shadow as `filter: drop-shadow` |
| `selected auto` | the derived sole source | the ring, no lift, no shadow |
| `target` + `data-die="n"` | a destination `.point`/`.off` | `::after { content: attr(data-die) }`, a 22px `--nazar` disc with the numeral in `--bg` at the tip end; `.target::before { filter: brightness(1.12) }` |
| `target-2` + `data-die="6+3"` | a combined destination | the same disc as a `--bg` pill with a dashed `--nazar` outline and a smaller numeral; `3×3` for three of a double; `?` when the tap opens the tray |
| `only` | the only destinations (one maximal play) | a harder `pulse` on the disc |
| `drop` | a destination under a dragged checker | brighter triangle, the disc scaled 1.15 |
| `hit` | the point where a blot was just hit | `animation: hitFlash 420ms` (a warm wash on `::before`) |
| `shake` | a tapped point that is neither source nor target | `animation: shake 120ms` |
| `arriving` | the just-landed checker during a flight | `visibility: hidden` |
| `inert` on `#board` | not my turn / not moving | `pointer-events: none` on `.point,.bar,.off`; no outlines, no glow |
| `theirs` on `.die` | the opponent's roll | `filter: saturate(.7) brightness(.85)` |
| `used` on `.die` | a consumed die | `opacity: .4` and a diagonal slash over the pips |
| `dead` on `.die` | no maximal play uses it | `opacity: .4`, a `--danger` strike, `aria-disabled` |
| `picked` on `.die` | the die the player tapped to force | a 2px `--gold` ring on the face |
| `blank` on `.die` | before the roll | a translucent nacre square |
| `rolling` on `#dice` | new dice arrived | `animation: tumble 350ms` |
| `die-1..die-6` | the pips | `radial-gradient` dots on the 3x3 grid of `::after`; no images |
| `choosing` on `#controls` | the die-chip tray is open | §3.2 |
| `data-owner` on `#cube` | `near\|far\|none` | §3.3 |
| `hit` on `#toast` | the "Kapará." toast | one inset `--danger` edge, the theme's one warm edge |

Focus: `:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px }` on every
`.point,.bar,.off,#dice,.btn,.icon-btn,.chip,.tab-btn,.mode-btn`.

### 3.8 Motion

`transform` transitions 160ms on `.checker`; flights 260ms (`FLY_MS`), ease `cubic-bezier(.2,.8,
.2,1)`; a hit's flight to the bar starts 80ms after the mover lands; the chip tray fades in over
160ms; `tumble` 350ms once per new roll key; `hitFlash` 420ms; `glow` 1.6s loop. `@media
(prefers-reduced-motion: reduce)` disables `tumble`, `glow`, `hitFlash`, `shake` and the pulses and
sets the flyer's and the checker's `transition-duration` to 1ms so the fallback timer is the only
delay.

### 3.9 Flights (`ui/board/fly.ts`)

`flyMoves(doc, flights, repaint)` with `Flight = { fromContainer, toContainer, slab?, hit? }` over
`PlaceId = 'point-N' | 'barTop' | 'barBottom' | 'offLight' | 'offDark'`: before the repaint it
measures the top checker in `fromContainer`; it repaints; it finds the top checker (or newest slab)
in `toContainer`, marks it `arriving`, clones the source into `doc.body` as a fixed `.flyer`
(`--checker-d` set to the rect's width, as gin's ghost sets `--card-w`), forces a layout read, sets
the translate (`scale(.35, 1)` toward a slab, class `flyer-slab`) and on `afterTransition(flyer,
…, FLY_MS + 60)` removes the flyer and `arriving`. Zero rects (the page fake): repaint and return.
Flights come from the pure `flightsBetween(prev, next)` (`ui/board.ts`): the new `played` moves
(plus hit → the opponent's bar), an undo reversed, a finished turn's `lastPlay` beyond what was
already shown; more than four flights (`MAX_FLIGHTS`) or a new roll repaint cold. `fly.ts` may not
import `ui/state.ts`; it takes rects and ids only. The points a hit flight lifts from flash `hit`.

### 3.10 Short viewports

With `--point-w` floored at 44px the phone board is 636px and the screen needs 806px; below that
(`@media (max-height: 805px) and (max-width: 899px)`) the document scrolls instead of clipping the
controls, gin's rule with the threshold derived for this board; the desktop's floor is 646px
(`max-height: 645px`). The board itself can be scrolled from: `touch-action: none` is scoped to
`.checker`.

### 3.11 Background and panel

The owner, from the comparison page of eight backgrounds under a mock of the home panel: "That
parchment background looks great. I much prefer the rich blue", then "Pergament.2 flesh". The
background is that candidate: a CC0 photograph of the smooth flesh side of a medieval parchment
(Wikimedia Commons [File:Pergament.2.jpg](https://commons.wikimedia.org/wiki/File:Pergament.2.jpg),
Membeth, 2012, CC0 1.0; 1024² at 600 dpi), mirror-tiled 2×2 so every edge meets its own reflection
(`assets/parchment-flesh.jpg`, 2048², 299 KB, JPEG quality 0.86), painted on `html` and `body`
at its native 2048px so the grain is the same at every width, under a cream multiply
(`--parchment-cream #eee0c8` as a gradient layer with `background-blend-mode: multiply`) that
gives the nearly white photo its tone; `background-color: var(--bg)` beneath is the tile's
rendered mean `#e7d7be`, the page's tone before the JPEG arrives. The attachment is the default
(`fixed` breaks on iOS). The trim (§3.6) stays over it. Vite emits the tile beside the page's CSS
under `shared/assets/` with a document-relative `url()`, which the dist guards accept.

The panel is the mock's "rich blue" mode: `.tabbar`, `.mode-switch`, `.tab-submenu` and every
`.card-box` (the Play panel's cards, `#resumeBox`, the waiting rooms, the match-over screen) in
`--panel`, a `#0d4266 → --accent (#0b3c5d) → #082e49` gradient, with the gold hairline `--hair
rgba(201,162,39,.62)` inset and a `0 8px 22px` blue-black shadow; text on it `--nacre #f3ecdf`;
labels, field labels, notes and the muted status `--nacre-dim` (nacre at 72%); the open tab and
mode nacre with `--accent` text, the tab with a 2px `--gold` underline; inputs and selects nacre
with a gold-tinted edge and the accent for the chevron; the primary button (`.btn-primary`,
everywhere) a step lighter than the panel (`#155a86 → #0f4a70`) with the same hairline and nacre
text; secondary buttons, the icon buttons, the badge and the die chips nacre (the old `--card-2`
is 1.02:1 against the parchment); in a `.sheet` the secondary buttons keep `--card-2`. The
sheets, the curtain wash and the board keep their look; where the board and the toast wrote `--bg`
as light ink (the olive labels, the count badge, the target disc, the hit toast) they write
`--nacre`. `--muted` steps to `#685745` so the secondary text keeps 4.5:1 on the darker page
(§6 has the pairs). The keyboard focus ring is `--gold` on the panel, where the accent ring would
vanish. No class is added: the panel is what `.card-box`, `.tabbar` and `.mode-switch` now look
like, so the waiting rooms and the match-over screen follow without a hook.

## 4. The interaction model (`ui/state.ts`, `App = { shell, table }`)

### 4.1 The reducer slice and the pure helpers

`Table = { selected, picked, pending, drag, shake, resultOpen, menuOpen, historyOpen, curtain,
curtainMode, noMoveUntil, lastPainted }`: a tapped source only (the sole legal source is derived,
never stored), a die forced by tapping it (cleared after a move), the die-chip tray `{ from, to,
chains }`, a drag `{ from, over }`, the overlays, the seat the phone is handed to, the persisted
curtain setting, the R14 beat's deadline and the view the previous paint showed (for
`flightsBetween`). Pure helpers in `ui/board.ts` (string- and table-tested; they import the
engine and never `ui/state.ts`): `sideOf`, `sourcesOf(v)` (distinct `from` over `v.legal`),
`effectiveSelection(selected, v)` = the tapped source, else the sole source, `chainsFrom(v, from,
picked)`, `targetsOf(v, from, picked)`, `deadDice(v)`, `statusText(v, opts)`, `barsOf`,
`flightsBetween`, `placeAria`, `chipsFor`, `resultText`, `lastTurnEntry`, `hitsAgainst(v, seat)`.
`chainsFrom` extends same-checker chains through the engine's `legalFirstMoves` after each step
(at most four deep, at most two continuations a level), so two-die targets and the dead dice are
exact from `board` and `movesLeft` without the capped `plays`. `targetsOf` groups chains by `to`: a
`to` reached by exactly one chain of length 1 is a `target` with `data-die = die`; one reached only
by chains of length ≥ 2 a `target-2` with `data-die` the dice joined (`6+3`, `3×3`), marked `?`
when the chains differ in `hits`; `'off'` reached by two length-1 moves with different dice is a
`target` with `data-die = "6·5"` that opens the tray.

### 4.2 Tap-to-move

One delegated `click` on `#board`: `closest('.point')` → `point/tap {abs − 1}`, `.bar` →
`bar/tap`, `.off` → `off/tap`, `#dice .die` → `die/pick {die}` when moving (else `roll/click`),
`#dice` otherwise → `roll/click`. No seat or viewport logic in the binder; the reducer knows which
bar and tray are mine. Reducer, my turn and `phase === 'moving'`, with `sel =
effectiveSelection(table.selected, v)` and `T = targetsOf(v, sel, picked)`:

1. `point/tap p`, `sel === null`: `p ∈ sourcesOf(v)` → `selected = p`; otherwise `shake` on `p`
   (a 120ms class via a `startTimer` effect, no toast).
2. `point/tap p`, `p === sel` → `selected = null` (the derived sole source keeps its `auto` ring).
3. `point/tap p`, `p ∈ T` reached by one chain → commit the chain's moves in order (one `move`
   action each); `selected = null; picked = null`.
4. `point/tap p`, `p ∈ T` reached by chains that differ in consequence → `pending = { from: sel,
   to: p, chains }`: the controls row shows the tray (§4.3).
5. `point/tap p`, `p` another source → `selected = p`.
6. `bar/tap`: `bar[me] > 0` → `selected = 'bar'` (also the derived sole source).
7. `off/tap`: `'off' ∈ T` with one die → commit; with two dice → `pending` with the two one-move
   chains.
8. `die/pick d`: `picked = picked === d ? null : d` when `d` is in `movesLeft` and not dead;
   targets recompute for that die alone (no combined targets); the pick clears after the commit.
9. A tap while `#board.inert` is dropped by CSS (`pointer-events: none`) and by the reducer.

Commit = `applyAction(game, seat, move, rng, now)` locally / on the host, or one `{t:'action'}`
frame per move from the guest, in order; the host applies sequentially and broadcasts after each;
a refused second move comes back as a `toast` frame and the next `state` frame restores the board.
After each commit the reducer recomputes `sel`: if one source remains it is auto-selected.

### 4.3 The die-chip tray

`chipsFor(v, chains)` yields one `Chip { dice, to, via, hits }` per chain in the player's own
numbering, ordered by the higher first die, then fewer hits. `chipsHtml` writes
`.chip[data-index][data-dice][data-to][data-via][data-hit]` with two lines: `.faces` the dice as
digits (`6·3`; die glyphs drew as empty boxes at chip size on phones) and `.via` the landing (`→ 4
via 7, hits`, warm when the chain `hits`), the whole as its `aria-label`. `chip/tap {index}`
commits that chain's moves in order and clears `pending`, `selected`, `picked`. `chip/cancel` (the
`✕`, a tap on the board, a source tap, Escape) clears `pending` only. The tray is the only way to
choose the order of a two-order combined move whose intermediates differ; it also decides which
die a double-sufficing bear-off spends. The board discs stay primary: the tray never appears for an
unambiguous destination.

### 4.4 Which die

A single-step destination names its die. Bear-off from own `n` with the exact die `n`: that die;
from the highest point below a bigger die: that die; when both dice bear off the same checker the
disc reads `6·5` and the tap opens two chips (`moveTo(legal, from, 'off')`, exact else largest, is
what the drag-drop and the replay policy use). `.die.dead`: for non-doubles, die `d` is dead iff no
play in `v.plays` contains a move with `die === d`; for doubles, the last `4 − v.plays[0].length`
faces. Tapping a dead die does nothing (`aria-disabled`). Tap-a-die-to-force-it (`die/pick`)
recomputes targets for that die alone and the status line reads "6-4 · playing the 6".

### 4.5 Forced play, auto-select and the end of the turn

If `sourcesOf(v)` has one element it is pre-selected (`.selected.auto`) and the player taps the
destination: one tap per move, never zero. If `v.playsTotal === 1` the destinations pulse harder
(`target.only`). Nothing commits without a tap except R14 (no legal move at all), where the engine
passes the turn inside `roll`: the status reads "6-6 · no move — turn passes", the reducer sets
`noMoveUntil = now + NO_MOVE_MS (1200)` (a `startTimer` effect) and keeps the position visible;
`noMove/elapsed` lets the curtain rise (local) or the state settle (online). Turn end is the
engine's: the `move` that completes the maximal play flips `turn` (R7/R13). When exactly one
playable die remains the status line reads "Last move: the turn ends when you play it".

### 4.6 Undo

`#undoBtn` "Undo": enabled when `phase === 'moving'`, my turn, `played.length > 0`; disabled, not
hidden (the controls row keeps its shape). `undo/click` → `applyAction(undo)` (R26): board back to
`turnStart`, `played = []`; host-applied online. `flightsBetween` yields the reversed flights. The
last die of a turn cannot be undone; the status line said so before the tap.

### 4.7 The roll button and the roll slot

`#rollBtn` "Buen mazal! (roll)": shown when it is my turn and `phase === 'toRoll'`; dispatches
`roll/click` → `applyAction(roll)`; online the guest sends `{type:'roll'}` and the host rolls.
Tapping `#dice` is the same intent. Hidden while `moving` (the slot shows `#diceMini`), during the
opponent's turn (`#waitNote` "Waiting for Jeff…"), under the curtain, and while `phase === 'over'`
(`#resultChipBtn` when the sheet is closed). In pass-and-play with `curtainMode: 'never'` the
button carries the incoming player's name, the only cue that the phone changed hands.

### 4.8 Double / Take / Pass (Western only)

`#doubleBtn` "Double" shows beside Roll when `v.canDouble` (`toRoll`, my turn, cube centred or
mine, not the Crawford game, value < 64). → `double` → `phase = 'cubeOffered'`, the responder is
`actorOf`. The responder sees `#cubeOverlay`: "Ari doubles to 2. Take or pass?", Take, "Pass (Ari
wins 1)". The doubler sees `#waitNote` "Jeff is thinking about the cube". Take: `cube = {value x
2, owner: taker}`, `phase = 'toRoll'`, the doubler rolls. Pass: the result sheet at once (`reason
'passed'`, points = the pre-double value). Pass-and-play: the curtain first ("Pass the phone to
Jeff" / "Ari doubles to 2" / "Jeff — answer"), then the overlay. `#cube` shows the value and sits
on the owner's side (`data-owner`). In portes `#cube`, `#doubleBtn` and `#cubeOverlay` stay hidden.

### 4.9 The curtain and the hit toast (pass-and-play)

Role `'local'`, no Peer. `localBroadcast` shows the actor's view (the mover, or the seat answering a
double) while the game is on, the revealed seat's once it is over; when the turn flips, a game
starts or a double is offered it sets `curtain = actorOf(game)` unless that seat is the one that
last revealed, and `paintCurtain` raises `#curtainOverlay` (`rgba(6,37,61,.78)`, the position
readable beneath) with §2.4's curtain copy from `curtainText(view, incoming)` (`ui/local.ts`, pure
and table-tested): `#curtainLast` is `lastTurnText(view, incoming)`, the turn just finished with
its hits in the incoming player's numbering through `hitsAgainst`, or the opening roll before any
turn. One tap dispatches `curtain/reveal` and then `roll/click` only when the button promised a
roll (`data-rolls`). `#curtainHandoffBtn` "Continue online" is gin's handoff (`handoff/click`).
`curtainMode: 'never'` (the menu toggle, persisted) skips the overlay; nothing is hidden either way
(Q4). A forfeited roll (R14) keeps the roller's dice on show for `NO_MOVE_MS` before the curtain
rises.

The hit toast is for the player hit, so in pass-and-play it fires when the phone reaches them, not
at the turn's end when the hitter still holds it (and when the hitter's own view had already shown
every move, so a diff of views found nothing): `handedHits(game, seat)` reads `hitsAgainst(viewFor
(game, seat), seat)` (the hit points of `lastPlay` in that seat's numbering, when the last turn
line is the other seat's `move`) and toasts `hitMsg` on `curtain/reveal`, at the flip when the
curtain is off, and when the curtain is switched off while it is up. Two hits share one toast.

### 4.10 The opponent's turn (online)

`#board.inert`; `#statusText` "Jeff is rolling…" (`toRoll`, their turn) / "Jeff to move · 6-4"
(`moving`) / "Jeff may double" (`toRoll` with their `canDouble`) / "Jeff is answering the double"
(`cubeOffered`, I doubled); their dice in `#dice` with `.theirs`; their moves fly from
`flightsBetween`; `#oppDot` `on` while the channel is open, `off` with "Jeff is reconnecting…"
appended on `guest/lost`/`host/guestGone`; `#waitNote` in the roll slot. A host `toast` frame
("It's not your turn.") shows as a toast. The hit toast fires on the hit player's device from the
opponent's new hit moves (`hitToastsBetween`), never from log text.

### 4.11 The result sheet and the match score

On `phase === 'over'`: `#resultOverlay` opens for both seats (`resultOpen = true`) with §2.4's
game-over copy (`resultText`); `#rsNextBtn` "Next game" (host/local; the guest sees "Waiting for
Ari to start the next game", disabled) → `next/click` → `nextGame`; `#rsPeekBtn` "Look at the
table" → `result/peek` closes the sheet and shows `#resultChipBtn` "Result" in the roll slot (→
`result/open`). When `matchOver`: `#endgameScreen` instead: `#resultTitle` "Ari takes the match
5–2", `#resultSub` "6 games" (the match's own start is not in the state, so no duration),
`#matchScore` one row per game (`scoreHtml`), `#nextGameBtn` "Rematch" (a new match, seats kept),
`#leaveBtn` "Leave" (gin's confirm). `#gameBadge` carries "Game 3 · 2–1 · to 5" throughout.

### 4.12 Drag

`ui/board/dragger.ts` is gin's `hand/dragger.ts` reshaped, typed structurally with `DragDispatch`
(it may not import `ui/state.ts`): press on a `.checker.top` inside a `.can-move` container; past
`DRAG_THRESHOLD` → `checker/dragStart {from}` (the reducer sets `selected = from` so the discs
light) and a `.drag-ghost` clone follows; each move hit-tests the pointer against every
`.target,.target-2` and dispatches `checker/dragOver {over}` when it changes (the disc under the
pointer gets `drop`); release → `checker/dragEnd`: over a target it commits the default chain
(`moveTo` for a tray, the higher-first-die chain otherwise: no tray mid-drag), else the ghost glides
back (`LAND_MS 180`) and `selected` clears. The click a release fires is ignored while `drag !==
null`. The dragger binds to `#board` only.

## 5. The shell

### 5.1 Home, the waiting rooms, sound

Copied from gin's `ui/{state,render,home,local}.ts` minus the scorer and the sandbox, with the same
field, intent and painter names so a shared shell reducer stays a mechanical lift later: `Shell =
{ role, code, myName, matchLength, variant, game, view, oppName, oppConnected, nameTouched,
revealed, homeTab, playMode, p1Name, p2Name, screen, netAttempt, hostStatus, guestStatus,
startGameVisible, handoff, savedName, resume, rulesOpen, cues, submenuOpen, longPressed,
codeDraft, soundFont }`; `SCREENS = ['homeScreen','hostWaitScreen','guestWaitScreen',
'tableScreen','endgameScreen']` with gin's `hidden` + `body.fixed-screen` switching. Home: tabs
Play/Rules/About (`HOME_TABS`, `backgammon_homeTab`), the mode switch (`PLAY_MODES`,
`backgammon_playMode`), name inputs ("Ari", "Jeff", maxlength 20), the match length (1/3/5/7,
default 5) and the ruleset (portes/Western), the room-code form with gin's `beforeinput` guard, the
resume box from `resumeFor(save)`, the rules panel from `ui/rules.ts RULES_ITEMS[variant]` (plain
English, one source for `#rulesList` and `#rulesOverlayList`), an About panel of two short
paragraphs. Waiting rooms: gin's, fed by the sessions' status strings; `#shareCodeBtn` →
`share/click` → `shareText(navigator, { title: 'Sheshbesh', url })` with gin's `INVITE_COPIED_MSG`
fallback; `#startGameBtn` when the guest is connected → `createGame`. Sound: `src/fx.ts` plays the
table's cues (`roll place hit bearOff yourTurn win lose double tap` in `ui/sound.ts`) in the App's
sound font through `web/shared/edge/sound.ts`; `#soundBtn` toggles `backgammon_sound` (and its
`aria-pressed`); `__backgammon.soundFont(name)` picks a font from the console; the wake lock is
held while hosting or in a local game.

### 5.2 Protocol, storage, net; turn authority; the hook

`src/protocol.ts` (pure): `WIRE_TAGS = ['join','action','welcome','lobby','full','toast','state']`;
gin's shapes with `matchLength` and `variant` in place of gin's `target` (`welcome`/`lobby` frames),
`state` frames carrying `viewFor(game, 1)`, `action` frames one per move (`roll` is the guest asking
the host to roll), `toast` frames the engine's `MESSAGES`; one self-recorded JSON golden per frame
under `test/fixtures/backgammon-wire/`; `undefined` never appears on the wire (every optional is
`null`). `src/storage.ts`: keys `backgammonMP_v1 backgammon_name backgammon_p2Name
backgammon_homeTab backgammon_playMode backgammon_sound backgammon_soundFont backgammon_variant
backgammon_matchLength backgammon_curtain`; `Save = LocalSave | HostSave | GuestSave` over
`decodeState`; gin's resume flow. `src/net/{host,guest}.ts` are gin's sessions with
`peerIdFor('backgammon', code)` (`sheshbesh-ABCD`), the protocol imports and `matchLength`/`variant`
in the welcome, every timing and message verbatim, to collapse onto a shared `web/shared/net/`
later; `sessions.test.ts` is gin's shape.

Turn authority is gin's: the host applies `applyAction` for both seats and broadcasts `viewFor(game,
1)` as a `state` frame; a refusal to the guest is a `toast` frame; the guest sends `action` frames;
pass-and-play keeps the `State` in the App with no Peer. `main.ts` boots as gin's: `rng = page.__rng
?? Math.random` before anything draws, the store, the clock, ICE, the wake lock, the audio cues,
the net deps with `closeNet` before every restart and the `netAttempt` ticket, the toast timer,
`bindAll`, then `home/init` and the `?join=` link. The documented hook `window.__backgammon` = `{
get app, dispatch, act(action), render, showScreen, initHome, fx, legal(), view(), setup(state),
soundFont(name), soundFontName() }`; `setup` seats a position for e2e and stories (pass-and-play
only, `sandbox/load`).

### 5.3 Online, hidden then shown

The page PR shipped with the Online mode hidden (a constant in ui/state.ts: `mode/set 'online'`
was accepted but the home painter hid the option, the Online panel and the curtain's handoff
button, and pass-and-play was the default) while the reducer, the sessions, the protocol and the
storage were complete. The online PR removed the constant, made Online the default
(storage.ts `DEFAULT_PLAY_MODE`, as gin's), added the online e2e specs and re-recorded the goldens
with hosting in the driver (§9). A shared shell reducer for both games is the step after (working
first, refactor later).

## 6. Accessibility

| Element | Size at 390x844 | How |
|---|---|---|
| `.point` | 47 x 175px | the whole triangle cell is the target, not the checker; `role="button"`, `tabindex="0"`, painted `aria-label`, `aria-pressed` when selected |
| `.bar` halves | 48 x 117px | a full band third; `aria-label` "Your bar, 1 checker" |
| `.off` trays | 44 x 175px | `--off-h: 44px` |
| `#dice` | 48 x 117px | the band's centre third, `role="button"` "Roll"; each `.die` a 44px hit box round a 40px face |
| `.chip` | ≥ 56 x 48px | intrinsic |
| `#rollBtn` | 54px min-height | gin's `.btn-primary` |
| `#undoBtn`, `#doubleBtn`, `#chipCancelBtn`, `.icon-btn` | 44 x 44px | gin's `.btn-sm` / `.icon-btn` rules |
| overlay buttons, `#curtainBtn` | 54 / 44px | `.btn`, `.btn-sm` |

Target discs (22px) are visual; the tap target is the place. Keyboard: Tab order is the DOM order
(points 1..24, bars, dice, trays, controls); Enter/Space on a focused place dispatches the same
intent as its tap (`keyOf` in the binder); Escape cancels the tray and closes overlays.
`#statusLine` is `aria-live="polite"` and carries the dice in words in `#statusDice.sr-only` ("six
and four"); `#toast` is `role="status"`; `#soundBtn` is a toggle with `aria-pressed`. `placeAria`:
"Your 8-point, 3 checkers, can move", "Point 5, empty, target with the 3" (a doubles pill spoken as
"three 3s"), "Your bar, 1 checker, selected", "Your tray, 3 off, target with the 6". Checkers differ
by shape (the inner ring only on the dark one), targets carry numerals, the selected checker has a
ring and a lift, a hit has the flash and the toast: colour is never the only cue.
`prefers-reduced-motion` per §3.8. Contrast (WCAG, the page measured against the parchment's
rendered mean): `--text` on `--bg` 11.8:1, `--muted` on `--bg` 4.9:1, `--accent` (the title) on
`--bg` 8.2:1; on the panel (§3.11) nacre 9.0–11.9:1 and `--nacre-dim` 5.5–6.9:1 across the
gradient, `--accent` on nacre 9.8:1 (the open tab), `--text` on nacre 14.2:1 (inputs, secondary
buttons), nacre on the primary button 6.3–8.0:1, the gold hairline 4.8:1 on the panel; on the board
the labels 6.5:1 on stone and nacre 4.6:1 on olive, nacre on `--accent` 9.8:1 (the count badge),
nacre on `--nazar` 4.1:1 (the target disc's numeral, as it was with `--bg`: the one pair under
4.5:1, a board token this change leaves alone), the bar ring 6.6:1 on walnut.

## 7. Testability

By id/class (page fake and Playwright): `#point-N .checker` count = the stack; `.checker.ck-light|
ck-dark` the owner; `#point-N[data-own]` the seat mapping (`ownOf(seat, N)` for all 24 after a seat
swap); `#board[data-seat]`; `#point-N .checker.top[data-count="7"]` with exactly five visible
checkers; `.point.can-move` set equals `sourcesOf(view)`; `.point.selected`, `.selected.auto`;
`.point.target[data-die="3"]` and `.target-2[data-die="3+1"]` equal `targetsOf`; `#barBottom
.checker` after a hit; `#offLight .slab` count; `#dice .die.die-3.used`, `.die.dead`,
`.die.picked`; `#moveChips .chip` count and `data-*`; `#rollBtn` visible/hidden per phase;
`#statusText` (pinned strings from `statusText`); `#curtainBtn` text and `data-rolls`;
`#curtainLast`; `#rsTitle`; `#gameBadge`; the toast "Kapará…" after the reveal. Painter tests over
`backgammonPage(markup)` (from `index.html?raw`, gin's `optionsFromMarkup`) assert the keyed
rebuild: two paints with the same board and a changed selection leave the checker elements
identical (`data-key` unchanged) and only toggle classes.

Geometry oracle (`e2e/fixtures/backgammon-geometry.ts`, gin's `expectSameFrame`/`FITS` shape):
`boardGeometry(page)` evaluates `{board, points, bars, trays, dice, chips, buttons}` in document
coordinates and asserts: every point rect inside the board rect; all 24 pairwise disjoint and equal
in size; along the long axis the near points o12..o1 are in increasing coordinate order and the far
points o13..o24 likewise, in two disjoint bands; the bar band separates them; each container's
visible checkers lie inside it and number `min(n, 5)`; `stackExtent(n) <= pointLen`; every visible
`.btn`, `.icon-btn`, `.chip`, `.die`, `.point`, `.bar`, `.off` is ≥ 44px on the short axis at
390x844; the frame boxes (topbar, status, board, controls) are unchanged across `toRoll`,
`moving`, after a move, with the tray open, under the curtain and at `over`; no scroll at 390x844
and 1280x800 (`FITS`); the document scrolls at 375x667 (the fallback).

Pure twin (`ui/board/layout.ts`, table-tested like gin's `rowsOf`): `boardLayout(layout, seat)`
(the grid cell of every area exactly as `theme.css` places it), `rowOrder(layout, seat)` (ids in
visual order per row/column; the oracle's expected order), `pathFor(seat)` (the 24 absolute points
in movement order plus `off`), `stackStep(pointLen, checkerD)`, `visibleOf(count)`. A dist test
(`test/dist/backgammon-grid.test.ts`) parses both `grid-template-areas` strings out of the built
CSS and asserts each area forms exactly one rectangle per template, and that `rowOrder` agrees with
the parsed templates. The reducer tests drive whole games through a tap policy (`playOut`) with a
seeded rng; `state.test.ts` asserts the hit toast comes on the reveal and never at the flip.

## 8. Registration and gates

`web/shared/lib/roomCode.ts` (`Game` += `'backgammon'`, the `sheshbesh-` row), `tools/games.ts`
(`GAMES`, `PAGE_TITLES`, `HOOKS`; `LEGACY_GAMES` stays gin and fidice), the landing card in
`web/index.html`, `eslint.config.js` (the pairwise game zones come from its `GAMES`),
`tsconfig.node.json` (the src tree included, the DOM modules excluded by name, as gin's),
`vitest.config.ts` (coverage rows and thresholds at measured minus 5/5/5/3), the dist guards
(`GAMES`-driven; `dist-parity` splits `GAMES` from `LEGACY_GAMES`; `class-contract` floors are per
game because the board builders make most names by template), `backgammon-grid.test.ts`,
`test/tokens.test.ts`, `playwright.config.ts PAGE_ONLY_SPECS` (`backgammon-local`,
`backgammon-geometry`), `tools/parity/computed-styles.ts` (`SELECTORS.backgammon`,
`driveBackgammon`; the two goldens under `test/fixtures/styles/`), `.github/workflows/nightly.yml`
(`BG_REPLAY_GAMES=1000`). `index.html` and `theme.css` are new files with no legacy twin and stay
Prettier-formatted. Gate for every PR: `npm run typecheck` → `npm run lint` → `npm test --
--coverage` → `npm run build && npm run test:dist` → the goldens `--check`; e2e where the PR names
specs. `main` is unprotected: watch CI, then merge.

## 9. The computed-style driver

`driveBackgammon` (in `tools/parity/computed-styles.ts`) shoots 24 screens per viewport: the three
home tabs; a 3-point portes match with its first turn by hand (the curtain, rolled, a die picked, a
source selected with its targets, a move, the undo, the turn over); the menu, history and rules
sheets; then the seeded policy through the hook (`__backgammon.legal()` → `__backgammon.act(a)`,
in-page so a whole game costs no round trips) stopped at a checker on the bar, a roll with one dead
die and a bear-off; the result sheet, the table behind it, the next game's curtain, the match end;
a Western match to the cube offer and the take; home again. Hosting joins the driver with the
online PR, which re-records the two goldens. The die-chip tray and a tray-target disc are not
reached by this policy (their `.chip*` and `.off.target::after` rules record `null`), nor are the
online-only `.die.theirs` and `.conn-dot.off`, until a story or a `setup` position reaches them.
`outline` is not among the recorded properties, so the cue rings (§3.7) leave the goldens' box-shadow
columns to the checkers' own rings. A second capture agrees with the first byte for byte (`--check`:
0 differences on all six goldens).

## 10. Risks carried

| # | Risk | Mitigation / owner |
|---|---|---|
| 1 | Move generation (R12/R13) with bar entry and bear-off is the main engine risk | The test-position table before any UI; the oracle equality and the hereditary check on every replay step; 1000 nightly games |
| 2 | `View.plays` size on the wire (doubles reach tens of thousands of sequences) | `PLAYS_CAP` 512 + `playsTotal`; the UI never needs the full list (`chainsFrom` is exact from `board` + `movesLeft`); the `state` frame size is measured in `protocol.test.ts` |
| 3 | The phone board is 47px per point at 390x844 with 2px of slack; a safe-area inset or a browser toolbar pushes it into the scroll fallback | §3.10's fallback and the 375x667 e2e assertion; if it bites on real devices, fold the status line into the controls row (+22px) before recording goldens |
| 4 | Chirality (phone home bottom-right, opposite direction to the desktop) is a reading players learn | Decided before the goldens were recorded; the alternative is one grid string and two selectors (§3.3) |
| 5 | A typo in either `grid-template-areas` string collapses the grid silently | `test/dist/backgammon-grid.test.ts` parses both strings and compares them with `rowOrder` |
| 6 | Flyers measure rects across a synchronous repaint; zero rects in the page fake; reduced motion | `fly.ts` no-ops on zero rects; `.flyer { transition-duration: 1ms }` under reduced motion; the fallback timer `FLY_MS + 60` |
| 7 | The last die of a turn cannot be undone (engine auto-end) | The status line says so before the tap; a `confirmTurn` option (`done` action) is a contained `apply.ts` change if the owner wants it later |
| 8 | Combined-move chips send two action frames from the guest; a host refusal of the second leaves the first applied | The `toast` + `state` frames restore the board within one frame; acceptable for v1 |
| 9 | `next` from either seat can race online | The loser's `next` is refused with `GAME_ON` and toasted; acceptable for v1 |
| 10 | Closed game lists: widening `Game` breaks every exhaustive `Record<Game, …>` until every row is filled | `GAMES` vs `LEGACY_GAMES` split in `tools/games.ts` |
| 11 | `class-contract.test.ts` floors and template-built names | `CONTRACT.md`'s backgammon rows before `test:dist`; floors per game |
| 12 | Rolldown may re-split the shared chunk with a third page | `dist-parity` re-checked after the first build |
| 13 | Computed-style goldens recorded on macOS, compared on linux | `FONT_ALIASES`; the page's web fonts (GFS Didot, Cardo) need no alias; `.point` = `#point-1` differs by viewport by design |
| 14 | Smoke fails on any failed request; Google Fonts is stubbed, nothing else is | Fonts only from Google; no images at all |
| 15 | E2E time budget (~3 min) | `backgammon-local`/`-geometry` in `PAGE_ONLY_SPECS`; the online specs short; the relay spec skips without coturn |
| 16 | Online determinism: dice must come from the seeded `Math.random` | R27; `rng = page.__rng ?? Math.random`; never `crypto` |
| 17 | The sessions call `ice.load()` at construction | Tests inject `ice: null`; the sessions are gin's copies |
| 18 | `main.ts` must `closeNet` before every restart and honour the `netAttempt` ticket | Copied mechanisms; `sessions.test.ts` ticket check |
| 19 | BinaryPack: `undefined` → `null`, Map/Set/BigInt throw | Every optional is `null`; `protocol.test.ts` re-encodes |
| 20 | Cultural accuracy and restraint (the owner's "subtle but recognizable") | No symbols on dice, cube, score or headings; three non-English strings only; the About panel's two paragraphs reviewed by the owner |
| 21 | The stories baselines and the nightly replay are gin-specific | The nightly has `BG_REPLAY_GAMES`; stories only with both platforms' baselines |
| 22 | Owner sequencing: working first, refactor later; copies must not drift | The net files are gin's with three edits; the shared shell comes after both games are green |
| 23 | `'opening'` and `#doneBtn` are reserved, never exercised | Pinned as such: `applyAction` in `opening` → `OPENING_PENDING` (test), `#doneBtn` hidden in every painted state (painter test) |
| 24 | Plakoto/fevga are typed but unplayable | `ShippedVariant` and the decoder literals widen when they ship; the pin branches and fevga's `ownOf` rotation are unit-tested |
| 25 | Sequence counts for doubles were disputed between two hand counts | The level-4 board count is pinned first; the sequence count after the engine computes it once |
| 26 | The hit toast and the curtain's hit line both derive from the moves' `hit`, while the log's hit line is text in the mover's numbering | Both read `lastPlay` through `hitsAgainst`; `state.test.ts` and `local.test.ts` pin the reveal-time toast and the incoming player's numbering |
