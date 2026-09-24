# Sheshbesh: the table screen and its shell

The design `web/games/backgammon/` is built from, distilled to what a reader of the code needs:
the decisions, the one DOM that serves both viewports and both seats, the CSS plan, the
interaction model, the shell, and the harness registration. The rules the table plays are
`docs/design/backgammon-rules.md`; the engine is `src/engine/` (PR #53). Conventions follow gin:
static ids in `index.html`, a pure `reduce`/`runEffect` (`ui/state.ts`), painters over
`web/shared/edge/dom.ts`, markup builders tested as strings, `body.fixed-screen` with no page
scroll. Seat 0 = Light (host), seat 1 = Dark (guest); "own N" is the viewer's own numbering.

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
| Geometry | `--point-w` 47px at 390x844, checkers 40px, a 28.6px coin step; below 806px tall the document scrolls instead of clipping; `touch-action: none` on `.checker` only. |
| Input | Tap-to-move, one tap per move, the sole legal source auto-selected (`.selected.auto`, ring without lift); drag through gin's dragger reshaped (`ui/board/dragger.ts`). |
| Ambiguity | A die-chip tray in the controls row (`#moveChips`, 56px chips labelled with the dice and the destination) only when a choice exists: a bear-off both dice suffice for, or two orders of a combined move whose intermediates differ. The trays always name the die they will spend (`data-die` "6", "6·5"). |
| Which die | `.die.dead` when no maximal play uses a die; tap a die to force it (`die/pick`, targets recomputed for that die alone). |
| Status line | Always names what is left ("3-1 · play both dice", "6-5 · the 6 cannot be played", "6-1 · enter from the bar", "Last move: the turn ends when you play it"), the dice in words in a visually hidden span. |
| Stacks | Five checkers drawn; a count badge on the top visible checker from the sixth on; the point label stays. |
| Accessibility | Every tap target ≥ 44px on the phone (the geometry e2e asserts it), a painted `aria-label` per place, Enter/Space on a focused place is its tap, Escape closes the sheet or the tray. |
| Theme | "Subtle but recognizable": whitewash page, aegean blue the one accent, olive-wood board, gold only as a hairline, one low-contrast meander line on the frame. The dark checker a deep-blue disc with a fine blue ring (the eye motif as a subtle inner ring, never a literal eye); the light one a pale disc with a soft sheen. Checkers, dice and frame are CSS only, no images. GFS Didot for the title and the room code, Cardo for everything else, both from Google Fonts. |
| Online | Hidden in the first page PR (`ui/state.ts ONLINE_MODE_SHOWN = false`: the mode switch, the Online panel and the curtain's "Continue online" are hidden and pass-and-play is the default); the sessions, protocol and storage shapes are already in place for the online PR. |

## 2. The one DOM

`#tableScreen`: `.topbar` (`#menuBtn`, the opponent strip `#oppName #oppDot #pipsOpp`,
`#gameBadge` "Game 3 · 2–1 · to 5", `#rulesBtnGame #historyBtn` on the desktop, `#soundBtn`),
`#statusLine` (`#statusText`, `#statusDice.sr-only`), `#board`, `.controls` (`#myName #pipsMe`,
`#undoBtn` disabled rather than hidden, `#doubleBtn`, the reserved hidden `#doneBtn`, the roll
slot holding `#rollBtn` "Buen mazal! roll" / `#diceMini` / `#waitNote` / `#resultChipBtn`, then
`#moveChips` and `#chipCancelBtn`). Points carry `data-abs` (static), `data-own`, `pt-a`/`pt-b`
(absolute parity, the two triangle shades) and `pt-near`/`pt-far` (own 1..12 near). `#barTop` is
always the far player's bar and `#barBottom` mine; `#offLight`/`#offDark` are colour-fixed and CSS
places them near or far by `#board[data-seat]`. `paintSeat` rewrites `data-own`, `pt-near`/`pt-far`
and `data-seat` only when the seat differs, so the markup ships seat 0's and the page fake and the
goldens see a whole board before any paint.

Static vs. rebuilt: each place has a `data-key` (`L5`, `D2`, `-0` for the points and bars; the
count for the trays; dice `6-5:dl:-:0`, faces plus used/dead/picked/roller) and its children are
rebuilt only when the key changes (`checkersHtml`, `slabsHtml`, `diceHtml`, `chipsHtml` in
`ui/board.ts`, string-tested). Highlights (`can-move selected auto target target-2 only hit shake
drop`), `data-die` and the `aria-label`s are toggled outside the key, so a selection never rebuilds
a stack and the `.selected` lift transitions. A move changes the key of exactly two containers
(three with a hit); `ui/board/fly.ts` supplies the visual: it measures the top checker before the
repaint, marks the arrival `arriving`, clones the source into the body as a fixed `.flyer`
(`.flyer-slab` toward a tray) and FLIPs it into the arrival's rectangle over `FLY_MS` (260 ms; a
hit's flight to the bar starts 80 ms later). Flights come from the pure `flightsBetween(prev,
next)`: the new `played` moves (plus hit → the opponent's bar), an undo reversed, a finished turn's
`lastPlay` beyond what was already shown; more than four flights or a new roll repaint cold.

Other screens and sheets keep gin's ids: `#homeScreen` (`#topTabbar` Play/Rules/About with the
long-press mode submenu, `#playModeSwitch`, `#onlineModeContent` with `#nameInput #matchLengthSel
#variantSel #hostBtn #codeInput #joinBtn`, `#localModeContent` with `#p1NameInput #p2NameInput
#localMatchLengthSel #localVariantSel #localBtn`, `#resumeBox`), `#hostWaitScreen`,
`#guestWaitScreen`, `#endgameScreen` (`#resultTitle #resultSub #matchScore #nextGameBtn #leaveBtn`),
`#curtainOverlay` (`#curtainTitle #curtainSub #curtainLast #curtainBtn #curtainHandoffBtn`),
`#resultOverlay` (`#rsTitle #rsSub #rsScore #rsNextBtn #rsPeekBtn`), `#cubeOverlay`
(`#cubeOfferText #takeBtn #passBtn`), `#rulesOverlay`, `#historyOverlay`, `#menuOverlay`
(`#menuRulesBtn #menuHistoryBtn #menuCurtainToggle #menuLeaveBtn`), the reserved hidden
`#resignOverlay`, and `#toast` last.

## 3. CSS

Tokens (`theme.css :root`): the eleven shared names are redeclared on this palette (a partial
override would inherit gin's green felt; `test/tokens.test.ts` and `CONTRACT.md` "Tokens" hold
it): `--bg #f4efe6` (whitewash), `--card #efe8dc`, `--card-2 #e4dac4`, `--accent #0b3c5d`
(aegean, the one accent), `--accent-dark #06253d` (the dark checker, the curtain wash), `--gold
#c9a227` (hairlines only), `--text #2a1a12`, `--muted #7a6a58`, `--danger #b7472a`, `--radius
12px`, `--felt` the olive-wood gradient. Game tokens, only the ones a rule reads: `--olivewood-dark
--stone --olive --olive-leaf --nazar --nazar-pale --walnut --nacre-sheen --serif-display
--serif-text`. Geometry lives on `#tableScreen` like gin's `--card-w`: `--chrome-h`, `--bar-w`,
`--off-h`, `--point-w` (a `clamp()` of the viewport height: 47px at 390x844, floored at 44px),
`--point-len`, `--checker-d`, `--stack-step`, `--die-s`, with a desktop set from 900px.

Layout: `#board` is one grid with two `grid-template-areas` templates whose area names are own
numbers (`o1..o24`, `barTop`, `dice`, `barBottom`, `offFar`, `offNear`). The phone template is
fourteen rows (six points a side, the bar band, six more, the off row) in six columns; the desktop
template two rows of fourteen columns with the dice and the cube spanning the bar column.
`.point[data-own="N"] { grid-area: oN }` (24 one-liners) and `#board[data-seat]` for the trays are
the whole seat mapping; the phone's near column points left and the far column right, the desktop's
far points hang from the top edge and the near ones rise from the bottom. A checker's place is a
pure function of its index `--i`, the side (`--sx/--sy`) and `--stack-step`, so the same markup lays
out sideways on the phone and vertically on the desktop; the sixth checker on is `display: none`
and the count badge sits on the top visible one. The frame is `#board`'s padding over `--felt`
with a gold inset hairline; the meander is `#board::before`, two `repeating-linear-gradient`s in
`--gold` at low opacity; the centre seam is painted into `#board`'s background. Highlight states
(`can-move` glow, `selected` ring and lift, `selected auto` ring only, `target`/`target-2` die discs
from `::after { content: attr(data-die) }`, `hit` flash, `shake`, `arriving` hidden, `inert` on the
board, `theirs used dead picked` on dice, `rolling` on `#dice`, `choosing` on `#controls`) are the
rows the class contract lists; `prefers-reduced-motion` disables the animations and shortens the
flyer's transition to 1ms so the fallback timer is the only delay.

Below 806px tall (`@media (max-height: 805px)`) the document scrolls instead of clipping, gin's
rule with the threshold derived for this board.

## 4. The interaction model (`ui/state.ts`, `App = { shell, table }`)

`Table = { selected, picked, pending, drag, shake, resultOpen, menuOpen, historyOpen, curtain,
curtainMode, noMoveUntil, lastPainted }`. One delegated click on `#board` dispatches `point/tap
{abs − 1}`, `bar/tap`, `off/tap`, `die/pick` (a live die while moving) or `roll/click` (the dice
before a roll); the reducer knows which bar and tray are mine. With `sel = effectiveSelection` (a
tapped source, else the sole legal source) and `T = targetsOf(view, sel, picked)` from
`ui/board.ts`: a tap on a source selects it, on the selection deselects, on a target reached by one
chain commits its moves in order (one `move` action each), on a target reached by chains that differ
in consequence opens the tray (`pending`), elsewhere shakes the point. The tray's chips commit one
chain each; `chip/cancel` (the ✕, a tap on the board, Escape) closes it. `chainsFrom` extends
same-checker chains through the engine's `legalFirstMoves` after each step (at most four deep), so
two-die targets and the dead dice are exact from `board` and `movesLeft` without the capped `plays`.

Commit = `applyAction(game, seat, move, rng, now)` locally or on the host; a guest sends one
`{t: 'action'}` frame per move. Turn end is the engine's (no `done`). Undo (`#undoBtn`, disabled
not hidden) rewinds to `turnStart`. Roll: `#rollBtn` (or the dice) when it is my turn and `toRoll`;
`#diceMini` in its slot while moving, `#waitNote` during the opponent's turn, `#resultChipBtn` when
the result sheet was peeked away. Western: `#doubleBtn` beside Roll when `canDouble`; the responder
sees `#cubeOverlay` ("Ari doubles to 2. Take or pass?"); `#cube` shows the value and slides to the
owner's side by `data-owner`. In portes the cube, the button and the sheet stay hidden.

The curtain (local role): when the turn flips, a game starts or a double is offered the reducer
sets `curtain = actorOf(game)` and `paintCurtain` raises `#curtainOverlay`: "Pass the phone to
Jeff" / "Your turn." / the last move or noMove line / a button that reads "Jeff — roll" (reveals
and rolls), "Jeff — your turn" (Western `toRoll` with the cube), "Jeff — play 6-3" (the Western
opening, reveals only) or "Jeff — answer" (a double). A forfeited roll (R14) keeps the roller's dice
on show for `NO_MOVE_MS` (1.2 s) before the curtain rises. `curtainMode: 'never'` (the menu
toggle) skips it; the roll button then carries the incoming player's name.

Result: `#resultOverlay` opens for both seats at `over` ("Ari wins 2 points · gammon", "Jeff had 4
checkers left · 61 pips", "Ari 2 – 0 Jeff · match to 5", Next game / Look at the table); when the
match is decided `#endgameScreen` replaces the table ("Ari takes the match 5–2", one row per game,
Rematch, Leave). The hit toast ("Kapará. Jeff hit you on the 5-point.") fires on the hit player's
device from the diff of views, never from log text.

## 5. The shell

Copied from gin's `ui/{state,render,home,local}.ts` minus the scorer and the sandbox, with the
same field, intent and painter names so the shared shell reducer (P6) stays a mechanical lift:
`Shell = { role, code, myName, matchLength, variant, game, view, oppName, oppConnected,
nameTouched, revealed, homeTab, playMode, p1Name, p2Name, screen, netAttempt, hostStatus,
guestStatus, startGameVisible, handoff, savedName, resume, rulesOpen, cues, submenuOpen,
longPressed, codeDraft, soundFont }`. Home: tabs Play/Rules/About (`backgammon_homeTab`), the mode
switch (`backgammon_playMode`; Online hidden this PR), name inputs ("Ari", "Jeff"), the match length
(1/3/5/7, default 5) and the ruleset (portes/Western), the room-code form with gin's `beforeinput`
guard, the resume box from `resumeFor(save)`, the rules panel from `ui/rules.ts RULES_ITEMS[variant]`
(plain English), an About panel of two short paragraphs. Copy: Open a table · Sit down · Start;
"Waiting for your opponent to join · code ABCD"; roll "Buen mazal! roll"; share title `Sheshbesh`.
Sound: `src/fx.ts` plays the table's cues (`roll place hit bearOff yourTurn win lose double` in
`ui/sound.ts`) in the App's sound font through `web/shared/edge/sound.ts`; `#soundBtn` toggles
`backgammon_sound`; `__backgammon.soundFont(name)` picks a font from the console.

Protocol, storage, net (`src/protocol.ts`, `src/storage.ts`, `src/net/`): gin's shapes with
`matchLength` and `variant` in place of gin's `target` (`welcome`/`lobby` frames, `HostSave`),
`state` frames carrying `viewFor(game, 1)`, one self-recorded JSON golden per frame under
`test/fixtures/backgammon-wire/`; storage keys `backgammonMP_v1 backgammon_name backgammon_p2Name
backgammon_homeTab backgammon_playMode backgammon_sound backgammon_soundFont backgammon_variant
backgammon_matchLength backgammon_curtain`; `net/{host,guest}.ts` are gin's sessions with
`peerIdFor('backgammon', code)` (`sheshbesh-ABCD`) and the protocol imports, every timing and
message verbatim, to collapse onto a shared `web/shared/net/` later.

## 6. Registration and gates

`web/shared/lib/roomCode.ts` (`Game` += `'backgammon'`, the `sheshbesh-` row), `tools/games.ts`
(`GAMES`, `PAGE_TITLES`, `HOOKS`; `LEGACY_GAMES` stays gin and fidice), the landing card in
`web/index.html`, `eslint.config.js` (the pairwise game zones come from its `GAMES`),
`tsconfig.node.json` (the src tree included, the DOM modules excluded by name, as gin's),
`vitest.config.ts` (coverage rows and thresholds at measured minus 5/5/5/3), the dist guards
(`GAMES`-driven; `dist-parity` splits `GAMES` from `LEGACY_GAMES`; `class-contract` floors are per
game because the board builders make most names by template), `backgammon-grid.test.ts` (the two
grid strings against `ui/board/layout.ts`), `test/tokens.test.ts`, `playwright.config.ts
PAGE_ONLY_SPECS` (`backgammon-local`, `backgammon-geometry`), `tools/parity/computed-styles.ts`
(`SELECTORS.backgammon`, `driveBackgammon`; the two goldens under `test/fixtures/styles/`),
`.github/workflows/nightly.yml` (`BG_REPLAY_GAMES=1000`). `index.html` and `theme.css` are new
files with no legacy twin and stay Prettier-formatted (no `.prettierignore` entry).

## 7. The computed-style driver

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
A second capture agrees with the first byte for byte (`--check`: 0 differences on all six goldens).
