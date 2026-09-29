// The App Clip "DiceClip": launched from https://games.sweedler.com/clip/dice (the dice; `?roll=a,b`)
// or https://games.sweedler.com/clip/rps?session=<id> (the buddy) by the Smart App Banner or the
// clip card; RootScreen reads the URL it was invoked with and opens the right tab.
import SwiftUI

@main
struct DiceClipApp: App {
    var body: some Scene {
        WindowGroup {
            RootScreen(isClip: true)
        }
    }
}
