# Lobby resume: a host's refresh keeps the room; is "claim host" possible?

The owner (2026-09-25): "When the host of a lobby refreshes, it shouldn't drop the lobby. The
lobby should be available to start back up on the host's same device. Or even perhaps there can
be a 'claim host' mechanism where as long as there's one player it works. Figure out if that's
possible ... And when a host device clicks the JOIN code it should resume hosting."

## 1. What happened before this PR

- The host save was already written the moment the room opened: `HostSession.open` →
  `peer.on('open')` → `events.persist()` → the reducer's `persist` → `saveFor(shell)` →
  `{role: 'host', code, myName, <opts>, game: null, oppName: null}`. The waiting room was never
  lost from storage.
- It was lost on the home screen: `resumeFor` offered a host save only when `save.game !== null`,
  so a reload in the waiting room showed no Resume box and the save lingered until the next
  `persist` or `clearSave`. Mid-game the Resume box worked (e2e shell-resume).
- The guest in the lobby: the host's unload closes the data channel (PeerJS `close`, ~2 ms) →
  `lost` → a rejoin REJOIN_MS (1.5 s) later → `peer-unavailable` while the host is not registered
  → JOIN_RETRY_MS (3 s) × MAX_JOIN_TRIES (40), about 2 minutes, then `notFoundMsg`. A host back
  within that window is found by the guest's own retries; nothing on the guest changes.

## 2. How PeerJS frees a peer id (the facts claim-host would rest on)

- The room code is the host's peer id (`peerIdFor(game, code)`, `new Peer(id, opts)`). Any client
  may open any id; the broker knows no owner beyond "first come". The production broker is
  0.peerjs.com (PeerJS defaults, no `?peer=`); the harness runs `peer` 1.0.2, the same server.
- A client leaves the realm when its WebSocket closes (`socket.on('close')` →
  `realm.removeClientById`): a refresh or a closed tab frees the id within the round trip. A
  client that died without closing (tab killed, phone offline) keeps the id until the
  broken-connection sweep (every 300 ms) sees `now − lastPing ≥ alive_timeout`, default
  90 000 ms (PeerJS pings every 5 s): up to 90 s.
- Opening an id the realm still holds under another token is answered `ID-TAKEN` → PeerJS
  `unavailable-id`. `host.ts` with `resume: true` toasts CODE_BUSY_MSG and restarts under the same
  code BUSY_RETRY_MS (1.5 s) later, for as long as it takes; a fresh room (`resume: false`) draws a
  new code at once. So a host resuming after a crash sees "Room code busy, retrying…" for up to
  90 s, then the room is back; after a refresh it is back at once.

## 3. Decisions (what landed)

| # | Decision | Why |
|---|---|---|
| D1 | The waiting-room save gets `at` (ms since the epoch, when this device opened or reopened the room), written **only** when `game === null`. Decoded as `optional(number)`, so every existing save loads; a mid-game save is byte-identical to before (gin's storage corpus, both games' literal pins). | The only new fact a reload needs is how old the empty room is. An old page reading the new save ignores the key (`object` copies declared keys only). |
| D2 | `ShellState.openedAt` is set by `startHost` (`ctx.now()`), so `saveFor` stays a pure function of the state and the reducer stays free of the clock at persist time. | The save is written at the Peer's `open`, seconds after `startHost`; a resumed room refreshes the stamp. |
| D3 | `resumeFor` offers a host save with `game: null` as a host offer with `game: null` (label "Resume hosting room X", the existing one). `resume/click` on it reopens the code with no game and no view. | One offer kind; the games' labels needed only a null guard on the handoff label. |
| D4 | A new intent, `resume/auto`, dispatched by `bootShell` after `applyInviteLink`: a host offer with no game whose `at` is within `WAITING_RESUME_MS` (30 minutes) resumes by itself; anything else (a stale or unstamped waiting save, a mid-game save, a local or guest save) stays an offer. Nothing while seated. | After the invite link, so a link to *another* room wins over the device's own empty lobby (the player's tap is explicit), and a link to the *same* room already resumed hosting (D5). 30 minutes covers a tab the phone discarded while the host chatted the invite around; beyond it the room is a tap away, and a room left open days ago never opens itself. |
| D5 | `join/link` whose code is the device's own host offer's code (waiting or mid-game, any age) resumes hosting instead of joining. | The owner: "when a host device clicks the JOIN code it should resume hosting." |
| D6 | Leaving or cancelling clears the save as before (`clearSave`). | Unchanged. |

Stale is measured from the room's (re)opening, not from the host's last breath: a host that
waited 40 minutes in the lobby and then refreshed gets the Resume box (one tap), not the room
itself. Stamping every heartbeat would put the clock into `persist`; not worth it for one tap.

## 4. Claim host: the verdict

**Waiting room: feasible. Mid-game: not without a protocol change.**

- In the lobby the claimant needs nothing but the seat names. Two-seat games: the only other
  seat *is* the claimant, so a claim is re-hosting an empty room under the same code (it keeps a
  shared invite link alive; little else). Briscola at three or four seats: the lobby frame
  already carries `seats`, so the claimant can seat the others by name (the session's rejoin by
  name, n-seat-sessions.md D6), and their `tryJoin` retries find the new registration by
  themselves. That is the one case worth building.
- Mid-game the guests hold `viewFor(game, seat)`, a redacted view (gin's stock and the host's
  hand, briscola's hands and deck), never the engine `State`, and the host alone holds the rng.
  A claimant cannot continue the game. Backgammon's view is the whole position, so a per-game
  `stateFromView` would do there, but that is not a shared mechanism. A shared one needs the host
  to escrow the full `State` to every guest (a new frame tag; plain, so a guest's dev tools show
  the hidden cards, or encrypted with a key released on the host's loss, which needs a third
  party or a threshold scheme). Out of scope.
- The lock is the broker's: the first claimant to open the host id wins, the second gets
  `unavailable-id` and stays a guest. Election by seat (the lowest connected guest claims) avoids
  the race in the common case.
- Timing: after a refresh the id is free at once, so a claimant would race the returning host; a
  claim must therefore be a tap ("Take over room X" on the guest wait screen after the host has
  been gone a while), never automatic. After a crash the id is held up to 90 s; the claimant
  learns it only by trying (`unavailable-id` → retry).
- The risk that decides the design: a host that comes back after a guest claimed finds its own
  id taken and, resuming, loops on "Room code busy, retrying…" for ever. Claim-host needs a
  demotion path first: after K busy retries on a resume, "Room X is now hosted by someone else —
  join it?" and the host joins as a guest under its name.

### PR sketch: `feat(net): Claim host in the waiting room`

1. `web/shared/ui/shell.ts`: on the guest wait screen, once `guest/lost` has been followed by
   `notFoundMsg`-class retries for CLAIM_AFTER_MS (say 20 s), show `#claimHostBtn`; `claim/click`
   → `closeNet`, then `startHost(code, resume: true)` with `myName`, the `opts` and the seat names
   the lobby frame gave (briscola's `seats` into its lobby; two-seat games have none to seat).
2. `web/shared/net/host.ts`: nothing (the `resume: true` path is the claim). `guest.ts`: nothing.
3. The demotion: `host/start` with `resume: true` counts its busy restarts; after K, the status
   offers Join and `join/click` with the room's code.
4. Tests: sessions harness (a guest opens the host id after the host's Peer is destroyed and the
   others' retries land on it; a second claimant gets `unavailable-id`), shell.test.ts (the
   button's timing, the claim's effects, the demotion), e2e briscola three seats: the host closes
   its context, a guest claims, the third player is seated by name.
5. Not in it: mid-game claims (§4), an automatic claim, tokens for same-named seats.
