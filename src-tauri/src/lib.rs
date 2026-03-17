mod commands;
mod error;
mod icons;
mod menu;
mod sidecar;
mod state;
mod watcher;

use std::sync::Arc;
use tauri::{Emitter, Manager, WindowEvent};

#[cfg(target_os = "macos")]
use tauri_plugin_decorum::WebviewWindowExt;

use state::AppState;

/// Check if a URL is an OAuth callback for the current build (dev or release).
fn is_oauth_callback(scheme: &str, host: Option<&str>) -> bool {
    let expected_scheme = if cfg!(debug_assertions) {
        "chatml-dev"
    } else {
        "chatml"
    };
    scheme == expected_scheme && host == Some("oauth")
}

/// Fixed application-specific salt for Stronghold key derivation.
///
/// IMPORTANT: This salt value is PERMANENT and must NEVER be changed.
/// Changing it would invalidate all existing Stronghold vaults, making
/// stored credentials inaccessible. If a salt change is ever required,
/// implement a migration strategy that re-encrypts existing vaults.
///
/// Note: Stronghold requires deterministic output for the same password,
/// so we use a fixed salt. The salt is application-specific to prevent
/// cross-application attacks.
const STRONGHOLD_SALT: &[u8; 16] = b"chatml-stronghld";

/// Derive a 32-byte key from a password using Argon2id.
/// This is used for Stronghold vault encryption.
pub fn derive_stronghold_key(password: &str) -> Vec<u8> {
    use argon2::{Algorithm, Argon2, Params, Version};

    // Configure Argon2id with fast parameters for development
    // - 4 MiB memory (m_cost = 4096 KiB)
    // - 1 iteration (t_cost)
    // - 1 degree of parallelism (p_cost)
    // - 32 bytes output for encryption key
    let params = Params::new(4096, 1, 1, Some(32)).expect("Invalid Argon2 parameters");
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut output = [0u8; 32];
    argon2
        .hash_password_into(password.as_bytes(), STRONGHOLD_SALT, &mut output)
        .expect("Argon2 hashing failed");

    output.to_vec()
}

/// Initialize Sentry for crash reporting (only in release builds with DSN set)
fn init_sentry() -> Option<sentry::ClientInitGuard> {
    let dsn = std::env::var("SENTRY_DSN").ok()?;
    if dsn.is_empty() {
        return None;
    }

    let guard = sentry::init((
        dsn,
        sentry::ClientOptions {
            release: Some(env!("CARGO_PKG_VERSION").into()),
            environment: if cfg!(debug_assertions) {
                Some("development".into())
            } else {
                Some("production".into())
            },
            ..Default::default()
        },
    ));

    log::info!("Sentry initialized for crash reporting");
    Some(guard)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize Sentry before anything else
    let _sentry_guard = init_sentry();

    // Create shared application state
    let app_state = Arc::new(AppState::new());

    // Note on CSP: tauri.conf.json uses 'unsafe-inline' for script-src and style-src.
    // This is required for Next.js hydration scripts and CSS-in-JS.
    // Risk is mitigated by Tauri's isolation - no external content is loaded.

    let mut builder = tauri::Builder::default();

    // Enable single-instance in release builds (all platforms) or dev builds on Windows/Linux
    // (Windows/Linux require single-instance for deep link URL forwarding to existing instance)
    #[cfg(any(not(debug_assertions), not(target_os = "macos")))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Focus the main window when a second instance tries to launch
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }));
    }

    builder = builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_pty::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_decorum::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(tauri_plugin_window_state::StateFlags::all())
                .build(),
        )
        .plugin(tauri_plugin_deep_link::init())
        .plugin(
            tauri_plugin_stronghold::Builder::new(|password| {
                // BREAKING CHANGE: This Argon2id implementation replaces the previous
                // DefaultHasher-based approach. Existing Stronghold vaults created with
                // earlier versions will be inaccessible and must be reset/recreated.
                derive_stronghold_key(password)
            })
            .build(),
        )
        // Register shared state
        .manage(Arc::clone(&app_state));

    // MCP Bridge plugin - development only
    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
        log::info!("MCP Bridge plugin enabled (development mode)");
    }

    // Clone state for closures
    let state_for_window_event = Arc::clone(&app_state);
    let state_for_setup = Arc::clone(&app_state);
    let state_for_deep_link = Arc::clone(&app_state);
    #[cfg(not(target_os = "macos"))]
    let state_for_cold_start = Arc::clone(&app_state);

    builder
        .invoke_handler(tauri::generate_handler![
            commands::update_menu_state,
            commands::mark_app_ready,
            commands::restart_sidecar,
            commands::reset_sidecar_restart_count,
            // Global file watcher commands
            commands::start_file_watcher,
            commands::stop_file_watcher,
            commands::register_session,
            commands::unregister_session,
            commands::get_auth_token,
            commands::get_backend_port,
            commands::get_pending_oauth_callback,
            // File attachment commands
            commands::read_file_metadata,
            commands::read_file_as_base64,
            commands::get_image_dimensions,
            commands::count_file_lines,
            // Shell detection
            commands::get_user_shell,
            // App detection
            commands::detect_installed_apps,
            commands::close_window,
            // System prerequisites
            commands::check_prerequisites,
            commands::check_gh_auth_status,
            // Resolved user PATH (version manager shims)
            commands::get_resolved_path
        ])
        .setup(move |app| {
            // Create and set the menu
            let menu_result = menu::create_menu(app.handle())?;
            app.set_menu(menu_result)?;

            // Set macOS traffic light position
            #[cfg(target_os = "macos")]
            {
                if let Some(main_window) = app.get_webview_window("main") {
                    if let Err(e) = main_window.set_traffic_lights_inset(16.0, 16.0) {
                        log::warn!("Failed to set traffic lights inset: {}", e);
                    }
                } else {
                    log::warn!(
                        "Main window not found during setup - traffic lights position not set"
                    );
                }
            }

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Debug)
                        .build(),
                )?;
            }

            // Only initialize the updater plugin when a pubkey is configured.
            // build-release uses tauri.release.conf.json which clears the pubkey,
            // so the updater plugin won't be loaded for local release builds.
            {
                let has_updater = app
                    .config()
                    .plugins
                    .0
                    .get("updater")
                    .and_then(|v| v.get("pubkey"))
                    .and_then(|v| v.as_str())
                    .is_some_and(|s| !s.is_empty());

                if has_updater {
                    app.handle()
                        .plugin(tauri_plugin_updater::Builder::new().build())?;
                }
            }

            // Spawn the Go backend sidecar with proper error handling
            match sidecar::spawn_sidecar(app.handle(), &state_for_setup) {
                Ok(_child) => {
                    log::info!("Sidecar spawn initiated");
                }
                Err(e) => {
                    log::error!("Failed to spawn sidecar: {}", e);
                    // Emit error to frontend
                    if let Some(window) = app.get_webview_window("main") {
                        if let Err(emit_err) = window.emit("sidecar-error", e.to_string()) {
                            log::warn!("Failed to emit sidecar-error event: {}", emit_err);
                        }
                    }
                }
            }

            // Register deep link handler for OAuth callback
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;

                // On Windows/Linux, register URL scheme so the OS can route deep links
                // (macOS handles this automatically via Info.plist in the app bundle)
                #[cfg(not(target_os = "macos"))]
                {
                    if let Err(e) = app.deep_link().register_all() {
                        log::error!("Failed to register deep link schemes: {}", e);
                    } else {
                        log::info!("Deep link schemes registered with OS");
                    }
                }

                let app_handle = app.handle().clone();
                let deep_link_state = Arc::clone(&state_for_deep_link);
                app.deep_link().on_open_url(move |event| {
                    let urls = event.urls();
                    // Print to terminal for debugging (bypasses log system)
                    println!("[DEEP-LINK] on_open_url called with {} URLs", urls.len());
                    for url in urls {
                        println!("[DEEP-LINK] URL: {}", url);
                        if is_oauth_callback(url.scheme(), url.host_str()) {
                            println!("[DEEP-LINK] OAuth callback matched!");
                            log::info!("Received OAuth callback URL: {}", url);
                            let url_string = url.to_string();

                            // Store the callback URL in state for frontend to retrieve
                            deep_link_state.set_pending_oauth_callback(url_string.clone());

                            // Focus the window so user sees the result
                            if let Some(window) = app_handle.get_webview_window("main") {
                                if let Err(e) = window.show() {
                                    log::warn!("Failed to show window: {}", e);
                                }
                                if let Err(e) = window.set_focus() {
                                    log::warn!("Failed to focus window: {}", e);
                                }
                                // Also try to emit the event (may not work in all contexts)
                                let _ = window.emit("oauth-callback", url_string.clone());
                                // And try JS eval as fallback
                                let js_code = format!(
                                    r#"window.dispatchEvent(new CustomEvent('tauri-oauth-callback', {{ detail: '{}' }}))"#,
                                    url_string.replace('\'', "\\'")
                                );
                                let _ = window.eval(&js_code);
                            }
                        }
                    }
                });
                let scheme = if cfg!(debug_assertions) { "chatml-dev" } else { "chatml" };
                log::info!("Deep link handler registered for {}:// URLs", scheme);

                // On Windows/Linux, check for a deep link URL that cold-launched the app
                // (on_open_url only fires for URLs received while already running;
                //  macOS delivers launch URLs via on_open_url automatically)
                #[cfg(not(target_os = "macos"))]
                {
                    if let Ok(Some(urls)) = app.deep_link().get_current() {
                        println!("[DEEP-LINK] get_current() found {} URLs on cold start", urls.len());
                        for url in urls {
                            println!("[DEEP-LINK] Cold start URL: {}", url);
                            if is_oauth_callback(url.scheme(), url.host_str()) {
                                println!("[DEEP-LINK] Cold start OAuth callback matched!");
                                log::info!("Cold start OAuth callback URL: {}", url);
                                state_for_cold_start.set_pending_oauth_callback(url.to_string());
                            }
                        }
                    }
                }
            }

            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if let Some(window) = app.get_webview_window("main") {
                if let Err(e) = window.emit("menu-event", id) {
                    log::warn!("Failed to emit menu-event: {}", e);
                }
            }
        })
        .on_window_event(move |_window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = &state_for_window_event; // keep the state reference for future use
                // Prevent Tauri's default JS-side close flow (which calls window.destroy()
                // and requires core:window:allow-destroy ACL permission).
                // Instead, exit the process directly from Rust.
                api.prevent_close();
                std::process::exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stronghold_key_derivation_deterministic() {
        let key1 = derive_stronghold_key("test-password");
        let key2 = derive_stronghold_key("test-password");
        assert_eq!(key1, key2, "Same password should produce same key");
    }

    #[test]
    fn test_stronghold_key_derivation_output_length() {
        let key = derive_stronghold_key("any-password");
        assert_eq!(key.len(), 32, "Key should be 32 bytes for encryption");
    }

    #[test]
    fn test_stronghold_key_derivation_different_passwords() {
        let key1 = derive_stronghold_key("password1");
        let key2 = derive_stronghold_key("password2");
        assert_ne!(
            key1, key2,
            "Different passwords should produce different keys"
        );
    }

    #[test]
    fn test_stronghold_salt_length() {
        assert_eq!(STRONGHOLD_SALT.len(), 16, "Salt should be 16 bytes");
    }

    #[test]
    fn test_stronghold_key_derivation_empty_password() {
        // Empty password should still work (even if not recommended)
        let key = derive_stronghold_key("");
        assert_eq!(key.len(), 32);
    }
}
