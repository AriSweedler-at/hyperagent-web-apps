# Gin Rummy after the ghost slot: undo from the discard pile only, a hand that keeps its
# picture, melds that never split a row, layoffs pinned and fixed, the discarded-cards sheet

Base: main at d078a70 (PRs #20-#23 = parts A-C of docs/design/gin-draw-ghost-slot.md; the
`wt-ghost-c` worktree is gone, every claim below was re-checked against main on 2026-09-21).
Design #1 (the judges' winner) grafted with the judges' best ideas from the others that do not
fight it: accept moves nothing (the new card stays in the ghost's own cell), a dense grid with one
`.group` per meld, `refuse` narrowed to a `waiting` stage, one `expectHandRows` fixture, within-turn
frame comparison, the result sheet from both seats. Dropped from #1 on the judges' flaws:
insert-on-accept, the badge copy change, the `stale` glow, blocking the chooser while shown,
`#tableScreen { overflow: hidden auto }`. Paths are relative to `web/games/gin-rummy/` unless they
start with `e2e/`, `test/`, `tools/`, `docs/` or `web/shared/`.

## 1. Goal (the owner's words, 2026-09-21)

1. "include tests to ensure that the discard flow is as desired. Also include flows to ensure that
   the 'order hands by different ways' feature works"
2. "After you draw the card, you cannot undo it. You can undo taking the top card of the deck, but
   you can't undo the drawing of a card."
3. "selecting a card to discard and then clicking other stuff - that won't rearrange your hand
   (although you can click a button to rearrange your hand). Rearrange your hand automatically at
   the start of the turn"
4. "When you have a meld, it should NEVER go over a line break. Prefer to add an additional line
   instead"
5. "ensure that we are able to lay off when people knock."
6. "add a button to the side of the discard pile that lets you look at the discarded cards. And you
   can toggle on & off if you include your cards in it. It should be a modal that looks kinda like
   how balatro does it - where there are all 52 cards laid out in 4 rows (1 per suit) and the cards
   that have been discarded are greyed out. Make it look stylish but cohesive with the rest of the
   game. Keep it simple. Checkbox to include 'cards in your hand'"

Standing rules: no card moves unless the player acts; a story and a flow at 390x844 and 1280x800
per new state; every PR names the goldens it flips; strict TS, functional, small. Request 7: later.

## 2. Owner-visible choices (what the owner did not literally say)

- Undo is a RULE. "Taking the top card of the deck" is read as the discard pile's top card: undo is
  allowed after `takeUpcard` and `drawDiscard` (public information) and refused after `drawStock`
  (the ghost cell already showed the card; undoing it would be a free peek). The ↩ button simply
  does not appear after a stock draw. If the owner meant the opposite: two conditions flip.
- Accepting the drawn card leaves it exactly where the ghost cell was, as a loose card; the header
  readout still shows the engine's true deadwood. `Arrange` (hand header, enabled only when the
  engine's arrangement differs from the picture) re-melds; so does a pick in the meld chooser.
- The picture is the engine's whenever I am choosing what to draw (my `upcard`/`draw` phase): that
  is "rearrange automatically at the start of the turn". A discard removes its card in place; a
  meld it breaks paints as loose cards in place until Arrange or the next turn.
- A phone hand is two rows, or three when the melds cannot share two rows of six (`{4,4,3}`); it
  grows upward, nothing above it moves; under 736px tall the page scrolls (the 661px fallback).
- Layoff stays automatic. One case where the automatic result is worse for the defender (a card
  fitting both a knocker's set and run) is fixed in the engine, per the task's condition.
- The discards sheet shows the pile plus, on request, my hand; cards the opponent took from the
  pile are not tracked (a noted idea). The 🔍 button is disabled when the host predates the field.
- The wire gains one optional trailing key and no version field: an additive key whose presence
  is the capability (docs/ARCHITECTURE.md's convention line gains a sentence saying when each
  applies). The badge stays `⇄ N ways`; the rules copy is unchanged (both pinned by goldens).

## 3. Non-goals

- No engine change beyond two rules (undo, the layoff branch) and one public fact in the view
  (`discardIds`); `State`, saves and the legacy wire corpus stay byte-identical. No manual layoff,
  no deal-order hand, no per-row card shrinking, no card-face modal. No new dependency, no new
  dist page; `defaultHandView` stays until PR D; `draw.ts`/`picture.ts` merge in the later pass.

## 4. Undo rule

ENGINE. `src/engine/game.ts` `undoDraw` (290-310): after the `!pd` check, `if (pd.from ===
'stock') return err(STOCK_DRAW_FINAL_MSG)` with `export const STOCK_DRAW_FINAL_MSG = "You can't
undo a draw from the stock."` (new: no legacy golden pins it). `drawn()` still records
`pendingDraw` for stock draws, so `State` is byte-identical. `src/engine/view.ts:119`: `canUndo:
state.phase === 'discard' && state.turn === seat && state.pendingDraw?.from === 'discard'`;
`legalActions` (game.ts:481) follows it. The `ready` refusal text stays (gin.legacy.test.ts:256).

UI. `src/ui/hand/draw.ts` `settleDraw:38` stops keying on `canUndo`: `const drawnId = v.isMyTurn
&& v.phase === 'discard' ? v.lastDrawnId : null` (`lastDrawnId` is mine, in hand, cleared by undo
and deal; without this the stock-drawn ghost card never shows). `src/ui/state.ts` `refuse:378`
clears only a `waiting` stage: `step(app.draw?.kind === 'waiting' ? { ...app, draw: null } : app,
toast(message))`, so a refused move while `shown` (only `__gin.act` can send one) never collapses
the ghost card. `actionsHtml` (render.ts:197) already keys on `canUndo`. Catalogue: `actionsOf:268`
→ `pendingDraw?.from === 'discard'`; `undone = play(drewDiscard, 0, undoDraw)` (a stock undo would
throw in `play`); `undo-back-to-draw` retitled, `sameHandAs: 'draw-mine-open'` still true;
`accepted-gin` keeps `from: 'stock'` and loses ↩.

TESTS THAT FLIP. `test/parity/gin.legacy.test.ts` 234-244: the undo block becomes two
`test.runIf(leg === ...)` tests (the 708/740 precedent): legacy as today; current asserts `canUndo`
false after the stock draw, `errorOf(undoDraw) === STOCK_DRAW_FINAL_MSG`, hand 11 / stock 30, no
`undoDraw` in `legalActions`; the upcard test (276) adds `errorOf(s, 0, undoDraw) === 'ok'` after
the `drawDiscard` at 268 on the current leg. `test/parity/gin.replay.ts` `compareSeat` 67-78: when
`L.pendingDraw?.from === 'stock'` compare `masked({ ...vL, canUndo: false })` and `aL` without
`undoDraw`, tallied like `legacyLeaks` (run one `gin.replay.N.test.ts` at a time).
`src/engine/decode.test.ts:53-59`: the undone fixture comes from a `takeUpcard` position.
`src/ui/state.test.ts` 902-914: the stock leg becomes "no ↩; `action/click undoDraw` toasts with
the stage kept", the undo-through-act assertions move to `discard/tap` on `local(openDraw)`;
1024-1027 uses a discard-pile draw. `src/ui/hand/draw.test.ts` 69-96: "no undo clears" becomes
"shown even with canUndo false". `src/ui/render.test.ts` 255-257: the `drawn` fixture loses ↩ in
the exact `#actions` string; a `taken` fixture pins the ↩-first string. `e2e/gin-draw.spec.ts`
102 → `toHaveCount(0)` for ↩ while shown and after accept, the undo leg 117-123 leaves the stock
test; the upcard test 143-155 keeps its undo. Wire corpus (`gin-wire.test.ts:63`): unchanged.

## 5. Arrangement model

MODULE `src/ui/hand/picture.ts` (pure; imported by state.ts, SlotHandView.ts, render.ts,
catalogue.ts):

```ts
/** The hand as the cells show it: groups in order, then loose cards. */
export type Picture = Readonly<{ groups: ReadonlyArray<Cards>; loose: Cards }>;
export const cardsOf = (p: Picture): Cards => [...p.groups.flat(), ...p.loose];
/** The cards the ten slots hold: the ghost card is not on the table while `shown`. */
export const onTable = (v: View, stage: DrawStage | null): Cards;
/** The engine's melding restricted to the on-table cards (a group under three goes loose). */
export const engineOf = (v: View, stage: DrawStage | null): Picture;
export const samePicture = (a: Picture, b: Picture): boolean; // group-by-group id sequences
export const settlePicture = (prev: Picture | null, v: View, stage: DrawStage | null): Picture;
/** Cells per row under dense placement (§6); `spans` in DOM order, the ghost included. */
export const rowsOf = (spans: ReadonlyArray<number>, cols: number): ReadonlyArray<number>;
```

`settlePicture`, rules in order: (a) `prev === null`, or my `upcard`/`draw` phase → `engineOf`
(the turn-start arrangement; deterministic, so a guest's `waiting` re-render, an undo and a resume
land on the same picture); (b) `onTable` ids equal `cardsOf(prev)` ids → `prev` (select,
re-render, the opponent's moves, a draw while the ghost holds the card, the chooser opening); (c)
one card added → `{ ...prev, loose: [...prev.loose, card] }` (accept: the last item takes the
ghost's hole, §6); (d) one card gone → it leaves its group or the loose cards in place, nothing
else moves (discard, knock; a group left under three paints loose); (e) anything else (a deal, a
resume, a pass-and-play seat switch) → `engineOf`.

STATE. `DrawStage` loses `hold` (`waiting{from}` | `shown{from, cardId}`; `HandHold`/`holdOf`
go). `App.picture: Picture | null` (null initially and beside every `draw: null` reset; not saved,
not on the wire). `rendered` (404-415) settles `draw` then `picture`; every view funnels here.

ACCEPT. `card/tap` while shown is unchanged (941-942: `draw: null` [+ `selectedCard`]); rule (c)
appends the card. Accept-on-select stays (a tap on a held card is an action); with append instead
of a re-meld it no longer looks like a rearrangement, which was the owner's complaint in item 3.

ARRANGE. index.html:200 → `<div class="hand-header"><span id="myName">You</span><button
class="arrange-btn" id="arrangeBtn" title="Arrange your hand by melds">Arrange</button><span
class="dw" id="deadwoodInfo">Deadwood: —</span></div>`. theme.css `.arrange-btn`: a 20px pill
(`border-radius: 999px; padding: 0 9px; font-size: 0.72rem; font-weight: 700; line-height: 18px;
margin: 0 8px; flex-shrink: 0; position: relative`, the `.btn-ghost` border and background), a
`::after` with `inset: -12px -6px` (a 44px hit area inside the fixed 24px header), `:disabled {
opacity: 0.35 }`. Intent `hand/arrange`: not in play → `pure(app)`; else `then(step({ ...app,
picture: engineOf(view, draw) }, fx tap), rendered)`; allowed on the opponent's turn (UI only) and
while `shown`. `paintHand`: `setDisabled(arrangeBtn, !inPlay || samePicture(picture, engineOf(v,
app.draw)))` and `setAttr(hand, 'data-rows', rows)`. No glow: the enabled state is the cue.

CHOOSER. `meld/open` unchanged (allowed while shown; state.test:899 keeps its pin). `meld/choose`
(975-983): `act({ ...app, meldChooser: false, picture: null }, setMelds)` → `rendered` → rule (a).

ROLES AND VIEW. Host and local settle in one dispatch; the guest through the `state` frame; the
opponent never receives the picture. Pass-and-play: `localBroadcast` switches the view's seat,
rule (e) then (a) gives the mover the engine's picture under the curtain. Resume and a reload
mid-turn: `picture` null → the engine's at the first paint (the ghost's documented degradation).
`HandView.render(model, selection, stage?, picture?)` (`defaultHandView` ignores both; PR D makes
them required); `slotHandView` paints `picture ?? engineOf(model, stage)`. Catalogue: `Spec.
picture?`, `heldCards` reads `app.picture ?? engineOf(view, draw)`, `shownFrom` returns both.

## 5b. Hand-made melds and sort modes (the owner's additions, 2026-09-21)

The owner, mid-implementation: "fix the 'rearrange hands' mechanism. There are bugs in it. And it
should also have a feature where you can choose to sort hand by number or by suit or you should be
able to manually select or deselect a meld (but still auto add the melds with the unselected
cards). You basically can long press a card and be like 'make a meld with this' (if you can) and it
will basically do that if you can make a meld with it and the non-meld-marked cards (unless the
meld-marked cards add the existing card to meld). its the difference between CPU made melds and
human made melds".

THE BUG. The chooser's pick is `State.meldPref`, and `viewFor` (and `knock`) honour it only while
`meldingFromGroups(hand, pref)` fits and scores exactly the solver's best. The next draw adds a
card the solver melds better, the next discard removes one of the declared cards: either way the
pref is dropped and the hand snaps back to the solver's arrangement one move after the pick. The
engine stays as it is (the legacy behaves the same; parity legs compare views); the fix is in the
UI model: a pick becomes hand-made melds, which the arrangement below honours for the rest of the
hand.

MODULE `src/ui/hand/arrange.ts` (pure):

- `SortMode = 'suit' | 'rank' | 'manual'` (src/sort.ts; storage.ts key `ginRummy_sort`, default
  `suit`; §5c replaced the original `melds | rank | suit`): `sorted(picture, mode, prev)` orders the
  loose cards alone, by suit (SUITS order then rank), by rank (then suit), or as `prev`, the picture
  on screen, had them (`manual`). The groups stay as they come, hand-made first then the solver's.
- `HumanMelds = { hand: number; groups: string[][] }` on `App.human` (not saved, not on the wire):
  the melds the player made by hand in hand number `hand`. `standing(human, hand, held)` keeps the
  cards still held in each group and drops a group that is no longer a meld (a discarded card out
  of a hand-made set of three dissolves it; a run of four loses its end and stands as three).
- `arrangedOf(view, stage, human, sort)`: the arrangement the player asked for over the on-table
  cards: the standing hand-made melds first, then `bestMelding` of the other cards (the engine's
  own melding, honouring the chooser, when nothing is hand-made), in `sort` order. `Picture.human`
  carries the ids in hand-made groups; the slot view marks them `.slot.human` (a gold bar above).
- `toggleMeld(human, hand, held, cardId)`: the long press. In a hand-made meld: that meld
  dissolves. Else a hand-made meld it extends takes it (a fourth to a set, an end to a run). Else,
  among `allMelds` of the cards no hand-made meld holds that contain the card, the one that leaves
  the least deadwood (`bestMelding` of the rest; the solver's order breaks ties) becomes hand-made.
  Null when the card joins no meld: the toast `NO_MELD_MSG`.
- `declarable(hand, picture)`: the groups to send as `setMelds` when they score as well as the
  solver (the engine refuses worse ones, and the knock counts the best anyway), else null.

STATE. `settlePicture(prev, view, stage, fresh)` takes the arrangement as a thunk: rules (a) and
(e) call `arrangedOf(view, draw, human, sort)`. Intents: `arrange/open` (`#arrangeBtn`, in play, no
stage) and `arrange/close` for `#arrangeOverlay`; `hand/arrange {mode}` remembers the mode
(`writeSort`), closes the sheet and re-arranges at once; `card/press {cardId}` arms the `cardPress`
timer (`LONG_PRESS_MS`) and `card/release` cancels it; `hand/mark {cardId}` (the timer) toggles the
meld, re-arranges, and declares the groups to the engine through `act(setMelds)` when
`declarable`. main.ts (and the `&live` boot) repaint only when the App changed: `card/press` returns
the App as is, so the pressed element survives to receive its click, while the repaint after
`hand/mark` replaces it, so the click that ends a long press reaches no card and selects nothing.
`meld/choose` sets `human` to the option's melds. The Arrange button is enabled in play without a
stage and carries `.due` while the picture differs from `arrangedOf` (the cue that a re-arrange
would move cards).

SHEET. `#arrangeOverlay`: title, the hint "Melds stay together. Long-press a card to make a meld
with it by hand, and again to break it.", `#arrangeModes` with three `.btn` (`data-sort`, the
current one `.active`), Close. Choosing a mode arranges now and closes.

FACTS AND STORIES. `StoryFacts` gains `human` (the `.slot.human .card` ids), `rows`
(`#hand[data-rows]`), `arrange: 'off' | 'idle' | 'due'`, `sort` (the active mode button) and
`sheet: 'arrangeOverlay'`. Stories: `human-meld`, `sorted-by-rank`, `sorted-by-suit`,
`arrange-sheet-open`, `accepted-two-ways` and `meld-chooser-open` (the two-ways deal is the first
seed from SEED whose accepted first draw melds two ways: `TWO_WAYS_SEED`; it carries every story
that needs a meld, since seed 12's accepted hand melds nothing). Flows: e2e/gin-arrange.spec.ts
over `?story=<id>&live` (the chooser pick, the sort modes, the long press and the toast).

## 5c. Deadwood only (the owner, 2026-09-22)

"I don't wanna arrange by melds ever. you arrange deadwood only, and melds sit off to the side. So
you can arrange by: suit, rank, manually (where you have to click and drag cards around)."

- The melds are not arranged: they sit first in every mode, hand-made ones leading, then the
  solver's in its order. Only the loose cards sort. `melds` (the solver's order for everything)
  is retired; a stored `melds` decodes as nothing and the default, `suit`, applies.
- `manual`: the loose cards stay as the picture on screen has them. `arrangedOf` takes `prev`,
  the current picture, and `sorted(…, 'manual', prev)` orders the loose cards by their place in
  `prev` (its loose cards first, then the cards a group of `prev` let go, then cards new to the
  table, each run in the solver's order). Every caller passes `App.picture`: the turn-start
  arrangement (`settlePicture` rule a), the Arrange sheet, a long press, the `due` check. So
  under `manual` the sheet re-melds without moving a loose card, and Arrange is `due` only when a
  meld formed or broke.
- Choosing `manual` in the sheet freezes the order as it is. The drag that moves a card (PR D2)
  switches the mode to `manual` and writes it.
- Stories: `sorted-by-suit` is retired (it is the default now); `manual-order` (the accepted
  hand's engine arrangement with its loose cards reversed by hand, `sort: manual`, Arrange idle)
  takes its place. `sorted-by-rank` and `arrange-sheet-open` stand, re-recorded.

## 5d. Drag and drop, with motion (the owner, 2026-09-22)

"When you click and drag cards around, they should have a little bit of momentum, and be angled as
they have speed. So like you can pull it left quickly and it will tilt to the left a bit. And the
cards shouldn't immediately snap around, but they should move via transitions."

- `ui/hand/drag.ts` (pure): `DRAG_THRESHOLD` 8px turns a press into a drag; `follow(motion,
  target)` moves the ghost `FOLLOW` (0.35) of the gap each frame, its speed the step; `tiltOf(vx)`
  is `TILT_PER_PX` (1.2°) per pixel of horizontal speed per frame, capped at `MAX_TILT` (14°), so
  a fast pull left leans the card left and it straightens as it catches up; `ghostTransform`; and
  `dropIndex(pointer, cells, current)`, the loose index the pointer would drop the card at (the
  other loose cells that precede it in reading order, row by row, left to right).
- `ui/hand/dragger.ts` (DOM, through the edge): pointer events on `#hand`. A press on a loose card
  (never a meld's) opens a session; past the threshold the drag begins: `card/release` (the long
  press is off), `card/dragStart` (the paint empties the cell: `slot dead dragging`), a clone of
  the card fixed over it as `.drag-ghost`, the pointer captured, a frame loop applying the motion.
  Each move dispatches `card/dragOver {index}` when `dropIndex` changed; on release the ghost
  glides (`landing`, 180ms) to the card's cell and `card/dragEnd` shows the card again. A press
  that never moves is a tap or a long press as before.
- `ui/hand/flip.ts`: every hand repaint records the cards' rects, repaints, and glides each card
  that changed cells from its old rect (an inverted transform, laid out, then released under a
  200ms transition). So a sort, a chooser pick, a long press and the cards a drag passes all move
  by transition.
- Reducer: `App.drag = { cardId } | null` (session only, cleared with the hand). `card/dragStart`
  needs play, no drawn card waiting and a loose card; `card/dragOver` is `moveLoose(picture,
  cardId, index)` and, the first time a card moves, `sort: 'manual'` with `writeSort`; a tap is
  ignored while a drag stands (the release fires a click). `card/dragEnd` clears it.
- Oracles: `drag.test.ts` (the threshold, the motion, the tilt, the transform, the drop index),
  `picture.test.ts` (`moveLoose`), `state.test.ts` (the three intents and the ignored tap), and
  e2e/gin-arrange.spec.ts (a drag over the live story: the ghost leans left on a fast pull left,
  the cell empties, the card lands first, Manual is active; both viewports).

## 6. Hand layout

DOM (`SlotHandView.render`): each group is one grid item; loose cards and the ghost are bare cells:

```html
<div class="group n3"><div class="slot m0 head">…</div><div class="slot m0">…</div><div class="slot
  m0 tail">…</div></div><div class="group n2"><div class="slot dead">…</div><div class="slot dead">…
  </div></div><div class="slot dead">…</div> … <div class="slot ghost open"></div>
```

(the `n2` group is a meld a discard broke: in place, its slots `dead`.) A group's slot class is
`m${i % 5}` when `isValidMeldGroup(group)` (engine/melds.ts), else `dead`; `nK` is its length
(template `n${len}`: one CONTRACT.md row like `m0 m1 m2 m3 m4`). Slots keep every class and rule
they have; the `.slot.ghost*` goldens are untouched. The ghost is always the last item.

CSS (theme.css, replacing line 116 and adding rules):

```css
/* A meld is one grid item spanning its length; dense flow lets a later loose card or the ghost
   fill a hole an earlier meld left, so two rows suffice unless the melds cannot share two. */
.hand { display: grid; grid-template-columns: repeat(6, calc(var(--card-w) + 6px));
        grid-auto-rows: calc(var(--card-w) * 1.44 + 9px); grid-auto-flow: row dense; gap: 8px 0;
        justify-content: center; padding: 14px 0 2px; overflow: visible; }
.group { display: flex; }  .group.n1 { grid-column: span 1; }  /* … .group.n11 { span 11 } */
.slot { /* as today, plus */ width: calc(var(--card-w) + 6px); }
@media (max-width: 899px) {  /* a run of seven or more wraps inside its own two-row cell */
  .group.n7, .group.n8, .group.n9, .group.n10, .group.n11 {
    grid-column: span 6; grid-row: span 2; flex-wrap: wrap; }
}
@media (min-width: 900px) { .hand { grid-template-columns: repeat(11, calc(var(--card-w) + 6px)); }}
/* A third row on a phone whose height only fits two scrolls the page to the actions row. */
@media (max-height: 736px) and (max-width: 899px) { body.fixed-screen:has(#hand[data-rows="3"]),
  body.fixed-screen:has(#hand[data-rows="3"]) #app { height: auto; max-height: none;
  overflow: visible; } /* + the 661px block's other rules */ }
```

Explicit `nK` classes instead of `span min(var(--n), 6)` (`span` takes an integer; the `min()` form
is not guaranteed in CI's Chromium). 736 = 661 + one row at the 40px floor (74.6px).

ROW RULES (the `rowsOf` oracle mirrors the browser): items in DOM order; each takes the first
(row, column), scanning rows top-down and columns left-right, where its span fits inside one row
(a 7+ group on the phone takes six columns of two rows); loose cards and the ghost fill the first
free cell. Desktop (11 columns): one row always. Phone: `{4,3}` + 3 loose + ghost → `[6,5]`
(`[4 d d] [3 d ghost]`); `{3,3,3}` + 1 + ghost → `[6,5]`; `{5,5}` + ghost → `[6,5]`; `{4,4,3}` +
ghost → `[5,4,3]`. `data-rows` is the oracle's answer; the e2e compares it to the browser's tops.

WHAT MAY CHANGE SIZE AND WHEN. The `#hand` height is rows × row height, and rows change only when
the picture changes: my turn start, Arrange, a chooser pick, a discard or knock. Never on a draw
(rule b), an accept (the last item fills the ghost's hole: same cell count), a select, an undo, a
pile tap, an overlay. `.hand-area { margin-top: auto }` bottom-anchors the hand, so a third row
pushes the piles and banner up by 91.4px: 784 ≤ 816 at 390x844, 709 > 639 at 375x667 (`:has`).

GEOMETRY SPEC. One fixture `expectHandRows(page, columns)` in `e2e/fixtures/gin.ts` replaces
gin-stories.spec 98-105, gin-draw's `expectLayout`/`SLOT_ROWS` and gin-geometry's row check:
eleven `.slot` cells of one size; every `.group`'s slots share one top (request 4 verbatim); no
row holds more than `columns` cells; desktop: one row; phone: distinct tops === `#hand[data-rows]`
∈ {2, 3}; `#app`/`#hand` do not scroll unless `data-rows` is 3 under 736px (then the document may,
and the actions row's bottom ≤ `scrollHeight`). gin-geometry's `expectSameFrame` narrows to WITHIN
A TURN (the `draw` frame vs `shown`, `accepted`, `selected`, deselected, chooser open/closed; the
other checkpoints assert geometry only); the topbar, opp-strip, piles, banner, last-action and
actions row keep the all-phase comparison. `sameHandAs` pairs still hold.

## 7. Layoff

VERIFIED against `src/engine/layoff.ts`: the engine lays off automatically at knock resolution
(`game.ts:358 bestMeldingWithLayoffs(oppHand, mine.melds)`), never against gin; both seats receive
`result.opponent.laidOff` (view.ts:112) and the sheet prints `Laid off onto X's melds` with the
cards (render.ts:251-254). `bestMeldingWithLayoffs` takes the minimum deadwood over every subset
of the greedy set L, so no manual choice beats it EXCEPT where L itself is wrong: `layOff` (28-38)
attaches a card to the FIRST meld it fits (`findIndex`), so a card fitting a set and a run goes to
the set and the run's continuation is lost; every enumerated subset is a subset of that L.
Concrete: knocker `[7♠7♥7♦] [4♣5♣6♣]` (sets before runs, melds.ts:55), defender holds 7♣ 8♣: greedy
lays 7♣ on the set and 8♣ stays (8 points); optimal lays 7♣ then 8♣ on the run (0). Two judges ran
the engine on such a hand (31 vs 23 deadwood). The legacy engine shares the defect (gin.melds.test
pins both legs equal). The comment at 50-55 ("L is unique") is false and goes.

FIX (a rule change, per-leg split as PR #16): `layOff` becomes `layoffLeaves(p)`: for the first
remaining card that fits any meld, branch on every meld it fits (usually one), recurse, return
the leaves; `maximalLayoff` returns the leaf laying off the most cards (ties: first, so single-fit
hands are byte-identical to today); `bestMeldingWithLayoffs` enumerates subsets of the UNION of
the leaves' laid-off cards, feasibility = some leaf lays off all of S. No View/State/wire change.
Tests: `gin.legacy.test.ts` new position (the 7♣ 8♣ case), `runIf('current')` expecting `laidOff
[['7C', run], ['8C', run]]`, `runIf('legacy')` pinning the KNOWN DEFECT; `gin.melds.test.ts:61-70`
keeps exact equality unless a card of the hand fits two knocker melds (`multiFit(hand, melds)`),
then asserts `current.value <= legacy.value`; `gin.replay.ts`: at a `knock` whose defender hand is
`multiFit`, assert the same inequality and end that seed (the totals diverge afterwards), tallied
like `legacyLeaks`; `src/engine/layoff.test.ts` (new): `fitsOnto`, the branch position, a chain.

VISIBLE. The sheet's markup is unchanged (gin-dom-parity compares `roundResultOverlay` to the
legacy sheet). Pinned instead: (a) `render.test.ts`: the chain position from gin.legacy.test.ts
438-459 (Alice AS 2S 3S 4H 5H 6H 7D 8D 9D 2C KC, Bob 4S 5S 10H JH QH 7C 8C 9C QD KD, upcard 7C,
knock KC) as a `State` built like `ginState`; for both seats' views `#rrBody` contains `<div
class="rr-label">Laid off onto Alice's melds</div><div class="meld-group laid">` + the mini 4S and
5S exactly, and the defender's `Deadwood · 20` with QD KD; (b) stories `round-over-laid-off`
(Alice's seat) and `round-over-laid-off-defender` (Bob's), sheet open; (c) gin-local.spec: at
every round over, `.meld-group.laid .card` count equals `result.opponent.laidOff.length` (via
`__gin`), and the `Laid off onto` label exists iff it is positive.

## 8. Discards modal

BUTTON. index.html `.table-center` (188-191) gains a third child after the piles: `<button
class="pile-peek" id="discardsBtn" title="Discarded cards" aria-label="Discarded cards">🔍
</button>`, absolutely positioned so both piles keep today's centred boxes (the geometry frame and
dom-parity are unaffected); outside `#discardPile` and no `.card`, so the fixtures are untouched.
CSS:
`.table-center { position: relative; } .pile-peek { position: absolute; top: 50%; transform:
translateY(-50%); left: calc(50% + 13px + max(var(--pile-w) + 24px, 92px) + 6px); width: 36px;
height: 36px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.15); background:
var(--card-2); color: var(--text); font-size: 1rem; }`, `:disabled { opacity: 0.4 }`, from 900px
`left: calc(50% + 20px + max(var(--pile-w) + 24px, 92px) + 8px)` (13/20 = half the pile gap;
`max(...)` is `.pile`'s whole `min-width`; the first cut used half of it and the button sat on the
discard pile's card, caught by the live check after #29). Phone: 300-336 of 346 at the 84px pile.
Disabled without `discardIds`.

STATE. `App.discardsOpen`, `App.discardsWithHand` (false; session-only, not saved). Intents
`discards/open` (fx tap), `discards/close`, `discards/toggleHand`: one-line cases like `rules/open`.

VIEW + PROTOCOL. `view.ts` appends `discardIds: state.discard.map((c) => c.id)` after `knockLimit`;
`types.ts View` gains `discardIds?: ReadonlyArray<string>`; `decode.ts decodeView` (179-216)
appends `discardIds: optional(arrayOf(string))` last; `test/parity/gin.api.ts GinView` gains
`discardIds?: string[]`. Compatibility, verified against `web/shared/lib/json.ts object()` (an
absent optional key stays absent): every corpus and legacy frame decodes and re-encodes byte for
byte (`gin.codecs.test.ts roundTrips`, the gin.protocol rebuild); a new frame round-trips because
the key is emitted and decoded last. `gin.replay.ts compareSeat` strips it from `masked(vC)`. No
version field (§2). Ids only (~4 bytes per discard). `Save` already holds `State.discard`.

DOM (index.html, sibling of `#app`, after `#historyOverlay`):

```html
<div id="discardsOverlay" class="overlay hidden"><div class="sheet">
  <div style="text-align:center; font-size:2rem;">🔍</div><div class="sheet-title">Discarded cards
  </div><div class="sheet-sub" id="discardsSub"></div><div class="dc-grid" id="discardsGrid"></div>
  <label class="dc-toggle"><input type="checkbox" id="discardsHandToggle"> Include the cards in my
  hand</label><button class="btn btn-ghost btn-block btn-sm" id="closeDiscardsBtn"
  style="margin-top:14px;">Close</button>
</div></div>
```

`render.ts discardsHtml(v: View, withHand: boolean): SafeHtml` (exported, unit-pinned): for each
suit in `SUITS` order (S H D C) `<div class="dc-row black|red"><span class="dc-suit">♠</span>` + 13
`<span class="dc[ seen][ held][ top]" data-card="7H">7</span>` (A..K via `rankLabel`); `seen` = id
∈ `discardIds`, `top` = `discardTop.id`, `held` = `withHand && id ∈ v.me.hand`. Sub: `N of 52
discarded` + (withHand ? ` · H in your hand` : ''). `paintDiscards(doc, app, v)`:
`toggleClass(overlay, 'hidden', !open)`; while open `setHtml(grid)`, `setText(sub)`,
`setChecked(toggle, withHand)` (new in `web/shared/edge/dom.ts`, writes the property; page.fake.ts
gains a `checked` field). Bind: `discardsBtn` → open, `closeDiscardsBtn` and the backdrop
(`targetIdOf`) → close, `discardsHandToggle` `change` → toggleHand. The class words are literal
(ternaries extracted), so the contract needs no row. CSS (theme.css, overlays section):

```css
.dc-grid { display: flex; flex-direction: column; gap: 5px; margin-top: 8px; }
.dc-row { display: grid; grid-template-columns: 16px repeat(13, minmax(0, 1fr)); gap: 2px; }
.dc-suit { text-align: center; font-size: 0.9rem; color: var(--text); }
.dc { height: 30px; display: flex; align-items: center; justify-content: center; border-radius: 4px;
      background: #fdfdf7; color: #111; font-size: 0.7rem; font-weight: 800;
      box-shadow: 0 1px 2px rgba(0,0,0,0.35); }
.dc-row.red .dc, .dc-row.red .dc-suit { color: #c81e1e; }
.dc.seen, .dc.held { opacity: 0.22; filter: grayscale(1); box-shadow: none; }
.dc.held { opacity: 0.4; box-shadow: inset 0 0 0 1px var(--gold); }  /* mine, when included */
.dc.top { opacity: 0.75; box-shadow: 0 0 0 2px var(--accent); }        /* what a draw would take */
.dc-toggle { display: flex; align-items: center; justify-content: center; gap: 8px;
             margin-top: 12px; font-size: 0.85rem; font-weight: 600; color: var(--muted); }
.dc-toggle input { width: 18px; height: 18px; accent-color: var(--accent); }
```

Width: phone sheet content 322px → 21.5px chips ("10" at 11.2px bold ≈ 14px fits); desktop 26px.
Height 135px; the sheet never scrolls. Sheet, title, sub, close button, card colours: all reused.

## 9. Interaction table

- My `upcard`/`draw` starts: picture = engine's (rule a). Arrange disabled. `#hand[data-rows]` set.
- Tap stock / discard pile / Take: as today → `shown`; picture kept (b); the card sits in the
  ghost's hole. ↩ only when `from === 'discard'`.
- `shown`, tap ↩ (discard-pile draw): view back to `draw`/`upcard` → (a) → the turn-start picture,
  identical cells. After a stock draw there is no ↩; `__gin.act(undoDraw)` toasts, stage kept.
- `shown`, tap the ghost card: accept → (c) → the card stays in that cell as a loose card; Arrange
  enables iff the engine melds it. Tap a held card: accept and select, same cells.
- Accepted, tap a card: selection toggles; tap the locked card: toast; tap a pile: nothing;
  open/close rules, history, the discards sheet, the chooser: no cell moves in any of these.
- Tap `Arrange`: picture = engine's (of the on-table cards), rows may change, Arrange disables.
  Tap `#deadwoodInfo` (2+ ways) → chooser; pick → `setMelds`, picture = engine's with that pref.
- Discard / Knock: the card leaves in place (d); a broken meld paints loose in place. Opponent's
  turn (online): my picture is kept. Pass-and-play: the mover sees the engine's picture.
- 🔍: sheet opens; the checkbox greys my cards too; Close or the backdrop closes. Round over: the
  result sheet as today, `Laid off onto X's melds` when any card was laid off.

## 10. Stories to add or change (id → state → facts → screenshot)

Facts gain `rows: { phone, desktop }` (from `rowsOf`), `arrange: 'off' | 'idle' | 'on'`, `sheet:
'none' | 'meldOverlay' | 'discardsOverlay' | 'roundResultOverlay'`, `dc?: { seen, held, top }`,
`laidOff?: string[]`. Overlay stories shoot `body` at both viewports. Seed 12 unless searched.

- Existing 16: pictures explicit; `drawn-stock-shown` and `accepted-*` lose ↩; `undo-back-to-draw`
  from `drewDiscard`; `accepted-fresh`: the drawn card is the last loose cell, Arrange `on` iff
  the engine melds it. Property: `cardsOf(accepted)` minus the drawn id equals `cardsOf(shown)`.
  `arranged-after-accept` → + `hand/arrange` → the engine's eleven, Arrange `off`.
- `discarded-kept-picture` → `accepted-fresh` discards a card out of a meld → 10 cards, the broken
  group's two cells `slot dead` in place, Arrange `on`; the fresh dot still on the kept card.
- `accepted-two-ways` → first seed whose accepted hand has ≥2 `meldOptions` (`TWO_WAYS_SEED`) →
  badge `⇄ 2 ways`, `.tappable-dw`; `meld-chooser-open` → same, `meldChooser: true`, sheet fact.
- `hand-three-rows` → seed search for a turn-start picture with `rowsOf(...,6).length === 3` →
  `rows.phone: 3`, `#hand[data-rows="3"]`; also loaded at 375x667 (geometry: the page scrolls).
- `discards-open` → `knockState` (Ann's turn-17 discard phase), `discardsOpen: true` → `dc.seen =
  discard.length`, `dc.top = discard.at(-1).id`, `held 0`; `discards-with-hand` → +
  `discardsWithHand: true` → `held = hand.length`.
- `round-over-laid-off` (Alice's seat) and `round-over-laid-off-defender` (Bob's) → the §7 chain
  position knocked, `resultDismissed: false` → `laidOff: ['4S','5S']`, sheet fact.

## 11. Flows to add (spec → steps → assertions)

- `e2e/gin-discard.spec.ts` (new; the `player` fixture seeds `Math.random` per title; both
  viewports): start local → take the upcard (ghost, locked) → record `#hand .slot` boxes by inner
  `data-card` → accept → every recorded box unchanged, the taken card's box equals the ghost's,
  ↩ present → select a free card (`.selected`, status 'Discard it, or knock if you can',
  `#deadwoodInfo` 'Deadwood after discard: N', Discard enabled) → "click other stuff": tap another
  card, tap it again, tap the locked card (toast), tap both piles, open/close rules, history and
  the discards sheet (button and backdrop), tap `#deadwoodInfo` (chooser only if `.tappable-dw`;
  close) → after each, every `.slot` box equals the recording (slots, not cards: the lift is a
  transform) → Discard → 10 cards, `#discardPile .card` = the id, curtain → the other seat: Arrange
  disabled → stock draw → no ↩ → accept → discard → seat one: Arrange disabled (re-arranged at turn
  start). Modal block: after the deal `.dc.seen` = 1 with the upcard `.dc.top`; toggle → 10
  `.dc.held`; close both ways. When `.tappable-dw` appears, pick an option: only a group changes.
- `e2e/gin-arrange.spec.ts` (new; `?story=<id>&live`): `boot.ts` gains `live` = `bindAll` + a
  dispatch loop over `reduce` that paints and drops effects (~25 lines, a documented UI-only hook).
  On `accepted-two-ways&live`: badge, tap `#deadwoodInfo` → `#meldOverlay` with N `.rr-panel`s, one
  `(in use)` → pick option 2 → sheet closes, the first `.group`'s cards equal option 2's `melds[0]`,
  `(in use)` moved, Arrange disabled; pick option 1 → back. On `accepted-fresh&live` when `arrange
  === 'on'`: tap Arrange → cells equal `arranged-after-accept`'s.
- `e2e/gin-draw.spec.ts`: stock: no ↩ while shown or after accept; upcard: ↩ works, `takeUpcard`
  visible after it; `expectLayout` → `expectHandRows`. `e2e/gin-stories.spec.ts`: `expectHandRows`
  per story; `rows` facts vs the DOM; `sameHandAs` rects kept; sheet facts read `.meld-group.laid
  .card` and `.dc.seen/.held/.top`. `e2e/gin-geometry.spec.ts`: within-turn frame pairs (§6);
  `hand-three-rows` at 375x667 scrolls to a reachable actions row. `e2e/gin-online.spec.ts`: after
  the host's first discard the guest's sheet `.dc.seen` ids equal the host's. gin-local: §7(c).

## 12. Oracles

- Computed styles (`tools/parity/computed-styles.ts` SELECTORS, goldens
  `test/fixtures/styles/gin-rummy.{390x844,1280x800}.json`): PR 1 flips `.actions .btn` (the first
  match at 'turn: accepted the drawn card (fresh)' is now the `btn-secondary` Discard); PR 2 flips
  `.hand` and adds `.group`, `.group.n3`, `.arrange-btn`, `.arrange-btn:disabled`; PR 3 adds
  `.pile-peek`, `.pile-peek:disabled`, `.dc-row`, `.dc`, `.dc.seen`, `.dc.held`, `.dc.top`,
  `.dc-toggle`. Fidice byte-identical throughout. gin-dom-parity: 84 checkpoints, 0 mismatches
  throughout (`tableScreen` excluded; the sheets' markup unchanged; the driver never clicks undo).
- Parity legs: `gin.legacy.test.ts` undo split and the layoff position (per leg);
  `gin.melds.test.ts` equality → inequality only for `multiFit` hands; `gin.replay.ts` stock-undo
  normaliser, `discardIds` strip, early stop at a `multiFit` knock, each tallied. Wire corpus
  (`test/fixtures/legacy/gin-wire`), `gin.codecs`/`gin.protocol`, save byte parity, the legacy
  `#hand` golden, status/deadwood goldens: untouched and green.
- Class contract: one new row `n1 … n11` (template `n${len}`); every other new class is literal.
- Story PNGs (darwin locally, linux via the dispatch job): PR 1 re-records `drawn-stock-shown`,
  `accepted-fresh`, `accepted-selected`, `accepted-knock`, `accepted-gin` and adds 2; PR 2
  re-records all (header button, grid) and adds 5; PR 3 re-records all (🔍) and adds 2.

## 13. PR plan

PR 1, feat(gin): two rules: undo only after a discard-pile draw; lay off onto the meld that lets
more cards follow (~+260/−70). §4 and §7 in full (engine, `settleDraw`, `refuse`, catalogue, the
per-leg splits, layoff.ts + layoff.test, the render.test sheet case, the two `round-over-laid-off*`
stories, the gin-local check), design doc §Status. Goldens: computed ×2; 5 PNGs re-recorded + 2.

PR 2, feat(gin): the hand keeps its picture; melds never split a row; Arrange (~+560/−170). §5 and
§6: `picture.ts` (+test), `DrawStage` without hold, `App.picture`, `rendered`, `hand/arrange`,
`meld/choose`, header button + CSS, `.group`/`nK`/dense grid/`:has` fallback, `data-rows`,
`expectHandRows`, gin-geometry within-turn pairs, gin-draw amended, `&live` in boot.ts,
`e2e/gin-discard.spec.ts` (all but the modal block), `e2e/gin-arrange.spec.ts`, the five §10
stories without a sheet, the CONTRACT row, ARCHITECTURE hooks. Goldens: computed ×2; all PNGs + 5.

PR 3, feat(gin): the discarded-cards sheet (~+340/−10). §8: `View.discardIds` (+decoder, gin.api,
replay strip, codecs tests), button + overlay markup, `discardsHtml`/`paintDiscards`/bind,
`setChecked`, three intents, CSS, the two `discards-*` stories, gin-discard's modal block,
gin-online's guest check, computed-style selectors, the ARCHITECTURE sentence on optional keys vs
version fields. Goldens: computed ×2; all story PNGs + 2 new.

Order 1 → 2 → 3: 1 is engine-first and unblocks the flows; 2's re-record precedes 3's so the 🔍
button lands on the final hand geometry. Each PR keeps pass-and-play, host, guest and resume green
(state.test roles, gin-local/online/resume specs) and names its flipped goldens in its body.

## 14. Risks

- The undo sentence is ambiguous; the adopted reading is stated as a rule (§2): two conditions flip.
- `rowsOf` must mirror Chromium's dense auto-placement exactly; the stories spec compares
  `data-rows` to the browser on every story at three viewports, so a mismatch fails loudly.
- A kept picture can show more loose cells than the deadwood readout says (after an accept that
  completes a meld); the enabled `Arrange` is the only cue. Fallback: one rule, arrange on accept.
- A three-row hand changes the hand's height mid-game and scrolls a 667px phone; the owner may
  prefer shrinking cards (a second size formula under `:has()`, not here).
- The layoff fix diverges from the legacy engine: gin.melds.test's 2000-hand equality weakens to an
  inequality for `multiFit` hands and gin.replay stops early at a `multiFit` knock (re-check the
  `outcomes` coverage once, one replay file at a time under the 60s rule).
- `View.discardIds` grows every state frame by ~4 bytes per discard with no version field (§2).
  `.pile-peek`'s absolute `left` mirrors `.pile`'s `min-width` formula; a pile-size change drifts
  the button (the screenshots catch it). `&live` runs the reducer without effects; a story flow
  needing persist or send silently does nothing (documented as UI-only).
- Three story re-records (PR 2 and 3 each ~39 PNGs × 2 platforms, ~7 MB per set in history).
  Accept-on-select stays (no longer a visible rearrangement); a pure two-tap flow is one branch.

## Status

PR 1 landed on 2026-09-21 (branch `gin-rules-undo-layoff`): §4 and §7 in full and the PR 1 items
of §10-§12. Engine: `undoDraw` refuses a stock draw with the exported `STOCK_DRAW_FINAL_MSG`,
`canUndo` requires `pendingDraw.from === 'discard'`, `legalActions` follows; `layOff` became
`layoffLeaves` (recursion over immutable records, no `*.algorithms.ts` needed), `maximalLayoff`
keeps the leaf with the most cards (the first on a tie), `bestMeldingWithLayoffs` enumerates the
subsets of the leaves' union; the false "L is unique" comment is gone. State, saves and the wire
corpus are byte-identical. The defect was reproduced through both legs before the fix: the §7
position scores the defender 28 (legacy: 7♣ onto the sevens, 8♣ stranded) against 20 (current:
both onto the clubs run); a hand built to the judges' figures (defender 7♣ 8♣ Q♦ K♦ 3♦ A-5♥ against
sevens, 4-5-6♣ and 9-10-J♥) scores 31 against 23. UI: `settleDraw` keys on `lastDrawnId`, `refuse`
clears only a `waiting` stage, the catalogue offers `undoDraw` only after a discard-pile draw and
`undone` comes from `drewDiscard`; `round-over-laid-off` and `round-over-laid-off-defender` added
with the `sheet` and `laidOff` facts (the only §10 fact fields PR 1 needed). Parity: the per-leg
splits as written; `gin.replay.ts` tallies `stockUndos` and `multiFitKnock` and ends a seed at a
`multiFit` knock. Oracles: `npm run check` green (77 files, 1938 tests); computed-styles `--check`
twice, 0 differences at both viewports, fidice byte-identical; gin-dom-parity 84 checkpoints, 0
mismatches, 0 page errors; coverage `engine/**` 98.7 / 95.85 / 99.33 / 99.76 over the 94/94/93/92
ratchet; `npm run test:e2e -- --grep-invert @online` green; the stories spec twice more with 0
diffs. Darwin PNGs re-recorded: `drawn-stock-shown`, `accepted-fresh`, `accepted-selected`,
`accepted-knock`, `accepted-gin` (phone and desktop); added: `round-over-laid-off`,
`round-over-laid-off-defender` (phone and desktop); the linux set comes from the dispatch job.
Where the doc was off: §12 places the `.actions .btn` flip at "turn: accepted the drawn card
(fresh)"; the golden records it at "12 turn: drew from the stock (ghost slot shown)" (the first
match is now the disabled Discard, the `.btn:disabled` hash) and "17 turn: knock available" (the
enabled `btn-secondary` Discard), and checkpoint 13 gains no entry because its first match equals
12's. §7's "31 vs 23" hand names no cards; the one above is a hand those figures fit. Next: PR 3 (the discards sheet).

PR 2 landed on 2026-09-22 (branch `gin-picture-arrange`): §5, §5b and §6 in full and the PR 2 items
of §10-§13, plus the owner's mid-implementation additions (§5b). `picture.ts` (`Picture` with
`human`, `settlePicture(prev, view, stage, fresh)` with the arrangement as a thunk, `rowsOf` and
`phoneRows`), `arrange.ts` (`SortMode` from `src/sort.ts`, `HumanMelds`, `standing`, `sorted`,
`arrangedOf`, `toggleMeld`, `declarable`), `DrawStage` without `hold`, `HandView.render(model,
selection, stage?, picture?)`, `SlotHandView` with `.group.nK` items and `.slot.human`, `App.picture
| human | sort | arrangeOpen`, the intents `arrange/open|close`, `hand/arrange {mode}`,
`card/press|release`, `hand/mark`, `writeSort` (`ginRummy_sort` in storage.ts), the header's
`#arrangeBtn` (`.due` cue) and the `#arrangeOverlay` sheet, the dense grid with the `:has()` third-
row fallback. Two things found on the way: main.ts (and the `&live` boot) must not repaint on an
unchanged App, or a card's pointerdown replaces the element and the browser drops its click (every
card tap died until then); and `tools/parity/computed-styles.ts` swallowed a driver error as a
silent exit 0 (a `catch` now reports it). Stories: 27 (nine new: `arranged-after-accept`,
`accepted-two-ways`, `meld-chooser-open`, `human-meld`, `sorted-by-rank`, `sorted-by-suit`,
`arrange-sheet-open`, `hand-three-rows`, `discarded-kept-picture`); `accepted-fresh` gained
`sameHandAs: 'draw-mine-open'` (an accept moves nothing). The two-ways deal (`TWO_WAYS_SEED`)
carries every story that needs a meld: seed 12's accepted hand melds nothing. Oracles: `npm run
check` green (79 files, 1996 tests); coverage `ui/hand` 100 / 99.3 / 100 / 100 and `stories`
93.4 / 91.1 / 95.2 / 100 over their ratchets; computed-styles re-recorded (gin ×2; fidice
byte-identical) then `--check` 0 differences; gin-dom-parity 84 checkpoints, 0 mismatches; the
stories spec 81/81 at three viewports (facts, `expectHandRows`, `rows` vs the DOM, `sameHandAs`);
gin-draw, gin-discard (new), gin-arrange (new; `?story=<id>&live`, which now runs the reducer's
timers and toasts), gin-geometry (five viewports, the hand's frame within a turn), gin-local green.
Darwin PNGs re-recorded with `--update-snapshots=all` (the 0.002 ratio hid the Arrange pill: 48 of 52
files changed); the linux set comes from the dispatch job, which now records with `=all` too.

PR 3 landed on 2026-09-22 (branch `gin-discards-sheet`): §8 in full. `View.discardIds` is optional
and emitted last (types.ts, view.ts, decode.ts `optional(arrayOf(string))`, gin.api.ts;
`gin.replay.ts compareSeat` splits it off the current view and checks it against the state before
the legacy comparison), so every corpus frame and save still round-trips byte for byte and a legacy
host leaves the button disabled. `#discardsBtn.pile-peek` sits beside the discard pile absolutely
(both piles keep their boxes: the geometry frame and dom-parity are untouched), `#discardsOverlay`
holds `discardsHtml` (four `.dc-row`s of thirteen `.dc` chips: `seen`, `held`, `top`) with
`discardsSubText` and the `#discardsHandToggle` checkbox (`setChecked` in dom.ts, `checked` on the
page fake); `App.discardsOpen | discardsWithHand` with `discards/open|close|toggleHand`. Facts gain
`sheet: 'discardsOverlay'` and `dc: { seen, held, top, withHand }` (chips in deck order); stories
`discards-open` and `discards-with-hand` over the knock deal. Flows: gin-discard's sheet block after
the deal (the upcard alone greyed and ringed, the toggle greys the ten, both closes), gin-online's
guest check (the guest's greyed chips equal the host's, the top ringed). Oracles: `npm run check`
green (79 files, 2015 tests, dist 33); computed-styles re-recorded (gin ×2; fidice byte-identical)
and checked; gin-dom-parity 84 checkpoints, 0 mismatches; the stories spec 87/87 at three
viewports; the flow specs 20/20. Darwin PNGs re-recorded (`=all`, 46 changed, 4 new); the linux set
from the dispatch job. Next: the simplification pass (Sean Parent style, `/ari-code-comments`).
