// A round's verdict and what it does to the counter: win +1, tie 0, loss −1, and a timeout (no tap,
// or a tap later than the window) which is a loss (docs/design/rps-island.md §2, §3 step 5).

/// How one round ended.
public enum Outcome: String, CaseIterable, Codable, Hashable, Sendable {
    case win, tie, loss, timeout

    /// What the counter moves by.
    public var delta: Int {
        switch self {
        case .win: 1
        case .tie: 0
        case .loss, .timeout: -1
        }
    }

    /// The verdict of one round. `player` nil or `reactionMs` nil: no tap came. A tap at exactly the
    /// window counts; one later is a timeout.
    public static func verdict(player: Hand?, computer: Hand, reactionMs: Int?, windowMs: Int) -> Outcome {
        guard let player, let reactionMs, reactionMs <= windowMs else { return .timeout }
        if player == computer { return .tie }
        return player.beats == computer ? .win : .loss
    }
}
