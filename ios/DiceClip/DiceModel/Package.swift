// swift-tools-version: 6.0
// The pure dice model: what a die face is, where its pips sit, how two dice roll and how a roll
// travels in a URL. No UI, no ActivityKit: `swift test` runs it on a Mac with no simulator.
import PackageDescription

let package = Package(
    name: "DiceModel",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "DiceModel", targets: ["DiceModel"])],
    targets: [
        .target(name: "DiceModel"),
        .testTarget(name: "DiceModelTests", dependencies: ["DiceModel"]),
    ],
    swiftLanguageModes: [.v6]
)
