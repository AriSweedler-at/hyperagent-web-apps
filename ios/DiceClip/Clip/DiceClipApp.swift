// The App Clip "DiceClip": launched from https://games.sweedler.com/clip/dice (the Smart App
// Banner, or the clip card), it shows the roll screen and reads `?roll=a,b` off the URL it was
// invoked with (RollScreen's onContinueUserActivity).
import SwiftUI

@main
struct DiceClipApp: App {
    var body: some Scene {
        WindowGroup {
            RollScreen(isClip: true)
        }
    }
}
