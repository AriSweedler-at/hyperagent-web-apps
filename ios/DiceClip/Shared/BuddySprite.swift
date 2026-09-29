// The buddy as pixel art drawn in code: a frame is rows of characters, one per pixel (`.` clear,
// `#` the band's fill, `o` ink for eyes and mouth, `=` a darker shade), N frames per mood with one
// frame duration, so another lane can swap the placeholder frames for sourced art without touching
// the views. The island shows frame `k` and moves to the next on every update: the platform runs no
// free animation of its own (docs/design/rps-island.md §4, §7).
import DiceModel
import SwiftUI

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

/// The buddy for a state: the frame the update landed on, in the band's colours, morphing on change.
struct BuddyView: View {
    let state: MoodActivityAttributes.ContentState

    var body: some View {
        let frames = BuddyFrames.frames(for: state.band)
        let frame = frames.isEmpty ? PixelFrame(rows: []) : frames[BuddyFrames.index(for: state)]
        PixelSpriteView(frame: frame, fill: Color(state.band.fill), ink: Color(Mood.ink))
            .id(frame)
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
