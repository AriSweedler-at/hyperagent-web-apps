// A roll of two dice: how it is made (the system's random source unless a test passes its own),
// what it adds up to, and how it is written into and read out of the clip's invocation URL as
// `?roll=a,b` so a roll started on the web shows in the clip.
import Foundation

/// Two dice, in the order they were rolled.
public struct Roll: Hashable, Codable, Sendable {
    public let first: DieFace
    public let second: DieFace

    public init(first: DieFace, second: DieFace) {
        self.first = first
        self.second = second
    }

    /// The pips on both dice.
    public var total: Int { first.rawValue + second.rawValue }

    /// Both dice show the same face.
    public var isDoubles: Bool { first == second }

    /// A roll from `rng`; the app rolls with `SystemRandomNumberGenerator` through `random()`.
    public static func random(using rng: inout some RandomNumberGenerator) -> Roll {
        Roll(first: .random(using: &rng), second: .random(using: &rng))
    }

    /// A roll from the system's random source.
    public static func random() -> Roll {
        var rng = SystemRandomNumberGenerator()
        return random(using: &rng)
    }

    // MARK: The URL form

    /// The query parameter the invocation URL carries a roll in: `?roll=3,5`.
    public static let queryName = "roll"

    /// The value of the `roll` query parameter for this roll: the two faces, comma-separated.
    public var queryValue: String { "\(first.rawValue),\(second.rawValue)" }

    /// A roll read from the `roll` parameter's value: exactly two integers 1...6 around a comma,
    /// no spaces; anything else is nil (the clip then opens with no roll shown).
    public init?(queryValue: String) {
        let parts = queryValue.split(separator: ",", omittingEmptySubsequences: false)
        guard parts.count == 2,
              let a = Int(parts[0]), let b = Int(parts[1]),
              let first = DieFace(rawValue: a), let second = DieFace(rawValue: b)
        else { return nil }
        self.init(first: first, second: second)
    }

    /// The roll a URL carries in its `roll` query parameter, if it carries a valid one.
    public init?(url: URL) {
        guard let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              let value = items.first(where: { $0.name == Roll.queryName })?.value
        else { return nil }
        self.init(queryValue: value)
    }

    /// The invocation URL with this roll on it, for the Live Activity's tap-through.
    public func url(base: URL) -> URL {
        var components = URLComponents(url: base, resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: Roll.queryName, value: queryValue)]
        return components.url!
    }
}
