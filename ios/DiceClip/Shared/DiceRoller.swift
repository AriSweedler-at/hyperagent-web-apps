// The app's and the clip's one piece of state: the last roll and the Live Activity it lives in.
// A roll asks the system's random source for two dice, then starts the activity (none yet, or the
// old one has passed the eight-hour ceiling the system ends activities at) or updates it. On
// launch the roller adopts an activity a previous run left behind so the next roll updates that
// one instead of stacking a second in the Island.
import ActivityKit
import DiceModel
import Foundation
import Observation

/// ActivityKit's `Activity` is a class the framework does not mark Sendable, yet its `update` and
/// `end` are nonisolated async and Apple's own sample awaits them from arbitrary tasks. The roller
/// and the buddy's MoodActivity keep their activity on the main actor and only ever hand it to those
/// two calls, so the marking states what the framework guarantees and lets Swift 6 pass the value
/// out of the actor. Unconditional: Swift allows one Sendable conformance per type, and two
/// attribute types share it.
extension Activity: @unchecked @retroactive Sendable {}

/// Where the roll shown on screen came from.
enum RollSource: Equatable {
    /// The Roll button.
    case tapped
    /// The `?roll=a,b` on the invocation URL: a roll made on the web.
    case web
}

@MainActor
@Observable
final class DiceRoller {
    private(set) var lastRoll: Roll?
    private(set) var source: RollSource = .tapped
    private(set) var rolledAt: Date?
    /// The last ActivityKit failure, shown under the button; nil while all is well.
    private(set) var problem: String?

    /// Whether the person allows this app Live Activities (Settings > the app > Live Activities).
    var activitiesEnabled: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }

    /// The activity the last roll went into, if it is still live.
    private var activity: Activity<DiceAttributes>?

    /// The system ends a Live Activity eight hours after it starts; the roller does not wait to be
    /// told and starts a fresh one for a roll past that mark.
    static let lifetime: TimeInterval = 8 * 60 * 60

    init() {
        adoptExistingActivity()
    }

    /// Roll two dice and put them in the Island.
    func roll() {
        show(Roll.random(), from: .tapped)
    }

    /// Show a roll the invocation URL carried; nothing happens when the URL carries none.
    func show(webURL url: URL) {
        guard let roll = Roll(url: url) else { return }
        show(roll, from: .web)
    }

    private func show(_ roll: Roll, from source: RollSource) {
        let now = Date.now
        lastRoll = roll
        self.source = source
        rolledAt = now
        let state = DiceAttributes.ContentState(roll: roll, rolledAt: now)
        Task { await self.publish(state) }
    }

    // MARK: ActivityKit

    private func adoptExistingActivity() {
        let live = Activity<DiceAttributes>.activities
        for stale in live where stale.attributes.startedAt.addingTimeInterval(Self.lifetime) < .now {
            Task { await stale.end(nil, dismissalPolicy: .immediate) }
        }
        activity = live.first { $0.attributes.startedAt.addingTimeInterval(Self.lifetime) >= .now }
        if let activity {
            lastRoll = activity.content.state.roll
            rolledAt = activity.content.state.rolledAt
        }
    }

    private func publish(_ state: DiceAttributes.ContentState) async {
        guard activitiesEnabled else {
            problem = "Live Activities are off for this app in Settings."
            return
        }
        // The content goes stale at the ceiling: the system dims it if the app never rolls again.
        let content = ActivityContent(
            state: state,
            staleDate: state.rolledAt.addingTimeInterval(Self.lifetime),
            relevanceScore: 100
        )
        if let activity, activity.attributes.startedAt.addingTimeInterval(Self.lifetime) >= .now,
           activity.activityState == .active {
            await activity.update(content)
            problem = nil
            return
        }
        if let old = activity {
            await old.end(nil, dismissalPolicy: .immediate)
        }
        do {
            activity = try Activity.request(
                attributes: DiceAttributes(startedAt: state.rolledAt),
                content: content,
                pushType: nil
            )
            problem = nil
        } catch {
            activity = nil
            problem = "The Live Activity could not start: \(error.localizedDescription)"
        }
    }

    /// End the activity now (the Lock Screen keeps it briefly under the default policy).
    func endActivity() {
        guard let activity else { return }
        self.activity = nil
        Task { await activity.end(nil, dismissalPolicy: .default) }
    }
}
