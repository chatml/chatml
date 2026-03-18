import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';

// ---- Mocks ----

vi.mock('@/lib/tauri', () => ({
  sendNotification: vi.fn().mockResolvedValue(undefined),
  isTauri: vi.fn().mockReturnValue(true),
}));

import { sendNotification } from '@/lib/tauri';
import { notifyDesktop, getConversationLabel, useDesktopNotifications } from '../useDesktopNotifications';

const mockedSendNotification = vi.mocked(sendNotification);

// Incrementing base time to avoid cross-test debounce collisions.
// The module-level debounceMap persists between tests, so each test
// needs a time that is >5s from any previous test's timestamp.
let testTimeOffset = 0;

// Test data factories
function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    workspaceId: 'ws-1',
    name: 'fix/auth-bug',
    branch: 'fix/auth-bug',
    worktreePath: '/tmp/worktrees/fix-auth-bug',
    status: 'active' as const,
    priority: 'normal' as const,
    taskStatus: 'in_progress' as const,
    ...overrides,
  };
}

function makeConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conv-1',
    sessionId: 'session-1',
    type: 'task' as const,
    name: 'Fix authentication flow',
    status: 'completed' as const,
    messages: [],
    toolSummary: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('notifyDesktop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    useSettingsStore.setState({ desktopNotifications: true });
    // Advance well past any previous test's debounce window
    testTimeOffset += 10_000;
    vi.setSystemTime(new Date(1_700_000_000_000 + testTimeOffset));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends a notification when enabled and window is not focused', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);

    notifyDesktop('conv-1', 'Task completed', 'Fix auth flow');

    expect(mockedSendNotification).toHaveBeenCalledWith('Task completed', 'Fix auth flow');
  });

  it('does not send a notification when desktop notifications are disabled', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    useSettingsStore.setState({ desktopNotifications: false });

    notifyDesktop('conv-1', 'Task completed', 'Fix auth flow');

    expect(mockedSendNotification).not.toHaveBeenCalled();
  });

  it('does not send a notification when the window is focused', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);

    notifyDesktop('conv-1', 'Task completed', 'Fix auth flow');

    expect(mockedSendNotification).not.toHaveBeenCalled();
  });

  it('debounces notifications for the same conversation within 5 seconds', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);

    notifyDesktop('debounce-conv', 'Task completed', 'First');
    expect(mockedSendNotification).toHaveBeenCalledTimes(1);

    // Try again immediately — should be debounced
    notifyDesktop('debounce-conv', 'Task completed', 'Second');
    expect(mockedSendNotification).toHaveBeenCalledTimes(1);

    // Advance past debounce window
    vi.advanceTimersByTime(5001);

    notifyDesktop('debounce-conv', 'Task completed', 'Third');
    expect(mockedSendNotification).toHaveBeenCalledTimes(2);
  });

  it('allows notifications for different conversations simultaneously', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);

    notifyDesktop('multi-conv-a', 'Task completed', 'First conv');
    notifyDesktop('multi-conv-b', 'Task completed', 'Second conv');

    expect(mockedSendNotification).toHaveBeenCalledTimes(2);
  });
});

describe('getConversationLabel', () => {
  beforeEach(() => {
    useAppStore.setState({
      sessions: [makeSession()],
      conversations: [makeConversation()],
    });
  });

  it('returns the conversation name when available', () => {
    expect(getConversationLabel('conv-1')).toBe('Fix authentication flow');
  });

  it('falls back to session name when conversation has no name', () => {
    useAppStore.setState({
      conversations: [makeConversation({ name: '' })],
    });

    expect(getConversationLabel('conv-1')).toBe('fix/auth-bug');
  });

  it('returns empty string for unknown conversation', () => {
    expect(getConversationLabel('nonexistent')).toBe('');
  });
});

describe('useDesktopNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Advance well past any previous test's debounce window
    testTimeOffset += 10_000;
    vi.setSystemTime(new Date(1_700_000_000_000 + testTimeOffset));

    useSettingsStore.setState({
      desktopNotifications: true,
      collapsedWorkspaces: [],
      contentView: { type: 'conversation' },
    });

    useAppStore.setState({
      sessions: [makeSession()],
      conversations: [makeConversation()],
      selectedSessionId: null,
      selectedConversationId: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('navigates to conversation when window is focused within 1 second of notification', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);

    const { unmount } = renderHook(() => useDesktopNotifications());

    notifyDesktop('conv-1', 'Task completed', 'Fix auth');

    // Simulate window gaining focus within 1 second (e.g. clicking notification)
    vi.advanceTimersByTime(500);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    const state = useAppStore.getState();
    expect(state.selectedSessionId).toBe('session-1');
    expect(state.selectedConversationId).toBe('conv-1');

    unmount();
  });

  it('does not navigate if focus happens after 1 second (casual alt-tab)', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);

    const { unmount } = renderHook(() => useDesktopNotifications());

    notifyDesktop('conv-1', 'Task completed', 'Fix auth');

    // Focus after the 1-second window (e.g. user alt-tabbed back)
    vi.advanceTimersByTime(1500);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    const state = useAppStore.getState();
    expect(state.selectedConversationId).toBeNull();

    unmount();
  });

  it('does not navigate when there is no recent notification', () => {
    const { unmount } = renderHook(() => useDesktopNotifications());

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    const state = useAppStore.getState();
    expect(state.selectedConversationId).toBeNull();

    unmount();
  });

  it('expands a collapsed workspace when navigating', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    useSettingsStore.setState({ collapsedWorkspaces: ['ws-1'] });

    const { unmount } = renderHook(() => useDesktopNotifications());

    notifyDesktop('conv-1', 'Task completed', 'Fix auth');

    vi.advanceTimersByTime(500);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(useSettingsStore.getState().collapsedWorkspaces).not.toContain('ws-1');

    unmount();
  });

  it('switches to conversation view if on a different view', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    useSettingsStore.setState({ contentView: { type: 'repositories' } });

    const { unmount } = renderHook(() => useDesktopNotifications());

    notifyDesktop('conv-1', 'Task completed', 'Fix auth');

    vi.advanceTimersByTime(500);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(useSettingsStore.getState().contentView).toEqual({ type: 'conversation' });

    unmount();
  });

  it('cleans up the focus event listener on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => useDesktopNotifications());
    unmount();

    expect(removeSpy).toHaveBeenCalledWith('focus', expect.any(Function));
    removeSpy.mockRestore();
  });
});
