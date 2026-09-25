# N-seat sessions: `HostSession` over three and four seats

Briscola (docs/design/briscola.md, when it lands; its D1 and D14–D16) plays with 2, 3 or 4 players,
online, on the shared shell. The shared host session (`web/shared/net/host.ts`,
docs/design/shared-shell.md §4.5) hosted one guest channel. This document is the design of the
generalisation that landed as the briscola program's PR-3 (`feat(net): HostSession over N
seats`), corrected at implementation in §6. The owner's standing rule for the two shell games:
no wire byte, storage literal or test pin of gin's or backgammon's changes, and fidice is untouched.

## 1. The answer in one paragraph

`HostSession` grows one option, `capacity` (default 2), and hosts `capacity − 1` guest channels,
each a **seat** numbered 1..N−1 (the host is seat 0 and has no channel) with its own heartbeat
and silence watch (`liveness.ts`, one `Liveness` per channel). A peer that connects takes the
lowest free seat; the hold/replace/refuse dance runs over every seat; every event and send names
the seat: `frame(frame, seat)`, `guestGone(iceFailed, seat)`, `send(frame, seat?)` (every open
channel when the seat is omitted), `codec.welcome(ctx, seat)`. An optional `codec.joinName`
reseats a join whose name matches a vacated seat. `GuestSession` is untouched: a guest opens one
channel to the host's peer id and learns its seat from the frames. What a seat *means* (names
beyond the rejoin key, the lobby, `viewFor(game, seat)`, Start gating, teams, turn order) is the
reducer's. At `capacity: 2` there is one slot and every path is the two-seat code it replaced.

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | A seat is a channel slot; the host is seat 0. `slots` has `capacity − 1` entries, guest seat `s` is `slots[s − 1]`. | The action a guest sends carries no seat on the wire: the session knows it by the channel, so a guest cannot act for another seat. The two-seat code is the one-element case. |
| D2 | Capacity is fixed when the room opens (`HostOptions.capacity`, from the reducer's `startHost` effect). A newcomer takes the **lowest free seat at connection**, not at its join frame. | The two games' suites pin that a spare peer is told `full` after the first guest's next frame *without ever sending a join*, so the decision stays at `accept`. Briscola fixes `min === max === seatCount`; an open table that compacts seats at Start is not built until a game asks. |
| D3 | `welcome(ctx, seat)`; the lobby stays the reducer's, one `send(lobby, s)` per seated guest with its own `you`. | Gin's and backgammon's codecs take one parameter and are byte-identical. `twoSeatProtocol`'s room fields carry `you` and `seats` as ordinary decoders; `web/shared/lib/protocol.ts` is not edited. |
| D4 | Redaction is the reducer's: one `send(state(viewFor(game, s)), s)` per connected seat. The session does no redaction and holds no game state. | Effects stay data the reducer tests `toEqual`; a 2-seat `broadcast` emits today's `{type: 'send', frame}` with no `seat` key. |
| D5 | Liveness per seat; the hold probes every seat. Free → seat; lowest silent (≥ HB_MISSED_MS) → replace; a hold pending → refuse; else hold: one `probe` per seat, the **first** `silent` replaces that seat and cancels the rest, every seat `alive` → `full`. A guest leaving on purpose during a hold gives the held join its seat. | At one slot this is the two-seat `accept` line for line. The probe is `liveness.ts`'s existing primitive. |
| D6 | Rejoin by name, in the session, through `codec.joinName`. A decoded join on seat `k` whose key (trimmed, case-folded) matches the last name seated at another seat `j` that is gone or silent ≥ HB_MISSED_MS moves the channel to `j` (`j`'s silent channel closed with no `guestGone`, `k` free again); the app hears `frame(join, j)`. A seat merely quiet is presumed alive. | Only the session can move a channel between seats. The shell already saves `{role: 'guest', code, myName}` and rejoins with that name, so a reload lands in the right seat with no new storage. Tokens (`rejoinKey = token ?? name`, a per-seat secret in the lobby's `you`) are the named upgrade for two same-named players or two simultaneous drops. Gin and backgammon set no `joinName`. |
| D7 | `GuestSession`, `GuestCodec`, `GuestEvents`, `GuestContext`: unchanged. | |
| D8 | `HostOptions.waiting` overrides the open status (`WAITING_MSG` names one opponent). | An N-seat reducer says "Waiting for 3 players to join…" without a second status path. |
| D9 | Not in the session: names beyond the rejoin key, seat lists, Start gating, teams, redaction, tokens, spectators, a seat swap, a mixed local/remote table. The lint zone stands (`web/shared/net` imports `web/shared/lib` and the transport, clock and peer edges only). | The session is a transport object over an injected codec; what a seat means is tested pure in the reducer. |

## 3. The API

```ts
export type Seat = number;                                    // a guest's seat 1..capacity-1; the host is 0 and has no channel
export const DEFAULT_CAPACITY = 2;
HostEvents.frame: (frame: G, seat: Seat) => void;             // the seat the channel holds; a two-seat adapter takes the frame alone
HostEvents.guestGone: (iceFailed: string | null, seat: Seat) => void;
HostCodec.welcome: (ctx: HostContext<X>, seat: Seat) => H;    // gin's and backgammon's take one parameter: byte-identical
HostCodec.joinName?: (frame: G) => string | null;             // set: a join naming a vacated seat is reseated there
HostOptions.capacity?: number;                                // default DEFAULT_CAPACITY; below 2 reads as 2
HostOptions.waiting?: string;                                 // the open status with no hand dealt; default WAITING_MSG
HostSession.send(frame: H, seat?: Seat): void;                // one open channel, or every open channel
HostSession.close(): void;                                    // every channel closed, the Peer destroyed
```

`HostContext<X>` keeps every field: `oppName` / `oppConnected` are read for the reopened, handoff
and reconnect statuses only; an N-seat `hostContextOf` fills them as the names still missing and
whether any seat is connected. The game wrappers (`web/games/{gin-rummy,backgammon}/src/net/host.ts`)
are byte-identical: `HostOptions = Omit<SharedHostOptions, 'game'>` gains the two optional fields
and their constructors pass `{...opts, game}` as before.

## 4. The internals

| Two-seat (one guest) | N seats (host.ts as landed) |
|---|---|
| `conn`, `live`, `held` | `slots: ReadonlyArray<Slot>`, `Slot = {seat, channel: Cell<Channel \| null>, name: Cell<string \| null>}`, `Channel = {conn, live, slot: Cell<Slot>, failed: Cell<boolean>}`; a vacated seat keeps its last rejoin key |
| `accept`: free → `seat`; silent ≥ HB_MISSED_MS → `replace`; a hold pending → `refuse`; else `hold` with one probe | lowest **empty** slot (channel null, or one that `failed` before it opened) → `seat(conn, slot)`; none empty: lowest slot whose channel is still negotiating (not open) → `seat` (§6.3, §6.11); lowest channel silent ≥ HB_MISSED_MS → `replace(conn, channel)`; a hold pending → `refuse`; else `hold(conn)`: one probe per seated channel, the first `silent` → `replace` (the rest cancelled), `alive` counted to the number probed → `refuse` |
| `seat(conn)`: `welcome(read())` on open; `heard` → `frame(f)` | `seat(conn, slot)`: `welcome(read(), slot.seat)` on open (a channel replaced while it negotiated is closed instead, §6.3); `heard` → `reseat` (D6), then `frame(f, channel.slot.seat)` |
| `onClose` → `guestGone(null)`; `seatHeld()` | the slot freed, `guestGone(null, seat)`, `seatHeld(slot)` |
| `onError` → `guestGone(iceFailed \| null)`; the channel kept, its watch stopped | the same, per seat; a channel that errors before it ever opened is marked `failed` (kept in its slot, so a later error on it still reports, but the seat is empty for the next join) |
| `gone` after HB_GRACE_MS → `conn = null`, close, `guestGone(null)` | `gone(channel)`: the slot freed, close, `guestGone(null, seat)` |
| `send(frame)`: the one channel if open | `send(frame, seat?)`: that seat's channel if open, or every open one; a seat nobody holds gets nothing |
| `close()`: stop, close, destroy | every seated channel stopped and closed, the Peer destroyed |
| `openedMsg`: `WAITING_MSG` with no hand | `opts.waiting ?? WAITING_MSG` |

The reseat, inside `heard` for the channel a join arrived on: `key = joinName(frame).trim().toLowerCase()`;
`back = slots.find(s => s !== from && s.name === key && (s.channel === null || s.channel.failed || s.channel.live.silence() >= HB_MISSED_MS))`;
`if (back) move(channel, back)`; `channel.slot.name = key`. `move` re-points the channel to `back`
first, then stops and closes the evicted channel (whose `close` finds it is not current: no
report), frees the seat it left, and hands that seat to a held join if one waits (§6.4).

## 5. The proof table: what the two-seat games keep

| Pin | Where | Why it holds at `capacity: 2` |
|---|---|---|
| The seven frames and their bytes | `test/parity/gin.protocol.test.ts`, bg `protocol.test.ts` | `web/shared/lib/protocol.ts` is not edited |
| Welcome on open, lobby after the join, `full` after the first guest's next frame, a refused frame dropped | gin/bg `src/net/sessions.test.ts` | `welcome(ctx, 1)` with one-parameter codecs; one slot is the two-seat `accept`/`hold`/`refuse` order; the harness logs `['frame', frame]` by default |
| The 13-file corpus in order | `test/parity/gin.sessions.test.ts` | its recorder is `frame: (frame) => hostGot.push(frame)` |
| Statuses, toasts, timers, the ticket, liveness (30 scenarios) | `web/shared/net/sessions.test.ts` | file unchanged; `send(frame)` writes the one open channel; `guestGone(null, 1)` is logged `['guestGone', null]` |
| `{type: 'host/frame', frame}` intents | `web/shared/edge/boot.test.ts` | the adapter keeps one parameter (the seated form is the shell-surface PR's, §7); the pins hold as they were, though the file's three direct calls of the events now pass seat 1 (§6.10) |
| `{type: 'send', frame}` effects | gin/bg `state.test.ts`, `test/parity/gin.state.test.ts` | untouched: a 2-seat `broadcast` emits no `seat` |
| `WAITING_MSG`, reopened and handoff statuses | e2e `shell-online/resume/handoff` | `opts.waiting` is undefined for gin/bg |
| Liveness e2e (3 cases × 2 games) | `e2e/shell-liveness.spec.ts` | the held/replace/gone paths at one slot are the two-seat ones |
| Coverage row `web/shared/net/**` 95/95/95/94 | `tools/ci/suites.ts` | re-measured: 100 / 100 / 100 / 100 (statements/branches/functions/lines), every file in the folder at 100 (the stale-open guard is driven by the scripted transport of §6.3) |

## 6. Corrected at implementation

1. **The slot shape.** The zone's lint (`functional/type-declaration-immutability`, ReadonlyShallow
   on every type in an edge) refuses a record with mutable fields, so `Slot` and `Channel` are
   readonly records of closures (`Cell<T> = {get, set}`, as `liveness.ts` keeps its state in
   closures), and a channel carries its slot (`Channel.slot`) so a rejoin's `move` re-points it and
   every handler reads the seat through the channel, never from a captured index. Semantically the
   design's `slots[s] = {conn, live, name}`.
2. **The rejoin key** is the join name trimmed and case-folded; the design's `NAME_MAX` cut is not
   applied because the codec's decoder already bounds the name (the shared protocol refuses a
   longer one), and the session compares what it accepts.
3. **A channel replaced while it negotiated is closed when it opens.** The two-seat predicate
   ("not open is free") lets a later connection take the seat of a channel still negotiating when
   no seat is empty (§6.11). The two-seat code would still welcome that stale channel when it
   opened and start its watch, and at its grace `gone` would null the slot the new guest now holds
   and report a loss for it. `opened` now checks the channel is still seated, and closes it
   otherwise (its guest's session sees `close` and rejoins). The fake broker opens every channel
   it accepted before the next connection arrives, so the seats suite drives this path over a
   scripted `Transport` (a hand-made `PeerHandle` and `Connection` the test opens, fails and
   closes; `Transport` is structural): at capacity 2, two joins negotiating at once, the later
   takes the slot and the earlier is closed unwelcomed with no `guestGone`.
4. **A rejoin's `move` hands a waiting join the seat it vacates.** If a hold is pending when a
   same-named join evicts a silent seat (the eviction stops that seat's probe), the knocker would
   otherwise wait until someone left on purpose. With the fake clock the probe always fires at
   exactly HB_MISSED_MS, before a frame at that instant is delivered, so the case is a real-clock
   jitter case; the call costs no branch (it is `seatHeld`, whose empty case is covered elsewhere).
5. **A slot is freed when its close is reported.** The two-seat code kept the closed `conn` in
   `this.conn` until `gone` or the next `seat`; the N-seat slot is nulled in `onClose`, so an
   error raised later on a closed channel is ignored rather than reported a second time. No
   pinned suite drives an error after a close; PeerJS does not raise one.
6. **`close()` still reports each seated channel** as `guestGone(null, seat)` (the fake broker
   emits the local `close` synchronously for a channel that had opened, as PeerJS does): the
   two-seat session did the same for its one channel, and the shell ignores the report after Leave.
7. **`DEFAULT_CAPACITY` is exported** and a capacity below 2 is read as 2: a table with no guest
   seat would refuse everyone and hold nobody.
8. **The harness**: `world({seats?: boolean})` with two explicit recorders (the design's words) and
   `guests(w, room, n)`; a `Guest` type. `sessions.seats.test.ts` runs 16 scenarios rather than the
   design's 12: the failed negotiation's retry at capacity 2 is its own, and three run over the
   scripted transport of §6.3 (joins negotiating at once at four and at two; a failed seat taken
   back by the retry; the rejoin by name into a failed seat).
9. **Not in this PR** (the design's PR-3 row listed them; the task fixed the scope to the session
   and its types): `sessionEvents(deps, {seats})` in `web/shared/edge/boot.ts` and its test, which
   land with the shell's N-seat surface (§7); `e2e/fixtures/table.ts`, which needs briscola's page;
   briscola's own session pins. `docs/design/shared-shell.md` §4.5 carries the note.
10. **`boot.test.ts` is edited at three lines.** The proof table called it unchanged, and its
    `toEqual` pins are; but the test *calls* `host.frame({t: 'join'})` and `host.guestGone(...)`
    directly, and `tsc -b` refuses a one-argument call once the event types name the seat. The
    three calls pass seat 1. An optional `seat` on the event types would have kept the file
    untouched at the price of every N-seat adapter reading `Seat | undefined` from a session that
    always knows the seat; the truthful type won.
11. **Empty seats first; a failed channel's seat is empty** (review of PR-3). The two-seat
    predicate as first generalised ("the lowest slot whose channel is null or not open") let the
    second of two joins arriving together (an invite posted to a group chat, two players back from
    one wifi blip) take seat 1 from the first while it negotiated, the first closed when it
    opened and its retry seated at 2: the seating order, and the partnerships at four, flipped,
    with seats 2 and 3 standing empty. `accept` now takes the lowest empty seat and falls back to
    a negotiating one only when none is empty (identical at one slot, so every capacity-2 pin
    holds). Empty includes a seat whose channel `failed` before it ever opened: with "null" alone,
    the retry of a failed negotiation would land in the next empty seat and leave a dead channel
    in its own until every other seat was taken, and in a resumed room block the rejoin by name to
    it (`vacated`) until HB_MISSED_MS. The channel is not removed from its slot at the error,
    because the two-seat suite pins that every error on a never-opened channel reports (it raises
    three on one channel, one per status branch); it is flagged instead, and the seat is given
    away under it.

## 7. What the shell asks next (C2/C3, or the PR after; every item is today's shape at capacity 2)

`sessionEvents(deps, {seats = false})`: with `seats: true` the two host intents carry `seat`
(`{type: 'host/frame', frame, seat}`, `{type: 'host/guestGone', iceFailed, seat}`); the default
keeps today's objects. `cfg.seats = {min, max}`; `opts.capacity(opts)`; the copy forms
`waiting(capacity)`, `joined(names, remaining)`, `guestGone(name, code, seat)`, `roomFull`,
`hostRoom(host, opts, seated, capacity)`; `frames.lobby/welcome(myName, opts, seats, you)`;
`engine.create(players: string[], …)`, `engine.apply(game, seat, …)`, `engine.viewFor(game, seat)`,
`engine.turn(game)`; `ShellState.seats: SeatState[]`, `mySeat`, `localNames`, `localSeats` with
`oppName`/`oppConnected` mirroring `seats[0]`; `send` with an optional `seat`; `startHost` with
`capacity` and `waiting`; `broadcast` one `send` per connected seat; Start at `seated >= min − 1`;
`guestNameFor` over every seat; `paintWaiting` filling an optional `#seatList`; the curtain naming
N−1 players. The host save carries seat names in the game's `X`; resume reopens the room at the
saved capacity with every seat disconnected and each guest lands by name (D6).

## 8. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | Rejoin by name mis-seats two same-named players or two simultaneous drops | only a gone or silent seat is evicted; `guestNameFor` dedupes display names; tokens are the 30-line upgrade behind `joinName → rejoinKey` |
| 2 | A stranger with the code takes a vacated seat mid-game (today's two-seat policy) | documented; `claimBy: 'name' \| 'any'` is the switch if strict seats are wanted |
| 3 | Partnerships by join order at four | the waiting screen says who partners whom; `HostSession.swap(a, b)` (~15 lines + a lobby re-send) is v1.1 |
| 4 | The `web/shared/net/**` row dips as briscola's paths land | the seats suite covers every N path (the folder at 100 on every metric); the row is re-measured in every PR that touches the folder |
| 5 | A hold never resolves: `hold` counts each probe's verdict, and a seated channel's `onError` (`live.stop()` clears its probe with no call) while every other seat beats leaves `held` set, so the knocker hears neither welcome nor `full` and later joins are refused until the knocker's own watch closes its channel (HB_GRACE_MS) or a seat leaves. Shared with the two-seat session (the same code at one slot); real only for a non-fatal error, since a fatal one is followed by `close`, whose handler seats the knocker | recorded, not changed here: resolving it wants the probe to report a stopped watch (a `liveness.ts` change) or `onError` to free an errored seat for `seatHeld`; the knocker's own grace bounds it |
