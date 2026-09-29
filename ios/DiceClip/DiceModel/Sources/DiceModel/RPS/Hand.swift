// A hand in rock paper scissors: the three the computer scrolls through and the player taps, which
// beats which, the scroll's order, and the emoji each is drawn as (docs/design/rps-island.md §2).

/// One of the three hands.
public enum Hand: String, CaseIterable, Codable, Hashable, Sendable {
    case rock, paper, scissors

    /// The emoji the screen shows for this hand.
    public var emoji: String {
        switch self {
        case .rock: "✊"
        case .paper: "✋"
        case .scissors: "✌️"
        }
    }

    /// The hand this one beats: rock beats scissors, scissors beats paper, paper beats rock.
    public var beats: Hand {
        switch self {
        case .rock: .scissors
        case .paper: .rock
        case .scissors: .paper
        }
    }

    /// The hand after this one in the scroll's order ✊ → ✋ → ✌️ → ✊ (design §3 step 2).
    public var next: Hand {
        switch self {
        case .rock: .paper
        case .paper: .scissors
        case .scissors: .rock
        }
    }

    /// A hand from `rng`, each of the three equally likely.
    public static func random(using rng: inout some RandomNumberGenerator) -> Hand {
        allCases.randomElement(using: &rng)!
    }

    /// A hand from the system's random source: the computer's pick at the resolve.
    public static func random() -> Hand {
        var rng = SystemRandomNumberGenerator()
        return random(using: &rng)
    }
}
