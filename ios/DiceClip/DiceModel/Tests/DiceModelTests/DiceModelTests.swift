// The model's tests: every face draws its own number of pips inside the grid, a roll is two faces
// from the generator it is given and sums them, and the URL form round-trips and rejects junk.
import Foundation
import Testing
@testable import DiceModel

/// A deterministic generator for the tests: a 64-bit linear congruential sequence.
private struct SeededGenerator: RandomNumberGenerator {
    var state: UInt64
    mutating func next() -> UInt64 {
        state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
        return state
    }
}

@Suite("DieFace")
struct DieFaceTests {
    @Test("each face has as many pips as its value, all distinct, all on the grid")
    func pips() {
        for face in DieFace.allCases {
            let pips = face.pips
            #expect(pips.count == face.rawValue)
            #expect(Set(pips).count == pips.count)
            for pip in pips {
                #expect((0...2).contains(pip.column))
                #expect((0...2).contains(pip.row))
            }
        }
    }

    @Test("odd faces have the centre pip, even faces do not")
    func centre() {
        let centre = DieFace.Pip(column: 1, row: 1)
        for face in DieFace.allCases {
            #expect(face.pips.contains(centre) == (face.rawValue % 2 == 1))
        }
    }

    @Test("a seeded generator lands on every face")
    func randomCoversEveryFace() {
        var rng = SeededGenerator(state: 42)
        var seen = Set<DieFace>()
        for _ in 0..<600 { seen.insert(.random(using: &rng)) }
        #expect(seen == Set(DieFace.allCases))
    }
}

@Suite("Roll")
struct RollTests {
    @Test("a roll sums its dice and knows doubles")
    func totalAndDoubles() {
        #expect(Roll(first: .three, second: .five).total == 8)
        #expect(Roll(first: .three, second: .five).isDoubles == false)
        #expect(Roll(first: .six, second: .six).total == 12)
        #expect(Roll(first: .six, second: .six).isDoubles)
    }

    @Test("the same seed rolls the same dice")
    func deterministic() {
        var a = SeededGenerator(state: 7)
        var b = SeededGenerator(state: 7)
        for _ in 0..<50 { #expect(Roll.random(using: &a) == Roll.random(using: &b)) }
    }

    @Test("the system roll is in range")
    func systemRoll() {
        for _ in 0..<100 {
            let roll = Roll.random()
            #expect((2...12).contains(roll.total))
        }
    }

    @Test("the query value round-trips", arguments: DieFace.allCases)
    func queryRoundTrip(first: DieFace) {
        for second in DieFace.allCases {
            let roll = Roll(first: first, second: second)
            #expect(Roll(queryValue: roll.queryValue) == roll)
        }
    }

    @Test("junk query values are nil", arguments: ["", "3", "3,", ",5", "0,4", "7,1", "a,b", "3,5,1", "3, 5", "3;5"])
    func junk(value: String) {
        #expect(Roll(queryValue: value) == nil)
    }

    @Test("a roll is read off the invocation URL and written back onto it")
    func url() throws {
        let base = try #require(URL(string: "https://games.sweedler.com/clip/dice"))
        let roll = Roll(first: .two, second: .six)
        let url = roll.url(base: base)
        #expect(url.absoluteString == "https://games.sweedler.com/clip/dice?roll=2,6")
        #expect(Roll(url: url) == roll)
        #expect(Roll(url: base) == nil)
        let other = try #require(URL(string: "https://games.sweedler.com/clip/dice?x=1&roll=4,4"))
        #expect(Roll(url: other) == Roll(first: .four, second: .four))
    }
}
