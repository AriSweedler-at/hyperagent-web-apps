// A die drawn as SwiftUI shapes: a rounded square and its pips on the model's three-by-three grid.
// The same view draws the app's big dice, the Lock Screen pair, and the two 20-point dice in the
// compact Dynamic Island; it scales with the room it is given and ships no image.
import DiceModel
import SwiftUI

struct DieView: View {
    let face: DieFace
    /// The die's body and pip colours; the Island and the Lock Screen pass their own.
    var body_: Color = .white
    var pip: Color = .black

    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height)
            let cell = side / 3
            let pipSize = side * 0.2
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: side * 0.18, style: .continuous)
                    .fill(body_)
                    .overlay(
                        RoundedRectangle(cornerRadius: side * 0.18, style: .continuous)
                            .strokeBorder(pip.opacity(0.25), lineWidth: max(1, side * 0.02))
                    )
                ForEach(Array(face.pips.enumerated()), id: \.offset) { _, pipCell in
                    Circle()
                        .fill(pip)
                        .frame(width: pipSize, height: pipSize)
                        .position(
                            x: cell * (CGFloat(pipCell.column) + 0.5),
                            y: cell * (CGFloat(pipCell.row) + 0.5)
                        )
                }
            }
            .frame(width: side, height: side)
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityLabel("Die showing \(face.rawValue)")
    }
}

/// Both dice side by side, the app's and the Lock Screen's shape of a roll.
struct RollView: View {
    let roll: Roll
    var body_: Color = .white
    var pip: Color = .black
    var spacing: CGFloat = 12

    var body: some View {
        HStack(spacing: spacing) {
            DieView(face: roll.first, body_: body_, pip: pip)
            DieView(face: roll.second, body_: body_, pip: pip)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Rolled \(roll.first.rawValue) and \(roll.second.rawValue), \(roll.total) in all")
    }
}
