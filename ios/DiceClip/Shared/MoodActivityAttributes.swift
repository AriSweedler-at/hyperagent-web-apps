// The buddy's Live Activity data, shared by the app, the clip and both widget extensions, and the
// wire contract with the Worker's pushes: ContentState's keys are exactly the `content-state` keys
// the Worker sends (`counter`, `prestige`, `band`, `at`; docs/design/rps-island.md §8), `at` as
// Unix seconds. The static half is the session the web page minted and when the activity began.
import ActivityKit
import DiceModel
import Foundation

struct MoodActivityAttributes: ActivityAttributes {
    /// The dynamic half: what every push replaces.
    struct ContentState: Codable, Hashable {
        /// −5 … 5.
        var counter: Int
        var prestige: Int
        /// The face's band, sent as its name: `verySad`, `sad`, `neutral`, `happy`, `veryHappy`.
        var band: Mood
        /// When the round ended, on the wire a number of seconds since 1970 (design §8).
        var at: Date

        init(counter: Int, prestige: Int, band: Mood, at: Date) {
            self.counter = counter
            self.prestige = prestige
            self.band = band
            self.at = at
        }

        /// A fresh buddy: counter 0, no prestige, neutral, now.
        static func fresh(at: Date = .now) -> ContentState {
            ContentState(counter: 0, prestige: 0, band: .neutral, at: at)
        }

        private enum CodingKeys: String, CodingKey { case counter, prestige, band, at }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            counter = try c.decode(Int.self, forKey: .counter)
            prestige = try c.decode(Int.self, forKey: .prestige)
            band = try c.decode(Mood.self, forKey: .band)
            at = Date(timeIntervalSince1970: try c.decode(Double.self, forKey: .at))
        }

        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(counter, forKey: .counter)
            try c.encode(prestige, forKey: .prestige)
            try c.encode(band, forKey: .band)
            try c.encode(at.timeIntervalSince1970.rounded(), forKey: .at)
        }

        /// The counter with its sign, a real minus: `+3`, `0`, `−2`.
        var counterText: String { Self.signed(counter) }

        /// The expanded centre line.
        var prestigeLine: String { prestige == 0 ? "No prestige yet" : "Prestige \(prestige)" }

        static func signed(_ value: Int) -> String {
            if value > 0 { return "+\(value)" }
            if value < 0 { return "−\(-value)" }
            return "0"
        }
    }

    /// The static half: the game session this buddy belongs to (the 8-character id the web page
    /// put on the invocation URL) and when the activity was requested, for the eight-hour ceiling.
    var session: String
    var startedAt: Date
}

extension Invocation {
    /// The buddy's invocation URL, the second advanced App Clip experience on the same clip; the
    /// web page appends `?session=<id>`.
    static let rps = URL(string: "https://games.sweedler.com/clip/rps")!

    /// The game page in the browser, where the rounds are played.
    static let game = URL(string: "https://games.sweedler.com/rps/")!

    /// Which screen an invocation URL is for.
    enum Experience: Equatable {
        case dice, rps
    }

    /// The experience a URL names, by its path (`/clip/dice…` or `/clip/rps…`); nil for any other.
    static func experience(for url: URL) -> Experience? {
        let path = url.path(percentEncoded: false)
        if path.hasPrefix(rps.path(percentEncoded: false)) { return .rps }
        if path.hasPrefix(Invocation.url.path(percentEncoded: false)) { return .dice }
        return nil
    }

    /// The `session` query parameter: exactly eight ASCII letters or digits; anything else is nil.
    static func session(from url: URL) -> String? {
        guard let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              let value = items.first(where: { $0.name == "session" })?.value,
              value.count == 8,
              value.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber) })
        else { return nil }
        return value
    }

    /// The invocation URL carrying a session, for the Live Activity's tap-through.
    static func rpsURL(session: String) -> URL {
        var components = URLComponents(url: rps, resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "session", value: session)]
        return components.url!
    }

    /// The game page for a session: the "Back to the game" link.
    static func gameURL(session: String) -> URL {
        var components = URLComponents(url: game, resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "session", value: session)]
        return components.url!
    }
}
