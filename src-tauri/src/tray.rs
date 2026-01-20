use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};

/// Create the system tray with menu
pub fn create_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
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
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "show_hide" => {
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        if let Err(e) = window.hide() {
                            log::warn!("Failed to hide window: {}", e);
                        }
                    } else {
                        if let Err(e) = window.show() {
                            log::warn!("Failed to show window: {}", e);
                        }
                        if let Err(e) = window.set_focus() {
                            log::warn!("Failed to focus window: {}", e);
                        }
                    }
                }
            }
            "tray_new_session" => {
                if let Some(window) = app.get_webview_window("main") {
                    if let Err(e) = window.show() {
                        log::warn!("Failed to show window: {}", e);
                    }
                    if let Err(e) = window.set_focus() {
                        log::warn!("Failed to focus window: {}", e);
                    }
                    if let Err(e) = window.emit("menu-event", "new_session") {
                        log::warn!("Failed to emit menu event: {}", e);
                    }
                }
            }
            "tray_quit" => {
                std::process::exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    if let Err(e) = window.show() {
                        log::warn!("Failed to show window from tray click: {}", e);
                    }
                    if let Err(e) = window.set_focus() {
                        log::warn!("Failed to focus window from tray click: {}", e);
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}
