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
buddy in the bar." The code's comments cite this document by section (`design §8`). Everything in
§2 the owner did not say is an assumption chosen so the two halves agree; the PR lists them for
him to confirm.

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
| Tie | 0 | Same hand, tapped within the window. |
| Loss | −1 | The computer's hand beats the player's, tapped within the window. |
| Timeout | −1, a loss | No tap by the end of the window, or a tap later than the window (`reactionMs > windowMs`). A tap at exactly the window counts. |
| Window | starts at 1000 ms (the base) | The time allowed between the resolve and the tap. |
| A loss slows the game | `window = min(1000, round(window × 1.10))` | Timeouts count. Ties and wins leave the window alone. Never above the base. |
| Recent wins | the reaction ms of the last five wins, oldest first | Ties, losses and timeouts record nothing. |
| Fast enough | `median(recentWins) ≤ 0.75 × window` with five recorded | The median of five sorted values is the third. |
| Tech up offered | counter = +5, fast enough, and `round(window × 0.75) ≥ 200` | All three at once. |
| Tech up taken | `window = round(window × 0.75)`, counter 0, prestige +1, recent wins cleared | `best` is kept. |
| The floor ("too fast") | the window never drops below 200 ms | From the base the windows run 1000 → 750 → 563 → 422 → 317 → 238; the next step (179) is under the floor, so at 238 ms Tech up is never offered and prestige tops out at 5. |
| Best | the fastest winning reaction ever, in ms | Shown on the page; survives a tech up; cleared by Reset alone. |
| Reset progress | counter 0, window 1000, prestige 0, recent wins [], best none | Behind a confirm. |
| Persists | the whole `Progress`: counter, windowMs, prestige, recentWins, best | Saved after every round, tech up and reset (D4). |

Rounding is schoolbook (`Math.round`, `.rounded()`: halves away from zero): 750 × 1.10 = 825;
825 × 1.10 = 907.5 → 908; 908 × 1.10 = 998.8 → 999; 999 × 1.10 → 1000 (the cap). 1000 × 0.75 = 750;
750 × 0.75 = 562.5 → 563; 563 × 0.75 = 422.25 → 422; 422 × 0.75 = 316.5 → 317; 317 × 0.75 = 237.75 → 238;
238 × 0.75 = 178.5 → 179 < 200.

## 3. A round (the web page)

| Step | What happens |
|---|---|
| 1. Go | The player taps Go; after a verdict the next round starts by itself 1.4 s later unless the player stopped, or Tech up is on offer (then the game waits for Go or Tech up). |
| 2. Scroll | A duration is drawn uniformly in 0.8 … 2.0 s. The shown hand cycles ✊ → ✋ → ✌️ every 80 ms. Taps do nothing. |
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

A frame is rows of characters, one per pixel: `.` clear, `#` the fill, `=` the fill at 70%, `o`
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
| 1000 | ✊ | ✌️ | 350 | win | +1 | 1000 |
| 1000 | ✊ | ✋ | 350 | loss | −1 | 1000 (the cap) |
| 1000 | ✋ | ✋ | 350 | tie | 0 | 1000 |
| 1000 | ✊ | ✌️ | 1000 | win | +1 | 1000 (the boundary counts) |
| 1000 | ✊ | ✌️ | 1001 | timeout | −1 | 1000 |
| 750 | ✌️ | ✋ | 700 | win | +1 | 750 |
| 750 | ✌️ | ✊ | 300 | loss | −1 | 825 |
| 750 | none | ✊ | none | timeout | −1 | 825 |
| 750 | ✋ | ✊ | 751 | timeout | −1 | 825 |
| 825 | ✊ | ✋ | 10 | loss | −1 | 908 |
| 908 | ✊ | ✋ | 10 | loss | −1 | 999 |
| 999 | ✊ | ✋ | 100 | loss | −1 | 1000 |
| 238 | ✊ | ✌️ | 238 | win | +1 | 238 |
| 238 | ✊ | ✌️ | 239 | timeout | −1 | 262 |

Tech up eligibility (`canTechUp`):

| Window | Counter | Recent wins | Offered | Why |
|---|---|---|---|---|
| 1000 | 5 | 700, 720, 740, 760, 780 | yes | median 740 ≤ 750; next 750 ≥ 200 |
| 1000 | 5 | 700, 720, 760, 780, 800 | no | median 760 > 750 |
| 1000 | 4 | 100, 100, 100, 100, 100 | no | counter under 5 |
| 1000 | 5 | 100, 100, 100, 100 | no | fewer than five wins recorded |
| 317 | 5 | 200, 210, 230, 240, 250 | yes | median 230 ≤ 237.75; next 238 ≥ 200 |
| 238 | 5 | 100, 100, 100, 100, 100 | no | next 179 < 200: too fast |

Taking Tech up at window 1000, counter 5, prestige 0, best 300: window 750, counter 0, prestige 1,
recent wins empty, best 300. Reset from any state: window 1000, counter 0, prestige 0, recent wins
empty, best none.

Moods by counter: −5 very sad; −4, −3, −2 sad; −1, 0, 1 neutral; 2, 3, 4 happy; 5 very happy.

Clamping: at +5 a win leaves +5 and still records the reaction; at −5 a loss leaves −5 and still
slows the window.

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
   cycles the frames at 1 fps for the activity's whole life. This is the notch-pet apps' shape of
   trick and the best rate the platform gives. It needs a font file (an asset the art lane would
   build from the final frames), so it is not in this pass.
2. **`ProgressView(timerInterval:)` (smooth, but a bar).** Runs continuously too, as a filling bar
   or ring; it can shrink the game's window on the Lock Screen but cannot drive a sprite's position.
3. **A frame per update (chosen here).** Every push carries a new `at`; the buddy shows frame
   `at mod N` for its band, so each round steps the walk, the bounce or the sulk, and the band's
   change morphs colour and shape with a spring. During play a round lands every two to four
   seconds, so the buddy moves at roughly 0.3–0.5 fps and rests between games. No asset, no font,
   no budget beyond the round's own push.

Nothing gives 2 fps or more inside a Live Activity without pushes as of iOS 26; the free-running
ceiling is the timer's second (option 1). The clip ships option 3 now with option 1's frame
interface ready (`BuddyFrames`), and the web page, with no such limit, animates the same frames at
`frameDuration`.

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
