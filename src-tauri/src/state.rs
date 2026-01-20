use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri_plugin_shell::process::CommandChild;

/// Application state managed by Tauri's State<T> system
pub struct AppState {
    /// Whether the app frontend has initialized
    pub app_ready: AtomicBool,
    /// Whether to minimize to tray instead of closing
    pub minimize_to_tray: AtomicBool,
    /// PID of the backend sidecar process
    pub sidecar_pid: Mutex<Option<u32>>,
    /// Handle to the speech recognition sidecar process
    pub speech_sidecar: Mutex<Option<CommandChild>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

impl AppState {
    pub fn new() -> Self {
        Self {
            app_ready: AtomicBool::new(false),
            minimize_to_tray: AtomicBool::new(false),
            sidecar_pid: Mutex::new(None),
            speech_sidecar: Mutex::new(None),
        }
    }

    /// Mark the app as ready (frontend connected)
    pub fn mark_ready(&self) {
        self.app_ready.store(true, Ordering::SeqCst);
        log::info!("App marked as ready");
    }

    /// Check if app is ready
    pub fn is_ready(&self) -> bool {
        self.app_ready.load(Ordering::SeqCst)
    }

    /// Set minimize-to-tray preference
    pub fn set_minimize_to_tray(&self, enabled: bool) {
        self.minimize_to_tray.store(enabled, Ordering::SeqCst);
        log::info!("Minimize to tray set to: {}", enabled);
    }

    /// Check if minimize-to-tray is enabled
    pub fn should_minimize_to_tray(&self) -> bool {
        self.minimize_to_tray.load(Ordering::SeqCst)
    }

    /// Store the sidecar PID
    pub fn set_sidecar_pid(&self, pid: Option<u32>) {
        if let Ok(mut guard) = self.sidecar_pid.lock() {
            if let Some(p) = pid {
                log::info!("Stored sidecar PID: {}", p);
            }
            *guard = pid;
        }
    }

    /// Get the current sidecar PID
    pub fn get_sidecar_pid(&self) -> Option<u32> {
        self.sidecar_pid.lock().ok().and_then(|guard| *guard)
    }

    /// Take the sidecar PID (removes it from state)
    pub fn take_sidecar_pid(&self) -> Option<u32> {
        self.sidecar_pid.lock().ok().and_then(|mut guard| guard.take())
    }

    /// Check if speech sidecar is running
    pub fn is_speech_running(&self) -> bool {
        self.speech_sidecar
            .lock()
            .ok()
            .map(|guard| guard.is_some())
            .unwrap_or(false)
    }

    /// Store the speech sidecar child process
    pub fn set_speech_sidecar(&self, child: Option<CommandChild>) {
        if let Ok(mut guard) = self.speech_sidecar.lock() {
            *guard = child;
        }
    }

    /// Take the speech sidecar (removes it from state)
    pub fn take_speech_sidecar(&self) -> Option<CommandChild> {
        self.speech_sidecar
            .lock()
            .ok()
            .and_then(|mut guard| guard.take())
    }
}
