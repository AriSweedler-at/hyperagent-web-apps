// The five faces a counter maps to and the numbers that draw each: the band's fill colour, the
// mouth's curvature (a frown below zero, a smile above) and its width. No SwiftUI here: the face
// view in Shared/MoodFace.swift and the web page read these numbers (docs/design/rps-island.md §4).

/// One of the five bands of the counter.
public enum Mood: String, CaseIterable, Codable, Hashable, Sendable {
    case verySad, sad, neutral, happy, veryHappy

    /// The band a counter falls in: −5, −4…−2, −1…1, 2…4, 5 (values outside ±5 take the end band).
    public init(counter: Int) {
        switch counter {
        case ...(-5): self = .verySad
        case -4...(-2): self = .sad
        case -1...1: self = .neutral
        case 2...4: self = .happy
        default: self = .veryHappy
        }
    }

    /// A colour as three components in 0...1, so the model needs no UI framework.
    public struct RGB: Hashable, Sendable {
        public let red: Double
        public let green: Double
        public let blue: Double

        /// From a `#RRGGBB` hex triplet written as one integer, `0x3B6FD6`.
        init(hex: UInt32) {
            red = Double((hex >> 16) & 0xFF) / 255
            green = Double((hex >> 8) & 0xFF) / 255
            blue = Double(hex & 0xFF) / 255
        }
    }

    /// The face's fill: blue for sad, pale yellow for neutral, bright yellow for happy.
    public var fill: RGB {
        switch self {
        case .verySad: RGB(hex: 0x3B6FD6)
        case .sad: RGB(hex: 0x6C9BEA)
        case .neutral: RGB(hex: 0xF2E6A8)
        case .happy: RGB(hex: 0xF5CD3B)
        case .veryHappy: RGB(hex: 0xFFD200)
        }
    }

    /// The eyes' and mouth's colour, the same on every band.
    public static let ink = RGB(hex: 0x1F2430)

    /// The mouth's sag in −1…1: the control point of its curve sits `mouthCurvature × 0.45 × radius`
    /// below the mouth's ends; negative is a frown.
    public var mouthCurvature: Double {
        switch self {
        case .verySad: -1.0
        case .sad: -0.5
        case .neutral: 0.0
        case .happy: 0.5
        case .veryHappy: 1.0
        }
    }

    /// The mouth's span as a fraction of the face's diameter.
    public var mouthWidth: Double {
        switch self {
        case .verySad: 0.60
        case .sad: 0.45
        case .neutral: 0.40
        case .happy: 0.50
        case .veryHappy: 0.70
        }
    }

    /// The band in words, for accessibility labels and the web page's alt text.
    public var label: String {
        switch self {
        case .verySad: "very sad"
        case .sad: "sad"
        case .neutral: "neutral"
        case .happy: "happy"
        case .veryHappy: "very happy"
        }
    }
}
