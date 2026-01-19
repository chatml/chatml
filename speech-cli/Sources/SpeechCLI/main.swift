import Foundation

/// Main entry point for the speech recognition CLI
/// Communicates via JSON lines on stdout
/// Accepts "stop" command on stdin

let recognizer = SpeechRecognizer()

// Check availability first
guard recognizer.isAvailable else {
    output(.error(message: "Speech recognition not available on this system"))
    exit(1)
}

// Request authorization
let semaphore = DispatchSemaphore(value: 0)
var authorized = false

recognizer.requestAuthorization { granted in
    authorized = granted
    semaphore.signal()
}

semaphore.wait()

guard authorized else {
    output(.error(message: "Speech recognition or microphone permission denied"))
    exit(1)
}

// Start listening
recognizer.start()

// Handle stdin for stop command
let stdinSource = DispatchSource.makeReadSource(fileDescriptor: FileHandle.standardInput.fileDescriptor, queue: .main)

stdinSource.setEventHandler {
    let data = FileHandle.standardInput.availableData
    if data.isEmpty {
        // EOF - parent process closed stdin
        recognizer.stop()
        exit(0)
    }

    if let command = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) {
        if command == "stop" {
            recognizer.stop()
            exit(0)
        }
    }
}

stdinSource.resume()

// Keep the run loop alive
RunLoop.main.run()
