/// Apply SF Symbol icons to native macOS menu items after Tauri builds the menu.
///
/// This post-processes the NSMenu tree set by Tauri, adding SF Symbol images
/// directly on NSMenuItems. Using native NSImage (not RGBA conversion) preserves
/// template image behavior — icons automatically adapt to dark mode, disabled
/// state, and hover highlighting.
#[cfg(target_os = "macos")]
pub fn apply_sf_symbols_to_menu() {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSApplication;
    use objc2_foundation::NSProcessInfo;

    let Some(mtm) = MainThreadMarker::new() else {
        log::warn!("apply_sf_symbols_to_menu must be called from the main thread");
        return;
    };

    // SF Symbols require macOS 11+ (NSProcessInfo is thread-safe, but we
    // acquire the MainThreadMarker first so subsequent calls are protected)
    let version = NSProcessInfo::processInfo().operatingSystemVersion();
    if version.majorVersion < 11 {
        log::info!("SF Symbols require macOS 11+, skipping menu icons");
        return;
    }

    let app = NSApplication::sharedApplication(mtm);
    let Some(main_menu) = app.mainMenu() else {
        log::warn!("No main menu found");
        return;
    };

    // Walk each top-level submenu
    for item in main_menu.itemArray().to_vec() {
        if let Some(submenu) = item.submenu() {
            let menu_title = submenu.title().to_string();
            apply_symbols_to_submenu(&submenu, &menu_title);
        }
    }
}

#[cfg(target_os = "macos")]
fn apply_symbols_to_submenu(menu: &objc2_app_kit::NSMenu, menu_title: &str) {
    for item in menu.itemArray().to_vec() {
        if item.isSeparatorItem() {
            continue;
        }

        let item_title = item.title().to_string();

        // Recurse into submenus
        if let Some(submenu) = item.submenu() {
            let sub_title = submenu.title().to_string();
            // Set icon on the submenu parent item itself
            if let Some(symbol) = lookup_symbol(menu_title, &item_title) {
                set_sf_symbol(&item, symbol);
            }
            apply_symbols_to_submenu(&submenu, &sub_title);
            continue;
        }

        if let Some(symbol) = lookup_symbol(menu_title, &item_title) {
            set_sf_symbol(&item, symbol);
        }
    }
}

#[cfg(target_os = "macos")]
fn set_sf_symbol(item: &objc2_app_kit::NSMenuItem, symbol_name: &str) {
    use objc2_app_kit::NSImage;
    use objc2_foundation::NSString;

    let name = NSString::from_str(symbol_name);
    if let Some(image) = NSImage::imageWithSystemSymbolName_accessibilityDescription(&name, None) {
        item.setImage(Some(&image));
    } else {
        log::debug!("SF Symbol not found: {}", symbol_name);
    }
}

/// Look up the SF Symbol name for a menu item by (menu_title, item_title).
///
/// KEEP IN SYNC WITH menu.rs — title strings must match exactly.
/// All symbols must be available on macOS 11+ (SF Symbols 2).
#[cfg(target_os = "macos")]
fn lookup_symbol(menu_title: &str, item_title: &str) -> Option<&'static str> {
    match (menu_title, item_title) {
        // ── App Menu ──
        ("ChatML", "Check for Updates...") => Some("arrow.triangle.2.circlepath"),
        ("ChatML", "Settings...") => Some("gearshape"),

        // ── File Menu ──
        ("File", "New Session") => Some("plus"),
        ("File", "New Conversation") => Some("plus.bubble"),
        ("File", "Create Session from...") => Some("doc.badge.plus"),
        ("File", "Add Repository...") => Some("folder.badge.plus"),
        ("File", "Save") => Some("square.and.arrow.down"),
        ("File", "Close Tab") => Some("xmark"),

        // ── Edit Menu ──
        ("Edit", "Undo") => Some("arrow.uturn.backward"),
        ("Edit", "Redo") => Some("arrow.uturn.forward"),
        ("Edit", "Cut") => Some("scissors"),
        ("Edit", "Copy") => Some("doc.on.doc"),
        ("Edit", "Paste") => Some("doc.on.clipboard"),
        ("Edit", "Select All") => Some("checkmark.rectangle"),
        ("Edit", "Find") => Some("magnifyingglass"), // submenu parent

        // ── Edit > Find Submenu ──
        ("Find", "Find...") => Some("magnifyingglass"),
        ("Find", "Find Next") => Some("chevron.down"),
        ("Find", "Find Previous") => Some("chevron.up"),

        // ── View Menu ──
        ("View", "Left Sidebar") => Some("sidebar.left"),
        ("View", "Right Sidebar") => Some("sidebar.right"),
        ("View", "Terminal") => Some("terminal"),
        ("View", "Next Tab") => Some("chevron.right"),
        ("View", "Previous Tab") => Some("chevron.left"),
        ("View", "Command Palette") => Some("command"),
        ("View", "File Picker") => Some("doc.text.magnifyingglass"),
        ("View", "Session Manager") => Some("list.bullet.rectangle"),
        ("View", "Repositories") => Some("folder"),
        ("View", "Zen Mode") => Some("eye"),
        ("View", "Reset Panel Layouts") => Some("rectangle.3.group"),
        ("View", "Enter Full Screen") => Some("arrow.up.backward.and.arrow.down.forward"),

        // ── Go Menu ──
        ("Go", "Back") => Some("chevron.left"),
        ("Go", "Forward") => Some("chevron.right"),
        ("Go", "Go to Workspace...") => Some("folder"),
        ("Go", "Go to Session...") => Some("bubble.left"),
        ("Go", "Go to Conversation...") => Some("text.bubble"),
        ("Go", "Search Workspaces") => Some("magnifyingglass"),

        // ── Session Menu ──
        ("Session", "Thinking Level") => Some("brain"), // submenu parent
        ("Session", "Plan Mode") => Some("map"),
        ("Session", "Approve Plan") => Some("checkmark.circle"),
        ("Session", "Focus Chat Input") => Some("text.cursor"),
        ("Session", "Review") => Some("eye"), // submenu parent
        ("Session", "Open in VS Code") => Some("arrow.up.forward.app"),
        ("Session", "Open in Terminal") => Some("terminal"),

        // ── Session > Thinking Level Submenu (all symbols macOS 11+) ──
        ("Thinking Level", "Off") => Some("circle.slash"),
        ("Thinking Level", "Low") => Some("sparkle"),
        ("Thinking Level", "Medium") => Some("sparkles"),
        ("Thinking Level", "High") => Some("brain"),
        ("Thinking Level", "Max") => Some("brain.head.profile"),

        // ── Session > Review Submenu ──
        ("Review", "Quick Scan") => Some("magnifyingglass"),
        ("Review", "Deep Review") => Some("doc.text.magnifyingglass"),
        ("Review", "Security Audit") => Some("lock.shield"),
        ("Review", "Performance") => Some("speedometer"),
        ("Review", "Architecture") => Some("square.stack.3d.up"),
        ("Review", "Pre-merge Check") => Some("checkmark.shield"),

        // ── Git Menu ──
        ("Git", "Commit Changes...") => Some("checkmark.circle"),
        ("Git", "Create Pull Request...") => Some("arrow.triangle.branch"),
        ("Git", "Sync with Main") => Some("arrow.triangle.2.circlepath"),
        ("Git", "Copy Branch Name") => Some("doc.on.doc"),

        // ── Window Menu ──
        ("Window", "Minimize") => Some("minus.square"),
        ("Window", "Zoom") => Some("arrow.up.left.and.arrow.down.right"),
        ("Window", "Bring All to Front") => Some("rectangle.stack"),

        // ── Help Menu ──
        ("Help", "ChatML Help") => Some("questionmark.circle"),
        ("Help", "Keyboard Shortcuts") => Some("keyboard"),
        ("Help", "Release Notes") => Some("sparkles"),
        ("Help", "Report an Issue...") => Some("exclamationmark.bubble"),

        _ => None,
    }
}

// No-op on non-macOS platforms
#[cfg(not(target_os = "macos"))]
pub fn apply_sf_symbols_to_menu() {}
