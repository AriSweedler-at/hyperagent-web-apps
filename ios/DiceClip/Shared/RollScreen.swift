// The one screen the app and the clip share: the last roll drawn large, the Roll button, and a
// line on what a roll does to the Dynamic Island. The clip also reads the invocation URL it was
// launched with (`?roll=a,b`) and shows that roll as if it had just been made here.
import SwiftUI

struct RollScreen: View {
    @State private var roller = DiceRoller()
    /// The clip says so in its explanation; the full app does not.
    let isClip: Bool

    /// The games' call-to-action green and its label colour (web/shared/styles/tokens.css `--go`
    /// #c2d06d and `--go-text` #10281a), so the one button here is the one the site's players know.
    private let startGreen = Color(red: 0xC2 / 255.0, green: 0xD0 / 255.0, blue: 0x6D / 255.0)
    private let startText = Color(red: 0x10 / 255.0, green: 0x28 / 255.0, blue: 0x1A / 255.0)

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
            .tint(startGreen)
            .foregroundStyle(startText)
            .accessibilityHint("Rolls two dice and puts them in the Dynamic Island")
            explanation
            Spacer(minLength: 0)
        }
        .padding(24)
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
            if let url = activity.webpageURL { roller.show(webURL: url) }
        }
        .onOpenURL { url in roller.show(webURL: url) }
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
