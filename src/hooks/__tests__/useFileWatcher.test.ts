import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useFileWatcher } from '../useFileWatcher';
import { useAppStore } from '@/stores/appStore';
import type { FileChangedEvent } from '@/lib/tauri';
import type { FileTab } from '@/lib/types';

// Flush pending microtasks (replaces the audit F-3 `setTimeout(r, 0)` macrotask
// pattern that races against MSW responses on fast machines).
async function flushAsync() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// ---- Mocks ----

vi.mock('@/lib/tauri', () => ({
  startFileWatcher: vi.fn(),
  stopFileWatcher: vi.fn(),
  listenForFileChanges: vi.fn(),
  sendNotification: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  getWorkspacesBasePath: vi.fn(),
  getRepoFileContent: vi.fn(),
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

import {
  startFileWatcher,
  stopFileWatcher,
  listenForFileChanges,
  sendNotification,
} from '@/lib/tauri';
import { getWorkspacesBasePath, getRepoFileContent } from '@/lib/api';

const mockedStartFileWatcher = vi.mocked(startFileWatcher);
const mockedStopFileWatcher = vi.mocked(stopFileWatcher);
const mockedListenForFileChanges = vi.mocked(listenForFileChanges);
const mockedSendNotification = vi.mocked(sendNotification);
const mockedGetWorkspacesBasePath = vi.mocked(getWorkspacesBasePath);
const mockedGetRepoFileContent = vi.mocked(getRepoFileContent);

function makeFileTab(overrides: Partial<FileTab> = {}): FileTab {
  return {
    id: 'tab-1',
    workspaceId: 'ws-1',
    sessionId: 'session-1',
    path: 'src/file.ts',
    name: 'file.ts',
    content: 'original',
    originalContent: 'original',
    isLoading: false,
    isDirty: false,
    viewMode: 'file',
    ...overrides,
  };
}

// Capture the callback passed to listenForFileChanges so we can trigger events
let capturedFileChangeHandler: ((event: FileChangedEvent) => void) | null = null;
const mockUnlisten = vi.fn();

describe('useFileWatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedFileChangeHandler = null;

    // Default mocks
    mockedGetWorkspacesBasePath.mockResolvedValue('/workspaces');
    mockedStartFileWatcher.mockResolvedValue(true);
    mockedStopFileWatcher.mockResolvedValue(undefined);
    mockedListenForFileChanges.mockImplementation(async (handler) => {
      capturedFileChangeHandler = handler;
      return mockUnlisten;
    });
    mockedGetRepoFileContent.mockResolvedValue({
      content: 'new content from disk',
      path: 'src/file.ts',
      language: 'typescript',
      size: 100,
      isBinary: false,
    });

    // Reset store
    useAppStore.setState({
      fileTabs: [],
      lastFileChange: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts global watcher on mount', async () => {
    const { unmount } = renderHook(() => useFileWatcher());

    // Let async initWatcher resolve
    await act(async () => {
      await flushAsync();
    });

    expect(mockedGetWorkspacesBasePath).toHaveBeenCalled();
    expect(mockedStartFileWatcher).toHaveBeenCalledWith('/workspaces', true);

    unmount();
  });

  it('stops watcher on unmount', async () => {
    const { unmount } = renderHook(() => useFileWatcher());

    await act(async () => {
      await flushAsync();
    });

    unmount();

    expect(mockedStopFileWatcher).toHaveBeenCalled();
  });

  it('does not start watcher twice on re-render', async () => {
    const { rerender, unmount } = renderHook(() => useFileWatcher());

    await act(async () => {
      await flushAsync();
    });

    rerender();

    await act(async () => {
      await flushAsync();
    });

    // The mount effect only runs once (empty deps), so startFileWatcher should be called once
    expect(mockedStartFileWatcher).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('handles getWorkspacesBasePath failure gracefully', async () => {
    mockedGetWorkspacesBasePath.mockRejectedValueOnce(new Error('API down'));

    const { unmount } = renderHook(() => useFileWatcher());

    await act(async () => {
      await flushAsync();
    });

    expect(mockedStartFileWatcher).not.toHaveBeenCalled();

    unmount();
  });

  it('handles startFileWatcher returning false', async () => {
    mockedStartFileWatcher.mockResolvedValueOnce(false);

    const { unmount } = renderHook(() => useFileWatcher());

    await act(async () => {
      await flushAsync();
    });

    // Should not crash
    expect(mockedStartFileWatcher).toHaveBeenCalled();

    unmount();
  });

  it('registers Tauri event listener', async () => {
    const { unmount } = renderHook(() => useFileWatcher());

    await act(async () => {
      await flushAsync();
    });

    expect(mockedListenForFileChanges).toHaveBeenCalledWith(expect.any(Function));

    unmount();
  });

  it('writes file change events to the store', async () => {
    renderHook(() => useFileWatcher());

    await act(async () => {
      await flushAsync();
    });

    expect(capturedFileChangeHandler).toBeTruthy();

    // Simulate a file change event
    act(() => {
      capturedFileChangeHandler!({
        workspaceId: 'ws-1',
        path: 'src/changed.ts',
        fullPath: '/workspaces/ws-1/src/changed.ts',
      });
    });

    const lastChange = useAppStore.getState().lastFileChange;
    expect(lastChange).toBeTruthy();
    expect(lastChange!.workspaceId).toBe('ws-1');
    expect(lastChange!.path).toBe('src/changed.ts');
  });

  it('reloads open non-dirty tab on file change', async () => {
    const tab = makeFileTab({ isDirty: false });
    useAppStore.setState({ fileTabs: [tab] });

    renderHook(() => useFileWatcher());

    await act(async () => {
      await flushAsync();
    });

    // Trigger file change for the open tab's file
    await act(async () => {
      capturedFileChangeHandler!({
        workspaceId: 'ws-1',
        path: 'src/file.ts',
        fullPath: '/workspaces/ws-1/src/file.ts',
      });
      await flushAsync();
    });

    expect(mockedGetRepoFileContent).toHaveBeenCalledWith('ws-1', 'src/file.ts');
  });

  it('shows conflict warning for dirty tab instead of reloading', async () => {
    const dirtyTab = makeFileTab({ isDirty: true });
    useAppStore.setState({ fileTabs: [dirtyTab] });

    renderHook(() => useFileWatcher());

    await act(async () => {
      await flushAsync();
    });

    // Trigger file change for the dirty tab's file
    await act(async () => {
      capturedFileChangeHandler!({
        workspaceId: 'ws-1',
        path: 'src/file.ts',
        fullPath: '/workspaces/ws-1/src/file.ts',
      });
      await flushAsync();
    });

    // Should NOT reload
    expect(mockedGetRepoFileContent).not.toHaveBeenCalled();
    // Should show notification
    expect(mockedSendNotification).toHaveBeenCalledWith(
      'file.ts changed on disk',
      expect.stringContaining('unsaved changes')
    );
  });

  it('ignores change for unopened files', async () => {
    // No tabs open
    useAppStore.setState({ fileTabs: [] });

    renderHook(() => useFileWatcher());

    await act(async () => {
      await flushAsync();
    });

    // Trigger file change for a file not open in any tab
    await act(async () => {
      capturedFileChangeHandler!({
        workspaceId: 'ws-1',
        path: 'src/other-file.ts',
        fullPath: '/workspaces/ws-1/src/other-file.ts',
      });
      await flushAsync();
    });

    expect(mockedGetRepoFileContent).not.toHaveBeenCalled();
    expect(mockedSendNotification).not.toHaveBeenCalled();
  });

  it('cleans up listener on unmount', async () => {
    const { unmount } = renderHook(() => useFileWatcher());

    await act(async () => {
      await flushAsync();
    });

    unmount();

    // Hook's cleanup uses an internal setTimeout(10) before calling unlisten.
    // Poll deterministically rather than waiting a fixed wall-clock interval.
    await waitFor(() => expect(mockUnlisten).toHaveBeenCalled());
  });
});
