use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

/// Application state managed by Tauri's State<T> system
pub struct AppState {
    /// Whether the app frontend has initialized
    pub app_ready: AtomicBool,
    /// Whether to minimize to tray instead of closing
    pub minimize_to_tray: AtomicBool,
    /// PID of the backend sidecar process
    pub sidecar_pid: Mutex<Option<u32>>,
    /// Port the backend sidecar is running on
    pub sidecar_port: Mutex<Option<u16>>,
    /// Authentication token for backend API security
    pub auth_token: Mutex<Option<String>>,
    /// Pending OAuth callback URL (set by deep link handler, consumed by frontend)
    pub pending_oauth_callback: Mutex<Option<String>>,
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
            sidecar_port: Mutex::new(None),
            auth_token: Mutex::new(None),
            pending_oauth_callback: Mutex::new(None),
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
        match self.sidecar_pid.lock() {
            Ok(mut guard) => {
                if let Some(p) = pid {
                    log::info!("Stored sidecar PID: {}", p);
                }
                *guard = pid;
            }
            Err(e) => log::warn!("sidecar_pid mutex poisoned: {}", e),
        }
    }

    /// Take the sidecar PID (removes it from state)
    pub fn take_sidecar_pid(&self) -> Option<u32> {
        match self.sidecar_pid.lock() {
            Ok(mut guard) => guard.take(),
            Err(e) => {
                log::warn!("sidecar_pid mutex poisoned: {}", e);
                None
            }
        }
    }

    /// Store the sidecar port
    pub fn set_sidecar_port(&self, port: u16) {
        match self.sidecar_port.lock() {
            Ok(mut guard) => {
                log::info!("Backend port set to: {}", port);
                *guard = Some(port);
            }
            Err(e) => log::warn!("sidecar_port mutex poisoned: {}", e),
        }
    }

    /// Get the sidecar port
    pub fn get_sidecar_port(&self) -> Option<u16> {
        match self.sidecar_port.lock() {
            Ok(guard) => *guard,
            Err(e) => {
                log::warn!("sidecar_port mutex poisoned: {}", e);
                None
            }
        }
    }

    /// Clear the sidecar port (used when sidecar stops)
    pub fn clear_sidecar_port(&self) {
        match self.sidecar_port.lock() {
            Ok(mut guard) => {
                *guard = None;
            }
            Err(e) => log::warn!("sidecar_port mutex poisoned: {}", e),
        }
    }

    /// Store the authentication token for backend API security
    pub fn set_auth_token(&self, token: String) {
        match self.auth_token.lock() {
            Ok(mut guard) => {
                *guard = Some(token);
            }
            Err(e) => log::warn!("auth_token mutex poisoned: {}", e),
        }
    }

    /// Get the authentication token
    pub fn get_auth_token(&self) -> Option<String> {
        match self.auth_token.lock() {
            Ok(guard) => guard.clone(),
            Err(e) => {
                log::warn!("auth_token mutex poisoned: {}", e);
                None
            }
        }
    }

    /// Store a pending OAuth callback URL
    pub fn set_pending_oauth_callback(&self, url: String) {
        match self.pending_oauth_callback.lock() {
            Ok(mut guard) => {
                log::info!("Stored pending OAuth callback URL");
                *guard = Some(url);
            }
            Err(e) => log::warn!("pending_oauth_callback mutex poisoned: {}", e),
        }
    }

    /// Take the pending OAuth callback URL (removes it from state)
    pub fn take_pending_oauth_callback(&self) -> Option<String> {
        match self.pending_oauth_callback.lock() {
            Ok(mut guard) => guard.take(),
            Err(e) => {
                log::warn!("pending_oauth_callback mutex poisoned: {}", e);
                None
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_state_has_no_auth_token() {
        let state = AppState::new();
        assert!(state.get_auth_token().is_none());
    }

    #[test]
    fn test_set_and_get_auth_token() {
        let state = AppState::new();
        let token = "test-token-12345".to_string();

        state.set_auth_token(token.clone());

        let retrieved = state.get_auth_token();
        assert_eq!(retrieved, Some(token));
    }

    #[test]
    fn test_auth_token_can_be_overwritten() {
        let state = AppState::new();

        state.set_auth_token("first-token".to_string());
        assert_eq!(state.get_auth_token(), Some("first-token".to_string()));

        state.set_auth_token("second-token".to_string());
        assert_eq!(state.get_auth_token(), Some("second-token".to_string()));
    }

    #[test]
    fn test_auth_token_thread_safety() {
        use std::sync::Arc;
        use std::thread;

        let state = Arc::new(AppState::new());
        let mut handles = vec![];

        // Spawn multiple threads that set tokens
        for i in 0..10 {
            let state_clone = Arc::clone(&state);
            let handle = thread::spawn(move || {
                let token = format!("token-{}", i);
                state_clone.set_auth_token(token);
            });
            handles.push(handle);
        }

        // Wait for all threads to complete
        for handle in handles {
            handle.join().unwrap();
        }

        // Token should be set (we don't know which one wins, but it should be Some)
        assert!(state.get_auth_token().is_some());
    }

    #[test]
    fn test_default_impl_matches_new() {
        let state1 = AppState::new();
        let state2 = AppState::default();

        assert_eq!(state1.get_auth_token(), state2.get_auth_token());
        assert_eq!(state1.get_sidecar_port(), state2.get_sidecar_port());
        assert_eq!(state1.is_ready(), state2.is_ready());
        assert_eq!(
            state1.should_minimize_to_tray(),
            state2.should_minimize_to_tray()
        );
    }

    #[test]
    fn test_app_ready_state() {
        let state = AppState::new();

        assert!(!state.is_ready());
        state.mark_ready();
        assert!(state.is_ready());
    }

    #[test]
    fn test_minimize_to_tray_state() {
        let state = AppState::new();

        assert!(!state.should_minimize_to_tray());
        state.set_minimize_to_tray(true);
        assert!(state.should_minimize_to_tray());
        state.set_minimize_to_tray(false);
        assert!(!state.should_minimize_to_tray());
    }

    #[test]
    fn test_sidecar_pid_state() {
        let state = AppState::new();

        // Initially no PID
        assert!(state.take_sidecar_pid().is_none());

        // Set and take PID
        state.set_sidecar_pid(Some(12345));
        assert_eq!(state.take_sidecar_pid(), Some(12345));

        // After take, should be None
        assert!(state.take_sidecar_pid().is_none());
    }

    #[test]
    fn test_new_state_has_no_sidecar_port() {
        let state = AppState::new();
        assert!(state.get_sidecar_port().is_none());
    }

    #[test]
    fn test_set_and_get_sidecar_port() {
        let state = AppState::new();

        state.set_sidecar_port(9876);
        assert_eq!(state.get_sidecar_port(), Some(9876));
    }

    #[test]
    fn test_clear_sidecar_port() {
        let state = AppState::new();

        state.set_sidecar_port(9876);
        assert_eq!(state.get_sidecar_port(), Some(9876));

        state.clear_sidecar_port();
        assert!(state.get_sidecar_port().is_none());
    }

    #[test]
    fn test_sidecar_port_can_be_overwritten() {
        let state = AppState::new();

        state.set_sidecar_port(9876);
        assert_eq!(state.get_sidecar_port(), Some(9876));

        state.set_sidecar_port(9877);
        assert_eq!(state.get_sidecar_port(), Some(9877));
    }
}
