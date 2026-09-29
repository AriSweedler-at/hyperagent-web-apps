// The player's progress and every rule that moves it: the clamped counter, the window a loss
// slows and a tech up shrinks, the last five winning reactions that decide "fast enough", the
// floor under which Tech up is never offered, the best reaction, and Reset. Pure and Codable: the
// clip keeps it in UserDefaults, the web page in localStorage (docs/design/rps-island.md §2).

/// Everything that persists between rounds.
public struct Progress: Codable, Hashable, Sendable {
    /// The window every fresh game and every Reset starts at, in ms.
    public static let baseWindowMs = 1000
    /// The window never drops below this; a tech up that would is never offered ("too fast").
    public static let floorWindowMs = 200
    /// The counter's range.
    public static let counterRange = -5...5
    /// How many winning reactions "fast enough" is judged on.
    public static let recentWinsKept = 5
    /// A loss or a timeout multiplies the window by this (then caps it at the base).
    public static let slowFactor = 1.10
    /// A tech up multiplies the window by this.
    public static let techUpFactor = 0.75
    /// The median of the recent wins must be at most this fraction of the window: "25% faster".
    public static let fastEnoughFactor = 0.75

    public var counter: Int
    public var windowMs: Int
    public var prestige: Int
    /// The reaction ms of the last five wins, oldest first; ties, losses and timeouts record nothing.
    public var recentWins: [Int]
    /// The fastest winning reaction ever, in ms; nil before the first win.
    public var best: Int?

    public init(counter: Int = 0, windowMs: Int = Progress.baseWindowMs, prestige: Int = 0,
                recentWins: [Int] = [], best: Int? = nil) {
        self.counter = counter
        self.windowMs = windowMs
        self.prestige = prestige
        self.recentWins = recentWins
        self.best = best
    }

    /// A fresh game: counter 0, the base window, no prestige, no wins, no best.
    public static let fresh = Progress()

    /// The face the counter shows (design §4).
    public var mood: Mood { Mood(counter: counter) }

    // MARK: A round

    /// The progress after a round that ended `outcome` with the player's reaction (nil on a timeout
    /// with no tap). The counter clamps to its range; a loss or timeout slows the window; a win
    /// records its reaction and may set the best (design §2, §6).
    public func apply(outcome: Outcome, reactionMs: Int?) -> Progress {
        var next = self
        next.counter = min(max(counter + outcome.delta, Self.counterRange.lowerBound), Self.counterRange.upperBound)
        if outcome.slowsTheWindow {
            next.windowMs = min(Self.baseWindowMs, Self.scaled(windowMs, by: Self.slowFactor))
        }
        if outcome == .win, let reactionMs {
            next.recentWins = Array((recentWins + [reactionMs]).suffix(Self.recentWinsKept))
            next.best = min(best ?? reactionMs, reactionMs)
        }
        return next
    }

    // MARK: Tech up

    /// The window a tech up would set.
    public var techUpWindowMs: Int { Self.scaled(windowMs, by: Self.techUpFactor) }

    /// The median of the recent wins once five are recorded (the third of the five sorted); nil before.
    public var medianRecentWinMs: Int? {
        guard recentWins.count == Self.recentWinsKept else { return nil }
        return recentWins.sorted()[Self.recentWinsKept / 2]
    }

    /// Five wins recorded and their median at most 75% of the window.
    public var isFastEnough: Bool {
        guard let median = medianRecentWinMs else { return false }
        return Double(median) <= Self.fastEnoughFactor * Double(windowMs)
    }

    /// The next window would be under the floor: the game is as fast as it gets.
    public var isAtFloor: Bool { techUpWindowMs < Self.floorWindowMs }

    /// Tech up is on offer: the counter is at the top, the player is fast enough, and the window
    /// has room above the floor.
    public var canTechUp: Bool {
        counter == Self.counterRange.upperBound && isFastEnough && !isAtFloor
    }

    /// Take the tech up: the window shrinks, the counter and the recent wins clear, prestige climbs;
    /// the best stays. When it is not on offer, nothing changes.
    public func techUp() -> Progress {
        guard canTechUp else { return self }
        return Progress(counter: 0, windowMs: techUpWindowMs, prestige: prestige + 1, recentWins: [], best: best)
    }

    /// Reset progress: everything back to fresh, the best included.
    public func reset() -> Progress { .fresh }

    /// `ms × factor`, rounded schoolbook (halves away from zero): 562.5 → 563, 178.5 → 179.
    static func scaled(_ ms: Int, by factor: Double) -> Int {
        Int((Double(ms) * factor).rounded())
    }
}
