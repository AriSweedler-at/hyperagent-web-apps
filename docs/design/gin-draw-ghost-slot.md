# Gin Rummy: the ghost draw slot, fixed hand geometry, and a stories harness

Base: design #1 (the judges' winner), grafted with the other designs' best ideas where they do not
conflict: story facts derived from the engine state, not the renderer (#2); a real-click "nothing
moves" test on the live game page (#2, #3); parity drivers that accept the drawn card on the new
page instead of leaning on a selection shortcut (#2); stories code behind a dynamic import so it
stays out of the production chunk. Paths are repo-relative; tree claims checked on 2026-09-21.

## 1. Goal (the owner's words)

"When you click to draw a card, I don't like how it changes everything. And I don't like how it's
10 in a row in a small screen view. I would much prefer if - when it was your turn to draw - there
was an 11th 'ghost' card that made it such that you could click the draw or the discard pile and
have that new card show up there (then clicking it again would put it into your hand, and leave
the 'newness' indicator on it). This way no cards would move position until you took an action."

"I want storybook style tests so that we can actually confirm that the UI is doing the right thing
and that it looks as desired. [...] Figure out a way to add UI tests so we make sure we don't break
this. The mobile layout should be different from the desktop layout and it should all work and be
treated properly."

Decided already: no Storybook dependency. "Storybook-style" is a typed catalogue of UI states
rendered by the real page, plus a Playwright spec at 390x844 and 1280x800 asserting DOM facts and
comparing screenshots against committed per-platform baselines.

## 2. Non-goals

- No engine, protocol, `View`, save-format or net-session change: `State.pendingDraw` and
  `View.canUndo`/`lastDrawnId`/`drawnFromDiscard` already carry what the UI needs.
- The hand stays grouped by meld with today's colours; cards move on accept (an action), never on
  the draw. A deal-order hand is not this change.
- No new npm dependency, no new page under `dist/`. `defaultHandView` and its byte golden stay
  until the optional PR D. iPhone SE gets a no-scroll assertion only; landscape none. Fidice: none.

## 3. State model

New module `web/games/gin-rummy/src/ui/hand/draw.ts` (pure; imported by state.ts and
SlotHandView.ts, no cycle):

```ts
export type DrawSource = 'stock' | 'discard';
/** The ten-card picture on screen when the player drew: painted until they accept. */
export type HandHold = Readonly<{ melds: ReadonlyArray<Meld>; deadwood: Cards }>;
export type DrawStage =
  | Readonly<{ kind: 'waiting'; from: DrawSource; hold: HandHold }>
  | Readonly<{ kind: 'shown'; from: DrawSource; cardId: string; hold: HandHold }>;
export const holdOf = (me: View['me']): HandHold => ({ melds: me.melds, deadwood: me.deadwood });
export const drawSource = (a: Action): DrawSource | null =>
  a.type === 'drawStock' ? 'stock'
  : a.type === 'drawDiscard' || a.type === 'takeUpcard' ? 'discard' : null;
/** Settle a stage against a freshly painted view. */
export const settleDraw = (stage: DrawStage | null, v: View): DrawStage | null => {
  if (stage === null) return null;
  const drawn = v.isMyTurn && v.phase === 'discard' && v.canUndo && v.lastDrawnId !== null;
  if (drawn)
    return stage.kind === 'shown' && stage.cardId === v.lastDrawnId
      ? stage
      : { kind: 'shown', from: stage.from, cardId: v.lastDrawnId, hold: stage.hold };
  const untouched = stage.kind === 'waiting' && v.isMyTurn
    && (v.phase === 'draw' || v.phase === 'upcard');
  return untouched ? stage : null;
};
```

`App` (state.ts) gains one field, `draw: DrawStage | null` (`initialApp`: null). Not in `saveFor`
(LocalSave/HostSave carry `State` only, so `test/parity/gin.state.test.ts` byte parity and the
`pendingDraw` capture stay green), not on the wire.

Intents (no new intent type; one new `data-act` string, `undoDraw`):

- `act(app, action, ctx)`: before the role switch, when `drawSource(action) !== null && app.view
  !== null`, set `draw: { kind: 'waiting', from, hold: holdOf(app.view.me) }`. One site covers
  `stock/tap`, `discard/tap` (draw and upcard phases) and `action/click takeUpcard`.
- `rendered(app)`: `draw: settleDraw(app.draw, view)` beside `selectedCard: selectionIn(...)`.
  Every view replacement funnels here: `broadcast`, `localBroadcast`, `guestFrame 'state'`, the
  `render` intent.
- New `refuse(app, msg) = step({ ...app, draw: null }, toast(msg))` replaces the three refusal
  sites that read `step(app, toast(...))` today (`localAct` twice, `hostDispatch` seat 0, `act`
  NOT_CONNECTED), so a refused draw never leaves the slot `pending`. `guestFrame 'toast'` clears
  `draw` too (the host refused the guest's draw).
- `card/tap` (my discard phase) while `app.draw?.kind === 'shown'`: the ghost card's id → accept,
  `{ ...app, draw: null }`, fx tap, `rendered`; any other held card → accept and select, `{ ...app,
  draw: null, selectedCard: id }`, fx tap, `rendered`. Otherwise today's branches (LOCKED_CARD_MSG
  toast, toggle selection).
- `action/click 'undoDraw'` → `act(app, { type: 'undoDraw' }, ctx)`. The `#undoDrawBtn` listener
  goes; `#actions` delegation handles it. After undo the view is in `draw`/`upcard`, `settleDraw`
  returns null, the slot is `open` again.
- `leaveFinish`, `startLocal`, `host/deal`, `guest/lost`: `draw: null`. `meld/open`,
  `meld/choose`: unchanged, allowed while shown (`setMelds` re-broadcasts, `settleDraw` keeps the
  `shown` stage, the held picture stays, the arrangement applies at accept).

Status copy: `cues.ts` gains `statusWith(view, selection, stage)`: `waiting` → sub `Drawing…`;
`shown` → sub `Tap the new card to keep it, or pick a discard` (main `Your turn` for both); else
`statusFor(view, selection)`. `statusFor`/`deadwoodText` stay byte-identical (goldens survive).

Persistence: only engine `State` survives a reload; a game resumed mid-draw paints the accepted
state (11 cards, `fresh` dot, ↩ enabled), no ghost: a documented degradation, since storing the
hold would break the save byte parity. Online: each side holds its own `draw`; the opponent's view
never carries it (`oppCards` goes 10→11 as today). Guest: tap → `send` + `waiting` (`pending`) →
`state` frame → `rendered` → `shown`; undo is the same round trip; a `render`/`visible` intent
during the wait keeps `waiting`. Host and pass-and-play settle inside the same dispatch.

## 4. DOM and classes (exact)

New `web/games/gin-rummy/src/ui/hand/SlotHandView.ts` exporting `slotHandView: HandView`. The
`HandView` type gains an optional third parameter, `render(model, selection, stage?: DrawStage |
null)`; `defaultHandView` ignores it and stays byte-identical for the legacy `#hand` golden.

`slotHandView.render(model, selection, stage = null)`:

1. Arrangement: `stage?.kind === 'shown' ? stage.hold : { melds: model.me.melds, deadwood:
   model.me.deadwood }`. While shown, the eleventh card is absent from the hold by construction.
2. Slots: each meld `i` yields `slot(c, m${i % 5}, first, last)` per card, then deadwood
   `slot(c, 'dead', false, false)`. Card flags: `selected: stage === null && selection === c.id`;
   `fresh: model.lastDrawnId === c.id`; `locked` as `defaultHandView` computes it.
3. Ghost slot, emitted whenever the hand holds 10 cards (11 grid cells always), omitted at 11:
   `shown` → `<div class="slot ghost shown">` + `cardHtml(card, { fresh: true, locked: stage.from
   === 'discard' })` with `card = model.me.hand.find(c => c.id === stage.cardId)` (falls back to
   `open` when absent); `waiting` → `<div class="slot ghost pending"></div>`; my turn in
   `draw`|`upcard` → `<div class="slot ghost open"></div>`; otherwise `<div class="slot
   ghost"></div>` (visibility hidden, cell kept).
4. One slot: `<div class="slot m0 head">…</div>`, `<div class="slot m0">…</div>`, `<div class="slot
   m0 tail">…</div>`; a one-card meld is `head tail`; deadwood `<div class="slot dead">…</div>`.
   Every class is a template literal except `${cls}` (`m0..m4|dead`), so the contract extraction
   sees them; the existing `m0 m1 m2 m3 m4` CONTRACT.md row gains SlotHandView.ts.

So `#hand.hand` holds slots 0..9 (`.slot.mN[.head|.tail] > .card` in meld order, then `.slot.dead
> .card`) and slot 10, `.slot.ghost[.open|.pending|.shown]`; after accept, 11 card slots and no
ghost. `bindTable` is unchanged (`closestFrom(e, '.card')` → `card/tap` with the ghost card's
`data-card`), so the drawn card is tappable like every other card and `.hand.active .card {
cursor: pointer }` applies. The ghost cell is never a `.card`, so `#hand .card` keeps counting
real cards (10 or 11) for `readTable`, `discardFirstFree` and gin-local's curtain check.

render.ts: `paintHand` passes `app.draw` to the view and drops the `#undoBar` toggle;
`paintStatus` uses `statusWith`. `actionsHtml`, discard phase: when `v.canUndo`, first `<button
class="btn btn-ghost" data-act="undoDraw" title="Undo draw">↩</button>`, then `data-act="discard"`
labelled `Discard` and `data-act="knock"` labelled `Knock` / `GIN!` with `<small>(n)</small>`
(shorter labels so three buttons never wrap at 346px: an owner-visible copy change, named in PR A).
`paintPiles` drops the `piles-big`/`piles-small` toggles (one pile size). `paint`'s
`= defaultHandView` default goes so the legacy view tree-shakes out. index.html loses the
`#undoBar` line (page.fake.ts follows the markup). main.ts paints with `slotHandView`.

## 5. Layout

Mobile-first, one breakpoint at 900px. PR B retires `--tscale`, `--pile-base`, `fitTable`,
`ui/fit.ts`, `fit.test.ts`, the `fitScale` golden (gin.ui.test.ts 274-315, its `Measure` import,
`LegacyUi.fitTable` in test/parity/gin.fixtures.ts) and the `--tscale` pin in computed-styles'
READ_SCRIPT. Geometry is bounded by the viewport in CSS: no post-paint measure loop, no jump. The
`:root` off-table sizes are unchanged; every `calc(N * var(--tscale, 1))` becomes the literal
`N px` (`.table-center`, `.status-banner`, `.hand-area`, `.meld-group`, `.actions`).

```css
#tableScreen {
  /* six columns fit the phone: (100vw - 24 #app pad - 20 .hand-area pad - 6 x 6px slot pad) / 6;
     the dvh bound keeps two rows plus the piles on a short phone */
  --card-w: min(clamp(40px, calc((100vw - 80px) / 6), 54px), calc((100dvh - 540px) / 2.88));
  --pile-w: clamp(64px, 10dvh, 84px); --mini-w: 34px; --tiny-w: 22px;
  display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden; gap: 8px;
}
.status-sub { min-height: 1.2em; }
.last-action { height: 1.1em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hand { display: grid; grid-template-columns: repeat(6, calc(var(--card-w) + 6px));
        grid-auto-rows: calc(var(--card-w) * 1.44 + 9px); gap: 8px 0; justify-content: center;
        padding: 14px 0 2px; overflow: visible; }      /* 14px: room for the lift and the dot */
.slot { position: relative; display: flex; align-items: flex-start; justify-content: center;
        padding: 0 3px 6px; border-bottom: 3px solid transparent; }
.slot.head { border-radius: 10px 0 0 10px; }  .slot.tail { border-radius: 0 10px 10px 0; }
.slot.m0 { border-bottom-color: #4ade80; background: rgba(74,222,128,.10); } /* m1..m4 likewise */
.slot.dead { border-bottom-color: transparent; }
.slot.ghost { visibility: hidden; }
.slot.ghost.open, .slot.ghost.pending, .slot.ghost.shown { visibility: visible; }
.slot.ghost.open::before, .slot.ghost.pending::before { content: ""; position: absolute;
  inset: 0 3px 9px; border-radius: calc(var(--card-w) * .16);
  border: 2px dashed rgba(74,222,128,.6); animation: glow 1.4s ease-in-out infinite; }
.slot.ghost.pending::before { border-color: rgba(255,255,255,.25); animation: pulse 1.6s infinite; }
.actions { display: flex; gap: 10px; margin-top: 10px; min-height: 54px; flex-shrink: 0; }
.actions .btn { white-space: nowrap; }
@media (min-width: 900px) {
  body.fixed-screen #app { max-width: 860px; }
  #tableScreen { --card-w: 64px; --pile-w: 112px; }
  .hand { grid-template-columns: repeat(11, calc(var(--card-w) + 6px)); }
  .table-center { gap: 40px; }
}
```

Removed: `#tableScreen.piles-big`, `#tableScreen.piles-small`, the `.card` width/height
transitions (sizes never change now). `.meld-group*` rules stay (result sheet, chooser).

Fixed-geometry proof (heights from theme.css, 16px root font). At 390x844: `#app` padding 28 +
five 8px gaps 40 + topbar 44 + opp-strip 50 + table-center 171 (10 + 8 + 84x1.44 + 6 + 14 + 8 + 4)
+ status-banner 58 + last-action 14 + hand-area 301 (22 pad + 24 header + hand 175 [16 pad + 2 x
(51.7x1.44 + 9) + 8] + actions 64) = 706 < 844. At 1280x800 (64px cards, 112px piles): 672 < 800.
`.hand-area { margin-top: auto }` absorbs the rest, so the hand is bottom-anchored and nothing
above it changes size between phases (one pile size, a 54px actions row hosting the ↩, a reserved
`.status-sub` line, a one-line `.last-action`). Width: phone 6 x 57.7 = 346 = 390 - 44; desktop
11 x 70 = 770 inside 816. No card moves on a draw because the hand is always 11 fixed cells, the
drawn card lands in cell 11 and the held ten paint from the hold. At 375x667 the dvh term gives
44px cards, 67px piles, a 659px table: no scroll (the geometry-only viewport in §8).

## 6. Interaction table

- My `upcard`, tap the discard pile or `Take 7♥`: `act(takeUpcard)` with hold → `shown`: card in
  slot 11 with the dot and 🔒, the ten cards byte-identical, status "Tap the new card…", actions
  ↩ / Discard (off) / Knock (off). `Pass`: as today, no hold.
- My `draw` (`open`), tap the stock: `act(drawStock)` → `shown` (dot, no lock). Tap the discard
  pile: `act(drawDiscard)` → `shown` with 🔒; when `forceStock`: FORCE_STOCK_MSG toast, slot stays
  `open`. Guest: `waiting` (`pending`, "Drawing…") until the `state` frame or a `toast` frame;
  a second draw tap during the wait (either pile, `Take`) is ignored, so the host never sees a
  duplicate it would refuse with a toast that clears the stage.
- `shown`, tap the ghost card: accept. `draw: null`, the 11 cards re-meld into slots 0..10, the dot
  stays on the drawn card, normal selection state. Tap a held card: accept and select it in one
  tap (status "Discard it, or knock if you can", Discard enabled, deadwood-after readout).
- `shown`, tap ↩: `act(undoDraw)` → view back to `draw`/`upcard` → slot `open`, piles glow, the ten
  cards paint from the view. Tap `#deadwoodInfo` (2+ meldings): chooser as today; choosing
  re-broadcasts, the stage stays `shown`, the held picture stays.
- Accepted: today's behaviour (toggle selection; LOCKED_CARD_MSG on the locked card; ↩ while
  `canUndo`; Discard / Knock unchanged; the dot persists on the kept card into the opponent's turn).
- Their turn and `roundOver`: taps ignored as today, ghost cell hidden. Pass-and-play: discarding
  requires accepting, so the phone never changes hands mid-ghost; the curtain path is unchanged.

## 7. Stories catalogue

`web/games/gin-rummy/src/stories/catalogue.ts` (outside `src/ui/**`, so the 94% ui/ coverage
ratchet is untouched; pure, no `?raw`, importable by vitest and Playwright):

`Story = { id, title, app: App, facts: StoryFacts, sameHandAs?: string, screenshot: boolean }`;
`StoryFacts = { slots, handCards, ghost: 'hidden'|'open'|'pending'|'shown', freshId, lockedId,
selectedId, stock: 'tappable'|'idle', discard: 'tappable'|'blocked'|'idle', actions: { act,
enabled }[], statusSub }`; exports `STORIES: ReadonlyArray<Story>` and `storyById(id)`.

Built from one seeded game (`mulberry32(12)`, `createGame`/`applyAction`/`viewFor`) as `App = {
...initialApp, role: 'local', game, view, screen: 'tableScreen', revealed: seat, oppConnected:
true, draw }`. Facts come from the engine (`state.lastDrawn.id`, `state.drawnFromDiscard`,
`view.discardOptions`, `view.canUndo`, `view.forceStock`) and the stage, not the renderer, so the
catalogue test is an independent oracle. Sixteen stories, all screenshot unless noted; `sameHandAs`
pairs assert equal `(slotIndex, cardId)` over the first ten slots (vitest) and equal rects
(Playwright): the owner's sentence as an assertion.

- `upcard-mine`: 11 slots, 10 cards, ghost `open`, discard tappable, Pass/Take enabled.
- `upcard-theirs`, `draw-theirs`: ghost hidden, nothing tappable, waiting note.
- `draw-mine-open`: ghost `open`, stock and discard tappable, no actions.
- `draw-mine-forced`: ghost `open`, discard `blocked`, status "Both passed…".
- `drawn-stock-shown` (sameHandAs draw-mine-open): ghost `shown`, fresh = drawn id, no lock, ↩
  enabled, Discard and Knock disabled.
- `drawn-discard-shown` (sameHandAs draw-mine-open), `taken-upcard-shown` (sameHandAs
  upcard-mine): fresh + locked = drawn id, ↩ enabled.
- `drawn-pending-guest` (role guest, `waiting`, view in draw phase): ghost `pending`, "Drawing…".
- `accepted-fresh`: 11 slots, 11 cards, no ghost, fresh = drawn id, Discard disabled.
- `accepted-selected`: selected id, Discard enabled, deadwood-after readout.
- `accepted-knock` (seed searched with `Array.from(...).find`): Knock enabled with `(n)`;
  `accepted-gin` (hand-built View, 0 deadwood): `GIN!` label.
- `undo-back-to-draw` (sameHandAs draw-mine-open; no screenshot): DOM-identical to it.
- `after-discard-theirs`: 10 cards, ghost hidden, the fresh dot still on the kept card.
- `round-over-table`: Show results, ghost hidden.

## 8. Test harness

Stories page (no new dist page): `web/games/gin-rummy/src/stories/boot.ts` exports
`bootStory(document, id, nav)`: `renderRules` then `paint(document, story.app, slotHandView)`.
`main.ts` reads `new URLSearchParams(location.search).get('story')` first thing in `boot()`; when
present it runs `void import('./src/stories/boot.ts')` and returns before any store/net/ICE setup.
The dynamic import lands as `shared/assets/boot-<hash>.js` (chunkFileNames), so `games/gin-rummy/`
keeps its three files (dist-parity) and the entry chunk carries no catalogue. `?story=` (empty)
lists the stories as links; `?story=<id>&nav` adds a prev/index/next bar (inline styles); the spec
omits `nav`. `?story=` joins the documented test hooks in docs/ARCHITECTURE.md.

Unit (vitest): `ui/hand/SlotHandView.test.ts` (exact strings for 10 cards + open ghost; shown from
stock and from discard (`fresh locked`); pending; hidden on their turn; 11 slots and no ghost after
accept; head/tail/single-card group; the hold wins over `model.me.melds`; selection suppressed
while shown). `ui/hand/draw.test.ts` (`settleDraw` table, `drawSource`, `holdOf`).
`ui/state.test.ts` (local `stock/tap` → `shown` with the pre-draw hold; upcard `discard/tap`;
`card/tap` on the ghost → null, effects `['fx', 'scrollTop']`; on a held card → null + selected;
`undoDraw` → null; a refused `applyAction` → null + toast; guest `waiting`/`state`/`toast`/`render`
sequence; `saveFor` has no `draw` key). `ui/cues.test.ts` (`statusWith`). `ui/render.test.ts`
(`#hand` equals `slotHandView.render(v, sel, app.draw)`; `#actions` exact string with ↩; no
`piles-*`; `bindAll` on `[data-act=undoDraw]`; `#undoBar`/`fitTable` assertions removed).
`stories/catalogue.test.ts` (ids unique and kebab-case; every story paints on `ginPage(MARKUP)`;
facts vs the painted strings; `sameHandAs` pairs).

Playwright `e2e/gin-stories.spec.ts` (pages project only; `watchPage` for zero exceptions):

```ts
const VIEWPORTS = { phone: { width: 390, height: 844, shot: true },
  desktop: { width: 1280, height: 800, shot: true },
  'phone-short': { width: 375, height: 667, shot: false } } as const;   // geometry only
for (const [vp, cfg] of Object.entries(VIEWPORTS)) test.describe(vp, () => {
  test.use({ viewport: { width: cfg.width, height: cfg.height } });
  for (const story of STORIES) test(story.id, async ({ page }) => {
    await page.goto(`${pagePath('pages', 'gin-rummy')}?story=${story.id}`);
    // ...facts, geometry and stability assertions (below), then:
    if (cfg.shot && story.screenshot)
      await expect(page.locator(vp === 'phone' ? 'body' : '#app')).toHaveScreenshot(
        `${story.id}--${vp}.png`,
        { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.002 });
  });
});
```

Facts: `#hand .slot` count, `#hand .slot .card[data-card]` count, ghost class, fresh/locked/
selected `data-card`, `#stockPile`/`#discardPile` classes, enabled `#actions [data-act]` set,
`#statusSub`. Geometry: `#app` and `#hand` `scrollHeight <= clientHeight + 1`; every `.slot` the
same size (±0.5px); phone: slots 0-5 share a top and 6-10 another; desktop: one top. Stability:
with `sameHandAs`, load it too and compare `{data-card -> rect}` of the first ten slots.

Real-click proof, `e2e/gin-draw.spec.ts` (player fixture, pass-and-play, both projects): start a
game, reveal, pass, reveal; record `{data-card -> boundingBox}` of `#hand .slot .card` and the
ghost slot's box; click `#stockPile`; assert every held box unchanged, `#hand .slot.ghost.shown
.card.fresh` at the ghost's box, `#hand .card` count 11, ↩ enabled, Discard disabled; click the
ghost card → no `.slot.ghost`, 11 cards, dot on the same id; click `[data-act=undoDraw]` → 10
cards, `.slot.ghost.open`, stock tappable, boxes equal to the start.

Baselines: `playwright.config.ts` gains `snapshotPathTemplate:
'{testDir}/__screenshots__/{testFileName}/{arg}-{platform}{ext}'`, so files are
`e2e/__screenshots__/gin-stories.spec.ts/<id>--<vp>-darwin.png` locally and `-linux.png` on CI
(about 30 each). A missing baseline fails (Playwright's default; a silent-skip guard was rejected
so CI cannot be green with no visual coverage). CI: a `workflow_dispatch` job in
`.github/workflows/stories-baselines.yml` runs `npm run build && npx playwright test
e2e/gin-stories.spec.ts --project pages --update-snapshots` on ubuntu and uploads
`e2e/__screenshots__`; the PR author commits the `-linux.png` files before the `e2e` job is
required. Updating after a named visual change: the same command locally (darwin), the dispatch
job on the branch (linux), commit both, name the change in the PR body.

## 9. Oracles

`tools/parity/gin-dom-parity.ts` (84 checkpoints against the frozen legacy page): `SNAPSHOT_IDS`
drops `tableScreen`, which diverges by design (slots, ghost, undo in the actions row, one pile
size, shorter labels); the other ten ids (`homeScreen`, `curtainOverlay`, `roundResultOverlay`,
`meldOverlay`, `endgameScreen`, `historyOverlay`, `rulesOverlay`, the three scorer ids) and the
toast text keep comparing at every checkpoint. Lockstep: after `[data-act="takeUpcard"]` and after
`#stockPile` the driver runs `acceptIfShown(pair.next)`, a click on `#hand .slot.ghost .card` when
present (the legacy page never has one), so both pages hold the same accepted state and every later
click matches. The `normalise` `--tscale` strip becomes a no-op and goes in PR B.

`tools/parity/computed-styles.ts` + `test/fixtures/styles/gin-rummy.{390x844,1280x800}.json`:
SELECTORS drop `#tableScreen.piles-big/.piles-small` and add `.slot`, `.slot.m0`, `.slot.dead`,
`.slot.head`, `.slot.ghost`, `.slot.ghost.open`, `.slot.ghost.open::before`, `.slot.ghost.shown`,
`.actions .btn`. The gin driver shoots `turn: drew from the stock (ghost slot shown)`, runs
`acceptIfShown`, then the existing shot renamed `turn: accepted the drawn card (fresh)`. The
READ_SCRIPT `--tscale` pin goes in PR B. Re-records (owner's machine; ports are off-limits here):
PR A "slot rules, grid hand, fixed pile size, undo in the actions row, shorter labels"; PR B
"tscale removal: paddings and gaps literal px, clamp() card sizes, 900px breakpoint".

`web/shared/styles/CONTRACT.md` + `test/dist/class-contract.test.ts`: `slot ghost open pending
shown head tail dead` are literal in SlotHandView templates and styled, so no row; the `m0 m1 m2 m3
m4` row gains `src/ui/hand/SlotHandView.ts`; `piles-big`/`piles-small` leave TS and CSS together;
the Tokens paragraph loses `--tscale`/`--pile-base` (PR B). `dist-parity`, `asset-urls`,
`check-dist-paths`: unaffected (no new page). Legacy goldens in `test/parity/gin.ui.test.ts` stay
except `fitScale`, deleted in PR B (retired, named). Save byte parity: untouched.

e2e fixtures (`e2e/fixtures/gin.ts`): add `ginAcceptDraw(page)` (click `#hand .slot.ghost .card`,
expect no `.slot.ghost` and 11 `#hand .card`); `ginDrawAndDiscard` and `ginTakeUpcardAndDiscard`
call it before `discardFirstFree`, so the fixtures exercise the owner's two-tap flow, not the
accept-on-select shortcut. gin-local.spec asserts after `Take` that the ghost slot holds the locked
card and the ten others kept their `data-card` order. gin-online/gin-resume: unchanged.

## 10. PR plan

PR A, feat(gin): slot hand view with the ghost draw slot (~+520/−110). §3, §4, theme.css
slot/grid/actions rules with the piles rules removed (`--tscale` still present), §9's parity and
computed-styles edits, e2e `ginAcceptDraw` + gin-local assertion, CONTRACT.md m-row, ARCHITECTURE
"Seams" note. Goldens flipped (named): computed-style gin at both viewports; dom-parity scope.
Untouched: legacy hand string golden, status/deadwood goldens, save byte parity.

PR B, refactor(gin): fixed table geometry; retire --tscale and fitTable (~+50/−280). §5's
theme.css; delete ui/fit.ts and fit.test.ts; `fitTable`, `queueFit` and listeners; render.test fit
cases; gin.ui.test `fitScale` describe; gin.fixtures `fitTable`; READ_SCRIPT pin; `normalise`
strip; CONTRACT.md tokens paragraph; ARCHITECTURE "Seams" (phone layout stability: done by CSS).
Goldens flipped (named): computed-style gin at both viewports; the `fitScale` golden retired.

PR C, test(gin): stories catalogue, ?story boot, Playwright stories and draw specs, per-platform
screenshots (~+700 + ~60 PNGs, 3-5 MB). §7 and §8, plus ARCHITECTURE "Testing pyramid" bullet 5
"Stories" (how to add one, how to re-record) and the `?story=` hook. Darwin baselines recorded
locally, linux via the dispatch job on the branch, both committed before the e2e job is required.
No goldens flipped.

PR D (optional), chore(gin): retire `defaultHandView`, its `legacyHandHtml` golden and the
`gin-ui.cjs` hand usage; make `stage` required; move `web/shared/ui/README.md`'s HandView row to
"landed". Named as a retired golden.

Order A → B → C: B needs A's slots for the two-row guarantee; C's screenshots are taken on the
final geometry so baselines are recorded once. Each PR keeps pass-and-play, host, guest and resume
green; PR A covers every new ui/ branch (`settleDraw`, `statusWith`, `refuse`, both accept paths,
the guest toast reset) so the 94%/90% ratchet holds.

## 11. Risks

- Accept-on-select (tapping a held card while the ghost is shown accepts and selects it) is a UX
  choice the owner did not state; kept because a tap on a held card is an action by the owner's
  own rule. Fixtures and parity drivers no longer depend on it: inert is a one-branch change.
- Button copy shortens to `Discard` / `Knock` / `GIN!` so ↩ fits a fixed 54px row at 346px.
  Owner-visible; named in PR A. The status line still says what the buttons do.
- CSS constants (`(100vw - 80px)/6`, `(100dvh - 540px)/2.88`, 900px) are asserted at 390x844,
  1280x800 and, no-scroll only, 375x667; landscape is not. Removing `fitTable` removes the safety
  net for tall content: `.last-action` and `.status-sub` are one line each, `.opp-name` already
  ellipsises, and the no-scroll story assertion catches regressions.
- Per-platform PNG baselines: linux files must come from the CI runner before the e2e job passes;
  Chromium or font upgrades force re-records (~3-5 MB of history each).
- Generic class words (`slot open pending shown head tail ghost`) satisfy the contract by name; a
  future rule reusing one passes silently. A lost guest `state` frame leaves `pending` (as today).
- `defaultHandView` lives on as test-only code until PR D; a future `paint` call site passing no
  view would bring it back into the bundle. The stories chunk ships behind `?story=`: static, no
  store, no network, and out of the game's entry chunk thanks to the dynamic import.

## Status

PR A landed on 2026-09-21 (branch `gin-ghost-slot-a`): §3, §4, the PR A part of §5 (`.slot*`, the
`.hand` grid with the 900px breakpoint, the fixed `.actions` row, one pile size; `--tscale` and
`fitTable` stay for PR B), §6, the real-click proof `e2e/gin-draw.spec.ts` pulled forward from PR C
at 390x844 and 1280x800, `ginAcceptDraw` in the fixtures, the gin-local assertion, and §9's oracle
edits: `gin-dom-parity` without `tableScreen` (84 checkpoints, 0 mismatches), the gin
computed-style goldens re-recorded at both viewports (fidice byte-identical), the CONTRACT.md
`m0..m4` row. Owner-visible choices kept as written: accept-on-select, and the button labels
`Discard` / `Knock` / `GIN!`. Follow-up on the same branch: `act` ignores a draw while one is
`waiting`, closing the guest-only double-tap hole (the host's refusal toast collapsed the ghost
card). Next: PR B (fixed geometry, retire `--tscale`), PR C (stories).
