// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "chatml-speech",
    platforms: [
        .macOS(.v12)
    ],
    targets: [
        .executableTarget(
            name: "chatml-speech",
            path: "Sources/SpeechCLI"
        )
    ]
)
