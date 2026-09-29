// The widget extension's entry point. It holds the two Live Activities (the dice, the buddy) and
// nothing else: an App Clip's widget extension may offer Live Activities alone, no widgets.
import SwiftUI
import WidgetKit

@main
struct DiceActivityBundle: WidgetBundle {
    var body: some Widget {
        DiceActivityWidget()
        MoodActivityWidget()
    }
}
