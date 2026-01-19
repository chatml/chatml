import Foundation

/// Serial queue for all stderr output (shared with SpeechRecognizer)
let stderrQueue = DispatchQueue(label: "com.chatml.speech.stderr")

/// Log to stderr for debugging (synchronized with JSON output)
func log(_ message: String) {
    stderrQueue.sync {
        FileHandle.standardError.write("[\(Date())] \(message)\n".data(using: .utf8)!)
        try? FileHandle.standardError.synchronize()
    }
}

/// Main entry point for the speech recognition CLI
/// Communicates via JSON lines on stderr (DATA: prefix)
/// Accepts "stop" command on stdin

let recognizer = SpeechRecognizer()

// Check availability first
guard recognizer.isAvailable else {
    output(.error(message: "Speech recognition not available on this system"))
    exit(1)
}

// Set up stdin handler
var stdinSource: DispatchSourceRead?
var stdinClosed = false

func setupStdinHandler() {
    stdinSource = DispatchSource.makeReadSource(fileDescriptor: FileHandle.standardInput.fileDescriptor, queue: .global())
    stdinSource?.setEventHandler {
        guard !stdinClosed else { return }

        let data = FileHandle.standardInput.availableData
        if data.isEmpty {
            // EOF - parent process closed stdin
            stdinClosed = true
            stdinSource?.cancel()
            DispatchQueue.main.async {
                recognizer.stop()
                exit(0)
            }
            return
        }

        if let command = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) {
            if command == "stop" {
                stdinClosed = true
                stdinSource?.cancel()
                DispatchQueue.main.async {
                    recognizer.stop()
                    exit(0)
                }
            }
        }
    }
    stdinSource?.resume()
}

setupStdinHandler()

// Request authorization
recognizer.requestAuthorization { granted in
    guard granted else {
        output(.error(message: "Speech recognition or microphone permission denied"))
        exit(1)
    }

    recognizer.start()
}

// Keep the run loop alive
RunLoop.main.run()
