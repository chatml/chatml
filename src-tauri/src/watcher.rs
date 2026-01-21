use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, Manager};

use crate::error::{AppError, AppResult};

/// Type alias for file watcher handle
type FileWatcherHandle = notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>;

/// Global state for file watchers (keyed by workspace ID)
static FILE_WATCHERS: Mutex<Option<HashMap<String, FileWatcherHandle>>> = Mutex::new(None);

/// Directories to ignore when watching for file changes
const IGNORED_DIRECTORIES: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    ".next",
    "__pycache__",
    ".cache",
    "dist",
    "build",
    ".venv",
    "venv",
];

/// Start watching a workspace directory for file changes
pub fn watch_workspace(
    app: &tauri::AppHandle,
    workspace_id: String,
    workspace_path: String,
) -> AppResult<()> {
    use std::sync::mpsc::channel;

    // Initialize the watchers map if needed
    {
        let mut watchers = FILE_WATCHERS
            .lock()
            .map_err(|e| AppError::Watcher(format!("Lock error: {}", e)))?;
        if watchers.is_none() {
            *watchers = Some(HashMap::new());
        }
    }

    // Check if already watching this workspace
    {
        let watchers = FILE_WATCHERS
            .lock()
            .map_err(|e| AppError::Watcher(format!("Lock error: {}", e)))?;
        if let Some(map) = watchers.as_ref() {
            if map.contains_key(&workspace_id) {
                log::info!("Already watching workspace: {}", workspace_id);
                return Ok(());
            }
        }
    }

    let path = PathBuf::from(&workspace_path);
    if !path.exists() {
        return Err(AppError::Watcher(format!(
            "Workspace path does not exist: {}",
            workspace_path
        )));
    }

    let app_handle = app.clone();
    let ws_id = workspace_id.clone();
    let ws_path = workspace_path.clone();

    // Create a channel to receive file change events
    let (tx, rx) = channel();

    // Create a debounced watcher with 2 second delay
    let mut debouncer = new_debouncer(Duration::from_secs(2), tx)
        .map_err(|e| AppError::Watcher(format!("Failed to create file watcher: {}", e)))?;

    // Start watching the workspace directory
    debouncer
        .watcher()
        .watch(&path, RecursiveMode::Recursive)
        .map_err(|e| AppError::Watcher(format!("Failed to watch directory: {}", e)))?;

    // Spawn a thread to handle file change events.
    // Lifecycle: The thread runs until the channel closes. When unwatch_workspace() removes
    // the debouncer from FILE_WATCHERS, the debouncer is dropped, which closes the sender
    // channel, causing rx.recv() to return Err and the thread to exit gracefully.
    // Note: We don't track the JoinHandle because the channel-based shutdown is sufficient.
    std::thread::spawn(move || {
        log::info!(
            "File watcher started for workspace: {} at {}",
            ws_id,
            ws_path
        );

        loop {
            match rx.recv() {
                Ok(Ok(events)) => {
                    for event in events {
                        // Only emit for write events
                        if event.kind == DebouncedEventKind::Any {
                            let event_path = event.path.to_string_lossy().to_string();

                            // Skip ignored directories (configurable list)
                            let should_skip = IGNORED_DIRECTORIES.iter().any(|dir| {
                                let unix_pattern = format!("/{}/", dir);
                                let windows_pattern = format!("\\{}\\", dir);
                                event_path.contains(&unix_pattern)
                                    || event_path.contains(&windows_pattern)
                            });
                            if should_skip {
                                continue;
                            }

                            log::debug!("File changed: {}", event_path);

                            // Get relative path from workspace root
                            let relative_path = event
                                .path
                                .strip_prefix(&ws_path)
                                .map(|p| p.to_string_lossy().to_string())
                                .unwrap_or_else(|_| event_path.clone());

                            // Emit event to frontend
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let payload = serde_json::json!({
                                    "workspaceId": ws_id,
                                    "path": relative_path,
                                    "fullPath": event_path,
                                });
                                if let Err(e) = window.emit("file-changed", payload) {
                                    log::error!("Failed to emit file-changed event: {}", e);
                                }
                            }
                        }
                    }
                }
                Ok(Err(error)) => {
                    log::error!("File watcher error: {:?}", error);
                }
                Err(_) => {
                    // Channel closed, watcher was stopped
                    log::info!("File watcher stopped for workspace: {}", ws_id);
                    break;
                }
            }
        }
    });

    // Store the debouncer handle
    {
        let mut watchers = FILE_WATCHERS
            .lock()
            .map_err(|e| AppError::Watcher(format!("Lock error: {}", e)))?;
        if let Some(map) = watchers.as_mut() {
            map.insert(workspace_id.clone(), debouncer);
        }
    }

    log::info!(
        "Started watching workspace: {} at {}",
        workspace_id,
        workspace_path
    );
    Ok(())
}

/// Stop watching a workspace directory
pub fn unwatch_workspace(workspace_id: &str) -> AppResult<()> {
    let mut watchers = FILE_WATCHERS
        .lock()
        .map_err(|e| AppError::Watcher(format!("Lock error: {}", e)))?;

    if let Some(map) = watchers.as_mut() {
        if map.remove(workspace_id).is_some() {
            log::info!("Stopped watching workspace: {}", workspace_id);
        } else {
            log::debug!("Workspace was not being watched: {}", workspace_id);
        }
    }

    Ok(())
}
