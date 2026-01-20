use std::process::Command;
use std::sync::Arc;
use std::time::Duration;
use tauri::{Emitter, Manager};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Port used by the ChatML backend sidecar
pub const SIDECAR_PORT: u16 = 9876;

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
    }
}

/// Spawn the sidecar and set up monitoring
pub fn spawn_sidecar(app: &tauri::AppHandle, state: &Arc<AppState>) -> AppResult<CommandChild> {
    // Clean up any existing processes before spawning
    kill_stored_sidecar(state);
    kill_process_on_port(SIDECAR_PORT);

    // Small delay to ensure port is released
    std::thread::sleep(Duration::from_millis(200));

    let mut sidecar_command = app
        .shell()
        .sidecar("chatml-backend")
        .map_err(|e| AppError::Sidecar(format!("Failed to create sidecar command: {}", e)))?;

    // In development, allow localhost:3000 for CORS
    #[cfg(debug_assertions)]
    {
        sidecar_command = sidecar_command.env("CHATML_DEV_ORIGIN", "http://localhost:3000");
    }

    let (mut rx, child) = sidecar_command
        .spawn()
        .map_err(|e| AppError::Sidecar(format!("Failed to spawn sidecar: {}", e)))?;

    // Store the PID for later cleanup
    state.set_sidecar_pid(Some(child.pid()));

    // Clone app handle for the monitoring task
    let app_handle = app.clone();

    // Spawn a task to monitor sidecar output
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    log::debug!("[sidecar stdout] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Stderr(line) => {
                    let line_str = String::from_utf8_lossy(&line);
                    log::warn!("[sidecar stderr] {}", line_str);
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
                    // Notify frontend that sidecar died
                    if let Some(window) = app_handle.get_webview_window("main") {
                        if let Err(e) = window.emit("sidecar-terminated", payload.code) {
                            log::warn!("Failed to emit sidecar-terminated event: {}", e);
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

    // Clean up existing sidecar process
    kill_stored_sidecar(&state);
    kill_process_on_port(SIDECAR_PORT);

    // Use async sleep instead of blocking (spawn blocking to avoid blocking the async runtime)
    tauri::async_runtime::spawn_blocking(|| {
        std::thread::sleep(Duration::from_millis(1500));
    })
    .await
    .map_err(|e| AppError::Sidecar(format!("Failed during restart delay: {}", e)))?;

    // Spawn new sidecar
    spawn_sidecar(&app, &state)?;

    Ok(())
}
