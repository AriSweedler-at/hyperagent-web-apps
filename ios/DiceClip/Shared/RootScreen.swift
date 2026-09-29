// The root the app and the clip share: two tabs, the dice and the buddy, and the one place the
// invocation URL is read. `/clip/dice?roll=a,b` selects the dice and shows the roll;
// `/clip/rps?session=<id>` selects the buddy and starts its activity. The URL arrives as an
// NSUserActivity (the clip's launch, or a universal link once the app is installed) or through
// onOpenURL (docs/design/rps-island.md D2).
import SwiftUI

/// The games' call-to-action green and its label colour (web/shared/styles/tokens.css `--go`
/// #c2d06d and `--go-text` #10281a), so every start button here is the one the site's players know.
enum Palette {
    static let startGreen = Color(red: 0xC2 / 255.0, green: 0xD0 / 255.0, blue: 0x6D / 255.0)
    static let startText = Color(red: 0x10 / 255.0, green: 0x28 / 255.0, blue: 0x1A / 255.0)
}

struct RootScreen: View {
    let isClip: Bool

    enum Tab: Hashable {
        case dice, buddy
    }

    @State private var tab: Tab = .dice
    /// The last URL the app was opened with; each screen reacts to the ones meant for it.
    @State private var webURL: URL?

    var body: some View {
        TabView(selection: $tab) {
            RollScreen(isClip: isClip, webURL: webURL)
                .tabItem { Label("Dice", systemImage: "dice") }
                .tag(Tab.dice)
            BuddyScreen(isClip: isClip, webURL: webURL)
                .tabItem { Label("Buddy", systemImage: "face.smiling") }
                .tag(Tab.buddy)
        }
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
            if let url = activity.webpageURL { route(url) }
        }
        .onOpenURL(perform: route)
    }

    private func route(_ url: URL) {
        switch Invocation.experience(for: url) {
        case .dice: tab = .dice
        case .rps: tab = .buddy
        case nil: return
        }
        webURL = url
    }
}
