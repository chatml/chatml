use std::net::TcpListener;
use std::process::Command;
use std::sync::Arc;
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::Rng;
use tauri::{Emitter, Manager};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Maximum number of automatic restart attempts before giving up
const MAX_AUTO_RESTART_ATTEMPTS: u32 = 3;

/// Payload emitted to the frontend when a sidecar restart is starting
#[derive(Clone, Serialize)]
struct SidecarRestartingPayload {
    attempt: u32,
    max_attempts: u32,
}

/// Payload emitted to the frontend when a sidecar restart fails
#[derive(Clone, Serialize)]
struct SidecarRestartFailedPayload {
    attempt: u32,
    error: String,
}

/// Default port used by the ChatML backend sidecar (production)
pub const DEFAULT_SIDECAR_PORT: u16 = 9876;
/// Dev port used when running alongside a production instance
pub const DEV_SIDECAR_PORT: u16 = 9886;

/// Returns the appropriate default port based on build type.
/// Debug builds use DEV_SIDECAR_PORT to avoid conflicting with a production instance.
pub fn default_port() -> u16 {
    if cfg!(debug_assertions) {
        DEV_SIDECAR_PORT
    } else {
        DEFAULT_SIDECAR_PORT
    }
}
/// Protocol prefix for port announcement in backend stdout
const PORT_LINE_PREFIX: &str = "CHATML_PORT=";

/// Maximum time to wait for port to become available (in milliseconds)
const PORT_WAIT_TIMEOUT_MS: u64 = 5000;
/// Interval between port availability checks (in milliseconds)
const PORT_CHECK_INTERVAL_MS: u64 = 100;

/// Check if a port is available for binding
pub(crate) fn is_port_available(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// Parse port from backend stdout line
/// Returns Some(port) if the line matches "CHATML_PORT=<number>"
fn parse_port_line(line: &str) -> Option<u16> {
    line.trim()
        .strip_prefix(PORT_LINE_PREFIX)
        .and_then(|s| s.parse().ok())
}

/// Generate a cryptographically secure authentication token
/// Returns a URL-safe base64-encoded 32-byte random token
pub(crate) fn generate_auth_token() -> String {
    let token_bytes: [u8; 32] = rand::thread_rng().gen();
    URL_SAFE_NO_PAD.encode(token_bytes)
}

/// Wait for a port to become available, with timeout
/// Returns Ok(()) if port becomes available, Err if timeout exceeded
fn wait_for_port_available(port: u16) -> AppResult<()> {
    let start = Instant::now();
    let timeout = Duration::from_millis(PORT_WAIT_TIMEOUT_MS);
    let check_interval = Duration::from_millis(PORT_CHECK_INTERVAL_MS);

    while start.elapsed() < timeout {
        if is_port_available(port) {
            log::debug!(
                "Port {} is now available (waited {:?})",
                port,
                start.elapsed()
            );
            return Ok(());
        }
        std::thread::sleep(check_interval);
    }

    Err(AppError::Sidecar(format!(
        "Timeout waiting for port {} to become available after {:?}",
        port, timeout
    )))
}

/// Kill any existing process on the specified port
pub fn kill_process_on_port(port: u16) {
    #[cfg(unix)]
    {
        if let Ok(output) = Command::new("lsof")
            .args(["-t", "-i", &format!(":{}", port)])
            .output()
        {
            let pids = String::from_utf8_lossy(&output.stdout);
            for pid_str in pids.lines() {
                if let Ok(pid) = pid_str.trim().parse::<i32>() {
                    log::info!("Killing existing process on port {}: PID {}", port, pid);
                    let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
                }
            }
        }
    }

    #[cfg(windows)]
    {
        if let Ok(output) = Command::new("netstat").args(["-ano"]).output() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let port_str = format!(":{} ", port);
            let port_str_tab = format!(":{}\t", port);
            for line in stdout.lines() {
                if (line.contains(&port_str) || line.contains(&port_str_tab))
                    && line.contains("LISTENING")
                {
                    if let Some(pid_str) = line.split_whitespace().last() {
                        if pid_str.parse::<u32>().is_ok() {
                            log::info!(
                                "Killing existing process on port {}: PID {}",
                                port,
                                pid_str
                            );
                            let _ = Command::new("taskkill")
                                .args(["/F", "/PID", pid_str])
                                .output();
                        }
                    }
                }
            }
        }
    }
}

/// Kill the stored sidecar process if it exists
pub fn kill_stored_sidecar(state: &AppState) {
    if let Some(pid) = state.take_sidecar_pid() {
        log::info!("Killing stored sidecar process: PID {}", pid);
        #[cfg(unix)]
        {
            // Send SIGTERM first for graceful shutdown
            let _ = Command::new("kill")
                .args(["-15", &pid.to_string()])
                .output();
            // Wait for graceful shutdown (2 seconds to allow data flush)
            std::thread::sleep(Duration::from_millis(2000));
            // Force kill if still running
            let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
        }

        #[cfg(windows)]
        {
            let _ = Command::new("taskkill")
                .args(["/F", "/PID", &pid.to_string()])
                .output();
        }
    }
}

/// Spawn the sidecar and set up monitoring
pub fn spawn_sidecar(app: &tauri::AppHandle, state: &Arc<AppState>) -> AppResult<CommandChild> {
    let port = default_port();

    // Clean up any existing processes before spawning
    kill_stored_sidecar(state);
    kill_process_on_port(port);

    // Wait for port to become available instead of fixed delay
    wait_for_port_available(port)?;

    let mut sidecar_command = app
        .shell()
        .sidecar("chatml-backend")
        .map_err(|e| AppError::Sidecar(format!("Failed to create sidecar command: {}", e)))?;

    // Tell the Go backend which port to prefer
    sidecar_command = sidecar_command.env("PORT", port.to_string());

    // macOS apps launched from Finder have a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin).
    // The Go backend needs `node` to run agent-runner, which is typically in /opt/homebrew/bin,
    // /usr/local/bin, or an nvm/fnm-managed path. Resolve the user's login shell PATH.
    {
        let shell_path = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        if let Ok(output) = Command::new(&shell_path)
            .args(["-l", "-c", "echo $PATH"])
            .output()
        {
            let user_path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !user_path.is_empty() {
                log::info!("Resolved user PATH for sidecar ({} entries)", user_path.matches(':').count() + 1);
                sidecar_command = sidecar_command.env("PATH", &user_path);
            }
        }
    }

    // Point the backend to the bundled agent-runner.
    // Tauri places "../agent-runner" resources under _up_/agent-runner/ in Contents/Resources.
    // In dev, the backend finds it via relative paths from the working directory.
    {
        if let Ok(resource_dir) = app.path().resource_dir() {
            let agent_runner_path = resource_dir
                .join("_up_")
                .join("agent-runner")
                .join("dist")
                .join("index.js");
            if agent_runner_path.exists() {
                sidecar_command = sidecar_command.env(
                    "CHATML_AGENT_RUNNER",
                    agent_runner_path.to_string_lossy().as_ref(),
                );
            }
        }
    }

    // In dev builds, isolate the data directory so dev and production don't share state
    #[cfg(debug_assertions)]
    {
        let dev_data_dir = if cfg!(target_os = "macos") {
            std::env::var("HOME").ok().map(|h| {
                std::path::PathBuf::from(h)
                    .join("Library")
                    .join("Application Support")
                    .join("ChatML-Dev")
            })
        } else if cfg!(target_os = "windows") {
            std::env::var("LOCALAPPDATA")
                .ok()
                .map(|d| std::path::PathBuf::from(d).join("ChatML-Dev"))
        } else {
            // Linux: XDG_DATA_HOME or ~/.local/share
            std::env::var("XDG_DATA_HOME")
                .ok()
                .or_else(|| {
                    std::env::var("HOME")
                        .ok()
                        .map(|h| format!("{}/.local/share", h))
                })
                .map(|b| std::path::PathBuf::from(b).join("ChatML-Dev"))
        };

        if let Some(dir) = dev_data_dir {
            sidecar_command =
                sidecar_command.env("CHATML_DATA_DIR", dir.to_string_lossy().as_ref());
        }
    }

    // Generate authentication token for backend API security
    let auth_token = generate_auth_token();
    state.set_auth_token(auth_token.clone());
    sidecar_command = sidecar_command.env("CHATML_AUTH_TOKEN", &auth_token);

    // In development, allow localhost:3000 for CORS
    #[cfg(debug_assertions)]
    {
        sidecar_command = sidecar_command.env("CHATML_DEV_ORIGIN", "http://localhost:3100");
    }

    // Pass GitHub OAuth credentials to sidecar (if set)
    let has_client_id = if let Ok(client_id) = std::env::var("GITHUB_CLIENT_ID") {
        sidecar_command = sidecar_command.env("GITHUB_CLIENT_ID", &client_id);
        true
    } else {
        false
    };
    let has_client_secret = if let Ok(client_secret) = std::env::var("GITHUB_CLIENT_SECRET") {
        sidecar_command = sidecar_command.env("GITHUB_CLIENT_SECRET", &client_secret);
        true
    } else {
        false
    };
    if !has_client_id || !has_client_secret {
        log::warn!(
            "GitHub OAuth credentials not fully configured - client_id={}, client_secret={}",
            has_client_id,
            has_client_secret
        );
    } else {
        log::info!("GitHub OAuth credentials passed to sidecar");
    }

    let (mut rx, child) = sidecar_command
        .spawn()
        .map_err(|e| AppError::Sidecar(format!("Failed to spawn sidecar: {}", e)))?;

    // Store the PID for later cleanup
    state.set_sidecar_pid(Some(child.pid()));

    // Note: We intentionally do NOT set a default port here.
    // The port is only set when we capture it from the backend's stdout (CHATML_PORT=).
    // This ensures the frontend waits for the actual port before making API calls,
    // avoiding requests to a potentially wrong port during startup.

    // Clone app handle and state for the monitoring task
    let app_handle = app.clone();
    let state_clone = Arc::clone(state);

    // Spawn a task to monitor sidecar output
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;

        // Track whether we've captured the port (it should be the first stdout line)
        let mut port_captured = false;

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let line_str = String::from_utf8_lossy(&line);

                    // Try to capture port from the first stdout line
                    if !port_captured {
                        if let Some(port) = parse_port_line(&line_str) {
                            log::info!("Captured backend port: {}", port);
                            state_clone.set_sidecar_port(port);
                            port_captured = true;

                            // Emit port event to frontend
                            if let Some(window) = app_handle.get_webview_window("main") {
                                if let Err(e) = window.emit("backend-port", port) {
                                    log::warn!("Failed to emit backend-port event: {}", e);
                                }
                            }
                            continue; // Don't log the port protocol line
                        }
                    }

                    log::debug!("[sidecar stdout] {}", line_str.trim_end());
                }
                CommandEvent::Stderr(line) => {
                    let line_str = String::from_utf8_lossy(&line);
                    log::warn!("[sidecar stderr] {}", line_str.trim_end());
                    // Emit stderr to frontend for debugging
                    if let Some(window) = app_handle.get_webview_window("main") {
                        if let Err(e) = window.emit("sidecar-stderr", line_str.to_string()) {
                            log::warn!("Failed to emit sidecar-stderr event: {}", e);
                        }
                    }
                }
                CommandEvent::Error(err) => {
                    log::error!("[sidecar error] {}", err);
                    if let Some(window) = app_handle.get_webview_window("main") {
                        if let Err(e) = window.emit("sidecar-error", err.clone()) {
                            log::warn!("Failed to emit sidecar-error event: {}", e);
                        }
                    }
                }
                CommandEvent::Terminated(payload) => {
                    log::error!(
                        "[sidecar terminated] code: {:?}, signal: {:?}",
                        payload.code,
                        payload.signal
                    );
                    // Clear the port since sidecar is no longer running
                    state_clone.clear_sidecar_port();
                    // Notify frontend that sidecar died
                    if let Some(window) = app_handle.get_webview_window("main") {
                        if let Err(e) = window.emit("sidecar-terminated", payload.code) {
                            log::warn!("Failed to emit sidecar-terminated event: {}", e);
                        }
                    }

                    // Auto-restart if the app is ready and no restart is already in progress.
                    // try_claim_restart uses compare_exchange to atomically prevent races.
                    if state_clone.is_ready() && state_clone.try_claim_restart() {
                        // try_increment_restart_attempts atomically checks < max and increments
                        if let Some(attempt) =
                            state_clone.try_increment_restart_attempts(MAX_AUTO_RESTART_ATTEMPTS)
                        {
                            log::info!(
                                "Auto-restarting sidecar (attempt {}/{})",
                                attempt,
                                MAX_AUTO_RESTART_ATTEMPTS
                            );

                            // Notify frontend that restart is starting
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.emit(
                                    "sidecar-restarting",
                                    SidecarRestartingPayload {
                                        attempt,
                                        max_attempts: MAX_AUTO_RESTART_ATTEMPTS,
                                    },
                                );
                            }

                            // Exponential backoff: 1s, 2s, 4s
                            let delay = Duration::from_secs(1 << (attempt - 1));
                            let _ = tauri::async_runtime::spawn_blocking(move || {
                                std::thread::sleep(delay);
                            })
                            .await;

                            match restart_sidecar_async(app_handle.clone(), state_clone.clone())
                                .await
                            {
                                Ok(_) => {
                                    log::info!(
                                        "Sidecar auto-restart succeeded (attempt {})",
                                        attempt
                                    );
                                    if let Some(window) = app_handle.get_webview_window("main") {
                                        let _ = window.emit("sidecar-restarted", ());
                                    }
                                }
                                Err(e) => {
                                    log::error!(
                                        "Sidecar auto-restart failed (attempt {}): {}",
                                        attempt,
                                        e
                                    );
                                    if let Some(window) = app_handle.get_webview_window("main") {
                                        let _ = window.emit(
                                            "sidecar-restart-failed",
                                            SidecarRestartFailedPayload {
                                                attempt,
                                                error: e.to_string(),
                                            },
                                        );
                                    }
                                }
                            }
                            state_clone.clear_restart_in_progress();
                        } else {
                            state_clone.clear_restart_in_progress();
                            log::error!(
                                "Sidecar auto-restart exhausted ({} attempts)",
                                MAX_AUTO_RESTART_ATTEMPTS
                            );
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.emit("sidecar-restart-exhausted", ());
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    });

    log::info!("ChatML backend sidecar started successfully");
    Ok(child)
}

/// Restart the sidecar process (async version)
pub async fn restart_sidecar_async(app: tauri::AppHandle, state: Arc<AppState>) -> AppResult<()> {
    log::info!("Restarting sidecar...");

    let port = default_port();

    // Clean up existing sidecar process
    kill_stored_sidecar(&state);
    kill_process_on_port(port);

    // Wait for port in blocking context (can't use TcpListener in async directly).
    // Note: The double `?` below handles two error types:
    //   - First `?` propagates JoinError from spawn_blocking
    //   - Second `?` propagates AppError from wait_for_port_available
    tauri::async_runtime::spawn_blocking(move || wait_for_port_available(port))
        .await
        .map_err(|e| AppError::Sidecar(format!("Failed during port wait: {}", e)))??;

    // Spawn new sidecar
    spawn_sidecar(&app, &state)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;
    use std::net::TcpListener;

    #[test]
    fn test_is_port_available_with_free_port() {
        // Use port 0 to get an available port from the OS
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        // Drop the listener to free the port
        drop(listener);
        // Now it should be available
        assert!(is_port_available(port));
    }

    #[test]
    fn test_is_port_available_with_bound_port() {
        // Bind to a port
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        // While bound, it should NOT be available
        assert!(!is_port_available(port));
        // Clean up
        drop(listener);
    }

    #[test]
    fn test_wait_for_port_available_immediate() {
        // Get a free port
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);

        // Should succeed immediately
        let result = wait_for_port_available(port);
        assert!(result.is_ok());
    }

    #[test]
    fn test_auth_token_format() {
        let token = generate_auth_token();
        // URL-safe base64 only contains these characters
        let valid_chars: HashSet<char> =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
                .chars()
                .collect();
        for c in token.chars() {
            assert!(
                valid_chars.contains(&c),
                "Token contains invalid character: {}",
                c
            );
        }
    }

    #[test]
    fn test_auth_token_length() {
        let token = generate_auth_token();
        // 32 bytes encoded in base64 (no padding) = 43 characters
        assert_eq!(token.len(), 43);
    }

    #[test]
    fn test_auth_token_uniqueness() {
        let token1 = generate_auth_token();
        let token2 = generate_auth_token();
        assert_ne!(token1, token2, "Tokens should be unique");
    }

    #[test]
    fn test_auth_token_decodes_to_32_bytes() {
        let token = generate_auth_token();
        let decoded = URL_SAFE_NO_PAD.decode(&token).unwrap();
        assert_eq!(decoded.len(), 32);
    }

    #[test]
    fn test_parse_port_line_valid() {
        assert_eq!(parse_port_line("CHATML_PORT=9876"), Some(9876));
        assert_eq!(parse_port_line("CHATML_PORT=9877"), Some(9877));
        assert_eq!(parse_port_line("CHATML_PORT=9899"), Some(9899));
    }

    #[test]
    fn test_parse_port_line_with_whitespace() {
        assert_eq!(parse_port_line("  CHATML_PORT=9876"), Some(9876));
        assert_eq!(parse_port_line("CHATML_PORT=9876\n"), Some(9876));
        assert_eq!(parse_port_line("  CHATML_PORT=9876  \n"), Some(9876));
    }

    #[test]
    fn test_parse_port_line_invalid() {
        assert_eq!(parse_port_line("some other output"), None);
        assert_eq!(
            parse_port_line("ChatML backend starting on port 9876"),
            None
        );
        assert_eq!(parse_port_line("CHATML_PORT="), None);
        assert_eq!(parse_port_line("CHATML_PORT=abc"), None);
        assert_eq!(parse_port_line(""), None);
    }

    #[test]
    fn test_parse_port_line_wrong_prefix() {
        assert_eq!(parse_port_line("PORT=9876"), None);
        assert_eq!(parse_port_line("chatml_port=9876"), None); // Case sensitive
    }
}
