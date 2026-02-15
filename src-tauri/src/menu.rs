use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};

/// Create the application menu
pub fn create_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    // 1. App menu (macOS only shows this as the app name)
    let app_menu = SubmenuBuilder::new(app, "ChatML")
        .item(&PredefinedMenuItem::about(app, Some("About ChatML"), None)?)
        .separator()
        .item(&MenuItemBuilder::with_id("check_for_updates", "Check for Updates...").build(app)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("settings", "Settings...")
                .accelerator("CmdOrCtrl+,")
                .build(app)?,
        )
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some("Hide ChatML"))?)
        .item(&PredefinedMenuItem::hide_others(app, Some("Hide Others"))?)
        .item(&PredefinedMenuItem::show_all(app, Some("Show All"))?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some("Quit ChatML"))?)
        .build()?;

    // 2. File menu
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(
            &MenuItemBuilder::with_id("new_session", "New Session")
                .accelerator("CmdOrCtrl+N")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("new_conversation", "New Conversation")
                .accelerator("CmdOrCtrl+Shift+N")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("create_from_pr", "New Session from PR/Branch...")
                .accelerator("CmdOrCtrl+Shift+O")
                .build(app)?,
        )
        .separator()
        .item(&MenuItemBuilder::with_id("add_workspace", "Add Repository...").build(app)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("save_file", "Save")
                .accelerator("CmdOrCtrl+S")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("close_tab", "Close Tab")
                .accelerator("CmdOrCtrl+W")
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
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("toggle_terminal", "Terminal")
                .accelerator("Ctrl+`")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("next_tab", "Next Tab")
                .accelerator("CmdOrCtrl+Alt+]")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("previous_tab", "Previous Tab")
                .accelerator("CmdOrCtrl+Alt+[")
                .build(app)?,
        )
        .separator()
        .item(&MenuItemBuilder::with_id("command_palette", "Command Palette").build(app)?)
        .item(
            &MenuItemBuilder::with_id("file_picker", "File Picker")
                .accelerator("CmdOrCtrl+P")
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
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("navigate_forward", "Forward")
                .accelerator("CmdOrCtrl+]")
                .build(app)?,
        )
        .separator()
        .item(&MenuItemBuilder::with_id("go_to_workspace", "Go to Workspace...").build(app)?)
        .item(&MenuItemBuilder::with_id("go_to_session", "Go to Session...").build(app)?)
        .item(&MenuItemBuilder::with_id("go_to_conversation", "Go to Conversation...").build(app)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("search_workspaces", "Search Workspaces")
                .accelerator("CmdOrCtrl+Shift+F")
                .build(app)?,
        )
        .build()?;

    // 6. Session menu with Thinking Level submenu
    let thinking_submenu = SubmenuBuilder::new(app, "Thinking Level")
        .item(&MenuItemBuilder::with_id("thinking_off", "Off").build(app)?)
        .item(&MenuItemBuilder::with_id("thinking_low", "Low").build(app)?)
        .item(&MenuItemBuilder::with_id("thinking_medium", "Medium").build(app)?)
        .item(&MenuItemBuilder::with_id("thinking_high", "High").build(app)?)
        .item(&MenuItemBuilder::with_id("thinking_max", "Max").build(app)?)
        .build()?;

    let session_menu = SubmenuBuilder::new(app, "Session")
        .item(&thinking_submenu)
        .item(&MenuItemBuilder::with_id("toggle_plan_mode", "Plan Mode").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("approve_plan", "Approve Plan").build(app)?)
        .item(
            &MenuItemBuilder::with_id("focus_input", "Focus Chat Input")
                .accelerator("CmdOrCtrl+L")
                .build(app)?,
        )
        .separator()
        .item(&MenuItemBuilder::with_id("quick_review", "Quick Review").build(app)?)
        .item(&MenuItemBuilder::with_id("deep_review", "Deep Review").build(app)?)
        .item(&MenuItemBuilder::with_id("security_audit", "Security Audit").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("open_in_vscode", "Open in VS Code").build(app)?)
        .item(&MenuItemBuilder::with_id("open_terminal", "Open in Terminal").build(app)?)
        .build()?;

    // 7. Git menu
    let git_menu = SubmenuBuilder::new(app, "Git")
        .item(&MenuItemBuilder::with_id("git_commit", "Commit Changes...").build(app)?)
        .item(&MenuItemBuilder::with_id("git_create_pr", "Create Pull Request...").build(app)?)
        .item(&MenuItemBuilder::with_id("git_sync", "Sync with Main").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("git_copy_branch", "Copy Branch Name").build(app)?)
        .build()?;

    // 8. Window menu
    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, Some("Zoom"))?)
        .separator()
        .item(&MenuItemBuilder::with_id("bring_all_to_front", "Bring All to Front").build(app)?)
        .build()?;

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
