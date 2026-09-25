# Briscola: the table screen and its shell

The design `web/games/briscola/` is built from, distilled to what a reader of the code needs: the
one DOM that serves both viewports and every seat count, the CSS plan, the interaction model, the
shell config, accessibility, testability, the harness registration and the computed-style driver.
The decisions D1–D24 (player counts, options, the 61-point rule, the card identity, the pack
mechanism, the theme, the names) are the table in `docs/design/briscola.md` §1; the rules the table
plays are `docs/design/briscola-rules.md`; the engine is `src/engine/`; the sounds and the history
panel are `docs/design/briscola-sound-history.md`. Conventions follow backgammon: static ids in
`index.html` (composed from `page.ts` by `tools/shell-markup.ts`), a pure `reduce`/`runEffect`
(`ui/state.ts`), painters over `web/shared/edge/dom.ts`, markup builders tested as strings, keyed
repaints, `body.fixed-screen` with no page scroll at 390 × 844 and 1280 × 800. Seats are `0..n-1`,
the host is seat 0, play runs to the next seat index; every seat is its own side (no teams at four since 2026-09-25). The
code's comments cite this document by section (`design §4.2`) and the rules by rule (`E14`).

Perspective: I sit at the bottom; the other seats are placed by relative index `r = (seat − me + n)
mod n`: r1 (plays after me) at the right, r2 across the top (my partner at four), r3 at the left; at
two players the one opponent sits across the top. Everything a player touches that is not the table
(home, tabs, mode switch, names, code form, waiting rooms, curtain, toast, sound button, endgame) is
the shell's under `web/shared/ui/ids.ts`.

## 1. The one DOM (`#tableScreen`, static ids in `index.html`)

```
┌──────────────────────────────────────────────┐ #app padding 12
│ ☰                          ♣ coppe  🔊 │ .topbar 44: #menuBtn, #trumpBadge, #soundBtn
│              ┌──┐  Bob  ·  3 cards            │ #seats 86 (2 players: r2 across the top)
│              │▒▒│  ▪▪▪ 2 tricks               │   .seat[data-pos=top]: name, tiny backs, taken count
│              └──┘                            │
│  ┌────┐            ┌───┐┌───┐                │ #tableCenter: #stock (mid back) with #briscola rotated
│  │▒▒▒▒│ Stock·32   │ 3 ││ A │                │   90° half under it; #trick: the fan, leader's card
│ ═╪════╪═ ◄ briscola │Bob││You│                │   leftmost, a .who chip beneath each
│  └────┘            └───┘└───┘                │
│  Ann (you) 25 · 2 tricks │ Bob 14 · 2 tricks │ #scoreStrip 44 (.score-cell.mine.leading | .score-cell)
│          Your turn — play a card             │ #statusLine 22
│ ┌──────────────────────────────────────────┐ │ .hand-area (the baize panel)
│ │ Ann                              You: 25 │ │   .hand-header
│ │  ┌────────┐ ┌────────┐ ┌────────┐        │ │   #hand: three .slot, 111 × 214 cards at 390 × 844
│ │  │ 7  ♣   │ │ R  ♠   │ │ 5  ♦   │        │ │   (a lifted card rises 12 px)
│ │  └────────┘ └────────┘ └────────┘        │ │
│ │ [   Play   ]                 [Last trick] │ │   #actions 54
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

The markup ships the two-player shape (`#seatR2` shown, `#seatR1`/`#seatR3` hidden) so the page fake
and the goldens see a whole table before any paint. The topbar is backgammon's on both viewports:
`#menuBtn` (☰) opens `#menuOverlay` with `#menuRulesBtn #menuHistoryBtn #menuLeaveBtn`;
`#rulesBtnGame` and `#historyBtn` are `desk-only` (two badges and four 44 px buttons do not fit
390 px); `#leaveBtn` is on the endgame screen, which is never shown since 2026-09-25 (the menu's
row is the leave a player reaches). The one badge: `#trumpBadge` (`.badge.trump .s-<suit>`, a `<use
href="#suit-<id>">` of the shared suit sprite inlined at `body` afterbegin at boot, `#trumpName`, an
English `aria-label` "Briscola: cups"); the game badge ("Game 1 · 0–0 · best of 3") went with the
match (one game per sitting).

The seats row `#seats[data-players]` is a three-column grid (`left top right`, 86 px at every count,
`1fr 2fr 1fr` from 900 px); `seatCells(n, me)` (pure, `ui/table.ts`) maps the cells to seats: 2 →
`{R2: me+1}`; 3 → `{R1: me+1, R3: me+2}`; 4 → `{R1, R2, R3}`. `paintSeats` sets each cell's
`hidden` and `data-seat`, the name, `.seat-cards` (one `.card.back.tiny` per card held, or tiny faces
under scoperta or the partner peek), `.seat-taken[data-count]` ("2 tricks"), `.to-move`, `.gone`
("(reconnecting…)"), and the connection dot: `#oppDot` in the two-player cell (`SHELL.briscola.connDot`),
`.conn-dot on|off` per seat online, `hidden` in pass and play.

The centre band: `.stock-area` (`position: relative`, `1.05 × mid + h/2` wide so the protruding half
fits) holds `#stock[data-count]` (a `mid` back; `.empty` at one card left, the box itself the dashed
outline; the scoperta top face when the option is on), `#briscola` (a `mid` face absolutely placed
under the stock, `rotate(90deg)`, half covered: the oracle asserts 40–60%; `.gone` keeps its box,
`.tappable` when the exchange is offered) and `#stockCount` ("Stock · 34"). `#trick[data-players]`
is the fan: one `.play[style="--i:n"]` per card played (`role=group`, "3 of cups, played by Bob"),
a `mid` face with `data-seat` (`.taking` on the winner's through the settle beat) and a `.who` chip;
CSS `:has()` counts the children, so no `--n`; `data-lead` carries the leader's cue ("You lead" /
"Bob leads"), which `#trick:empty::before` shows, so the painter leaves an empty trick truly empty.
`#lastTrickBtn` (desk-only) and `#lastTrickSheetBtn` (in `#actions`) both dispatch `lastTrick/open`.

`#scoreStrip[data-mode=players|teams]` holds one `.score-cell` per player (2, 3: `.sc-name`
"Ari (you)", `.sc-points`, `.sc-tricks`) or per team at four ("Ari & Cara", the side's points, the
tricks summed), exactly one `.leading` (a strict leader), `.mine` on my own; on a phone with three
cells `.sc-tricks` hides. `#statusLine` (`aria-live="polite"`) writes `#statusText`. The hand panel:
`#myName`, `#myTaken` ("You: 25"), `#hand.active|inert|hidden-cards` with exactly three `.slot`s
(`.slot.empty` dashed where a card went, so the other two never move; the held slot is the accessible
button: `role="button" tabindex="0" aria-pressed aria-label` "7 of cups, play" / "Re of swords,
lifted"), `#actions` with `#playBtn`, `#waitNote`, `#resultChipBtn` and `#lastTrickSheetBtn`.

Home residue (`page.ts`): `#playersSel` (3 and 4 disabled "online soon", D16) and its twin
`#localPlayersSel` showing `#moreNames` (`#p3NameInput #p4NameInput`); the match select and the
house-rules disclosure went on 2026-09-25 (the owner: "take out the 'match' dropdown" / "get rid of
the option to set house rules entirely"). Sheets: `#lastTrickOverlay` (`#ltTitle #ltCards #ltSub
#closeLastTrickBtn`), `#resultOverlay` (`#rsTitle #rsSub #rsScore #rsReplayBtn` "Play again"
`#rsPeekBtn`), `#menuOverlay` (`#closeMenuBtn`), the shell's rules, history and curtain overlays
(`#curtainHandoffBtn` "Continue online" at two players alone), the endgame the shell requires
(`#endgameScreen h1`, `#leaveBtn`), never shown.

## 2. Keys, highlights and flights

Every container has a `data-key` and rebuilds only when it changes (`web/shared/ui/keyed.ts`
`ensureKeyed`): `#hand` by the three slots' ids with `∅` for an empty slot plus the pack name (and
`|down` under the curtain); `#trick` by `seat:card` pairs plus the pack; `#stock` by count; `#briscola`
by id; each seat cell by its name, counts and cards; `#scoreStrip` by mode, names and numbers; the
history list by the match's `startedAt` and its last event id (a new match's ids start over). The
state classes toggle outside the key (`selected playable arriving taking to-move leading inert gone
empty tappable drop-ready drop`), so a lift never rebuilds the hand and a play changes exactly two
keys (the painter tests assert the card elements stay identical across a changed selection).

The settle beat (§4.2) is a `Beat` the painter derives from `table.settle`: through `hold` and `fly`
the seats, the strip and `#myTaken` read as *before* the trick and the trick stays on the table with
`.taking` on the winner's card; through every stage the stock and the briscola read as before the
draw; my drawn card is `arriving` until its flight lands. Flights (`ui/motion.ts` over the shared
DOM edge, backgammon's `fly.ts` shape): `trickFlights` send the fan to the winner's cell (my own to
`#myTaken`), `drawFlights` a back from `#stock` to each seat in `drew` order, `DRAW_GAP_MS` apart, the
last from `#briscola` turned upright when `trumpTaken`; a clone is fixed at the card's centre box,
`transition-duration`/`-delay` inline so the reducer's timers and the glide agree, `arriving` hides
the destination until the transition ends (a fallback timer removes a stuck clone), `MAX_LIVE_FLYERS`
culls a burst. Durations `HOLD_MS 900 / FLY_MS 320 / DRAW_MS 260 / DRAW_GAP_MS 160`;
`prefers-reduced-motion` makes every flight 1 ms and the hold 300 ms.

## 3. CSS (`theme.css`)

The thirteen shared tokens are redeclared on the café palette (`test/tokens.test.ts` holds it; a
partial override would inherit gin's felt): `--bg #ede3d1` (cream; `--text` 12.8:1, `--muted` 5.2:1,
`--accent` 4.7:1), `--card #f7f1e6`, `--card-2 #e9dfcc`, `--accent #a6442b` (terracotta; 1.3:1 on
the baize, so never ink on the felt), `--accent-dark #7a2f1d` (the curtain wash), `--gold #d6b97f`
(a dune sand; hairlines only), `--text #2b1d14`, `--muted #6b5a4a`, `--danger #b7472a`, `--radius 12px`, `--felt`
(a lagoon-teal radial gradient `#2c6d6b → #235a59 → #194645`; cream 5.3–9.3:1), `--go #a3b070` with
`--go-text #1f2a12` (6.4:1; `.btn-go` carries an olive hairline and the primary's shadow). Game
tokens: `--baize`, `--baize-edge`, `--panel` (espresso), `--cream`, `--cream-dim` (5.1:1 on the
baize), `--terracotta-pale` (the turn mark's fill), `--card-face #fbf6ea`, `--card-edge`, the four
`--suit-C/D/S/B`, `--serif-display 'Bodoni Moda'`, `--serif-text 'Lora'` (both from Google Fonts, the
page's only network requests; the smoke's request check sees only fonts). The shell tokens of
`web/shared/styles/shell.css` (`--font-body --font-display --surface-shell --surface-bar --fill
--fill-hover --ink-on-fill --ink-on-bar --ink-hover --emphasis --shadow-shell --radius-control
--radius-inner --radius-tab`; `docs/design/dry-round-2.md` G1) landed after this theme was cut and
are its open item: the theme must declare every one on the café palette the day the composer links
`shell.css` into the page, or the shell's boxes read gin's fills (`test/tokens.test.ts` pins it).

The card geometry is one pair of variables on `#tableScreen`: `--aspect` (the pack's, written by
`paintPack` from `resolveAspect`; `0.52` off the table) and `--card-w`, `clamp(72px, min((100vw −
56px) / 3, (100dvh − 560px) × aspect), 124px)` on the phone (111 px at 390 × 844) and `clamp(80px,
(100dvh − 522px) × aspect, 132px)` from 900 px; `--mid-w = 0.62 × --card-w` (the fan, the stock, the
briscola), `--tiny-w` 26/30 px (the seats' backs). `.card` is `--card-w` wide and `--card-w /
--aspect` tall, its face the pack's picture as the box's background with the corner indices overlaid
where the pack asks (`indices: 'overlay'`), `.card.back` the pack's back (`--back`, `--back-colour`,
written on `#tableScreen` and on `body` so a flying clone on the body paints the same back); a French
back on the Italian table is painted `cover` (D13). `ui/layout.ts` is the pure twin of the CSS
(`cardWidth`, `midWidth`, `bandHeight`, `columnHeight`, `fits`, the two grid templates, `fanStep`,
`stockAreaWidth`, `coveredFraction`); the row heights are fixed (44 / 86|96 / 44 / 22 / 54) so
nothing above the hand moves when a card is played, a trick resolves or the stock empties.

The fan: `#trick` is a flex row where `.play` carries `--i`; from the second card on each overlaps
the one before by `--fan-overlap × --mid-w` (`#trick[data-players]` sets 0 / .35 / .45: a 28 px
strip cannot hold its chip at .6), `z-index 1+i`, a ±2–6° tilt on the card while the `.who` chips
stay in a straight row under each card's visible strip; `.taking` lifts 6 px with a cream outline;
`#trick:empty::before` writes `data-lead`; `.drop-ready`/`.drop` outline the band for the drag.
Every tap target is ≥ 44 px on the short axis at 390 × 844 (hand cards 111 × 214, `#playBtn` 54 px,
`.btn-sm` and `.icon-btn` 44 px, the trick band as a drop and tap target). Below the floor the
document scrolls (622 px on the phone, 611 px on the desktop; 375 × 667 fits at a 623 px column).
The page is cream with a CSS-only linen weave; the home shell's boxes sit on the espresso panel with
a sand hairline and cream text ("subtle but recognizable": one accent, sand as hairline, the cards
as ornate as their pack).

The Hawaiian shift (the owner, 2026-09-25: "Make the briscola a bit more hawaiian themed. I play
this in Oahu with my friends. Beach, turtles, poke, dolphins. Subtle motifs"; the standing rule from
backgammon: "subtle but recognizable"). Three candidates were built on the tokens alone and read at
390 × 844 and 1280 × 800: (a) the felt as shallow water with a sand hairline and one honu watermark;
(b) a sand page with a deep-ocean panel, a wave line along the trim and a dolphin on the result
sheet; (c) the café palette with poke-coral and seaweed accents and a honu in the empty stock slot.
(b) erased the espresso and read as backgammon's blue with a zigzag edge; (c) read as no change at
all (a coral that keeps 4.5:1 on the cream is terracotta, and the stock empties once a game). (a) is
the theme, the quietest that still says Hawaii at a glance (sand, water, a turtle): `--felt` is a
lagoon teal (`#2c6d6b → #235a59 → #194645`; cream 5.3 / 7.0 / 9.3:1 and cream-dim 4.5:1 at the mid
stop, the numbers the bottle green had), `--baize` / `--baize-edge` `#235a59` / `#163f3e` (the
trim, the fan's chips, the stock's back before the pack paints), `--gold` a dune sand `#d6b97f`
(hairlines only, as before; `--hair` and the panel's field edges follow), and one drawn motif,
`assets/honu.svg` (a line-drawn green sea turtle: an ellipse, a head, four flippers, one column of
scutes; 96 px, 3 px strokes, no colour of its own) as `body::after` at the page's foot, the page's
ink at 10% through a mask, fixed and inert at z-index 0. `#app` takes `position: relative; z-index:
1`, so both fixed marks (the trim, the honu) paint under the column and the honu shows only where
the linen does: below the home panels, beside the laptop's column, never over a control; the phone's
hand felt covers it at the table. Everything else stays the café's: the linen, the espresso, the
terracotta, the cards. Not taken: the wave line and the dolphin (a second and third motif), any
change to the cards. The About copy names Oahu in one sentence.

## 4. The interaction model (`ui/state.ts`, `App = { shell, table }`)

### 4.1 The reducer slice

`Table = { slots: (CardId | null)[3], selected, settle: { stage: 'hold' | 'fly' | 'draw', trick }
| null, drag: { card, over } | null, lastTrickOpen, resultDismissed, historyOpen, curtain: Seat |
null, lastPainted: View | null, cardPack, extraNames: { 2, 3 } }`. `slots` is the hand's kept
picture: `settleSlots(prev, hand)` leaves `null` where a card went and fills the first `null` with a
new card; a deal or a resume fills left to right. `Intent = ShellIntent<Briscola> | TableIntent`:
`act`, `card/tap`, `play/click`, `table/tap`, `card/dragStart|dragOver|dragEnd`, `exchange/click`,
`next/click`, `result/peek|open`, `lastTrick/open|close`, `history/open|close`, `rules/open|close`,
`escape`, `settle/elapsed`, `opts/set`, `pname/typed`, `cardPack/set`, `sandbox/load`. The table's
effects are `writeOpts`, `rememberPName`, `writeCardPack`; the rest are the shell's. Derived reads for
the painters: `resultOpen(app)` (over ∧ settle done ∧ not dismissed), `liveView(app)` (null while a
settle runs: `#hand.inert`, and the hook's `legal()` is empty), `resumeLabel` ("Resume pass & play:
Ann vs Bob"; "Ann, Bob and Cara" at three or more), `handoffLabel`, `seatNames`, `seatPlayers`.

- **Lift then play** (gin's gesture): `card/tap` lifts (`selected`, `fx tap`); a second tap on the
  lifted card, `#playBtn`, or a tap on the table plays; a tap on another card moves the lift; a drag
  from `#hand` onto `#trick` plays on release (the shared pointer-drag kernel, `drop-ready`/`drop`
  on the band). Not my turn or a settle running: `#hand.inert` and the reducer drops the tap; no
  toast (the status line already says whose turn). Commit = `applyAction` locally or on the host,
  or one `action` frame; a refusal returns as a `toast` frame and `cfg.table.refuse` clears the lift.
- **Pass and play**: role `'local'`; the shared `viewer` shows `viewFor(game, turn)`; when `turn`
  moves to another seat the curtain names it (`ui/local.ts`: "Pass the phone to Bob" / "Ann, Cara
  and Dan, look away" / "Ann took the trick · 14 points" or "Ann dealt · the briscola is the sette di
  coppe" / "Show my cards") after the settle finishes; `#hand.hidden-cards` under the wash;
  "Continue online" at two players alone. Three and four seats go through the shared `localSeats`.
- **Online** (two seats in this PR): `#hand.inert` during the other seat's turn; `.conn-dot.on`;
  the host applies both seats' actions and broadcasts one `state` frame; a guest's `next` is refused
  ("Waiting for Ann to deal"); `guest/lost` after a finished match is `hostLeft`, backgammon's.
- **Result, one game per sitting** (2026-09-25): `#resultOverlay` opens at `phase 'over'` for every
  seat, decided or drawn, over the table (the shell's endgame screen is never shown); `#rsReplayBtn`
  "Play again" (`.btn-go`) → `replay/click`: after a draw the engine's `next` (the deal rotates, the
  draw carried), after a decided game `replayGame` (a new match for the same table, the deal passed
  on); a guest's button reads "Waiting for Ann to deal" and is disabled; `#rsPeekBtn` closes the
  sheet and shows `#resultChipBtn`. The status line and the history read the game's result alone,
  never the engine's match clause.
- **Exchange** (flag): `view.canExchange` marks `#briscola.tappable` and the status adds "· you may
  swap your 7 of cups for it"; a tap on it dispatches `exchange/click`.

### 4.2 The settle beat and the cues

`rendered(app, prev)` keys the cue memory on `startedAt:gameNo:lastEventId:trick.length` and plays
only when the key moved (a cold paint primes and plays nothing; a re-sent frame plays nothing): the
card laid (`move.play` / `move.opp`), `phraseOf(event)` for every new event (`web/shared/lib/events.ts`
`newEvents`; the trick-outcome table of docs/design/briscola-sound-history.md §4 in `ui/sound.ts`),
`yourTurn` online. When `trickResolvedBetween(prev, view)` it enters `settle 'hold'` and arms the
`settle` timer; `settle/elapsed` walks hold → fly (the trick to the winner) → draw (a back from the
stock to each seat in `drew` order; `draw.stock`) → null, then re-broadcasts (local) or repaints cold
(online). The status reads "Bob takes the trick · 13 points" through hold and fly, "Drawing…" through
draw. A view that skips a trick (resume, reconnect, a hidden tab, `setup`) paints cold. Online the
beat is paint-driven, so it plays the same on every device from one `state` frame.

## 5. The shell (`src/shellConfig.ts`, completed in `ui/state.ts` as `BRISCOLA: ShellConfig<Briscola>`)

`id 'briscola'`; names default `Ari`; tabs play/rules/about; modes online (default) and local;
copy: "End this game? The score will be cleared." / "Leave this game? The table will close." /
`hostRoomMsg` "Connected — waiting for Ann to deal" (`SHELL.briscola.hostAnswered`); opts:
`DEFAULT_OPTS = normaliseOptions(2, TABLE_TERMS)` (`{ gamesToWin: 1 }`: one game per sitting, the
house rules at the engine's defaults), `parseOpts` off the raw seat count (`players` or its
`localPlayers` twin, falling back to the shell's current count) onto the fixed terms, `pickOpts` off
a frame or a save (the six terms as the wire and the save spell them); engine adapters over the pair
(`create`, `apply`, `viewFor`, `over = matchOver`, `finished`, `names`, `renameGuest`); frames from
`protocol.ts` (the room is the six `GameOptions` after `hostName`; the host save carries the same six
between `myName` and `game`, `briscolaMP_v1`); `home.read` adds the seat count (`briscola_players`;
the match and house-rule keys are retired, never read), the card pack
(`briscola_cardPack`, validated for the Italian deck) and the third and fourth names
(`briscola_p3Name`, `briscola_p4Name`). What the shared shell lacked and gained, with tests
(docs/design/shared-shell.md §4.3.2 gets a point 11): `ShellTypes.Seat` and `SeatOf<G>` (seats
beyond two in `revealed`, `Table.curtain`, `engine.apply/viewFor`, `local.viewer/revealer`),
`localSeats(raws)` beside `localPlayers`, the `briscola` room-code row, `readChecked` in the DOM edge.

## 6. Accessibility

Targets at 390 × 844: hand cards 111 × 214 (the slot is the button: `role="button"`, `tabindex="0"`,
`aria-pressed`, "7 of cups, play" / "Re of swords, lifted"), `#playBtn` 54 px, `.btn-sm` and
`.icon-btn` ≥ 44 px, the trick band ≥ 163 × 190 as a drop and tap target. Keyboard: DOM order;
Enter/Space taps a focused card; Escape drops a lift, closes a sheet, cancels a drag. `#statusLine`
is `aria-live="polite"` and names the taker and points; each fan card has "3 of cups, played by
Bob"; `#trumpBadge` names the suit in English; card labels use the English rank and suit names
("Cavallo of coins" for the knight). Colour is never the only cue: suits differ by shape, the trump
is named, the lifted card has a ring and a lift, the taking card an outline, the leader a word, the
turn a disc and a sentence. `prefers-reduced-motion` per §2.

## 7. Testability

By id and class (the page fake `briscolaPage(markup)` and Playwright): `#hand .slot` = 3 always,
`.slot .card[data-card]` = the cards held, `.slot.empty`, `.card.selected`, `#hand.active|inert|
hidden-cards`; `#trick .card[data-seat]` in `view.trick` order, `.taking`, `#trick[data-lead]`;
`#stock[data-count]`, `#stock.empty`, `#briscola .card[data-card]` / `.gone` / `.tappable`;
`#trumpBadge .s-<suit>`; `#seats[data-players]`, `#seatR1|R2|R3[hidden][data-seat]`, the tiny backs
= `handCount`, `.seat-taken[data-count]`, `.to-move`, `.gone`; `#scoreStrip[data-mode] .score-cell`,
`.leading`, `.mine`; `#statusText`; `#playBtn[disabled]`; `#lastTrickSheetBtn[disabled]`;
`#rsTitle`, `#rsReplayBtn`, `#curtainSub`, `#curtainLast`; `body[data-card-pack]`,
`#tableScreen` style `--aspect`. The hook `window.__briscola` (D19): the shell's members (`app`,
`dispatch`, `render`, `showScreen`, `initHome`, `fx`, `legal()`, `soundFont`, `soundFontName`) and
its own `act(action)`, `view()`, `events()`, `setup(state)` (`sandbox/load`, pass and play only),
`cardPack(name)`, `cardPackName()`.

Pure twins: `ui/layout.ts` against the CSS (`layout.test.ts`, 15 cases); `seatCells` for every
`(n, me)`; `handKey`/`trickKey`/`seatKey`/`stockKey`/`scoreKey`; `trickFlights`/`drawFlights`
(winner first, the briscola last and turned); the copy (`statusText`, `curtainText`, `resultSheetText`,
`scoreCells`, `lastTrickText`) as strings; the reducer through whole games for 2, 3
and 4 seats by a tap policy asserting the settle stages and timers, `settleSlots`, the curtain names,
Play again after a decided game and after a draw, an older save's match running on (`state.test.ts`); the painters over the page fake
asserting the keyed rebuild; the wire goldens under `test/fixtures/briscola-wire/` (self-recorded:
`BRISCOLA_WIRE_RECORD=1 … -u` re-records). Geometry oracle (`e2e/fixtures/briscola.ts`, on
`geometry.ts`): every hand card inside `#hand`, the three slots equal, disjoint and in increasing x;
every unrotated card's `h / w` within 2% of `1 / aspect`; the briscola's box is the stock's swapped
and overlaps it 40–60%; fan cards inside `#trick` in increasing x with rising z; every target ≥ 44 px
on the short axis; the frame boxes unchanged across the deal, a lift, a play, the hold, the settle,
the stock at 0, the result chip, the curtain; no scroll at 390 × 844 and 1280 × 800 for 2, 3 and 4
(`e2e/briscola-geometry.spec.ts`, `e2e/briscola-local.spec.ts`; the shell's half is
`e2e/shell-*.spec.ts`, one describe per shell game). Stories (`?story=<id>`, the `linea` pack) are
the design's §5.6 list and land with their own stage.

## 8. Registration and gates

`Game += 'briscola'` in `web/shared/lib/roomCode.ts` with the `briscola-` row (gin's alphabet, 4
letters); `REGISTRY.briscola` (`title 'Briscola — cards'`, `hook 'window.__briscola'`, `suite
'briscola'`, `specs ['**/briscola-*.spec.ts']`, `storage { saveKey 'briscolaMP_v1', prefix
'briscola_' }`, `pageShape { ids: app homeScreen tableScreen hand trick stock briscola scoreStrip
toast, rulesSlots: true }`, `contractFloors { ts: 40, markup: 40 }`) and `SHELL.briscola` (`heading`
and `shareTitle` "Briscola", tabs Play/Rules/About, modes Online / Pass the phone, `hostAnswered
/^Connected — waiting for .+ to deal$/`, `connDot '#oppDot'`, `localFields [localPlayersSel 2]`,
`curtainButtons 2`) in `tools/games.ts`; `GameSuite`, `ShellGame`, `SHELL_GAMES` (there and in
`web/shared/ui/ids.ts`) gain it; `tools/ci/suites.ts` gives the `briscola` suite its page rows
(protocol, storage, shellConfig, ui, net, fx: backgammon's figures) and `gameE2e('briscola')`, the
shell and online spec rules run `e2e-briscola` too, `test/fixtures/briscola-wire/**` runs `briscola`;
`GameSuite` membership moves its CI job out of `.github/workflows/ci.yml` and into the two game
matrices (`tools/ci/affected.test.ts` pins the lists), and `package.json` gains `test:e2e:briscola`;
`e2e/fixtures/two-players.ts` `DRIVERS`, `e2e/fixtures/online-games.ts` `SHELL_DRIVERS` (`curtainSub`,
`start`, `snapshot`/`agree` on the view's key, `expectOpening`: three cards each, "Stock · 34", the
same briscola, "Game 1 · 0–0 · best of 3"; `hostSave`, `localSave`, `table '#hand .card'`,
`curtainOffer` "Continue online", `glossary`), `e2e/fixtures/site.ts` `PAGE_ONLY_SPECS`;
`tsconfig.node.json` includes `web/games/briscola/src/**/*.ts` (the e2e fixture imports the engine and
`ui/layout.ts`); `test/tokens.test.ts` pins the theme's `:root`; `test/dist/classes.test.ts` `OWNERS`;
`tools/parity/computed-styles.ts` (`SELECTORS.briscola`, `SHELL_DRIVE.briscola`, `driveBriscola`) with
the two goldens `test/fixtures/styles/briscola.{390x844,1280x800}.json`; the landing card in
`web/index.html`; the README's Play row and `package.json`'s description. The nightly's
`BRISCOLA_REPLAY_GAMES=1000` step landed with the engine. Gates: `npm run typecheck`, `npm run lint`,
`npm run test:briscola -- --coverage`, `npm run test:shared`, `npm run test:harness`, `npm run build`,
`npm run test:site`, the goldens `--check`; e2e where the specs name briscola.

## 9. The computed-style driver (`tools/parity/computed-styles.ts` `driveBriscola`)

After the shell's `driveShell` (the home tabs, a room opened and cancelled, pass and play with two
names and the two selects, the start under the curtain), with the pack pinned to `linea` through
the hook first (the drawn deck: the golden records no picture pack's aspect or back, so the deck's
default may change under it): the first trick by hand (my hand; a card lifted; a card played and
the curtain for the other seat; the second seat's play; the trick taken, the settle beat waited out;
the table after it), the menu, history, rules and last-trick sheets, then the seeded policy through
the hook (`legal()` -> `act(a)`, the loop walking the settle beat with `settle/elapsed` where
`legal()` is empty) to the game's end (the result sheet, the table behind it) and Play again's
curtain over the new deal; last a three-seat and a
four-seat table dealt, for the seats row, the fan and the score strip in their other two shapes.
Recorded at 390 × 844 and 1280 × 800; `--game briscola` records the two alone.
