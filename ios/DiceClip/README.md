# Dice App Clip

The owner's spec: "Build a minimal 'Dice' App Clip with a Roll button. Each roll generates two dice
values and starts or updates a Live Activity. Show one die on each side of the compact Dynamic
Island, and both dice in the expanded and Lock Screen views. Provide a webpage that launches the
App Clip using Apple's Smart App Banner. Configure domain association and App Store Connect for
distribution."

This folder is the native half: buildable Swift sources, an Xcode project and this runbook. It is
not a published clip. Signing, App Store Connect, the App Clip experience, the AASA's team id and
TestFlight are the owner's; they are the checklist under [Owner checklist](#owner-checklist). The
webpage, the Smart App Banner and the `apple-app-site-association` file are the site's (the
`sizer-island-dice` lane; its constant will live in `web/shared/lib/appClip.ts`).

Nothing under `ios/` is read by the web toolchain: Prettier skips it (`.prettierignore`) and a
change here runs CI's `check` job alone (`tools/ci/suites.ts`, the `ios/**` row).

## What is here

| Target            | Product                | Bundle id                                   | Embeds                             |
| ----------------- | ---------------------- | ------------------------------------------- | ---------------------------------- |
| `SheshbeshDice`   | the parent app         | `com.sweedler.games.dice`                   | `DiceClip.app`, `DiceActivityApp`  |
| `DiceClip`        | the App Clip           | `com.sweedler.games.dice.Clip`              | `DiceActivity`                     |
| `DiceActivity`    | the clip's Live Activity extension | `com.sweedler.games.dice.Clip.DiceActivity` | |
| `DiceActivityApp` | the app's Live Activity extension  | `com.sweedler.games.dice.DiceActivity`      | |

Four targets, not three: Apple's rule is that an App Clip's widget extension is added "only to the
App Clip target", carries the App Clip Extension entitlement, and is bundle-id-prefixed by the
clip, and that a full app which also wants the activity gets "a second widget extension" ([Offering
Live Activities with your App Clip][offering]). The two extension targets compile the same two
files; only the bundle id and the entitlements differ. The parent app exists because an App Clip
must belong to an app on the App Store; it shows the same screen.

```
DiceModel/                      Swift package, pure: DieFace (1-6, the pip grid), Roll (two dice, the total,
                                doubles, `?roll=a,b` in and out of a URL); Tests/ (swift test, 9 tests)
Shared/DiceAttributes.swift     ActivityAttributes: ContentState { roll, rolledAt }, startedAt; the invocation URL
Shared/DieView.swift            a die as SwiftUI shapes (rounded square, pips on the 3x3 grid); RollView = two
Shared/DiceRoller.swift         the state: the last roll, Activity.request / update / end, the 8-hour ceiling
Shared/RollScreen.swift         the one screen: the roll, the Roll button, the explanation; reads the invocation URL
App/SheshbeshDiceApp.swift      @main, the parent app
Clip/DiceClipApp.swift          @main, the App Clip
DiceActivity/DiceActivityBundle.swift   @main WidgetBundle holding the one Live Activity (no widgets: a clip may not)
DiceActivity/DiceActivityWidget.swift   ActivityConfiguration: Lock Screen view; DynamicIsland compact leading = die one,
                                compact trailing = die two, expanded = both dice + total + time, minimal = die one
Config/App-Info.plist           NSSupportsLiveActivities YES, NSSupportsLiveActivitiesFrequentUpdates NO
Config/Clip-Info.plist          the same, plus NSAppClip (no notifications, no location confirmation)
Config/Activity-Info.plist      NSExtensionPointIdentifier com.apple.widgetkit-extension (both extensions)
Config/App.entitlements         applinks:games.sweedler.com (the URL opens the full app once installed)
Config/Clip.entitlements        appclips:games.sweedler.com, parent-application-identifiers, on-demand-install-capable
Config/ClipActivity.entitlements  on-demand-install-capable (the App Clip Extension capability)
Config/Assets.xcassets          AppIcon set, empty: the owner drops the 1024x1024 PNG in (no other images anywhere)
DiceClip.xcodeproj              the project (hand-written; four targets, the local package) and two shared schemes;
                                the DiceClip scheme sets _XCAppClipURL to the invocation URL with ?roll=3,5
```

Swift 6 language mode throughout (`SWIFT_VERSION = 6.0`; the package's `swiftLanguageModes: [.v6]`),
SwiftUI only, no third-party packages, no image assets: every die is drawn.

## How it works

- **A roll.** `DiceRoller.roll()` takes two faces from `SystemRandomNumberGenerator` through
  `Roll.random()`, shows them, and `publish`es an `ActivityContent(state:staleDate:relevanceScore:)`
  whose `staleDate` is eight hours after the roll. With a live activity it calls `update(_:)`; with
  none, or one past the ceiling, it ends the old one (`end(nil, dismissalPolicy: .immediate)`) and
  calls `Activity.request(attributes:content:pushType: nil)` — no push updates, so no APNs setup.
- **Eight hours.** The system ends a Live Activity itself after eight hours and keeps it on the Lock
  Screen up to four more ([Displaying live data][displaying]). The roller does not wait to be told:
  on launch it adopts an activity a previous run left (`Activity<DiceAttributes>.activities`) so the
  next roll updates it rather than stacking a second, and ends any that has passed the mark.
- **The Island.** `DynamicIsland(expanded:compactLeading:compactTrailing:minimal:)` (iOS 16.1+):
  the first die in the compact leading region, the second in the trailing; expanded, both dice
  large at the sides with the total in the centre and the time at the bottom; minimal, the first
  die. The Lock Screen view is both dice and the total. Every view carries `widgetURL` set to the
  invocation URL with `?roll=a,b`, so a tap opens the clip (or the app) on that roll.
- **A roll from the web.** The clip is launched with an `NSUserActivity` whose `webpageURL` is the
  invocation URL; `RollScreen` reads it in `onContinueUserActivity(NSUserActivityTypeBrowsingWeb)`
  and, when `?roll=a,b` parses (two integers 1–6), shows that roll and puts it in the Island the
  same way. `onOpenURL` covers the full app's universal link. Junk parses to nothing shown.
- **Live Activities off.** `ActivityAuthorizationInfo().areActivitiesEnabled` is read before each
  publish; when a person has them off for the app, the screen says so and the dice still roll.

## Build and test here

```sh
cd ios/DiceClip/DiceModel && swift test                      # the pure model, on the Mac, no simulator needed
cd ios/DiceClip && xcodebuild -project DiceClip.xcodeproj -scheme DiceClip \
  -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build
xcodebuild -project DiceClip.xcodeproj -scheme SheshbeshDice \
  -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build   # all four targets
```

`CODE_SIGNING_ALLOWED=NO` compiles without a team; a device or TestFlight build needs one (step 1
below). This Mac has Xcode 27.0 (27A266a), Swift 6.4 and the iOS 27.0 SDK but no simulator
runtime: to run the clip on a simulator install one (Xcode > Settings > Components, or
`xcodebuild -downloadPlatform iOS`), pick an iPhone 15 Pro or later for the Island, and use the
`DiceClip` scheme, whose `_XCAppClipURL` launches it as if from the invocation URL.

Results on this Mac, 2026-09-29:

- `swift test` (DiceModel, macOS arm64, Swift 6.4): `Test run with 9 tests in 2 suites passed`.
- `xcodebuild -scheme DiceClip -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build`:
  `** BUILD SUCCEEDED **`, 0 errors, 0 warnings.
- `xcodebuild -scheme SheshbeshDice ...` (all four targets): `** BUILD SUCCEEDED **`, 0 errors,
  2 warnings, both the App Intents metadata processor's "Metadata extraction skipped, no
  AppIntents.framework dependency found" (a note on any target without App Intents).
- The products (Debug, unstripped, so an archive is smaller): `SheshbeshDice.app` 2.0 MB holding
  `AppClips/DiceClip.app` (1.0 MB) and `PlugIns/DiceActivityApp.appex`; `DiceClip.app` holds
  `PlugIns/DiceActivity.appex` (452 KB). The clip's built Info.plist reads `CFBundleIdentifier
  com.sweedler.games.dice.Clip`, `MinimumOSVersion 17.0`, `NSAppClip` with both requests false,
  `NSSupportsLiveActivities true`, `NSSupportsLiveActivitiesFrequentUpdates false`; the extension's
  reads `com.sweedler.games.dice.Clip.DiceActivity` with `NSExtensionPointIdentifier
  com.apple.widgetkit-extension`.
- Not run here: the clip on a phone or a simulator (no runtime installed, no team), so the Island's
  rendering is unseen until step 8's local experience.

## Owner checklist

Everything only the account holder can do, in order. Nothing here was attempted by the lane.

1. **Signing team.** Open `ios/DiceClip/DiceClip.xcodeproj`; for each of the four targets, Signing
   & Capabilities > Team. Or once, in the project file: `DEVELOPMENT_TEAM = "";` (two places, the
   project's Debug and Release) becomes your team id. Automatic signing then registers the four
   App IDs with their capabilities (Associated Domains and App Clip on the clip, App Clip Extension
   on `DiceActivity`, Associated Domains on the app). The team id is under Membership details at
   developer.apple.com/account.
2. **App icon.** Drop a 1024x1024 PNG into `Config/Assets.xcassets/AppIcon.appiconset/` and add its
   `"filename"` to the entry in `Contents.json` (the app and the clip share the set). App Store
   Connect refuses a build without one.
3. **App Store Connect record.** Apps > + > New App: iOS, name "Sheshbesh Dice", bundle id
   `com.sweedler.games.dice`, a SKU. The clip needs no record of its own; it rides inside the
   app's build. Note the app's Apple ID (App Information) for the Smart App Banner's `app-id`.
4. **Archive and upload.** Scheme `SheshbeshDice`, Product > Archive, Distribute App > App Store
   Connect. The archive carries `DiceClip.app` under `AppClips/` and both `.appex`. The Organizer's
   App Thinning Size Report shows the clip's size; see [Limits](#limits).
5. **The App Clip experience.** In the app version's page, expand the App Clip section (the
   required *default App Clip experience*): a header image (1800x1200 px), a subtitle of at most 56
   characters, and the call-to-action verb (Open / View / Play) ([Configuring the launch
   experience][configuring]). Then App Clip Experiences > *advanced App Clip experience* with the
   invocation URL `https://games.sweedler.com/clip/dice` and its own card copy; the advanced card
   is also what App Clip Codes, QR and NFC would need. App Store Connect verifies the AASA (step
   6) "after you've uploaded a build to App Store Connect and created an App Clip experience"
   ([Associating your App Clip][associating]).
6. **The AASA's team id.** The site serves `https://games.sweedler.com/.well-known/apple-app-site-association`
   (JSON, no redirect); the `appclips` block must read

   ```json
   { "appclips": { "apps": ["TEAMID.com.sweedler.games.dice.Clip"] } }
   ```

   with `TEAMID` from step 1. For the full app to take the URL over once installed
   (`App.entitlements`), an `applinks` block too:
   `{ "applinks": { "details": [{ "appIDs": ["TEAMID.com.sweedler.games.dice"], "components": [{ "/": "/clip/dice*" }] }] } }`.
   The site's constant lives in `web/shared/lib/appClip.ts` once the `sizer-island-dice` lane
   lands; fill the team id there.
7. **The Smart App Banner** (the site's page at `/clip/dice`, same lane):
   `<meta name="apple-itunes-app" content="app-id=APPLE_ID, app-clip-bundle-id=com.sweedler.games.dice.Clip, app-clip-display=card">`
   plus an `og:image` for the Messages card ([Supporting invocations from your website][supporting]).
   `APPLE_ID` is the number from step 3. The banner shows the clip card in Safari on iOS 15+.
8. **TestFlight.** After the upload, TestFlight > the build > App Clip section: "you can configure
   up to three different App Clip experiences for testing" ([Testing the launch
   experience][testing]); testers launch the clip from the TestFlight app. Before any upload, a
   *local experience* on your own phone: run `DiceClip` from Xcode once (it caches the clip), then
   Settings > Developer > Local Experiences > Register Local Experience: URL prefix
   `https://games.sweedler.com/clip/dice`, bundle id `com.sweedler.games.dice.Clip`, a title, a
   subtitle, an action, a photo; then open the URL in Safari or scan it.
9. **Live Activities on the phone.** Settings > Sheshbesh Dice (or the clip) > Live Activities:
   on by default; the screen tells you when they are off.
10. **The site half's dropdown** (the owner's second ask: the playground item that rolls dice in an
    iPhone island, its green call to action disabled unless the phone has the hardware) is the
    `sizer-island-dice` lane's; it points at this clip's invocation URL.

## Limits

- **Size.** "iOS 16 and earlier: 15 MB; iOS 17 and later: 100 MB" when the clip "only supports
  digital invocations" and "doesn't support iOS 16 and earlier" ([Choosing the right
  functionality][choosing]). This clip targets iOS 17.0 and is invoked from the web alone, so the
  100 MB limit applies; either way it is a few hundred KB of Swift with no assets. Adding App Clip
  Codes, QR or NFC invocation brings the 15 MB rule back.
- **Versions.** Live Activities and the Island's compact regions need iOS 16.1;
  `Activity.request(attributes:content:pushType:)` needs 16.2 ([request][request]). The deployment
  target chosen here is iOS 17.0 for all four targets (`@Observable`, and the 100 MB rule).
- **Hardware.** The Dynamic Island exists on iPhone 14 Pro and Pro Max and every iPhone 15, 16 and
  17 model; on other iPhones the same activity shows on the Lock Screen only. iPad gets Live
  Activities from iPadOS 17 but has no Island; the targets are iPhone-only
  (`TARGETED_DEVICE_FAMILY = 1`).
- **Lifetime.** "A Live Activity can be active for up to eight hours"; after that the system ends it
  and it "remains on the Lock Screen ... for up to four additional hours" ([Displaying live
  data][displaying]). The roller's `lifetime` is that eight hours.
- **What a clip's extension may hold.** "The widget extension for your App Clip can only include
  Live Activities" ([Offering][offering]); the bundle has no widgets.
- **Background.** "App Clips can't perform background activity" ([Choosing][choosing]); the activity
  is requested and updated while the clip is in the foreground, which a Roll tap always is.
- **Update budget.** `NSSupportsLiveActivitiesFrequentUpdates` is `false`: a roll every few
  seconds is fine under the standard budget; the frequent-updates entitlement is for feeds.

## Sources

Apple Developer Documentation, read 2026-09-29:

- [Offering Live Activities with your App Clip][offering]
- [Displaying live data with Live Activities][displaying]
- [Activity.request(attributes:content:pushType:)][request]
- [DynamicIsland][dynamicisland]
- [Associating your App Clip with your website][associating]
- [Supporting invocations from your website and the Messages app][supporting]
- [Configuring the launch experience of your App Clip][configuring]
- [Testing the launch experience of your App Clip][testing]
- [Choosing the right functionality for your App Clip][choosing]

[offering]: https://developer.apple.com/documentation/appclip/offering-live-activities-with-your-app-clip
[displaying]: https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities
[request]: https://developer.apple.com/documentation/activitykit/activity/request(attributes:content:pushtype:)
[dynamicisland]: https://developer.apple.com/documentation/widgetkit/dynamicisland
[associating]: https://developer.apple.com/documentation/appclip/associating-your-app-clip-with-your-website
[supporting]: https://developer.apple.com/documentation/appclip/supporting-invocations-from-your-website-and-the-messages-app
[configuring]: https://developer.apple.com/documentation/appclip/configuring-the-launch-experience-of-your-app-clip
[testing]: https://developer.apple.com/documentation/appclip/testing-the-launch-experience-of-your-app-clip
[choosing]: https://developer.apple.com/documentation/appclip/choosing-the-right-functionality-for-your-app-clip
