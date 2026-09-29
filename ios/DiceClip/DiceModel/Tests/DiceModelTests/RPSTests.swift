// The reaction game's tests, one suite per type, carrying every rule and every vector of
// docs/design/rps-island.md §2 and §6: the hands' cycle and beats, the verdict at the window's
// boundary, the five bands, the clamped counter, the window's slow-down and cap, the tech-up
// eligibility (median, counter, five wins, the floor), the tech up itself, Reset, and the Codable
// round-trip the clip's UserDefaults and the web's localStorage rely on.
import Foundation
import Testing
@testable import DiceModel

@Suite("Hand")
struct HandTests {
    @Test("each hand beats exactly one other and is beaten by the third")
    func beats() {
        for hand in Hand.allCases {
            #expect(hand.beats != hand)
            #expect(hand.beats.beats != hand)
            #expect(hand.beats.beats.beats == hand)
        }
        #expect(Hand.rock.beats == .scissors)
        #expect(Hand.scissors.beats == .paper)
        #expect(Hand.paper.beats == .rock)
    }

    @Test("the scroll cycles rock, paper, scissors, rock")
    func cycle() {
        #expect(Hand.rock.next == .paper)
        #expect(Hand.paper.next == .scissors)
        #expect(Hand.scissors.next == .rock)
    }

    @Test("a seeded generator lands on every hand")
    func randomCoversEveryHand() {
        var rng = SeededGenerator(state: 3)
        var seen = Set<Hand>()
        for _ in 0..<300 { seen.insert(.random(using: &rng)) }
        #expect(seen == Set(Hand.allCases))
    }
}

@Suite("Outcome")
struct OutcomeTests {
    @Test("the deltas are +1, 0, −1, −1 and only losses slow the window")
    func deltas() {
        #expect(Outcome.win.delta == 1)
        #expect(Outcome.tie.delta == 0)
        #expect(Outcome.loss.delta == -1)
        #expect(Outcome.timeout.delta == -1)
        #expect(Outcome.allCases.filter(\.slowsTheWindow) == [.loss, .timeout])
    }

    @Test("the verdict of every pair of hands inside the window")
    func pairs() {
        for player in Hand.allCases {
            for computer in Hand.allCases {
                let verdict = Outcome.verdict(player: player, computer: computer, reactionMs: 100, windowMs: 1000)
                if player == computer {
                    #expect(verdict == .tie)
                } else if player.beats == computer {
                    #expect(verdict == .win)
                } else {
                    #expect(verdict == .loss)
                }
            }
        }
    }

    @Test("a tap at the window counts, one later or none is a timeout")
    func boundary() {
        #expect(Outcome.verdict(player: .rock, computer: .scissors, reactionMs: 1000, windowMs: 1000) == .win)
        #expect(Outcome.verdict(player: .rock, computer: .scissors, reactionMs: 1001, windowMs: 1000) == .timeout)
        #expect(Outcome.verdict(player: .rock, computer: .rock, reactionMs: 1001, windowMs: 1000) == .timeout)
        #expect(Outcome.verdict(player: nil, computer: .rock, reactionMs: nil, windowMs: 1000) == .timeout)
        #expect(Outcome.verdict(player: .paper, computer: .rock, reactionMs: nil, windowMs: 1000) == .timeout)
    }
}

@Suite("Mood")
struct MoodTests {
    @Test("the five bands", arguments: [
        (-5, Mood.verySad), (-4, .sad), (-3, .sad), (-2, .sad), (-1, .neutral), (0, .neutral), (1, .neutral),
        (2, .happy), (3, .happy), (4, .happy), (5, .veryHappy),
    ])
    func bands(counter: Int, mood: Mood) {
        #expect(Mood(counter: counter) == mood)
    }

    @Test("the mouth sags for sad, is flat for neutral and rises for happy; widths are in range")
    func mouth() {
        #expect(Mood.verySad.mouthCurvature < Mood.sad.mouthCurvature)
        #expect(Mood.sad.mouthCurvature < 0)
        #expect(Mood.neutral.mouthCurvature == 0)
        #expect(Mood.happy.mouthCurvature > 0)
        #expect(Mood.happy.mouthCurvature < Mood.veryHappy.mouthCurvature)
        for mood in Mood.allCases {
            #expect((0.3...0.8).contains(mood.mouthWidth))
            #expect((0...1).contains(mood.fill.red) && (0...1).contains(mood.fill.green) && (0...1).contains(mood.fill.blue))
        }
    }

    @Test("sad is blue, happy is yellow, and the happy end is the brightest")
    func colours() {
        for mood in [Mood.verySad, .sad] { #expect(mood.fill.blue > mood.fill.red) }
        for mood in [Mood.neutral, .happy, .veryHappy] { #expect(mood.fill.red > mood.fill.blue) }
        #expect(Mood.veryHappy.fill.red == 1)
        #expect(Mood.neutral.fill.blue > Mood.happy.fill.blue)
    }
}

@Suite("Progress")
struct ProgressTests {
    /// The §6 verdict-and-window vectors: from `window` and counter 0, the round's outcome, the
    /// counter's move, and the window after.
    @Test("the design's verdict vectors", arguments: [
        (1000, Hand?.some(.rock), Hand.scissors, Int?.some(350), Outcome.win, 1, 1000),
        (1000, .rock, .paper, 350, .loss, -1, 1000),
        (1000, .paper, .paper, 350, .tie, 0, 1000),
        (1000, .rock, .scissors, 1000, .win, 1, 1000),
        (1000, .rock, .scissors, 1001, .timeout, -1, 1000),
        (750, .scissors, .paper, 700, .win, 1, 750),
        (750, .scissors, .rock, 300, .loss, -1, 825),
        (750, nil, .rock, nil, .timeout, -1, 825),
        (750, .paper, .rock, 751, .timeout, -1, 825),
        (825, .rock, .paper, 10, .loss, -1, 908),
        (908, .rock, .paper, 10, .loss, -1, 999),
        (999, .rock, .paper, 100, .loss, -1, 1000),
        (238, .rock, .scissors, 238, .win, 1, 238),
        (238, .rock, .scissors, 239, .timeout, -1, 262),
    ])
    func vectors(window: Int, player: Hand?, computer: Hand, reaction: Int?, outcome: Outcome, delta: Int, after: Int) {
        let verdict = Outcome.verdict(player: player, computer: computer, reactionMs: reaction, windowMs: window)
        #expect(verdict == outcome)
        let before = Progress(windowMs: window)
        let next = before.apply(outcome: verdict, reactionMs: reaction)
        #expect(next.counter == delta)
        #expect(next.windowMs == after)
    }

    @Test("the counter clamps at both ends and the round still counts")
    func clamps() {
        let top = Progress(counter: 5, recentWins: [300, 300, 300, 300, 300])
        let stillTop = top.apply(outcome: .win, reactionMs: 250)
        #expect(stillTop.counter == 5)
        #expect(stillTop.recentWins == [300, 300, 300, 300, 250])
        #expect(stillTop.best == 250)
        let bottom = Progress(counter: -5, windowMs: 750)
        let stillBottom = bottom.apply(outcome: .loss, reactionMs: 100)
        #expect(stillBottom.counter == -5)
        #expect(stillBottom.windowMs == 825)
    }

    @Test("wins record the last five reactions and the best; ties and losses record nothing")
    func recording() {
        var p = Progress.fresh
        for ms in [500, 400, 300, 200, 100, 600] { p = p.apply(outcome: .win, reactionMs: ms) }
        #expect(p.recentWins == [400, 300, 200, 100, 600])
        #expect(p.best == 100)
        #expect(p.counter == 5)
        let tied = p.apply(outcome: .tie, reactionMs: 50)
        #expect(tied.recentWins == p.recentWins && tied.best == 100 && tied.windowMs == 1000)
        let lost = p.apply(outcome: .loss, reactionMs: 50)
        #expect(lost.recentWins == p.recentWins && lost.best == 100)
    }

    @Test("the window sequence from the base to the floor")
    func windows() {
        var windows: [Int] = []
        var p = Progress(counter: 5, recentWins: [1, 1, 1, 1, 1])
        while p.canTechUp {
            windows.append(p.windowMs)
            p = p.techUp()
            p.counter = 5
            p.recentWins = [1, 1, 1, 1, 1]
        }
        windows.append(p.windowMs)
        #expect(windows == [1000, 750, 563, 422, 317, 238])
        #expect(p.prestige == 5)
        #expect(p.isAtFloor)
        #expect(p.techUpWindowMs == 179)
    }

    /// The §6 tech-up eligibility vectors.
    @Test("the design's tech-up vectors", arguments: [
        (1000, 5, [700, 720, 740, 760, 780], true),
        (1000, 5, [700, 720, 760, 780, 800], false),
        (1000, 4, [100, 100, 100, 100, 100], false),
        (1000, 5, [100, 100, 100, 100], false),
        (317, 5, [200, 210, 230, 240, 250], true),
        (238, 5, [100, 100, 100, 100, 100], false),
    ])
    func techUpVectors(window: Int, counter: Int, wins: [Int], offered: Bool) {
        let p = Progress(counter: counter, windowMs: window, recentWins: wins)
        #expect(p.canTechUp == offered)
    }

    @Test("the median is the third of five sorted, regardless of order")
    func median() {
        #expect(Progress(recentWins: [780, 700, 760, 720, 740]).medianRecentWinMs == 740)
        #expect(Progress(recentWins: [1, 2, 3, 4]).medianRecentWinMs == nil)
        #expect(Progress(recentWins: []).medianRecentWinMs == nil)
    }

    @Test("taking a tech up shrinks the window, clears the counter and the wins, keeps the best")
    func techUp() {
        let p = Progress(counter: 5, windowMs: 1000, prestige: 0, recentWins: [700, 720, 740, 760, 780], best: 300)
        let next = p.techUp()
        #expect(next == Progress(counter: 0, windowMs: 750, prestige: 1, recentWins: [], best: 300))
        let notOffered = Progress(counter: 4, windowMs: 1000, recentWins: [1, 1, 1, 1, 1])
        #expect(notOffered.techUp() == notOffered)
    }

    @Test("reset is a fresh game, the best included")
    func reset() {
        let p = Progress(counter: -3, windowMs: 317, prestige: 4, recentWins: [1, 2, 3], best: 90)
        #expect(p.reset() == .fresh)
        #expect(Progress.fresh == Progress(counter: 0, windowMs: 1000, prestige: 0, recentWins: [], best: nil))
    }

    @Test("the moods by counter follow the bands")
    func moods() {
        #expect(Progress(counter: -5).mood == .verySad)
        #expect(Progress(counter: 0).mood == .neutral)
        #expect(Progress(counter: 5).mood == .veryHappy)
    }

    @Test("Progress round-trips through JSON, best present or absent")
    func codable() throws {
        for p in [
            Progress.fresh,
            Progress(counter: 5, windowMs: 563, prestige: 2, recentWins: [300, 310, 320, 330, 340], best: 210),
            Progress(counter: -5, windowMs: 1000, prestige: 0, recentWins: [], best: nil),
        ] {
            let data = try JSONEncoder().encode(p)
            #expect(try JSONDecoder().decode(Progress.self, from: data) == p)
        }
    }
}

/// A deterministic generator for the tests: a 64-bit linear congruential sequence.
private struct SeededGenerator: RandomNumberGenerator {
    var state: UInt64
    mutating func next() -> UInt64 {
        state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
        return state
    }
}
