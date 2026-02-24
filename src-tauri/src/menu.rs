use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};

/// Create the application menu.
///
/// Items that require application state (workspace selected, session selected, etc.)
/// start disabled. The frontend enables them dynamically via the `update_menu_state` command.
pub fn create_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    // 1. App menu (macOS shows as the app name; on other platforms it's a regular menu)
    let mut app_menu_builder = SubmenuBuilder::new(app, "ChatML")
        .item(&PredefinedMenuItem::about(app, Some("About ChatML"), None)?)
        .separator()
        .item(&MenuItemBuilder::with_id("check_for_updates", "Check for Updates...").build(app)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("settings", "Settings...")
                .accelerator("CmdOrCtrl+,")
                .build(app)?,
        )
        .separator();

    // Hide/Show All are macOS-specific window management
    #[cfg(target_os = "macos")]
    {
        app_menu_builder = app_menu_builder
            .item(&PredefinedMenuItem::hide(app, Some("Hide ChatML"))?)
            .item(&PredefinedMenuItem::hide_others(app, Some("Hide Others"))?)
            .item(&PredefinedMenuItem::show_all(app, Some("Show All"))?)
            .separator();
    }

    let app_menu = app_menu_builder
        .item(&PredefinedMenuItem::quit(app, Some("Quit ChatML"))?)
        .build()?;

    // 2. File menu
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(
            &MenuItemBuilder::with_id("new_session", "New Session")
                .accelerator("CmdOrCtrl+N")
                .enabled(false)
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("new_conversation", "New Conversation")
                .accelerator("CmdOrCtrl+Shift+N")
                .enabled(false)
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("create_from_pr", "New Session from PR/Branch...")
                .accelerator("CmdOrCtrl+Shift+O")
                .enabled(false)
                .build(app)?,
        )
        .separator()
        .item(&MenuItemBuilder::with_id("add_workspace", "Add Repository...").build(app)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("save_file", "Save")
                .accelerator("CmdOrCtrl+S")
                .enabled(false)
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("close_tab", "Close Tab")
                .accelerator("CmdOrCtrl+W")
                .enabled(false)
                .build(app)?,
        )
        .item(&PredefinedMenuItem::close_window(
            app,
            Some("Close Window"),
        )?)
        .build()?;

    // 3. Edit menu with Find submenu
    let find_submenu = SubmenuBuilder::new(app, "Find")
        .item(
            &MenuItemBuilder::with_id("find", "Find...")
                .accelerator("CmdOrCtrl+F")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("find_next", "Find Next")
                .accelerator("CmdOrCtrl+G")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("find_previous", "Find Previous")
                .accelerator("CmdOrCtrl+Shift+G")
                .build(app)?,
        )
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .separator()
        .item(&find_submenu)
        .build()?;

    // 4. View menu
    let view_menu = SubmenuBuilder::new(app, "View")
        .item(
            &MenuItemBuilder::with_id("toggle_left_sidebar", "Left Sidebar")
                .accelerator("CmdOrCtrl+B")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("toggle_right_sidebar", "Right Sidebar")
                .accelerator("CmdOrCtrl+Alt+B")
                .enabled(false)
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("toggle_terminal", "Terminal")
                .accelerator("Ctrl+`")
                .enabled(false)
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("next_tab", "Next Tab")
                .accelerator("CmdOrCtrl+Alt+]")
                .enabled(false)
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("previous_tab", "Previous Tab")
                .accelerator("CmdOrCtrl+Alt+[")
                .enabled(false)
                .build(app)?,
        )
        .separator()
        .item(&MenuItemBuilder::with_id("command_palette", "Command Palette").build(app)?)
        .item(
            &MenuItemBuilder::with_id("file_picker", "File Picker")
                .accelerator("CmdOrCtrl+P")
                .enabled(false)
                .build(app)?,
        )
        .separator()
        .item(&MenuItemBuilder::with_id("open_session_manager", "Session Manager").build(app)?)
        .item(&MenuItemBuilder::with_id("open_pr_dashboard", "PR Dashboard").build(app)?)
        .item(&MenuItemBuilder::with_id("open_repositories", "Repositories").build(app)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("toggle_zen_mode", "Zen Mode")
                .accelerator("CmdOrCtrl+.")
                .enabled(false)
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("reset_layouts", "Reset Panel Layouts")
                .accelerator("CmdOrCtrl+Shift+R")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("enter_full_screen", "Enter Full Screen")
                .accelerator("Ctrl+Super+F")
                .build(app)?,
        )
        .build()?;

    // 5. Go menu
    let go_menu = SubmenuBuilder::new(app, "Go")
        .item(
            &MenuItemBuilder::with_id("navigate_back", "Back")
                .accelerator("CmdOrCtrl+[")
                .enabled(false)
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("navigate_forward", "Forward")
                .accelerator("CmdOrCtrl+]")
                .enabled(false)
                .build(app)?,
        )
        .separator()
        .item(&MenuItemBuilder::with_id("go_to_workspace", "Go to Workspace...").build(app)?)
        .item(
            &MenuItemBuilder::with_id("go_to_session", "Go to Session...")
                .enabled(false)
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("go_to_conversation", "Go to Conversation...")
                .enabled(false)
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("search_workspaces", "Search Workspaces")
                .accelerator("CmdOrCtrl+Shift+F")
                .build(app)?,
        )
        .build()?;

    // 6. Session menu with Thinking Level submenu
    // All session items start disabled - enabled when a session is selected
    let thinking_submenu = SubmenuBuilder::new(app, "Thinking Level")
        .item(
            &MenuItemBuilder::with_id("thinking_off", "Off")
                .enabled(false)
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("thinking_low", "Low")
                .enabled(false)
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("thinking_medium", "Medium")
                .enabled(false)
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("thinking_high", "High")
                .enabled(false)
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("thinking_max", "Max")
                .enabled(false)
                .build(app)?,
        )
        .build()?;

    let session_menu = SubmenuBuilder::new(app, "Session")
        .item(&thinking_submenu)
        .item(
            &MenuItemBuilder::with_id("toggle_plan_mode", "Plan Mode")
                .enabled(false)
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("approve_plan", "Approve Plan")
                .enabled(false)
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("focus_input", "Focus Chat Input")
                .accelerator("CmdOrCtrl+L")
                .enabled(false)
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("quick_review", "Quick Review")
                .enabled(false)
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("deep_review", "Deep Review")
                .enabled(false)
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("security_audit", "Security Audit")
                .enabled(false)
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("open_in_vscode", "Open in VS Code")
                .enabled(false)
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("open_terminal", "Open in Terminal")
                .enabled(false)
                .build(app)?,
        )
        .build()?;

    // 7. Git menu - all items start disabled
    let git_menu = SubmenuBuilder::new(app, "Git")
        .item(
            &MenuItemBuilder::with_id("git_commit", "Commit Changes...")
                .enabled(false)
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("git_create_pr", "Create Pull Request...")
                .enabled(false)
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("git_sync", "Sync with Main")
                .enabled(false)
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("git_copy_branch", "Copy Branch Name")
                .enabled(false)
                .build(app)?,
        )
        .build()?;

    // 8. Window menu
    let mut window_menu_builder = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, Some("Zoom"))?);

    // "Bring All to Front" is a macOS-specific concept
    #[cfg(target_os = "macos")]
    {
        window_menu_builder = window_menu_builder.separator().item(
            &MenuItemBuilder::with_id("bring_all_to_front", "Bring All to Front").build(app)?,
        );
    }

    let window_menu = window_menu_builder.build()?;

    // 9. Help menu
    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&MenuItemBuilder::with_id("help", "ChatML Help").build(app)?)
        .item(
            &MenuItemBuilder::with_id("keyboard_shortcuts", "Keyboard Shortcuts")
                .accelerator("CmdOrCtrl+/")
                .build(app)?,
        )
        .separator()
        .item(&MenuItemBuilder::with_id("release_notes", "Release Notes").build(app)?)
        .item(&MenuItemBuilder::with_id("report_issue", "Report an Issue...").build(app)?)
        .build()?;

    // Build the full menu bar
    let menu = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&go_menu)
        .item(&session_menu)
        .item(&git_menu)
        .item(&window_menu)
        .item(&help_menu)
        .build()?;

    Ok(menu)
}
