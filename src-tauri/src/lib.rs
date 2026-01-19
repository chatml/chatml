use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{
    image::Image,
    menu::{Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState},
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;
#[cfg(target_os = "macos")]
use tauri_plugin_decorum::WebviewWindowExt;

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

// Global state for tracking if the app is fully initialized
static APP_READY: AtomicBool = AtomicBool::new(false);
// Global state for minimize-to-tray setting
static MINIMIZE_TO_TRAY: AtomicBool = AtomicBool::new(false);

use std::sync::Mutex;
use std::process::Command;

// Global state for sidecar process management
static SIDECAR_PID: Mutex<Option<u32>> = Mutex::new(None);

/// Kill any existing process on port 9876
fn kill_process_on_port(port: u16) {
    // Use lsof to find process holding the port (macOS/Linux)
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
fn kill_stored_sidecar() {
    if let Ok(mut pid_guard) = SIDECAR_PID.lock() {
        if let Some(pid) = pid_guard.take() {
            log::info!("Killing stored sidecar process: PID {}", pid);
            #[cfg(unix)]
            {
                // Send SIGTERM first for graceful shutdown
                let _ = Command::new("kill").args(["-15", &pid.to_string()]).output();
                // Wait a bit for graceful shutdown
                std::thread::sleep(Duration::from_millis(500));
                // Force kill if still running
                let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
            }
        }
    }
}

fn create_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    // App menu (macOS only shows this as the app name)
    let app_menu = SubmenuBuilder::new(app, "ChatML")
        .item(&PredefinedMenuItem::about(app, Some("About ChatML"), None)?)
        .separator()
        .item(&MenuItemBuilder::with_id("settings", "Settings...")
            .accelerator("CmdOrCtrl+,")
            .build(app)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some("Hide ChatML"))?)
        .item(&PredefinedMenuItem::hide_others(app, Some("Hide Others"))?)
        .item(&PredefinedMenuItem::show_all(app, Some("Show All"))?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some("Quit ChatML"))?)
        .build()?;

    // File menu
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&MenuItemBuilder::with_id("new_session", "New Session")
            .accelerator("CmdOrCtrl+N")
            .build(app)?)
        .item(&MenuItemBuilder::with_id("new_conversation", "New Conversation")
            .accelerator("CmdOrCtrl+Shift+N")
            .build(app)?)
        .item(&MenuItemBuilder::with_id("add_workspace", "Add Workspace...")
            .accelerator("CmdOrCtrl+O")
            .build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("close_tab", "Close Tab")
            .accelerator("CmdOrCtrl+W")
            .build(app)?)
        .item(&PredefinedMenuItem::close_window(app, Some("Close Window"))?)
        .build()?;

    // Edit menu
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;

    // View menu
    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&MenuItemBuilder::with_id("toggle_left_sidebar", "Toggle Left Sidebar")
            .accelerator("CmdOrCtrl+B")
            .build(app)?)
        .item(&MenuItemBuilder::with_id("toggle_right_sidebar", "Toggle Right Sidebar")
            .accelerator("CmdOrCtrl+Alt+B")
            .build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("toggle_thinking", "Toggle Thinking Mode")
            .accelerator("Alt+T")
            .build(app)?)
        .item(&MenuItemBuilder::with_id("toggle_plan_mode", "Toggle Plan Mode")
            .accelerator("Shift+Tab")
            .build(app)?)
        .item(&MenuItemBuilder::with_id("focus_input", "Focus Input")
            .accelerator("CmdOrCtrl+L")
            .build(app)?)
        .build()?;

    // Window menu
    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .separator()
        .item(&MenuItemBuilder::with_id("bring_all_to_front", "Bring All to Front")
            .build(app)?)
        .build()?;

    // Help menu
    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&MenuItemBuilder::with_id("help", "ChatML Help")
            .build(app)?)
        .build()?;

    // Build the full menu
    let menu = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu)
        .item(&help_menu)
        .build()?;

    Ok(menu)
}

/// Spawn the sidecar and set up monitoring
fn spawn_sidecar(app: &tauri::AppHandle) -> Result<CommandChild, String> {
    // Clean up any existing processes before spawning
    kill_stored_sidecar();
    kill_process_on_port(9876);

    // Small delay to ensure port is released
    std::thread::sleep(Duration::from_millis(200));

    let sidecar_command = app
        .shell()
        .sidecar("chatml-backend")
        .map_err(|e| format!("Failed to create sidecar command: {}", e))?;

    let (mut rx, child) = sidecar_command
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

    // Store the PID for later cleanup
    if let Ok(mut pid_guard) = SIDECAR_PID.lock() {
        *pid_guard = Some(child.pid());
        log::info!("Stored sidecar PID: {}", child.pid());
    }

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
                        let _ = window.emit("sidecar-stderr", line_str.to_string());
                    }
                }
                CommandEvent::Error(err) => {
                    log::error!("[sidecar error] {}", err);
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.emit("sidecar-error", err.clone());
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
                        let _ = window.emit("sidecar-terminated", payload.code);
                    }
                }
                _ => {}
            }
        }
    });

    log::info!("ChatML backend sidecar started successfully");
    Ok(child)
}

// Tauri command to mark app as ready (called from frontend when connected)
#[tauri::command]
fn mark_app_ready() {
    APP_READY.store(true, Ordering::SeqCst);
    log::info!("App marked as ready");
}

// Tauri command to restart the sidecar
#[tauri::command]
fn restart_sidecar(app: tauri::AppHandle) -> Result<(), String> {
    log::info!("Restarting sidecar...");

    // Clean up existing sidecar process
    kill_stored_sidecar();
    kill_process_on_port(9876);

    // Longer delay to ensure port is fully released and resources cleaned up
    std::thread::sleep(Duration::from_millis(1500));

    // Spawn new sidecar (this will also do cleanup but the process should already be gone)
    spawn_sidecar(&app)?;

    Ok(())
}

// Tauri command to set minimize-to-tray preference
#[tauri::command]
fn set_minimize_to_tray(enabled: bool) {
    MINIMIZE_TO_TRAY.store(enabled, Ordering::SeqCst);
    log::info!("Minimize to tray set to: {}", enabled);
}

// Tauri command to check if window is visible
#[tauri::command]
fn is_window_visible(app: tauri::AppHandle) -> bool {
    if let Some(window) = app.get_webview_window("main") {
        window.is_visible().unwrap_or(false)
    } else {
        false
    }
}

// Tauri command to close splash screen and show main window
// Currently a no-op since splash is handled by the frontend loading state
#[tauri::command]
fn close_splash(_app: tauri::AppHandle) {
    // Splash screen is now handled by the frontend BackendStatus component
    // This command is kept for API compatibility
    log::info!("close_splash called (no-op)");
}

/// Create the system tray with menu
fn create_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let show_hide = MenuItemBuilder::with_id("show_hide", "Show/Hide").build(app)?;
    let new_session = MenuItemBuilder::with_id("tray_new_session", "New Session").build(app)?;
    let quit = MenuItemBuilder::with_id("tray_quit", "Quit ChatML").build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&show_hide)
        .item(&new_session)
        .separator()
        .item(&quit)
        .build()?;

    // Load icon from embedded bytes (32x32 PNG)
    let icon_bytes = include_bytes!("../icons/32x32.png");
    let icon = Image::from_bytes(icon_bytes)?;

    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .menu(&menu)
        .tooltip("ChatML")
        .on_menu_event(move |app, event| {
            match event.id().as_ref() {
                "show_hide" => {
                    if let Some(window) = app.get_webview_window("main") {
                        if window.is_visible().unwrap_or(false) {
                            let _ = window.hide();
                        } else {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                }
                "tray_new_session" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                        let _ = window.emit("menu-event", "new_session");
                    }
                }
                "tray_quit" => {
                    std::process::exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize Sentry before anything else
    let _sentry_guard = init_sentry();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Focus the main window when a second instance tries to launch
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_pty::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_decorum::init())
        .plugin(tauri_plugin_window_state::Builder::new()
            .with_state_flags(tauri_plugin_window_state::StateFlags::all())
            .build())
        .invoke_handler(tauri::generate_handler![mark_app_ready, restart_sidecar, set_minimize_to_tray, is_window_visible, close_splash])
        .setup(|app| {
            // Create and set the menu
            let menu = create_menu(app.handle())?;
            app.set_menu(menu)?;

            // Set macOS traffic light position
            #[cfg(target_os = "macos")]
            {
                let main_window = app.get_webview_window("main").unwrap();
                main_window.set_traffic_lights_inset(16.0, 16.0).unwrap();
            }

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Debug)
                        .build(),
                )?;
            }

            // Create the system tray
            if let Err(e) = create_tray(app.handle()) {
                log::error!("Failed to create system tray: {}", e);
            }

            // Spawn the Go backend sidecar with proper error handling
            match spawn_sidecar(app.handle()) {
                Ok(_child) => {
                    // Note: child is moved into the spawn_sidecar function's monitoring task
                    log::info!("Sidecar spawn initiated");
                }
                Err(e) => {
                    log::error!("Failed to spawn sidecar: {}", e);
                    // Emit error to frontend
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("sidecar-error", e);
                    }
                }
            }

            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if let Some(window) = app.get_webview_window("main") {
                // Emit menu events to the frontend
                let _ = window.emit("menu-event", id);
            }
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // If app is not ready (still in startup), allow immediate close
                if !APP_READY.load(Ordering::SeqCst) {
                    log::info!("Window close during startup - allowing immediate close");
                    return; // Don't prevent close
                }

                // If minimize-to-tray is enabled, hide the window instead of closing
                if MINIMIZE_TO_TRAY.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                    log::info!("Window hidden to tray");
                    return;
                }

                // App is ready - prevent close and let frontend handle confirmation
                api.prevent_close();
                let _ = window.emit("window-close-requested", ());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
