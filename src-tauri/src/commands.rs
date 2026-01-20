use std::sync::Arc;
use tauri::{Manager, State};

use crate::error::AppResult;
use crate::sidecar;
use crate::speech;
use crate::state::AppState;

/// Mark the app as ready (called from frontend when connected)
#[tauri::command]
pub fn mark_app_ready(state: State<'_, Arc<AppState>>) {
    state.mark_ready();
}

/// Restart the sidecar process (async to avoid blocking)
#[tauri::command]
pub async fn restart_sidecar(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
) -> AppResult<()> {
    sidecar::restart_sidecar_async(app, Arc::clone(&state)).await
}

/// Set minimize-to-tray preference
#[tauri::command]
pub fn set_minimize_to_tray(enabled: bool, state: State<'_, Arc<AppState>>) {
    state.set_minimize_to_tray(enabled);
}

/// Check if window is visible
#[tauri::command]
pub fn is_window_visible(app: tauri::AppHandle) -> bool {
    if let Some(window) = app.get_webview_window("main") {
        window.is_visible().unwrap_or(false)
    } else {
        false
    }
}

/// Check if speech recognition is available
#[tauri::command]
pub fn check_speech_availability() -> AppResult<bool> {
    Ok(speech::check_availability())
}

/// Start speech recognition
#[tauri::command]
pub fn start_speech_recognition(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
) -> AppResult<()> {
    speech::start_speech_recognition(&app, &state)
}

/// Stop speech recognition
#[tauri::command]
pub fn stop_speech_recognition(state: State<'_, Arc<AppState>>) -> AppResult<()> {
    speech::stop_speech_recognition(&state)
}
