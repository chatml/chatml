use std::sync::Arc;
use tauri::{Emitter, Manager};
use tauri_plugin_shell::ShellExt;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Maximum allowed JSON payload size (1MB)
const MAX_JSON_SIZE: usize = 1024 * 1024;

/// Validate and parse a JSON string from sidecar output
fn validate_speech_json(json_str: &str) -> Option<String> {
    // Size limit check
    if json_str.len() > MAX_JSON_SIZE {
        log::warn!(
            "Speech JSON payload too large: {} bytes (max: {})",
            json_str.len(),
            MAX_JSON_SIZE
        );
        return None;
    }

    // Parse and validate JSON structure
    match serde_json::from_str::<serde_json::Value>(json_str) {
        Ok(value) => {
            // Validate it has the expected "type" field
            if value.get("type").is_some() {
                Some(json_str.to_string())
            } else {
                log::warn!("Speech JSON missing 'type' field: {}", json_str);
                None
            }
        }
        Err(e) => {
            log::warn!("Invalid speech JSON: {} - {}", e, json_str);
            None
        }
    }
}

/// Check if speech recognition is available on this platform
pub fn check_availability() -> bool {
    #[cfg(target_os = "macos")]
    {
        true
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

/// Start the speech recognition sidecar
pub fn start_speech_recognition(app: &tauri::AppHandle, state: &Arc<AppState>) -> AppResult<()> {
    // Check if already running
    if state.is_speech_running() {
        return Err(AppError::Speech("Speech recognition already running".to_string()));
    }

    let sidecar_command = app
        .shell()
        .sidecar("chatml-speech")
        .map_err(|e| AppError::Speech(format!("Failed to create speech sidecar command: {}", e)))?;

    let (mut rx, child) = sidecar_command
        .spawn()
        .map_err(|e| AppError::Speech(format!("Failed to spawn speech sidecar: {}", e)))?;

    // Store the child process
    state.set_speech_sidecar(Some(child));

    // Clone app handle for the monitoring task
    let app_handle = app.clone();
    let state_clone = Arc::clone(state);

    // Spawn a task to monitor speech sidecar output and forward to frontend
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let line_str = String::from_utf8_lossy(&line).trim().to_string();
                    if !line_str.is_empty() {
                        log::info!("[speech stdout] {}", line_str);
                        // Forward to frontend as speech event
                        if let Some(window) = app_handle.get_webview_window("main") {
                            match window.emit("speech-event", line_str.clone()) {
                                Ok(_) => log::debug!("[speech] Emitted event successfully"),
                                Err(e) => log::error!("[speech] Failed to emit event: {}", e),
                            }
                        } else {
                            log::error!("[speech] Window not found!");
                        }
                    }
                }
                CommandEvent::Stderr(chunk) => {
                    let raw = String::from_utf8_lossy(&chunk);

                    // Split chunk into lines and process each
                    for line in raw.lines() {
                        let line_str = line.trim();
                        if line_str.is_empty() {
                            continue;
                        }

                        // Try to extract JSON from the line
                        let json_to_emit: Option<String> =
                            if let Some(stripped) = line_str.strip_prefix("DATA:") {
                                // DATA: prefixed JSON line - validate it
                                validate_speech_json(stripped.trim())
                            } else if line_str.starts_with("{")
                                && line_str.ends_with("}")
                                && line_str.contains("\"type\":")
                            {
                                // Raw JSON without prefix - validate it
                                validate_speech_json(line_str)
                            } else if let Some(idx) = line_str.find("{\"type\":") {
                                // JSON embedded in a log line - extract from the start marker to end of line.
                                // This extraction is intentionally simple: it assumes JSON ends at line end.
                                // If the extraction is incorrect (truncated or malformed), validate_speech_json
                                // will catch it via proper JSON parsing and reject invalid payloads.
                                let json_part = &line_str[idx..];
                                if json_part.ends_with("}") {
                                    validate_speech_json(json_part)
                                } else {
                                    None
                                }
                            } else {
                                None
                            };

                        if let Some(json) = json_to_emit {
                            if let Some(window) = app_handle.get_webview_window("main") {
                                if let Err(e) = window.emit("speech-event", json) {
                                    log::error!("[speech] Failed to emit event: {}", e);
                                }
                            }
                        }
                    }
                }
                CommandEvent::Error(err) => {
                    log::error!("[speech error] {}", err);
                    if let Some(window) = app_handle.get_webview_window("main") {
                        if let Err(e) = window.emit("speech-error", err.clone()) {
                            log::warn!("Failed to emit speech-error event: {}", e);
                        }
                    }
                }
                CommandEvent::Terminated(payload) => {
                    log::info!(
                        "[speech terminated] code: {:?}, signal: {:?}",
                        payload.code,
                        payload.signal
                    );
                    // Clear the stored sidecar
                    state_clone.set_speech_sidecar(None);
                    // Notify frontend
                    if let Some(window) = app_handle.get_webview_window("main") {
                        if let Err(e) = window.emit("speech-terminated", payload.code) {
                            log::warn!("Failed to emit speech-terminated event: {}", e);
                        }
                    }
                }
                _ => {}
            }
        }
    });

    log::info!("Speech recognition sidecar started");
    Ok(())
}

/// Stop the speech recognition sidecar
pub fn stop_speech_recognition(state: &AppState) -> AppResult<()> {
    if let Some(mut child) = state.take_speech_sidecar() {
        // Write "stop" to stdin to gracefully stop
        if let Err(e) = child.write(b"stop\n") {
            log::warn!("Failed to send stop command: {}", e);
        }
        // Kill the process
        if let Err(e) = child.kill() {
            log::warn!("Failed to kill speech sidecar: {}", e);
        }
        log::info!("Speech recognition stopped");
    }
    Ok(())
}
