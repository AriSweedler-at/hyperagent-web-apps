// The widget extension's entry point. It holds the Live Activity alone: an App Clip's widget
// extension may offer Live Activities and nothing else (no Home Screen or Lock Screen widgets).
import SwiftUI
import WidgetKit

@main
struct DiceActivityBundle: WidgetBundle {
    var body: some Widget {
        DiceActivityWidget()
    }
}
