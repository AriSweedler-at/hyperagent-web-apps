// The parent app "Sheshbesh Dice": the App Clip's full app, one screen, the same roll and Live
// Activity as the clip. It exists because an App Clip must belong to an app on the App Store.
import SwiftUI

@main
struct SheshbeshDiceApp: App {
    var body: some Scene {
        WindowGroup {
            RollScreen(isClip: false)
        }
    }
}
