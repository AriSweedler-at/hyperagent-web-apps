// The clip's one piece of state for the buddy: the Live Activity for a session and its pairing
// with the Worker. Starting the activity asks ActivityKit for a push token (`pushType: .token`),
// every token that arrives is POSTed to `/api/rps/pair` with the session and the clip's bundle id
// (retrying with a doubling wait), and from then on the Worker's pushes move the buddy; the clip
// never updates the activity itself. "Send buddy home" ends it (docs/design/rps-island.md §8).
import ActivityKit
import DiceModel
import Foundation
import Observation

/// The pairing call, behind a protocol so the screen's state can be exercised without a network.
protocol PairingClient: Sendable {
    func pair(_ request: PairRequest) async throws
}

/// The body of `POST /api/rps/pair`.
struct PairRequest: Codable, Hashable, Sendable {
    var session: String
    /// The push token, lowercase hex.
    var token: String
    /// The bundle id the Worker puts in `apns-topic` (`<bundle>.push-type.liveactivity`).
    var bundle: String
}

/// The real call: JSON to `Config.pairURL`; any status outside 2xx is a failure.
struct URLSessionPairingClient: PairingClient {
    struct BadStatus: Error, CustomStringConvertible {
        let code: Int
        var description: String { "the server answered \(code)" }
    }

    func pair(_ request: PairRequest) async throws {
        var urlRequest = URLRequest(url: Config.pairURL)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        urlRequest.httpBody = try JSONEncoder().encode(request)
        let (_, response) = try await URLSession.shared.data(for: urlRequest)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw BadStatus(code: http.statusCode)
        }
    }
}

/// Where the pairing stands, for the screen.
enum PairingState: Equatable {
    case idle
    case waitingForToken
    case sending(attempt: Int)
    case paired
    case failed(String)
}

@MainActor
@Observable
final class MoodActivity {
    /// The session the buddy belongs to; nil until the invocation URL brings one.
    private(set) var session: String?
    private(set) var pairing: PairingState = .idle
    /// What the island shows now (the last state ActivityKit has), for the screen's preview.
    private(set) var state: MoodActivityAttributes.ContentState?
    /// The last ActivityKit failure, shown on screen; nil while all is well.
    private(set) var problem: String?

    /// Whether the person allows this app Live Activities (Settings > the app > Live Activities).
    var activitiesEnabled: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }

    private var activity: Activity<MoodActivityAttributes>?
    private var tokenTask: Task<Void, Never>?
    private var lastToken: String?
    private let client: PairingClient

    /// The system ends a Live Activity eight hours after it starts.
    static let lifetime: TimeInterval = 8 * 60 * 60

    init(client: PairingClient = URLSessionPairingClient()) {
        self.client = client
        adoptExistingActivity()
    }

    /// Start (or adopt) the buddy for a session: the invocation URL's `?session=`.
    func start(session: String) {
        self.session = session
        if let activity, activity.attributes.session == session, activity.activityState == .active,
           activity.attributes.startedAt.addingTimeInterval(Self.lifetime) >= .now {
            observeTokens(of: activity)
            return
        }
        Task { await request(session: session) }
    }

    /// Show the buddy for whatever session the URL carries; nothing happens when it carries none.
    func start(webURL url: URL) {
        guard Invocation.experience(for: url) == .rps, let session = Invocation.session(from: url) else { return }
        start(session: session)
    }

    /// Send the pairing again after a failure.
    func retryPairing() {
        guard let lastToken, let session, let activity else { return }
        Task { await pair(token: lastToken, session: session, activityID: activity.id) }
    }

    /// End the activity now: the buddy leaves the island.
    func sendHome() {
        tokenTask?.cancel()
        tokenTask = nil
        guard let activity else { return }
        self.activity = nil
        state = nil
        pairing = .idle
        Task { await activity.end(nil, dismissalPolicy: .immediate) }
    }

    // MARK: ActivityKit

    private func adoptExistingActivity() {
        let live = Activity<MoodActivityAttributes>.activities
        for stale in live where stale.attributes.startedAt.addingTimeInterval(Self.lifetime) < .now {
            Task { await stale.end(nil, dismissalPolicy: .immediate) }
        }
        activity = live.first { $0.attributes.startedAt.addingTimeInterval(Self.lifetime) >= .now }
        if let activity {
            session = activity.attributes.session
            state = activity.content.state
        }
    }

    private func request(session: String) async {
        guard activitiesEnabled else {
            problem = "Live Activities are off for this app in Settings."
            return
        }
        if let old = activity {
            activity = nil
            await old.end(nil, dismissalPolicy: .immediate)
        }
        let now = Date.now
        let fresh = MoodActivityAttributes.ContentState.fresh(at: now)
        let content = ActivityContent(state: fresh, staleDate: now.addingTimeInterval(Self.lifetime), relevanceScore: 100)
        do {
            let started = try Activity.request(
                attributes: MoodActivityAttributes(session: session, startedAt: now),
                content: content,
                pushType: .token
            )
            activity = started
            state = fresh
            problem = nil
            observeTokens(of: started)
        } catch {
            problem = "The Live Activity could not start: \(error.localizedDescription)"
        }
    }

    /// Follow the token sequence: the first token pairs; a changed token pairs again.
    private func observeTokens(of activity: Activity<MoodActivityAttributes>) {
        tokenTask?.cancel()
        pairing = .waitingForToken
        let session = activity.attributes.session
        let id = activity.id
        tokenTask = Task { [weak self] in
            for await token in activity.pushTokenUpdates {
                let hex = token.map { String(format: "%02x", $0) }.joined()
                guard let self, !Task.isCancelled else { return }
                await self.pair(token: hex, session: session, activityID: id)
            }
        }
        Task { [weak self] in
            for await content in activity.contentUpdates {
                guard let self, self.activity?.id == id else { return }
                self.state = content.state
            }
        }
    }

    private func pair(token: String, session: String, activityID: String) async {
        lastToken = token
        let request = PairRequest(session: session, token: token, bundle: Bundle.main.bundleIdentifier ?? "")
        var wait = Config.pairFirstRetry
        for attempt in 1...Config.pairAttempts {
            guard activity?.id == activityID, !Task.isCancelled else { return }
            pairing = .sending(attempt: attempt)
            do {
                try await client.pair(request)
                pairing = .paired
                return
            } catch {
                if attempt == Config.pairAttempts {
                    pairing = .failed(error.localizedDescription)
                    return
                }
                try? await Task.sleep(for: wait)
                wait *= 2
            }
        }
    }
}
