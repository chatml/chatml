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

/// Check if a path should be ignored based on directory patterns.
///
/// This function checks if any segment of the path matches an ignored directory.
/// The pattern requires the directory to appear as a complete path segment (surrounded
/// by path separators), so it will match `/project/.git/config` but NOT `/project/.git`
/// (without trailing content). This is intentional because file watcher events always
/// include a filename after the directory, so bare directory paths won't occur.
pub(crate) fn should_ignore_path(path: &str) -> bool {
    IGNORED_DIRECTORIES.iter().any(|dir| {
        let unix_pattern = format!("/{}/", dir);
        let windows_pattern = format!("\\{}\\", dir);
        path.contains(&unix_pattern) || path.contains(&windows_pattern)
    })
}

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
                            if should_ignore_path(&event_path) {
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

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;

    #[test]
    fn test_ignored_directory_git() {
        assert!(should_ignore_path("/home/user/project/.git/objects/abc"));
        assert!(should_ignore_path("C:\\Users\\dev\\project\\.git\\config"));
    }

    #[test]
    fn test_ignored_directory_node_modules() {
        assert!(should_ignore_path("/project/node_modules/lodash/index.js"));
        assert!(should_ignore_path("D:\\app\\node_modules\\react\\package.json"));
    }

    #[test]
    fn test_ignored_directory_target() {
        assert!(should_ignore_path("/rust-project/target/debug/binary"));
    }

    #[test]
    fn test_ignored_directory_next() {
        assert!(should_ignore_path("/app/.next/static/chunks/main.js"));
    }

    #[test]
    fn test_ignored_directory_pycache() {
        assert!(should_ignore_path("/python-app/__pycache__/module.pyc"));
    }

    #[test]
    fn test_not_ignored_regular_path() {
        assert!(!should_ignore_path("/home/user/project/src/main.rs"));
        assert!(!should_ignore_path("/app/components/Button.tsx"));
    }

    #[test]
    fn test_not_ignored_partial_match() {
        // Should NOT match if directory name is part of filename
        assert!(!should_ignore_path("/project/target_config.json"));
        assert!(!should_ignore_path("/project/my-git-helper/file.txt"));
    }

    #[test]
    #[serial]
    fn test_unwatch_nonexistent_workspace_ok() {
        // Unwatching a workspace that doesn't exist should succeed
        let result = unwatch_workspace("nonexistent-workspace-12345");
        assert!(result.is_ok());
    }

    #[test]
    fn test_ignored_directories_list_is_populated() {
        // Ensure we have a reasonable set of ignored directories
        assert!(IGNORED_DIRECTORIES.len() >= 5);
        assert!(IGNORED_DIRECTORIES.contains(&".git"));
        assert!(IGNORED_DIRECTORIES.contains(&"node_modules"));
        assert!(IGNORED_DIRECTORIES.contains(&"target"));
    }
}
