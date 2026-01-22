use std::sync::Arc;
use tauri::{Manager, State};

use crate::error::AppResult;
use crate::sidecar;
use crate::state::AppState;
use crate::watcher;

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

/// Start watching a workspace directory for file changes
#[tauri::command]
pub fn watch_workspace(
    app: tauri::AppHandle,
    workspace_id: String,
    workspace_path: String,
) -> AppResult<()> {
    watcher::watch_workspace(&app, workspace_id, workspace_path)
}

/// Stop watching a workspace directory
#[tauri::command]
pub fn unwatch_workspace(workspace_id: String) -> AppResult<()> {
    watcher::unwatch_workspace(&workspace_id)
}
