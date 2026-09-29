// The buddy's Live Activity views (docs/design/rps-island.md §5): in the Dynamic Island the pixel
// buddy in the compact leading region and the signed counter in the trailing one, the buddy as the
// minimal glyph; expanded, the buddy large at the left, the counter at the right, the prestige in
// the centre and when the last round ended at the bottom. The Lock Screen banner is the expanded
// row in one line. Every update (a push from the Worker) moves the buddy a frame and morphs its
// colour; tapping opens the clip on this session.
import ActivityKit
import DiceModel
import SwiftUI
import WidgetKit

struct MoodActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: MoodActivityAttributes.self) { context in
            BuddyLockScreenView(state: context.state)
                .activityBackgroundTint(Color(red: 0.10, green: 0.14, blue: 0.12))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(Invocation.rpsURL(session: context.attributes.session))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    BuddyView(state: context.state)
                        .frame(width: 56, height: 56)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    CounterText(counter: context.state.counter)
                        .font(.system(size: 36, weight: .bold, design: .rounded))
                        .foregroundStyle(Color(context.state.band.fill))
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.state.prestigeLine)
                        .font(.headline)
                        .foregroundStyle(.white)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text("\(context.state.band.label.capitalized) · last round at ")
                        .foregroundStyle(.secondary)
                        + Text(context.state.at, style: .time)
                        .foregroundStyle(.secondary)
                }
            } compactLeading: {
                BuddyView(state: context.state)
                    .padding(2)
            } compactTrailing: {
                CounterText(counter: context.state.counter)
                    .font(.system(.body, weight: .bold))
                    .foregroundStyle(Color(context.state.band.fill))
                    .padding(.horizontal, 2)
            } minimal: {
                BuddyView(state: context.state)
                    .padding(3)
            }
            .widgetURL(Invocation.rpsURL(session: context.attributes.session))
            .keylineTint(Color(context.state.band.fill))
        }
    }
}

/// The Lock Screen banner: the buddy at the left, the counter and the prestige beside it, the band
/// and the time at the right.
struct BuddyLockScreenView: View {
    let state: MoodActivityAttributes.ContentState

    var body: some View {
        HStack(spacing: 16) {
            BuddyView(state: state)
                .frame(width: 60, height: 60)
            VStack(alignment: .leading, spacing: 2) {
                CounterText(counter: state.counter)
                    .font(.system(size: 40, weight: .bold, design: .rounded))
                    .foregroundStyle(Color(state.band.fill))
                Text(state.prestigeLine)
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.7))
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                Text(state.band.label.capitalized)
                    .font(.headline)
                    .foregroundStyle(.white)
                Text(state.at, style: .time)
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.7))
            }
        }
        .padding(16)
        .accessibilityElement(children: .combine)
    }
}
