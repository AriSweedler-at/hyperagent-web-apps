# The shared shell: audit and plan

Measured on `main` at ca02352 (2026-09-24) with `wc -l`, `diff -u | grep -c '^[-+]'` and python `difflib` (identical-line counts, ratios). Paths are relative to the repo root. "Shell" means everything a player touches that is not the game: home screen, tabs, mode switch, name and code forms, host/guest wait rooms, resume, pass-and-play curtain, leave, toast, sound button, sessions, boot. The four audits this document distils (shell, net-boot, harness, game-specific) and `docs/design/understand.md` §1.3 and §3 (P5-P7) are its inputs; every number below is theirs.

## 1. The owner's ask and the answer

The ask: reuse the menuing code across the games, and make what is left in each game as small as it can be.

1. Gin is 10,568 src lines (45 files, tests excluded). Its shell is ~2,820 lines, 27%; the table 28%, the engine 19%, and gin-only features (sandbox, Score Counter, stories, card back) 23%.
2. Backgammon is 10,059 src lines (30 files). Its shell is ~3,600 lines, 36%; the table 42%, the engine 21%. The shell share is higher because its markup and CSS are Prettier-expanded (by CSS *rules* the shell is 24% of gin and 35% of backgammon).
3. Fidice is 8,758 lines on a different architecture (vdom + Controller, N seats, bots); its shell is ~1,060 lines and shares no line with the other two. It is the odd one out and stays out until its restyle.
4. The two shells are one program copied: sessions 95% identical (164 of ~167 code lines), main.ts 89% of backgammon's file, protocol 77%, fx 78%, home.ts 60%, storage 61%, the shell reducer 47% line-identical after normalising `app.shell.x` to `app.x` (16 of the 36 shell reducer cases are byte-identical, the flows 59-100%).
5. Everything that differs falls into six buckets: the start options (gin `target`, backgammon `matchLength`+`variant`), what a leave/handoff clears, the `rendered`/`refuse` hooks, gin's sandbox and scorer, backgammon's `curtainMode`, and copy.
6. The plan: hoist the sessions, protocol skeleton, storage helpers and cue player now (they touch none of the in-flight backgammon files); hoist the painters and home binder right after bg-online lands; then have gin adopt backgammon's `App = {shell, table}` split and lift the shell reducer, storage and boot behind one `ShellGame` config object.
7. After the plan, backgammon keeps ~6,200 lines (62% of today; ~3,800 lines, 38%, move to `web/shared`), and its NET+BOOT+protocol+storage+fx footprint drops from 1,334 to ~330. Gin keeps ~7,600 (72%), or ~5,160 (49%) once its gin-only features are counted as the extensions they are.
8. A new two-seat game then supplies: an engine, a table reducer slice and table painters, table markup and CSS, a sound table, rules copy, and one `shellConfig.ts` of ~150-200 lines (ids, copy, keys, codecs, engine adapters). It writes no session, protocol envelope, storage plumbing, home screen, wait room, curtain, toast, timer, or boot.
9. Not shared, on purpose: the static shell markup (the DOM-parity oracle snapshots gin's `#homeScreen`), the shell CSS (same 40 selectors, different values; deferred to the Fidice restyle as P13), the engines, the table slices, the e2e table drivers.
10. Every move is protected by suites that already exist and run unchanged against thin wrappers: gin's 87 state tests (51 shell), backgammon's 51 (39 shell), the byte-pinning parity oracles (gin wire, gin storage, gin sessions, gin DOM), backgammon's wire goldens, the computed-style goldens (2 games x 2 viewports), 16 gin story screenshots x 2 platforms, and the e2e shell specs.

## 2. The measured duplication

Identical share = identical lines / lines of the smaller file (difflib), whole file unless a slice is named. "Normalised" means backgammon's `app.shell.x` / `withShell(app, {…})` rewritten to gin's flat `app.x` before diffing. Verdicts: **share-now** (mechanical, byte-pinned on both sides), **share-after** (the two games must first agree on a shape, or an in-flight PR edits the slice), **by-necessity** (the game's own content), **incidental** (duplicated but not worth a module), **shared-already**.

### 2.1 Shell code

| Area | Gin | Backgammon | Fidice | Identical share | Verdict |
|---|---|---|---|---|---|
| Shell reducer slice of `ui/state.ts` | ~1,015-1,100 of 1,726 lines (flat 45-field `App`, one 470-line `reduce` switch) | ~1,093-1,200 of 1,842 (`App = {shell, table}`, `SHELL_INTENT_TYPES` x37, `shellIntent`/`tableIntent`) | `app/controller.ts` ~320 of 686 (mutates `this.ui`, calls sessions directly) | whole file 780/1,726 = 0.437 raw, 839 = 0.470 normalised; the 36 shell cases 111/182 lines, 16 cases byte-identical; flows: `guestContextOf` 100%, `handoffLabel` 100%, `hostContextOf` 96%, `EffectDeps` 96%, `startHost` 94%, `saveFor` 92%, `runEffect` 91%, `Effect` union 84%, `readHome` 72%, `startGuest` 59%, `handoff` 39%; 9/12 message constants byte-identical | share-after (six agreements + PR-D) |
| Home screen `ui/home.ts` | 269 (bindHome 127, sandbox/scorer inputs ~50) | 242 (bindHome 106, selects ~40; 218 on bg-online) | `view/screens/menu.ts` 391 + `app.ts` 105 + `ui.ts` 53 | 162/242 = 0.634; `blocksCodeInput` 89%, `tabButtonId` 88%, `bindHome` 75%, `paintPlayMode` 73%, `paintHome` 67% | share-now |
| Pass-and-play curtain `ui/local.ts` | 49 (`curtainText` 13 from `State`) | 100 (`curtainText` ~48 from `View`, `buttonFor` by phase, `data-rolls`, `curtainHandoffBtn`) | `handoffScreen` ~50 + controller ~35 (cover then confirm, 2,500 ms, opens a Peer) | 25/49 = 0.336; `paintCurtain` 53%, `bindLocal` 56%, `curtainText` 21% | share-now (frame only) |
| `render.ts` shell painters (screen switch, waiting, toast DOM, sound, handoff, sheets) | 141 of 803 | 162 of 753 (`#toast.hit`, Escape in `bindSheets`, rules keyed by variant) | `view/app.ts` rebuilds the tree per `ui.screen` | 95 identical after normalisation; `hideToast`/`bindAll` 100%, `paintWaiting` 92%, `showToast` 92%, `paintScreen` 84%, `paintSound` 72%, `bindSheets` 71%, `paintHandoff` 53% | share-now |
| `main.ts` boot | 490 (scorer 45, stories 10, sandbox/cardBack hooks ~40) | 359 (`view`/`setup` hooks; redeclares `roomCodeMsg`) | 88 (Controller + effects) | 319/359 = 0.752 (89% of bg); code-only 288/308; toast timer, named timers, dispatch, host/guest event adapters, `EffectDeps.net/confirm/scrollTop/share/page`, `?join=` boot line for line | share-now (netDeps, toaster, timers, invite, session events); boot itself share-after P6 |
| `index.html` shell markup | 146 of 375 (53 ids) | 197 of 597 (43 ids) | 25 (bare `#app`) | 36 ids common; 32 identical lines (0.066, formatting differs); copy differs throughout | incidental: keep per game, share the id contract |
| `theme.css` shell rules | 84 lines / 58 rules (literals: 14px, #fef3c7, `var(--card-2)`) | 575 lines / 90 rules (tokens: `var(--radius)`, `var(--bg)`, `var(--accent-dark)`) | 351 lines, own vocabulary (`.panel`, `nav.tabs`, `.opt`) | 18 identical lines; the same ~40 selectors (`.tabbar .tab-* .mode-* .card-box .btn* .overlay .sheet* #toast .code-input .room-code .pulse .rules-list`) agree on layout, disagree on colour/radius/font/shadow | share-after (P13, Fidice restyle) |
| `storage.ts` | 306 (keys `ginRummy*` x10; sort/cardBack/scorerState) | 283 (keys `backgammon*` x10; variant/matchLength/curtain) | `app/effects.ts` 98 (raw strings, session fallback) | 187/283 = 0.638; code-only 143/207; the Store/Decoder plumbing, name/tab/mode/sound/soundFont decoders and read/write pairs, `Save` union and `saveLiteral` identical | share-now (helpers); `readHome`/shellStore share-after with P6; keys by necessity |
| Shell messages and copy | 12 constants in `ui/state.ts` (+ `roomCodeMsg` exported) | 12 (+ `roomCodeMsg` redeclared in `main.ts:56`) | own | 9/12 byte-identical (INVITE_COPIED, NOT_CONNECTED, WAITING_FOR_GUEST, OPPONENT_LEFT, ROOM_FULL, LOST_HOST, DISCONNECTED, joinedMsg, the *_MS); differ: LEAVE_LOCAL ('game/Scores' vs 'match/score'), LEAVE_ONLINE, `hostRoomMsg` | share-now as a copy table the game fills |

### 2.2 Net, boot and their tests

| Area | Gin | Backgammon | Fidice | Identical share | Verdict |
|---|---|---|---|---|---|
| Two-seat sessions `net/host.ts` + `net/guest.ts` | 223 + 208 | 228 + 210 | `net/host.ts` 367 (N seats, bots, tokens, spectators) + `client.ts` 103 + `session.ts` 61 | host 211/223 = 0.936, code-only 164/167 = 0.976 in exactly 4 hunks (`ShippedVariant` import, `target` -> `matchLength`+`variant` in `HostContext`, `peerIdFor('backgammon')`, the `welcome` call); guest 195/208 = 0.933, code 164/165 = 0.994 in 1 hunk (`peerIdFor`); every `*_MS` and message byte-identical; the 36 other differing lines are the two header comments | share-now (P5) |
| `net/peerjs.ts` | 3 (`export * from shared/edge/peer.ts`) | 4 (same) | 162 (`deferredPeer`, `describePath`, own transports) | comment only | shared-already (P1); fidice optional |
| `protocol.ts` | 139 (`welcome(hostName, to)`) | 162 (`welcome(hostName, length, ruleset)`) | `net/protocol.ts` 111 (different envelope, refusal texts pinned by the legacy oracle) | 107/139 = 0.711; code 84/99; WIRE_TAGS, NAME_MAX 20, TOAST_MAX 500, DEFAULT_GUEST_NAME 'Jeff', all frame decoders/builders except welcome/lobby's room payload | share-now (skeleton) |
| `fx.ts` | 65 | 63 | none (no sound) | 51/63 = 0.797; code 45/47 = 0.968; only the `Cue` import path differs | share-now |
| `ui/sound.ts` cue table | 26 (10 events) | 26 (8 events) | none | 11/26; `CueSpec` + the tap/yourTurn/win/lose rows | by necessity (the game's sound design) |
| `net/sessions.test.ts` | 830 | 845 | `test/parity/fidice.sessions.test.ts` 970 (own World) | 806/830 = 0.962; the ~184-line harness (spyTransport, world, hostCtx/guestCtx, cell, party, connectFrom) identical bar `target: 100` -> `matchLength: 5, variant: 'portes'` | share-now with P5 (one harness, run per codec) |
| `ui/page.fake.ts` | 109 | 125 (adds `markupAttrsOf`: data-*, disabled, checked) | `view/render.fake.ts` over `dom.fake.ts` | 80/109 = 0.684; `optionsFromMarkup` 84%, TAG 100%; the id lists 0% | share-now with the painters |
| Boot net deps (`realTransport({ice, search, debug})`, `createIce`, `realClock`, `onWake`) | 14 lines, `debug: 0` | 14, `debug: 0` | 5, `debug: 1`, no `onWake` | line for line | share-now (`browserNetDeps`, 15 lines, all three games) |

### 2.3 Outside the shell but measured on the way

| Area | Gin | Backgammon | Fidice | Identical share | Verdict |
|---|---|---|---|---|---|
| Engine | 1,990 / 9 files | 2,148 / 11 files | `domain/` 1,422 + `bots/` 1,927 | `decode.ts` 52/305 (the json.ts idiom only) | by necessity |
| Table reducer slice | ~626 of `ui/state.ts` | ~460 (`Table`, `tableIntent`, `cuesBetween`) | controller `handle()` ~215 | 6/199 table cases (scaffolding only) | by necessity |
| Table painters and builders | ~1,717 (render 533 + bindTable 84 + cards 45 + cues 179 + `hand/*` 876) | ~1,807 (render 443 + wiring 126 + `board.ts` 673 + `board/*` 565) | `table.ts` 699 + `components.ts` 312 + `vdom.ts` 195 | 136/803 whole `render.ts`, all in imports and the shell section | by necessity |
| Drag controller | `hand/dragger.ts` 258 + `hand/drag.ts` 67 | `board/dragger.ts` 185 | none | 87/258 = 0.39: the Session cell, begin/end/press/move machine, ghost clone, `capturePointer`, LAND_MS 180 + 60, DRAG_THRESHOLD 8 | share-now (its own PR, not the shell) |
| FLIP / flight | `hand/flip.ts` 58 | `board/fly.ts` 115 | none | 17/58: `measurable`, `px`, forced layout read, `afterTransition` | share-now (motion kernel ~20 lines) |
| Keyed repaint, long-press bind, sheets table | `ensurePile` 14, long press 8+14, SHEETS 28 | `ensureKeyed` 6, long press 8+11, SHEETS 27 | vdom diff | long press 22/22 modulo `withShell` | share-now (ride with the shell) |
| Rules / about copy | `ui/rules.ts` 30 | 47 + 19 lines of About prose | `rules.ts` 212 | 5/30 | by necessity |
| Gin-only features | sandbox 392 (+~140 shell hooks), scorer 948 (+~160), stories 998, cardBack/sort 24 = ~2,440 (23%) | `sandbox/load` 15 | none | none | incidental: gin's extensions, modelled as such |
| Already-shared substrate | `web/shared/edge/peer.ts` 198, `lib/invite.ts` 10 + `edge/invite.ts` 17, `lib/roomCode.ts` 115, `edge/share.ts`, `edge/dom.ts` 316, `tools/games.ts` 47 | same | peer types, `peerIdFor`, `randomCode` | called at the same sites in both games | shared-already (P1-P4) |

## 3. What is game-specific by necessity, and what is incidental

### 3.1 By necessity: what each game keeps whatever the plan does

**Gin rummy (~5,160 lines after the plan, plus its 2,440 lines of extensions)**

| What | Lines | Why it stays |
|---|---|---|
| Engine `src/engine/` | 1,990 | The rules of gin |
| Table reducer slice (`card/tap`, `stock/tap`, `discard/tap`, `meld/*`, `arrange/*`, `discards/*`, `card/drag*`, `card/press`, `canDropDiscard`, `fitsMeld`, `rendered` with the cue machine and ghost draw stage, `refuse`) | ~626 | Interaction memory of a card game |
| Table painters and builders (`render.ts` table 533 + `bindTable` 84, `cards.ts` 45, `cues.ts` 179, `hand/*` 876) | ~1,717 | Cards, slots, melds, the hand picture |
| Table markup (`#tableScreen`, endgame, meld, arrange, discards, round result, history) | 126 | No templating in the Vite build |
| Table CSS | 265 lines / 164 rules | Card geometry |
| `curtainText(game, turn)` | 13 | Copy from `State` |
| Start options: `Opts = {target}`, `parseTarget`, `targetInput`/`localTargetInput`, `hostRoomMsg` naming the target | ~20 | The game's own parameter |
| Room payload `object({target: integer(1)})`, `HostSave.target`, `Resume` carrying `target` | ~15 | Wire and save bytes pinned by the legacy corpora |
| `STORAGE_KEYS` (`ginRummyMP_v1`, `ginRummy_*`, `ginRummyScorerState_v2`), `HOME_TABS` play/rules/score | 12 | Two games share one origin; the save key has no separator after the prefix, so a prefix helper would orphan every save |
| Sound table `ui/sound.ts` | 26 | The game's sound design (docs/design/sound-fonts.md §5) |
| Rules copy `ui/rules.ts` | 30 | Pinned against both legacy copies |
| Copy: leave messages, title 'Gin Rummy', hook `__gin`, 'Host a game', 'Deal the first hand' | ~30 | The voice of the page |
| e2e table drivers (`fixtures/gin.ts` table half ~160, `gin-play.ts` 107) | ~270 | Click what a player sees |

**Backgammon (~6,200 lines after the plan)**

| What | Lines | Why it stays |
|---|---|---|
| Engine `src/engine/` | 2,148 | The rules of portes and western |
| Table reducer slice (`Table`, `initialTable`, taps, tray, dice, drag, R14 beat, `cuesBetween`/`hitToastsBetween`/`newMovesBetween`, `sandbox/load`, rematch, `tableIntent`) | ~460 | Interaction memory of a board game |
| Table painters (`render.ts` 443 + wiring 126, `board.ts` 673, `board/{dragger,fly,layout}` 565) | ~1,807 | Points, checkers, dice, cube, flights |
| Table markup (24 `.point` divs, bars, trays, dice, cube, chips, result, resign, menu) | 344 | As gin |
| Table CSS | 1,110 lines / 178 rules | Board geometry, the Greek-key frame |
| `curtainText(view, incoming)` + `lastTurnText` + `buttonFor` (`— roll`, `— play 6-5`, `— answer`, `— look`), `data-rolls` | ~48-55 | Copy by phase from `View`; one tap also rolls |
| Start options: `Opts = {matchLength, variant}`, `parseMatchLength`/`parseVariant`, four selects + `paintOptions` + change listeners | ~40 | The game's own parameters |
| Room payload `object({matchLength: integer(1), variant: literal(...SHIPPED_VARIANTS)})`, `HostSave`, `Resume` | ~15 | Pinned by `test/fixtures/backgammon-wire` |
| `STORAGE_KEYS` (`backgammonMP_v1`, `backgammon_*` incl. variant/matchLength/curtain), `HOME_TABS` play/rules/about, `curtainMode` pref + effect | ~25 | As gin |
| Sound table | 26 | As gin |
| Rules copy (COMMON + PORTES + WESTERN, keyed by variant) + About prose | 47 + 19 | The Sephardic story stays in About (#57) |
| Copy: 'Sheshbesh', `__backgammon`, 'Open a table', 'Sit down at a table', 'Start the match', 'Kapará.' toast class | ~45 | The voice of the page |
| e2e table drivers (`fixtures/backgammon.ts` ~200, `backgammon-geometry.ts` 248 minus the frame helpers) | ~400 | As gin |

**Fidice (all 8,758 lines, until its restyle)**: Controller 686, `menu.ts` 391, `lobby.ts` 193, `table.ts` 699, `spectator.ts` 280, `ladder.ts` 226, N-seat `net/host.ts` 367, `vdom.ts` 195, `theme.css` 351. Its shell does the same jobs in different shapes (five-option menu then one name form; `#join=`/`#watch=` hash invites kept in the bar; 5-char codes; name max 16 with 'Player'; a toast FIFO with dedupe at 2,200 ms; a cover-then-confirm handoff over a live Peer; a lobby with seats instead of two wait screens; no resume). Nothing in it is a lift.

### 3.2 Incidental duplication: the same program twice

| What | Lines duplicated (per game) | Today's difference | After the plan |
|---|---|---|---|
| Two-seat sessions | ~430 (host 223 + guest 208) | 5 code hunks + two rewritten header comments | ~20 + ~15 line wrappers |
| Session test harness | ~750 of 830 | payload swaps | ~50-80 lines of byte-pinning per game |
| Protocol skeleton | ~90 of 139 | the room payload | ~30 (room decoder + re-exports) |
| Storage plumbing | ~140 code lines | prefix, third tab, `HostSave` extra | ~100-120 (keys + own prefs + Save codec) |
| `fx.ts` | 45 of 47 code lines | the `Cue` import | ~8 |
| `main.ts` wiring | ~290 | `app.view` vs `app.shell.view`, `scorer`/`copy` deps, hook names | bg ~60-70, gin ~150-170 |
| Shell reducer flows, cases, effects runner | ~700-800 | the six buckets | gin's `reduce` delegates shell cases; residue = `Opts`, hooks, extensions |
| Home paint + bind | ~160 | extra inputs, third tab, start payload | ~8-line `paintHome` composing shared + own; residue gin ~50, bg ~40 |
| Shell painters | ~95 | `data-card-back`, `#toast.hit`, Escape, SHEETS rows | each game passes its SHEETS list |
| Curtain frame | ~25 | none | `curtainText` only |
| Toast timer + named timers | ~15 | none | `createToaster`/`createTimers` |
| `?join=` boot, share chain, session-event adapters | ~60 | `title` | `applyInviteLink`, `shareInvite`, `sessionEvents` |
| `page.fake.ts` assembly | ~50 | bg's richer attrs | ~12-line id list per game |
| Drag machine, motion kernel, `ensureKeyed`, long press | 87 + 17 + 6 + 22 | intent names, hit-tests | generic controller + kernel, game hit-tests |
| Small drifts a shared module must reconcile | — | bg `DEFAULT_PLAY_MODE` 'local' in `ui/state.ts:254` vs 'online' in `storage.ts`; bg `main.ts:56` redeclares `roomCodeMsg`; bg's static `hostWaitStatus` 'Opening the table…' is painted over by `OPENING_MSG` 'Opening room…'; `guestGoneMsg`/`handoffMsg` live in two files each | one copy table |

## 4. The target architecture

### 4.1 Files

```
web/shared/
  ui/                         new zone: may import shared/lib, shared/edge/dom.ts, shared/edge/clock.ts; never a game
    shell.ts                  reduceShell, ShellState, ShellIntent, ShellEffect, runShellEffect, hostContextOf, guestContextOf, saveFor, readHome
    shellPaint.ts             paintScreen, paintWaiting, showToast/hideToast, paintSound, paintHandoff, paintSheet, bindSheets (re-exports ensureKeyed)
    keyed.ts                  ensureKeyed, the keyed slot both table halves repaint through (out of shellPaint.ts in dry-round-2.md D1)
    home.ts                   paintTabs, paintPlayMode, paintSubmenu, paintResume, bindHomeShell, bindLongPress, fillInputs, setCodeInput, blocksCodeInput, tabButtonId
    curtain.ts                CurtainText, paintCurtain, bindCurtain
    waiting.ts                WaitingView, paintWaiting (split out of shellPaint once the wait screens grow; may start as a re-export)
    toast.ts                  createToaster, createTimers        (the README's reserved toast.ts)
    boot.ts                   bootShell, sessionEvents, applyInviteLink, shareInvite
    ids.ts                    SHELL_IDS (the 36 common ids) + the page test that asserts each game's markup carries them
    shell.test.ts, home.test.ts, shellPaint.test.ts, boot.test.ts   over a FAKE_GAME and dom.fake/page.fake
    README.md                 updated: reservations become files; the cuesBetween shape recorded for a fourth game
  net/                        new zone: may import shared/lib, shared/edge/{transport,clock,peer}.ts; never a game
    host.ts                   HostSession<G, H, X>, HostContext<X>, HostEvents<G>, HostCodec, the *_MS constants and messages
    guest.ts                  GuestSession<G, H>, GuestEvents<H>, GuestCodec
    sessions.harness.ts       spyTransport, world, cell, party, connectFrom, hostCtx, guestCtx
    sessions.test.ts          the 21 tests once, over a fake codec
  lib/protocol.ts             twoSeatProtocol<A, V, R>: the envelope, generic over the room payload  (pure: json.ts + result.ts only)
  edge/prefs.ts               readTextWith, decodeName/PlayMode/SoundState/SoundFont, textPref, namePref, soundPref, shellSave<S, X>
  edge/cuePlayer.ts           createCuePlayer<E>: fx.ts's body with the cue table injected
  edge/netDeps.ts             browserNetDeps({search, debug, onWake})
  edge/page.fake.ts           + pageFromMarkup(markup, declared, extra), modeButtons(prefix, modes, hidden), shellPage(markup, {modes, hiddenModes, activeSwitchMode}, declared, extra, more)
web/games/<g>/src/
  shellConfig.ts              the ShellGame object (~150-200 lines): ids, copy, keys, tabs, opts codec, engine adapters, frames, table hooks
  net/host.ts, net/guest.ts   ~20 + ~15 line wrappers fixing G, H, X and the codec
  protocol.ts                 ~30: the room decoder + re-exports
  storage.ts                  ~100-120: STORAGE_KEYS, HOME_TABS, own prefs, Save codec via shellSave
  fx.ts                       ~8
  ui/state.ts                 the table slice + a `reduce` that delegates shell intents
  ui/render.ts, home.ts, local.ts   table painters + `curtainText` + own controls; `paintHome`/`paint` compose shared and own
  main.ts                     bootShell(config) + the game's hook extras (bg ~60-70, gin ~150-170)
```

`boot.ts` is listed under `ui/` as the task names it; the lint rule `RNG_ALLOWED = ['web/games/*/main.ts', 'web/shared/edge/**']` means it must not call `Math.random`/`Date.now` itself. Either `main.ts` passes `rng`/`now`/`clock` in (shown below) or the file lives at `web/shared/edge/boot.ts`. Decide in the PR that creates it; the API is the same. B3 decided `web/shared/edge/boot.ts`: the three helpers import `edge/invite.ts`, `edge/share.ts`, `edge/fx.ts`'s `WakeLock` and the sessions' event types from `web/shared/net`, all outside the ui zone's contract (`web/shared/lib`, the DOM edge and the clock fake), so the ui folder would have needed four `except` rows and a carve-out from the pure profile for one file; `INVITE_COPIED_MSG`, `roomCodeMsg` and `SHARE_FALLBACK_MS` moved there with the share chain (they were main.ts's alone), and `bootShell` (C3) lands beside them.

### 4.2 The shell reducer (`web/shared/ui/shell.ts`)

Backgammon's `Shell` type with its two option fields folded into a generic `Opts`; gin's intent names throughout (they are already backgammon's).

```ts
import type { Game } from '../lib/roomCode.ts';
import type { Result } from '../lib/result.ts';

export type Role = 'host' | 'guest' | 'local';
export type PlayMode = 'online' | 'local';
export type ScreenId = 'home' | 'hostWait' | 'guestWait' | 'table';

export type Resume<Opts, S, X = never> =
  | Readonly<{ kind: 'host'; code: string; myName: string; opts: Opts; game: S | null; oppName: string | null; handoff: boolean }>
  | Readonly<{ kind: 'guest'; code: string; myName: string }>
  | Readonly<{ kind: 'local'; p1Name: string; p2Name: string; game: S }>
  | X;                                            // gin adds { kind: 'scorer' } here, nobody else sees it

export type ShellState<Opts, S, V, Tab extends string, X = never> = Readonly<{
  role: Role | null; code: string | null; myName: string; opts: Opts;
  game: S | null; view: V | null; oppName: string | null; oppConnected: boolean;
  nameTouched: boolean; revealed: boolean;
  homeTab: Tab; playMode: PlayMode; p1Name: string; p2Name: string; savedName: string | null;
  screen: ScreenId; netAttempt: number; hostStatus: string; guestStatus: string; startGameVisible: boolean;
  handoff: boolean; resume: Resume<Opts, S, X> | null;
  rulesOpen: boolean; submenuOpen: boolean; longPressed: boolean; codeDraft: string;
  soundFont: SoundFontName;
}>;

export type ShellIntent<Opts, HF, GF, Tab extends string> =
  | { type: 'home/init'; snapshot: HomeSnapshot<Opts, unknown> }
  | { type: 'name/typed' | 'p1name/typed' | 'p2name/typed' | 'code/typed'; value: string }
  | { type: 'tab/set'; tab: Tab } | { type: 'tab/playClick' }
  | { type: 'mode/set'; mode: PlayMode }
  | { type: 'opts/set'; raw: Readonly<Record<string, string>> }        // replaces variant/set + matchLength/set; the game decodes
  | { type: 'host/click'; opts: Readonly<Record<string, string>> }     // raw select/input values, parsed by cfg.opts.parse
  | { type: 'local/click'; opts: Readonly<Record<string, string>> }
  | { type: 'join/click' } | { type: 'join/link'; code: string } | { type: 'share/click' }
  | { type: 'cancel' } | { type: 'cancel/finish' }
  | { type: 'submenu/press' | 'submenu/release' | 'submenu/longPress' | 'submenu/dismiss' } | { type: 'submenu/pick'; mode: PlayMode }
  | { type: 'host/start' } | { type: 'host/status'; text: string } | { type: 'host/frame'; frame: GF } | { type: 'host/guestGone' } | { type: 'host/deal' }
  | { type: 'guest/start' } | { type: 'guest/status'; text: string } | { type: 'guest/connected' } | { type: 'guest/frame'; frame: HF } | { type: 'guest/lost' }
  | { type: 'leave/request' } | { type: 'leave/confirmed' } | { type: 'leave/finish' }
  | { type: 'curtain/reveal' } | { type: 'handoff/click' } | { type: 'resume/click' }
  | { type: 'sound/toggle' } | { type: 'soundFont/set'; font: SoundFontName }
  | { type: 'screen/show'; screen: ScreenId } | { type: 'visible' } | { type: 'rendered' } | { type: 'persist' };

export type ShellEffect<Opts, HF, GF, Tab extends string> =
  | { type: 'persist' } | { type: 'clearSave' } | { type: 'saveLocal' }
  | { type: 'rememberName'; name: string } | { type: 'rememberP2Name'; name: string }
  | { type: 'writeHomeTab'; tab: Tab } | { type: 'writePlayMode'; mode: PlayMode } | { type: 'writeSoundFont'; font: SoundFontName }
  | { type: 'writeOpts'; opts: Opts }
  | { type: 'toast'; message: string; ms?: number } | { type: 'send'; frame: HF | GF }
  | { type: 'fx'; cue: 'tap' | 'yourTurn' } | { type: 'wakeLock'; on: boolean }
  | { type: 'startHost'; code: string; attempt: number; resume: boolean } | { type: 'startGuest'; code: string; attempt: number } | { type: 'closeNet' }
  | { type: 'confirm'; message: string; then: ShellIntent<Opts, HF, GF, Tab> }
  | { type: 'then'; intent: ShellIntent<Opts, HF, GF, Tab> } | { type: 'initHome' } | { type: 'scrollTop' }
  | { type: 'startTimer'; id: 'longPress'; ms: number } | { type: 'cancelTimer'; id: string }
  | { type: 'toggleSound' } | { type: 'share'; code: string }
  | { type: 'fillName'; name: string } | { type: 'fillP2Name'; name: string } | { type: 'setCode'; code: string };
```

The reducer and its runner:

```ts
export type Step<App, Effect> = Readonly<{ app: App; effects: ReadonlyArray<Effect> }>;
export type Ctx = Readonly<{ rng: () => number; now: () => number }>;

export const reduceShell = <Opts, S, V, A, HF, GF, Tab extends string, Table, X = never>(
  app: Readonly<{ shell: ShellState<Opts, S, V, Tab, X>; table: Table }>,
  intent: ShellIntent<Opts, HF, GF, Tab>,
  ctx: Ctx,
  cfg: ShellGame<Opts, S, V, A, HF, GF, Tab, Table, X>,
): Step<typeof app, ShellEffect<Opts, HF, GF, Tab>>;

export const isShellIntent = (intent: { type: string }): boolean => SHELL_INTENT_TYPES.has(intent.type);

export const runShellEffect = <Opts, S, HF, GF, Tab extends string>(
  effect: ShellEffect<Opts, HF, GF, Tab>,
  deps: ShellEffectDeps<Opts, S, HF, GF, Tab>,     // bg's EffectDeps minus writeVariant/writeMatchLength/writeCurtainMode; gin's minus writeSort/writeCardBack/scorer/copy
): void;

export const hostContextOf = <Opts, S>(shell: ShellState<Opts, S, unknown, string>): HostContext<Opts>;   // 96% identical today
export const guestContextOf = (shell: ShellState<unknown, unknown, unknown, string>): GuestContext;         // 100%
export const saveFor = <Opts, S>(shell: ShellState<Opts, S, unknown, string>, cfg: ShellGame<Opts, S, …>): Save<Opts, S> | null;   // 92%
export const readHome = <Opts, S>(store: Store, cfg: ShellGame<Opts, S, …>): HomeSnapshot<Opts, S>;                                // 72%; takes cfg.save.read
```

A game's `reduce` is then:

```ts
// web/games/backgammon/src/ui/state.ts (gin identical once it has the {shell, table} split)
export const reduce = (app: App, intent: Intent, ctx: Ctx): Step<App, Effect> =>
  isShellIntent(intent) ? reduceShell(app, intent, ctx, BACKGAMMON) : tableIntent(app, intent, ctx);
export const runEffect = (app: App, effect: Effect, deps: EffectDeps): void =>
  isShellEffect(effect) ? runShellEffect(effect, deps) : runTableEffect(app, effect, deps);   // gin handles scorer/copy/writeSort/writeCardBack first
```

### 4.3 The config object a game supplies (`web/games/<g>/src/shellConfig.ts`)

Everything the shared flows call where the two reducers differ today, and every literal shared code may not contain (the lint zone `./web/shared` never names a game).

```ts
export type ShellGame<Opts, S, V, A, HF, GF, Tab extends string, Table, X = never> = Readonly<{
  id: Game;                                             // 'gin-rummy' | 'backgammon': peer prefix, code spec, share title via tools/games.ts
  title: string;                                        // 'Gin Rummy' | 'Sheshbesh' (the share payload)
  hook: string;                                         // '__gin' | '__backgammon'
  names: Readonly<{ default: string; guest: string; max: number }>;   // 'Ari', 'Jeff', 20
  tabs: Readonly<{ list: ReadonlyArray<Tab>; default: Tab; buttonId: (tab: Tab) => string }>;   // play/rules/score | play/rules/about
  modes: Readonly<{ default: PlayMode }>;              // resolves bg's 'local' (ui/state.ts) vs 'online' (storage.ts) drift once PR-D flips ONLINE_MODE_SHOWN
  copy: Readonly<{
    leaveLocal: string; leaveOnline: string;            // 'End this game? Scores will be cleared.' | 'End this match? The score will be cleared.'
    hostRoom: (host: string, opts: Opts) => string;     // gin names the target
    resumeLabel: (resume: Resume<Opts, S, X>) => string;          // 86% identical; the three labels are byte-identical today
    handoffLabel: (shell: ShellState<Opts, S, V, Tab, X>) => string | null;   // 100%
  }>;
  opts: Readonly<{
    parse: (raw: Readonly<Record<string, string>>, fallback: Opts) => Opts;   // gin parseTarget; bg parseMatchLength + parseVariant
    ofGame: (game: S) => Opts;
    initial: (snapshot: HomeSnapshot<Opts, S>) => Opts;
    write: ShellEffect<…> | null;                        // bg persists variant/matchLength; gin nothing
  }>;
  engine: Readonly<{
    create: (players: readonly [string, string], opts: Opts, rng: () => number, now: number) => S;   // gin ignores now
    apply: (game: S, seat: 0 | 1, action: A, rng: () => number, now: number) => Result<S, string>;
    viewFor: (game: S, seat: 0 | 1) => V;
    over: (view: V) => boolean;
  }>;
  frames: Readonly<{                                    // the game's protocol.ts builders and decoders
    lobby: (myName: string, opts: Opts) => HF; welcome: (myName: string, opts: Opts) => HF;
    state: (view: V) => HF; toast: (msg: string) => HF; full: () => HF;
    join: (name: string) => GF; action: (a: A) => GF;
    isGuestFrame: (f: HF | GF) => f is GF;
  }>;
  save: Readonly<{                                      // the game's storage.ts, built on edge/prefs.ts shellSave
    keys: ShellKeys; read: (store: Store) => Save<Opts, S> | null; write: (store: Store, save: Save<Opts, S>) => void; clear: (store: Store) => void;
    extraResume?: (store: Store) => X | null;           // gin's scorer resume; absent elsewhere
  }>;
  table: Readonly<{                                     // the three hooks the shared flows call where gin has HAND_CLEARED/rendered/refuse and bg tableCleared/rendered/refuse
    initial: Table;
    cleared: (table: Table) => Table;                   // gin: HAND_CLEARED + selectedCard/meldChooser/revealed/curtain; bg: tableCleared keeping curtainMode, cues reset
    rendered: (app: { shell: ShellState<…>; table: Table }, prev: V | null, now: number) => Step<…>;   // gin: nextCue + ghost draw stage; bg: cuesBetween + hit toasts + R14 beat
    refuse: (app: { shell: ShellState<…>; table: Table }, msg: string) => Step<…>;                  // gin drops a waiting draw stage; bg drops selected/picked/pending
  }>;
  cues: Readonly<Record<string, CueSpec>>;              // ui/sound.ts, must include tap/yourTurn/win/lose
  rulesHtml: (opts: Opts) => string;                    // gin ignores opts; bg keys by variant
  sheets: ReadonlyArray<Readonly<{ overlay: string; close: string; intent: { type: string } }>>;
  home: Readonly<{ nameInputIds: ReadonlyArray<string>; p2NameInputIds: ReadonlyArray<string>; startOptions: (doc: Document) => Readonly<Record<string, string>> }>;
  toastClass?: (message: string) => string | null;      // bg: 'hit' for 'Kapará.'
}>;
```

Gin's residue on top of this: `Opts = {target}`, the 7 sandbox intents (~40 lines) and `withP1Name`, `Resume {kind: 'scorer'}` through `X`, the `scorer`/`copy`/`writeSort`/`writeCardBack` effects handled in its `runEffect` before delegating, `cardBack/set` and `data-card-back` on `<body>`, the extra `scP1NameInput`/`scP2NameInput` ids, `renderSandbox`/`paintSandbox` (~50 lines in `home.ts`), the 'score' tab panel. Backgammon's residue: `Opts = {matchLength, variant}`, `curtainMode` in `Table` and its `writeCurtainMode` effect, the four selects and `paintOptions` (~40 lines), `paintRules` keyed by variant, the Escape fallback in `bindSheets`, `curtainHandoffBtn`.

#### 4.3.1 Agreed in C1 (gin adopts `App = {shell, table}`)

C1 split gin's flat `App` into backgammon's two records (`web/games/gin-rummy/src/ui/state.ts` `Shell`/`Table`, `SHELL_INTENT_TYPES`, `reduce = isShellIntent ? shellIntent : tableIntent`) without changing a reducer body (the C1 PR's description carries the diff proof: a script that normalises `app.shell.x`/`app.table.x` and `withShell`/`withTable` back to the flat spreads and diffs every `case` against main; it is not in the tree). The two games agree the six points the config above assumes, so C2 can delegate:

1. **`Opts` is generic.** Gin's `Shell.target: number` sits where backgammon's `Shell.matchLength`/`variant` sit; `ShellState<Opts, …>` carries one `opts: Opts` field and each game's `cfg.opts.parse` decodes its own raw select/input values (`parseTarget`; `parseMatchLength` + `parseVariant`). Every other shell field is spelled the same in both files today; both also carry `cues: CueState` (the cue machine's memory, which the sketch in §4.2 omits: it is shell state, not table state, because `nextCue` keys on the view) and gin's shell has no `p2Name` (gin's second name lives only in its input and `ginRummy_p2Name`; backgammon's shell holds it).
2. **`rendered(app, prev, now)` threads `now`.** Backgammon's `rendered` takes the clock for the R14 beat; gin's takes `(app, prev)` and ignores the clock. The shared flows call the hook with all three; gin's config drops the third.
3. **`table.cleared(table)` is the hook a hand's start, leave and loss call; gin's handoff is not a `cleared`.** Backgammon's `tableCleared` (everything but `curtainMode`) is one reset at its five sites (`startLocal`, `handoff`, `leaveFinish`, `host/deal`, `guest/lost`). Gin's sites clear different sets, and C2 delegates each as it is, not as one: `startLocal` and `host/deal` spread `HAND_CLEARED` (`draw`, `picture`, `human`, `drag`; `startLocal` puts the sandbox's `human` back on top) with `resultDismissed: false`; `leaveFinish` spreads `HAND_CLEARED` and also drops `curtain` and `meldChooser`, because the table is left; `guest/lost` spreads `HAND_CLEARED` alone. `handoff` is the odd one: the hand goes on as a hosted room, so it keeps `picture`, `human` and `drag` and clears only the pass-and-play marks (`selectedCard`, `curtain`, `meldChooser`, `draw`, and `revealed` on the shell); a uniform `cleared` there would throw away the kept picture and the hand-made melds on the handoff button. So `cleared` covers `HAND_CLEARED` (with `curtain`/`meldChooser` where the table is left) at `startLocal`, `leaveFinish`, `host/deal` and `guest/lost`, and the handoff gets its own reset in C2 (`table.handedOff`, or `cleared` with a `keepHand` flag). `resultDismissed: false` at `startLocal`/`host/deal` is a new-view reset, not part of `cleared`, as are the per-view resets the shared flows make (gin: `selectedCard: null` in `broadcast`/`localBroadcast`/a `state` frame and `resultDismissed: false` on every applied action; backgammon: `selected`/`picked`/`pending: null` in `broadcast`): C2 gives them a second hook (`table.newView`) rather than widening `cleared`.
4. **`refuse(app, msg)` is a hook.** Gin drops a `waiting` draw stage and keeps a `shown` one (ghost-slot §4); backgammon drops `selected`/`picked`/`pending`. Both then toast; the shared `hostDispatch`/`act` call `cfg.table.refuse`.
5. **The copy table** (`cfg.copy`): `leaveLocal`/`leaveOnline` (`'End this game? Scores will be cleared.'`/`'Leave this game? The room will close.'` vs `'End this match? The score will be cleared.'`/`'Leave this match? The room will close.'`), `hostRoom(host, opts)` (gin names the target), `resumeLabel` and `handoffLabel` (byte-identical today), `guestGone(oppName, code)`, and the status strings both files spell the same (`NOT_CONNECTED_MSG`, `WAITING_FOR_GUEST_MSG`, `OPPONENT_LEFT_MSG`, `ROOM_FULL_MSG`, `LOST_HOST_MSG`, `DISCONNECTED_MSG`, `joinedMsg`), which move into `shell.ts` and are re-exported by each `state.ts` so the tests' imports hold.
6. **`X` carries gin's scorer resume.** `Resume<Opts, S, X>` with `X = { kind: 'scorer'; state: ScorerState }` for gin and `never` for backgammon; `cfg.save.extraResume` reads it and `cfg.copy.resumeLabel` labels it; the `scorer` effect stays in gin's `runEffect`.

Also decided here, so C2 knows what is shell and what is not:

- **`curtain` is table state in both games** (`Table.curtain: Seat | null`); `curtainMode` is backgammon's alone, beside it. `curtain/reveal` sets `shell.revealed` and clears `table.curtain`, then runs the shared `localBroadcast`.
- **`history` stays per game, on the table**: gin's `history: 'game' | 'scorer' | null` (the sheet paints the game's list or hosts the Score Counter's), backgammon's `historyOpen: boolean`. Neither is shell state; C2 leaves both.
- **`resultDismissed` (gin) and `resultOpen` (backgammon) stay per game, on the table**, each with its own sense (gin's is the legacy's: false on every new view, true after "Look at the table"). Not shell state.
- **`selectedCard` is live, not dead**: `card/tap`, the Discard and Knock buttons, `rendered`'s `selectionIn` and the hand painter read it. It is table state, as backgammon's `selected` is.
- **`hostSeated` was dead and is gone.** The legacy set it and never read it; the reducer kept it only so the hook's `app` had the legacy's members, and this split changes that shape anyway (`window.__gin.app.shell.view`, which the e2e drivers and `tools/parity/gin-dom-parity.ts` now read).
- **The intent partition is backgammon's.** `SHELL_INTENT_TYPES` lists 36 of gin's intents (backgammon's 38 less `variant/set`/`matchLength/set`); `cardBack/set`, the six sandbox intents and `rules/open`/`rules/close`/`history/open`/`history/close` are gin's table half. As in backgammon, `leave/request`/`leave/confirmed`/`leave/finish`, `curtain/reveal`, `visible`, `render` and `persist` sit on the table side of both partitions today although §4.2 lists them as shell intents: they touch table state, and C2 moves them into `reduceShell` through the `cleared` and `rendered` hooks.

### 4.4 Painters and binders (`shellPaint.ts`, `home.ts`, `curtain.ts`, `waiting.ts`, `toast.ts`)

All over `web/shared/edge/dom.ts` (`requireId`, `setText`, `toggleClass`, `setAttr`, `listenId`), clock injected, no `Date`, no `App` shape: each takes a small view record so it works before the reducer is unified.

```ts
// shellPaint.ts
export const paintScreen = (doc: Document, screens: ReadonlyArray<string>, current: string, fixedOn: string): void;   // body.fixed-screen when current === fixedOn; gin adds data-card-back itself
export const paintWaiting = (doc: Document, w: Readonly<{ code: string | null; hostStatus: string; guestStatus: string; startGameVisible: boolean }>): void;
export const showToast = (doc: Document, message: string, extraClass?: string | null): void;   // bg passes 'hit'
export const hideToast = (doc: Document): void;
export const paintSound = (doc: Document, enabled: boolean): void;
export const paintHandoff = (doc: Document, label: string | null): void;                     // null hides
export const paintSheet = (doc: Document, id: string, open: boolean): void;
export const bindSheets = <I>(doc: Document, sheets: ReadonlyArray<{ overlay: string; close: string; intent: I }>, dispatch: (i: I) => void, opts?: { escapeFallback?: I }): void;
export const ensureKeyed = (el: Element, key: string, markup: () => string): void;           // gin ensurePile, bg ensureKeyed + renderRules; in keyed.ts since dry-round-2.md D1

// home.ts
export type HomeView<Tab extends string> = Readonly<{ homeTab: Tab; playMode: PlayMode; submenuOpen: boolean; resumeLabel: string | null }>;
export const blocksCodeInput = (inputType: string, data: string | null): boolean;
export const tabButtonId = (tab: string): string;
export const fillInputs = (doc: Document, ids: ReadonlyArray<string>, value: string): void;   // replaces fillNameInputs + fillP2NameInput in both games
export const setCodeInput = (doc: Document, value: string): void;
export const paintTabs = <Tab extends string>(doc: Document, tabs: ReadonlyArray<Tab>, current: Tab): void;
export const paintPlayMode = (doc: Document, modes: ReadonlyArray<string>, current: string): void;   // toggles `${mode}ModeContent`; gin passes its third 'sandbox' mode
export const paintSubmenu = (doc: Document, open: boolean): void;
export const paintResume = (doc: Document, label: string | null): void;
export const paintHomeShell = <Tab extends string>(doc: Document, v: HomeView<Tab>, cfg: { tabs: ReadonlyArray<Tab>; modes: ReadonlyArray<string> }): void;
export const bindHomeShell = <I>(doc: Document, dispatch: (i: I) => void, cfg: Readonly<{
  tabs: ReadonlyArray<{ tab: string; id: string }>;
  startOptions: (doc: Document) => Readonly<Record<string, string>>;   // gin reads targetInput/localTargetInput; bg the four selects; spread into host/click and local/click
  intents: ShellIntentBuilders<I>;                                    // the game's constructors, so the shared binder never imports a game's Intent type
}>): void;
export const bindLongPress = <I>(el: Element, dispatch: (i: I) => void, intents: { press: I; release: I }): void;

// curtain.ts
export type CurtainText = Readonly<{ title: string; sub: string; last: string; button: string; attrs?: Readonly<Record<string, string | null>> }>;   // bg puts data-rolls in attrs
export const paintCurtain = (doc: Document, text: CurtainText | null): void;   // null hides; texts untouched while hidden (both games' comment)
export const bindCurtain = <I>(doc: Document, dispatch: (i: I) => void, onReveal: (btn: Element) => ReadonlyArray<I>): void;   // gin [curtain/reveal]; bg [curtain/reveal, roll/click] read from data-rolls

// toast.ts
export const createToaster = (doc: Document, clock: Clock, defaultMs = 2600, classify?: (msg: string) => string | null): (message: string, ms?: number | null) => void;   // gin's single restarting timer; fidice keeps its queue
export const createTimers = <Id extends string>(clock: Clock): Readonly<{ start: (id: Id, ms: number, fire: () => void) => void; cancel: (id: Id) => void }>;   // the named-timer Map from both main.ts files
```

As landed (B2, `web/shared/ui/home.ts`): three signatures differ from the sketch above, each forced by the two games. `startOptions` is a `{host, local}` pair of readers, not one, because the two start buttons read different inputs in both games (gin `targetInput` and `localTargetInput`; backgammon `matchLengthSel`/`variantSel` and their `local*` twins); `hostClick(name, options)` and `localClick(p1, p2, options)` take what the reader returned as `Start` and each game spreads it after the names, so every intent keeps its literal key order. `ShellIntentBuilders<I, Tab, Start>` is generic over the tab and start types too, and an intent with no payload (`hostDeal`, `submenuPress`, `cancel`, ...) is supplied as the value itself, a builder only where the control carries a value. `bindHomeShell`'s `tabs` is the game's `HOME_TABS` array, not `{tab, id}` pairs: the binder derives each button's id with `tabButtonId` and skips `play`, whose button is the long-press one. `HomeView.playMode` is a `string` (no shared `PlayMode` exists before C2) and the tab list each `storage.ts` decodes stays the game's, passed in. The B2 row's "shared cases move once" gave way to §5's stronger rule (both suites unchanged): gin's 12 and backgammon's 9 `home.test.ts` cases stay, so the shell's paint and bind cases run three times until C2 unifies the reducer.

### 4.5 Boot (`boot.ts`) and the sessions (`web/shared/net/{host,guest}.ts`)

```ts
// boot.ts: the ~290 identical lines of main.ts, taking the config and the edges it may not create itself
export const bootShell = <App, Intent, Effect, HF, GF>(cfg: Readonly<{
  game: ShellGame<…>;
  doc: Document; win: Window; store: Store; clock: Clock; rng: () => number; now: () => number;   // main.ts owns Math.random/Date.now (RNG_ALLOWED)
  reducer: { initialApp: App; reduce: (app: App, i: Intent, ctx: Ctx) => Step<App, Effect>; runEffect: (app: App, e: Effect, deps: EffectDeps) => void; readHome: (store: Store) => HomeSnapshot<…> };
  paint: { paint: (doc: Document, app: App) => void; bindAll: (doc: Document, dispatch: (i: Intent) => void) => void };
  net: { deps: NetDeps; Host: new (…) => HostSession<GF, HF, unknown>; Guest: new (…) => GuestSession<GF, HF> };
  fx: Fx<string>;
  extraEffects?: (ctx: BootCtx<App, Intent>) => Partial<EffectDeps>;       // gin: scorer, copy
  hookExtras?: (ctx: BootCtx<App, Intent>) => Record<string, unknown>;    // gin: sandbox, cardBack, layoffs, setHomeTab; bg: view, setup
}>): Readonly<{ dispatch: (i: Intent) => void; app: () => App; toast: (m: string, ms?: number) => void }>;

export const applyInviteLink = (search: string, joinByLink: (code: string) => void, replace: (url: string) => void): void;   // the 14-line ?join= block over edge/invite.ts joinCodeFrom/withoutJoin
export const shareInvite = (nav: Navigator, o: { title: string; code: string; pageUrl: string; toast: Toaster; copiedMsg: string; fallbackMsg: (code: string) => string; fallbackMs: number }): Promise<void>;
export const sessionEvents = <HF, GF>(dispatch: Dispatch, toast: Toaster, wakeLock: (on: boolean) => void): { host: HostEvents<GF>; guest: GuestEvents<HF> };

// web/shared/net/host.ts and guest.ts: gin's classes verbatim, the game injected (understand.md P5, confirmed by the net-boot audit: 4 + 1 code hunks)
export type HostContext<X> = Readonly<{ attempt: number; role: NetRole | null; code: string; myName: string; hasGame: boolean; handoff: boolean; oppName: string | null; oppConnected: boolean }> & X;
export type HostCodec<G, H, X> = Readonly<{ decode: (raw: unknown) => Result<G, string>; welcome: (ctx: HostContext<X>) => H; full: () => H }>;
export type GuestCodec<G, H> = Readonly<{ decode: (raw: unknown) => Result<H, string>; join: (name: string) => G }>;
export class HostSession<G, H, X> {
  readonly kind = 'host';
  constructor(deps: NetDeps & { read: () => HostContext<X>; events: HostEvents<G>; codec: HostCodec<G, H, X> }, opts: { game: Game; code: string; attempt: number; resume: boolean });
  send(frame: H): void; close(): void;
}
export class GuestSession<G, H> { constructor(deps: NetDeps & { read: () => GuestContext; events: GuestEvents<H>; codec: GuestCodec<G, H> }, opts: { game: Game; code: string; attempt: number }); send(frame: G): void; close(): void; }
// The peer id is peerIdFor(opts.game, code): 'sheshbesh-' is not derivable from 'backgammon', so Game is passed, never inferred.

// web/games/backgammon/src/net/host.ts after P5 (~20 lines)
export type HostContext = SharedHostContext<{ matchLength: number; variant: ShippedVariant }>;
export class HostSession extends SharedHostSession<GuestFrame, HostFrame, { matchLength: number; variant: ShippedVariant }> {
  constructor(deps: Deps, opts: Opts) {
    super({ ...deps, codec: { decode: decodeGuestFrame, welcome: (c) => welcome(c.myName, { matchLength: c.matchLength, variant: c.variant }), full } }, { ...opts, game: 'backgammon' });
  }
}
export { OPENING_MSG, WAITING_MSG, HOST_WATCHDOG_MSG, CODE_BUSY_MSG, BUSY_RETRY_MS, /* … every *_MS and xxxMsg sessions.test.ts and ui/state.ts import */ } from '../../../../shared/net/host.ts';
```

As landed (B3, `web/shared/edge/boot.ts`): the three helper signatures differ from the sketch above. `applyInviteLink(win, joinByLink)` takes the page's `{location, history}` (`InviteWindowLike`; `window` at the call site) rather than `(search, joinByLink, replace)`: the rewritten URL is `pathname` + the remaining query + `hash`, and neither `pathname` nor `hash` can be rebuilt from `search`, so the test drives it over a recorded `history` instead of a `replace` callback. `shareInvite(nav, { title, code, pageUrl, toast })` owns the copy instead of taking `copiedMsg`/`fallbackMsg`/`fallbackMs`: both games' strings were byte-identical and `main.ts` was their only reader, so `INVITE_COPIED_MSG`, `roomCodeMsg` and `SHARE_FALLBACK_MS` moved out of the two `ui/state.ts` into `boot.ts` beside the chain, and backgammon's `main.ts` redeclaration went with them. `sessionEvents<G, H>({ dispatch, toast, wakeLock })` takes one deps object whose `wakeLock` is `Pick<WakeLock, 'hold'>` (the `fx.ts` wake lock `main.ts` already holds) rather than an `(on: boolean) => void`, because both adapters only ever call `hold()`; `SessionIntent<G, H>` names the nine intent members the adapters raise, and each game's `dispatch` fits it as it is. The folder is `edge/`, not `ui/`, for the reason §4.1 records; `bootShell` (C3) lands beside the three.

The protocol skeleton (`web/shared/lib/protocol.ts`) keeps the wire bytes: `welcome: (hostName, room: R) => ({ t: 'welcome', hostName, ...room })` spreads the room after `hostName`, which is gin's legacy key order `{t, hostName, target}` and backgammon's `{t, hostName, matchLength, variant}`. Storage's `shellSave<S, X>` keeps `saveLiteral`'s order `role, code, myName, <extra>, game, oppName, handoff?` for the 17 gin captures.

Liveness (landed after A1, `web/shared/net/liveness.ts`): the legacy sessions learnt of the other side only from the channel's `close`, which PeerJS fires for a deliberate departure alone, so a guest whose tab or phone died kept its seat until the host restarted (the online review's A13/A14). Both shared sessions heartbeat below the codec, `{t: 'hb'}` every `HB_MS` (5 s) on an open channel, and take `HB_GRACE_MS` (15 s) with no inbound frame as the peer gone: the host closes the channel and raises `guestGone(null)` as for a close (the reducers' rejoin copy and the freed seat need no game change), the guest raises `lost` and rejoins. A join while the current guest has been silent `HB_MISSED_MS` (10 s) replaces the silent channel instead of being told the room is full; a join that arrives sooner is held (nothing tells a dead guest from a quiet one before its next beat is due) until the guest's next frame makes it a third peer (`full`) or that silence makes it the guest's own return (seated, its waiting `join` replayed after the welcome), so a player back within seconds of its tab dying never reads "room full". The guest's `tryJoin` connects nothing while a channel is open, so a broker reconnect under a live game (the legacy's second channel, told `full`) no longer happens. The frame is intercepted before `codec.decode`, so the games' decoders and every existing frame's bytes are untouched, and a game that wraps the sessions gets the detection with no code of its own. The constants are re-exported from `host.ts` and `guest.ts`; the ICE states were not adopted (the header of `liveness.ts` says why).

N seats (landed with the briscola program's PR-3, `docs/design/n-seat-sessions.md`): `HostSession` hosts `capacity − 1` guest channels (`HostOptions.capacity`, default 2; `HostOptions.waiting` the open status), each a seat 1..N−1 with its own `Liveness`, the lowest free seat at connection, the hold probing every seat (the first silence wins, every beat refuses), `frame(frame, seat)`, `guestGone(iceFailed, seat)`, `send(frame, seat?)` (every open channel when omitted), `codec.welcome(ctx, seat)`, and an optional `codec.joinName` that reseats a same-named join into a gone or silent seat. At capacity 2 there is one slot and every path is the two-seat code above; gin's and backgammon's wrappers and codecs are byte-identical (one-parameter `welcome`, no `joinName`), `sessions.test.ts`, both games' pins and the gin wire corpus are unchanged, and `sessions.harness.ts` logs one argument by default (`world({ seats: true })` logs the seat). `GuestSession` is untouched. What the shell owes the N-seat table (`sessionEvents(deps, { seats })`, `cfg.seats`, `ShellState.seats`/`mySeat`, one `send` per seat, the waiting screen's seat list) is the list in n-seat-sessions.md §7 and lands with C2/C3 or the PR after; every item is today's shape at capacity 2.

### 4.6 How fidice joins later

Not by adopting this shell: its architecture (vdom, N seats, bots, spectators, reconnect tokens, `#join=`/`#watch=`, 5-char codes, name max 16, toast queue, cover-then-confirm handoff over a Peer) is a second model the map keeps separate (understand.md P12). What the shared shell keeps fidice-ready is the pure, DOM-free layer it can adopt piecemeal after its restyle:

1. The room-code form logic, already shared (`lib/roomCode.ts` `sanitiseCode`/`validateCode`/`ROOM_CODE['fidice']`; `FIDICE_CODE_LENGTH_ERROR` replaces the literal at `controller.ts:420`), plus `blocksCodeInput`.
2. `normaliseName(raw, {max, fallback})` in `lib/` (gin/bg 20/'Player 1', fidice 16/'Player').
3. `applyInviteLink` if fidice moves from `#join=` to the documented `?join=`; `#watch=` stays its own.
4. `shareInvite` in place of `copyToClipboard` -> 'Copied!' if the owner wants one chain.
5. `createToaster` only if the owner picks gin's single-timer policy over fidice's queue (both pinned by tests).
6. After P5, its `client.ts` could be `GuestSession<ClientMessage, ServerMessage>` with a ~25-line `GuestEvents` -> `SessionEvents` adapter, which would give it gin's retry ladder and relay toast, but that changes pinned behaviour (12 s single timeout -> 40 x 3 s retries; path toast at 1.5 s vs 3 s): a product decision, not part of the DRY pass.
7. The header tabs paint through `paintTabs` only if the vdom is retired for the shell, which the map does not recommend.

Its N-seat `HostSession` is the seed for any fourth game that needs more than two seats, not gin's pipe.

## 5. The extraction plan: ordered PRs

Rules for every PR: code moves, it is not rewritten; both games' suites run unchanged against thin wrappers; wire bytes and storage literals do not change; a new shared folder is registered (eslint zone row + `except` entries, vitest `coverage.include` + a thresholds group measured in the same PR, tsconfig includes) in the PR that creates it; each PR re-measures the per-folder coverage rows it shrinks (README step 5: nothing existing goes down). Main is unprotected: watch CI, then merge; never `--auto`.

The second round under the same rules, measured on main after Waves A-B with C2/C3 in flight (what else hoists out of the table UI, the engines, the styles and markup, fidice and the harness, and how each kernel is unit-tested on the fakes), is [docs/design/dry-round-2.md](dry-round-2.md); its Wave D1 (`web/shared/ui/keyed.ts`) landed first.

Sequencing against the in-flight work: **bg-online (PR-D)** edits exactly the shell slice (`ONLINE_MODE_SHOWN` in `ui/state.ts`, `paintOnlineOption` in `home.ts`, `paintHandoff`/`curtainHandoffBtn` in `render.ts`/`local.ts`, `index.html`'s default mode, `e2e/fixtures/backgammon.ts`, `backgammon-local.spec.ts`, `tools/parity/computed-styles.ts`, and re-records backgammon's two computed-style goldens); **bg-polish** touches only `theme.css`. Both are unpushed worktrees today. Wave A touches none of those files and can land before them; Waves B-D wait.

### Wave A: now, in parallel, independent of bg-online

| PR | What moves | Files | Protected by |
|---|---|---|---|
| **A1 Sessions (P5)** | gin's `HostSession`/`GuestSession` verbatim into `web/shared/net/{host,guest}.ts` generic over `<G, H, X>` with an injected codec and `game: Game`; one `sessions.harness.ts` + `sessions.test.ts` (the 21 tests once over a fake codec); the two game `net/host.ts`/`guest.ts` become ~20/~15-line wrappers re-exporting the `*_MS` constants and messages; the two `sessions.test.ts` shrink to ~50-80 lines of byte-pinning each (peer id `ginrummy-ari-ABCD`/`sheshbesh-ABCD`, welcome and lobby bytes through the real wrappers, one refused and one accepted action) | new `web/shared/net/{host,guest,sessions.harness,sessions.test}.ts`; `web/games/{gin-rummy,backgammon}/src/net/{host,guest,sessions.test}.ts`; `eslint.config.js` (EDGES glob line 29, net zone `except` lines 237-243, new zone row), `vitest.config.ts` (include + thresholds at gin's measured values; shrink the two game net rows), `tsconfig.node.json`; delete the two 3-4-line `net/peerjs.ts` once shared/net imports `edge/peer.ts` directly | gin `sessions.test.ts` (12 host + 9 guest tests: tryJoin on every open, stale channel forwards, 40th stall), `test/parity/gin.sessions.test.ts` (13-file legacy wire corpus through the sessions), bg `sessions.test.ts` (`expect(ROOM).toBe('sheshbesh-ABCD')`), e2e `shell-online`/`shell-relay` (`expectPeerOptions(call, spec.debug)`, 0 for gin), `web/shared/edge/peer.test.ts` |
| **A2 Protocol skeleton** | `twoSeatProtocol<A, V, R>({decodeAction, decodeView, room})` in `web/shared/lib/protocol.ts` (pure); each game's `protocol.ts` keeps its room decoder and re-exports (~30 lines); call sites `welcome(name, target)` -> `welcome(name, {target})` (gin `ui/state.ts` ~810, bg ~992, the host wrappers) | `web/shared/lib/protocol.ts` (+ test to 100/100/100/100), both `protocol.ts`, both `ui/state.ts` (one line), A1's wrappers (one line: trivial conflict if A1 and A2 race) | `test/parity/gin.protocol.test.ts` (13 legacy fixtures byte for byte), bg `protocol.test.ts` (7 goldens under `test/fixtures/backgammon-wire`, re-encoded), gin `protocol.test.ts` |
| **A3 Storage helpers** | `readTextWith`, the five decoders, `textPref`/`namePref`/`soundPref`, `shellSave<S, X>` into `web/shared/edge/prefs.ts` (or into `edge/storage.ts`: the storage zone's `except` list allows only that file today); each `storage.ts` keeps `STORAGE_KEYS`, `HOME_TABS`, its `hostExtra` decoder and own prefs (~100-120 lines) | `web/shared/edge/prefs.ts` (+ test), both `storage.ts`, `eslint.config.js` storage zone `except` (lines 288-294), `vitest.config.ts` rows | `test/parity/gin.storage.test.ts` (17 captures round-trip byte for byte), gin `storage.test.ts` (328), bg `storage.test.ts` (405, 'frozen constants' pins the ten keys and the literal order) |
| **A4 Cue player + net deps** | `fx.ts`'s body into `web/shared/edge/cuePlayer.ts` `createCuePlayer<E>` with the cue table and `persist` injected (each `fx.ts` -> ~8 lines); `browserNetDeps({search, debug, onWake})` into `web/shared/edge/netDeps.ts` replacing 14 + 14 + 5 lines in the three `main.ts` files | `web/shared/edge/{cuePlayer,netDeps}.ts` (+ tests), both `fx.ts` and `fx.test.ts` (the 4 createFx tests move once; the table tests stay), three `main.ts` (netDeps block only) | gin `fx.test.ts` ('ten events onto ten distinct generic cues', the default font plays gin's legacy numbers), bg `fx.test.ts`, e2e `gin-sound-font`, `expectPeerOptions` (debug 0 gin, 1 fidice) |
| **A5 Harness groundwork** | `e2e/fixtures/geometry.ts` (PHONE/DESKTOP/PHONE_SHORT, `Frame`, `frameScript`, `expectSameFrame`, `fitsScript`; 26 viewport literals become imports); tsconfig.node exclude globs `web/games/*/src/ui/{render,home,local,page.fake}*.ts` (16 lines -> 11); `tools/games.ts` grows into `REGISTRY` (title, hook, saveKey, storagePrefix, pageShape, contractFloors, debug) with GAMES/PAGE_TITLES/HOOKS derived; `test/dist/dist-parity.test.ts`'s two hand-written page-shape tests become one `GAMES.forEach`; `.github/actions/coturn` replaces three apt blocks and nightly/stories use the `playwright-chromium` action; the backgammon title spelled once | `e2e/fixtures/geometry.ts`, `e2e/gin-geometry.spec.ts`, `e2e/fixtures/backgammon-geometry.ts`, `e2e/backgammon-geometry.spec.ts`, `tools/parity/computed-styles.ts` (VIEWPORTS only), `tsconfig.node.json`, `tools/games.ts` + `games.test.ts`, `test/dist/{dist-parity,class-contract}.test.ts`, `.github/{actions,workflows}` | `gin-geometry`, `gin-stories` (`expectHandRows` unchanged), `backgammon-geometry`, `tsc -b`, `npm run test:dist`, `tools/games.test.ts`, the CI runs |
| **A6 (optional, outside the shell) Drag + motion** | `web/shared/edge/drag.ts` `bindDrag<From, Over>` (~130 lines: the Session cell, begin/end/press/move, ghost clone, `capturePointer`, LAND_MS 180 + 60, DRAG_THRESHOLD 8, motion 'direct' or gin's follow/tilt plug-in) and `web/shared/edge/motion.ts` (the ~20-line kernel + `flip` and `fly` recipes); `ensureKeyed` into `dom.ts` | `hand/dragger.ts` (residue ~90), `hand/drag.ts` (stays pure, plugs in), `board/dragger.ts` (~40), `hand/flip.ts`, `board/fly.ts`, `render.ts` `ensurePile`/`ensureKeyed` | `dragger.test.ts` x2 (fake rects), `drag.test.ts`, `flip.test.ts`, `fly.test.ts`, e2e `gin-drag-discard`/`gin-layoff`/`gin-arrange`, `backgammon-local` drag and flight cases; gin's frame-loop follow must stay optional or its feel changes |

A1-A5 are independent of each other (A2 touches one line of A1's wrappers). Land A1 first if only one can go: it is the largest verbatim duplicate and the safety net for everything after.

### Wave B: right after bg-online and bg-polish merge (painters and binders; no reducer change)

| PR | What moves | Files | Protected by |
|---|---|---|---|
| **B1 Shell painters + toast + page fake** | `paintScreen`, `paintWaiting`, `showToast`/`hideToast`, `paintSound`, `paintHandoff`, `paintSheet`, `bindSheets`, `ensureKeyed` into `web/shared/ui/shellPaint.ts`; `createToaster`/`createTimers` into `web/shared/ui/toast.ts` (replacing gin `main.ts` 142-159 and bg 89-106 + the timer map); `paintCurtain`/`bindCurtain` into `web/shared/ui/curtain.ts` (each game keeps `curtainText`); `pageFromMarkup` + `modeButtons` into `web/shared/edge/page.fake.ts` (bg's richer attrs version; each game's `page.fake.ts` -> ~30 lines); `SHELL_IDS` in `web/shared/ui/ids.ts` with a `test/dist` check that both pages carry every id; the `web/shared/ui` zone row, coverage group, tsconfig include | new `web/shared/ui/{shellPaint,toast,curtain,ids}.ts` + tests over a FAKE page, `web/shared/ui/README.md`; both `ui/render.ts` (shell section -> imports; SHEETS lists stay), both `ui/local.ts`, both `main.ts` (toast/timers), both `ui/page.fake.ts`, `web/shared/edge/page.fake.ts`, `eslint.config.js`, `vitest.config.ts`, `tsconfig.node.json`, `CONTRACT.md` ('Toggled by' rows for `hidden`/`show`/`fixed-screen`/`hit` move to shared; `#toast.hit` stays a backgammon row) | gin `render.test.ts` 21 (7 shell), bg 20 (9), gin `local.test.ts` 3, bg 5, `tools/parity/gin-dom-parity.ts` (`#curtainOverlay` snapshot), the computed-style goldens (class names toggled are unchanged, so no re-record), 16 gin story screenshots, e2e `gin-local`, `backgammon-local` (drives the curtain), `smoke` |
| **B2 Home binder** | `blocksCodeInput`, `tabButtonId`, `fillInputs`, `setCodeInput`, `paintTabs`, `paintPlayMode`, `paintSubmenu`, `paintResume`, `paintHomeShell`, `bindHomeShell` (with `startOptions` and injected intent builders), `bindLongPress` into `web/shared/ui/home.ts`; each game's `paintHome`/`bindHome` become ~8 lines composing shared + own (gin keeps `renderSandbox`/`paintSandbox` + sandbox/scorer listeners ~50; bg keeps `paintOptions` + select listeners ~40) | `web/shared/ui/home.ts` + test, both `ui/home.ts`, both `home.test.ts` (the shared cases move once; game cases stay) | gin `home.test.ts` 12, bg 9, e2e `shell-home`, `shell-resume` (labels), `shell-handoff`, `shell-local`, `backgammon-local` (its own fields), `gin-dom-parity` (`#homeScreen` snapshot); no id or copy changes |
| **B3 Boot helpers** | `applyInviteLink`, `shareInvite`, `sessionEvents` into `web/shared/ui/boot.ts` (or `edge/`), replacing the byte-identical `?join=` block, share chain and `hostEvents`/`guestEvents` adapters in both `main.ts`; bg's `roomCodeMsg` redeclaration goes | `web/shared/edge/boot.ts` + test, both `main.ts`, both `ui/state.ts` (the three share constants out) | e2e `shell-online`, `shell-relay`, `shell-handoff` (`?join=`, SHARE_SHEET/DESKTOP shims, 'Invite copied to clipboard'), `shell-resume`, `shell-local`, `smoke` (hook names) |

B1 and B2 touch different files and run in parallel; B3 follows B1 (it uses `createToaster`). None changes a reducer, so the two `state.test.ts` files are untouched.

### Wave C: the reducer (sequential)

| PR | What moves | Files | Protected by |
|---|---|---|---|
| **C1 Gin adopts `App = {shell, table}`** | Mechanical: gin's 45-field flat `App` split into backgammon's `Shell`/`Table` records, `app.x` -> `app.shell.x`/`app.table.x` across the reducer, painters, `main.ts`, stories catalogue, scorer wiring and `state.test.ts` (2,170 lines); `SHELL_INTENT_TYPES` + `isShellIntent`; `reduce = isShellIntent ? shellIntent : tableIntent`. In the same PR the two games agree the six points and record them in `docs/design/shared-shell.md` §4.3: `Opts` generic; `rendered(app, prev, now)` with `now` threaded (gin ignores it); `table.cleared` hook; `refuse` hook; the copy table; `X` for gin's scorer resume. Also decided here: where `curtain`/`curtainMode`, `history` ('game'/'scorer'/null vs `historyOpen`) and `resultDismissed`/`resultOpen` live, and the dead `hostSeated`/`selectedCard` fields | `web/games/gin-rummy/src/ui/{state,render,home,local}.ts`, `state.test.ts`, `stories/catalogue.ts`, `scorer/main.ts`, `main.ts`; no shared file | all 87 gin state tests, `test/parity/gin.state.test.ts` (save bytes via `saveFor`/`readHome`), `gin-dom-parity` (same intent sequence, same snapshots), every gin e2e spec, the 16 story screenshots; a pure rename, so any diff is a bug |
| **C2 Shared shell reducer + storage** | `reduceShell`, `runShellEffect`, `hostContextOf`/`guestContextOf`, `saveFor`/`readHome` into `web/shared/ui/shell.ts`; `shellStore`/`shellKeys` onto A3's `prefs.ts`; each game's `shellConfig.ts` written; gin's and bg's shell cases delegate; a third suite `shell.test.ts` over a FAKE_GAME covering the flows both suites cover, plus effect ORDER inside `initHome` (fillName, fillP2Name, then setHomeTab without persist), `leaveConfirmed` (wakeLock false, closeNet, leave/finish) and `cancel` (closeNet, cancel/finish) | `web/shared/ui/shell.ts` + `shell.test.ts`, both `ui/state.ts` (shell slice -> delegation; residue = table slice + `Opts` + hooks + gin extensions), both `shellConfig.ts`, both `storage.ts` (`readHome` moves), `vitest.config.ts` (re-measure the ui rows) | gin `state.test.ts` 51 shell tests (the describes 'the initial app', 'home', 'hosting', 'joining', 'pass and play', 'leaving and cancelling', 'resume', 'storage', 'the sessions read back', 'runEffect', 'the remote handoff'), bg 39, `test/parity/gin.state.test.ts`, `test/parity/gin.storage.test.ts`, e2e `shell-resume` (labels), `shell-handoff`, `shell-home`, `shell-local`, `backgammon-local`, `gin-dom-parity` |
| **C3 Shared boot** | `bootShell(cfg)` in `web/shared/edge/boot.ts` (~290 identical lines: store, fx, timers, toast, dispatch with the pointerdown no-repaint rule, session events, EffectDeps, `bindAll` + `paintSound` + warm-on-first-gesture, visibilitychange -> `visible`, `home/init` then `applyInviteLink`); bg `main.ts` -> ~60-70 lines, gin -> ~150-170 (stories early return, scorer, card back, sandbox, layoffs, `copy`); a vitest test over `dom.fake`/`page.fake` so the file enters the coverage group | `web/shared/edge/boot.ts` + `boot.test.ts`, both `main.ts`, `vitest.config.ts` | `main.ts` has no unit coverage today, so: e2e `smoke` (hook-name ternary), `shell-online`/`shell-relay`/`shell-handoff`/`shell-resume`, `gin-online`/`gin-sound-font`/`gin-card-back`/`gin-scorer`/`gin-sandbox`, `backgammon-local`, `expectPeerOptions` (debug stays a per-game parameter, `spec.debug`) |

### Wave D: harness consolidation (section 6), and what is deferred

**D1** `e2e/fixtures/shell.ts` + `shell-{home,local,online,relay,resume,handoff}.spec.ts` over `REGISTRY` (after bg-online, which shipped the four backgammon copies; D1 replaced both games' per-game shell specs with the six shared files, and #69's liveness spec took the same idiom). **D2** `SHELL_SELECTORS` + `driveShell` in `tools/parity/computed-styles.ts`, re-recording all four goldens once (the PR right after bg-online, which re-records backgammon's two anyway). D1 can run beside Wave B; D2 beside B1.

Deferred, with the reason: **shell CSS** (`web/shared/styles/shell.css`, P13) until the Fidice restyle designs three palettes once (gin must first move its literals onto the eleven tokens; every changed declaration re-records 2 games x 2 viewports of goldens and 32 story screenshots). **Shell markup partial** (a Vite plugin or boot-time builders for the 36 common ids and the wait/curtain/toast blocks) together with P13, so goldens, CONTRACT.md rows and `page.fake.ts` migrate once. **Stories boot** (`bootStory`) the day backgammon wants a `?story=` catalogue. **Dice builder** after the Fidice restyle. **Fidice's client/peerjs** onto the shared sessions: a product decision (§4.6).

## 6. The harness consolidation

Three things the harness audit found stale in understand.md: P3 has landed (`tools/games.ts` feeds `e2e/fixtures/site.ts`, `two-players.ts`, `smoke.spec.ts`, `test/dist/*`, `computed-styles.ts`); rows 34/37 ("ternaries in two-players.ts") describe an older file, `DRIVERS` is already an exhaustive `Record<OnlineGame, Driver>`; P9 (eslint `GAMES.flatMap`) is done. What remains is small on main and large in prospect: bg-online's docs promise `e2e/backgammon-{online,relay,resume,handoff}.spec.ts` (426 lines in gin), and written as copies they double the shell suite; written once over a registration they cost ~150 lines. The two pages share 52 ids, every one of them shell, and the copy the specs assert (WAITING_MSG, `reopenedMsg`, the handoff-open message, `joinedMsg`, the three resume labels, the OFFER, INVITE_COPIED_MSG, 'Pass the phone to X') is byte-identical in both `src` trees by copy, not by import.

### 6.1 One registration object (`tools/games.ts`, A5)

```ts
export const REGISTRY: Readonly<Record<Game, Readonly<{
  title: string;                       // 'Gin Rummy' | 'Sheshbesh — backgammon' | 'Fidice': today spelled in 4 places for backgammon (tools/games.ts, games.test.ts, dist-parity.test.ts:131, backgammon-local.spec.ts:84)
  hook: string;                        // 'window.__gin' | 'window.__backgammon' | 'window.__fidice'
  saveKey: string; storagePrefix: string;   // 'ginRummyMP_v1'/'ginRummy_' | 'backgammonMP_v1'/'backgammon_'
  debug: 0 | 1;                        // the PeerJS level expectPeerOptions asserts
  pageShape: Readonly<{ ids: ReadonlyArray<string>; rulesSlots: boolean }>;   // dist-parity's hand-written page tests; fidice {ids: ['app'], rulesSlots: false}
  contractFloors: Readonly<{ ts: number; markup: number }>;                   // class-contract TS_FLOOR/MARKUP_FLOOR: 50/40, 35/40, 50/-1
  shell?: Readonly<{                   // present for the two shell games; fidice has none until its restyle
    tabs: ReadonlyArray<string>;       // ['Play','Rules','Score'] | ['Play','Rules','About']
    hostAnswered: RegExp;              // the guest-answered status (gin state.ts:329; backgammon's arrives with bg-online)
    curtainSub: (first: string, other: string) => string;   // gin `${other}, look away 👀`; bg 'Your turn.'
    connDot: string;                   // '#connDot' | '#oppDot'
    localFields: ReadonlyArray<readonly [id: string, value: string]>;   // gin [['localTargetInput','100']]; bg the two selects
    afterConnect?: (host: Page, guest: Page) => Promise<void>;          // gin ginHostDeals + readTable; bg start + both boards show the seeded opening
  }>;
}>>>;
export const GAMES = Object.keys(REGISTRY) as ReadonlyArray<Game>;
export const SHELL_GAMES = GAMES.filter((g) => REGISTRY[g].shell !== undefined);
```

Consumers: `e2e/fixtures/shell.ts`, `two-players.ts` (`shellDriver('gin-rummy')` one line each; fidice keeps its row), class-contract floors, dist-parity page shape, `computed-styles.ts` `driveShell`, the `shell-*.spec.ts` files: 8 of the 22 per-game lists go. Must stay outside: the `Game` union and `ROOM_CODE` (lib may not import tools), `eslint.config.js` (JS), `tsconfig` (JSON), vitest thresholds (measured ratchets by design), `web/index.html` cards (verified by `check-dist-paths`), the Worker's `ALIASES` (deployed alone, pinned equal by its test).

As landed (D1): the registry row is data only, so `tools/games.test.ts` pins it with `toEqual`: `ShellSpec` = `heading`, `shareTitle`, `tabs`, `modes`, `hostAnswered`, `connDot`, `localFields`, `curtainButtons`, held in `SHELL` (keyed by `ShellGame`, listed by `SHELL_GAMES`) and spread into `REGISTRY[g].shell`. The Page-taking parts sketched above (`curtainSub`, and `afterConnect`, which became `start`/`expectOpening`/`agree`/`snapshot`, plus the save shapes and the curtain offer) are `SHELL_DRIVERS[game]` in `e2e/fixtures/online-games.ts` (`shell-games.ts` until H1), its own file because `gin.ts`/`backgammon.ts` import `shell.ts` (import-x/no-cycle). The fixtures take `game: ShellGame`, not `spec`. Since dry-round-2.md D11 (I6)
the row also names the game's test suite (`suite`: `gin`, `fidice`, `backgammon`) and its own spec
globs (`specs`), and `tools/ci/suites.ts` reads its game rows off the registry: `gameE2e(suite)`
lists `specs` plus the shell specs for a row with `shell` (the two online ones for a row without),
with the `@<game>` tag and the other games' tags; `gameRules(suite)` names the folder.

### 6.2 Shared shell fixtures (`e2e/fixtures/shell.ts`, D1)

`roomCode(page, game)`, `hostRoom(page, game, name)` (asserts `#onlineModeContent`, fills `#nameInput`, clicks `#hostBtn`, waits for `#hostWaitStatus` 'Waiting for your opponent to join' with BROKER_TIMEOUT), `join(page, game, name, code)` (pressSequentially into `#codeInput`, `#joinBtn`, `#guestWaitScreen`, `#guestWaitStatus` toHaveText `SHELL[game].hostAnswered` with WEBRTC_TIMEOUT), `reveal(page)` (`ginReveal` and `bgReveal` are the same 3 statements today), `startLocal(page, url, viewport, names, beforeStart?)` (5 of 8 statements shared; bg passes its selects in `beforeStart`), `resumeLabel(kind, …)`, `readSave(page, game)`. `gin.ts` and `backgammon.ts` keep their table helpers and `export const ginReveal = reveal` so the 20 importing specs do not move in that PR. Land after bg-online so the backgammon `join` has a real guest-answered string to assert.

### 6.3 `describe.each` shell specs

Playwright has no `describe.each`; the repo idiom is `forEach` over the registry (`smoke.spec.ts` `PAGES.forEach`, every VIEWPORTS loop). Each `shell-*.spec.ts`:

```ts
SHELL_GAMES.forEach((game) => test.describe(game, { tag: `@${game}` }, () => { const spec = REGISTRY[game]; /* … */ }));
```

- `shell-home.spec.ts` replaces `gin-home.spec.ts` (44) and `backgammon-local.spec.ts`'s two home tests: the hover walk, the long press (650 ms) opening `#playSubmenu.force-open`, `toHaveText(SHELL[game].tabs)`, the mode switch, the persisted `${storagePrefix}homeTab`/`playMode` keys, `localFields`. Page-only: add to PAGE_ONLY_SPECS (`e2e/fixtures/site.ts` since D11).
- `shell-local.spec.ts`: the shell half of the pass-and-play flow (start -> curtain up with `curtainSub` -> reveal -> `#myName`/`#oppName` -> `readSave` role 'local'); the game halves (take upcard / ghost slot / discard vs opening roll / dice faces / cube / Kapará) stay in `gin-local` and `backgammon-local`. Page-only.
- `shell-online`, `shell-relay`, `shell-resume`, `shell-handoff`: gin's four files (84 + 63 + 69 + 210) parameterised: `peerIdFor(spec.game, code)` from `lib/roomCode.ts` in place of the literal, `expectPeerOptions(call, spec.debug)`, `SHELL[game].connDot`, `SHELL_DRIVERS[game].start`/`expectOpening`. Tags `@online`/`@relay` carry over so `nightly.yml`'s `--grep "@online|@relay"` and ci's e2e/broker jobs need no edit; these run on both projects (they are about origins), so not page-only. Fidice's two specs stayed until the second DRY round's H1 (dry-round-2.md, PR D7): `shell-online` and `shell-relay` now loop over `GAMES`, `e2e/fixtures/shell-games.ts` became `online-games.ts` with an `OnlineDriver` row per game (fidice's driving its legacy lobby: `joined`, `start`, `expectOpening`, `relayToasts: ['guest']`) under the `ShellDriver` rows, and fidice's suite claims those two specs tagged `@fidice`.

### 6.4 Computed styles (D2)

`SHELL_SELECTORS` (the 42 selectors common to gin's 153 and backgammon's 110, all shell) spliced as `[...SHELL_SELECTORS, ...own]`, and `driveShell(page, shot, spec)` (~30 lines: wait for `spec.hook`, the tab tour over `spec.shell.tabs`, the hosting block bg-online copies verbatim from `driveGin`, the mode switch) called first by `driveGin` and `driveBackgammon`; `driveFidice` untouched. Screen names and selector order must stay byte-identical or all four goldens are re-recorded in the same PR (`--check` diffs every screen/selector/property): do it in the PR right after bg-online, which re-records backgammon's two anyway.

### 6.5 Never consolidated

Table drivers (`gin.ts` table half, `gin-play.ts`, the bg board helpers, `bgPosition`), `gin-dom-parity` and the legacy oracle (one game's migration proof), `backgammon-grid.test.ts`, CONTRACT.md rows (each documents its game's template-built classes; the two `connDotClass` rows merge into one `shared` row when the painters move, and the Rules sentence should read 'a GAMES member or shared'), vitest threshold ratchets, the nightly replay steps (two lines each), gin's stories stack (31 stories, 120 PNGs) until backgammon wants screenshots. Fidice keeps its 42-line driver: 0 ids and 10 selectors in common.

## 7. Risks

| # | Risk | Where it bites | Mitigation in the plan |
|---|---|---|---|
| 1 | **Lint zones gate every move.** `web/shared/ui` and `web/shared/net` have no zone row; the games' `net/` zone may import only the transport/clock/peer edges (`eslint.config.js` 226-244); the storage zone excepts only `edge/storage.ts` (288-294); `RNG_ALLOWED` is `web/games/*/main.ts` + `web/shared/edge/**`; shared code may never name a game | A1, A3, B1, C3: the first import fails lint | Each folder's first PR adds its zone row, the `except` entries and the EDGES glob; `boot.ts` takes `rng`/`now`/`clock` from `main.ts` or lives under `edge/`; every game literal (id, keys, titles, copy, codecs) is injected through `ShellGame` |
| 2 | **Coverage ratchets.** `web/shared/lib/**` is 100/100/100/100 and `web/shared/edge/**` 94/94/93/90 (`vitest.config.ts` 61-62); the game rows (net, protocol, storage, fx, ui) are measured-minus-margin and will hold 20-100 lines each after the moves; a `main.ts`-derived boot has no unit test today | Every wave | New groups measured in the same PR at gin's values; the shrunk rows re-measured (never lowered on a live body); `boot.test.ts` over `dom.fake`/`page.fake` before `boot.ts` enters the edge or ui group; a partially used option in a shared function shows as an uncovered line in the shared group, so no speculative parameters |
| 3 | **Wire bytes are frozen** on both sides: 13 legacy gin-wire fixtures (`test/parity/gin.protocol.test.ts`, `gin.sessions.test.ts`), 7 backgammon-wire goldens; storage literals by 17 gin captures and bg's 'frozen constants' | A1, A2, A3, C2 | `welcome`/`lobby` spread the room after `hostName`; `saveLiteral` keeps `role, code, myName, <extra>, game, oppName, handoff?`; keys stay literal per game (`ginRummyMP_v1` has no separator, `ginRummyScorerState_v2` no prefix rule); the peer prefix is passed as `Game`, never derived (`sheshbesh-`) |
| 4 | **The DOM-parity oracle** (`tools/parity/gin-dom-parity.ts`) snapshots gin's `#homeScreen` and `#curtainOverlay` against the legacy page through one intent sequence, and gin's shell is pinned by effect ORDER (`initHome`, `leaveConfirmed`, `cancel`) and by e2e copy (`shell-resume` labels, `shell-handoff`) | B1, B2, C1, C2 | Code moves, never rewrites; the static markup stays per game; `shell.test.ts` asserts the three effect orders explicitly so the shared suite is not weaker than gin's 51 |
| 5 | **The class contract and goldens.** `CONTRACT.md` names an owner per toggled class; `computed-styles` goldens are keyed by screen name and selector; 16 story screenshots x 2 platforms can only be re-recorded on linux | B1, D2, P13 | B1 changes no class name or toggle target; D2 keeps names/order byte-identical or re-records all four goldens in the PR after bg-online; P13 deferred to the Fidice restyle; `expectHandRows` unchanged by A5 |
| 6 | **PR-D (bg-online) is unpushed and edits exactly the shell slice**; bg-polish only `theme.css`; the backgammon title is being edited concurrently in four places | Waves B-D | Wave A touches none of PR-D's 14 files; B-D wait; the title lives once in `REGISTRY` (A5) |
| 7 | **The six agreements** (Opts, `now` threading, `table.cleared`, `refuse`, copy, gin's scorer resume) and the App-shape precondition: gin's flat 45-field `App` vs backgammon's `{shell, table}`; where `curtain`/`curtainMode`, `history`, `resultDismissed` live; the `Effect`/`Intent` unions differ (gin writeSort/writeCardBack/copy/scorer; bg writeVariant/writeMatchLength/writeCurtainMode), and `Extract<Intent, {type}>` over generic unions is where the lift stops being mechanical | C1, C2 | C1 is a rename-only PR that also writes the agreements down; C2 returns `ShellEffect` and each game widens in its own `runEffect`; budget a design note before C2 (the shell audit's advice) |
| 8 | **Gin's extensions** (Score Counter 948, sandbox 392, stories 998, card back/sort) reach into its shell as the 'score' tab, `Resume {kind: 'scorer'}`, `history/open who`, `scorer`/`copy` effects, `cardBack/set` | C2, C3 | Modelled as extension points (`X` resume slot, `extraEffects`, `hookExtras`, the tabs list) so the shared shell never learns a scorer; otherwise gin's 2,170-line `state.test.ts` forces scorer seams into `web/shared` |
| 9 | **Test-protection asymmetry**: gin 51 shell reducer tests vs bg 39; home 12 vs 9; local 3 vs 5; render shell-ish 7 vs 9; `main.ts` none | C2, C3 | Both suites keep running against wrappers unchanged; the third suite over `FAKE_GAME` covers the union of both describes |
| 10 | **Shared e2e specs couple two games' copy**: a wording change in one game's WAITING_MSG, resume labels or OFFER breaks the other's run unless the string is per game in `REGISTRY`; Playwright's `forEach` idiom changes test titles, `--grep` habits and CI blame; PAGE_ONLY_SPECS is per file | D1 | Per-game strings in `REGISTRY.shell`; `shell-home`/`shell-local` page-only, the online four not; alternatively import each game's constants from `src/ui/state.ts` into e2e (tsconfig.node already includes both trees) at the cost of e2e depending on game source |
| 11 | **Drag feel**: gin's dragger has momentum/tilt via a per-frame `nextFrame` loop (FOLLOW 0.35), bg tracks the pointer directly; pinned only by unit tests over fake rects and a few e2e specs | A6 | The frame loop is a `motion` plug-in, 'direct' the default; A6 is optional and outside the shell |
| 12 | **Fidice's other architecture.** Designing for it now bends the gin/bg shape (static ids, effects as data) for a game that will not use it before its restyle; replacing its client with the shared guest session changes pinned behaviour (12 s timeout -> 40 x 3 s retries, 3 s vs 1.5 s path toast, wording) and breaks `fidice.sessions.test.ts` by design | §4.6 | Only the pure helpers stay fidice-ready; client/peerjs adoption is a product decision; the 'three games' story remains two plus one until the restyle |
| 13 | **Small drifts** a shared module would freeze or must reconcile: bg `DEFAULT_PLAY_MODE` 'local' (`ui/state.ts:254`) vs 'online' (`storage.ts`); bg `main.ts:56` `roomCodeMsg`; bg's static 'Opening the table…' painted over by 'Opening room…'; two rewritten header comments made a 5-hunk copy look like 61 changed lines | A1, B3, C2 | `modes.default` in the config resolves the first when PR-D flips ONLINE_MODE_SHOWN; B3 deletes the second; the copy table names the third; the shared header is written once in `web/shared/net`, wrappers carry one line |
| 14 | **Measurement hygiene**: another agent overwrote a shared scratchpad script mid-audit; the harness audit's `git diff origin/main...origin/bg-online` was empty because the work is uncommitted | This document | Every number was recomputed with privately named scripts and is reproducible from `main`; the in-flight picture comes from `git status` in `scratchpad/bg/wt-a` and `wt-b` and can change before those PRs open |
