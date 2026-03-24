//! macOS Speech-to-Text dictation via Apple's SFSpeechRecognizer.
//!
//! Uses AVAudioEngine to capture microphone input and SFSpeechRecognizer
//! for real-time on-device transcription. Events are emitted to the frontend
//! via Tauri's event system.

use serde::Serialize;

/// Transcript event payload
#[derive(Clone, Serialize)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub struct DictationTranscript {
    pub text: String,
    pub is_final: bool,
}

/// Audio level event payload (for waveform visualization)
#[derive(Clone, Serialize)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub struct DictationAudioLevel {
    pub level: f32,
}

/// Error event payload
#[derive(Clone, Serialize)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub struct DictationError {
    pub message: String,
}

/// Permission status returned to frontend
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DictationPermissionStatus {
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    Granted,
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    Denied,
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    Restricted,
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    NotDetermined,
    Unavailable,
}

// ============================================================================
// macOS implementation
// ============================================================================

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject, Bool};
    use objc2::{class, msg_send};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use tauri::{AppHandle, Emitter};

    /// Holds the active dictation session state.
    /// ObjC objects stored as raw retained pointers for cross-thread usage.
    struct ActiveDictation {
        audio_engine: Retained<AnyObject>,
        recognition_request: Retained<AnyObject>,
        recognition_task: Retained<AnyObject>,
        /// Shared flag set to `true` when stop is initiated. The audio tap block
        /// checks this before dereferencing the recognition request pointer,
        /// preventing use-after-free when the session is torn down.
        stopped: Arc<AtomicBool>,
    }

    // SAFETY: These ObjC objects are accessed exclusively through the ACTIVE_DICTATION Mutex.
    // The only cross-thread access pattern is:
    // - `start()` creates objects on the calling thread and stores them under the Mutex.
    // - `stop_internal()` takes ownership from the Mutex and calls teardown methods.
    //
    // Per-type threading safety:
    // - AVAudioEngine: `stop()` and `removeTapOnBus:` are thread-safe per Apple docs.
    // - SFSpeechRecognitionTask: `cancel` is documented as callable from any thread.
    // - SFSpeechAudioBufferRecognitionRequest: `endAudio` signals completion; we call it
    //   only after the audio tap is removed and the engine is stopped, so no concurrent
    //   `appendAudioPCMBuffer:` calls can race with it.
    unsafe impl Send for ActiveDictation {}

    static ACTIVE_DICTATION: Mutex<Option<ActiveDictation>> = Mutex::new(None);

    /// Allocate and init an Objective-C object. Returns a retained pointer.
    /// Equivalent to `[[cls alloc] init]`.
    unsafe fn objc_new(cls: &AnyClass) -> Retained<AnyObject> {
        let alloc: *mut AnyObject = msg_send![cls, alloc];
        Retained::retain(msg_send![alloc, init]).expect("Failed to allocate ObjC object")
    }

    /// Get a retained ObjC object from a message send.
    /// Retains the returned pointer (for non-owning getters).
    unsafe fn objc_retain(ptr: *mut AnyObject) -> Option<Retained<AnyObject>> {
        if ptr.is_null() {
            None
        } else {
            Retained::retain(ptr)
        }
    }

    /// Check if SFSpeechRecognizer is available on this system.
    pub fn check_available() -> bool {
        unsafe {
            let cls = class!(SFSpeechRecognizer);
            let recognizer = objc_new(cls);
            let available: Bool = msg_send![&recognizer, isAvailable];
            available.as_bool()
        }
    }

    /// Check current permission status for speech recognition.
    pub fn check_permissions() -> DictationPermissionStatus {
        if !check_available() {
            return DictationPermissionStatus::Unavailable;
        }

        unsafe {
            let cls = class!(SFSpeechRecognizer);
            // SFSpeechRecognizerAuthorizationStatus: 0=notDetermined, 1=denied, 2=restricted, 3=authorized
            let status: isize = msg_send![cls, authorizationStatus];
            match status {
                0 => DictationPermissionStatus::NotDetermined,
                1 => DictationPermissionStatus::Denied,
                2 => DictationPermissionStatus::Restricted,
                3 => DictationPermissionStatus::Granted,
                _ => DictationPermissionStatus::Unavailable,
            }
        }
    }

    /// Request speech recognition permissions.
    /// The authorization callback may be dispatched on the main thread, so we
    /// must not block the main thread while waiting. We spawn a helper thread
    /// to issue the request and wait for the result via mpsc channel.
    fn request_permissions() -> DictationPermissionStatus {
        let (tx, rx) = std::sync::mpsc::channel();

        // Spawn a thread to issue the request so we don't block the current
        // (potentially main) thread while the system permission dialog is shown.
        std::thread::spawn(move || unsafe {
            let block = block2::RcBlock::new(move |status: isize| {
                let _ = tx.send(status);
            });

            let cls = class!(SFSpeechRecognizer);
            let _: () = msg_send![cls, requestAuthorization: &*block];
        });

        // Wait for the callback (with timeout to avoid indefinite blocking)
        match rx.recv_timeout(std::time::Duration::from_secs(30)) {
            Ok(status) => match status {
                0 => DictationPermissionStatus::NotDetermined,
                1 => DictationPermissionStatus::Denied,
                2 => DictationPermissionStatus::Restricted,
                3 => DictationPermissionStatus::Granted,
                _ => DictationPermissionStatus::Unavailable,
            },
            Err(_) => DictationPermissionStatus::Unavailable,
        }
    }

    /// Start a dictation session. Sets up AVAudioEngine + SFSpeechRecognizer
    /// and begins emitting events to the frontend.
    pub fn start(app: &AppHandle) -> Result<(), String> {
        // Ensure no active session
        {
            let guard = ACTIVE_DICTATION.lock().map_err(|e| e.to_string())?;
            if guard.is_some() {
                return Err("Dictation is already active".to_string());
            }
        }

        // Check permissions first
        match check_permissions() {
            DictationPermissionStatus::Granted => {}
            DictationPermissionStatus::NotDetermined => {
                let status = request_permissions();
                if !matches!(status, DictationPermissionStatus::Granted) {
                    return Err("Speech recognition permission not granted".to_string());
                }
            }
            _ => return Err("Speech recognition permission not granted".to_string()),
        }

        unsafe {
            // Create SFSpeechRecognizer
            let recognizer = objc_new(class!(SFSpeechRecognizer));
            let available: Bool = msg_send![&recognizer, isAvailable];
            if !available.as_bool() {
                return Err("Speech recognizer is not available".to_string());
            }

            // Create SFSpeechAudioBufferRecognitionRequest
            let request = objc_new(class!(SFSpeechAudioBufferRecognitionRequest));
            let _: () = msg_send![&request, setShouldReportPartialResults: Bool::YES];
            // Enable on-device recognition (macOS 13+, ignored on older)
            let _: () = msg_send![&request, setRequiresOnDeviceRecognition: Bool::YES];

            // Create AVAudioEngine
            let engine = objc_new(class!(AVAudioEngine));

            // Get input node and its output format
            let input_node: *mut AnyObject = msg_send![&engine, inputNode];
            if input_node.is_null() {
                return Err("No audio input node available (no microphone?)".to_string());
            }
            let format = objc_retain(msg_send![input_node, outputFormatForBus: 0u64])
                .ok_or("Failed to get audio format")?;

            // Clone handles for callbacks
            let app_for_transcript = app.clone();
            let app_for_level = app.clone();

            // Shared stopped flag — the tap block checks this before dereferencing
            // the recognition request pointer, preventing use-after-free on teardown.
            let stopped = Arc::new(AtomicBool::new(false));
            let stopped_for_tap = Arc::clone(&stopped);
            let stopped_for_result = Arc::clone(&stopped);

            // Store request ptr as usize for the tap callback (avoids Send issues)
            let request_ptr = Retained::as_ptr(&request) as usize;

            // Install tap on input node for audio capture
            let tap_block =
                block2::RcBlock::new(move |buffer: *mut AnyObject, _when: *mut AnyObject| {
                    if buffer.is_null() || stopped_for_tap.load(Ordering::Acquire) {
                        return;
                    }

                    // Append audio buffer to recognition request
                    let req = request_ptr as *mut AnyObject;
                    let _: () = msg_send![req, appendAudioPCMBuffer: buffer];

                    // Compute and emit audio level
                    let level = compute_audio_level(buffer);
                    let _ =
                        app_for_level.emit("dictation-audio-level", DictationAudioLevel { level });
                });

            let buffer_size: u32 = 1024;
            let _: () = msg_send![
                input_node,
                installTapOnBus: 0u64,
                bufferSize: buffer_size,
                format: &*format,
                block: &*tap_block
            ];

            // Create recognition task with result handler
            let result_block =
                block2::RcBlock::new(move |result: *mut AnyObject, error: *mut AnyObject| {
                    if !result.is_null() {
                        let transcription: *mut AnyObject = msg_send![result, bestTranscription];
                        if !transcription.is_null() {
                            let ns_text: *mut AnyObject = msg_send![transcription, formattedString];
                            if !ns_text.is_null() {
                                let text = nsstring_to_string(ns_text);
                                let is_final: Bool = msg_send![result, isFinal];

                                let _ = app_for_transcript.emit(
                                    "dictation-transcript",
                                    DictationTranscript {
                                        text,
                                        is_final: is_final.as_bool(),
                                    },
                                );
                            }
                        }
                    }

                    if !error.is_null() {
                        // Suppress errors triggered by intentional stop — cancelling
                        // the recognition task causes Apple's API to fire an error callback.
                        if stopped_for_result.load(Ordering::Acquire) {
                            return;
                        }

                        let desc: *mut AnyObject = msg_send![error, localizedDescription];
                        let msg = if !desc.is_null() {
                            nsstring_to_string(desc)
                        } else {
                            "Unknown dictation error".to_string()
                        };
                        log::warn!("Dictation error: {}", msg);

                        let _ = app_for_transcript
                            .emit("dictation-error", DictationError { message: msg });

                        // Auto-stop on error — use non-blocking variant to avoid
                        // deadlock if this callback fires while start() holds the Mutex.
                        stop_internal_nonblocking();
                    }
                });

            let task_ptr: *mut AnyObject = msg_send![
                &recognizer,
                recognitionTaskWithRequest: &*request,
                resultHandler: &*result_block
            ];
            let task = objc_retain(task_ptr).ok_or("Failed to create recognition task")?;

            // Prepare and start the audio engine
            let _: () = msg_send![&engine, prepare];

            // AVAudioEngine.start() throws — use startAndReturnError:
            let mut error_ptr: *mut AnyObject = std::ptr::null_mut();
            let started: Bool = msg_send![&engine, startAndReturnError: &mut error_ptr];
            if !started.as_bool() {
                let _: () = msg_send![input_node, removeTapOnBus: 0u64];
                let _: () = msg_send![&task, cancel];

                let error_msg = if !error_ptr.is_null() {
                    let desc: *mut AnyObject = msg_send![error_ptr, localizedDescription];
                    if !desc.is_null() {
                        nsstring_to_string(desc)
                    } else {
                        "Failed to start audio engine".to_string()
                    }
                } else {
                    "Failed to start audio engine".to_string()
                };
                return Err(error_msg);
            }

            log::info!("Dictation started");

            // Store active state
            let mut guard = ACTIVE_DICTATION.lock().map_err(|e| e.to_string())?;
            *guard = Some(ActiveDictation {
                audio_engine: engine,
                recognition_request: request,
                recognition_task: task,
                stopped,
            });
        }

        Ok(())
    }

    /// Stop the active dictation session.
    pub fn stop(app: &AppHandle) -> Result<(), String> {
        stop_internal()?;
        let _ = app.emit("dictation-ended", ());
        log::info!("Dictation stopped");
        Ok(())
    }

    /// Internal stop without emitting event (used by error handler too).
    fn stop_internal() -> Result<(), String> {
        let mut guard = ACTIVE_DICTATION.lock().map_err(|e| e.to_string())?;
        teardown_dictation(guard.take());
        Ok(())
    }

    /// Non-blocking variant of stop for use from ObjC callbacks where the
    /// Mutex may already be held by `start()` on the same thread (e.g. if
    /// the recognition result handler fires synchronously during task creation).
    fn stop_internal_nonblocking() {
        match ACTIVE_DICTATION.try_lock() {
            Ok(mut guard) => {
                teardown_dictation(guard.take());
            }
            Err(_) => {
                // Mutex is held (likely by start()) — spawn teardown on another thread
                // so we don't deadlock.
                std::thread::spawn(|| {
                    if let Ok(mut guard) = ACTIVE_DICTATION.lock() {
                        teardown_dictation(guard.take());
                    }
                });
            }
        }
    }

    /// Perform the actual teardown of a dictation session.
    fn teardown_dictation(state: Option<ActiveDictation>) {
        if let Some(state) = state {
            // Signal the tap block to stop using the recognition request pointer
            // BEFORE we remove the tap or drop the objects.
            state.stopped.store(true, Ordering::Release);

            unsafe {
                // Stop audio engine first
                let _: () = msg_send![&state.audio_engine, stop];

                // Remove tap from input node — must happen before endAudio
                // to ensure no concurrent appendAudioPCMBuffer calls race
                // with the recognition request teardown.
                let input_node: *mut AnyObject = msg_send![&state.audio_engine, inputNode];
                if !input_node.is_null() {
                    let _: () = msg_send![input_node, removeTapOnBus: 0u64];
                }

                // Signal end of audio to the recognition pipeline
                let _: () = msg_send![&state.recognition_request, endAudio];

                // Cancel recognition task
                let _: () = msg_send![&state.recognition_task, cancel];
            }
        }
    }

    /// Convert an NSString pointer to a Rust String.
    unsafe fn nsstring_to_string(ns: *mut AnyObject) -> String {
        let utf8: *const u8 = msg_send![ns, UTF8String];
        if utf8.is_null() {
            return String::new();
        }
        let cstr = std::ffi::CStr::from_ptr(utf8 as *const std::ffi::c_char);
        cstr.to_string_lossy().into_owned()
    }

    /// Compute RMS audio level from an AVAudioPCMBuffer (0.0 to 1.0).
    unsafe fn compute_audio_level(buffer: *mut AnyObject) -> f32 {
        let float_data: *const *const f32 = msg_send![buffer, floatChannelData];
        if float_data.is_null() {
            return 0.0;
        }

        let frame_length: u32 = msg_send![buffer, frameLength];
        if frame_length == 0 {
            return 0.0;
        }

        let channel_data = *float_data;
        if channel_data.is_null() {
            return 0.0;
        }

        let mut sum_squares: f32 = 0.0;
        let len = frame_length as usize;
        for i in 0..len {
            let sample = *channel_data.add(i);
            sum_squares += sample * sample;
        }

        let rms = (sum_squares / len as f32).sqrt();
        // Scale up for responsive visualization (typical voice RMS is 0.01–0.3)
        (rms * 5.0).min(1.0)
    }
}

// ============================================================================
// Non-macOS stubs
// ============================================================================

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::*;

    pub fn check_available() -> bool {
        false
    }

    pub fn check_permissions() -> DictationPermissionStatus {
        DictationPermissionStatus::Unavailable
    }

    pub fn start(_app: &tauri::AppHandle) -> Result<(), String> {
        Err("Dictation is only available on macOS".to_string())
    }

    pub fn stop(_app: &tauri::AppHandle) -> Result<(), String> {
        Err("Dictation is only available on macOS".to_string())
    }
}

// ============================================================================
// Public API (platform-agnostic)
// ============================================================================

pub fn check_available() -> bool {
    platform::check_available()
}

pub fn check_permissions() -> DictationPermissionStatus {
    platform::check_permissions()
}

pub fn start_dictation(app: &tauri::AppHandle) -> Result<(), String> {
    platform::start(app)
}

pub fn stop_dictation(app: &tauri::AppHandle) -> Result<(), String> {
    platform::stop(app)
}
