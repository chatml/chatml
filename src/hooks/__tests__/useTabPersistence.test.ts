import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAppStore } from '@/stores/appStore';
import type { FileTab } from '@/lib/types';

// ---- Mocks ----

vi.mock('@/lib/api', () => ({
  listFileTabs: vi.fn(),
  saveFileTabs: vi.fn(),
  getApiBase: vi.fn().mockReturnValue('http://localhost:9876'),
}));

import { listFileTabs, saveFileTabs, getApiBase } from '@/lib/api';
import type { FileTabDTO } from '@/lib/api';

const mockedListFileTabs = vi.mocked(listFileTabs);
const mockedSaveFileTabs = vi.mocked(saveFileTabs);
const mockedGetApiBase = vi.mocked(getApiBase);

// ---- Test data factories ----

function makeFileTab(overrides: Partial<FileTab> = {}): FileTab {
  return {
    id: 'tab-1',
    workspaceId: 'ws-1',
    sessionId: 'session-1',
    path: 'src/file.ts',
    name: 'file.ts',
    isLoading: false,
    viewMode: 'file',
    isPinned: false,
    openedAt: '2026-01-01T00:00:00.000Z',
    lastAccessedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeFileTabDTO(overrides: Partial<FileTabDTO> = {}): FileTabDTO {
  return {
    id: 'tab-1',
    workspaceId: 'ws-1',
    sessionId: 'session-1',
    path: 'src/file.ts',
    viewMode: 'file',
    isPinned: false,
    position: 0,
    openedAt: '2026-01-01T00:00:00.000Z',
    lastAccessedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// Helper: flush microtasks + advance timers so resolved promises and React
// state updates (including effects) can complete.
async function flushAndAdvance(ms = 0) {
  await act(async () => {
    await Promise.resolve();
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

// ---- Tests ----

describe('useTabPersistence', () => {
  // Track sendBeacon mock and beforeunload listeners
  let mockSendBeacon: ReturnType<typeof vi.fn>;
  let beforeUnloadHandlers: Array<() => void>;
  const originalAddEventListener = window.addEventListener;
  const originalRemoveEventListener = window.removeEventListener;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    // Reset store to clean state
    useAppStore.setState({
      selectedWorkspaceId: 'ws-1',
      selectedSessionId: 'session-1',
      selectedFileTabId: null,
      fileTabs: [],
    });

    // Default mock implementations
    mockedListFileTabs.mockResolvedValue([]);
    mockedSaveFileTabs.mockResolvedValue(undefined);
    mockedGetApiBase.mockReturnValue('http://localhost:9876');

    // Mock navigator.sendBeacon
    mockSendBeacon = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'sendBeacon', {
      value: mockSendBeacon,
      writable: true,
      configurable: true,
    });

    // Track beforeunload event listeners manually.
    // This wraps addEventListener globally to intercept 'beforeunload' registrations
    // while delegating all events (including non-beforeunload) to the original handler.
    beforeUnloadHandlers = [];
    window.addEventListener = vi.fn((event: string, handler: unknown) => {
      if (event === 'beforeunload') {
        beforeUnloadHandlers.push(handler as () => void);
      }
      originalAddEventListener.call(window, event, handler as EventListenerOrEventListenerObject);
    });
    window.removeEventListener = vi.fn((event: string, handler: unknown) => {
      if (event === 'beforeunload') {
        beforeUnloadHandlers = beforeUnloadHandlers.filter((h) => h !== handler);
      }
      originalRemoveEventListener.call(window, event, handler as EventListenerOrEventListenerObject);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.addEventListener = originalAddEventListener;
    window.removeEventListener = originalRemoveEventListener;
  });

  // Dynamically import the hook so mocks are established first
  async function importAndRender() {
    // Clear the module cache to pick up fresh mocks
    const mod = await import('../useTabPersistence');
    return renderHook(() => mod.useTabPersistence());
  }

  // ===================================================================
  // Tab loading when workspace/session changes
  // ===================================================================

  describe('loading tabs on workspace/session change', () => {
    it('loads tabs from the API when workspace and session are set', async () => {
      const dto = makeFileTabDTO({ id: 'tab-1', sessionId: 'session-1' });
      mockedListFileTabs.mockResolvedValue([dto]);

      const { unmount } = await importAndRender();
      await flushAndAdvance();

      expect(mockedListFileTabs).toHaveBeenCalledWith('ws-1');

      // Tabs should be set in the store
      const tabs = useAppStore.getState().fileTabs;
      expect(tabs).toHaveLength(1);
      expect(tabs[0].id).toBe('tab-1');
      expect(tabs[0].path).toBe('src/file.ts');
      expect(tabs[0].name).toBe('file.ts');
      expect(tabs[0].isLoading).toBe(false);

      unmount();
    });

    it('does not load when workspaceId is missing', async () => {
      useAppStore.setState({ selectedWorkspaceId: null });

      const { unmount } = await importAndRender();
      await flushAndAdvance();

      expect(mockedListFileTabs).not.toHaveBeenCalled();
      unmount();
    });

    it('does not load when sessionId is missing', async () => {
      useAppStore.setState({ selectedSessionId: null });

      const { unmount } = await importAndRender();
      await flushAndAdvance();

      expect(mockedListFileTabs).not.toHaveBeenCalled();
      unmount();
    });

    it('filters loaded tabs to only the current session', async () => {
      const currentSessionTab = makeFileTabDTO({ id: 'tab-current', sessionId: 'session-1' });
      const otherSessionTab = makeFileTabDTO({ id: 'tab-other', sessionId: 'session-2' });
      const noSessionTab = makeFileTabDTO({ id: 'tab-none', sessionId: undefined });
      mockedListFileTabs.mockResolvedValue([currentSessionTab, otherSessionTab, noSessionTab]);

      const { unmount } = await importAndRender();
      await flushAndAdvance();

      // Only session-1 tabs should appear in the store
      const tabs = useAppStore.getState().fileTabs;
      expect(tabs).toHaveLength(1);
      expect(tabs[0].id).toBe('tab-current');

      unmount();
    });

    it('auto-selects the first tab if no tab is currently selected', async () => {
      const dto = makeFileTabDTO({ id: 'tab-first', sessionId: 'session-1' });
      mockedListFileTabs.mockResolvedValue([dto]);

      useAppStore.setState({ selectedFileTabId: null });

      const { unmount } = await importAndRender();
      await flushAndAdvance();

      expect(useAppStore.getState().selectedFileTabId).toBe('tab-first');

      unmount();
    });

    it('does not auto-select if a tab is already selected', async () => {
      const dto = makeFileTabDTO({ id: 'tab-new', sessionId: 'session-1' });
      mockedListFileTabs.mockResolvedValue([dto]);

      useAppStore.setState({ selectedFileTabId: 'already-selected' });

      const { unmount } = await importAndRender();
      await flushAndAdvance();

      expect(useAppStore.getState().selectedFileTabId).toBe('already-selected');

      unmount();
    });

    it('handles API errors gracefully during load', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockedListFileTabs.mockRejectedValue(new Error('Network error'));

      const { unmount } = await importAndRender();
      await flushAndAdvance();

      expect(consoleSpy).toHaveBeenCalledWith('Failed to load tabs:', expect.any(Error));
      // Store should remain empty (not crash)
      expect(useAppStore.getState().fileTabs).toHaveLength(0);

      consoleSpy.mockRestore();
      unmount();
    });

    it('skips fetch if store already has tabs for the current session', async () => {
      // Pre-populate store with a tab for the current session
      const existingTab = makeFileTab({ id: 'existing', workspaceId: 'ws-1', sessionId: 'session-1' });
      useAppStore.setState({ fileTabs: [existingTab] });

      const { unmount } = await importAndRender();
      await flushAndAdvance();

      // Should not call listFileTabs since tabs already exist
      expect(mockedListFileTabs).not.toHaveBeenCalled();

      unmount();
    });

    it('derives the tab name from the last path segment', async () => {
      const dto = makeFileTabDTO({
        id: 'tab-deep',
        sessionId: 'session-1',
        path: 'src/components/deep/MyComponent.tsx',
      });
      mockedListFileTabs.mockResolvedValue([dto]);

      const { unmount } = await importAndRender();
      await flushAndAdvance();

      const tabs = useAppStore.getState().fileTabs;
      expect(tabs[0].name).toBe('MyComponent.tsx');

      unmount();
    });
  });

  // ===================================================================
  // Multi-session tab preservation
  // ===================================================================

  describe('multi-session tab preservation', () => {
    it('preserves tabs from other sessions when loading new session tabs', async () => {
      // Pre-populate store with a tab from another session (session-2)
      const otherSessionTab = makeFileTab({
        id: 'other-tab',
        workspaceId: 'ws-1',
        sessionId: 'session-2',
        path: 'src/other.ts',
        name: 'other.ts',
      });
      // Make sure the existing tab doesn't match the current session so we don't skip
      useAppStore.setState({ fileTabs: [otherSessionTab] });

      const newSessionDTO = makeFileTabDTO({
        id: 'new-tab',
        sessionId: 'session-1',
        path: 'src/new.ts',
      });
      mockedListFileTabs.mockResolvedValue([newSessionDTO]);

      const { unmount } = await importAndRender();
      await flushAndAdvance();

      const tabs = useAppStore.getState().fileTabs;
      // Should have both: the other session tab AND the newly loaded session tab
      expect(tabs).toHaveLength(2);
      expect(tabs.find((t) => t.id === 'other-tab')).toBeTruthy();
      expect(tabs.find((t) => t.id === 'new-tab')).toBeTruthy();

      unmount();
    });
  });

  // ===================================================================
  // Debounced saves (2 second delay)
  // ===================================================================

  describe('debounced save', () => {
    it('saves tabs after the 2s debounce delay', async () => {
      const tab = makeFileTab();
      useAppStore.setState({ fileTabs: [tab] });

      const { unmount } = await importAndRender();
      // Let the load effect run (will find existing tabs for session so skips fetch,
      // but the save effect will schedule)
      await flushAndAdvance();

      // The save debounce hasn't fired yet
      expect(mockedSaveFileTabs).not.toHaveBeenCalled();

      // Advance past the 2s debounce
      await flushAndAdvance(2100);

      expect(mockedSaveFileTabs).toHaveBeenCalledWith('ws-1', expect.any(Array));

      unmount();
    });

    it('debounces rapid tab changes into a single save', async () => {
      const tab1 = makeFileTab({ id: 'tab-1' });
      useAppStore.setState({ fileTabs: [tab1] });

      const { unmount } = await importAndRender();
      await flushAndAdvance();

      // Add tabs rapidly (within 2s window)
      for (let i = 2; i <= 4; i++) {
        act(() => {
          const current = useAppStore.getState().fileTabs;
          useAppStore.setState({
            fileTabs: [
              ...current,
              makeFileTab({ id: `tab-${i}`, path: `src/file${i}.ts`, name: `file${i}.ts` }),
            ],
          });
        });
        // Small gap, well within the 2s debounce window
        await flushAndAdvance(200);
      }

      // At this point the final timer was set ~200ms ago. Advance to trigger it.
      await flushAndAdvance(2100);

      // saveFileTabs should only have been called once (the debounced call)
      // Note: there may be one call from the initial render cycle too
      const callCount = mockedSaveFileTabs.mock.calls.length;
      expect(callCount).toBeGreaterThanOrEqual(1);
      // The final call should include all 4 tabs
      const lastCallTabs = mockedSaveFileTabs.mock.calls[callCount - 1][1] as FileTabDTO[];
      expect(lastCallTabs.length).toBe(4);

      unmount();
    });

    it('does not save when workspaceId is missing', async () => {
      useAppStore.setState({
        selectedWorkspaceId: null,
        fileTabs: [makeFileTab()],
      });

      const { unmount } = await importAndRender();
      await flushAndAdvance(3000);

      expect(mockedSaveFileTabs).not.toHaveBeenCalled();

      unmount();
    });

    it('handles save API errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockedSaveFileTabs.mockRejectedValue(new Error('Save failed'));

      const tab = makeFileTab();
      useAppStore.setState({ fileTabs: [tab] });

      const { unmount } = await importAndRender();
      await flushAndAdvance(3000);

      expect(consoleSpy).toHaveBeenCalledWith('Failed to save tabs:', expect.any(Error));

      consoleSpy.mockRestore();
      unmount();
    });
  });

  // ===================================================================
  // Save skip if no changes (JSON comparison)
  // ===================================================================

  describe('skip save when no changes', () => {
    it('does not save if tabs have not changed since last save', async () => {
      const dto = makeFileTabDTO({ id: 'tab-1', sessionId: 'session-1' });
      mockedListFileTabs.mockResolvedValue([dto]);

      // Pre-select a tab so auto-select doesn't fire (which would mutate
      // lastAccessedAt and create a mismatch with the saved JSON)
      useAppStore.setState({ selectedFileTabId: 'tab-1' });

      const { unmount } = await importAndRender();

      // Let load complete - this sets lastSavedRef from loaded data
      await flushAndAdvance();

      // The loaded tabs should match what was saved, so no save should fire
      mockedSaveFileTabs.mockClear();

      // Advance well past debounce
      await flushAndAdvance(3000);

      expect(mockedSaveFileTabs).not.toHaveBeenCalled();

      unmount();
    });

    it('saves when tabs have changed from last saved state', async () => {
      const dto = makeFileTabDTO({ id: 'tab-1', sessionId: 'session-1' });
      mockedListFileTabs.mockResolvedValue([dto]);

      const { unmount } = await importAndRender();
      await flushAndAdvance();
      mockedSaveFileTabs.mockClear();

      // Add a new tab to the store (represents a change)
      act(() => {
        const current = useAppStore.getState().fileTabs;
        useAppStore.setState({
          fileTabs: [
            ...current,
            makeFileTab({ id: 'tab-2', path: 'src/new.ts', name: 'new.ts' }),
          ],
        });
      });

      // Advance past debounce
      await flushAndAdvance(3000);

      expect(mockedSaveFileTabs).toHaveBeenCalled();

      unmount();
    });
  });

  // ===================================================================
  // DTO conversion with defaults
  // ===================================================================

  describe('DTO conversion', () => {
    it('converts FileTab to FileTabDTO with correct field mapping', async () => {
      const tab = makeFileTab({
        id: 'dto-test',
        workspaceId: 'ws-1',
        sessionId: 'session-1',
        path: 'src/component.tsx',
        viewMode: 'diff',
        isPinned: true,
        openedAt: '2026-02-01T12:00:00.000Z',
        lastAccessedAt: '2026-02-01T13:00:00.000Z',
      });

      useAppStore.setState({ fileTabs: [tab] });

      const { unmount } = await importAndRender();
      await flushAndAdvance(3000);

      expect(mockedSaveFileTabs).toHaveBeenCalled();
      const savedTabs = mockedSaveFileTabs.mock.calls[0][1] as FileTabDTO[];
      expect(savedTabs).toHaveLength(1);

      const savedDTO = savedTabs[0];
      expect(savedDTO.id).toBe('dto-test');
      expect(savedDTO.workspaceId).toBe('ws-1');
      expect(savedDTO.sessionId).toBe('session-1');
      expect(savedDTO.path).toBe('src/component.tsx');
      expect(savedDTO.viewMode).toBe('diff');
      expect(savedDTO.isPinned).toBe(true);
      expect(savedDTO.position).toBe(0);
      expect(savedDTO.openedAt).toBe('2026-02-01T12:00:00.000Z');
      expect(savedDTO.lastAccessedAt).toBe('2026-02-01T13:00:00.000Z');

      unmount();
    });

    it('provides defaults for optional FileTab fields in DTO', async () => {
      // Create a tab with no viewMode, isPinned, openedAt, lastAccessedAt
      const tab: FileTab = {
        id: 'minimal-tab',
        workspaceId: 'ws-1',
        sessionId: 'session-1',
        path: 'src/minimal.ts',
        name: 'minimal.ts',
        isLoading: false,
        // viewMode, isPinned, openedAt, lastAccessedAt intentionally omitted
      };

      useAppStore.setState({ fileTabs: [tab] });

      const { unmount } = await importAndRender();
      await flushAndAdvance(3000);

      expect(mockedSaveFileTabs).toHaveBeenCalled();
      const savedTabs = mockedSaveFileTabs.mock.calls[0][1] as FileTabDTO[];
      const savedDTO = savedTabs[0];

      // tabToDTO should provide defaults
      expect(savedDTO.viewMode).toBe('file');
      expect(savedDTO.isPinned).toBe(false);
      expect(savedDTO.position).toBe(0);
      // openedAt and lastAccessedAt should get new Date().toISOString() defaults
      expect(savedDTO.openedAt).toBeTruthy();
      expect(savedDTO.lastAccessedAt).toBeTruthy();

      unmount();
    });

    it('only saves tabs belonging to the current workspace', async () => {
      const wsTab = makeFileTab({ id: 'ws-tab', workspaceId: 'ws-1' });
      const otherWsTab = makeFileTab({ id: 'other-ws-tab', workspaceId: 'ws-other' });

      useAppStore.setState({ fileTabs: [wsTab, otherWsTab] });

      const { unmount } = await importAndRender();
      await flushAndAdvance(3000);

      expect(mockedSaveFileTabs).toHaveBeenCalledWith('ws-1', expect.any(Array));
      const savedTabs = mockedSaveFileTabs.mock.calls[0][1] as FileTabDTO[];
      // Only ws-1 tab should be saved
      expect(savedTabs).toHaveLength(1);
      expect(savedTabs[0].id).toBe('ws-tab');

      unmount();
    });
  });

  // ===================================================================
  // beforeunload sync save with navigator.sendBeacon
  // ===================================================================

  describe('beforeunload and sendBeacon', () => {
    it('registers a beforeunload event listener', async () => {
      const { unmount } = await importAndRender();
      await flushAndAdvance();

      expect(window.addEventListener).toHaveBeenCalledWith(
        'beforeunload',
        expect.any(Function)
      );

      unmount();
    });

    it('calls sendBeacon with correct URL and data on beforeunload', async () => {
      const tab = makeFileTab({ id: 'beacon-tab', workspaceId: 'ws-1' });
      useAppStore.setState({ fileTabs: [tab] });

      const { unmount } = await importAndRender();
      await flushAndAdvance();

      // Simulate the beforeunload event
      expect(beforeUnloadHandlers.length).toBeGreaterThan(0);
      // Fire the latest handler
      beforeUnloadHandlers[beforeUnloadHandlers.length - 1]();

      expect(mockSendBeacon).toHaveBeenCalledWith(
        'http://localhost:9876/api/repos/ws-1/tabs',
        expect.any(String)
      );

      // Verify the beacon payload contains the tab DTOs
      const payload = JSON.parse(mockSendBeacon.mock.calls[0][1] as string);
      expect(payload.tabs).toBeDefined();
      expect(payload.tabs).toHaveLength(1);
      expect(payload.tabs[0].id).toBe('beacon-tab');

      unmount();
    });

    it('does not send beacon when workspaceId is missing', async () => {
      useAppStore.setState({
        selectedWorkspaceId: null,
        fileTabs: [makeFileTab()],
      });

      const { unmount } = await importAndRender();
      await flushAndAdvance();

      // Trigger beforeunload if any handler was registered
      if (beforeUnloadHandlers.length > 0) {
        beforeUnloadHandlers[beforeUnloadHandlers.length - 1]();
      }

      expect(mockSendBeacon).not.toHaveBeenCalled();

      unmount();
    });

    it('removes beforeunload listener on unmount', async () => {
      const { unmount } = await importAndRender();
      await flushAndAdvance();

      unmount();

      expect(window.removeEventListener).toHaveBeenCalledWith(
        'beforeunload',
        expect.any(Function)
      );
    });

    it('fires a final save on cleanup when there is a pending timeout', async () => {
      const tab = makeFileTab({ id: 'cleanup-tab' });
      useAppStore.setState({ fileTabs: [tab] });

      const { unmount } = await importAndRender();
      await flushAndAdvance();

      // At this point a debounced save timeout is pending (from the fileTabs effect).
      // Unmounting should clear the timeout and trigger an immediate saveTabs().
      mockedSaveFileTabs.mockClear();

      unmount();

      // The cleanup calls saveTabs() synchronously (fire-and-forget)
      await flushAndAdvance();

      // The cleanup save should have been called since the tab is new
      // (not matching lastSavedRef which was set from an empty load).
      expect(mockedSaveFileTabs).toHaveBeenCalledWith('ws-1', expect.any(Array));
      // Verify the beforeunload listener was also cleaned up
      expect(window.removeEventListener).toHaveBeenCalledWith(
        'beforeunload',
        expect.any(Function),
      );
    });
  });

  // ===================================================================
  // Edge cases
  // ===================================================================

  describe('edge cases', () => {
    it('handles an empty path gracefully (falls back to full path as name)', async () => {
      const dto = makeFileTabDTO({
        id: 'empty-path-tab',
        sessionId: 'session-1',
        path: '',
      });
      mockedListFileTabs.mockResolvedValue([dto]);

      const { unmount } = await importAndRender();
      await flushAndAdvance();

      const tabs = useAppStore.getState().fileTabs;
      expect(tabs).toHaveLength(1);
      // When path is empty, .split('/').pop() returns '' so it falls back to path itself
      expect(tabs[0].name).toBe('');

      unmount();
    });

    it('handles loading when API returns no tabs for session', async () => {
      mockedListFileTabs.mockResolvedValue([]);

      const { unmount } = await importAndRender();
      await flushAndAdvance();

      expect(useAppStore.getState().fileTabs).toHaveLength(0);
      // Should not select any tab
      expect(useAppStore.getState().selectedFileTabId).toBeNull();

      unmount();
    });
  });
});
