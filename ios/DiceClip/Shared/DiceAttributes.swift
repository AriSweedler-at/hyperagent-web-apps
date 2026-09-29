// The Live Activity's data, shared by the app, the clip and both widget extensions: what never
// changes while the activity lives (when it began) and what each roll replaces (the two dice and
// when they landed). ActivityKit encodes ContentState into the activity and decodes it in the
// extension, so it is Codable and Hashable and nothing else.
import ActivityKit
import DiceModel
import Foundation

struct DiceAttributes: ActivityAttributes {
    /// The dynamic half: replaced by every roll through `Activity.update`.
    struct ContentState: Codable, Hashable {
        var roll: Roll
        var rolledAt: Date
    }

    /// The static half: when the activity was requested, so the app can tell an activity that has
    /// outlived the system's eight-hour ceiling from a live one.
    var startedAt: Date
}

/// The one invocation URL, the same string the site's Smart App Banner and the AASA point at.
enum Invocation {
    static let url = URL(string: "https://games.sweedler.com/clip/dice")!
}
