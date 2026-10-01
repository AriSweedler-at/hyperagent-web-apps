# Rock paper scissors: the island buddy

The design both halves of the reaction game are built from. The game itself runs in the browser
on any phone (`rps-web-entry`: the rounds, the timer, the sound, the score, the saved progress);
on an iPhone with a Dynamic Island a small App Clip puts a pixel-art buddy in the island that
follows the score a moment behind, fed by pushes from the Worker. The owner's words: "a minigame
where you can click one of 3 buttons and it will +1, 0, or −1 to a counter. The counter can go from
−5 to +5, and there will be a different face displayed at −5, −4 to −2, −1 to 1, 2 to 4, and 5. It
will be a rock paper scissors game. So you have to do it as fast as possible. [...] the floating
island will show a little animated smiley face that will turn colors (blue for sad, pale yellow
for neutral, bright yellow for happy)". And on 2026-09-29: "the game can run in the browser, and
the island scoreboard can lag. That's fine. [...] you will need to animate the face moving around
in different levels of emotion (bouncing, walking, sulking) and animate the transitions between.
Use pixel art [...] This game should be playable from an android phone, they just wont see the
buddy in the bar." And on 2026-09-30: "make the first 'level' of rps be 2.5 seconds. Slightly
reduce the rolling time on the computer's attack. You lose 1 point for a loss or for not tapping. A
tie remains a tie." And on 2026-10-01, correcting the rule a loss was read as: "it's not a loss
that makes 10% higher but it is a -5 'down prestige'". The code's comments cite this document by
section (`design §8`). Everything in §2 the owner did not say is an assumption chosen so the two
halves agree; the PR lists them for him to confirm.

## 1. Decisions

| # | Question | Decision |
|---|---|---|
| D1 | Where the game runs | In the browser, for every phone. The clip (`ios/DiceClip/`) holds no game: it starts the buddy's Live Activity, pairs its push token with the game's session, and shows a "Back to the game" link. The island lags by one push (~1 s), which the owner accepted. |
| D2 | One clip, two experiences | The same clip bundle (`com.sweedler.games.dice.Clip`) answers two invocation URLs: `/clip/dice` (the dice) and `/clip/rps?session=<id>` (the buddy). The AASA is unchanged (one clip bundle id); App Store Connect gets a second advanced App Clip experience. |
| D3 | The rules live once | Pure Swift in the `DiceModel` package, folder `RPS/` (`Hand`, `Outcome`, `Mood`, `Progress`), proved by `swift test` against §6; the web engine implements the same table and the same vectors. The clip uses `Mood` alone (the band on the wire); `Progress` is the shared specification the web half ports. |
| D4 | Persistence | The web page keeps `Progress` as JSON in `localStorage`. The clip keeps nothing but the activity: the Worker holds the pairing (session → push token) and the score. |
| D5 | The buddy | Pixel art, drawn in code as placeholder frames (§4): N frames per mood and one frame duration behind one interface (`BuddyFrames.frames(for:)`), so sourced free art (another lane) drops in without touching the views. Bouncing when happy, walking when neutral, sulking when sad. |
| D6 | Animation | A Live Activity runs no free animation of its own (§7); the buddy moves one frame per update and its colour and shape morph on the change. The web page, which has no such limit, plays the frames at `frameDuration`. |
| D7 | Updates | APNs Live Activity pushes from the Worker (§8), `pushType: .token`; the clip never updates the activity itself after starting it. |

## 2. Rules

| Rule | Value | Notes |
|---|---|---|
| Counter | −5 … +5, starts at 0 | Clamped: a win at +5 stays +5, a loss at −5 stays −5. |
| Hands | ✊ rock, ✋ paper, ✌️ scissors | Rock beats scissors, scissors beats paper, paper beats rock. |
| Win | +1 | The player's hand beats the computer's, tapped within the window. |
| A loss or no tap | −1, the window unchanged | The owner (2026-09-30): "You lose 1 point for a loss or for not tapping." A loss: the computer's hand beats the player's, tapped within the window. No tap (the engine's `timeout`): none by the end of the window, or one later than the window (`reactionMs > windowMs`); a tap at exactly the window counts. Neither touches the window: the owner (2026-10-01), "it's not a loss that makes 10% higher but it is a -5 'down prestige'". |
| A tie | nothing | "A tie remains a tie": same hand, tapped within the window; the counter, the window and the recent wins stay. |
| Window | `windowFor(prestige)`: starts at 2500 ms (the base) | The time allowed between the resolve and the tap: the owner's first level, 2.5 seconds (2026-09-30; it was 1000 ms). A function of the prestige alone: the base stepped `round(× 0.75)` once per level (the ladder under "The floor"), so a level lost recovers exactly its window. `windowMs` stays in `Progress`, always equal to the level's, so the saves and the island read it without the ladder. |
| Down a level ("down prestige") | at −5 with a level to lose: prestige −1, `window = windowFor(prestige)`, counter 0, recent wins cleared | The owner's "-5 'down prestige'", the mirror of Tech up at +5. When a loss or a timeout takes the counter to −5 and prestige ≥ 1, the round's result also drops a level (nobody chooses a loss, so unlike Tech up it is not offered: it happens). `best` is kept. At prestige 0 nothing lower exists: the counter stays clamped at −5. |
| Recent wins | the reaction ms of the last five wins, oldest first | Ties, losses and timeouts record nothing. |
| Fast enough | `median(recentWins) ≤ 0.75 × window` with five recorded | The median of five sorted values is the third. |
| Tech up offered | counter = +5, fast enough, and `round(window × 0.75) ≥ 200` | All three at once. |
| Tech up taken | `window = round(window × 0.75)`, counter 0, prestige +1, recent wins cleared | `best` is kept. |
| The floor ("too fast") | the window never drops below 200 ms | From the base the windows run 2500 → 1875 → 1406 → 1055 → 791 → 593 → 445 → 334 → 251; the next step (188) is under the floor, so at 251 ms Tech up is never offered and prestige tops out at 8. |
| Best | the fastest winning reaction ever, in ms | Shown on the page; survives a tech up; cleared by Reset alone. |
| Reset progress | counter 0, window 2500, prestige 0, recent wins [], best none | Behind a confirm. |
| Persists | the whole `Progress`: counter, windowMs, prestige, recentWins, best | Saved after every round, tech up and reset (D4). |

Rounding is schoolbook (`Math.round`, `.rounded()`: halves away from zero): 2500 × 0.75 = 1875; 1875 × 0.75 = 1406.25 → 1406; 1406 × 0.75 = 1054.5 → 1055; 1055 × 0.75 = 791.25
→ 791; 791 × 0.75 = 593.25 → 593; 593 × 0.75 = 444.75 → 445; 445 × 0.75 = 333.75 → 334;
334 × 0.75 = 250.5 → 251; 251 × 0.75 = 188.25 → 188 < 200.

## 3. A round (the web page)

| Step | What happens |
|---|---|
| 1. Go | The player taps Go; after a verdict the next round starts by itself 1.4 s later unless the player stopped, or Tech up is on offer (then the game waits for Go or Tech up). |
| 2. Scroll | A duration is drawn uniformly in 0.65 … 1.6 s (the owner, 2026-09-30: "slightly reduce the rolling time on the computer's attack"; it was 0.8 … 2.0 s). The shown hand cycles ✊ → ✋ → ✌️ every 80 ms. Taps do nothing. |
| 3. Resolve | The computer's hand is drawn uniformly at random (independent of where the scroll stopped). At once: a short beep (`AudioContext`), `navigator.vibrate(40)` where it exists (not iOS Safari), and `performance.now()` is taken. The three buttons arm. A window countdown bar shrinks. |
| 4. Tap | The player taps ✊, ✋ or ✌️. Reaction = now − resolve instant, in whole ms. A `setTimeout` set to the window fires a timeout when no tap came. |
| 5. Verdict | `verdict(player, computer, reactionMs, windowMs)` (§2), then `apply(progress, outcome, reactionMs)`. The page shows the verdict, the reaction in ms, the new counter and the static face above the computer's hand, Tech up when offered. `Progress` is saved. |
| 6. Island | When a session is paired (§8), the page tells the Worker the new counter, prestige and band; the Worker pushes the activity; the buddy changes a moment later. |

## 4. The buddy

Five bands, the owner's colours, and a frame set per band. The colours are the model's
(`Mood.fill`, `Mood.ink`); the web's static face and the clip's pixel buddy share them.

| Band | Counter | Mood | Fill | Frames (placeholders) | Motion |
|---|---|---|---|---|---|
| very sad | −5 | deep frown | `#3B6FD6` deep blue | sigh, puddle | sulking, flat on the floor |
| sad | −4 … −2 | frown | `#6C9BEA` blue | slump, sigh | sulking |
| neutral | −1 … 1 | flat | `#F2E6A8` pale yellow | step left, step right | walking |
| happy | 2 … 4 | smile | `#F5CD3B` yellow | ground (squashed), air | bouncing |
| very happy | 5 | wide smile | `#FFD200` bright yellow | air, grin | bouncing high |

The shipped frames are the 24 × 24 PNGs under `web/public/games/rps/buddy/` (rps-buddy.md §3:
6-frame sulks and bounces, a 4-frame walk, a 4-frame hop between neighbours), and the island shows
them through the timer fonts (rps-buddy.md §6, §7 option 1 below). The rows below are the fallback
drawn in code when a font is missing. A frame is rows of characters, one per pixel: `.` clear, `#` the fill, `=` the fill at 70%, `o`
ink (`#1F2430`). The placeholders are 8 × 8 and two frames per band; the interface is
`BuddyFrames.frames(for: Mood) -> [PixelFrame]` and `BuddyFrames.frameDuration` (500 ms), and
`PixelSpriteView` draws any grid at any size, the pixels snapped to a cell. Sourced art replaces the
rows (or the view, for PNG frames in the asset catalog) and nothing else. `Mood.mouthCurvature` and
`Mood.mouthWidth` stay for the web's static face (the smiley whose frown and smile grow with the
band).

## 5. The island

| Region | Content |
|---|---|
| Compact leading | the buddy (§4), 2 pt padding |
| Compact trailing | the counter, signed (`+3`, `0`, `−2`), monospaced digits, in the band's fill colour |
| Minimal | the buddy |
| Expanded leading | the buddy at 56 pt |
| Expanded trailing | the counter, 36 pt rounded bold, in the band's fill |
| Expanded centre | `Prestige n` (or `No prestige yet`) |
| Expanded bottom | `Happy · last round at 14:03` |
| Lock Screen banner | the expanded row in one line: buddy 60 pt, counter and prestige, then the band and the time at the right |

Every view carries `widgetURL` = `https://games.sweedler.com/clip/rps?session=<id>`, so a tap
opens the clip on this buddy (its screen links back to the game). The band change morphs the
buddy (`.animation(.spring(duration: 0.4), value: state)` with a scale-and-fade transition between
frames), the counter slides its digits (`contentTransition(.numericText())`). The activity's
`staleDate` is eight hours after it started, the system's ceiling; a push can move it.

## 6. Test vectors

Verdicts and windows (`Outcome.verdict` then `Progress.apply` from the given window, counter 0):

| Window | Player | Computer | Reaction ms | Outcome | Δ counter | Window after |
|---|---|---|---|---|---|---|
| 2500 | ✊ | ✌️ | 350 | win | +1 | 2500 |
| 2500 | ✊ | ✋ | 350 | loss | −1 | 2500 (the cap) |
| 2500 | ✋ | ✋ | 350 | tie | 0 | 2500 |
| 2500 | ✊ | ✌️ | 2500 | win | +1 | 2500 (the boundary counts) |
| 2500 | ✊ | ✌️ | 2501 | timeout | −1 | 2500 |
| 1875 | ✌️ | ✋ | 1700 | win | +1 | 1875 |
| 1875 | ✌️ | ✊ | 300 | loss | −1 | 1875 |
| 1875 | none | ✊ | none | timeout | −1 | 1875 |
| 1875 | ✋ | ✊ | 1876 | timeout | −1 | 1875 |
| 251 | ✊ | ✌️ | 251 | win | +1 | 251 |
| 251 | ✊ | ✌️ | 252 | timeout | −1 | 251 |

Down a level (`apply` on a loss or a timeout, from the level's window, recent wins [900], best 300):

| Prestige | Counter | Outcome | Prestige after | Window after | Counter after | Recent wins after | Dropped |
|---|---|---|---|---|---|---|---|
| 1 | −4 | loss | 0 | 2500 | 0 | [] | yes |
| 2 | −4 | timeout | 1 | 1875 | 0 | [] | yes |
| 3 | −3 | loss | 3 | 1055 | −4 | [900] | no |
| 1 | −5 (a save from before the rule) | loss | 0 | 2500 | 0 | [] | yes |
| 0 | −5 | loss | 0 | 2500 | −5 | [900] | no (nothing lower exists) |

`best` is 300 after every row. Up and down round-trips: Tech up from prestige 3 (window 1055) lands
on 791; five losses in a row from there land back on prestige 3, window 1055, counter 0.

Tech up eligibility (`canTechUp`):

| Window | Counter | Recent wins | Offered | Why |
|---|---|---|---|---|
| 2500 | 5 | 1700, 1750, 1800, 1850, 1900 | yes | median 1800 ≤ 1875; next 1875 ≥ 200 |
| 2500 | 5 | 1700, 1750, 1900, 1950, 2000 | no | median 1900 > 1875 |
| 2500 | 4 | 100, 100, 100, 100, 100 | no | counter under 5 |
| 2500 | 5 | 100, 100, 100, 100 | no | fewer than five wins recorded |
| 334 | 5 | 200, 210, 240, 245, 250 | yes | median 240 ≤ 250.5; next 251 ≥ 200 |
| 251 | 5 | 100, 100, 100, 100, 100 | no | next 188 < 200: too fast |

Taking Tech up at window 2500, counter 5, prestige 0, best 300: window 1875, counter 0, prestige 1,
recent wins empty, best 300. Reset from any state: window 2500, counter 0, prestige 0, recent wins
empty, best none.

Moods by counter: −5 very sad; −4, −3, −2 sad; −1, 0, 1 neutral; 2, 3, 4 happy; 5 very happy.

Clamping: at +5 a win leaves +5 and still records the reaction; at −5 with no level to lose a loss
leaves −5 and the window as it was.

## 7. Animation in a Live Activity: what the platform allows

Read 2026-09-29, in a fifteen-minute budget; the sources are dated where the page says.

| Source | What it says | Date |
|---|---|---|
| Apple, [Displaying live data with Live Activities](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities) | "the system ignores any animation modifiers — for example, `withAnimation(_:_:)` and `animation(_:value:)` — and uses the system's animation timing instead"; from iOS 17 data changes animate with `contentTransition`, `timingCurve(_:duration:)` and springs; the running exceptions are `Text(timerInterval:)` and `ProgressView(timerInterval:)`. | current |
| Apple, [Starting and updating Live Activities with ActivityKit push notifications](https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications) | The push contract in §8; "The system allows for a certain budget of ActivityKit push notifications per hour. If you exceed the budget, the system may throttle"; `NSSupportsLiveActivitiesFrequentUpdates` lifts it and people can turn it off (`ActivityAuthorizationInfo.frequentPushesEnabled`). | current |
| Fueled, [Pixel Pals is What Dynamic Island Needed](https://fueled.com/blog/pixel-pals/) | Christian Selig's notch pets "run as a Live Activity, which allows them to show some sort of animated glyph around the Dynamic Island", "with some clever dev work around Apple's limitations"; no technique given. | 2023-08-30 |
| swiftcrafted.dev, [Live Activities iOS 26: Complete Guide](https://swiftcrafted.dev/article/live-activities-dynamic-island-ios-26-swiftui-activitykit-guide) | "Don't animate the Dynamic Island with heavy transitions. The system prefers `.spring(response: 0.3)` or built-in shape transitions; custom `TimelineView` with frequent redraws gets penalized." Nothing in iOS 18 or 26 adds free-running frames to an activity. | 2026-04-24, updated 2026-06-02 |
| Community write-ups found by the search (dev.to canopas, swiftwithmajid, wwdcnotes "Design dynamic Live Activities") | Animations top out at about two seconds and only run on a content change; "continuous rotation isn't supported"; the workaround is "precomputing intermediate states and updating multiple times". | 2022–2024 |

What that leaves, in order of frame rate without a push:

1. **A timer glyph font (1 fps).** `Text(timerInterval:)` runs on its own; with a custom font whose
   ten digit glyphs are ten buddy frames, and the text clipped to its last digit, the seconds digit
   cycles the frames at 1 fps for the activity's whole life. The best rate the platform gives;
   **shipped** (2026-09-29): `tools/buddy-font.ts` writes one TrueType font per band from the
   frames, `BuddySprite.swift` shows the timer clipped to its last glyph (rps-buddy.md §6; whether a
   notch-pet app does the same is unverified there).
2. **`ProgressView(timerInterval:)` (smooth, but a bar).** Runs continuously too, as a filling bar
   or ring; it can shrink the game's window on the Lock Screen but cannot drive a sprite's position.
3. **A frame per update (the fallback).** Every push carries a new `at`; the buddy shows frame
   `at mod N` for its band, so each round steps the walk, the bounce or the sulk, and the band's
   change morphs colour and shape with a spring. During play a round lands every two to four
   seconds, so the buddy moves at roughly 0.3–0.5 fps and rests between games. No asset, no font,
   no budget beyond the round's own push.

Nothing gives 2 fps or more inside a Live Activity without pushes as of iOS 26; the free-running
ceiling is the timer's second (option 1). The clip ships option 1, with option 3 as the fallback
when a band's font is not in the bundle (`BuddyFont.isAvailable`), and the web page, with no such
limit, animates the same frames from the sheets.

## 8. Pairing and pushes

The contract between the web page, the Worker (another lane) and the clip.

| Step | Who | What |
|---|---|---|
| 1. Session | web page | Mints an 8-character session id (ASCII letters and digits) when the game opens on an iPhone, keeps it in `localStorage`, and offers the clip's URL `https://games.sweedler.com/clip/rps?session=<id>` (the Smart App Banner or a card). |
| 2. Start | clip | `RootScreen` routes the URL to `BuddyScreen`; `MoodActivity.start(session:)` requests the activity with `pushType: .token`, `MoodActivityAttributes(session:, startedAt:)` and a fresh state (counter 0, prestige 0, band neutral, at now). Live Activities off in Settings: the screen says so. |
| 3. Token | clip | Reads `activity.pushTokenUpdates`; each token (the first, and any change) is hex-encoded lowercase. |
| 4. Pair | clip → Worker | `POST {Config.apiBase}/api/rps/pair`, `Content-Type: application/json`, body `{ "session": "<id>", "token": "<hex>", "bundle": "<clip bundle id>" }`. Any 2xx is paired; anything else retries five times with a doubling wait from one second (`Config.pairAttempts`, `Config.pairFirstRetry`), then shows "Pairing failed" with a Try-again button. `Config.apiBase` is `https://games.sweedler.com` unless the scheme's `RPS_API_BASE` says otherwise. |
| 5. Score | web page → Worker | After every verdict, tech up and reset the page posts the new counter, prestige and band for the session (the Worker's route; the web lane's contract). |
| 6. Push | Worker → APNs | Headers `apns-push-type: liveactivity`, `apns-topic: <bundle>.push-type.liveactivity` (the `bundle` from step 4), `apns-priority: 10` (5 to save budget). Body below. Per Apple the `timestamp` is "the current time in seconds since 1970". |
| 7. Show | clip's extension | ActivityKit decodes `content-state` into `MoodActivityAttributes.ContentState`; the island redraws (§5). |
| 8. End | either | The system ends the activity eight hours after `startedAt`; the Worker may end it early with `"event": "end"` (and an optional `dismissal-date`); "Send buddy home" on the clip's screen ends it at once. |

The push body:

```json
{
  "aps": {
    "timestamp": 1759180000,
    "event": "update",
    "content-state": {
      "counter": 3,
      "prestige": 1,
      "band": "happy",
      "at": 1759180000
    }
  }
}
```

`content-state` keys are exactly `ContentState`'s: `counter` (an integer −5 … 5), `prestige` (an
integer ≥ 0), `band` (one of `verySad`, `sad`, `neutral`, `happy`, `veryHappy`: `Mood`'s raw
values), `at` (a number: seconds since 1970; `ContentState` encodes and decodes `at` that way
itself, so the Worker never sends a date string). The Worker's APNs key, the bundle id's Push
Notifications capability (the `aps-environment` entitlement is in `Config/*.entitlements`) and the
sandbox-versus-production host are the owner's steps in `ios/DiceClip/README.md`.

## 9. Files

```
ios/DiceClip/DiceModel/Sources/DiceModel/RPS/   Hand, Outcome, Mood, Progress (§2, §4, §6); Tests/DiceModelTests/RPSTests.swift
ios/DiceClip/Shared/MoodActivityAttributes.swift  MoodActivityAttributes (ContentState: counter, prestige, band, at; §8), Invocation.rps, session, gameURL
ios/DiceClip/Shared/BuddySprite.swift           PixelFrame, BuddyFrames (§4), PixelSpriteView, BuddyView, CounterText
ios/DiceClip/Shared/Config.swift                apiBase (RPS_API_BASE), pairURL, the retry numbers (§8)
ios/DiceClip/Shared/MoodActivity.swift          the activity and the pairing (§8) behind PairingClient
ios/DiceClip/Shared/BuddyScreen.swift           the clip's screen: the session, the pairing, a preview, Back to the game, Send buddy home
ios/DiceClip/Shared/RootScreen.swift            the two tabs (Dice, Buddy) and the URL routing (/clip/dice, /clip/rps)
ios/DiceClip/DiceActivity/MoodActivityWidget.swift   the second ActivityConfiguration (§5), compiled into both extensions
```

## 10. The web game

The page at `web/games/rps/` (`rps-web-entry`; games.sweedler.com/rps/), the first solo page: a
game with no seats, no room and no shell, registered in `tools/games.ts` `SOLO` beside `REGISTRY`
(a `Game` is keyed into the room codes, the online drivers and the style oracle, none of which a
reaction game has) and run by the same two CI matrix jobs as a game (`tools/ci/suites.ts` `rps`).

| Piece | Where | What |
|---|---|---|
| Rules | `src/engine/engine.ts` | §2 as pure functions: `verdict`, `apply`, `applyRound`, `canTechUp`, `techUp`, `reset`, `moodOf`; `engine.test.ts` is §6 as table tests, so this and the Swift model are held to one table. |
| Stored shape | `src/engine/codec.ts` | `{ v: 2, counter, windowMs, prestige, recentWins, best }` under localStorage `rps_progress` (D4). Every field is bounded by the rules (counter −5…5, window 200…2500, prestige 0…8, at most five wins); a refused or unreadable save reads as the start, never a state the engine could not reach. The window is the level's (§2 `windowFor`): on read `windowMs` is snapped to `windowFor(prestige)`, so a `v: 2` save slowed under the rule before 2026-10-01 (2063 at prestige 1) reads as 1875, no version bump needed since the field set is unchanged. `v` is bumped with a migration when a field changes meaning: a `v: 1` save (the 1000 ms base, before 2026-09-30) lands on its level's rung of the new ladder the same way (prestige 1 at 750 → 1875), counter, prestige, recent wins and best kept, and the next save writes `v: 2`; a save with no `v` or another version is refused. |
| The round | `src/ui/state.ts` | The reducer of §3: `idle → scrolling → armed → verdict`, the intents (`go`, `scroll/tick`, `resolve`, `tap`, `timeout`, `stop`, `techUp`, `reset`) and the effects the edge runs (named timers, cues, the save). The draws (the scroll's length, the computer's hand) and the clock readings (`performance.now()` at the resolve and at the tap) arrive inside the intents, so a test scripts a round and the e2e rigs one. |
| The paint | `src/ui/render.ts` | The counter (signed) and its static face (the first frame of the band's set, from the sheet at `background-position: 0 0`, 2×), the animated buddy (the band's loop at 3×; a hop once between neighbouring bands, in reverse on the way down, then the new loop; reduced motion swaps the loop at once), the computer's hand, the window bar, the verdict with the reaction, Tech up with its cost, the status line ("Down a level: …" on the verdict that cost one, like the Tech up moment; under the base level "Fall to −5 and you drop a level."), Stop while a next round is pending, Reset behind a confirm, `#islandSlot` empty for the pairing row (§8). |
| The buddy | `src/ui/buddy.ts` | The manifest's numbers (`web/public/games/rps/buddy/buddy.json`) spelled in the page, pinned to the file by `buddy.test.ts`; sheets are reached as `./buddy/<set>.png`, so both origins serve them. |
| Sound and haptics | `src/ui/sound.ts`, `src/fx.ts` | The shared cue player over this page's table: the resolve is `start` with the owner's 30 ms buzz, the verdicts `good`/`neutral`/`bad`, Tech up `great`, Reset `undo`. A phone starts muted; the resolve still buzzes 30 ms when sound is off (`main.ts`), since the haptic is a game signal, not a sound. |
| Boot | `main.ts` | The adapters (localStorage, the clock, `Math.random` or `window.__rng`, Web Audio, vibration), the timers, the keyboard (1/2/3 or r/p/s the hands, Space or Enter Go), and the hook `window.__rps` (`app`, `dispatch`, `progress()`, `mood()`, `rig({ computer, scrollMs })`). |

What differs from the clip and why: the clip (`ios/DiceClip/`) holds no game and no `Progress`;
the page holds both and is the source of truth (D1). The page's sheets play at the manifest's frame
rate (D6); the clip steps one frame per push. The face on the page is a frame of the buddy's own
set rather than the clip's `mouthCurvature` smiley, so the page and the island show one character.
The resolve's buzz is 30 ms (the owner's word) where §3 said 40. The next round starts by itself
1.4 s after a verdict unless Stop was pressed or Tech up is on offer (§3 step 1). Posting the score
to the Worker (§3 step 6, §8 step 5) is the island lane's; the page leaves `#islandSlot` for it.

**The layout** (`theme.css`; the space audit's rps row, docs/design/space-audit.md §5 "Closed by
space-audit-rps"). One fixed screen: `#app` is the viewport less the safe-area insets and a size
container named `room`, every part with a size of its own (the computer's hand, the three hands,
the paddings and gaps) a `cqh` clamp of the room's height, so the page never scrolls, upright down
to the SE in a tab with the bar shown (375x553) and sideways down to the Galaxy's 780x304. The boot
writes the layout bucket on `<body data-layout>` (`applyLayout`, `watchLayout`; docs/design/layout-buckets.md)
and the theme lays out per bucket: upright the column as before (the score, the table, the hands,
the controls in one row, the foot pinned to the bottom), with a short tier under 720px of room
(`@container room`) that seats the three facts beside the tally and the reaction beside the verdict;
a phone sideways three columns under the bar, the score and the foot at the left, the table in the
middle with the hand beside the verdict and the window bar and the controls under it, the three
hands stacked under the right thumb; a desktop window the same grid spread to within a tenth of the
window's edges, the table stretched to the room, the hands a row of keys across the bottom, the
buddy at 4x (5x from 1440px wide). The sprite scale is the theme's (`--px` on `.buddy` and `.face`,
an integer multiple of 24 per bucket); the paint sets only the sheet, `--frames` and `--ms`.

The foot holds the island row (§11) with Reset progress: `#islandSlot` is a child of the
`<footer>` laid out as the foot's own (`display: contents`), the send button and the state line each
a whole line, the links (Open the clip again, Send buddy home) on one line with Reset progress. So
the paired state costs the column one line of status over the foot's own row (67px), not a row of
its own plus a gap (114), and the foot's grid track is `1fr` (its automatic minimum), never
`minmax(0, 1fr)`: a column that outgrows the room overflows into `#app`'s net below rather than the
collapsed track drawing the foot up over the row's links. The short tier's ceiling is where the
regular column holds the row idle (the send button over the Reset link, 95px) under a wide fallback
font: 718px of room holds it with no air to spare, 672 is 12px over (measured with Verdana standing
in for the Linux runner's DejaVu Sans; both wrap the facts and the Tech up hint to two lines where
the Mac's system font keeps one). Every phone in a tab with the bar shown is short-tier, the island
iPhones' 638-718px rooms among them; the 440x956 class in a tab (742) and the standalone and
fullscreen rooms (759 up) are regular. The audit never sees the row (it runs against the pages
origin, where the probe finds no Worker); e2e/rps.spec.ts on `proxy` does, and pins the paired
screen (below).

## 11. From the game to the island

The last mile (`web/games/rps/src/island.ts`, wired in `main.ts`; the clip names in
`web/shared/lib/appClip.ts`): the row in `#islandSlot` that sends the buddy to the island and keeps
it fed. The owner: "the floating island will be what makes this super cool [...] This game should
be playable from an android phone, they just wont see the buddy in the bar."

| Piece | Rule |
|---|---|
| Who sees the row | An iPhone whose catalogue row (web/shared/lib/devices.ts) has a Dynamic Island: `hasIsland` is `kind === 'iphone'` and `cut.island` (an Android hole is an island too and never qualifies). The class comes from `readDevice` (`screen`, `devicePixelRatio`) through `deviceOf`, so the 393 × 852 and 430 × 932 classes, the 16 Pro line and the Air qualify; the notched and home-button iPhones, the iPads, every Android and every desktop see nothing. |
| Which origin | Only one with the Worker: at boot the page GETs `/api/rps/pair/<session>` (the probe). A 200 `{paired}` is the Worker's answer; anything else (GitHub Pages' 404, a Worker without its bindings answering 503, no network) is `absent` and the row stays empty. The origin is detected, never the hostname: `tools/proxy-dev.ts` passes the same probe locally. |
| The session | Eight lowercase letters or digits from `crypto.getRandomValues` (`newSession`; the Worker takes `[A-Za-z0-9]{8}`), kept in `sessionStorage` under `rps_session` so a reload keeps the pairing and a new tab starts its own. |
| The button | "Send buddy to your island": a plain `<a>` to `https://games.sweedler.com/clip/rps?session=<id>` (`appClip.ts rpsClipUrl`; the URL is the clip's registered experience on the live host, whatever origin served the page), `target="_blank"` so the game stays; iOS shows the App Clip card for it once the owner's steps (ios/DiceClip/README.md 5–7) are done. The tap starts the poll. |
| The Smart App Banner | `<meta name="apple-itunes-app" content="app-id=<App Store id>, app-clip-bundle-id=com.sweedler.games.dice.Clip, app-clip-display=card, app-argument=<the clip URL>">`, written into `<head>` as soon as the device gate passes (Safari reads the tag at load) and taken back when the probe finds no Worker. `APP_STORE_ID` is a placeholder until App Store Connect assigns one; Safari shows no banner for it. |
| The poll | `waiting`: GET the probe's URL every 3 s (`POLL_MS`) on the page's clock; `paired: true` moves to `paired` and posts the page's current progress at once (`sync`), so the island shows the score, not the clip's neutral start. After two minutes (`POLL_MAX_MS`) unpaired: `stalled`, "Still waiting for the buddy." with Try again, which polls afresh. |
| The post | Every save (a verdict, Tech up, Reset: the reducer's `save` effect) posts `{session, counter, prestige, band, at}` to `/api/rps/mood`, `at` in unix seconds. Fire-and-forget: one post in flight; a round that lands meanwhile is kept (the latest wins) and posted 2 s after the reply (`FLUSH_MS`, the Worker's own spacing). A 404 means the Worker forgot the pair: back to `waiting`, polling. A 429 (two pushes under 2 s) and any other reply are let go; the next round carries the score. |
| Send buddy home | Ends the session on this side: a fresh id replaces the paired one (remembered), the timers stop, the row shows the button again. The island's activity is not told; it ends by itself (§8 step 8) or from the clip's own screen. |
| The states | `off` → `probing` → `idle` ⇄ `waiting` → `stalled` (retry → `waiting`) → `paired`; `home` from any shown state → `idle`. A pure reducer (`reduceIsland`, table-tested in island.test.ts); main.ts runs its effects: `poll` and `post` over `fetch`, `timer`/`cancel` over the page's named timers (`island/poll`, `island/flush`), `remember` over sessionStorage, `sync` as a `round` event. `window.__rps.island()` reads the state. |
| Tests | island.test.ts: the gate over the whole catalogue, the probe's three answers, the poll on a scripted clock, the post's body, the in-flight rule, the 404, the row per state and the one delegated listener. e2e/rps.spec.ts on `proxy` (the spec starts a proxy-dev of its own, so the stub APNs is reachable): an emulated 393 × 852 iPhone in a tab (393 × 672, no insets) sees the button and the banner, taps it, is paired by the clip's POST with a fake token, is synced (+4), plays a win and the stub's push carries `{counter: 5, band: veryHappy}` to that token; paired with Tech up on offer (the tallest paired screen), Send buddy home and Reset progress are each inside the viewport, apart, and nothing scrolls (§10 "The layout": the foot); then Send buddy home. An emulated Galaxy sees no row; on `pages` the same iPhone sees no row and no banner. |
