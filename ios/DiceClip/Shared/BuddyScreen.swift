// The clip's screen for the buddy: it says the buddy is in the Dynamic Island, shows the session,
// the pairing's state and a preview of what the island holds, links back to the game in the
// browser, and can send the buddy home. The rounds are played on the web page; this screen never
// scores anything (docs/design/rps-island.md D1, §8).
import DiceModel
import SwiftUI

struct BuddyScreen: View {
    @State private var buddy = MoodActivity()
    /// The preview's timer origin until an activity has one of its own.
    @State private var opened = Date.now
    let isClip: Bool
    /// The URL the app or clip was opened with, routed here by RootScreen.
    let webURL: URL?

    var body: some View {
        VStack(spacing: 24) {
            Spacer(minLength: 0)
            Text("Reaction buddy")
                .font(.largeTitle.weight(.bold))
            preview
            status
            if let session = buddy.session {
                Link(destination: Invocation.gameURL(session: session)) {
                    Text("Back to the game")
                        .font(.title2.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                }
                .buttonStyle(.borderedProminent)
                .tint(Palette.startGreen)
                .foregroundStyle(Palette.startText)
                if case .failed = buddy.pairing {
                    Button("Try pairing again", action: buddy.retryPairing)
                }
                Button("Send buddy home", role: .destructive, action: buddy.sendHome)
                    .disabled(buddy.state == nil)
            }
            explanation
            Spacer(minLength: 0)
        }
        .padding(24)
        .onChange(of: webURL, initial: true) { _, url in
            if let url { buddy.start(webURL: url) }
        }
    }

    @ViewBuilder private var preview: some View {
        let state = buddy.state ?? .fresh()
        HStack(spacing: 20) {
            BuddyView(state: state, start: buddy.startedAt ?? opened, size: 96)
            VStack(alignment: .leading, spacing: 4) {
                CounterText(counter: state.counter)
                    .font(.system(size: 44, weight: .bold, design: .rounded))
                Text(state.band.label)
                    .font(.headline)
                Text(state.prestigeLine)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .opacity(buddy.state == nil ? 0.4 : 1)
    }

    @ViewBuilder private var status: some View {
        VStack(spacing: 6) {
            if let session = buddy.session {
                Text("Session \(session)")
                    .font(.system(.body, design: .monospaced))
                Text(pairingText)
                    .font(.footnote)
                    .foregroundStyle(pairingIsBad ? .orange : .secondary)
            } else {
                Text("Open this from the game page: its link carries the session your buddy follows.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
    }

    private var pairingText: String {
        switch buddy.pairing {
        case .idle: "Not paired yet."
        case .waitingForToken: "Waiting for the push token…"
        case .sending(let attempt): "Pairing with the game (try \(attempt) of \(Config.pairAttempts))…"
        case .paired: "Paired: every round reaches the island by push."
        case .failed(let why): "Pairing failed: \(why)"
        }
    }

    private var pairingIsBad: Bool {
        if case .failed = buddy.pairing { return true }
        return false
    }

    @ViewBuilder private var explanation: some View {
        VStack(spacing: 8) {
            Text(
                isClip
                    ? "Your buddy lives in the Dynamic Island while you play in Safari. The island follows the game's score a moment behind: blue and sulking when you lose, yellow and bouncing when you win."
                    : "Your buddy lives in the Dynamic Island while you play in Safari. The island follows the game's score a moment behind; the activity ends itself after eight hours."
            )
            if !buddy.activitiesEnabled {
                Text("Live Activities are off for this app in Settings; the game still plays in the browser.")
                    .foregroundStyle(.orange)
            }
            if let problem = buddy.problem {
                Text(problem).foregroundStyle(.red)
            }
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
    }
}
