// The parent app "Sheshbesh Dice": the App Clip's full app, the same two screens (the dice, the
// buddy) and Live Activities as the clip. It exists because an App Clip must belong to an app on
// the App Store.
import SwiftUI

@main
struct SheshbeshDiceApp: App {
    var body: some Scene {
        WindowGroup {
            RootScreen(isClip: false)
        }
    }
}
