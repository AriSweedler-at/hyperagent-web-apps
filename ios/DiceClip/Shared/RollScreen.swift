// The dice screen the app and the clip share: the last roll drawn large, the Roll button, and a
// line on what a roll does to the Dynamic Island. The invocation URL (`?roll=a,b`) reaches it from
// RootScreen, which reads every URL once; a roll on it shows as if it had just been made here.
import SwiftUI

struct RollScreen: View {
    @State private var roller = DiceRoller()
    /// The clip says so in its explanation; the full app does not.
    let isClip: Bool
    /// The URL the app or clip was opened with, routed here by RootScreen.
    let webURL: URL?

    var body: some View {
        VStack(spacing: 28) {
            Spacer(minLength: 0)
            Text("Sheshbesh Dice")
                .font(.largeTitle.weight(.bold))
            lastRoll
            Button(action: roller.roll) {
                Text("Roll")
                    .font(.title2.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
            }
            .buttonStyle(.borderedProminent)
            .tint(Palette.startGreen)
            .foregroundStyle(Palette.startText)
            .accessibilityHint("Rolls two dice and puts them in the Dynamic Island")
            explanation
            Spacer(minLength: 0)
        }
        .padding(24)
        .onChange(of: webURL, initial: true) { _, url in
            if let url { roller.show(webURL: url) }
        }
    }

    @ViewBuilder private var lastRoll: some View {
        if let roll = roller.lastRoll {
            VStack(spacing: 12) {
                RollView(roll: roll, spacing: 20)
                    .frame(height: 120)
                Text("\(roll.total)")
                    .font(.system(size: 44, weight: .bold, design: .rounded))
                    .monospacedDigit()
                Text(roll.isDoubles ? "Doubles" : (roller.source == .web ? "Rolled on the web" : " "))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        } else {
            VStack(spacing: 12) {
                RollView(roll: .init(first: .one, second: .one), body_: Color(.systemFill), pip: .clear, spacing: 20)
                    .frame(height: 120)
                Text("No roll yet")
                    .font(.title3)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder private var explanation: some View {
        VStack(spacing: 8) {
            Text(
                isClip
                    ? "This App Clip rolls two dice. Each roll starts a Live Activity, or updates the one already up: one die on each side of the Dynamic Island, both on the Lock Screen."
                    : "Each roll starts a Live Activity, or updates the one already up: one die on each side of the Dynamic Island, both on the Lock Screen. The activity ends itself after eight hours."
            )
            if !roller.activitiesEnabled {
                Text("Live Activities are off for this app in Settings; the dice still roll here.")
                    .foregroundStyle(.orange)
            }
            if let problem = roller.problem {
                Text(problem).foregroundStyle(.red)
            }
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
    }
}
