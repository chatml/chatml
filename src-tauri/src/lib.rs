use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;
#[cfg(target_os = "macos")]
use tauri_plugin_decorum::WebviewWindowExt;

// Global state for tracking if the app is fully initialized
static APP_READY: AtomicBool = AtomicBool::new(false);

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
    let sidecar_command = app
        .shell()
        .sidecar("chatml-backend")
        .map_err(|e| format!("Failed to create sidecar command: {}", e))?;

    let (mut rx, child) = sidecar_command
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar: {}", e))?;

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

    // Small delay to allow any cleanup
    std::thread::sleep(Duration::from_millis(500));

    // Spawn new sidecar
    spawn_sidecar(&app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Focus the main window when a second instance tries to launch
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_decorum::init())
        .plugin(tauri_plugin_window_state::Builder::new()
            .with_state_flags(tauri_plugin_window_state::StateFlags::all())
            .build())
        .invoke_handler(tauri::generate_handler![mark_app_ready, restart_sidecar])
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

                // App is ready - prevent close and let frontend handle confirmation
                api.prevent_close();
                let _ = window.emit("window-close-requested", ());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
