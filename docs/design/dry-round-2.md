# DRY round 2: what else hoists out of the per-game code, and how each piece is unit-tested

Measured on main `5a19690` (plus the local `bg-table-ux` branch `eaf17d8`) by four audits: table UI, reducer/engine, styles/markup, fidice + tooling. Every line count below is `wc -l`; every "twin similarity" is python `difflib` over comment-stripped, whitespace-normalised lines (1.0 = identical). Nothing in this plan edits the repo; it sequences PRs after C2, C3 and bg-table-ux.

## 1. The ask and the answer in ten lines

1. **Ask**: make the per-game logic as DRY and as small as possible, hoisting what is generic and unit-testing it on fakes.
2. **Gin today**: 10,144 product lines (src 8,933 + index.html 381 + theme.css 423 + main.ts ~407); e2e 1,648 + fixtures 293; parity tests 3,411.
3. **Backgammon today**: 9,807 (src 6,981 + index.html 584 + theme.css 1,959 + main.ts ~283); e2e 694 + fixtures 489. **Fidice today**: 8,789 (src 8,321 + page 468).
4. **After Waves A-C** (C2 lifts the 172/177-line turn-authority kernel + SHELL_INTENTS/homeView ~30; C3 lifts ~105/110 main.ts lines + 9 hook members): gin ~9,800, backgammon ~9,450, fidice unchanged.
5. **After this plan**: gin ~9,200 (-300 table UI, -50 engine/decoders, -148 styles/markup net, -88 stories boot); backgammon ~8,650 (-255, -56, -475 net, 0); fidice ~8,780 (<= 10 lines: a constant, `whenTransportReady`, `normaliseName`).
6. **Harness side**: ci.yml 442 -> ~360; computed-styles.ts -67; two fidice online specs (112) + two glossary specs (195) + gin-stories generic half (~90) fold into shared specs; ~130 engine-test scaffolding lines fold into `test/shared/`.
7. **New shared code**: ~235 table-UI kernels (+250 tests), ~180 lib/test-harness (+130 tests), shell.css ~350-420 Prettier lines + shell markup templates ~150 + generator 80 (+40 drift test), ~300 tooling/e2e fixtures. About 1,350 shared lines replace ~2,000 per-game and per-game-harness lines.
8. **What a fourth two-seat game writes after this**: its engine + `TwoSeatEngine` adapter; a `Table` reducer (~500 lines, the floor: gin's is ~540, backgammon's ~470); its table painters + a `bindDrag` config (~50) + a `motion` plug-in if it wants one; ~20 token lines + table CSS; own screens (~250 markup lines) + ~25 shell slot strings; one `ONLINE_DRIVERS` row + one `SHELL` row + one `REGISTRY` row; touches 8 existing files instead of 13 (ci.yml, two-players.ts, GAME_FOLDERS, PAGE_ONLY_SPECS drop out).
9. **What does not hoist, by measurement**: the cue machines (5/62 identical), selection reducers (5/26), geometry oracles (3/58), result painters (2/30), dice (1/22), the three log shapes, curtain copy, both `viewFor` redactions, fidice's controller/host/toast queue: these share a shape a README paragraph records, not a module.
10. **Order**: Wave D (small hoists that touch no in-flight file) can start now in parallel with C2/C3; Wave E (drag/motion/D2/glossary/fixtures) after bg-table-ux; Wave F (shell.css + markup generator) after bg-table-ux's golden re-record; Wave G (stories, position/load, cue memory) after C3; Wave H (dice, shared motion CSS, fidice shell) waits on the Fidice restyle.

## 2. The measured inventory

Verdicts: **hoist-now** (no in-flight file overlap), **hoist-after** (lands after the named PR), **candidate** (a kernel exists but the second consumer waits), **fold** (delete or fold into an existing shared module), **stays** (game-specific by necessity), **shared** (already shared; nothing more moves).

### 2E. Table UI (gin `src/ui/**` 2,344 lines audited; backgammon 2,543 on main / 2,723 on bg-table-ux)

| Path | Lines | Twin and similarity | Verdict |
|---|---|---|---|
| gin `ui/hand/dragger.ts` | 258 | bg `ui/board/dragger.ts` 185: 86 identical normalised lines = 59% of bg's 145 code lines, ratio 0.49 (Session cell, press/move/end, DRAG_THRESHOLD 8, ghost clone sized by a CSS var, capturePointer, LAND_MS 180 + 60 fallback, `inside()`) | hoist-after bg-table-ux (own PR) |
| bg `ui/board/dragger.ts` | 185 | gin dragger (above); residue absOf/sourceOf/destinationOf + `.target, .target-2` hit-test ~50 | hoist-after bg-table-ux |
| gin `ui/hand/drag.ts` | 67 | none: bg follows the pointer directly; gin's FOLLOW 0.35 / TILT 1.2 / MAX_TILT 14 is the owner-asked feel | stays (plugs in as `motion`) |
| gin `ui/hand/flip.ts` | 58 | bg `ui/board/fly.ts` 115 (181 on branch): 13-14 identical lines (measurable, px, forced rectOf read, afterTransition tail), ratio 0.21 | hoist-after bg-table-ux (motion.ts) |
| bg `ui/board/fly.ts` | 115 / 181 | flip.ts (above); the launch body (branch 120-155, ~30 lines) is `launchClone` | hoist-after bg-table-ux |
| gin `ui/render.ts` keyed sites (ensurePile + data-key x2 + data-result-key) | 35 | shared `shellPaint.ts ensureKeyed` (5 code lines, 7 bg call sites on main / 12 on branch); bg's two hand-rolled sites (#matchScore, #historyList) 10 lines; ensurePile vs ensureKeyed 1/5 identical (only the attribute name) | hoist-now |
| gin `bindTable` 11 constant-intent blocks + bg `button()` + 16 one-liners | 33 + 23 | bindTable bodies 11/59 identical (0.16); the pattern is one `bindButtons` | hoist-now |
| `connDotClass` + #connDot/#oppDot writes | 6 + 6 | byte-identical in both render.ts (id differs) | hoist-after C2 (needs one ShellState type) |
| gin card long-press bind (render 730-740) + `card/press|release` cases | 42 | shared `home.ts bindLongPress` (12 code lines, same three release events); shell submenu press cases identical modulo bg's `tap` const (C2's) | hoist-now (generalise `press` to a function) |
| gin `ui/home.ts` / bg `ui/home.ts` | 196 / 150 | 74/103 identical (0.60): SHELL_INTENTS 20, fillNameInputs/fillP2NameInput 8, homeView 6, re-exports 3 | hoist-after, inside C2 |
| gin `ui/page.fake.ts` / bg `ui/page.fake.ts` | 74 / 58 | 26/38 identical (0.54): import block, MODES, two modeButtons builds, `declared` queries, pageFromMarkup call | hoist-now (`shellPage`) |
| gin `ui/sound.ts` + bg `ui/sound.ts` | 26 + 26 | 8/14 identical (0.55): `CueSpec` type (already exported by edge/cuePlayer.ts) and the tap/yourTurn/win/lose rows | fold (CueSpec to lib/sound; SHELL_CUES optional) |
| `web/shared/ui/curtain.ts` `attrs` + `onReveal(btn)` | 8 | after bg-table-ux no game passes `attrs` or reads the button | fold (delete) |
| gin `ui/cues.ts` nextCue/oppDrawCue | 80 | bg `ui/state.ts` 637-727 cuesBetween block 91: 5/62 identical (0.08) | stays (README shape) |
| bg `ui/state.ts` selection/taps/drag cases | 110 | gin card/tap + card/drag* cases: drag 5/26 (0.19), taps 0 | stays (README shape) |
| bg `ui/board/layout.ts` | 265 | gin `hand/picture.ts` rowsOf (77 lines): 3/58 (0.05); two CSS mechanisms | stays |
| gin `hand/{picture,arrange,draw,SlotHandView,HandView,meldGroups}.ts` + `cards.ts` | 195+140+43+72+26+17+45 | none (cards.ts byte-pinned to the legacy) | stays |
| result/endgame/history painters (gin 420-651, bg 442-555 + resultText) | 230 / 148 | 2/30 (0.07) and 5/26 (0.19) | stays |
| bg `ui/board.ts` dice (124-247) | 124 | fidice `view/components.ts die()/diceRow()` 24 lines + PNG faces: 1/22 (0.04) | candidate (after Fidice restyle) |
| `.drag-ghost/.landing` CSS in both themes (+ bg `.flyer`) | 2 + 14 | same 7 declarations; only the shadow differs | candidate (P13 opens base.css) |
| gin `main.ts` repaint/dispatch skip + bg | 16 | 12 lines byte-identical | C3's (not double-counted) |
| `web/shared/edge/dom.ts` primitives, `ui/toast.ts`, `edge/page.fake.ts` | 80 / 65 / 361 | the primitives both draggers and motion modules build on | shared |

### 2F. Reducer and engine (table slices + engine-adjacent code)

| Path | Lines | Twin and similarity | Verdict |
|---|---|---|---|
| gin `ui/state.ts` table slice | 632 (172 kernel -> C2; ~540 residue) | bg table slice 639: whole-file 0.51, kernel 0.48 (45 identical), tableIntent 0.18, Table type 0.19, rendered 0.19 | stays (residue is the floor) |
| bg `ui/state.ts` table slice | 639 (177 kernel -> C2; ~470 residue, +90 on bg-table-ux) | gin (above); `sandboxLoad` 14 lines has no gin twin but the flow is generic | hoist-after C2 + bg-table-ux (`position/load`, cue memory) |
| gin `engine/types.ts` / bg `engine/types.ts` | 243 / 262 | whole 0.08; identical: `Seat = 0 \| 1`, `Pair<T>`, `Now`, `Player {id,name}`; gin `RuleError = string` | hoist-now (lib/game.ts primitives + `TwoSeatEngine`) |
| gin `engine/decode.ts` / bg `engine/decode.ts` | 305 / 284 | whole 0.15; `pair` 0.90 (11 lines each), seat/count/timestamp identical, decodeAction 0.32 (same head-then-switch) | hoist-now (`pair`, `taggedUnion`) |
| gin `engine/game.ts` / bg `engine/apply.ts` | 666 / 381 | 0.04; identical helper lines SEATS/otherPlayer/setAt (4); `applyAction` signature byte-identical | stays (4 helper lines re-export; gin gains `actorOf`) |
| gin `engine/view.ts` / bg `engine/view.ts` | 147 / 83 | 0.07; same key order for me/opp/phase/turn/isMyTurn/canUndo/result/startedAt | stays (contract signature only) |
| bg `engine/{notation,setup,score,board,moves,variants}.ts` | 1,015 | gin cards/melds/layoff (the card analogues); gin `sandbox.ts` vs parsePosition: same job, 0 shared lines | stays |
| bg `engine/replay.test.ts` | 404 | `test/parity/gin.replay.ts` 259: 0.02 overall, but the driver (PLAYERS, now, STEP_CAP, `mulberry32(seed)` dice + `mulberry32(seed*7919)` policy, reduce loop, env knob, `stable()`==`roundTrips()`) repeats in 5 files | hoist-now (`test/shared/replay.ts`) |
| `test/parity/gin.replay.ts` (+4 shard files) | 259 + 16 | bg replay (above): only GAMES/SHARDS/seedsOf/replayShard (~20) move | hoist-now (plumbing only) |
| `test/parity/gin.codecs.test.ts` | 141 | bg `decode.test.ts` `trace` + round trip (~40): same driver | hoist-now |
| `test/parity/gin.policy.ts` | 58 | bg replay `choose` 17: same role, 0 shared lines; `actor` (2 lines) becomes engine `actorOf` | stays (policy) |
| engine test files (gin decode.test 222; bg decode 186, apply 556, view 172, board/moves/notation/score) | ~1,600 | scaffolding redeclared: viaJson x6, failureOf x2, PLAYERS x18, now x15, counting x2, must x2; bg-only scripted x4, pos x9, mv x4 | hoist-now (`test/shared/engine-helpers.ts`, bg `engine/test-helpers.ts`) |
| gin `ui/cues.ts` cue machine | 80 | bg cuesBetween block 88: 0.00; shared shape = once-key + prev/next diff + role gating | hoist-after C2 (8-line cue memory only) |
| gin `ui/local.ts` / bg `ui/local.ts` | 44 / 114 | 0.22: imports + paintCurtain/bindLocal wrappers; copy is the game's | stays |
| gin `ui/sound.ts` + bg `ui/sound.ts` `CueSpec` | 3 + 3 | identical to `web/shared/edge/cuePlayer.ts:19` | fold |
| gin `sandbox.ts` | 392 | bg notation parsePosition/formatPosition + setup withPosition (~90): same job, different language | stays (entry point unifies under `position/load`) |
| gin `scorer/**` | 948 | none | stays |
| bg `ui/board.ts` tap model (261-410) | ~150 | gin card/tap 22 + selectionIn 2: 0 shared | stays (README: three selection rules) |
| gin/bg `main.ts` hook blocks | 57 / 36 | 9 of gin's 15 members byte-identical to bg's 11 | C3's (`hookExtras`) |
| fidice `domain/**`, `app/controller.ts`, `net/host.ts` | 743 / 686 / 367 | gin/bg 0.02-0.06; N-seat, class-based | stays (design §4.6) |
| `web/shared/lib/{result,json,rng,protocol}.ts` + `edge/prefs.ts` | 663 | consumers of the new `taggedUnion`: protocol.ts decodeFrame ~25 -> ~12, prefs.ts switch ~35 -> ~25 | shared (grows) |

### 2G. Styles and markup

| Path | Lines | Twin and similarity | Verdict |
|---|---|---|---|
| gin `theme.css` shell rules | 77 (76 selectors / 336 decls) | bg shell rules 637 lines (113 selectors / 435 decls): 68 common selectors; inside them 201 declarations byte-identical, 96 same-property-different-value (58 token-shaped: palette 40, radius 14, font-family 4; 36 type-scale; 2 keyframes), 16 gin-only, 56 bg-only; 21/68 whole rules identical; mean per-selector 0.62, whole-set 0.47 (0.61 with colours/lengths masked) | hoist-after bg-table-ux (`shell.css`, token-only) |
| bg `theme.css` shell rules | 637 | gin (above); bg-table-ux carries them unchanged but predates #75 (no `.btn-go`, no `--go`) | hoist-after bg-table-ux |
| gin `theme.css` table + extensions + tokens | 177 + 34 + 6 | none | stays |
| bg `theme.css` table + tokens | 1,111 (1,211 on branch) + 38 | none | stays |
| gin `theme.css` `.divider*` | 2 | dead legacy rule (CONTRACT.md says so) | fold (delete) |
| fidice `theme.css` | 358 | 30 selectors / 116 decls reuse shell names with own values; 14 selector + 13 class-word collisions | stays until restyle (must NOT link shell.css) |
| `web/shared/styles/tokens.css` / `base.css` | 35 / 18 | 13 shared custom properties / 3 rules | shared (tokens grows by ~7) |
| `web/shared/styles/CONTRACT.md` | 128 | 39 class rows; gin `jargon rule-flash` + `on off` duplicated verbatim as bg rows; 3 painter rows describe shared painters; 2 orphaned `--go` rows at lines 3-4 | hoist-now (Shared section, `shell` owner scope) |
| gin `index.html` shell sections | 156 (~121 shell + ~35 own) | bg shell sections 198 (~148 shell + ~50 selects): normalised token similarity home 0.79, guest wait 0.85, rules 0.74, host wait 0.70, history 0.59, curtain 0.57, endgame 0.53, table 0.16; hunks = ~14 copy strings, inline styles vs utility classes, option block, 2 structural extras | hoist-now (committed generator) |
| bg `index.html` shell sections | 198 | gin (above); bg-table-ux's 20-line change is inside #board only | hoist-now |
| gin / bg `index.html` own screens | 225 / 386 | none | stays |
| fidice `index.html`, sheshbesh `index.html` | 25 / 19 | vdom mount; alias stub | stays |
| `web/shared/ui/ids.ts` SHELL_IDS | 67 (53 ids) | design doc says 36: stale | shared (becomes the generator's id source) |
| `tools/parity/computed-styles.ts` SELECTORS + drivers | 1,642 | gin 153 / bg 111 / fidice 179 selectors; gin∩bg = 43 (doc says 42); driveGin vs driveBackgammon 0.52, hosting block verbatim (17 lines) | hoist-after bg-table-ux (D2: -67) |
| `test/fixtures/styles/*.json` 6 goldens | 9,348 | last re-recorded by #75 (all 6) and bg-table-ux (bg's 2) | shared (token-only move = 0 diffs, N notes) |
| `e2e/__screenshots__/gin-stories.spec.ts` | 120 PNGs (60/platform) | doc says 16x2/32: stale | shared (0 re-records for preserving moves) |
| `test/dist/dist-parity.test.ts` + `class-contract.test.ts` stylesheet-count assertions | 3 | pin exactly [one shared css, own css] per page | hoist-now (widen for a shell-games-only sheet) |

### 2H. Fidice (src 8,321 non-test + page 468)

| Path | Lines | Twin and similarity | Verdict |
|---|---|---|---|
| `app/controller.ts` | 686 | gin/bg shell slice: 0 lines; `:420` literal already `FIDICE_CODE_LENGTH_ERROR`; 6 sites of `trim().slice(0,16) \|\| 'Player'` (controller 378/393, lobby 86/113, protocol 73, host 292) | stays; two safe lifts (-3, 0 net) |
| `app/effects.ts` | 98 | `edge/prefs.ts namePref`: fidice needs a local-then-session `fallbackStore` (+15 shared, -9 fidice) | stays (one consumer) |
| `net/peerjs.ts` deferredPeer 67-71 | 5 | `edge/peer.ts whenTransportReady` 111-121: same body | fold (-4) |
| `net/peerjs.ts` describePath | 10 | `announcePath` 0.31: relay-only at 3 s vs direct+relay at 1.5 s, by design | stays |
| `net/{client,host,session,protocol}.ts` | 642 | `web/shared/net/{guest,host}.ts`: a second (N-seat) model; `fidice.sessions.test.ts` 0.015 vs shared harness | stays (seed for N-seat games) |
| `view/**` | 3,340 | 0 ids in common with the shell; glossary links need rules.ts rewritten (~60) + .jargon CSS + 2 goldens | stays until restyle |
| `domain/**`, `bots/**` | 3,349 | rng/Result/json shared already | stays |
| `main.ts` | 85 | browserNetDeps, realClock, `.btn-go` done; no fx.ts (no sound at all) | shared-already |
| `e2e/fidice-online.spec.ts` + `fidice-relay.spec.ts` + `fixtures/fidice.ts` | 55 + 57 + 42 | the two specs to each other 0.69 (30 identical lines); to shell-online 0.24 / shell-relay 0.30 (same shape, other ids) | hoist-now (`ONLINE_DRIVERS` row; delete both specs) |
| `test/parity/fidice.*` | 2,624 | gin.* (same role) | stays (the protecting oracles) |

### 2I. Tooling and harness

| Path | Lines | Twin and similarity | Verdict |
|---|---|---|---|
| `.github/workflows/ci.yml` unit jobs x3 / e2e jobs x3 | 3x15 / 3x26 | pairwise 0.73 (11 identical) / 0.81 (21 identical) | hoist-now (matrix from `changes` JSON: -82) |
| `tools/parity/computed-styles.ts` | 1,642 | see 2G: SHELL_SELECTORS -41, driveShell -26 | hoist-after bg-table-ux |
| gin `src/stories/boot.ts` | 113 | none (backgammon has `setup(state)` but no catalogue page); 70 generic + 25 gin | hoist-after C3 + bg-table-ux |
| `e2e/gin-stories.spec.ts` + `stories-baselines.yml` | 189 + 53 | none; ~90 generic + ~100 gin FACTS | hoist-after C3 + bg-table-ux |
| `e2e/gin-glossary.spec.ts` / `backgammon-glossary.spec.ts` | 107 / 88 | 0.60, 48 identical lines; hunks = terms/rule ids, open-rules-over-a-table path, gin's 25-line tabs-fit test | hoist-after bg-table-ux (`shell-glossary.spec`) |
| `e2e/fixtures/gin.ts` / `backgammon.ts` | 186 / 269 | 0.15, 23 identical: reveal aliases, `<g>StartLocal`, hostDeals/hostStarts 5/6 | fold (-7, a sed over ~20 specs) after bg-table-ux |
| `tools/games.ts` REGISTRY | 201 | still spelled elsewhere: suites.ts GAME_FOLDERS (5) + 3 e2e sub-rows (12), two-players.ts fidice row, PAGE_ONLY_SPECS (18), eslint GAMES, tsconfig globs, index.html cards, package.json scripts | candidate (derive e2e rows: -13; hooks field deferred) |
| `tools/ci/suites.ts` | 634 | ratchets per game by design | shared (e2e sub-rows fold) |
| `README.md` "Add a game" | 65 | 13 existing files touched today; 8 after rows I1/I5/I7 | candidate (steps 5 and 8 shrink) |
| `tools/parity/gin-dom-parity.ts` + spec | 628 | none (bg has no legacy page; fidice's parity is node-side) | stays |
| `.github/workflows/nightly.yml` | 89 | two replay steps, 2 lines each | stays |

### Totals

| Game | Product lines today | Moves under this plan | Stays | Harness lines that move |
|---|---|---|---|---|
| gin-rummy | 10,144 | ~586 (table UI 300, engine/decoders 50, styles+markup net 148, stories boot 88) | ~9,560 before C2/C3's ~350 | e2e/fixtures ~177, parity/test scaffolding ~57 |
| backgammon | 9,807 | ~786 (table UI 255, engine 56, styles+markup net 475) | ~9,020 before C2/C3's ~360 | e2e/fixtures ~70, test scaffolding ~150 |
| fidice | 8,789 | <= 10 | 8,779 | e2e 112 -> ~50 |
| shared/harness | tokens 35 + base 18 + CONTRACT 128; ci.yml 442; computed-styles 1,642 | +~1,350 shared product/harness, +~400 shared tests; ci.yml -82, computed-styles -67, suites -13 | | |

## 3. The ranked candidates

Ranking inside each group is value / risk: value = per-game lines removed plus what a fourth game no longer writes; risk = behaviour that could change silently (drag feel, goldens, byte pins) and in-flight overlap. Each row names the shared module, its API, what stays in each game, and the suites that catch a regression.

### E. Table-UI kernels

| # | Candidate | Value / risk | Lines saved | Shared module + API sketch | Residue per game | Protecting suites |
|---|---|---|---|---|---|---|
| E1 | Pointer-drag controller | high / medium (drag feel; bg has no drag e2e) | gin -168, bg -135; +130 shared | `web/shared/edge/drag.ts`: `bindDrag<Src, Over>(doc, cfg)` with `cfg = { surfaces: ReadonlyArray<Element>; pick(e): {key: Src; el: Element} \| null; targetAt(p: Point, s): Over \| null; onStart/onOver/onEnd: (s) => Intent; land(s): Rect \| null; motion?: {at, follow, transform}; ghost: {sizeVar: string; strip: ReadonlyArray<string>} }`; exports `DRAG_THRESHOLD = 8`, `LAND_MS = 180`, `FALLBACK_MS = 60`, `Point`, `Rect`, `startedDrag`, `inside`; `motion` defaults to direct `translate(start, p)` | gin ~90: meldAt/discardAt/grown DROP_GROW/dropIndex/looseCells hit-tests, four DragIntent builders, the `motion` wiring to drag.ts follow/tilt; bg ~50: absOf/sourceOf/destinationOf, `.target, .target-2` hit-test, `pick = '.checker.top' in '.can-move'`, land = origin | gin `dragger.test.ts` 6 (fake rects, stubbed rAF), `drag.test.ts` 6, e2e gin-arrange lean assertion, gin-drag-discard, gin-layoff; bg `board/dragger.test.ts` 5 + a NEW checker-drag case in backgammon-table-ux.spec (press the 8-point's top checker, cross 8px, expect `drop` on the lit 5-point, release, expect the move); new shared `drag.test.ts` ~150 lines |
| E2 | Motion kernel (glide + launch-a-clone) | medium / medium (reduced motion is a behaviour change for gin) | gin -33, bg -60 (of the branch's 181); +35 shared | `web/shared/edge/motion.ts`: `glide(el, from: Rect, to: Rect, {ms, ease})` = transition none -> inverted translate -> forced `rectOf` -> transition on -> transform '' -> `afterTransition(ms+50)` clears; `launchClone(doc, source, from, to, {classes, strip, sizeVar, ms, delay, scale, onDone})` = `cloneInto(body)`, fixed at `from`, `--sizeVar: px(from.width)`, delay set on transition-delay AND animation-delay, forced read, `translate()+scale()`, `afterTransition(ms+delay+60)` removes; `reducedMotion()` read once from matchMedia | gin flip.ts ~25 (cellRect over `.slot`, the before/after Map by data-card, the 0.5px dead zone); bg fly.ts ~120 (departure/arrival, Departed, flightDelays STAGGER_MS 60, before/badged/settling, MAX_LIVE_FLYERS cull, flyMoves) | gin `flip.test.ts` 4, gin-arrange glide asserts, gin-stories 120 PNGs; bg `fly.test.ts` 8 (branch), e2e backgammon-table-ux "a move flies", computed-styles settleBg + 2 goldens; new `motion.test.ts` ~60 over dom.fake + fakeClock |
| E3 | Keyed repaint | high / low | gin -20, bg -6 | move `ensureKeyed(el, key, markup: () => string)` from `shellPaint.ts` to `web/shared/ui/keyed.ts` (5 code lines + its test); gin renames `data-pile-key`/`data-result-key` to `data-key` | gin: the pile label refresh (2 lines after the call), the group loop's `toggleClass('drop')`; bg: `ensureStack` (branch, reconcile-in-place: NOT generalised) | gin render.test.ts 22 (5 attribute assertions rename), bg render.test.ts 21 (22 `data-key` mentions unchanged), shellPaint.test.ts; nothing e2e reads the attributes |
| E4 | `bindButtons` | medium / low | gin -20, bg -6 | `shellPaint.ts`: `bindButtons<I>(doc, dispatch, entries: ReadonlyArray<readonly [id: string, intent: I]>, opts?: {skipDisabled: boolean})` ~8 lines | gin ~13 lines of table, bg ~17 | both render.test.ts bind tests; shellPaint.test.ts +2 cases |
| E5 | Card long-press bind | medium / low | gin -8 | `home.ts bindLongPress`: `press: I \| ((e: Event) => I \| null)` (~3 lines) so gin's bind is `bindLongPress(doc, el, dispatch, { press: (e) => cardIdFrom(e) && {type: 'card/press', cardId}, release, longPress })` | gin: the `card/press`/`card/release`/`hand/mark` reducer cases (they carry the meld rule) | gin render.test.ts bind test, state.test.ts card/press cases, e2e gin-arrange long-press, shared home.test.ts +1 |
| E6 | `paintConnDot` | low / low | gin -5, bg -5 | `shellPaint.ts`: `paintConnDot(doc, id, {connected, hidden})` ~6 lines, once C2's ShellState is the type both read | one call in each `paintOpponent` | both render.test.ts (`connDotClass` exported and tested), e2e shell-resume asserts `SHELL[game].connDot` `on` for both seats (shell-liveness reads the same selector; shell-online/relay carry no connDot assertion) |
| E7 | `shellPage` fake builder | medium / low | gin -30, bg -30; +25 shared | `web/shared/edge/page.fake.ts`: `shellPage(markup, {modes, hiddenModes?, activeSwitchMode?, switchClasses?, submenuClasses?}, declared?, extra?) => FakePage & {modeButtons, submenuButtons}` | gin ~35-40 (pile labels, sandbox queries); bg ~20-25 (`.opp-strip`) | 8 test files call `ginPage(`/`backgammonPage(`; page.fake.test.ts 232 +3 cases |
| E8 | Home residue (SHELL_INTENTS, homeView, fillNameInputs) | medium / low, but same hunks as C2 | gin -30, bg -30; +30 shared | inside C2: `web/shared/ui/home.ts` default `shellIntents` + `homeView(shell, resumeLabel)` reader | gin ~165 (sandbox editor, scorer names, targetInput/localTargetInput); bg ~120 (MATCH_LENGTH_SELECTS/VARIANT_SELECTS, paintOptions, bindOptions, startOptions) | gin home.test.ts 307, bg 228, shared home.test.ts 367, e2e shell-home |
| E9 | Sound: `CueSpec` + `SHELL_CUES` | low / low | -3 each (type) and optionally -4 each (rows) | `web/shared/lib/sound/cues.ts`: `CueSpec` (moved; `cuePlayer.ts` re-exports) and `SHELL_CUES = {tap, yourTurn, win, lose}` spread into each CUES table | the game's 5-6 rows | each game's fx.test.ts (default font plays every row), cuePlayer.test.ts; docs/design/sound-fonts.md §5 gains "the shell's four rows" |
| E10 | Curtain `attrs` + `onReveal(btn)` | low / none | -8 shared, -2 per game | delete `attrs` (curtain.ts 26-27, 40-42) and the Element argument after bg-table-ux | none | curtain.test.ts loses its attrs case; e2e shell-local/handoff |
| E11 | Dice face vocabulary | low / high (needs the Fidice restyle to pick pips) | bg ~-15, fidice ~-10 later | `web/shared/ui/dice.ts`: `DIE_WORDS`, `dieLabel(value, state)`, `dieClasses(value, state)` ~15 lines serving a string builder and a vdom builder | bg states used/dead/picked/theirs/blank; fidice hidden face; both CSS drawings until the restyle | board.test.ts dice cases, fidice view tests, computed-styles goldens (`.die*` are golden selectors) |
| E12 | Shared motion CSS (`.drag-ghost`, `.flyer`) | low / medium (re-opens the shell-CSS decision) | ~-8 per theme | `web/shared/styles/base.css` (or shell.css under G1): `.drag-ghost, .flyer { position: fixed; margin: 0; z-index: 60; pointer-events: none; will-change: transform }` | the shadow/outline per game, `.landing` timing | CONTRACT.md row 60 gains a shared owner; `.drag-ghost` is not a golden selector |

Not modules (recorded in `web/shared/ui/README.md` instead, each measured under 15 shared lines for under 10 saved per game and a legacy-golden re-pin): the cue machine shape (`once(state, key)` + `cuesFor(prev, next, rules[])`), the selection rules (a drag swallows the tap; re-tap deselects; a stale selection drops at `rendered`; `refuse` clears), `paintTitled(doc, ids, text)` for the result sheets. The README row reserving a shared `HandView.ts` ("the only way a hand is drawn") is stale and folds.

### F. Reducer and engine patterns

| # | Candidate | Value / risk | Lines saved | Shared module + API sketch | Residue per game | Protecting suites |
|---|---|---|---|---|---|---|
| F1 | Two-seat primitives + `TwoSeatEngine` contract | high (what C2's `cfg.engine`, the replay harness and the codecs type against) / low (type-only + 4 helper lines) | net 0 per game (re-exports keep every import path), one definition; +40 shared | `web/shared/lib/game.ts`: `Seat = 0 \| 1`, `Pair<T>`, `Player`, `Now`, `RuleError = string`, `SEATS`, `otherSeat`, `setAt`; decoders `seat`, `count`, `timestamp`; `TwoSeatEngine<S, V, A, Opts> = Readonly<{ create(players: Pair<Player>, opts: Opts, rng, now): S; apply(s, seat, a, rng, now): Result<S, RuleError>; viewFor(s, seat): V; legalActions(v): A[]; actorOf(s): Seat \| null; over(v): boolean; decodeState; decodeView; decodeAction }>` | gin: a 3-line `create` adapter over `createGame({players, target, dealer}, rng, now)` and a NEW `actorOf` (~3 lines, today `test/parity/gin.policy.ts:8` `actor`); bg: already matches | tsc; gin.codecs/gin.legacy (29), bg decode/view/apply tests; a new `actorOf` test (the legacy has no oracle for it); `game.test.ts` ~40 lines for the helpers and decoders at lib's 100/100/100/100 |
| F2 | `pair` + `taggedUnion` decoders | high / medium (byte pins on error text and key order) | gin decodeAction 45 -> ~28 and 14 primitive lines out; bg 20 -> ~8 and 14 out; protocol.ts ~25 -> ~12; prefs.ts ~35 -> ~25; net ~-50, +15 in json.ts | `web/shared/lib/json.ts`: `pair<T>(item: Decoder<T>): Decoder<readonly [T, T]>` (error text `array of 2` unchanged) and `taggedUnion<K extends string>(field: K, cases: Record<string, Decoder>)`: runs `object({[field]: literal(...keys)})` over the input, then the case decoder over the SAME input and returns its result unchanged (no merge, no re-spread) | gin ACTION_TYPES + 4 case decoders; bg moveAction/plainAction + board refinements + phaseAgrees | gin decode.test.ts 10 (`$: expected array of 2`, `$.type: expected one of "ready" \| ...`), gin.codecs.test.ts (12 games x both legs, 39 wire frames, 4 saves, 9 action frames), gin.protocol.test.ts (13 fixtures), gin.storage.test.ts (17 captures), bg decode/protocol goldens, prefs.test.ts 274, shared protocol.test.ts 261, json.test.ts 427 (+30) |
| F3 | Seeded replay harness | high (5 drivers, both games' nightly) / low (test-only; rng order is the one trap) | ~130 lines collapse into ~90 shared: bg replay.test.ts -60, bg decode.test.ts `trace` -18..24, gin.codecs -25, gin.replay.ts -20, bg apply.test.ts -9..17 | `test/shared/replay.ts`: `driveGame<S, V, A>(engine: TwoSeatEngine<S, V, A, _>, { seed, start(rng, now): S, policy(view, pick, legal): A, stepCap, over(s), onStep?({before, after, view, actor, action, rngCalls, step}) }) => {state, steps, done}`; `seeds(from, count)`, `countingRng(inner)`, `replayScale(envVar, defaultGames) => {games, share(base), timeoutMs}`, `byteStable(value, decode)`, `roundTrips(label, decode, value)`, `shard(n, of, games)`. Dice from `mulberry32(seed)`, picks from `mulberry32(seed * 7919)`, the policy called once per step before apply: today's order, kept | bg: `checkStep` invariants (~150) + `choose` (17); gin: the two-leg legacy compare `masked`/`expectSame`/`replay` (~200) + gin.policy.ts | the replays themselves (400 gin games / 91 bg matches per push, 1000 nightly): gin's legacy leg is an independent oracle for rng order, bg's invariant #10 pins rng reads per action; a coin-game self-test (~60 lines) under `web/shared/example/coin` (test-partition.md §4 reserves it) |
| F4 | Engine-test scaffolding | medium / none (tests only) | ~80 lines across ~14 files (4-9 each) + ~50 inside bg | `test/shared/engine-helpers.ts`: `viaJson`, `failureOf(r)`, `must(r)`, `countingRng`, `TWO_PLAYERS`, `NOW`/`now`, `runIntents(reduce, ctx)(app, ...intents)` (gin and bg state.test.ts open with the same 8 lines); bg-only `web/games/backgammon/src/engine/test-helpers.ts`: `scripted(...dice)`, `pos(text)`, `mv(seat, text)`, `START` | none | the tests still passing; suites.test.ts accounting for `test/shared/**` |
| F5 | `position/load {state: unknown}` flow | medium / medium (same state.ts ranges as C2 and bg-table-ux) | bg -16..18; gin +4 (a route) | inside `web/shared/ui/shell.ts` after C2: local-only guard -> `SANDBOX_LOCAL_ONLY_MSG`; `cfg.engine.decodeState` -> `badPositionMsg(formatError)`; `localBroadcast(withShell({game, revealed: actorOf(game) ?? turn}), cfg.table.cleared, initial=true)`; both hooks keep their names via `REGISTRY.hook` (`__backgammon.setup(state)`, `__gin.sandbox(map)`) | gin `sandbox.ts` 392 (parseMap + dealMap, 11 presets, the editor intents ~35, renderSandbox ~50) routes its dealt State through the flow; bg `withPosition`/`parsePosition` stay a test entry point | bg state.test.ts sandboxLoad cases, e2e backgammon-local + backgammon-table-ux (both seats via `setup`), gin sandbox.test.ts 12 + e2e gin-sandbox (console map + `sandboxMap` read-back) |
| F6 | Once-keyed cue memory | low / low | -3..4 per game; +8 shared | inside C2's shell.ts: `CueMemory = {key: string \| null}`, `fresh(mem, key) => {mem, fresh: boolean}`; the derivations (gin nextCue/oppDrawCue 53, bg cuesBetween block 92: 0 shared lines) stay as each game's `cfg.table.rendered` body | everything but the 3-4 lines | cues.test.ts 10, test/parity/gin.ui.test.ts (legacy playCuesFor golden), bg state.test.ts cuesBetween/hitToast cases (+`rolledBetween` on the branch) |
| F7 | `undo` / `canUndo` contract row | none (0 lines) | 0 | a README row: `View.canUndo` + one `undo` action type; gin `undoDraw` 20 lines over a 6-field snapshot, bg `undo` 4 lines over `turnStart` | all | apply.test.ts, gin.legacy.test.ts |
| F8 | `appendLog` | rejected | 0 | three log shapes differ in every key but `text` (gin has no log array; bg `{seat,kind,text,at}` + `lastAction = last`; fidice `{text,big,at\|null}` + `slice(-LOG_LIMIT)`): more config than the 12+8 lines it replaces; bg's key order is pinned by `test/fixtures/backgammon-wire/state.json` | all | decode.test.ts (7 byte-stable states), replay invariant #7 |
| F9 | `passPhoneTitle(name)` | rejected (1 line) | 0 | at most a 1-line helper in curtain.ts if C2 wants it in `cfg.copy` | curtainText per game (gin 13 over State, bg 54 over View) | local.test.ts x2, e2e shell-local/shell-handoff |

### G. Styles and markup

| # | Candidate | Value / risk | Lines saved | Shared module + API sketch | Residue per game | Protecting suites |
|---|---|---|---|---|---|---|
| G1 | `shell.css`, token-only (computed values preserved) | high (a fourth theme = 20 token lines + table rules) / low IF token-only (0 golden diffs, 0 PNG re-records); the 36 type-scale differences are NOT taken | gin 77 shell lines out, ~25 override lines back; bg 637 out, ~250 Prettier lines back; +350-420 shared | `web/shared/styles/shell.css`: the 68 common selectors with the 201 identical declarations plus the 58 palette/radius/font-family differences behind ~7 tokens declared in `tokens.css` with gin's values (`--fill`, `--radius-control`, `--font-body`, `--font-display`, `--ink-on-fill`, `--surface-shell`, `--shadow-shell`) and overridden in backgammon's `:root`; linked after base.css and before each theme; fidice does NOT link it | gin: 135 override decls (77 with tokens), `.btn-gold`, two `.btn-go` hover/focus variants, `.divider*` deleted; bg: 222 decls (164 with tokens): the panel look, `body::before` trim, its 43 own selectors (`.centered .left .tight .between .field .masthead .sr-only #toast.hit .overlay.curtain`) | 4 gin+bg computed-style goldens (a preserving move = 0 differences, N notes absorbed by one re-record), 120 story PNGs (0), tokens.test.ts (SHARED list grows; gin still declares only its 4 layout tokens), class-contract, the 3 widened stylesheet-count assertions |
| G2 | Shell markup generator with the composed page committed | high (~121 gin + ~148 bg shell lines become ~25 slot strings each) / low (byte-identical first commit; zero harness edits) | gin index.html 381 -> ~300, bg 584 -> ~440; +150 templates, +80 generator, +40 drift test | `tools/shell-markup.ts` renders `web/shared/markup/shell/{home,waiting,curtain,sheets,toast}.html` with ~14 copy slots (titles, Host/Open a table, Join/Sit down, Deal the first hand/Start the match, mode labels) + 3 free-form blocks per game (options, extra panels, extra tabs) from a `page.ts` beside `main.ts` (or `REGISTRY.shell`) into the committed `web/games/<g>/index.html`; gin's 36 shell inline styles emitted verbatim; a drift test in the `backgammon-grid.test.ts` idiom asserts `render(slots) === committed file` and `SHELL_IDS === the templates' id set` | gin: table 37, endgame 24, four sheets 46, scorer 64, sandbox help 22, head 19, own options ~35 (225); bg: table 258, endgame 17, six sheets 68, head 28, selects ~50 (386) | shell-ids.test.ts, dist-parity pageShape, class-contract markupClasses (floor 40), the 9 `?raw` page-fake suites, gin-dom-parity (#homeScreen/#curtainOverlay outerHTML, 23 inline styles): all unchanged because dist stays static |
| G3 | CONTRACT.md reshaping | medium / low | ~-8 rows | one Shared (shell.css) section: the two `jargon rule-flash` rows and two `on off` rows fold to 2 shared rows, the 3 painter rows (`fixed-screen pulse`, `force-open`, `pulse muted centered left`) to 1-2; a second token table for the shell tokens (3 override columns); the orphaned `--go/--go-text` rows (lines 3-4) into the Tokens table; `classes.ts` gains a `shell` owner scope (= SHELL_GAMES) because `shared` is checked against fidice's CSS too | per-game sections keep table classes | test/dist/class-contract.test.ts (every row checked against the tree both ways) |
| G4 | Stylesheet-count assertions | required by G1 / none | 3 assertions widened | dist-parity.test.ts 97-102 and 156-160, class-contract.test.ts 60-63: allow a shell-games-only shared sheet between the common chunk (`roomCode-*.css`) and the theme; CONTRACT.md's CSS-source sentence (18-20) follows | | dist-parity, class-contract |
| G5 | Value unification (36 type-scale decls; fidice links shell.css; its 30 shell-vocab selectors) | design decision | later | with the Fidice restyle: THE one re-record of all 6 goldens + 120 PNGs | | everything |

### H. Fidice minimal adoptions (no restyle, no session-model change)

| # | Candidate | Value / risk | Lines saved | Shared module + API sketch | Residue | Protecting suites |
|---|---|---|---|---|---|---|
| H1 | Fold fidice-online/relay into the shell online specs | high (three games on one online/relay spec set; the hermetic relay-hook test covers fidice for free) / low | -112 specs, +30 row, +14 fixture; net ~-60 | `e2e/fixtures/online-games.ts`: `ONLINE_DRIVERS: Record<Game, OnlineDriver>` = today's `SHELL_DRIVERS` rows (shell-games.ts 146 renamed) + a fidice row: `start` = host `#btnStart` -> both `#screen-game`; `expectOpening` = 'Round 1' + same `.seat.holder` data-seat; `expectNames` = seat `.nm` with '(you)' (shell games: `#oppName`); `relayToast: 'guest'` (shell: 'both'); shell-online/relay loop over `GAMES`; `fixtures/fidice.ts` gains `fidiceStartSameRound` | fidice's own specs deleted; suites.ts fidice e2e row: tag `@fidice`, files `[...ONLINE_SPECS]`; gin/bg otherTags gain `@fidice` | the carried assertions; e2e-fidice + broker jobs run before merge; nightly's tag grep unchanged |
| H2 | `whenTransportReady` in deferredPeer | low / none (byte-equivalent: `ice.load()` never rejects) | -4 | `peerjs.ts` 67-71 -> `whenTransportReady(deps, create)` | | fidice.sessions.test.ts 6 differential scenarios (ice null/stun/relay), net/peerjs.test.ts 38 |
| H3 | `validateCode('fidice', code)` at controller.ts 418-422 | low / low (NOT `sanitiseCode`: it would strip I/L/O/0/1) | -3 | already exported `FIDICE_CODE_LENGTH_ERROR` | | controller.test.ts :485 |
| H4 | `normaliseName(raw, {max, fallback})` | low / low (0 net lines; one home for 16/'Player') | 0 net, +8 shared | `web/shared/lib/name.ts` + table test; 6 fidice sites; gin/bg cut at NAME_MAX 20 in `prefs.namePref` could adopt it too | | controller.test.ts :337, fidice.legacy 'lobby' (cleanName), fidice.sessions (protocol name cut) |
| H5 | `fallbackStore(local, session)` for `fidice-name` | rejected today (+15 shared, -9 fidice, one consumer) | net +6 | `web/shared/edge/storage.ts` reproducing effects.test.ts's local-then-session semantics; adopt at a second consumer | | effects.test.ts 216 |
| H6 | Toast queue, `shareText`, `announcePath`, `GuestSession`, glossary links, `blocksCodeInput`, sound | rejected: each changes pinned behaviour (controller.test :553, fidice-relay.spec :29-30, the sessions oracle's event trace) or is a feature (fidice has no sound) | 0 | product decisions for the restyle (design §4.6, risk 12) | | |

### I. Tooling

| # | Candidate | Value / risk | Lines saved | Shared module + API sketch | Residue | Protecting suites |
|---|---|---|---|---|---|---|
| I1 | ci.yml matrix jobs | high (a fourth game edits ci.yml nowhere; today 5 places) / low | -82 (442 -> ~360) | one `game` job and one `e2e-game` job with `strategy.matrix.suite: ${{ fromJSON(needs.changes.outputs.games) }}` / `.e2e-games`; `tools/ci/affected.ts --github` emits the affected suite lists as JSON beside today's booleans; `if: needs.changes.outputs.games != '[]'`; `run: npm run test:${{ matrix.suite }} -- --coverage`; artifact `playwright-report-${{ matrix.suite }}`; ci-ok needs 6 -> 2; broker's 3-way `if` -> one list check | nightly.yml's two replay steps stay | suites.test.ts pin becomes "the matrix source lists SUITE_NAMES / E2E_SUITES" (~15 lines); affected.test.ts (131) gains the JSON case; ci-ok must stay green on an empty (skipped) matrix |
| I2 | Computed-styles D2: `SHELL_SELECTORS` + `driveShell` | medium / medium (goldens key on screen name + selector order: land right after bg-table-ux or all four shell goldens re-record twice) | -67 (SELECTORS -41, drivers -26) | `SHELL_SELECTORS` (43) spliced `[...SHELL_SELECTORS, ...own]` for gin and bg; `driveShell(page, shot, game)` ~30 lines: waitForFunction on `REGISTRY[game].hook`, `#homeScreen`, tab tour over `SHELL[game].tabs` via `tabButtonId`, the hosting block + cancel, local mode switch, `#p1/#p2`, `SHELL[game].localFields`, `#localBtn`, `#curtainOverlay`; `shot` is a parameter so gin's 'home: play tab with the submenu' and bg's `snap` (settleBg) wrapper survive as per-game hooks | driveFidice and fidice's 179 selectors untouched | e2e/computed-styles.spec.ts (6 goldens), the tool's `--check` |
| I3 | Stories harness | medium (a backgammon catalogue then costs ~90 lines instead of ~300) / medium (depends on C1 App shape + C2/C3 signatures + bg-table-ux's render.ts) | gin boot.ts 113 -> ~25; gin-stories.spec 189 -> ~100; +70 +90 shared | `web/shared/ui/stories.ts`: `bootStories<App, Intent, Effect>(doc, deps: {stories, storyById, paint(doc, app), bindAll(doc, dispatch), reduce(app, intent, ctx), ctx, runEffect(effect, dispatch)}, ids: {id, nav, live, title})` = indexHtml 15, navHtml 11, href/LINK 4, bindLive 32, bootStory 10; `e2e/fixtures/stories.ts`: `storiesSpec({game, stories, viewports, readFacts(page), expectFacts(facts, story), geometry?(page, story)})` = VIEWPORTS loop, `?story=` open, sameHandAs pixel stability, `toHaveScreenshot` with the missing-baseline failure, body vs #app for open sheets; `stories-baselines.yml` gains a `spec` input (+3) | gin: catalogue + the 60-line FACTS script, expectHandRows, tallHand, `paint: (d, a) => paint(d, a, slotHandView)`; bg: a future positions catalogue beside the engine | catalogue.test.ts 536, gin-stories.spec, the 120 PNGs (paint untouched, so unchanged); new `stories.test.ts` over dom.fake |
| I4 | `shell-glossary.spec.ts` | medium / low (written against the post-bg-table-ux flow) | -85 (195 -> ~70 + 2x20 rows) | over `SHELL_GAMES`, reading a `glossary` field on the shell-games.ts row: `{aboutTerm, aboutRule, innerFrom, innerTo, deepLink, openRulesOverTable(page)}`; gin's 25-line four-tabs-fit test moves to shell-home.spec parametrised on `shell.tabs.length` | the terms/rule ids per game; bg's `openRulesOverTable` = reveal -> `#rollOverlay` -> `#rollModalBtn` -> `#menuBtn` -> `#menuRulesBtn` | every carried assertion; shared ui/glossary.test.ts 136, edge/glossary.test.ts 109 |
| I5 | Fixture residue: reveal aliases + `hostStarts` | low / low (a sed over ~20 spec imports) | -7 | `ginReveal`/`bgReveal` -> shell.ts `reveal`; `hostStarts(host, guest)` in shell.ts with bg's two curtain-hidden asserts in its ShellDriver row | `<g>StartLocal` (each adds a game assertion) and every table helper | every spec that imports them |
| I6 | REGISTRY-derived e2e rows + GAME_FOLDERS fold | low / low | -13 | `suites.ts gameE2e(game)` derives `files` (`['**/<folder>-*.spec.ts', ...(shell ? ONLINE_SPECS : [])]`), tag `@${game}`, otherTags from SHELL_GAMES; key game suites by `Game` or hold `SUITE_OF: Record<Game, Suite>` once | eslint GAMES, tsconfig globs, index.html cards, package.json scripts (JS/JSON or guarded) | tools/games.test.ts 152 (toEqual pins), suites.test.ts |
| I7 | `PAGE_ONLY_SPECS` -> `pageOnly()` self-declare | optional | -20 config, +18 one-liners | computed-styles.spec and gin-dom-parity.spec already self-skip: one idiom | | playwright.config.ts |
| I8 | `hooks?: {view, setup}` on REGISTRY | deferred (+6 for 0 saved; one call site each) | 0 | record the shape in shared-shell.md §6.1; add at a third consumer (I3's stories boot is the candidate) | | |
| I9 | README "Add a game" | follows I1/I6/H1 | steps 5 and 8 lose their ci.yml and two-players sentences; 13 existing files -> 8 (roomCode.ts, games.ts, suites.ts, eslint GAMES, tsconfig.node.json, web/index.html, computed-styles.ts, online-games.ts) + CONTRACT.md rows | | | |

## 4. What stays game-specific by necessity

The test for "necessity" was the measurement: a twin ratio under 0.2 with a legacy or golden pin on at least one side, or a shape whose shared form is under 15 lines and saves under 10 per game. Everything below meets it.

### Gin (~9,200 product lines after this plan; ~8,000 of it in this list)

| Area | Lines | Why it stays |
|---|---|---|
| Engine rules `engine/game.ts` + cards/melds/layoff | 666 + 547 | The rules of gin. Pinned line-for-line against the legacy (`gin.legacy.test.ts` 29 tests both legs, 400 replays per push). |
| `engine/view.ts` redaction | 147 | Gin hides the other hand; backgammon hides nothing (0.07). Only the signature is the contract. |
| `sandbox.ts` map language + 11 presets | 392 | A text position language for cards; bg's `parsePosition` is another language for another board (0 shared lines). Only the entry point unifies (F5). |
| `scorer/**` | 948 | A Score Counter for a game played with real cards; legacy-pinned (`gin.scorer.test.ts` 259). No other game has one. |
| Table reducer residue (`ui/state.ts` after C2) | ~540 | The interaction memory of a card game: Table type 46, tableIntent 297, canDropDiscard/fitsMeld, undoDraw over a 6-field snapshot; tableIntent vs bg 0.18. This is the floor. |
| Hand picture: `picture.ts`, `arrange.ts`, `draw.ts`, `SlotHandView.ts`, `HandView.ts`, `meldGroups.ts` | 493 | Eleven fixed cells, five settle rules, hand-made melds, the ghost draw slot; `rowsOf` mirrors CSS dense auto-placement while bg's layout.ts mirrors named grid areas (0.05). |
| `hand/drag.ts` momentum/lean | 67 | The owner asked for the lean; bg follows directly. Plugs into E1 as `motion`. |
| `cards.ts` faces | 45 | Byte-pinned against the legacy corpus (`test/parity/gin.ui.test.ts`). |
| `cues.ts` | 179 | statusFor/nextCue are legacy goldens (playCuesFor); the cue machine vs bg's `cuesBetween` 5/62. |
| Table painters in `render.ts` | ~556 | Cards, slots, melds, the result sheet with its layOut animation, the meld chooser: nothing another game draws (paint sections 0.07-0.19 vs bg). |
| Copy: `about/glossary/rules`, curtain text, sound rows | 117 + 13 + 20 | Copy; the mechanisms (`linkJargon`, `rulesListHtml`, curtain painter, cue player) are shared already. |
| Table CSS + extensions + 4 layout tokens | 217 | `#tableScreen` clamp() geometry, the hand grid, card backs, scorer, voice FAB, sandbox editor; pinned by gin-geometry and 120 story PNGs. |
| Own markup: table, endgame, 4 sheets, scorer screens, sandbox help | 225 | 89 own ids. |
| Legacy-oracle adapters `test/parity/gin.{api,fixtures,layoffs,legacy.test}` | 1,393 | Backgammon has no legacy leg; fidice's is another bundle shape. |

### Backgammon (~8,650 after this plan; ~7,900 in this list)

| Area | Lines | Why it stays |
|---|---|---|
| Engine `apply.ts` + notation/setup/score/board/moves/variants | 381 + 1,015 | The rules of two backgammon variants; `replay.test.ts` 91 matches with 10 invariants; `state.json` wire golden pins key order (so `LogEntry` stays too). |
| `engine/view.ts` | 83 | Contract signature only. |
| Table reducer residue (after C2) | ~470 (+90 on bg-table-ux) | Place + picked die + pending chains, `settled`, taps 119, rolling/tumble on the branch; tableIntent vs gin 0.18. |
| `ui/board.ts` builders + tap model | 714 | sourcesOf/effectiveSelection/chainsFrom/targetsOf: every legality rule is the engine's; the dice model's states (used/dead/picked) are backgammon's (dice vs fidice 1/22). |
| `ui/board/layout.ts` | 265 | Pure twin of theme.css's two `grid-template-areas`; the geometry oracle (`backgammon-grid.test.ts`). |
| `ui/board/fly.ts` residue | ~120 | Departure/arrival, stagger, settling badge, the flyer cull: one stack's choreography. |
| `cuesBetween` block, `local.ts` copy (lastTurnText/buttonFor), `about/glossary/rules` | 91 + 54 + 175 | Stateless view diff vs gin's state machine; copy per variant. |
| Table painters in `render.ts` | ~440 (+~70 branch) | Seat, highlights/marks, dice, cube, result, `ensureStack` (a reconcile-in-place with its own contract: not generalised). |
| Table CSS + 17 own tokens | 1,111 (1,211 branch) + 38 | 24 point areas, pips, cube, flights, roll modal; re-recorded by bg-table-ux. |
| Own markup | 386 | table 258 (24 points x 8 Prettier lines), 6 sheets, head, selects. |
| Shell CSS override residue after G1 | ~250 Prettier lines (164 decls with tokens) | The panel look, the trim, 43 own selectors: a design, not a duplication. |

### Fidice (8,779 after this plan; effectively all of it)

| Area | Lines | Why it stays |
|---|---|---|
| `domain/**`, `bots/**` | 3,349 | N-seat rules and computers; already on shared rng/Result/json. |
| `app/controller.ts`, `app/effects.ts` | 686 + 98 | A mutable class + vdom re-render, not a reducer; toast queue with dedupe is a documented departure (`controller.test.ts:553`); design §4.6 keeps it separate until the restyle. |
| `net/**` | 642 + 162 | The N-seat host is the seed for any game with more than two seats; the sessions oracle (970 lines) fails on any wire/timing/copy change by design. |
| `view/**` | 3,340 | vdom screens with 0 ids in common with the shell; glossary links need a rewrite of `rules.ts` (212) plus 2 golden re-records: the restyle's. |
| `theme.css` | 358 | Must NOT link shell.css (14 selector + 13 class-word collisions would leak `.btn-primary{width:100%}`, `.badge`, `.row`, `.chip`). |

### Shared-by-shape, not by module (README paragraphs in `web/shared/ui/README.md`)

The cue machine (`once` + prev/next diff + role gating), the three selection rules, the `View.canUndo` + `undo` contract row, the `Pass the phone to ${name}` title, `paintTitled`, the log shapes, the `TwoSeatEngine` field names the shell reads (`isMyTurn`, `me.idx`, `canUndo`). Each measured under 15 shared lines for under 10 saved per game, and the gin side would re-pin a legacy golden.

## 5. The PR waves

Rules for every PR, the same as `docs/design/shared-shell.md` §5: a **code move**, not a rewrite (the diff shows the same lines leaving one file and entering another); **thin wrappers** so every import path holds (each game's `types.ts` re-exports `Seat`/`Pair`/`Now`/`Player`; `engine/index.ts` keeps `pair`/`decodeSeat`; `cuePlayer.ts` re-exports `CueSpec`); **bytes and DOM unchanged** (0 golden differences, 0 PNG re-records, byte-pinned codecs still byte-identical, committed markup byte-identical on the generator's first commit); **registration in the same PR** (the suites.ts RULES row, the coverage row, the tsconfig include, the eslint zone rule, the CONTRACT.md row, the README paragraph land with the module); **thresholds never lowered** (coverage ratchets, the markup-class floor 40, the 100/100/100/100 row for `web/shared/lib/**` and `web/shared/ui/**`, 94/90 for `web/shared/edge/**`). Main is unprotected: watch CI, then merge; never `--auto`. Every parallel PR gets its own worktree, and Ari runs `npm ci` in it (never a node_modules symlink).

### Preconditions and in-flight state

- `dry-c2-shared-shell` (C2) sits at main's tip with nothing committed; it will rewrite `ui/state.ts` (kernel), `ui/home.ts` (both games + shared), and add `web/shared/ui/shell.ts`.
- `dry-b3-boot-helpers` (C3) touches `main.ts` x2 and 3-4 lines of `state.ts`.
- `bg-table-ux` (`eaf17d8`, local, 28 files) touches bg `render.ts` +174, `fly.ts` +94, `state.ts` +104/-14, `local.ts`, `board.ts` (4), `theme.css` (294, table-only; predates #75: rebase before landing), `index.html` (+20 inside #board), `fixtures/backgammon.ts`, adds `e2e/backgammon-table-ux.spec.ts` 313, re-records bg's two goldens, edits bg's computed-styles SELECTORS.
- C2 and C3 touch 0 css/html files (measured), so Waves F runs beside them.

### Wave D: now, in parallel with C2/C3 and bg-table-ux (no in-flight file touched)

| PR | Content | Files (worktree boundary) | Parallel with |
|---|---|---|---|
| D1 | E3 `web/shared/ui/keyed.ts` (ensureKeyed moved + test); gin's 3 keyed sites renamed to `data-key`; gin render.test.ts 5 assertions | `web/shared/ui/{keyed,shellPaint}.ts`, gin `src/ui/render.ts` table half + test | every D except D2 (same gin render.ts: serialise D1 -> D2) |
| D2 | E4 `bindButtons` + E5 `bindLongPress` press-as-function; gin bindTable adopts both | `web/shared/ui/{shellPaint,home}.ts` (3 lines of home.ts), gin `render.ts` 693-787 | D3-D11; if C2 has `web/shared/ui/home.ts` open, land E5 behind C2 (3-line rebase) |
| D3 | E7 `shellPage` in `web/shared/edge/page.fake.ts`; both game page.fake.ts adopt | `web/shared/edge/page.fake.ts` + test, `web/games/*/src/ui/page.fake.ts` | all |
| D4 | E9 `CueSpec` -> `web/shared/lib/sound/cues.ts` (+ optional `SHELL_CUES`); both sound.ts import | `web/shared/lib/sound/`, `edge/cuePlayer.ts`, `web/games/*/src/ui/sound.ts`, sound-fonts.md §5 | all |
| D5 | F1 `web/shared/lib/game.ts` + F2 `pair`/`taggedUnion` in json.ts; both decode.ts, protocol.ts, prefs.ts adopt; gin gains `actorOf`; re-exports keep paths | `web/shared/lib/{game,json,protocol}.ts`, `web/shared/edge/prefs.ts`, `web/games/*/src/engine/{types,decode,game,index}.ts` | all (C2 must type `cfg.engine` against `TwoSeatEngine`: land D5 first) |
| D6 | F3 `test/shared/replay.ts` + coin self-test + F4 `engine-helpers.ts` + bg `engine/test-helpers.ts`; 5 drivers and ~14 test files adopt; suites.ts RULES row for `test/shared/**`; tsconfig.node include | `test/shared/**`, `web/shared/example/coin/**`, `web/games/*/src/engine/*.test.ts`, `test/parity/gin.{replay,codecs.test,policy}.ts`, `tools/ci/suites.ts` (one row) | all except D9/D11 on suites.ts (serialise D9 -> D11 -> D6's row, or fold D6's row into D11) |
| D7 | H1 `e2e/fixtures/online-games.ts` (shell-games.ts renamed + fidice row), shell-online/relay loop over GAMES, delete fidice-online/relay specs, `fidiceStartSameRound`; suites.ts fidice e2e row | `e2e/fixtures/{online-games,fidice}.ts`, `e2e/shell-{online,relay}.spec.ts`, `tools/ci/suites.ts` (fidice row) | all except D9/D11/D6 on suites.ts |
| D8 | H2 `whenTransportReady`, H3 `validateCode`, H4 `normaliseName` (lib/name.ts + 6 sites) | `web/shared/lib/name.ts`, fidice `net/peerjs.ts`, `app/controller.ts`, `domain/lobby.ts`, `net/{protocol,host}.ts` | all |
| D9 | I1 ci.yml matrix jobs; `affected.ts --github` JSON lists; suites.test.ts pin; affected.test.ts case | `.github/workflows/ci.yml`, `tools/ci/{affected,suites}.ts` + tests | D1-D5, D8, D10 |
| D10 | G3 orphan `--go` rows into the Tokens table; `classes.ts` `shell` owner scope; G4 widen the 3 stylesheet-count assertions (allow, not require); delete gin `.divider*` + its row | `web/shared/styles/CONTRACT.md`, `tools/parity/classes.ts`, `test/dist/{dist-parity,class-contract}.test.ts`, gin `theme.css` (2 lines) | all |
| D11 | I6 REGISTRY-derived e2e rows + GAME_FOLDERS fold; I7 optional `pageOnly()` | `tools/ci/suites.ts`, `tools/games.ts`, `playwright.config.ts`, `e2e/fixtures/site.ts` | after D9 (same suites.ts) |

### Wave E: after bg-table-ux merges (hand/*, board/*, e2e table fixtures)

| PR | Content | Files | Notes |
|---|---|---|---|
| E0 | The backgammon checker-drag e2e case in `backgammon-table-ux.spec.ts` | one spec | precondition for E1; can ride in bg-table-ux itself |
| E1 | `web/shared/edge/drag.ts` kernel + `drag.test.ts` ~150; gin dragger.ts 258 -> ~90 with drag.ts as `motion`; bg dragger.ts 185 -> ~50; constants moved; coverage row for edge held | `web/shared/edge/drag.ts`, gin `hand/{dragger,drag}.ts`, bg `board/dragger.ts` + tests | its own PR (design A6); parallel with E3-E5 (disjoint files) |
| E2 | `web/shared/edge/motion.ts` + `motion.test.ts` ~60; flip.ts -> ~25, fly.ts (181) -> ~120; `reducedMotion()` pinned by a flip.test case over a fake matchMedia | `web/shared/edge/motion.ts`, gin `hand/flip.ts`, bg `board/fly.ts` + tests | after E1 (both import the same dom.ts names; no file overlap, but land E1 first so the kernel tests share the rAF stub) |
| E3 | bg adoption of E3/E4 (2 keyed sites, `button()` -> `bindButtons`) if D1/D2 skipped bg's render.ts | bg `render.ts`, render.test.ts | parallel with E1/E2 |
| E4 | E10 delete curtain `attrs` + `onReveal(btn)`; both local.ts | `web/shared/ui/curtain.ts` + test, `web/games/*/src/ui/local.ts` | parallel |
| E5 | I4 `shell-glossary.spec.ts` (+ `glossary` field on the shell-games row; gin tabs-fit test -> shell-home) and I5 the reveal-alias/hostStarts sed | `e2e/**` | I5 alone in its PR (a sed over ~20 specs); parallel with E1-E4 |

### Wave F: after bg-table-ux's golden re-record; beside C2/C3 (0 css/html overlap)

| PR | Content | Files | Notes |
|---|---|---|---|
| F1 | G1 `web/shared/styles/shell.css` token-only + ~7 tokens in tokens.css (gin's values) + bg `:root` overrides; tokens.test SHARED list; CONTRACT.md Shared section; I2 `SHELL_SELECTORS` + `driveShell`; ONE re-record of the 4 gin+bg goldens (notes + selector order) | `web/shared/styles/**`, `web/games/{gin-rummy,backgammon}/theme.css`, `tools/parity/computed-styles.ts`, `test/fixtures/styles/{gin,backgammon}*.json`, `test/tokens.test.ts` | the only PR in this plan that re-records anything; verify link order tokens+base -> shell -> theme in the built html |
| F2 | G2 `tools/shell-markup.ts` + `web/shared/markup/shell/*.html` + per-game `page.ts` slots; committed `index.html` byte-identical; drift test | `tools/shell-markup.ts`, `web/shared/markup/**`, `web/games/*/index.html` (0 byte change), `web/games/*/page.ts`, `test/dist/shell-markup.test.ts` | parallel with F1 (disjoint); bg-table-ux's #board hunk is outside the shell partial |

### Wave G: after C2 and C3

| PR | Content | Files | Notes |
|---|---|---|---|
| G1 | E6 `paintConnDot` + E8 home residue (`shellIntents`, `homeView`; the fill helpers stay per game as id-list wrappers over the shared `fillInputs`, since `bootShell`'s config takes them as functions) | inside C2 or immediately after: `web/shared/ui/{home,shellPaint}.ts`, both `ui/home.ts`, both `render.ts paintOpponent` | same hunks as C2: fold in, do not run beside |
| G2 | F5 `position/load` flow + F6 cue memory in `web/shared/ui/shell.ts`; bg `sandboxLoad` removed; gin `sandbox/start` routes through it | `web/shared/ui/shell.ts`, both `ui/state.ts` (post-C2, post-bg-table-ux bodies) | C2 rebases on bg-table-ux or adapts `cfg.table.refuse` (`rolling: false`) on merge |
| G3 | I3 `web/shared/ui/stories.ts` + `e2e/fixtures/stories.ts`; gin boot.ts -> ~25, gin-stories.spec -> ~100; `stories-baselines.yml` `spec` input; decide whether `?story=` lives in `bootShell(cfg).stories?` | `web/shared/ui/stories.ts` + test, gin `src/stories/boot.ts`, `e2e/gin-stories.spec.ts`, `e2e/fixtures/stories.ts`, the workflow | after C3 (main.ts) and bg-table-ux (render.ts); 120 PNGs unchanged |
| G4 | I9 README "Add a game" steps 5/8 + shared-shell.md stale figures (16x2 -> 60x2 PNGs, 36 -> 53 ids, 42 -> 43 selectors, 84/58 vs 575/90 -> 77/76 vs 637/113, table slices 626/460 -> 540/470) | docs only | any time after D7/D9/D11 |

### Wave H: with the Fidice restyle (P13)

E11 dice vocabulary, E12 shared motion CSS, G5 value unification (36 type-scale decls; fidice links shell.css; its 30 shell-vocab selectors), H5 `fallbackStore`, fidice glossary links, `.jargon` CSS rows: the one re-record of all 6 goldens and 120 PNGs.

### Parallelism summary

Six worktree-safe boundaries run at once in Wave D: (a) `web/shared/ui/*` + gin `render.ts` [D1->D2 serial], (b) `web/shared/edge/page.fake.ts` + game page fakes [D3], (c) `web/shared/lib/**` + engine `types/decode/game` + prefs [D4, D5], (d) `test/shared/**` + engine tests + parity drivers [D6], (e) `e2e/**` + fidice src [D7, D8], (f) `.github` + `tools/ci` + `tools/games.ts` + `test/dist` + CONTRACT.md [D9 -> D11 -> D10]. `tools/ci/suites.ts` is the one file three PRs want (D6 row, D7 row, D11 fold): serialise them or give D6 and D7 their rows in D11. In Wave E, E1/E2 (edge kernels + hand/board) and E5 (e2e) are disjoint; E2 waits on E1 only for the shared test scaffolding. In Wave F, F1 (css + goldens) and F2 (html + generator) are disjoint.

## 6. Unit-test strategy for the shared modules

Principle: every kernel is tested on the fakes the repo already has (`web/shared/edge/dom.fake.ts`, `page.fake.ts` over the real markup, `fakeClock`, the stubbed `requestAnimationFrame` gin's dragger.test.ts already uses, a fake `matchMedia`), never on a browser; the e2e specs then pin the one thing the fakes cannot (pixels, real transitions, real pointer capture). Each game keeps a slimmer test of its own hit-tests and copy; the kernel's behaviour is proved once. Every new folder gets a coverage row in the same PR, and no existing threshold moves down.

### Kernels on fakes

| Module | Test file (lines) | Fakes | Cases |
|---|---|---|---|
| `edge/drag.ts` | `drag.test.ts` ~150 | page.fake with two surfaces and fake rects, stubbed rAF, fakeClock for LAND_MS/FALLBACK | press under 8px = no session, no ghost; cross 8px = ghost cloned onto body, `strip` classes removed, `--sizeVar` set from the source rect, `capturePointer` called, `onStart` intent dispatched once; move = `targetAt` consulted, `onOver` dispatched only when the target changes; default motion = ghost transform is `translate(start -> p)` exactly; a `motion` plug-in receives `at/follow/transform` in order; end on a target = `onEnd(over)` then `land(s)` rect -> `.landing` class, transform to the landing rect, removed after `afterTransition` (transitionend) or the 60 ms fallback via fakeClock; `land` returning null = removed at once; `releasePointer` throws = swallowed; a second press during landing = ignored; pointercancel = same as end with `over = null` |
| `edge/motion.ts` | `motion.test.ts` ~60 | dom.fake elements with `rectOf` stubbed, fakeClock, fake `matchMedia` | `glide`: transition set to none, inverted translate written, a layout read happens between, transition restored, transform cleared, `afterTransition(ms+50)` clears the inline styles; `launchClone`: clone appended to body, position fixed at `from`, `--sizeVar` px of `from.width`, `delay` written to BOTH transition-delay and animation-delay, `translate()+scale()` when `scale`, `onDone` called and clone removed after `ms+delay+60`; `reducedMotionOf(host)` asks matchMedia once and remembers it; no game consumes it in E2 (gin's flip never honoured the query on main and backgammon's transition is theme.css's, where the query already shortens it: §7 risk 5); gin flip.test.ts pins that the glide stays FLIP_MS under `reduce` |
| `ui/keyed.ts` | `keyed.test.ts` (moved from shellPaint.test) ~30 | dom.fake | same key = markup not called, children untouched; new key = markup written once, `data-key` set; an element that disappears and returns with the same key = repaint |
| `shellPaint.ts bindButtons`, `paintConnDot` | +2 / +2 cases in `shellPaint.test.ts` | page.fake over gin and bg markup | every entry's click dispatches its constant; `skipDisabled: true` skips a disabled button, false does not; a missing id is a listen-time error (as `listenId` today); `paintConnDot` writes `conn-dot on\|off [hidden]` and the Connected/Disconnected title for the four (connected, hidden) combinations |
| `home.ts bindLongPress` press-as-function | +1 case in `home.test.ts` | page.fake | a `press` function returning null dispatches nothing and starts no timer; returning an intent behaves as the constant form |
| `edge/page.fake.ts shellPage` | +3 cases in `page.fake.test.ts` | the real gin and bg `index.html?raw` | the switch and submenu buttons exist for every `mode`; hidden modes carry `hidden`; `activeSwitchMode` carries `active`; `declared` and `extra` queries merge; the returned page still passes `pageFromMarkup`'s own checks |
| `ui/curtain.ts` after E10 | `curtain.test.ts` -1 case | dom.fake | the `attrs` case goes; `bindCurtain(doc, dispatch, onReveal)` calls `onReveal()` with no argument |
| `lib/game.ts` | `game.test.ts` ~40 | none (pure) | `otherSeat`/`setAt`/`SEATS`; `seat`/`count`/`timestamp` decoders accept and reject with the exact error texts the engines' tests already assert; a compile-time check that both engines' surfaces satisfy `TwoSeatEngine` (a typed const per engine); gin `actorOf`: roundOver/gameOver -> first seat not ready, else turn (its own test in gin's engine tests since no legacy oracle exists) |
| `lib/json.ts pair`, `taggedUnion` | +~30 cases in `json.test.ts` | none | `pair`: length 1 and 3 rejected with `array of 2`, item errors carry `$[i]`; `taggedUnion`: unknown tag -> `$.<field>: expected one of "a" \| "b"` in declaration order; the case decoder receives the ORIGINAL input; its result is returned unchanged (key order proved by `JSON.stringify` equality on an object with the tag field not first); a proto key in the field name refused as `record` does |
| `lib/sound/cues.ts` | +1 case in `cuePlayer.test.ts` | none | `CueSpec` is the same type (compile check); `SHELL_CUES` rows match the two games' byte for byte (a golden equality in each fx.test.ts) |
| `lib/name.ts` | `name.test.ts` ~20 | none | table: trims, cuts at `max`, empty -> `fallback`, whitespace-only -> fallback, a 16-char name kept whole, a 17-char cut |
| `ui/stories.ts` | `stories.test.ts` ~80 | dom.fake, a 3-story fake catalogue, a fake reduce that returns the same App for one intent | the index lists every story id and title; a missing id renders the not-found message; nav ends (no prev on the first, no next on the last); live mode repaints only when the App changed (paint call count); `runEffect` receives toast/timer effects, nothing else |

### The shared-integration suite's fake game

`test/shared/replay.ts` and `lib/game.ts` are proved on a **coin game** at `web/shared/example/coin/` (the folder test-partition.md §4 reserves): two seats, `create` deals a target, `apply` accepts `flip` (one rng read) and `pass`, `viewFor` hides the other seat's last flip, `legalActions` returns `[flip, pass]` on your turn, `actorOf` is the turn, `over` when a seat reaches the target, decoders over `taggedUnion('type', {flip, pass})`. Its tests (~60 lines): `driveGame` reaches `done` under `stepCap`; `countingRng` counts exactly one read per `flip` and zero per `pass` (the rng-order pin the two real replays depend on); `seeds(1, 5)` and `shard(2, 4, 100)` partition without overlap; `replayScale` reads the env knob and scales `share`; `byteStable` and `roundTrips` hold for every state and view; the policy is called once per step BEFORE apply (asserted by an ordering log). The coin game is also the fake the shared-shell integration suite (design §5) drives through `bootShell(cfg)`, so C2/C3's `cfg.engine` and this plan's `TwoSeatEngine` are exercised by one fixture.

### Per-game residue tests (each shrinks, none deleted)

- gin `dragger.test.ts` 6 -> ~4 (meldAt/discardAt/grown/dropIndex hit-tests over fake rects; the lean is `drag.test.ts`'s), bg `board/dragger.test.ts` 5 -> ~3 (absOf/sourceOf/destinationOf, the lit-target hit-test). The two are 21% similar today, so neither becomes the kernel's.
- gin `flip.test.ts` 4 + 1 (reduced motion), bg `fly.test.ts` 8 (stagger, settling, cull stay).
- gin `render.test.ts` 22 (5 assertions rename `data-pile-key`/`data-result-key` -> `data-key`), bg `render.test.ts` 21 (unchanged).
- Both `page.fake.test` consumers (8 files) unchanged in behaviour.
- gin/bg `decode.test.ts`: the error-text assertions stay verbatim and now also prove `taggedUnion`.
- Engine test files lose 4-9 scaffolding lines each and import from `test/shared/engine-helpers.ts`.

### Coverage rows for new folders (registered in the same PR)

| Folder / file | Row | Why that floor |
|---|---|---|
| `web/shared/edge/drag.ts`, `motion.ts` | inside `web/shared/edge/**` 94 lines / 90 branches, unchanged | the frame loop, the pointer-capture try/catch and the landing fallback are all reached by the fake-rect test; the ratchet must not be lowered to admit them |
| `web/shared/ui/keyed.ts`, `stories.ts`, `shellPaint.ts` additions | inside `web/shared/ui/**` 100/100/100/100 | small, fully enumerable |
| `web/shared/lib/game.ts`, `json.ts` additions, `sound/cues.ts`, `name.ts` | inside `web/shared/lib/**` 100/100/100/100 | pure; every branch has a table row |
| `web/shared/example/coin/**` | new row 100/100/100/100 | it exists to be exercised |
| `test/shared/**` | a suites.ts RULES row (runs gin + backgammon suites; fidice too if `fidice.legacy.test.ts` adopts `seeds`), tsconfig.node include; no coverage row (test code) | suites.test.ts's "every test file claimed by exactly one suite" accounting |
| `e2e/fixtures/{online-games,stories}.ts`, `e2e/shell-glossary.spec.ts` | `SHELL_SPECS` -> `ONLINE_SPECS` in suites.ts; page-only projects for shell-glossary | tags `@gin @backgammon @fidice` as the fold assigns them |
| `tools/shell-markup.ts` + drift test | `test/dist/shell-markup.test.ts` in the dist suite | runs on every push like backgammon-grid |

## 7. Risks

Ordered by how silently the failure would land.

1. **Drag feel changes without a test failing.** Gin's ghost trails the pointer through a rAF loop (FOLLOW 0.35, TILT_PER_PX 1.2, MAX_TILT 14); backgammon's tracks it directly. `bindDrag`'s `motion` must default to direct follow and gin must pass drag.ts's follow/tilt. Only e2e gin-arrange's "the ghost leans into a fast pull left" (a negative rotate in `.drag-ghost`'s transform) pins the lean; keep it, and add the kernel test's assertion that the default transform is exactly `translate(start -> p)`. `nextFrame` is a no-op on the page fake, so the kernel test needs gin's stubbed rAF.
2. **Backgammon's drag has no e2e today** (0 hits for drag/mouse.down across backgammon-local 9, backgammon-geometry 2, backgammon-table-ux 5). Moving 135 of its 185 lines on five fake-rect tests alone is thin: E0 (one checker-drag case) is a hard precondition for E1.
3. **Byte pins on the decoders.** `pair`'s `array of 2`, `taggedUnion`'s head error text and every case decoder's key order are asserted verbatim by gin decode.test, gin.codecs (39 wire frames, 4 saves, both legs), gin.protocol (13 fixtures), gin.storage (17 captures), bg decode/protocol goldens and prefs.test. The combinator must run the head over the same input and return the case decoder's result unchanged: no merge, no re-spread.
4. **Replay rng order.** Both nightlies (1000 gin games, 1000 bg matches) change every seed's game if `driveGame` reads the dice rng or the policy rng in a different order or count (dice from `mulberry32(seed)`, picks from `mulberry32(seed * 7919)`, policy once per step before apply). Gin's legacy leg and bg's invariant #10 (`rngCalls === 2 per roll, 2*(ties+1) per next`) catch it; the coin self-test pins it before either does.
5. **Reduced motion is a real behaviour change for gin.** Gin honours `prefers-reduced-motion` in one rule (`#rrBody .meld-group`); flip.ts writes its 200 ms transition inline where CSS cannot shorten it. A `reducedMotion()` that passes `ms: 1` is new behaviour the story PNGs (recorded with animations disabled) will not see: pin it in flip.test.ts over a fake matchMedia, and say so in the PR.
6. **Goldens re-key on screen name + selector order.** F1 (shell.css tokens as notes + D2's selector splice) must land right after bg-table-ux, which already re-records bg's two goldens and edits its SELECTORS; otherwise the four shell goldens re-record twice. `driveShell` must keep gin's 'home: play tab with the submenu' shot and bg's settleBg `snap` wrapper as per-game hooks. Only the token-only move is free: any of the 36 type-scale differences taken early re-records 4 goldens + 120 PNGs (linux only, via stories-baselines.yml).
7. **Fidice must not link shell.css** before its restyle: 14 selector and 13 class-word collisions (`.btn-primary{width:100%}`, `.badge`, `.row`, `.chip`) would leak into its lobby and table. The dist-parity/class-contract assertions must ALLOW a shell-games-only sheet, and Rolldown's chunk naming (tokens+base ship as `roomCode-*.css`) means the link order tokens+base -> shell -> theme is verified in the built html, not assumed.
8. **The same state.ts ranges are edited by three branches.** C2 (kernel + shell), C3-adjacent hooks and bg-table-ux (+104/-14: `rolling` in Table and `refuse`, TUMBLE_TIMER in `rendered`, `rollModalOpen`, `board/tap`) all touch 617-795, 1247-1365, 1589-1704 of bg's state.ts. F5/F6 land after both; C2's `cfg.table.refuse` for bg must take the post-bg-table-ux body (`rolling: false`), so C2 rebases on bg-table-ux or adapts on merge. E6/E8 (connDot, home residue) sit on C2's exact hunks: fold in, never beside.
9. **gin `actorOf` is new engine surface** with no legacy oracle (the legacy has no such function). Pin it with its own test; keep `actor` re-exported from gin.policy.ts for the three parity files importing it; add it to `TwoSeatEngine` before C2 types `cfg.engine`, or C2 gains it later.
10. **The markup generator's first commit must be byte-identical**, including gin's 36 shell inline styles (23 of them inside the #homeScreen/#curtainOverlay blocks gin-dom-parity snapshots as outerHTML) and gin's legacy one-line layout (Prettier ignores gin's index.html; a reflow is a noisy diff against legacy/). The drift test proves it on every push. Boot-time builders from SHELL_IDS were rejected: they strip 53 ids and ~30 classes from the built pages and break shell-ids, pageShape, the markup floor and all 9 `?raw` page-fake suites.
11. **Coverage floors are the budget, not the moves.** `web/shared/edge` holds 94/90 and `web/shared/ui`/`lib` 100; a drag.ts with a frame loop, a pointer-capture try/catch and a landing fallback needs its ~150-line fake-rect test to clear the floor, and neither existing dragger test (21% similar to each other, each encoding its game's hit-tests) can be lifted as the kernel's. Budget ~400 lines of new shared tests against ~1,350 shared lines.
12. **ci.yml matrix mechanics.** A job-level `if` cannot read `matrix`, so the lists come from the `changes` job as JSON; ci-ok must stay green when a matrix is empty (skipped job); the broker job's condition re-derives from the same list; suites.test.ts's pin of ci.yml against the table and affected.test.ts change in the same PR.
13. **The fidice e2e fold changes suite tags** (fidice gains `@fidice`; gin/bg otherTags gain it) and the fidice row must carry `relayToast: 'guest'` (relay-only toast at PATH_PROBE_MS 3000, guest side) where shell games toast both sides at 1.5 s. Run `test:e2e:fidice` and the broker job before merging; nightly's tag grep needs no edit.
14. **Legacy pins bound the README-not-module decisions.** gin's `nextCue`/`statusFor` are pinned line-for-line against the legacy playCuesFor/render and `cardHtml` byte-pinned; a shared `once()/cuesFor()` or card/checker builder would re-pin the golden for ~10 lines. Keep the cue machines, selection reducers, dice and result painters as README shapes until a fourth game gives a second real consumer.
15. **`tools/ci/suites.ts` is the one file three Wave-D PRs want** (D6's `test/shared/**` row, D7's fidice e2e row, D11's derived rows). Serialise D9 -> D11 -> D6/D7, or let D11 carry both rows; otherwise the parallel worktrees conflict on the same table.
16. **Design-doc drift.** shared-shell.md is stale in five places this plan measured (16x2/32 story PNGs -> 60x2/120; 36 shell ids -> 53; 42 common selectors -> 43; shell CSS 84/58 vs 575/90 -> 77/76 vs 637/113; table slices 626/460 -> 540/470 + 90 on bg-table-ux); G4 fixes them so the next audit does not re-measure against wrong baselines.
17. **bg-table-ux predates #75**: its theme.css lacks `.btn-go`, `.btn-go:hover`, `--go`, `--go-text`; its shell rules are otherwise identical to main's and its 294-line diff is table-only. The rebase is clean but must happen before F1 or the shell.css move, which assumes #75's rules on both sides.
