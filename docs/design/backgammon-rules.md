# Sheshbesh: the rules the engine plays

The settled rules of `web/games/backgammon/src/engine/` (PR #53), distilled from the design's
section 3. Two rulesets ship: **portes** (the first game of the Greek tavli set, the default) and
Western **backgammon**. Plakoto and fevga exist as `Variant` literals with `implemented: false`
rows in `VARIANTS`; `ShippedVariant` excludes them, `createGame` is typed on it and every decoder
refuses them. `docs/design/backgammon-board.md` is the table screen that plays these rules.

Numbering: every rule and every test row is written in the mover's **own** numbering, 1..24 from
the mover's bearing-off edge; absolute indices 0..23 are the storage frame. Seat 0 (Light, the
host) moves toward abs 0, so `own = abs + 1`; seat 1 (Dark, the guest) moves toward abs 23, so
`own = 24 − abs`. Own 1..6 is home; a checker entering from the bar with die `n` lands on own
`25 − n`; a checker on the bar counts 25 pips. Both shipped rulesets start `24:2 13:5 8:3 6:5`
for each side (absolute `0:D2 5:L5 7:L3 11:D5 12:L5 16:D3 18:D5 23:L2`), 167 pips each.

## 1. Decisions

| # | Question | Decision |
|---|---|---|
| Q1 | Default ruleset | `portes`: no cube, a gammon doubles and nothing triples, the opening winner rerolls both dice. Western `backgammon` (cube, triple, Crawford) is selectable on the home screen. |
| Q2 | Portes "no hit-and-run at home" | Not implemented (an unverified rule). |
| Q9 | Who rolls online | The host, from the injected `rng`; the guest sends `{type: 'roll'}`. The rules panel says so. |
| Q13 | Undo online | Host-applied rewind (`undo`), rebroadcast as a `state` frame. |
| Turn end | No `done` action: the turn ends by itself when no maximal play extends what was played (R13). The last die of a turn is therefore not undoable; the status line says so before the tap. |
| Phase | `'opening' \| 'toRoll' \| 'cubeOffered' \| 'moving' \| 'over'`. `canDouble` is derived (no `toDouble`). `'opening'` is reserved: `createGame`/`nextGame` resolve the opening roll before returning, `actorOf` is `null` in it and `applyAction` refuses everything in it with `OPENING_PENDING`. |
| Resignation | Reserved for v1.1: the `resign*` actions and a `resignOffered` phase are named, not shipped. |
| Money flags | `jacoby`, `beavers`, `automaticDoubles` are stored `false` and never settable (R20). |

## 2. Types (`types.ts`, key order is the wire and save order)

- `Seat = 0 | 1`, `Die = 1..6`, `Dice = [Die, Die]` as rolled (Western opening: `[hi, lo]`),
  `PointIndex = 0..23`, `From = PointIndex | 'bar'`, `To = PointIndex | 'off'`.
- `Stack = ReadonlyArray<Seat>` bottom to top (homogeneous in both shipped rulesets; plakoto would
  pin by pushing on top); `Board = { points: 24 stacks, bar: [n, n], off: [n, n] }`.
- `Move = { from, to, die }`: the die is part of the identity (with 6-5 and a lone checker on own 4,
  `4/off(6)` and `4/off(5)` are different moves). `PlayedMove` adds `hit: boolean`.
- `Cube = { value: 1 | 2 | 4 | 8 | 16 | 32 | 64, owner: Seat | null }`; `Match = { length, score,
  crawfordDone, isCrawfordGame }` (no stored winner: `matchOver(match)` derives it).
- `State`: players, options (`matchLength`, `rotation`, the three flags), this game's `variant` and
  `gameNo`, `phase`, `turn` (never null), `board`, `opening` (the decisive dice), `dice` (kept on
  display after the turn ends), `played` (this turn, in order; `movesLeft` is derived), `lastPlay`
  (the previous completed turn's `played`, so the opponent's moves animate and the curtain can name
  them), `turnStart` (the board when the dice were rolled, non-null iff `moving`), `cube`, `match`,
  `result`, `games` (finished games of this match), `log`, `lastAction`, `startedAt`, `endedAt`.
- `View` = the state plus per-seat selectors: `me`, `opp`, `actor`, `isMyTurn`, `movesLeft`,
  `legal` (the distinct next moves, sorted by `moveKey`: `from` ascending with `bar` first and
  `off` last, then `to` ascending, then `die` descending), `plays` (the maximal plays consistent
  with `played`, capped at `PLAYS_CAP = 512` with `playsTotal` the true count: doubles can reach
  tens of thousands of sequences, which no `state` frame should carry), `canUndo`, `canDouble`,
  `canBearOff`, `pips`, `matchOver`. Nothing is hidden in backgammon: both seats see one board.
- `Action = roll | move {from, to, die} | undo | double | take | pass | next`.

## 3. The rules (R5–R28)

| Rule | Semantics |
|---|---|
| R5 opening, Western | Each seat rolls one die; a tie logs `Both rolled 4 — again` and rolls again. The higher roll starts **in `moving`** with `dice = [hi, lo]` as the first move (`Ari rolled 3, Jeff rolled 1 — Ari plays 3-1`). |
| R6 opening, portes | The same single dice; the winner starts **in `toRoll`** and rolls two fresh dice (doubles possible): `Ari rolled 3, Jeff rolled 1 — Ari starts`. |
| R7 roll | Exactly two `rng` calls. If no first move exists the turn is forfeited inside `roll`: one `noMove` log line (`Ari rolled 6-6 and cannot move`), `turn` flips, the phase stays `toRoll`, the dice stay on display. Otherwise `moving`, `turnStart = board`, a `roll` line (`Ari rolled 3-1`, doubles `6-6`). |
| R8 blocking | A point with two or more opposing checkers is closed (`blocksAt: 2`). |
| R9 one checker, two dice | Consecutive single-die moves; each step obeys R8 on its own. |
| R10 hitting | Landing on a lone opposing checker sends it to the bar; `played[i].hit` records it. Any number of hits per turn. |
| R11 the bar | With a checker on the bar the only move is `bar -> own 25 − die` if open. Both orders are tried, so 6-1 against a closed 6-point enters with the 1 and then plays the 6 anywhere; with two on the bar only the 1 enters and the 6 is forfeited; if neither die enters the roll is forfeited (R14). The entering checker may continue. |
| R12 obligation | Play as many dice as any order allows; when only one die can be played, the higher one if it can. Only first moves that keep the maximum reachable are offered. Doubles: up to four moves. |
| R13 what may be offered | `legalMoves(state)` = the next moves of the maximal plays consistent with `played`. `move` is refused with `ILLEGAL_MOVE` unless it is one of them; then the board and `played` advance, `lastAction` reads `Ari moved 8/5*` live, and the turn ends the instant no maximal play extends `played` (including when unplayable dice remain). Fifteen off ends the game. |
| R14 no move | Forfeited inside `roll` with the `noMove` line; the UI keeps the dice visible for 1.2 s before the curtain rises. |
| R15 bearing off | Allowed when the bar is empty and every checker is on own 1..6; a checker hit while bearing off suspends it until it is home again. |
| R16 the die | Die `n` bears off from own `n` exactly; from own `p < n` only when `p` is the highest occupied point; from own `p > n` it is an ordinary move to `p − n`. Moving inside the home board is always offered when legal; a bear-off counts as one move toward maximality. |
| R17 Western multiplier | At fifteen off: 1 if the loser bore off anything; else 3 if the loser has a checker on the bar or in the winner's home board (own 19..24); else 2. `points = multiplier × cube.value`. |
| R18 portes cap | `maxMultiplier: 2`, cube fixed at 1. The text says "gammon" (plain English throughout). |
| R19 the cube | `canDouble` = the ruleset has a cube, `toRoll`, my turn, not the Crawford game, the cube centred or mine, value below 64. Refusals in order: `NO_CUBE(name)`, `CRAWFORD`, `NOT_CUBE_OWNER`, `CUBE_MAX_MSG`; `CANT_DOUBLE_NOW` after rolling. `double` -> `cubeOffered` (`Ari doubles to 2`); `take` by the other seat -> `{value × 2, owner: taker}`, back to `toRoll`, the doubler rolls (`Jeff takes at 2`); `pass` -> the game ends at the pre-double value, `reason 'passed'` (`Jeff passes. Ari wins 1 point`). |
| R21 the match | `matchOver` when either score reaches `length` (any integer ≥ 1; the UI offers 1, 3, 5, 7). `next` at `over` starts game `gameNo + 1` with `variant = rotation[gameNo % rotation.length]`, a fresh board, a centred cube, the Crawford flags recomputed, `Game 2 begins` (or `— the Crawford game`) then the opening entries; refused with `MATCH_OVER` once the match is decided and `GAME_ON` while a game is on. |
| R22 Crawford | Evaluated by `createGame` and `nextGame`: with a cube, once a score first reaches `length − 1`, the next game is the Crawford game (no doubling) and `crawfordDone` is set; a 1-point Western match's only game is the Crawford game. Cube-less rulesets: both flags stay false. |
| R23 rotation | `rotation` is a non-empty list of shipped variants (default `[DEFAULT_VARIANT]`); game *n* uses `rotation[(n − 1) % length]`. |
| R24 pips | `Σ own(point) × count + 25 × bar`. |
| R26 undo | While `moving` with something played: the board back to `turnStart`, `played` to `[]`, `lastAction` `Ari took the moves back`, no log line. `NOTHING_TO_UNDO` otherwise. Not possible once the turn has ended. |
| R27 dice | `rollDie = min(6, floor(rng() × 6) + 1)`. `rng` is read only by `createGame`/`nextGame` (`2 × (ties + 1)` calls) and `roll` (2). |
| R28 the log | One `move` line per turn at its end (`Ari moved 8/5* 6/5`, own numbers, `bar`/`off`, `*` for a hit, adjacent equal moves collapsed to `13/7(2)`, the die never written), then one `hit` line per hit (`Ari hit Jeff on the 5-point`), then `bearOff` (`Ari bore off 2 · 9 off`); at the game's end the same then `result` (`Ari wins 2 points (gammon)`, `Ari wins 4 points (gammon, cube 2)`, with ` and takes the match 5–2` when the match ends). |

Actor and refusal order: `actorOf` is `null` in `opening` and `over`, `turn` in `toRoll` and
`moving`, the other seat in `cubeOffered`. `applyAction` checks the phase (`OPENING_PENDING`,
`GAME_OVER`, `MATCH_OVER`, `GAME_ON`), then the seat (`NOT_YOUR_TURN`), then the action per phase:
`toRoll` takes `roll`/`double` (else `ROLL_FIRST`, `NOTHING_TO_UNDO`, `NO_DOUBLE_PENDING`),
`moving` takes `move`/`undo` (else `ALREADY_ROLLED`, `CANT_DOUBLE_NOW`, `FINISH_MOVE`),
`cubeOffered` takes `take`/`pass` (else `ANSWER_DOUBLE`). Every text is a `MESSAGES` entry; the host
sends a guest's refusal back as a `toast` frame.
