import Foundation
import Speech
import AVFoundation

/// Output message types for JSON line protocol
enum OutputMessage: Encodable {
    case ready
    case interim(text: String)
    case final(text: String)
    case soundLevel(level: Float)
    case error(message: String)
    case stopped

    enum CodingKeys: String, CodingKey {
        case type, text, level, message
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .ready:
            try container.encode("ready", forKey: .type)
        case .interim(let text):
            try container.encode("interim", forKey: .type)
            try container.encode(text, forKey: .text)
        case .final(let text):
            try container.encode("final", forKey: .type)
            try container.encode(text, forKey: .text)
        case .soundLevel(let level):
            try container.encode("soundLevel", forKey: .type)
            try container.encode(level, forKey: .level)
        case .error(let message):
            try container.encode("error", forKey: .type)
            try container.encode(message, forKey: .message)
        case .stopped:
            try container.encode("stopped", forKey: .type)
        }
    }
}

/// Outputs a JSON line to stderr (more reliable with Tauri's shell plugin)
/// Uses the same stderrQueue as log() since that works from all threads
func output(_ message: OutputMessage) {
    let encoder = JSONEncoder()
    guard let data = try? encoder.encode(message),
          let json = String(data: data, encoding: .utf8) else {
        return
    }

    // Use exact same approach as log() which works from recognition callback
    stderrQueue.sync {
        FileHandle.standardError.write("DATA:\(json)\n".data(using: .utf8)!)
        try? FileHandle.standardError.synchronize()
    }
}

/// Speech recognizer wrapper using SFSpeechRecognizer and AVAudioEngine
class SpeechRecognizer {
    private let speechRecognizer: SFSpeechRecognizer?
    private let audioEngine = AVAudioEngine()
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?

    private var lastSpeechTime: Date = Date()
    private var silenceTimer: Timer?
    private let silenceThreshold: TimeInterval = 3.0

    private var isRunning = false
    private var lastInterimText = ""

    init() {
        speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    }

    /// Check if speech recognition is available
    var isAvailable: Bool {
        return speechRecognizer?.isAvailable ?? false
    }

    /// Request authorization for speech recognition and microphone
    func requestAuthorization(completion: @escaping (Bool) -> Void) {
        SFSpeechRecognizer.requestAuthorization { status in
            DispatchQueue.main.async {
                switch status {
                case .authorized:
                    // Also check microphone permission
                    AVCaptureDevice.requestAccess(for: .audio) { granted in
                        completion(granted)
                    }
                default:
                    completion(false)
                }
            }
        }
    }

    /// Start speech recognition
    func start() {
        guard let speechRecognizer = speechRecognizer, speechRecognizer.isAvailable else {
            output(.error(message: "Speech recognizer not available"))
            return
        }

        guard !isRunning else {
            output(.error(message: "Already running"))
            return
        }

        do {
            try startRecognition()
            isRunning = true
            output(.ready)
            startSilenceTimer()
        } catch {
            log("Error starting recognition: \(error.localizedDescription)")
            output(.error(message: error.localizedDescription))
        }
    }

    /// Stop speech recognition
    func stop() {
        stopSilenceTimer()

        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)

        recognitionRequest?.endAudio()
        recognitionRequest = nil

        recognitionTask?.cancel()
        recognitionTask = nil

        isRunning = false
        output(.stopped)
    }

    private func startRecognition() throws {
        // Cancel previous task if any
        recognitionTask?.cancel()
        recognitionTask = nil

        // Note: AVAudioSession is not available on macOS
        // The system handles audio routing automatically

        // Create recognition request
        recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
        guard let recognitionRequest = recognitionRequest else {
            throw NSError(domain: "SpeechRecognizer", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unable to create recognition request"])
        }

        // Configure for on-device recognition if available (privacy)
        recognitionRequest.shouldReportPartialResults = true

        // Check on-device support
        if #available(macOS 13.0, *) {
            // Don't require on-device - let it use server if needed
            recognitionRequest.requiresOnDeviceRecognition = false
        }

        // Start recognition task
        recognitionTask = speechRecognizer?.recognitionTask(with: recognitionRequest) { [weak self] result, error in
            guard let self = self else { return }

            if let result = result {
                let text = result.bestTranscription.formattedString

                if result.isFinal {
                    output(.final(text: text))
                    self.lastInterimText = ""
                } else if text != self.lastInterimText {
                    output(.interim(text: text))
                    self.lastInterimText = text
                    self.lastSpeechTime = Date()
                }
            }

            if let error = error {
                let nsError = error as NSError
                // Ignore cancellation errors
                if nsError.domain != "kAFAssistantErrorDomain" || nsError.code != 216 {
                    log("Recognition error: \(error.localizedDescription)")
                    output(.error(message: error.localizedDescription))
                }
                self.stop()
            }
        }

        if recognitionTask == nil {
            log("ERROR: Recognition task is nil!")
        }

        // Configure audio input
        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)

        var bufferCount = 0
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { [weak self] buffer, _ in
            self?.recognitionRequest?.append(buffer)

            // Calculate sound level
            let level = self?.calculateSoundLevel(buffer: buffer) ?? 0

            // Only output sound level occasionally to avoid flooding
            bufferCount += 1
            if bufferCount % 10 == 0 {
                output(.soundLevel(level: level))
            }
        }

        audioEngine.prepare()
        try audioEngine.start()
    }

    private func calculateSoundLevel(buffer: AVAudioPCMBuffer) -> Float {
        guard let channelData = buffer.floatChannelData?[0] else { return 0 }
        let frameLength = Int(buffer.frameLength)

        var sum: Float = 0
        for i in 0..<frameLength {
            sum += abs(channelData[i])
        }

        let average = sum / Float(frameLength)
        // Convert to 0-1 range with some scaling
        return min(1.0, average * 10)
    }

    private func startSilenceTimer() {
        silenceTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            guard let self = self, self.isRunning else { return }

            let timeSinceLastSpeech = Date().timeIntervalSince(self.lastSpeechTime)
            if timeSinceLastSpeech >= self.silenceThreshold && !self.lastInterimText.isEmpty {
                // Auto-stop after silence
                self.stop()
            }
        }
    }

    private func stopSilenceTimer() {
        silenceTimer?.invalidate()
        silenceTimer = nil
    }
}
