import type { ContentView } from '@/stores/settingsStore';

export interface MenuContextInputs {
  contentView: ContentView;
  selectedWorkspaceId: string | null;
  selectedSessionId: string | null;
  selectedConversationId: string | null;
  hasDirtyFileTabs: boolean;
  hasPendingPlanApproval: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  hasBrowserTabs: boolean;
}

/**
 * Compute the enabled/disabled state for all controllable menu items.
 * Returns a map of menu item ID -> enabled boolean.
 *
 * Only includes items we can control (MenuItemBuilder items).
 * PredefinedMenuItem items (undo, redo, cut, copy, paste, etc.) are OS-managed.
 */
export function computeMenuState(inputs: MenuContextInputs): Record<string, boolean> {
  const {
    contentView,
    selectedWorkspaceId,
    selectedSessionId,
    hasDirtyFileTabs,
    hasPendingPlanApproval,
    canGoBack,
    canGoForward,
    hasBrowserTabs,
  } = inputs;

  const hasWorkspace = selectedWorkspaceId != null;
  const hasSession = selectedSessionId != null;
  const inConversationView = contentView.type === 'conversation';
  const sessionInConversation = hasSession && inConversationView;

  return {
    // App menu - always enabled
    check_for_updates: true,
    settings: true,

    // File menu
    new_session: hasWorkspace,
    new_conversation: hasSession,
    create_session: hasWorkspace,
    add_workspace: true,
    save_file: hasDirtyFileTabs,
    close_tab: hasSession || hasBrowserTabs,

    // Edit > Find - always enabled
    find: true,
    find_next: true,
    find_previous: true,

    // View menu
    toggle_left_sidebar: true,
    toggle_right_sidebar: sessionInConversation,
    toggle_terminal: sessionInConversation,
    next_tab: hasSession,
    previous_tab: hasSession,
    command_palette: true,
    file_picker: hasSession,
    open_session_manager: true,
    open_pr_dashboard: false, // Hidden for shipping
    open_repositories: true,
    toggle_zen_mode: sessionInConversation,
    reset_layouts: true,
    enter_full_screen: true,

    // Go menu
    navigate_back: canGoBack,
    navigate_forward: canGoForward,
    go_to_workspace: true,
    go_to_session: hasWorkspace,
    go_to_conversation: hasSession,
    search_workspaces: true,

    // Session menu
    thinking_off: hasSession,
    thinking_low: hasSession,
    thinking_medium: hasSession,
    thinking_high: hasSession,
    thinking_max: hasSession,
    toggle_plan_mode: hasSession,
    approve_plan: hasSession && hasPendingPlanApproval,
    focus_input: sessionInConversation,
    quick_review: hasSession,
    deep_review: hasSession,
    security_audit: hasSession,
    open_in_vscode: hasSession,
    open_terminal: hasSession,

    // Git menu
    git_commit: hasSession,
    git_create_pr: hasSession,
    git_sync: hasSession,
    git_copy_branch: hasSession,

    // Window menu - always enabled
    bring_all_to_front: true,

    // Help menu - always enabled
    help: true,
    keyboard_shortcuts: true,
    release_notes: true,
    report_issue: true,
  };
}
