import { describe, it, expect } from 'vitest';
import { computeMenuState, type MenuContextInputs } from '../menuContext';

function makeInputs(overrides: Partial<MenuContextInputs> = {}): MenuContextInputs {
  return {
    contentView: { type: 'conversation' },
    selectedWorkspaceId: 'ws-1',
    selectedSessionId: 'session-1',
    selectedConversationId: 'conv-1',
    hasDirtyFileTabs: false,
    hasPendingPlanApproval: false,
    canGoBack: false,
    canGoForward: false,
    hasBrowserTabs: false,
    ...overrides,
  } as MenuContextInputs;
}

// ============================================================================
// Always-enabled items
// ============================================================================

describe('always-enabled items', () => {
  it('enables app-level items regardless of selection', () => {
    const result = computeMenuState(makeInputs({
      selectedWorkspaceId: null,
      selectedSessionId: null,
    }));
    expect(result.check_for_updates).toBe(true);
    expect(result.settings).toBe(true);
    expect(result.find).toBe(true);
    expect(result.command_palette).toBe(true);
    expect(result.help).toBe(true);
  });
});

// ============================================================================
// Workspace-dependent items
// ============================================================================

describe('workspace-dependent items', () => {
  it('enables workspace-dependent items when workspace selected', () => {
    const result = computeMenuState(makeInputs({ selectedWorkspaceId: 'ws-1' }));
    expect(result.new_session).toBe(true);
    expect(result.create_session).toBe(true);
    expect(result.go_to_session).toBe(true);
  });

  it('disables workspace-dependent items when no workspace', () => {
    const result = computeMenuState(makeInputs({
      selectedWorkspaceId: null,
      selectedSessionId: null,
    }));
    expect(result.new_session).toBe(false);
    expect(result.create_session).toBe(false);
    expect(result.go_to_session).toBe(false);
  });
});

// ============================================================================
// Session-dependent items
// ============================================================================

describe('session-dependent items', () => {
  it('enables session items when session is selected', () => {
    const result = computeMenuState(makeInputs());
    expect(result.new_conversation).toBe(true);
    expect(result.next_tab).toBe(true);
    expect(result.thinking_off).toBe(true);
    expect(result.git_commit).toBe(true);
    expect(result.open_in_vscode).toBe(true);
  });

  it('disables session items when no session', () => {
    const result = computeMenuState(makeInputs({
      selectedSessionId: null,
    }));
    expect(result.new_conversation).toBe(false);
    expect(result.next_tab).toBe(false);
    expect(result.thinking_off).toBe(false);
    expect(result.git_commit).toBe(false);
  });
});

// ============================================================================
// Session + conversation view items
// ============================================================================

describe('session in conversation view items', () => {
  it('enables conversation-view items in conversation view', () => {
    const result = computeMenuState(makeInputs({
      contentView: { type: 'conversation' },
    }));
    expect(result.toggle_right_sidebar).toBe(true);
    expect(result.toggle_terminal).toBe(true);
    expect(result.toggle_zen_mode).toBe(true);
    expect(result.focus_input).toBe(true);
  });

  it('disables conversation-view items in non-conversation views', () => {
    const result = computeMenuState(makeInputs({
      // @ts-expect-error -- intentionally testing non-union type
      contentView: { type: 'settings' },
    }));
    expect(result.toggle_right_sidebar).toBe(false);
    expect(result.toggle_terminal).toBe(false);
    expect(result.toggle_zen_mode).toBe(false);
    expect(result.focus_input).toBe(false);
  });
});

// ============================================================================
// Conditional items
// ============================================================================

describe('conditional items', () => {
  it('enables save_file only when dirty tabs exist', () => {
    expect(computeMenuState(makeInputs({ hasDirtyFileTabs: false })).save_file).toBe(false);
    expect(computeMenuState(makeInputs({ hasDirtyFileTabs: true })).save_file).toBe(true);
  });

  it('enables approve_plan only when session exists and plan is pending', () => {
    expect(computeMenuState(makeInputs({ hasPendingPlanApproval: false })).approve_plan).toBe(false);
    expect(computeMenuState(makeInputs({ hasPendingPlanApproval: true })).approve_plan).toBe(true);
    expect(computeMenuState(makeInputs({
      selectedSessionId: null,
      hasPendingPlanApproval: true,
    })).approve_plan).toBe(false);
  });

  it('enables navigation based on back/forward state', () => {
    expect(computeMenuState(makeInputs({ canGoBack: false })).navigate_back).toBe(false);
    expect(computeMenuState(makeInputs({ canGoBack: true })).navigate_back).toBe(true);
    expect(computeMenuState(makeInputs({ canGoForward: true })).navigate_forward).toBe(true);
  });

  it('enables close_tab when session or browser tabs exist', () => {
    expect(computeMenuState(makeInputs({
      selectedSessionId: null,
      hasBrowserTabs: false,
    })).close_tab).toBe(false);
    expect(computeMenuState(makeInputs({
      selectedSessionId: 's1',
      hasBrowserTabs: false,
    })).close_tab).toBe(true);
    expect(computeMenuState(makeInputs({
      selectedSessionId: null,
      hasBrowserTabs: true,
    })).close_tab).toBe(true);
  });
});
