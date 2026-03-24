//! macOS Speech-to-Text dictation via Apple's SFSpeechRecognizer.
//!
//! Uses AVAudioEngine to capture microphone input and SFSpeechRecognizer
//! for real-time on-device transcription. Events are emitted to the frontend
//! via Tauri's event system.
//!
//! When the recognition task completes a segment (isFinal=true — e.g. after a
//! pause or the ~60s Apple timeout), the backend automatically restarts the
//! recognition task while keeping the audio engine running. Confirmed text from
//! completed tasks is accumulated and prepended to the current task's partial
//! results, so the frontend always receives the full accumulated transcript.

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
    use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
    use std::sync::{mpsc, Arc, Mutex};
    use tauri::{AppHandle, Emitter};

    /// Holds the active dictation session state.
    ///
    /// Long-lived objects (audio_engine, recognizer) persist across task restarts.
    /// Short-lived objects (recognition_request, recognition_task) are swapped on
    /// each restart. The `current_request_ptr` is read atomically by the audio tap
    /// so it always appends buffers to the current request.
    struct ActiveDictation {
        audio_engine: Retained<AnyObject>,
        recognizer: Retained<AnyObject>,
        recognition_request: Retained<AnyObject>,
        recognition_task: Retained<AnyObject>,
        /// Atomic pointer to the current SFSpeechAudioBufferRecognitionRequest.
        /// The audio tap block reads this to know where to send buffers.
        current_request_ptr: Arc<AtomicUsize>,
        /// Shared flag set to `true` when stop is initiated. The audio tap block
        /// and restart thread check this before proceeding.
        stopped: Arc<AtomicBool>,
        /// Monotonically increasing generation counter. Incremented on each task
        /// restart. Each task closure captures its generation at creation time and
        /// compares against the current value — stale callbacks from cancelled
        /// old tasks are permanently suppressed with no timing window.
        task_generation: Arc<AtomicU64>,
        /// Confirmed text accumulated from completed recognition tasks.
        accumulated_text: Arc<Mutex<String>>,
        /// Channel sender to signal the restart thread.
        /// Dropped during teardown to terminate the restart thread.
        restart_tx: Option<mpsc::Sender<()>>,
        /// Old request/task objects kept alive until teardown to prevent
        /// use-after-free from in-flight audio tap calls.
        _old_objects: Vec<Retained<AnyObject>>,
    }

    // SAFETY: These ObjC objects are accessed exclusively through the ACTIVE_DICTATION Mutex.
    // The only cross-thread access pattern is:
    // - `start()` creates objects on the calling thread and stores them under the Mutex.
    // - `stop_internal()` takes ownership from the Mutex and calls teardown methods.
    // - The restart thread locks the Mutex to swap request/task objects.
    //
    // Per-type threading safety:
    // - AVAudioEngine: `stop()` and `removeTapOnBus:` are thread-safe per Apple docs.
    // - SFSpeechRecognitionTask: `cancel` is documented as callable from any thread.
    // - SFSpeechAudioBufferRecognitionRequest: `endAudio` signals completion; we call it
    //   only after the audio tap is removed and the engine is stopped, so no concurrent
    //   `appendAudioPCMBuffer:` calls can race with it.
    //
    // Mid-session restart safety:
    // - During a restart, the audio tap reads the atomic `current_request_ptr` without the
    //   Mutex. Between `endAudio`/`cancel` on the old request and the atomic store of the
    //   new pointer, the tap may still append buffers to the old (cancelled) request.
    //   Apple's `appendAudioPCMBuffer:` silently ignores calls after `endAudio`, so this
    //   is safe. The `_old_objects` vec keeps old requests alive to prevent use-after-free
    //   from any in-flight tap calls during this window.
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
        let (tx, rx) = mpsc::channel();

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

    /// Create a new SFSpeechAudioBufferRecognitionRequest + recognition task.
    ///
    /// The result handler emits accumulated transcript events (prefix from
    /// previous tasks + current task text) and signals the restart thread
    /// when `isFinal=true`.
    unsafe fn create_recognition_task(
        recognizer: &Retained<AnyObject>,
        app: &AppHandle,
        accumulated_text: Arc<Mutex<String>>,
        stopped: Arc<AtomicBool>,
        task_generation: Arc<AtomicU64>,
        my_generation: u64,
        restart_tx: mpsc::Sender<()>,
    ) -> Result<(Retained<AnyObject>, Retained<AnyObject>), String> {
        let request = objc_new(class!(SFSpeechAudioBufferRecognitionRequest));
        let _: () = msg_send![&request, setShouldReportPartialResults: Bool::YES];
        let _: () = msg_send![&request, setRequiresOnDeviceRecognition: Bool::YES];

        let app_for_transcript = app.clone();
        let accumulated_for_result = Arc::clone(&accumulated_text);
        let stopped_for_result = Arc::clone(&stopped);
        let generation_for_result = Arc::clone(&task_generation);

        let result_block = block2::RcBlock::new(
            move |result: *mut AnyObject, error: *mut AnyObject| {
                if stopped_for_result.load(Ordering::Acquire) {
                    return;
                }

                // Ignore stale callbacks from old task generations. The generation
                // counter is incremented atomically before a new task is created,
                // so any callback from a previous generation is permanently invalid
                // — unlike the old boolean restarting flag, which had a timing
                // window between clearing and re-setting. Note: the `stopped`
                // check above still has a narrow benign race with teardown.
                if generation_for_result.load(Ordering::Acquire) != my_generation {
                    return;
                }

                if !result.is_null() {
                    let transcription: *mut AnyObject = msg_send![result, bestTranscription];
                    if !transcription.is_null() {
                        let ns_text: *mut AnyObject = msg_send![transcription, formattedString];
                        if !ns_text.is_null() {
                            let current_text = nsstring_to_string(ns_text);
                            if current_text.is_empty() {
                                return;
                            }

                            let is_final: Bool = msg_send![result, isFinal];
                            let is_final = is_final.as_bool();

                            // Build full text: accumulated prefix + current task text.
                            // Hold the lock for the entire read-modify-write to avoid
                            // a stale prefix if another code path ever writes between
                            // the read and write.
                            let mut acc_guard = accumulated_for_result
                                .lock()
                                .unwrap_or_else(|e| e.into_inner());
                            let full_text = if acc_guard.is_empty() {
                                current_text.clone()
                            } else {
                                format!("{} {}", *acc_guard, current_text)
                            };

                            let _ = app_for_transcript.emit(
                                "dictation-transcript",
                                DictationTranscript {
                                    text: full_text.clone(),
                                    is_final,
                                },
                            );

                            let acc_len = acc_guard.len();
                            let full_len = full_text.len();

                            // When this task's segment is finalized (pause or timeout),
                            // save the full accumulated text and signal a task restart.
                            if is_final {
                                *acc_guard = full_text; // move, no clone needed
                                drop(acc_guard);
                                log::info!(
                                    "Dictation segment finalized (gen={}), accumulated {} chars, requesting restart",
                                    my_generation, full_len
                                );
                                let _ = restart_tx.send(());
                            } else {
                                drop(acc_guard);
                            }

                            log::debug!(
                                "Dictation gen={} is_final={} current_len={} acc_len={} full_len={}",
                                my_generation, is_final, current_text.len(), acc_len, full_len
                            );
                        }
                    }
                }

                if !error.is_null() {
                    let desc: *mut AnyObject = msg_send![error, localizedDescription];
                    let msg = if !desc.is_null() {
                        nsstring_to_string(desc)
                    } else {
                        "Unknown dictation error".to_string()
                    };

                    // Suppress "No speech detected" during automatic task restarts —
                    // Apple fires this when the task completes without recent speech,
                    // which is expected during the brief restart window.
                    // Use the NSError code (locale-stable) instead of localizedDescription
                    // to work correctly on non-English macOS installations.
                    // kAFAssistantErrorDomain code 209 = "no speech detected" (SFSpeechRecognizer).
                    let error_code: isize = msg_send![error, code];
                    if error_code == 209 || error_code == 203 || error_code == 201 {
                        log::debug!(
                            "Suppressing speech error code {} during task lifecycle",
                            error_code
                        );
                        return;
                    }

                    log::warn!("Dictation error: {}", msg);

                    let _ =
                        app_for_transcript.emit("dictation-error", DictationError { message: msg });

                    stop_internal_nonblocking();
                }
            },
        );

        let task_ptr: *mut AnyObject = msg_send![
            recognizer,
            recognitionTaskWithRequest: &*request,
            resultHandler: &*result_block
        ];
        let task = objc_retain(task_ptr).ok_or("Failed to create recognition task")?;

        Ok((request, task))
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

            // Create AVAudioEngine
            let engine = objc_new(class!(AVAudioEngine));

            // Get input node and its output format
            let input_node: *mut AnyObject = msg_send![&engine, inputNode];
            if input_node.is_null() {
                return Err("No audio input node available (no microphone?)".to_string());
            }
            let format = objc_retain(msg_send![input_node, outputFormatForBus: 0u64])
                .ok_or("Failed to get audio format")?;

            // Shared state
            let stopped = Arc::new(AtomicBool::new(false));
            let task_generation = Arc::new(AtomicU64::new(0));
            let accumulated_text = Arc::new(Mutex::new(String::new()));
            let (restart_tx, restart_rx) = mpsc::channel::<()>();

            // Create the initial recognition task
            let (request, task) = create_recognition_task(
                &recognizer,
                app,
                Arc::clone(&accumulated_text),
                Arc::clone(&stopped),
                Arc::clone(&task_generation),
                0, // initial generation
                restart_tx.clone(),
            )?;

            // Atomic pointer to the current request — read by the audio tap
            let current_request_ptr =
                Arc::new(AtomicUsize::new(Retained::as_ptr(&request) as usize));
            let request_ptr_for_tap = Arc::clone(&current_request_ptr);
            let stopped_for_tap = Arc::clone(&stopped);
            let app_for_level = app.clone();

            // Install tap on input node for audio capture
            let tap_block =
                block2::RcBlock::new(move |buffer: *mut AnyObject, _when: *mut AnyObject| {
                    if buffer.is_null() || stopped_for_tap.load(Ordering::Acquire) {
                        return;
                    }

                    // Append audio buffer to the current recognition request
                    let req = request_ptr_for_tap.load(Ordering::Acquire) as *mut AnyObject;
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

            // Prepare and start the audio engine
            let _: () = msg_send![&engine, prepare];

            let mut error_ptr: *mut AnyObject = std::ptr::null_mut();
            let started: Bool = msg_send![&engine, startAndReturnError: &mut error_ptr];
            if !started.as_bool() {
                let _: () = msg_send![input_node, removeTapOnBus: 0u64];
                let _: () = msg_send![&request, endAudio];
                let _: () = msg_send![&task, cancel];
                // Note: restart_rx is dropped here; the restart_tx clone inside the
                // result handler closure will get SendError on send, which is ignored.

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
                recognizer,
                recognition_request: request,
                recognition_task: task,
                current_request_ptr: Arc::clone(&current_request_ptr),
                stopped: Arc::clone(&stopped),
                task_generation: Arc::clone(&task_generation),
                accumulated_text: Arc::clone(&accumulated_text),
                restart_tx: Some(restart_tx),
                _old_objects: Vec::new(),
            });
            drop(guard);

            // Spawn the restart thread — listens for isFinal signals and swaps
            // the recognition task while keeping the audio engine running.
            let stopped_for_restart = Arc::clone(&stopped);
            let app_for_restart = app.clone();
            std::thread::spawn(move || {
                while restart_rx.recv().is_ok() {
                    if stopped_for_restart.load(Ordering::Acquire) {
                        break;
                    }

                    let mut guard = match ACTIVE_DICTATION.lock() {
                        Ok(g) => g,
                        Err(_) => break,
                    };

                    let state = match guard.as_mut() {
                        Some(s) => s,
                        None => break,
                    };

                    if state.stopped.load(Ordering::Acquire) {
                        break;
                    }

                    // Increment generation to permanently invalidate old task callbacks.
                    // Unlike a boolean flag, this has no timing window — old closures
                    // captured the previous generation and will never match again.
                    let new_gen = state.task_generation.fetch_add(1, Ordering::AcqRel) + 1;
                    log::info!("Dictation task restart, advancing to gen={}", new_gen);

                    // End the old task gracefully
                    let _: () = msg_send![&state.recognition_request, endAudio];
                    let _: () = msg_send![&state.recognition_task, cancel];

                    // Keep old objects alive to prevent use-after-free from in-flight tap calls.
                    // Clear previous generations first — by the time we restart again, all
                    // in-flight appendAudioPCMBuffer calls to the n-2 request have completed
                    // (Apple dispatches audio tap callbacks synchronously per buffer).
                    // We only need to retain the immediately preceding request/task pair.
                    state._old_objects.clear();
                    // Temporarily replace with NSObject placeholders while we hold the Mutex.
                    // teardown_dictation cannot see these placeholders because it also
                    // requires the Mutex, which the restart thread holds throughout.
                    let old_request = std::mem::replace(
                        &mut state.recognition_request,
                        objc_new(class!(NSObject)),
                    );
                    let old_task =
                        std::mem::replace(&mut state.recognition_task, objc_new(class!(NSObject)));
                    state._old_objects.push(old_request);
                    state._old_objects.push(old_task);

                    // Create a fresh recognition task
                    let restart_tx = match &state.restart_tx {
                        Some(tx) => tx.clone(),
                        None => break,
                    };

                    match create_recognition_task(
                        &state.recognizer,
                        &app_for_restart,
                        Arc::clone(&state.accumulated_text),
                        Arc::clone(&state.stopped),
                        Arc::clone(&state.task_generation),
                        new_gen,
                        restart_tx,
                    ) {
                        Ok((new_request, new_task)) => {
                            // Re-check stopped flag — teardown may have raced us while
                            // we held the lock during create_recognition_task.
                            if state.stopped.load(Ordering::Acquire) {
                                let _: () = msg_send![&new_request, endAudio];
                                let _: () = msg_send![&new_task, cancel];
                                break;
                            }
                            // Swap the request pointer atomically so the tap sends
                            // buffers to the new request
                            state
                                .current_request_ptr
                                .store(Retained::as_ptr(&new_request) as usize, Ordering::Release);
                            state.recognition_request = new_request;
                            state.recognition_task = new_task;

                            log::info!("Dictation task restarted successfully (gen={})", new_gen);
                        }
                        Err(e) => {
                            // Restore the real old objects so teardown_dictation
                            // can call endAudio/cancel on them instead of on the
                            // NSObject placeholders (which would raise an ObjC
                            // unrecognized-selector exception and crash).
                            // _old_objects is always [old_request, old_task] at this point
                            if state._old_objects.len() == 2 {
                                state.recognition_task = state._old_objects.pop().unwrap();
                                state.recognition_request = state._old_objects.pop().unwrap();
                            }
                            log::error!("Failed to restart dictation task: {}", e);
                            let _ = app_for_restart.emit(
                                "dictation-error",
                                DictationError {
                                    message: format!("Failed to restart recognition: {}", e),
                                },
                            );
                            // Release the lock before stopping so stop_internal can acquire it.
                            // Old task callbacks are already invalidated by the generation
                            // increment above — no need for a separate flag.
                            drop(guard);
                            stop_internal_nonblocking();
                            break;
                        }
                    }
                }
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
        if let Some(mut state) = state {
            // Signal the tap block and restart thread to stop.
            state.stopped.store(true, Ordering::Release);

            // Drop the restart channel sender so the restart thread exits its loop.
            state.restart_tx.take();

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

            // Old objects are dropped here when `state` goes out of scope.
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
