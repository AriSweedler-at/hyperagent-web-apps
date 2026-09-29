// The buddy in the island. Moving: `Text(timerInterval:)` is the one view a Live Activity runs on
// its own, so each band has a font whose ten digit glyphs are its frames (Config/Fonts, written by
// tools/buddy-font.ts from web/public/games/rps/buddy/) and the timer's seconds digit, clipped to
// one em, is the buddy at 1 fps with no push (docs/design/rps-buddy.md "Moving in the island";
// docs/design/rps-island.md §7). Fallback, when a font is not in the bundle: the pixel frames drawn
// in code below (rows of characters, one per pixel: `.` clear, `#` the fill, `o` ink, `=` a darker
// shade), frame `at mod N` per push.
import DiceModel
import SwiftUI
import UIKit

/// One frame: equal-length rows of pixel characters.
struct PixelFrame: Hashable, Sendable {
    let rows: [String]

    var width: Int { rows.first?.count ?? 0 }
    var height: Int { rows.count }
}

/// The frame sets: bouncing when happy, walking when neutral, sulking when sad. Placeholders,
/// eight by eight, two frames each; the interface is the contract, not the art.
enum BuddyFrames {
    /// How long a frame would show if the surface animated freely; the web page uses it, the
    /// island advances a frame per update instead.
    static let frameDuration: Duration = .milliseconds(500)

    static func frames(for mood: Mood) -> [PixelFrame] {
        switch mood {
        case .veryHappy: bounce(high: true)
        case .happy: bounce(high: false)
        case .neutral: walk
        case .sad: sulk(deep: false)
        case .verySad: sulk(deep: true)
        }
    }

    /// The frame to show for a state: advances with every update, so each push moves the buddy.
    static func index(for state: MoodActivityAttributes.ContentState) -> Int {
        let count = frames(for: state.band).count
        return count == 0 ? 0 : Int(state.at.timeIntervalSince1970.rounded()) % count
    }

    // Two frames of a bounce: on the ground, squashed wide; in the air, tall with a grin.
    private static func bounce(high: Bool) -> [PixelFrame] {
        let ground = PixelFrame(rows: [
            "........",
            "........",
            "........",
            ".######.",
            "#o####o#",
            "#o#####o",
            "#o=oo=o#",
            ".######.",
        ])
        let air = PixelFrame(rows: [
            ".######.",
            "#o####o#",
            "#o####o#",
            "#=oooo=#",
            ".######.",
            "..####..",
            "........",
            "........",
        ])
        let grin = PixelFrame(rows: [
            "..####..",
            ".######.",
            "#o####o#",
            "#o####o#",
            "#oo##oo#",
            "#=oooo=#",
            ".######.",
            "........",
        ])
        return high ? [air, grin] : [ground, air]
    }

    // Two frames of a walk: the legs alternate.
    private static let walk: [PixelFrame] = [
        PixelFrame(rows: [
            "........",
            ".######.",
            "#o####o#",
            "########",
            "#=oooo=#",
            ".######.",
            "..#..#..",
            ".#....#.",
        ]),
        PixelFrame(rows: [
            "........",
            ".######.",
            "#o####o#",
            "########",
            "#=oooo=#",
            ".######.",
            "..#..#..",
            "...##...",
        ]),
    ]

    // Two frames of a sulk: slumped, the mouth drooping; deeper for very sad.
    private static func sulk(deep: Bool) -> [PixelFrame] {
        let slump = PixelFrame(rows: [
            "........",
            "........",
            "..####..",
            ".######.",
            "#o####o#",
            "##=oo=##",
            "#o####o#",
            ".######.",
        ])
        let sigh = PixelFrame(rows: [
            "........",
            "........",
            "........",
            "..####..",
            ".#o##o#.",
            "##=oo=##",
            "#o####o#",
            ".######.",
        ])
        let puddle = PixelFrame(rows: [
            "........",
            "........",
            "........",
            "........",
            "..####..",
            ".#o##o#.",
            "#o=oo=o#",
            "########",
        ])
        return deep ? [sigh, puddle] : [slump, sigh]
    }
}

/// One frame drawn as rects, each colour one path, at whatever size it is given (crisp: the pixels
/// snap to the cell grid).
struct PixelSpriteView: View {
    let frame: PixelFrame
    let fill: Color
    let ink: Color

    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height)
            let cell = side / CGFloat(max(frame.width, frame.height, 1))
            ZStack {
                path(for: "#").fill(fill)
                path(for: "=").fill(fill.opacity(0.7))
                path(for: "o").fill(ink)
            }
            .frame(width: cell * CGFloat(frame.width), height: cell * CGFloat(frame.height))
            .frame(width: proxy.size.width, height: proxy.size.height)
            .environment(\.pixelCell, cell)
        }
        .aspectRatio(1, contentMode: .fit)
    }

    /// The path of every cell holding `character`, in a unit grid the view scales by the cell.
    private func path(for character: Character) -> PixelPath {
        var cells: [(Int, Int)] = []
        for (y, row) in frame.rows.enumerated() {
            for (x, ch) in row.enumerated() where ch == character { cells.append((x, y)) }
        }
        return PixelPath(cells: cells)
    }
}

/// A shape of unit cells scaled to the environment's cell size.
private struct PixelPath: Shape {
    let cells: [(Int, Int)]
    @Environment(\.pixelCell) private var cellFromEnvironment

    func path(in rect: CGRect) -> Path {
        // The cell is the rect's width over the widest row; the view sized the rect to the grid.
        let columns = cells.map(\.0).max().map { $0 + 1 } ?? 1
        let rows = cells.map(\.1).max().map { $0 + 1 } ?? 1
        _ = columns
        _ = rows
        var path = Path()
        for (x, y) in cells {
            path.addRect(CGRect(x: rect.minX + CGFloat(x) * cellFromEnvironment,
                                y: rect.minY + CGFloat(y) * cellFromEnvironment,
                                width: cellFromEnvironment, height: cellFromEnvironment))
        }
        return path
    }
}

private struct PixelCellKey: EnvironmentKey {
    static let defaultValue: CGFloat = 4
}

extension EnvironmentValues {
    var pixelCell: CGFloat {
        get { self[PixelCellKey.self] }
        set { self[PixelCellKey.self] = newValue }
    }
}

/// The timer fonts, one per band: `Buddy-VerySad` … `Buddy-VeryHappy`, 1024 units per em over the
/// 24-pixel grid, digit `d` the band's frame `d mod N`, space and colon empty and zero-wide. They are
/// registered in Activity-Info.plist (`UIAppFonts`) and copied by both extensions' Resources phase.
enum BuddyFont {
    static func name(for mood: Mood) -> String {
        switch mood {
        case .verySad: "Buddy-VerySad"
        case .sad: "Buddy-Sad"
        case .neutral: "Buddy-Neutral"
        case .happy: "Buddy-Happy"
        case .veryHappy: "Buddy-VeryHappy"
        }
    }

    /// Whether the band's font is in this bundle; false shows the pushed frame instead.
    static func isAvailable(for mood: Mood) -> Bool {
        UIFont(name: name(for: mood), size: 32) != nil
    }

    /// The timer's far end past the activity's eight-hour ceiling, so the digits never stop.
    static let span: TimeInterval = 24 * 60 * 60
}

/// The buddy as the seconds digit of a running timer in the band's font. The text is laid out at
/// its own width (`m:ss`: every digit one em, the colon nothing) and aligned trailing in a one-em
/// frame, so the minutes and the tens digit hang out of the clip on the left and only the units
/// digit, the frame, shows. One em is `size` points; the digit at any moment is a function of
/// `start` alone, so every surface shows the same frame.
struct TimerBuddyView: View {
    let band: Mood
    let start: Date
    let size: CGFloat

    var body: some View {
        Text(timerInterval: start ... start.addingTimeInterval(BuddyFont.span),
             countsDown: false, showsHours: false)
            .font(.custom(BuddyFont.name(for: band), size: size))
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(1)
            .fixedSize()
            .frame(width: size, height: size, alignment: .trailing)
            .clipped()
            .foregroundStyle(Color(band.fill))
    }
}

/// The buddy for a state at `size` points: the timer font's frame when the band's font is in the
/// bundle, else the frame the update landed on, drawn in code; in the band's colour, morphing on a
/// band change.
struct BuddyView: View {
    let state: MoodActivityAttributes.ContentState
    /// When the activity began: the timer's origin.
    let start: Date
    let size: CGFloat

    var body: some View {
        Group {
            if BuddyFont.isAvailable(for: state.band) {
                TimerBuddyView(band: state.band, start: start, size: size)
            } else {
                let frames = BuddyFrames.frames(for: state.band)
                let frame = frames.isEmpty ? PixelFrame(rows: []) : frames[BuddyFrames.index(for: state)]
                PixelSpriteView(frame: frame, fill: Color(state.band.fill), ink: Color(Mood.ink))
                    .frame(width: size, height: size)
                    .id(frame)
            }
        }
        .id(state.band)
        .transition(.scale(scale: 0.8).combined(with: .opacity))
        .animation(.spring(duration: 0.4), value: state)
        .accessibilityLabel("\(state.band.label) buddy")
    }
}

/// The signed counter as text, its digits sliding on change; the island's compact trailing region
/// and the score on screen.
struct CounterText: View {
    let counter: Int

    var body: some View {
        Text(MoodActivityAttributes.ContentState.signed(counter))
            .monospacedDigit()
            .contentTransition(.numericText(value: Double(counter)))
            .animation(.spring(duration: 0.4), value: counter)
    }
}

extension Color {
    /// The model's colour as SwiftUI's.
    init(_ rgb: Mood.RGB) {
        self.init(red: rgb.red, green: rgb.green, blue: rgb.blue)
    }
}
