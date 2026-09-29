// The Live Activity's views: on the Lock Screen both dice and the total; in the Dynamic Island one
// die in each compact region (leading: the first, trailing: the second), both dice large with the
// total when expanded, and the first die as the minimal glyph. Tapping any of them opens the
// invocation URL carrying the roll.
import ActivityKit
import DiceModel
import SwiftUI
import WidgetKit

struct DiceActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: DiceAttributes.self) { context in
            LockScreenView(state: context.state)
                .activityBackgroundTint(Color(red: 0.10, green: 0.14, blue: 0.12))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(context.state.roll.url(base: Invocation.url))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    DieView(face: context.state.roll.first)
                        .frame(width: 56, height: 56)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    DieView(face: context.state.roll.second)
                        .frame(width: 56, height: 56)
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text("\(context.state.roll.total)")
                        .font(.system(size: 36, weight: .bold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(.white)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(context.state.roll.isDoubles ? "Doubles, rolled at " : "Rolled at ")
                        .foregroundStyle(.secondary)
                        + Text(context.state.rolledAt, style: .time)
                        .foregroundStyle(.secondary)
                }
            } compactLeading: {
                DieView(face: context.state.roll.first)
                    .padding(2)
            } compactTrailing: {
                DieView(face: context.state.roll.second)
                    .padding(2)
            } minimal: {
                DieView(face: context.state.roll.first)
                    .padding(3)
            }
            .widgetURL(context.state.roll.url(base: Invocation.url))
            .keylineTint(.white.opacity(0.6))
        }
    }
}

/// The Lock Screen banner: both dice at the left, the total and the time at the right.
struct LockScreenView: View {
    let state: DiceAttributes.ContentState

    var body: some View {
        HStack(spacing: 16) {
            RollView(roll: state.roll, spacing: 10)
                .frame(height: 60)
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                Text("\(state.roll.total)")
                    .font(.system(size: 40, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(.white)
                Text(state.roll.isDoubles ? "Doubles" : "Sheshbesh Dice")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.7))
                Text(state.rolledAt, style: .time)
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.7))
            }
        }
        .padding(16)
        .accessibilityElement(children: .combine)
    }
}
