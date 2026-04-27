/**
 * Tests for useMenuHandlers' custom-event surface.
 *
 * The hook has three effects:
 *   1. Tauri menu-event listener (via safeListen) — no-op in jsdom (covered by integration)
 *   2. Tauri window close handler — no-op in jsdom
 *   3. Window-level custom events ('open-settings', 'spawn-agent', etc.)
 *
 * This file exercises (3) — the custom event surface — using real Zustand stores
 * and minimal boundary mocks (Tauri APIs only). It complements `useMenuHandlers.paste.test.ts`
 * (audit F-4) which is heavier on mocks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef } from 'react';
import { useMenuHandlers } from '../useMenuHandlers';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';

// Boundary mocks: Tauri APIs only. Stores and themes use real implementations.
vi.mock('@/lib/tauri', () => ({
  safeListen: vi.fn().mockResolvedValue(() => {}),
  openInVSCode: vi.fn(),
  copyToClipboard: vi.fn(),
  openUrlInBrowser: vi.fn(),
  getCurrentWindow: vi.fn().mockResolvedValue(null),
}));

vi.mock('next-themes', () => {
  let theme = 'dark';
  return {
    useTheme: () => ({
      resolvedTheme: theme,
      setTheme: (t: string) => {
        theme = t;
      },
    }),
  };
});

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock('@/components/navigation/BrowserTabBar', () => ({
  switchToTab: vi.fn(),
}));

vi.mock('@/hooks/useClaudeAuthStatus', () => ({
  refreshClaudeAuthStatus: vi.fn(),
}));

import { openInVSCode } from '@/lib/tauri';

const defaultOptions = () => ({
  handleNewSession: vi.fn(),
  handleNewConversation: vi.fn(),
  handleCloseTab: vi.fn(),
  handleCloseFileTab: vi.fn(),
  saveCurrentTab: vi.fn(),
  toggleLeftSidebar: vi.fn(),
  toggleRightSidebar: vi.fn(),
  toggleBottomTerminal: vi.fn(),
  expandBottomTerminal: vi.fn(),
  selectNextTab: vi.fn(),
  selectPreviousTab: vi.fn(),
  setZenMode: vi.fn(),
  resetLayouts: vi.fn(),
  onOpenSettings: vi.fn(),
  onCloseSettings: vi.fn(),
  onShowAddWorkspace: vi.fn(),
  onShowCreateSession: vi.fn(),
  onShowShortcuts: vi.fn(),
  onShowBottomTerminal: vi.fn(),
});

function renderWithOptions(opts: Partial<ReturnType<typeof defaultOptions>> = {}) {
  const options = { ...defaultOptions(), ...opts };
  const { result, unmount } = renderHook(() => {
    const zenModeRef = useRef(false);
    useMenuHandlers({ ...options, zenModeRef });
    return options;
  });
  return { options: result.current, unmount };
}

function fire(event: string, detail?: unknown) {
  act(() => {
    window.dispatchEvent(new CustomEvent(event, { detail }));
  });
}

describe('useMenuHandlers — custom event surface', () => {
  beforeEach(() => {
    useAppStore.setState({
      sessions: [],
      selectedSessionId: null,
      selectedConversationId: null,
      selectedFileTabId: null,
      fileTabs: [],
    });
    useSettingsStore.setState({} as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('open-settings', () => {
    it('forwards the event to onOpenSettings with category from detail', () => {
      const { options } = renderWithOptions();
      fire('open-settings', { category: 'general' });
      expect(options.onOpenSettings).toHaveBeenCalledWith('general');
    });

    it('passes undefined when detail has no category', () => {
      const { options } = renderWithOptions();
      fire('open-settings');
      expect(options.onOpenSettings).toHaveBeenCalledWith(undefined);
    });
  });

  describe('close-settings', () => {
    it('forwards the event to onCloseSettings', () => {
      const { options } = renderWithOptions();
      fire('close-settings');
      expect(options.onCloseSettings).toHaveBeenCalledTimes(1);
    });
  });

  describe('spawn-agent / new-conversation', () => {
    it('spawn-agent triggers handleNewSession', () => {
      const { options } = renderWithOptions();
      fire('spawn-agent');
      expect(options.handleNewSession).toHaveBeenCalledTimes(1);
    });

    it('new-conversation triggers handleNewConversation', () => {
      const { options } = renderWithOptions();
      fire('new-conversation');
      expect(options.handleNewConversation).toHaveBeenCalledTimes(1);
    });
  });

  describe('add-workspace / create-session', () => {
    it('add-workspace triggers onShowAddWorkspace', () => {
      const { options } = renderWithOptions();
      fire('add-workspace');
      expect(options.onShowAddWorkspace).toHaveBeenCalledTimes(1);
    });

    it('create-session triggers onShowCreateSession', () => {
      const { options } = renderWithOptions();
      fire('create-session');
      expect(options.onShowCreateSession).toHaveBeenCalledTimes(1);
    });
  });

  describe('panel toggles', () => {
    it('toggle-left-panel calls toggleLeftSidebar', () => {
      const { options } = renderWithOptions();
      fire('toggle-left-panel');
      expect(options.toggleLeftSidebar).toHaveBeenCalledTimes(1);
    });

    it('toggle-right-panel calls toggleRightSidebar', () => {
      const { options } = renderWithOptions();
      fire('toggle-right-panel');
      expect(options.toggleRightSidebar).toHaveBeenCalledTimes(1);
    });

    it('toggle-bottom-panel calls toggleBottomTerminal', () => {
      const { options } = renderWithOptions();
      fire('toggle-bottom-panel');
      expect(options.toggleBottomTerminal).toHaveBeenCalledTimes(1);
    });

    it('show-bottom-panel calls onShowBottomTerminal', () => {
      const { options } = renderWithOptions();
      fire('show-bottom-panel');
      expect(options.onShowBottomTerminal).toHaveBeenCalledTimes(1);
    });
  });

  describe('open-in-vscode', () => {
    it('opens VSCode at the selected session worktree path', () => {
      useAppStore.setState({
        sessions: [{ id: 's1', worktreePath: '/work/tree' } as never],
        selectedSessionId: 's1',
      });
      renderWithOptions();
      fire('open-in-vscode');
      expect(openInVSCode).toHaveBeenCalledWith('/work/tree');
    });

    it('is a no-op when no session is selected', () => {
      useAppStore.setState({ selectedSessionId: null });
      renderWithOptions();
      fire('open-in-vscode');
      expect(openInVSCode).not.toHaveBeenCalled();
    });

    it('is a no-op when session has no worktreePath', () => {
      useAppStore.setState({
        sessions: [{ id: 's1', worktreePath: '' } as never],
        selectedSessionId: 's1',
      });
      renderWithOptions();
      fire('open-in-vscode');
      expect(openInVSCode).not.toHaveBeenCalled();
    });
  });

  describe('new-claude-terminal', () => {
    it('creates a Claude terminal and deselects conversation + file tab on success', () => {
      const createClaudeTerminal = vi.fn().mockReturnValue({ id: 'ct-1' });
      const selectConversation = vi.fn();
      const selectFileTab = vi.fn();
      useAppStore.setState({
        sessions: [{ id: 's1', worktreePath: '/work' } as never],
        selectedSessionId: 's1',
        createClaudeTerminal,
        selectConversation,
        selectFileTab,
      } as never);

      renderWithOptions();
      fire('new-claude-terminal');

      expect(createClaudeTerminal).toHaveBeenCalledWith('s1', '/work');
      expect(selectConversation).toHaveBeenCalledWith(null);
      expect(selectFileTab).toHaveBeenCalledWith(null);
    });

    it('dispatches claude-terminal-limit-reached when terminal creation fails', () => {
      const createClaudeTerminal = vi.fn().mockReturnValue(null);
      const limitHandler = vi.fn();
      window.addEventListener('claude-terminal-limit-reached', limitHandler);

      useAppStore.setState({
        sessions: [{ id: 's1', worktreePath: '/work' } as never],
        selectedSessionId: 's1',
        createClaudeTerminal,
        selectConversation: vi.fn(),
        selectFileTab: vi.fn(),
      } as never);

      renderWithOptions();
      fire('new-claude-terminal');

      expect(limitHandler).toHaveBeenCalledTimes(1);
      window.removeEventListener('claude-terminal-limit-reached', limitHandler);
    });

    it('is a no-op when no session is selected', () => {
      const createClaudeTerminal = vi.fn();
      useAppStore.setState({
        selectedSessionId: null,
        createClaudeTerminal,
      } as never);

      renderWithOptions();
      fire('new-claude-terminal');

      expect(createClaudeTerminal).not.toHaveBeenCalled();
    });
  });

  describe('listener cleanup', () => {
    it('removes window listeners on unmount', () => {
      const { options, unmount } = renderWithOptions();
      const toggleLeftSidebar = options.toggleLeftSidebar as ReturnType<typeof vi.fn>;

      // Sanity-check the listener is wired before unmount.
      fire('toggle-left-panel');
      expect(toggleLeftSidebar).toHaveBeenCalledTimes(1);

      unmount();

      // After unmount, dispatching the event must not fire the handler.
      // Capture the count *after* unmount so React's cleanup pass has run,
      // then dispatch the second event inside `act` so any work the listener
      // would have queued is also flushed before we read the count.
      const before = toggleLeftSidebar.mock.calls.length;
      act(() => {
        window.dispatchEvent(new CustomEvent('toggle-left-panel'));
      });
      expect(toggleLeftSidebar.mock.calls.length).toBe(before);
    });
  });
});
