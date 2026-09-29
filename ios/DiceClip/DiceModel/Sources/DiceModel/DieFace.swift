// A die face (one to six) and the pip layout that draws it: pips on a three-by-three grid, the
// same positions every die in the app, the clip and the Live Activity is drawn from.

/// One face of a six-sided die.
public enum DieFace: Int, CaseIterable, Codable, Hashable, Sendable {
    case one = 1, two, three, four, five, six

    /// A pip's cell on the three-by-three grid a face is drawn on: column and row in 0...2.
    public struct Pip: Hashable, Sendable {
        public let column: Int
        public let row: Int

        public init(column: Int, row: Int) {
            self.column = column
            self.row = row
        }
    }

    /// The cells this face fills, the way a casino die lays them out (the six is two columns).
    public var pips: [Pip] {
        let centre = Pip(column: 1, row: 1)
        let topLeft = Pip(column: 0, row: 0)
        let topRight = Pip(column: 2, row: 0)
        let midLeft = Pip(column: 0, row: 1)
        let midRight = Pip(column: 2, row: 1)
        let bottomLeft = Pip(column: 0, row: 2)
        let bottomRight = Pip(column: 2, row: 2)
        switch self {
        case .one: return [centre]
        case .two: return [topLeft, bottomRight]
        case .three: return [topLeft, centre, bottomRight]
        case .four: return [topLeft, topRight, bottomLeft, bottomRight]
        case .five: return [topLeft, topRight, centre, bottomLeft, bottomRight]
        case .six: return [topLeft, topRight, midLeft, midRight, bottomLeft, bottomRight]
        }
    }

    /// A random face from `rng`, each of the six equally likely.
    public static func random(using rng: inout some RandomNumberGenerator) -> DieFace {
        DieFace(rawValue: Int.random(in: 1...6, using: &rng))!
    }
}
