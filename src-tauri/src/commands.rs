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

/// Get the authentication token for backend API calls
#[tauri::command]
pub fn get_auth_token(state: State<'_, Arc<AppState>>) -> Result<String, String> {
    state
        .get_auth_token()
        .ok_or_else(|| "Auth token not available".to_string())
}

/// Get the port the backend sidecar is running on
#[tauri::command]
pub fn get_backend_port(state: State<'_, Arc<AppState>>) -> Result<u16, String> {
    state
        .get_sidecar_port()
        .ok_or_else(|| "Backend port not available yet".to_string())
}

/// Get and consume any pending OAuth callback URL
#[tauri::command]
pub fn get_pending_oauth_callback(state: State<'_, Arc<AppState>>) -> Option<String> {
    state.take_pending_oauth_callback()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Note: Testing Tauri commands directly requires the Tauri State wrapper,
    // which is difficult to mock. Instead, we test the underlying AppState
    // operations that the commands delegate to.

    #[test]
    fn test_mark_app_ready_logic() {
        let state = Arc::new(AppState::new());
        assert!(!state.is_ready());
        state.mark_ready();
        assert!(state.is_ready());
    }

    #[test]
    fn test_set_minimize_to_tray_logic() {
        let state = Arc::new(AppState::new());
        assert!(!state.should_minimize_to_tray());
        state.set_minimize_to_tray(true);
        assert!(state.should_minimize_to_tray());
        state.set_minimize_to_tray(false);
        assert!(!state.should_minimize_to_tray());
    }

    #[test]
    fn test_get_auth_token_returns_none_when_not_set() {
        let state = Arc::new(AppState::new());
        assert!(state.get_auth_token().is_none());
    }

    #[test]
    fn test_get_auth_token_returns_value_when_set() {
        let state = Arc::new(AppState::new());
        state.set_auth_token("test-token-123".to_string());
        assert_eq!(state.get_auth_token(), Some("test-token-123".to_string()));
    }

    #[test]
    fn test_get_backend_port_returns_none_when_not_set() {
        let state = Arc::new(AppState::new());
        assert!(state.get_sidecar_port().is_none());
    }

    #[test]
    fn test_get_backend_port_returns_value_when_set() {
        let state = Arc::new(AppState::new());
        state.set_sidecar_port(9876);
        assert_eq!(state.get_sidecar_port(), Some(9876));
    }

    #[test]
    fn test_pending_oauth_callback_lifecycle() {
        let state = Arc::new(AppState::new());

        // Initially no callback
        assert!(state.take_pending_oauth_callback().is_none());

        // Set a callback
        state.set_pending_oauth_callback("chatml://oauth?code=abc".to_string());

        // Take consumes it
        let callback = state.take_pending_oauth_callback();
        assert_eq!(callback, Some("chatml://oauth?code=abc".to_string()));

        // Second take returns None (already consumed)
        assert!(state.take_pending_oauth_callback().is_none());
    }
}
