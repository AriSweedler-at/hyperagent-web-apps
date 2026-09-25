# Briscola: the rules the engine plays

The settled rules of `web/games/briscola/src/engine/`, distilled from the briscola design's section
2 (`docs/design/briscola.md` points at the plan). One N-seat engine plays 2, 3 and 4 players: seats
are `0..n-1`, the host is seat 0, play runs to the next seat index, and with four the even seats are
one side (seats 0+2 against 1+3, partners opposite). The code's comments cite this document by rule
(`E4`, the rows of §2) and by decision (`D8`, the rows of §1). Sources: English and Italian
Wikipedia (incl. *Varianti della briscola*), Board Game Arena, Denexa, Gamelearn, DimensionePoker,
Sky TG24, Loodens and a GitHub mirror of pagat.com; every rule below is corroborated by at least one
page read in full.

Words: *briscola* is the trump suit and the card turned up to name it (this text says "the trump
card" for the card); a *trick* is a *mano*; a *game* is one deal of 120 points; a *match* is games
to a target.

## 1. Decisions

| # | Question | Decision |
|---|---|---|
| D1 | Player counts | 2, 3 and 4 in one N-seat engine. `seatCount` is `players.length`, which the `Players` tuple union fixes at 2, 3 or 4. Five (chiamata) and six are out of scope. |
| D2 | Default variant | Plain briscola: 40 cards, no follow-suit obligation, ranks A 3 R C F 7 6 5 4 2, points 11/10/4/3/2, three cards each, the trump card under the stock and drawn last, winner draws first and leads. |
| D3 | Options | `gamesToWin` 1/2/3 (default 2, "Best of 3"); `removedTwo` (3 players, default coppe); `exchange` (off), `scoperta` (off, 2 players only, stored `false` otherwise), `partnerPeek` (off, 4 players only, stored `false` otherwise). Signals and talking are copy, not a flag. |
| D4 | The 61-point rule | The side with the strictly highest total wins; a tie for the top is a draw (`winner: null`). With two sides this is exactly 61 wins / 60–60 draws; with three players nobody needs 61 and 40-40-40 or 45-45-30 draw. No cappotto bonus. |
| D5 | 3-player deck | 39 cards: the 2 of `removedTwo` leaves (default the 2 di coppe). 13 tricks, 120 points intact. |
| D6 | 4-player teams | `side = seat % 2`: seats 0+2 against 1+3, partners opposite. Join order decides partnerships; a seat swap is v1.1. |
| D7 | Match format | `Match = {gamesToWin, wins per side, draws}`; a draw counts for nobody; `next` deals again; the deal passes to the next seat. Default best of 3. |
| D8 | Dealer of game 1 | One rng draw (`min(n − 1, floor(rng() × n))`), then rotation. |
| D9 | Running score | Live and public in every view: `taken` (points per seat), `tricks` (per seat), `sides` (points per side). A hidden or tricks-only score is a later per-device preference, never a room option. |
| D10 | Card identity | `id = LABEL[r] + s`: `AC`, `7D`, `FS`, `CB`, `RB`; ranks 1..10 with 8 fante, 9 cavallo, 10 re; suits `C D S B`. The shared card vocabulary's `italian40` (PR-1) is to be pinned equal to `makeDeck()`. |
| D20 | Refusals | Host-applied; a guest's refusal returns as a `toast` frame; the local role toasts directly. No undo: a played card is public the instant it is played. |
| D21 | Redaction | `viewFor(state, seat)` is the only redaction: never `piles`, never another hand except under scoperta / partner peek, never `stock` beyond its count and scoperta's top card. `others` is in play order from the viewer. |
| D23 | Copy language | English, with exactly these non-English strings in the engine: the Italian card names in the log (`cardName`). |
| D24 | Exchange window | With `exchange` on: on the actor's own turn before playing, while the trump card is on the table and the side has a trick; a turned A/3/R/C/F for the 7 of trumps, a turned 7/6/5/4 for the 2; chains allowed. A deliberate deviation from "having just won, before drawing" because the draw is automatic. |

## 2. Rules as engine requirements

| # | Requirement |
|---|---|
| E1 | `makeDeck()` is 40 cards suit-major in `SUITS = C D S B` order, rank 1..10 within a suit; `deckFor(options)` removes `{r: 2, s: removedTwo}` when `seatCount === 3` (39 cards). |
| E2 | `POINTS`: asso 11, tre 10, re 4, cavallo 3, fante 2, the rest 0; `pointsOf(deckFor(any)) === 120`. |
| E3 | `STRENGTH`: A 3 R C F 7 6 5 4 2 high to low; the engine never compares by `r`. The regional 7-over-3 swap is not shipped. |
| E4 | The deal: `shuffle(deckFor(options), rng)` is gin's Fisher-Yates lifted to `web/shared/lib/shuffle.ts` (m − 1 rng calls); three cards to `nextSeat(dealer)`, three to the next, …, three to the dealer last (`hands[seat] = deck.slice(3k, 3k+3)` for the k-th seat in play order); `trumpCard = deck[3n]`; `stock = [...deck.slice(3n+1), trumpCard]` (the trump card is the stock's last element while on the table). `stock.length` is 34 / 30 / 28, a multiple of n. `phase 'trick'`, `leader = turn = nextSeat(dealer)`. One `deal` log line: `Ari dealt · the briscola is the sette di coppe`. |
| E5 | The trump suit is `trumpCard.s`, fixed for the game; an exchange changes the card on the table, never the suit. |
| E6 | On their turn a player plays any card of their hand: no obligation to follow suit, trump or win; `legal` is the actor's whole hand; `play` is refused only for a card not held (`NOT_IN_HAND`). `lastAction` reads `Ari led the asso di coppe` / `Jeff played the tre di spade` live; no log line until the trick resolves. |
| E7 | Trick winner when `trick.length === n`: the trump of highest `STRENGTH` if any trump was played; else the highest `STRENGTH` of the led suit. Off-suit non-trumps never win; ids are unique so no tie exists. |
| E8 | Taking: the n cards go to `piles[winner]`; `trickNo += 1`; `lastTrick = {no, leader, cards, winner, points, drew, trumpTaken}`; one `trick` log line (`Jeff took the trick · 14 points`, `· briscola taken` appended when it was); `trick` is `[]` again in the same state. |
| E9 | The draw, in the same `play`, while `stock.length > 0`: each seat draws one off the top, winner first then play order (`drew`); the last drawer takes the trump card exactly when the stock held n cards (`trumpTaken`): with two players the loser of that trick, with three or four the seat before the winner. The drawn card joins the end of the hand. No log, no rng. |
| E10 | With the stock empty nobody draws; hands go 3, 2, 1, 0; `over` after 20 / 13 / 10 tricks. |
| E11 | The winner leads: `leader = turn = winner`. |
| E12 | Result: `totals[side] = Σ taken` over the side's seats (`sideOf`: the seat for 2 and 3 players, `seat % 2` for four); the unique strictly highest total wins, a tie for the top draws (`winner: null, draw: true`). One `result` line: `Ari wins 67–53`, `Ari and Jeff win 65–55`, `A draw, 60–60`, `Ari wins 50–40–30`, with ` and takes the match 2–0` (`take` for a pair) when the match ends; the winner's figure first, then the other sides in side order. `games` gains the record. |
| E13 | Match: `wins[winner] += 1` on a win, `draws += 1` on a draw; `matchOver` when any `wins[i] >= gamesToWin`; `next` at `over` deals `gameNo + 1` with dealer `nextSeat(dealer)` from the same rng; refused `MATCH_OVER` once decided and `GAME_ON` during a game. |
| E14 | Exchange (flag): `exchangeCardFor(trumpCard)` = the 7 of trumps when the trump card is A/3/R/C/F, the 2 when it is 7/6/5/4, `null` when it is the 2. `canExchange` = flag ∧ `phase 'trick'` ∧ `seat === turn` ∧ `stock.length > 0` ∧ the side has ≥ 1 trick ∧ the seat holds the called-for card. The swap makes the held card `trumpCard` and the stock's last element; the old trump card joins the end of the hand; `turn` unchanged; one `exchange` line. Refusals in order `NO_EXCHANGE`, `TRUMP_GONE`, `NO_TRICK_YET`, `NO_SWAP_CARD`. |
| E15 | Scoperta (flag, 2 players): every other hand and `stockTop = stock[0]` public (`null` when only the trump card is left). Stored `false` for 3 and 4 seats. |
| E16 | Partner peek (flag, 4 players): with `stock.length === 0` the partner's `SeatView` carries `hand`; opponents' never. Stored `false` for 2 and 3. |
| E17 | Redaction as D21; `legal` filled for the actor alone; `others` ordered `(me+1) % n, (me+2) % n, …`. |
| E18 | Log kinds `game deal trick exchange result`; `play` is `lastAction` only. English with Italian card names. |
| E19 | Rng: `createGame` reads 1 + (m − 1) (40 calls for 2 and 4 players, 39 for three); `nextGame` m − 1; `play` and `exchange` 0. |
| E20 | Decoders (`decodeState`, `decodeView`, `decodeAction` over `web/shared/lib/json.ts`) are byte-stable for anything the engine emitted, with one `refine` per invariant: `players.length === seatCount`; a hand and a pile per seat; the dealer, leader and turn below `seatCount`; the multiset `hands ∪ stock ∪ trick ∪ piles` exactly `deckFor(options)`; `trumpCard` in that deck; `trick.length < n`; `piles[s].length % n === 0`; `stock.length % n === 0` and `stock.at(-1).id === trumpCard.id` while non-empty; `(result !== null) === (phase === 'over')`; `over ⇒` every hand empty; `wins.length === sidesOf(n)`; `trick[0].seat === leader` and `turn === nextSeat(trick.at(-1).seat)` when non-empty; `scoperta ⇒ seatCount === 2`, `partnerPeek ⇒ seatCount === 4`. `decodeAction` refuses any `cardId` outside the `LABEL + suit` grammar. |
| E21 | `Seat` decodes as `literal(0,1,2,3)`; `applyAction` refuses `seat >= seatCount` with `BAD_SEAT` first. |
| E22 | Pass-and-play runs the same engine with `seat = turn`; `withPosition(state, hands, stock, trumpCard, leader)` seats a position for tests, stories and `__briscola.setup`, refined by E20. `stock` is passed as the state holds it (top first, the trump card last while on the table). |
| E23 | Names are the shell's normalised names (max 20); a 4-player side reads `Ari and Jeff` in seat order. |
| E24 | Phases: `'deal' \| 'trick' \| 'draw' \| 'over'`; `deal` and `draw` are reserved literals never emitted in v1: the deal and the draw resolve inside `createGame`/`nextGame` and the completing `play`; the UI animates from `lastTrick`. `actorOf` is `turn` in `trick`, `null` otherwise. |
| E25 | Refusal order in `applyAction(state, seat, action, rng, now)`: `BAD_SEAT` → phase (`DEAL_PENDING`/`DRAW_PENDING`; at `over`: `next` → deal or `MATCH_OVER`, else `GAME_OVER`) → in `trick`: `next` → `GAME_ON`; `seat !== turn` → `NOT_YOUR_TURN`; `exchange` → E14's four; `play` → `NOT_IN_HAND`. Texts are `MESSAGES` entries worded for the player (§4). |
| E26 | Pure-zone lint: no loops, no `let`, no `Math.random`/`Date.now` in `src/engine/`; algorithms in `*.algorithms.ts` (none needed so far: every rule fits map/filter/reduce); the replay driver's loops live in the test file, as backgammon's do. |

Selectors exported from `index.ts` for the UI and the tests: `sideOf`, `sidesOf`, `sideList`,
`seatsOf`, `seatsFrom`, `seatsOfSide`, `nextSeat`, `pointsOf`, `idsOf`, `trickWinner`,
`exchangeCardFor`, `canExchange`, `legalActions(view)`, `matchOver`, `matchWinner`, `cardName`
("asso di coppe", "cavallo di bastoni"), `cardById`, `isCardId`, `deckFor`, `makeDeck`, `actorOf`,
`takenOf`, `tricksOf`, `sideTotals`, `resultOf`, and the log's sentence builders (`dealText`,
`playText`, `trickText`, `exchangeText`, `resultText`, `gameText`, `sideName`).

## 3. Types (`types.ts`; key order is the wire and save order)

`Suit`, `Rank`, `Card = {id, r, s}`, `LABEL`, `SUITS`, `POINTS`, `STRENGTH`, `Seat = 0 | 1 | 2 | 3`,
`SeatCount = 2 | 3 | 4`, `Side = 0 | 1 | 2`, `GamesToWin = 1 | 2 | 3`, `GameOptions = {seatCount,
gamesToWin, removedTwo, exchange, scoperta, partnerPeek}`, `CreateGameOptions =
Partial<Omit<GameOptions, 'seatCount'>>`, `Players` (a tuple of 2, 3 or 4 `Player`), `Phase`,
`Played = {seat, card}`, `TrickRecord = {no, leader, cards, winner, points, drew, trumpTaken}`,
`Exchange = {seat, gave, took}`, `Match = {gamesToWin, wins, draws}`, `GameResult = {winner, totals,
draw}`, `GameRecord = {gameNo, dealer, trump, winner, totals, endedAt}`, `LogEntry = {seat, kind,
text, at}`.

`State`: `players, options, gameNo, phase, dealer, leader, turn, trumpCard, hands, stock, trick,
piles, trickNo, lastTrick, exchanges, match, result, games, log, lastAction, startedAt, endedAt`.

`View`: `me {idx, id, name, side, hand}, others [{idx, id, name, side, handCount, hand?}], players,
options, gameNo, phase, dealer, leader, turn, actor, isMyTurn, trumpCard, trumpOnTable, stockCount,
stockTop, trick, legal, canExchange, exchanges, taken, tricks, sides, trickNo, lastTrick, match,
matchOver, result, games, log, lastAction, startedAt, endedAt`.

`Action = {type: 'play', cardId} | {type: 'exchange'} | {type: 'next'}`.

## 4. Actor and refusal order (`apply.ts`)

`actorOf(state)` is `turn` in `trick`, `null` in `over`, `deal` and `draw`. `applyAction` checks in
E25's order. Every text is a `MESSAGES` entry worded for the player:

| Key | Text |
|---|---|
| `NOT_YOUR_TURN` | `It is not your turn` |
| `NOT_IN_HAND` | `That card is not in your hand` |
| `GAME_OVER` | `The game is over — deal the next one` |
| `GAME_ON` | `The game is still on` |
| `MATCH_OVER` | `The match is over` |
| `NO_EXCHANGE` | `This table does not play the exchange` |
| `TRUMP_GONE` | `The briscola has been drawn` |
| `NO_TRICK_YET` | `Take a trick before you exchange` |
| `NO_SWAP_CARD` | `Only the sette (or the due) of briscola can be exchanged, and only for a higher card` |
| `BAD_SEAT` | `No such seat at this table` |
| `DEAL_PENDING` / `DRAW_PENDING` | `Dealing…` / `Drawing…` (reserved phases, never reached in v1) |

## 5. Tests

`cards.test.ts` (the deck pins, the seat arithmetic, T1–T10 as selectors, the exchange table),
`apply.test.ts` (the table rows T1–T12, D1–D8, W1–W6, S1–S7, M1–M5, X1–X11, E1–E4 and the reserved
phases: 65 tests), `view.test.ts` (V1–V4, V8, the `others` order, the views' agreement),
`decode.test.ts` (V5 at 2, 3 and 4 seats, V6, V7, E3, every refinement named) and
`replay.test.ts`: a policy over `legalActions(view)` (a uniform legal card; `exchange` at 50% when
offered; `next` at `over`) plays 200 seeded matches by default (80 two-player single games, 40
two-player best-of-3 with the exchange and scoperta, 40 three-player with the exchange over every
`removedTwo`, 40 four-player with the exchange and the partner peek) in backgammon's
`replay.test.ts` shape (counting rng, `ensure` per check, `BRISCOLA_REPLAY_GAMES=1000` in nightly),
checking after every step: the action was offered; conservation (the deck exactly once, 120
points); sizes; order (the leader, the turn, the winner drawing first and leading, `trumpTaken`
iff the stock held n); score (`taken` off the piles, never falling, `Σ taken + points in play =
120`); trump (the suit fixed, the trump card under the stock, ≤ 2 exchanges); refusals (the wrong
seat, a foreign card, a disallowed exchange); views (public fields agree, no foreign hand outside
E15/E16, `legal` for the actor alone, `others` in play order); log growth per action; rng
accounting (E19); byte stability every 25th step; termination after `deckSize / n` tricks with
`Σ totals === 120`, the match decided and `next` refused. Coverage asserted per suite: a draw, a
win by each side, `trumpTaken` by each seat, an exchange chain, a 0-point trick, a trick won by an
off-suit trump, partner-peek hands present. 121 tests, under a second.

## 6. Corrected at implementation

- **`seatCount` is not an input.** The design's `CreateGameOptions = Partial<GameOptions>` carried
  `seatCount` beside `players`; with `players.length === seatCount` required, one of the two is
  redundant, so `createGame` takes a `Players` tuple union (2, 3 or 4) and reads the seat count off
  it. `CreateGameOptions` is `Partial<Omit<GameOptions, 'seatCount'>>`.
- **Seat arithmetic has a module of its own** (`seats.ts`: `seatsOf`, `nextSeat`, `seatsFrom`,
  `sideOf`, `sidesOf`, `sideList`, `seatsOfSide`) beside the design's `cards`/`setup`/`apply`/
  `view`/`decode`/`log` list, and the score and the match live in `score.ts`; nothing else about
  the layout changed.
- **No `*.algorithms.ts` yet.** Every rule fit map/filter/reduce; the coverage row for the file is
  a forward row (100% lines for the first one), as backgammon's.
- **The match-end suffix is on the result line.** §2.4's item 8 counted "three lines when the
  match ends"; E12 puts ` and takes the match 2–0` on the result line, so a finishing `play` logs
  two lines (`trick`, `result`) whether or not the match ended. The verb agrees with a pair:
  `Jeff and Dan win 66–54 and take the match 1–0`.
- **The result's figures** list the winner's total first, then the other sides in side order
  (`Jeff wins 61–59` when seat 1 wins with 61); a draw lists every side in side order.
- **`withPosition` takes the stock as the state holds it** (top first, the trump card last while
  on the table) rather than the cards above the trump card; the table's `[x y … T]` notation reads
  literally.
- **`decodeOptions` refines the flags to their seat counts** (`scoperta ⇒ 2`, `partnerPeek ⇒ 4`),
  one check beyond E20's list, since `createGame` stores them so and a save that disagreed would
  reveal a hand the table did not agree to.
- **`decodeView` carries its own agreement checks** (a seat for every other player, whole draws
  with `trumpOnTable` matching, a result iff over, a score per seat and per side) so a wire
  `state` frame is refused for the same kinds of disagreement a save is.
