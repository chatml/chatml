use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;
use tauri::{Emitter, Manager};

use crate::error::{AppError, AppResult};

/// Type alias for file watcher handle
type FileWatcherHandle = notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>;

/// Shared session map: maps session directory name -> workspace_id for event routing.
/// Uses RwLock so the event thread can read concurrently without blocking registrations.
type SessionMap = Arc<RwLock<HashMap<String, String>>>;

/// Single global watcher that monitors the base worktrees directory
struct GlobalFileWatcher {
    _debouncer: FileWatcherHandle, // kept alive to maintain the OS watch
    _base_path: PathBuf,           // retained for diagnostics / future use
    sessions: SessionMap,
}

/// Global state: single watcher instance instead of per-workspace watchers
static GLOBAL_WATCHER: Mutex<Option<GlobalFileWatcher>> = Mutex::new(None);

/// Per-workspace accumulated file changes: (last_relative_path, last_full_path, count, all_files)
type WorkspaceChanges = (String, String, usize, Vec<(String, String)>);

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

/// Extract the session directory name from an event path by stripping the base path.
/// Returns the first path component after the base path, which is the session dir name.
fn extract_session_dir(base_path: &Path, event_path: &Path) -> Option<String> {
    event_path
        .strip_prefix(base_path)
        .ok()
        .and_then(|relative| relative.components().next())
        .and_then(|component| {
            if let std::path::Component::Normal(name) = component {
                name.to_str().map(String::from)
            } else {
                None
            }
        })
}

/// Start the global file watcher on the base worktrees directory.
/// This creates a single recursive watcher that monitors all session worktrees.
/// Events are routed to the correct workspace_id based on session registration.
///
/// If `create_if_needed` is true, the directory will be created if it doesn't exist.
/// The frontend passes true for the default path and false for user-configured paths
/// (which are validated by the backend before being stored).
pub fn start_global_watcher(
    app: &tauri::AppHandle,
    base_path: String,
    create_if_needed: bool,
) -> AppResult<()> {
    use std::sync::mpsc::channel;

    // Stop any existing watcher first
    stop_global_watcher()?;

    let path = PathBuf::from(&base_path);

    if !path.exists() {
        if create_if_needed {
            std::fs::create_dir_all(&path).map_err(|e| {
                AppError::Watcher(format!(
                    "Failed to create base directory {}: {}",
                    base_path, e
                ))
            })?;
        } else {
            return Err(AppError::Watcher(format!(
                "Workspaces base directory does not exist: {}",
                base_path
            )));
        }
    }

    let app_handle = app.clone();
    let watcher_base_path = path.clone();
    let sessions: SessionMap = Arc::new(RwLock::new(HashMap::new()));
    let thread_sessions = Arc::clone(&sessions);

    // Create a channel to receive file change events
    let (tx, rx) = channel();

    // Create a debounced watcher with 2 second delay
    let mut debouncer = new_debouncer(Duration::from_secs(2), tx)
        .map_err(|e| AppError::Watcher(format!("Failed to create file watcher: {}", e)))?;

    // Start watching the entire base directory recursively
    debouncer
        .watcher()
        .watch(&path, RecursiveMode::Recursive)
        .map_err(|e| AppError::Watcher(format!("Failed to watch directory: {}", e)))?;

    // Spawn a thread to handle file change events.
    // Lifecycle: The thread runs until the channel closes. When stop_global_watcher()
    // drops the GlobalFileWatcher (and its debouncer), the sender channel closes,
    // causing rx.recv() to return Err and the thread to exit gracefully.
    std::thread::spawn(move || {
        log::info!(
            "Global file watcher started on base directory: {}",
            watcher_base_path.display()
        );

        loop {
            match rx.recv() {
                Ok(Ok(events)) => {
                    // Collect changed files per workspace, emitting ONE event per workspace
                    // instead of per-file to avoid flooding the WebView event loop.
                    let mut workspace_changes: HashMap<String, WorkspaceChanges> = HashMap::new();

                    for event in events {
                        if event.kind == DebouncedEventKind::Any {
                            let event_path_str = event.path.to_string_lossy().to_string();

                            // Skip ignored directories
                            if should_ignore_path(&event_path_str) {
                                continue;
                            }

                            // Extract session directory name from the path
                            let session_dir =
                                match extract_session_dir(&watcher_base_path, &event.path) {
                                    Some(dir) => dir,
                                    None => {
                                        continue;
                                    }
                                };

                            // Check if this session directory still exists on disk.
                            // macOS FSEvents can deliver stale historical events for
                            // deleted directories when a new watcher subscribes.
                            let session_path = watcher_base_path.join(&session_dir);
                            if !session_path.exists() {
                                // Check if this was a registered session (vs stale FSEvents noise)
                                let was_registered = match thread_sessions.read() {
                                    Ok(sessions) => sessions.contains_key(&session_dir),
                                    Err(_) => false,
                                };
                                if was_registered {
                                    log::warn!(
                                        "WORKTREE DELETED EXTERNALLY: {} (path: {})",
                                        session_dir,
                                        session_path.display()
                                    );
                                    // Emit event to frontend for visibility
                                    if let Some(window) = app_handle.get_webview_window("main") {
                                        let payload = serde_json::json!({
                                            "sessionDir": session_dir,
                                            "path": session_path.to_string_lossy(),
                                        });
                                        let _ = window.emit("session-deleted-externally", payload);
                                    }
                                }
                                continue;
                            }

                            // Look up the workspace_id for this session (read lock only)
                            let workspace_id = match thread_sessions.read() {
                                Ok(s) => s.get(&session_dir).cloned(),
                                Err(e) => {
                                    log::warn!(
                                        "Session map RwLock poisoned, skipping event: {}",
                                        e
                                    );
                                    continue;
                                }
                            };

                            let workspace_id = match workspace_id {
                                Some(id) => id,
                                None => {
                                    continue;
                                }
                            };

                            // Get relative path from session root
                            let session_path = watcher_base_path.join(&session_dir);
                            let relative_path = event
                                .path
                                .strip_prefix(&session_path)
                                .map(|p| p.to_string_lossy().to_string())
                                .unwrap_or_else(|_| event_path_str.clone());

                            let entry = workspace_changes
                                .entry(workspace_id.clone())
                                .or_insert_with(|| (String::new(), String::new(), 0, Vec::new()));
                            entry.0 = relative_path.clone();
                            entry.1 = event_path_str.clone();
                            entry.2 += 1;
                            entry.3.push((relative_path, event_path_str));
                        }
                    }

                    // Emit one event per workspace with all changed file paths
                    if let Some(window) = app_handle.get_webview_window("main") {
                        for (workspace_id, (last_path, last_full, count, files)) in
                            &workspace_changes
                        {
                            let file_list: Vec<serde_json::Value> = files
                                .iter()
                                .map(|(path, full)| {
                                    serde_json::json!({ "path": path, "fullPath": full })
                                })
                                .collect();
                            let payload = serde_json::json!({
                                "workspaceId": workspace_id,
                                "path": last_path,
                                "fullPath": last_full,
                                "files": file_list,
                                "fileCount": count,
                            });
                            if let Err(e) = window.emit("file-changed", payload) {
                                log::error!("Failed to emit file-changed event: {}", e);
                            }
                            log::debug!(
                                "File changes detected in workspace {}: {} files",
                                workspace_id,
                                count
                            );
                        }
                    }
                }
                Ok(Err(error)) => {
                    log::error!("Global file watcher error: {:?}", error);
                }
                Err(_) => {
                    // Channel closed, watcher was stopped
                    log::info!("Global file watcher stopped");
                    break;
                }
            }
        }
    });

    // Store the watcher
    {
        let mut watcher = GLOBAL_WATCHER
            .lock()
            .map_err(|e| AppError::Watcher(format!("Lock error: {}", e)))?;
        *watcher = Some(GlobalFileWatcher {
            _debouncer: debouncer,
            _base_path: path.clone(),
            sessions,
        });
    }

    log::info!("Global file watcher initialized on: {}", base_path);
    Ok(())
}

/// Stop the global file watcher
pub fn stop_global_watcher() -> AppResult<()> {
    let mut watcher = GLOBAL_WATCHER
        .lock()
        .map_err(|e| AppError::Watcher(format!("Lock error: {}", e)))?;

    if watcher.take().is_some() {
        log::info!("Global file watcher stopped");
    }

    Ok(())
}

/// Get a clone of the session map from the global watcher.
/// Returns None if the global watcher is not started.
fn get_session_map() -> AppResult<Option<SessionMap>> {
    let watcher = GLOBAL_WATCHER
        .lock()
        .map_err(|e| AppError::Watcher(format!("Lock error: {}", e)))?;
    Ok(watcher.as_ref().map(|w| Arc::clone(&w.sessions)))
}

/// Register a session so its file change events are routed with the correct workspace_id.
/// The session_dir_name is the directory name under the base worktrees path.
pub fn register_session(session_dir_name: String, workspace_id: String) -> AppResult<()> {
    if let Some(sessions) = get_session_map()? {
        let mut map = sessions
            .write()
            .map_err(|e| AppError::Watcher(format!("Session map write lock error: {}", e)))?;
        map.insert(session_dir_name.clone(), workspace_id.clone());
        log::info!(
            "Registered session: {} -> {}",
            session_dir_name,
            workspace_id
        );
    } else {
        log::warn!(
            "Cannot register session {}: global watcher not started",
            session_dir_name
        );
    }

    Ok(())
}

/// Unregister a session so its events are no longer routed.
pub fn unregister_session(session_dir_name: &str) -> AppResult<()> {
    if let Some(sessions) = get_session_map()? {
        let mut map = sessions
            .write()
            .map_err(|e| AppError::Watcher(format!("Session map write lock error: {}", e)))?;
        if map.remove(session_dir_name).is_some() {
            log::info!("Unregistered session: {}", session_dir_name);
        } else {
            log::debug!("Session was not registered: {}", session_dir_name);
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
        assert!(should_ignore_path(
            "D:\\app\\node_modules\\react\\package.json"
        ));
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
    fn test_stop_global_watcher_when_not_started() {
        // Stopping when not started should succeed
        let result = stop_global_watcher();
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

    #[test]
    fn test_extract_session_dir() {
        let base = PathBuf::from("/Users/test/.chatml/workspaces");

        // Normal case
        assert_eq!(
            extract_session_dir(
                &base,
                &PathBuf::from("/Users/test/.chatml/workspaces/my-session/src/main.rs")
            ),
            Some("my-session".to_string())
        );

        // File directly in session root
        assert_eq!(
            extract_session_dir(
                &base,
                &PathBuf::from("/Users/test/.chatml/workspaces/my-session/README.md")
            ),
            Some("my-session".to_string())
        );

        // Path that doesn't match base
        assert_eq!(
            extract_session_dir(&base, &PathBuf::from("/other/path/file.txt")),
            None
        );

        // Path that is the base itself (no session component)
        assert_eq!(
            extract_session_dir(&base, &PathBuf::from("/Users/test/.chatml/workspaces")),
            None
        );
    }
}
